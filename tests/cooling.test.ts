import { describe, expect, it } from 'vitest';
import {
    columnDepth, cooledVelocity, coolingLogRate, coolingRatio, effectiveDepth, jeansCells, jeansDispersion, jeansPerDensity,
    type RadiativeCooling,
} from '../src/simulation/protostar/cooling';

const COOLING: RadiativeCooling = { rate: 40, opacity: 2, floor: 0 };

/** Integrates dT/dt = -c mu T^4 / (Sigma tau_eff) with small RK4 steps: the reference of the exact law. */
function integrate(temperature: number, mu: number, sigma: number, time: number, cooling: RadiativeCooling, steps = 400000): number {
    const k = cooling.rate * mu / columnDepth(sigma, cooling.opacity);
    const f = (t: number): number => -k * t ** 4;
    const h = time / steps;
    let t = temperature;
    for (let i = 0; i < steps; i++) {
        const a = f(t), b = f(t + h * a / 2), c = f(t + h * b / 2), d = f(t + h * c);
        t += h * (a + 2 * b + 2 * c + d) / 6;
    }
    return t;
}

describe('effective optical depth (Johnson & Gammie)', () => {
    it('joins the thick and the thin limits, with its minimum near tau = 0.8', () => {
        expect(effectiveDepth(1e4) / (3 * 1e4 / 8)).toBeCloseTo(1, 3);
        expect(effectiveDepth(1e-4) * 4e-4).toBeCloseTo(1, 3);
        const tauMin = Math.sqrt(2 / 3);
        expect(effectiveDepth(tauMin)).toBeLessThan(effectiveDepth(tauMin * 1.1));
        expect(effectiveDepth(tauMin)).toBeLessThan(effectiveDepth(tauMin / 1.1));
        expect(effectiveDepth(tauMin)).toBeCloseTo(Math.sqrt(3) / 4 + 2 * Math.sqrt(3 / 32), 10);
    });

    it('gives Sigma tau_eff finite at Sigma = 0 and infinite without opacity', () => {
        expect(columnDepth(3, 2)).toBeCloseTo(3 * effectiveDepth(3), 12);
        expect(columnDepth(0, 2)).toBeCloseTo(1 / 4, 12);
        expect(columnDepth(5, 0)).toBe(Infinity);
    });
});

describe('thin-disc cooling', () => {
    it('is the exact solution of the T^4 law', () => {
        for (const [temperature, mu, sigma, dt] of [[1, 1, 30, 0.01], [0.13, 1, 1, 0.5], [6.7, 2.65, 100, 0.02], [20, 3.4, 5, 0.3]]) {
            const reference = integrate(temperature, mu, sigma, dt, COOLING);
            expect(temperature * coolingRatio(temperature, mu, sigma, dt, COOLING) / reference).toBeCloseTo(1, 7);
        }
    });

    it('composes: two half steps make one step (the law is integrated, not stepped)', () => {
        const [t, mu, sigma, dt] = [3, 1, 10, 0.4];
        const half = coolingRatio(t, mu, sigma, dt / 2, COOLING);
        const twice = half * coolingRatio(t * half, mu, sigma, dt / 2, COOLING);
        expect(twice / coolingRatio(t, mu, sigma, dt, COOLING)).toBeCloseTo(1, 12);
    });

    it('is unconditionally stable: a stiff step lands between 0 and T, at the T^-1/3 tail', () => {
        const ratio = coolingRatio(50, 1, 1, 10, COOLING);
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(1e-2);
        const x = 3 * COOLING.rate * 50 ** 3 * 10 / columnDepth(1, COOLING.opacity);
        expect(ratio).toBeCloseTo(x ** (-1 / 3), 6);
    });

    it('stops at the floor and leaves a gas below it alone', () => {
        const cooling = { ...COOLING, floor: 0.5 };
        expect(2 * coolingRatio(2, 1, 1, 100, cooling)).toBeCloseTo(0.5, 12);
        expect(coolingRatio(0.4, 1, 1, 100, cooling)).toBe(1);
        expect(coolingRatio(0.5, 1, 1, 100, cooling)).toBe(1);
    });

    it('does nothing without rate, time, mass or opacity', () => {
        expect(coolingRatio(1, 1, 1, 0.1, { ...COOLING, rate: 0 })).toBe(1);
        expect(coolingRatio(1, 1, 1, 0, COOLING)).toBe(1);
        expect(coolingRatio(1, 1, 0, 0.1, COOLING)).toBe(1);
        expect(coolingRatio(1, 1, 1, 0.1, { ...COOLING, opacity: 0 })).toBe(1);
    });

    it('cools a heavier gas mu times faster at the same temperature', () => {
        const [t, sigma] = [2, 20];
        expect(coolingLogRate(t, 2.65, sigma, COOLING) / coolingLogRate(t, 1, sigma, COOLING)).toBeCloseTo(2.65, 12);
        expect(coolingLogRate(t, 1, sigma, COOLING)).toBeCloseTo(-COOLING.rate * t ** 3 / (sigma * effectiveDepth(COOLING.opacity * sigma / 2)), 12);
    });

    it('cools the dense opaque gas as T^4 / (kappa Sigma^2) and the thin gas whatever its density', () => {
        const thick = (s: number) => coolingLogRate(1, 1, s, COOLING);
        expect(thick(1000) / thick(2000)).toBeCloseTo(4, 2);
        const thin = { ...COOLING, opacity: 1e-4 };
        expect(coolingLogRate(1, 1, 1, thin) / coolingLogRate(1, 1, 10, thin)).toBeCloseTo(1, 2);
        expect(coolingLogRate(1, 1, 1, thin)).toBeCloseTo(-2 * thin.rate * thin.opacity, 4);
    });

    it('is a thermostat: the rate goes as T^3', () => {
        expect(coolingLogRate(2, 1, 30, COOLING) / coolingLogRate(1, 1, 30, COOLING)).toBeCloseTo(8, 12);
    });
});

