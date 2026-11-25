import { describe, expect, it } from 'vitest';
import {
    crossingTime, fitSoftening, halfMassRadius, maclaurinFallShare, maclaurinFreeFallTime, maclaurinRadiusAt, meanPosition, measureEnergies, radialProfile,
} from '../src/lab/initialReference';
import type { InitialState } from '../src/simulation/gpuModel';
import { buildDiscTable } from '../src/simulation/protostar/disc';
import { fillCloud } from '../src/simulation/protostar/initialConditions';

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

describe('lab: the collapse of the cold Maclaurin disc', () => {
    it('the free-fall time is the radial fall onto 3 pi M / 4 from rest at R', () => {
        const gm = 4000, radius = 300;
        // a'' = -(3 pi / 4) G M / a^2, a(0) = R, a'(0) = 0, integrated with small velocity Verlet steps until a = R / 2
        const mu = 0.75 * Math.PI * gm;
        let a = radius, v = 0, t = 0;
        const dt = 1e-5;
        let acceleration = -mu / (a * a);
        while (a > radius / 2) {
            v += 0.5 * acceleration * dt; a += v * dt; acceleration = -mu / (a * a); v += 0.5 * acceleration * dt; t += dt;
        }
        expect(t / maclaurinFreeFallTime(gm, radius)).toBeCloseTo(maclaurinFallShare(0.5), 4);
    });

    it('the fall share runs from 0 at rest to 1 at the center, and the radius at a share inverts it', () => {
        expect(maclaurinFallShare(1)).toBe(0);
        expect(maclaurinFallShare(0)).toBeCloseTo(1, 14);
        let previous = 0;
        for (const x of [0.9, 0.75, 0.5, 0.25, 0.1, 0.01]) {
            const share = maclaurinFallShare(x);
            expect(share).toBeGreaterThan(previous);
            previous = share;
            expect(maclaurinRadiusAt(share)).toBeCloseTo(x, 9);
        }
        expect(maclaurinRadiusAt(0)).toBe(1);
        expect(maclaurinRadiusAt(1)).toBe(0);
    });

    it('the formula of the plan: (pi / 2) sqrt(2 R^3 / (3 pi G M))', () => {
        expect(maclaurinFreeFallTime(1, 1)).toBeCloseTo(Math.PI / 2 * Math.sqrt(2 / (3 * Math.PI)), 14);
        expect(maclaurinFreeFallTime(4, 1) / maclaurinFreeFallTime(1, 1)).toBeCloseTo(0.5, 14);
        expect(maclaurinFreeFallTime(1, 2) / maclaurinFreeFallTime(1, 1)).toBeCloseTo(2 ** 1.5, 12);
    });

    it('the crossing time interpolates between readings, and is NaN for a level never reached', () => {
        const times = [0, 1, 2, 3], values = [1, 0.8, 0.4, 0.1];
        expect(crossingTime(times, values, 0.6)).toBeCloseTo(1.5, 12);
        expect(crossingTime(times, values, 0.05)).toBeNaN();
        expect(crossingTime(times, values, 2)).toBeNaN();
    });
});

describe('lab: what a grid\'s smoothing amounts to', () => {
    it('finds the softening at which the table of a disc matches a measured pull', () => {
        const build = (softening: number) => {
            const table = buildDiscTable({ radius: 1, gravity: 1, totalMass: 1, softening, profile: 'maclaurin', nodes: 64 });
            return (r: number) => table.pullAt(r);
        };
        const radii = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
        const measured = radii.map(build(0.03));
        const fit = fitSoftening(radii, measured, build, 0.002, 0.3);
        expect(fit.softening).toBeCloseTo(0.03, 3);
        expect(fit.rmsError).toBeLessThan(1e-4);
        // a measured pull 5 % short of the table's reads as a larger softening, never a smaller
        const weaker = fitSoftening(radii, measured.map(g => 0.95 * g), build, 0.002, 0.3);
        expect(weaker.softening).toBeGreaterThan(0.03);
    });
});

describe('lab: profiles and energies of a cloud measured on its particles', () => {
    const count = 30000, radius = 200, gravity = 3, totalMass = 1000;
    const state: InitialState = {
        positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4),
        count, typeCounts: [count], width: 800, height: 600, params: {},
    };
    const summary = fillCloud(state, {
        radius, gravity, totalMass, softening: 5, profile: 'uniform', virial: 0.8, rotation: 0.15, turbulence: 'white',
    }, seeded(7));
    const center = { x: 400, y: 300 };

    it('the center of mass and the half-mass radius of a uniform disc: R / sqrt(2)', () => {
        const mean = meanPosition(state.positions, count);
        expect(Math.hypot(mean.x - center.x, mean.y - center.y)).toBeLessThan(2.5);
        expect(halfMassRadius(state.positions, count, center)).toBeCloseTo(radius / Math.SQRT2, -0.5);
        expect(halfMassRadius(new Float32Array([0, 0, 0, 1, 3, 4, 0, 1]), 2, { x: 0, y: 0 })).toBe(2.5);
    });

    it('the profile of the velocity: the rotation is tangential and grows with the circular speed, the radial mean is nil', () => {
        const bins = radialProfile(state.positions, state.velocities, count, center, 10);
        expect(bins).toHaveLength(10);
        for (const bin of bins) {
            expect(bin.count).toBe(3000);
            expect(Math.abs(bin.radial)).toBeLessThan(0.05 * summary.dispersion * 3);
            expect(bin.tangential).toBeGreaterThan(0);
        }
        expect(bins[9].radius).toBeGreaterThan(bins[0].radius);
        const expected = summary.rotationFactor * summary.table.circularSpeedAt(bins[5].radius);
        expect(bins[5].tangential / expected).toBeCloseTo(1, 1);
    });

    it('the energies: the kinetic energy is alpha |U| / 2 and the rotation along the pattern is beta |U|', () => {
        const energies = measureEnergies(state.positions, state.velocities, count, center, totalMass, 30, r => summary.table.circularSpeedAt(r));
        expect(energies.kinetic / (0.4 * summary.potentialEnergy)).toBeCloseTo(1, 3);
        expect(energies.rotationPattern / (0.15 * summary.potentialEnergy)).toBeCloseTo(1, 3);
        // the rings also count the agitation's mean over each (1000 particles): a percent of the agitation's energy at most
        expect(energies.rotationRings / energies.rotationPattern).toBeGreaterThan(0.95);
        expect(energies.rotationRings / energies.rotationPattern).toBeLessThan(1.15);
    });
});
