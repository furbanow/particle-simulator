import { describe, expect, it } from 'vitest';
import { referenceDeposit } from '../src/lab/depositReference';
import { PROTOSTAR_NOISE_N_SHAPE, PROTOSTAR_NOISE_N_SHAPE_TSC } from '../src/config';
import { kernelStencil, kernelWeight, meanNeighborhoodNoiseShape, neighborhoodNoiseShape, type DepositKernel } from '../src/simulation/depositKernel';
import type { DepositInputs } from '../src/simulation/protostar/grids';

const KERNELS: readonly DepositKernel[] = ['cic', 'tsc'];
const POSITIONS = [0, 0.1, 0.25, 0.5, 0.73, 0.999, 3.5, 7.2];

describe('deposit kernels', () => {
    it('give weights that sum to 1 and keep the particle at its place (centroid)', () => {
        for (const kernel of KERNELS) {
            for (const p of POSITIONS) {
                const { first, weights } = kernelStencil(kernel, p);
                expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
                const centroid = weights.reduce((s, w, j) => s + w * (first + j + 0.5), 0);
                expect(centroid).toBeCloseTo(p, 12);
                for (const w of weights) expect(w).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('cover 2 cells (cloud-in-cell) or 3 (TSC) around the particle', () => {
        expect(kernelStencil('cic', 3.2)).toEqual({ first: 2, weights: [expect.closeTo(0.3, 12), expect.closeTo(0.7, 12)] });
        expect(kernelStencil('tsc', 3.5)).toEqual({ first: 2, weights: [0.125, 0.75, 0.125] });
        expect(kernelStencil('tsc', 3.0)).toEqual({ first: 2, weights: [0.5, 0.5, 0] });
    });

    it('are continuous, and TSC has a continuous slope too', () => {
        const eps = 1e-7;
        for (const d of [0.5, 1, 1.5]) {
            expect(Math.abs(kernelWeight('tsc', d + eps) - kernelWeight('tsc', d - eps))).toBeLessThan(1e-6);
            const slope = (x: number) => (kernelWeight('tsc', x + eps) - kernelWeight('tsc', x - eps)) / (2 * eps);
            expect(Math.abs(slope(d + 1e-4) - slope(d - 1e-4))).toBeLessThan(1e-3);
        }
        expect(kernelWeight('cic', 1)).toBe(0);
        expect(kernelWeight('tsc', 1.5)).toBe(0);
    });
});

describe('the noise shape of a 3x3 neighborhood', () => {
    it('is the cloud-in-cell factor of config.ts: 1.27 at a cell center, 1.65 between four cells', () => {
        expect(neighborhoodNoiseShape('cic', 0)).toBeCloseTo(81 / 64, 3);    // (3 / (8/3))^2
        expect(neighborhoodNoiseShape('cic', 0.5)).toBeCloseTo(1.653, 2);
    });

    it('averaged over the place of the particle, is the shape of config.ts: 1.5 measured for cloud-in-cell, 1.63 for TSC', () => {
        expect(meanNeighborhoodNoiseShape('cic')).toBeCloseTo(PROTOSTAR_NOISE_N_SHAPE, 1);
        expect(meanNeighborhoodNoiseShape('tsc')).toBeCloseTo(PROTOSTAR_NOISE_N_SHAPE_TSC, 2);
    });

    it('is larger with TSC: about 7 to 11 % more effective particles', () => {
        const gain = (offset: number) => neighborhoodNoiseShape('tsc', offset) / neighborhoodNoiseShape('cic', offset);
        expect(gain(0)).toBeCloseTo(1.108, 2);
        expect(gain(0.5)).toBeCloseTo(1.068, 2);
    });
});

describe('lab: CPU reference of the TSC deposit', () => {
    const RES = 8;
    const inputs: DepositInputs = {
        gridResolution: RES, gridCell: 10, depositMassScale: 1,
        depositMass: new Array<number>(10).fill(1), inverseMolecularWeight: new Array<number>(10).fill(1),
        fuel: new Array<[number, number]>(10).fill([1, 0]),
    };

    it('puts a particle at a cell center over its 3x3 cells: 0.75^2 in its own, 0.125 x 0.75 at its sides, 0.125^2 at its corners', () => {
        const ref = referenceDeposit([35, 55, 0, 1], 1, inputs, 0, 'tsc');    // cell (3, 5)
        const at = (x: number, y: number) => ref.mass[y * RES + x];
        expect(at(3, 5)).toBeCloseTo(0.5625, 12);
        expect(at(2, 5)).toBeCloseTo(0.09375, 12);
        expect(at(3, 6)).toBeCloseTo(0.09375, 12);
        expect(at(4, 4)).toBeCloseTo(0.015625, 12);
        expect(ref.mass.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
        expect(ref.contributions.reduce((s, v) => s + v, 0)).toBe(9);
    });

    it('keeps the mass of a particle in the first or last cell, and drops one outside the grid', () => {
        const edge = referenceDeposit([1, 79, 0, 1], 1, inputs, 0, 'tsc');    // cell (0, 7): part of its cloud is off the grid
        expect(edge.deposited).toBe(1);
        expect(edge.mass.reduce((s, v) => s + v, 0)).toBeLessThan(1);
        expect(referenceDeposit([-1, 40, 0, 1], 1, inputs, 0, 'tsc').deposited).toBe(0);
    });
});