describe('Jeans floor', () => {
    it('is 2 N_J dx G Sigma', () => {
        const perDensity = jeansPerDensity(4, 8, 3, 0.5);
        expect(perDensity).toBe(2 * 4 * 8 * 3 * 0.5);
        expect(jeansDispersion(10, perDensity)).toBe(10 * perDensity);
        expect(jeansDispersion(-1, perDensity)).toBe(0);
        expect(jeansCells(jeansDispersion(10, perDensity), 10, perDensity, 4)).toBeCloseTo(4, 12);
        expect(jeansCells(1, 0, perDensity, 4)).toBe(Infinity);
    });
});

describe('cooledVelocity (the twin of the shader)', () => {
    const u: [number, number] = [5, -3];
    const t0 = 100;

    it('scales the deviation by sqrt(T\' / T) and keeps the mean', () => {
        const r = cooledVelocity([8, 1], u, 50, 1, 20, 0.02, t0, COOLING, 0, 1e-3, 0);
        const ratio = coolingRatio(0.5, 1, 20, 0.02, COOLING);
        expect(r.t).toBeCloseTo(50 * ratio, 10);
        expect(r.v[0] - u[0]).toBeCloseTo(3 * Math.sqrt(ratio), 10);
        expect(r.v[1] - u[1]).toBeCloseTo(4 * Math.sqrt(ratio), 10);
    });

    it('raises a gas under the Jeans floor to it, after the cooling', () => {
        const perDensity = 1;
        const r = cooledVelocity([8, 1], u, 4, 1, 20, 0.02, t0, COOLING, perDensity, 1e-3, 0);
        expect(r.t).toBeCloseTo(20, 12);
        expect(Math.hypot(r.v[0] - u[0], r.v[1] - u[1])).toBeCloseTo(5 * Math.sqrt(20 / 4), 10);
    });

    it('kicks a cold gas to the floor in the given direction', () => {
        const r = cooledVelocity([5, -3], u, 0, 1, 20, 0.02, t0, COOLING, 1, 1e-3, Math.PI / 2);
        expect(r.t).toBe(20);
        expect(r.v[0]).toBeCloseTo(5, 10);
        expect(r.v[1]).toBeCloseTo(-3 + Math.sqrt(20), 10);
    });

    it('leaves a gas above the floor and without cooling alone', () => {
        const r = cooledVelocity([8, 1], u, 50, 1, 20, 0.02, t0, { ...COOLING, rate: 0 }, 1, 1e-3, 0);
        expect(r.v).toEqual([8, 1]);
        expect(r.t).toBe(50);
    });
});
