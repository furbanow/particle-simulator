import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONTACT_RANGE, ENERGY_SCALE, MOMENTUM_SCALE } from '../src/config';
import { mulberry32 } from '../src/lab/random';
import {
    agitation, agitationGlow, contactShare, kineticPressure, meanFlow, peculiarEnergy, pressureAgitationLimit, relax, smoothstep,
    stickingFrequency, stickingShare, type Moments, type MomentScales,
} from '../src/simulation/stickyDust/granular';

const half = (x: number): number => THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(x));

/** A texel of `n` equal grains of mass `m` with velocities `velocities`, as the deposit sums them, each addition rounded to a half float. */
function depositedTexel(velocities: readonly (readonly [number, number])[], m: number, about: readonly [number, number], scales: MomentScales): Moments {
    let mass = 0, px = 0, py = 0, e = 0;
    for (const [vx, vy] of velocities) {
        mass = half(mass + m);
        px = half(px + m * vx * scales.momentum);
        py = half(py + m * vy * scales.momentum);
        e = half(e + m * ((vx - about[0]) ** 2 + (vy - about[1]) ** 2) * scales.energy);
    }
    return { mass, momentumX: px, momentumY: py, energy: e };
}

/** Gaussian velocities of standard deviation `sigma` about the bulk velocity `bulk`. */
function flow(n: number, bulk: readonly [number, number], sigma: number, seed: number): [number, number][] {
    const random = mulberry32(seed);
    const normal = (): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    return Array.from({ length: n }, (): [number, number] => [bulk[0] + sigma * normal(), bulk[1] + sigma * normal()]);
}

const exactAgitation = (velocities: readonly (readonly [number, number])[]): number => {
    const n = velocities.length;
    const mx = velocities.reduce((s, v) => s + v[0], 0) / n, my = velocities.reduce((s, v) => s + v[1], 0) / n;
    return velocities.reduce((s, v) => s + (v[0] - mx) ** 2 + (v[1] - my) ** 2, 0) / n;
};

/** Least-squares line through the points. */
function straightLine(points: readonly (readonly [number, number])[]): { slope: number; intercept: number; r2: number } {
    const n = points.length;
    const mx = points.reduce((s, p) => s + p[0], 0) / n, my = points.reduce((s, p) => s + p[1], 0) / n;
    const sxx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    const sxy = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    const syy = points.reduce((s, p) => s + (p[1] - my) ** 2, 0);
    return { slope: sxy / sxx, intercept: my - sxy / sxx * mx, r2: sxy * sxy / (sxx * syy) };
}

const SCALES: MomentScales = { momentum: MOMENTUM_SCALE, energy: ENERGY_SCALE };

describe('granular dust: agitation from the moments of a texel', () => {
    it('is the variance of the velocities about their mean, T = <|v|^2> - |u|^2', () => {
        const velocities = flow(50, [20, -10], 30, 1);
        const exact = exactAgitation(velocities);
        const unrounded: Moments = {
            mass: 50 * 0.05,
            momentumX: velocities.reduce((s, v) => s + 0.05 * v[0] * SCALES.momentum, 0),
            momentumY: velocities.reduce((s, v) => s + 0.05 * v[1] * SCALES.momentum, 0),
            energy: velocities.reduce((s, v) => s + 0.05 * (v[0] ** 2 + v[1] ** 2) * SCALES.energy, 0),
        };
        expect(agitation(unrounded, [0, 0], SCALES)).toBeCloseTo(exact, 8);
        expect(meanFlow(unrounded, SCALES)[0]).toBeCloseTo(velocities.reduce((s, v) => s + v[0], 0) / 50, 10);
    });

    it('is 0 for an empty texel, for a single grain, and never negative', () => {
        expect(agitation({ mass: 0, momentumX: 1, momentumY: 1, energy: 1 }, [0, 0], SCALES)).toBe(0);
        const single = depositedTexel([[300, -200]], 0.05, [0, 0], SCALES);
        expect(agitation(single, [0, 0], SCALES)).toBeLessThan(0.5);
        expect(peculiarEnergy({ mass: 1, momentumX: 5, momentumY: 5, energy: 0 }, [0, 0], SCALES)).toBe(0);
    });

    it('survives half floats about a reference velocity where the plain energy loses it', () => {
        // A cold flow (agitation 30 px/s) at 800 px/s: the plain energy is 3e5 times the grain's mass, 30 times the agitation.
        const velocities = flow(400, [800, -500], 15, 7);
        const exact = exactAgitation(velocities);
        const bulk = meanFlow(depositedTexel(velocities, 0.05, [0, 0], SCALES), SCALES);
        const withReference = agitation(depositedTexel(velocities, 0.05, bulk, SCALES), bulk, SCALES);
        const without = agitation(depositedTexel(velocities, 0.05, [0, 0], SCALES), [0, 0], SCALES);
        expect(Math.abs(withReference - exact) / exact).toBeLessThan(0.1);
        expect(Math.abs(without - exact) / exact).toBeGreaterThan(0.3);
    });

    it('keeps the plain energy of the fastest grains inside the range of half floats', () => {
        // Two grains of mass 0.2 at the maximum speed relative to a zero reference, in a texel: 2 x 0.2 x (2 x 1500^2) x ENERGY_SCALE.
        expect(2 * 0.2 * 2 * 1500 ** 2 * ENERGY_SCALE).toBeLessThan(65504);
        expect(half(2 * 0.2 * 2 * 1500 ** 2 * ENERGY_SCALE)).toBeGreaterThan(0);
    });
});

