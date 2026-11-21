import { describe, expect, it } from 'vitest';
import { PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_FUSION_RATE_MAX } from '../src/config';
import { LAB_AREA } from '../src/lab/config';
import { boxDensity, boxForDensity, interpolateIgnition, localExponent, type ScanPoint } from '../src/lab/ignitionScan';
import { mulberry32 } from '../src/lab/random';
import { parseCloudVariants } from '../src/lab/scenarios/baseline';
import { fillThermalGas, interiorCells, LAB_CELL } from '../src/lab/thermalGas';
import type { InitialState } from '../src/simulation/gpuModel';

describe('lab: ignition scan of thermal gases', () => {
    /** A power law rate = k T^alpha sampled at `temperatures`. */
    const powerLaw = (k: number, alpha: number, temperatures: readonly number[]): ScanPoint[] =>
        temperatures.map(temperature => ({ temperature, rate: k * temperature ** alpha }));

    it('interpolates the temperature of a rate exactly on a power law (log-log)', () => {
        const points = powerLaw(2e-3, 2.8, [0.4, 0.9, 1.9, 4, 9, 13]);
        const target = 0.1;
        expect(interpolateIgnition(points, target)).toBeCloseTo((target / 2e-3) ** (1 / 2.8), 9);
        const steep = powerLaw(1e-9, 16, [0.4, 0.9, 1.9, 4, 9, 13]);
        expect(interpolateIgnition(steep, 0.5)).toBeCloseTo((0.5 / 1e-9) ** (1 / 16), 9);
    });

    it('does not care about the order of the readings', () => {
        const points = powerLaw(1e-3, 3, [4, 0.4, 13, 1.9, 0.9]);
        expect(interpolateIgnition(points, 0.2)).toBeCloseTo(interpolateIgnition([...points].reverse(), 0.2)!, 12);
    });

    it('gives null when no pair of readings brackets the rate', () => {
        const points = powerLaw(1e-3, 3, [0.4, 0.9, 1.9]);
        expect(interpolateIgnition(points, 1e3)).toBeNull();           // above the scan
        expect(interpolateIgnition(points, 1e-9)).toBeNull();          // below it
        expect(interpolateIgnition([], 0.1)).toBeNull();
    });

    it('leaves out the readings at the cap of the rate and the readings of a rate of 0', () => {
        const points: ScanPoint[] = [
            { temperature: 1, rate: 0 }, { temperature: 2, rate: 0.01 }, { temperature: 4, rate: 1 },
            { temperature: 8, rate: PROTOSTAR_FUSION_RATE_MAX }, { temperature: 16, rate: PROTOSTAR_FUSION_RATE_MAX },
        ];
        // Between (2, 0.01) and (4, 1) the rate grows by 100 for a doubling: one decade is half of that, a factor of sqrt(2) in T.
        expect(interpolateIgnition(points, 0.1)).toBeCloseTo(2 * Math.SQRT2, 9);
        expect(interpolateIgnition(points, 50)).toBeNull();
    });

    it('measures the local exponent from the two nearest readings', () => {
        expect(localExponent(powerLaw(1e-3, 3, [0.4, 0.9, 1.9, 4]), 1.2)).toBeCloseTo(3, 9);
        expect(localExponent([{ temperature: 1, rate: 1 }], 1)).toBeNull();
    });

    it('sets up the densest uniform gas: all the mass in a square of the given density', () => {
        const box = boxForDensity(20);
        expect((box.x0 + box.x1) / 2).toBeCloseTo(LAB_AREA.width / 2, 9);
        expect((box.y0 + box.y1) / 2).toBeCloseTo(LAB_AREA.height / 2, 9);
        expect(boxDensity(box)).toBeCloseTo(20, 9);
        // The cloud's area over the box's: 20 times.
        const cloud = Math.PI * (PROTOSTAR_CLOUD_RADIUS * Math.min(LAB_AREA.width, LAB_AREA.height)) ** 2;
        expect(cloud / ((box.x1 - box.x0) * (box.y1 - box.y0))).toBeCloseTo(20, 9);
        // It leaves interior cells for the gas to be read in.
        const cells = interiorCells(box);
        expect((cells.x1 - cells.x0) * (cells.y1 - cells.y0)).toBeGreaterThanOrEqual(36);
        expect(LAB_CELL).toBe(8);
    });
});

describe('lab: thermal gas of several types', () => {
    const state = (count: number): InitialState => ({
        positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4), count, typeCounts: [count],
        width: 1024, height: 768, params: {},
    });

    it('gives the types the caller asks for, without changing the particles', () => {
        const box = { x0: 100, y0: 100, x1: 300, y1: 300 };
        const hydrogen = state(1001);
        const mixed = state(1001);
        fillThermalGas(hydrogen, box, 20, mulberry32(9));
        fillThermalGas(mixed, box, 20, mulberry32(9), [0, 0], i => i % 5 === 4 ? 1 : 0);
        let helium = 0;
        for (let i = 0; i < 1001; i++) {
            expect(hydrogen.positions[i * 4 + 2]).toBe(0);
            expect(mixed.positions[i * 4 + 2]).toBe(i % 5 === 4 ? 1 : 0);
            if (mixed.positions[i * 4 + 2] === 1) helium++;
            // The same places and velocities whatever the types.
            for (const k of [0, 1, 3]) expect(mixed.positions[i * 4 + k]).toBe(hydrogen.positions[i * 4 + k]);
            for (const k of [0, 1]) expect(mixed.velocities[i * 4 + k]).toBe(hydrogen.velocities[i * 4 + k]);
        }
        expect(helium).toBe(200);
    });
});

describe('lab: variants of the default cloud given in the page URL', () => {
    it('reads a JSON array of variants and ignores what is not valid', () => {
        const variants = parseCloudVariants(JSON.stringify([
            { name: 'A1 off', molecularWeight: false },
            { name: 'tuned', overrides: { gravity: 8, fusionRate: 0.006, junk: 'x' }, frames: 600.4, tau: 0.2 },
            'not an object', 3, null,
            {},
        ]));
        expect(variants).toHaveLength(3);
        expect(variants[0]).toMatchObject({ name: 'A1 off', molecularWeight: false, overrides: undefined });
        expect(variants[1]).toMatchObject({ name: 'tuned', overrides: { gravity: 8, fusionRate: 0.006 }, frames: 600, tau: 0.2, molecularWeight: undefined });
        expect(variants[2].name).toBe('variant 3');
    });

    it('gives no variant for text that is not a JSON array', () => {
        expect(parseCloudVariants('')).toEqual([]);
        expect(parseCloudVariants('{"a":1}')).toEqual([]);
        expect(parseCloudVariants('[not json')).toEqual([]);
    });
});
