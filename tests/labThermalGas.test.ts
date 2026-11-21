import { describe, expect, it } from 'vitest';
import type { InitialState } from '../src/simulation/gpuModel';
import { heatingTotals, sampleGas } from '../src/lab/heatingReference';
import { mulberry32 } from '../src/lab/random';
import { fillBlobs, fillThermalGas, gaussianPair, LAB_CELL, LAB_T0, thermalSigma } from '../src/lab/thermalGas';
import { PROTOSTAR_FUSION_T_REF } from '../src/config';

function state(count: number): InitialState {
    return {
        positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4), count, typeCounts: [count],
        width: 1024, height: 768, params: {},
    };
}

describe('thermal gas of the lab', () => {
    it('has the standard deviation per component that makes T = 2 sigma^2', () => {
        expect(thermalSigma(1)).toBeCloseTo(Math.sqrt(LAB_T0 / 2), 12);
        expect(LAB_T0).toBeCloseTo(PROTOSTAR_FUSION_T_REF * 768 * 768, 9);
        expect(LAB_CELL).toBe(8);
    });

    it('draws normal numbers from uniforms (Box-Muller)', () => {
        const random = mulberry32(1);
        const values: number[] = [];
        for (let i = 0; i < 20000; i++) values.push(...gaussianPair(random(), random()));
        const m = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
        expect(Math.abs(m)).toBeLessThan(0.03);
        expect(variance).toBeCloseTo(1, 1);
        expect(Number.isFinite(gaussianPair(0, 0)[0])).toBe(true);
    });

    it('fills a box uniformly with hydrogen at rest with the thermal velocities asked for', () => {
        const s = state(40001);                          // an odd count: the last particle comes alone
        const box = { x0: 100, y0: 50, x1: 500, y1: 250 };
        fillThermalGas(s, box, 30, mulberry32(3), [10, -5]);
        let sx = 0, sy = 0, vx = 0, vy = 0;
        for (let i = 0; i < s.count; i++) {
            const [x, y, type, w] = [s.positions[i * 4], s.positions[i * 4 + 1], s.positions[i * 4 + 2], s.positions[i * 4 + 3]];
            expect(x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1).toBe(true);
            expect([type, w]).toEqual([0, 1]);
            sx += x; sy += y; vx += s.velocities[i * 4]; vy += s.velocities[i * 4 + 1];
        }
        expect(sx / s.count).toBeCloseTo(300, -1);
        expect(sy / s.count).toBeCloseTo(150, -1);
        expect(vx / s.count).toBeCloseTo(10, 0);
        expect(vy / s.count).toBeCloseTo(-5, 0);
        let dispersion = 0;
        for (let i = 0; i < s.count; i++) dispersion += (s.velocities[i * 4] - vx / s.count) ** 2 + (s.velocities[i * 4 + 1] - vy / s.count) ** 2;
        expect(dispersion / s.count / (2 * 30 * 30)).toBeCloseTo(1, 1);
    });

    it('places blobs at the exact center of a cell, with the sample mean and variance exactly as asked', () => {
        const s = state(3 * 200);
        fillBlobs(s, [
            { cell: [5, 7], count: 200, sigma: 40, bulk: [10, -20] },
            { cell: [60, 3], count: 200, sigma: 0, bulk: [-3, 4] },
            { cell: [0, 0], count: 200, sigma: 2, bulk: [0, 0] },
        ], LAB_CELL, mulberry32(9));
        const expectedCells = [[5, 7], [60, 3], [0, 0]];
        for (let b = 0; b < 3; b++) {
            const indices = Array.from({ length: 200 }, (_, k) => b * 200 + k);
            for (const i of indices) {
                expect(s.positions[i * 4]).toBe((expectedCells[b][0] + 0.5) * LAB_CELL);
                expect(s.positions[i * 4 + 1]).toBe((expectedCells[b][1] + 0.5) * LAB_CELL);
            }
            const mx = indices.reduce((sum, i) => sum + s.velocities[i * 4], 0) / 200;
            const my = indices.reduce((sum, i) => sum + s.velocities[i * 4 + 1], 0) / 200;
            const varx = indices.reduce((sum, i) => sum + (s.velocities[i * 4] - mx) ** 2, 0) / 200;
            const vary = indices.reduce((sum, i) => sum + (s.velocities[i * 4 + 1] - my) ** 2, 0) / 200;
            const [sigma, bulk] = [[40, [10, -20]], [0, [-3, 4]], [2, [0, 0]]][b] as [number, [number, number]];
            expect(mx).toBeCloseTo(bulk[0], 4);
            expect(my).toBeCloseTo(bulk[1], 4);
            expect(varx).toBeCloseTo(sigma * sigma, 2);
            expect(vary).toBeCloseTo(sigma * sigma, 2);
        }
    });
});

describe('CPU reference of the gas a particle reads', () => {
    const RES = 4;
    const gas = new Float32Array(RES * RES * 4);
    const heat = new Float32Array(RES * RES * 4);
    for (let c = 0; c < RES * RES; c++) {
        gas.set([2, 5, 3, -1], c * 4);
        heat[c * 4] = 0.25;
    }

    it('is the common value of a uniform grid, anywhere, also at the grid edge', () => {
        for (const [x, y] of [[0, 0], [2, 3], [4, 4], [15.9, 0.1], [7, 15]]) {
            const g = sampleGas(x, y, gas, heat, RES, 4);
            expect(g).toEqual({ rho: 2, t: 5, u: [3, -1], heat: 0.25 });
        }
    });

    it('weights the four cells around a point bilinearly and by their density, and reads one cell alone at its center', () => {
        const varied = Float32Array.from(gas);
        const cell = (cx: number, cy: number): number => (cy * RES + cx) * 4;
        varied.set([1, 10, 0, 0], cell(1, 1));
        varied.set([3, 20, 6, 0], cell(2, 1));
        const atCenter = sampleGas(1.5 * 4, 1.5 * 4, varied, heat, RES, 4);
        expect([atCenter.rho, atCenter.t, atCenter.u[0]]).toEqual([1, 10, 0]);
        // halfway between the centers of cells (1, 1) and (2, 1): equal bilinear weights, densities 1 and 3 weigh the other fields
        const between = sampleGas(2 * 4, 1.5 * 4, varied, heat, RES, 4);
        expect(between.rho).toBeCloseTo(2, 12);
        expect(between.t).toBeCloseTo((1 * 10 + 3 * 20) / 4, 12);
        expect(between.u[0]).toBeCloseTo((3 * 6) / 4, 12);
    });

    it('sums the energy and the momentum that go from one set of velocities to another', () => {
        const before = Float32Array.from([1, 0, 0, 0, 0, 2, 0, 0, 5, 5, 0, 0]);
        const after = Float32Array.from([2, 0, 0, 0, 0, 3, 0, 0, 5, 5, 0, 0]);
        const totals = heatingTotals(before, after, [0, 1]);
        expect(totals.energy).toBeCloseTo((4 - 1) / 2 + (9 - 4) / 2, 12);
        expect(totals.momentum).toEqual([1, 1]);
        expect(heatingTotals(before, after, [2])).toEqual({ energy: 0, momentum: [0, 0] });
    });
});
