import { describe, expect, it } from 'vitest';
import { heatedVelocity, heatingEnergy } from '../src/simulation/protostar/heating';

/** Deterministic pseudo-random numbers (mulberry32). */
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

/** n particles with Gaussian velocities of deviation sigma per component around `bulk`. */
function gas(n: number, sigma: number, bulk: [number, number], random: () => number): [number, number][] {
    return Array.from({ length: n }, () => {
        const r = Math.sqrt(-2 * Math.log(1 - random()));
        const a = 2 * Math.PI * random();
        return [bulk[0] + sigma * r * Math.cos(a), bulk[1] + sigma * r * Math.sin(a)];
    });
}

const mean = (v: readonly (readonly [number, number])[]): [number, number] =>
    [v.reduce((s, x) => s + x[0], 0) / v.length, v.reduce((s, x) => s + x[1], 0) / v.length];
/** The dispersion of the neighborhood: the mean of |v - u|^2. */
const dispersion = (v: readonly (readonly [number, number])[], u: readonly [number, number]): number =>
    v.reduce((s, x) => s + (x[0] - u[0]) ** 2 + (x[1] - u[1]) ** 2, 0) / v.length;
const kinetic = (v: readonly (readonly [number, number])[]): number => v.reduce((s, x) => s + (x[0] ** 2 + x[1] ** 2) / 2, 0);

const FLOOR = 1e-3;

describe('fusion heating by scaling the deviations around the mean velocity', () => {
    it('adds exactly q dt of energy per unit mass to a neighborhood, and does not move its momentum', () => {
        const random = seeded(7);
        for (const [sigma, bulk, q, dt] of [[50, [0, 0], 3000, 1 / 60], [300, [120, -40], 1e5, 1 / 120], [2, [-5, 9], 0.3, 1 / 30]] as const) {
            const v = gas(400, sigma, [bulk[0], bulk[1]], random);
            const u = mean(v);
            const t = dispersion(v, u);
            const heated = v.map(x => heatedVelocity(x, u, t, q, dt, 1e12, FLOOR, 0));
            expect((kinetic(heated) - kinetic(v)) / (v.length * q * dt)).toBeCloseTo(1, 9);
            const [ux, uy] = mean(heated);
            expect(ux).toBeCloseTo(u[0], 9);
            expect(uy).toBeCloseTo(u[1], 9);
            // the dispersion grows by 2 q dt, no more and no less
            expect(dispersion(heated, u)).toBeCloseTo(t + 2 * q * dt, 8);
        }
    });

    it('is a scaling of the deviations: directions are kept, the mean velocity is a fixed point', () => {
        const [vx, vy] = heatedVelocity([13, 4], [3, 1], 50, 10, 0.1, 1e12, FLOOR, 1.2);
        const scale = Math.sqrt(1 + 2 * 10 * 0.1 / 50);
        expect(vx).toBeCloseTo(3 + 10 * scale, 12);
        expect(vy).toBeCloseTo(1 + 3 * scale, 12);
        expect(heatedVelocity([3, 1], [3, 1], 50, 10, 0.1, 1e12, FLOOR, 1.2)).toEqual([3, 1]);
    });

    it('adds no heating without a heating source', () => {
        expect(heatedVelocity([13, 4], [3, 1], 50, 0, 0.1, 1e12, FLOOR, 0)).toEqual([13, 4]);
        expect(heatedVelocity([13, 4], [3, 1], 50, -1, 0.1, 1e12, FLOOR, 0)).toEqual([13, 4]);
    });

    it('kicks a cold cell in a random direction with the same energy, in the frame of the mean velocity', () => {
        const q = 40, dt = 0.25;
        const u: [number, number] = [7, -2];
        for (const angle of [0, 1, 2.5, 4, 6]) {
            const [x, y] = heatedVelocity(u, u, 0, q, dt, 1e12, FLOOR, angle);
            expect(((x - u[0]) ** 2 + (y - u[1]) ** 2) / 2).toBeCloseTo(q * dt, 12);
            expect(Math.atan2(y - u[1], x - u[0])).toBeCloseTo(Math.atan2(Math.sin(angle), Math.cos(angle)), 12);
        }
        // a dispersion at or below the floor is cold, above it is scaled
        const cold = heatedVelocity([1, 0], [0, 0], FLOOR, q, dt, 1e12, FLOOR, 0);
        expect(cold[1]).toBeCloseTo(0, 12);
        expect(cold[0]).toBeCloseTo(1 + Math.sqrt(2 * q * dt), 12);
        const warm = heatedVelocity([1, 0], [0, 0], FLOOR * 1.01, q, dt, 1e12, FLOOR, 0);
        expect(warm[0]).toBeCloseTo(Math.sqrt(1 + 2 * q * dt / (FLOOR * 1.01)), 12);
    });

    it('bounds the energy added by the square of the speed limit, whatever q (it can be infinite on half-float grids)', () => {
        expect(heatingEnergy(Infinity, 0.1, 100)).toBe(100 * 100);
        expect(heatingEnergy(1, 0.1, 100)).toBeCloseTo(0.2, 12);
        const [x, y] = heatedVelocity([1, 0], [0, 0], 4, Infinity, 0.1, 100, FLOOR, 0);
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(Math.hypot(x, y)).toBeCloseTo(Math.sqrt(1e4 / 4 + 1), 6);
        const kick = heatedVelocity([1, 0], [0, 0], 0, Infinity, 0.1, 100, FLOOR, 0);
        expect(kick[0]).toBeCloseTo(1 + 100, 9);
    });
});
