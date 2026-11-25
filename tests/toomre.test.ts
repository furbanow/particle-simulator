import { describe, expect, it } from 'vitest';
import type { InitialState } from '../src/simulation/gpuModel';
import { surfaceDensity } from '../src/simulation/protostar/disc';
import { fillCloud } from '../src/simulation/protostar/initialConditions';
import { epicyclicFrequency, measureToomre, STELLAR_TOOMRE, toomreQ } from '../src/simulation/protostar/toomre';

function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('Toomre\'s Q', () => {
    it('is kappa sigma / (3.36 G Sigma), infinite where there is no mass', () => {
        expect(STELLAR_TOOMRE).toBe(3.36);
        expect(toomreQ(2, 3, 0.5, 4)).toBeCloseTo(2 * 3 / (3.36 * 4 * 0.5), 12);
        expect(toomreQ(2, 3, 0, 4)).toBe(Infinity);
    });

    it('the epicyclic frequency of a flat rotation curve is sqrt(2) times the angular frequency; of solid rotation, twice', () => {
        expect(epicyclicFrequency(() => 10, 5)).toBeCloseTo(Math.SQRT2 * 10 / 5, 6);
        expect(epicyclicFrequency(r => 3 * r, 5)).toBeCloseTo(2 * 3, 6);
        expect(epicyclicFrequency(r => 2 / Math.sqrt(r), 5)).toBeCloseTo(2 / 5 ** 1.5, 6);       // Kepler: kappa = Omega
    });

    it('measured on the cloud as it is drawn, it follows the formula from the disc\'s rotation and the surface density', () => {
        const count = 120000, radius = 200, gravity = 3, totalMass = 1000;
        const state: InitialState = {
            positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4),
            count, typeCounts: [count], width: 800, height: 600, params: {},
        };
        const summary = fillCloud(state, {
            radius, gravity, totalMass, softening: 5, profile: 'uniform', virial: 0.6, rotation: 0.12, turbulence: 'white',
        }, seeded(2));
        const points = measureToomre(state.positions, state.velocities, count, { x: 400, y: 300 }, totalMass, gravity, 30);
        expect(points).toHaveLength(30);
        expect(Number.isNaN(points[0].q)).toBe(true);
        let compared = 0;
        for (const point of points.slice(4, 26)) {
            const speed = (r: number): number => summary.rotationFactor * summary.table.circularSpeedAt(r);
            const expected = toomreQ(epicyclicFrequency(speed, point.radius), summary.dispersion, surfaceDensity('uniform', radius, totalMass, point.radius), gravity);
            expect(point.sigma / summary.dispersion).toBeGreaterThan(0.97);
            expect(point.sigma / summary.dispersion).toBeLessThan(1.03);
            expect(point.q / expected).toBeGreaterThan(0.85);
            expect(point.q / expected).toBeLessThan(1.15);
            compared++;
        }
        expect(compared).toBe(22);
    });
});