describe('granular dust: Haff cooling', () => {
    /** Cools `n` grains with the discrete law of the shader, density `rho` felt by all, for `steps` steps of `dt`. */
    function cool(n: number, sigma: number, rate: number, rho: number, dt: number, steps: number): [number, number][] {
        let v = flow(n, [0, 0], sigma, 3);
        const mean = (axis: 0 | 1): number => v.reduce((s, w) => s + w[axis], 0) / n;
        const series: [number, number][] = [];
        for (let step = 0; step <= steps; step++) {
            const T = exactAgitation(v);
            series.push([step * dt, T]);
            const u: [number, number] = [mean(0), mean(1)];
            const nu = stickingFrequency(rate, rho, T);
            v = v.map(w => relax(w, u, 1, nu, dt));
        }
        return series;
    }

    it('makes 1 / sqrt(T) grow linearly in time and T fall as (1 + t / t0)^-2', () => {
        const series = cool(20000, 60, 0.015, 0.5, 0.0125, 1400);
        const fit = straightLine(series.map(([t, T]): [number, number] => [t, T ** -0.5]));
        expect(fit.r2).toBeGreaterThan(0.999);
        // T against (1 + t / t0): the exponent is the slope in log-log.
        const t0 = fit.intercept / fit.slope;
        const exponent = straightLine(series.map(([t, T]): [number, number] => [Math.log(1 + t / t0), Math.log(T)])).slope;
        expect(exponent).toBeCloseTo(-2, 1);
        // The slope of T^(-1/2) is rate x density: nu = rate rho sqrt(T) and dT/dt = -2 nu T.
        expect(fit.slope).toBeCloseTo(0.015 * 0.5, 3);
        expect(series[series.length - 1][1]).toBeLessThan(series[0][1] / 50);
    });

    it('does not cool without sticking, or across the bounce barrier', () => {
        const none = cool(2000, 60, 0, 1, 0.0125, 200);
        expect(none[none.length - 1][1]).toBeCloseTo(none[0][1], 6);
        const velocities = flow(1000, [0, 0], 60, 5);
        for (const v of velocities) {
            const speed = Math.hypot(v[0], v[1]);
            expect(stickingShare(speed, speed * 0.9)).toBe(0);
            expect(stickingShare(speed, speed * 3)).toBe(1);
        }
    });

    it('fades the sticking out between half the collision speed and all of it', () => {
        expect(stickingShare(100, 400)).toBe(1);
        expect(stickingShare(300, 400)).toBeCloseTo(0.5, 12);
        expect(stickingShare(400, 400)).toBe(0);
        expect(relax([10, 0], [0, 0], 1, 1000, 1)[0]).toBeCloseTo(0, 12);
        expect(relax([10, 0], [0, 0], 0, 1000, 1)[0]).toBe(10);
    });
});

describe('granular dust: pressure and glow', () => {
    it('acts only between the contact densities, and is P = rho T / 2 once in contact', () => {
        const [lo, hi] = CONTACT_RANGE;
        expect(contactShare(0.5 * lo * 30, 30)).toBe(0);
        expect(contactShare(hi * 30, 30)).toBe(1);
        const m: Moments = { mass: 60, momentumX: 0, momentumY: 0, energy: 60 * 400 * SCALES.energy };    // rho = 60, T = 400
        expect(peculiarEnergy(m, [0, 0], SCALES)).toBeCloseTo(60 * 400, 6);
        expect(kineticPressure(m, [0, 0], 30, Infinity, SCALES)).toBeCloseTo(0.5 * 60 * 400, 6);
        expect(kineticPressure({ ...m, mass: 2 }, [0, 0], 30, Infinity, SCALES)).toBe(0);
    });

    it('caps the agitation by what the grid can resolve in a step', () => {
        const limit = pressureAgitationLimit(1, 4, 0.0125);
        expect(limit).toBeCloseTo(2 * 320 ** 2, 6);
        const hot: Moments = { mass: 60, momentumX: 0, momentumY: 0, energy: 60 * 1e7 * SCALES.energy };
        expect(kineticPressure(hot, [0, 0], 30, limit, SCALES)).toBeCloseTo(0.5 * 60 * limit, 6);
    });

    it('glows with the agitation, not the speed', () => {
        expect(agitationGlow(0)).toBe(0);
        expect(agitationGlow(60 ** 2)).toBe(1);
        expect(agitationGlow(30 ** 2)).toBeGreaterThan(0.2);
        expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    });
});
