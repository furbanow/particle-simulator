import { describe, expect, it } from 'vitest';
import { PROTOSTAR_STABILITY_CAP } from '../src/config';
import { coolingLogRate, type RadiativeCooling } from '../src/simulation/protostar/cooling';
import {
    angularVelocity, cellCooling, cellToomre, isStabilityMapMode, stabilityMap, STABILITY_MAP_MODES, type StabilityScales,
} from '../src/simulation/protostar/stability';
import { STELLAR_TOOMRE } from '../src/simulation/protostar/toomre';

const RES = 64;
const CELL = 8;
const CENTER = { x: RES * CELL / 2, y: RES * CELL / 2 };
const COOLING: RadiativeCooling = { rate: 10, opacity: 20, floor: 0.05 };
const SCALES: StabilityScales = { cell: CELL, gravityDensity: 3, t0: 400, cooling: COOLING };

/** A gas grid of a disc of radius `radius` px, density `rho`, dispersion `t`, rotation speed `speed(r)` (counterclockwise) and mu. */
function disc(radius: number, rho: number, t: number, speed: (r: number) => number, mu = 1) {
    const gas = new Float32Array(RES * RES * 4), thermo = new Float32Array(RES * RES * 4);
    for (let j = 0; j < RES; j++) {
        for (let i = 0; i < RES; i++) {
            const dx = (i + 0.5) * CELL - CENTER.x, dy = (j + 0.5) * CELL - CENTER.y, r = Math.hypot(dx, dy);
            if (r > radius) continue;
            const k = (j * RES + i) * 4, v = r > 0 ? speed(r) / r : 0;
            gas.set([rho, t, -dy * v, dx * v], k);
            thermo.set([mu * t, 100, mu, 0], k);
        }
    }
    return { gas, thermo, resolution: RES };
}

const cellAt = (map: Float32Array, r: number, angle = 0.3) => {
    const i = Math.floor((CENTER.x + r * Math.cos(angle)) / CELL), j = Math.floor((CENTER.y + r * Math.sin(angle)) / CELL);
    const k = (j * RES + i) * 4;
    const dx = (i + 0.5) * CELL - CENTER.x, dy = (j + 0.5) * CELL - CENTER.y;
    return { q: map[k], beta: map[k + 1], rho: map[k + 2], kappa2: map[k + 3], r: Math.hypot(dx, dy) };
};

describe('the stability map (A12)', () => {
    it('lists its modes, off first', () => {
        expect(STABILITY_MAP_MODES[0]).toBe('off');
        expect(isStabilityMapMode('toomre')).toBe(true);
        expect(isStabilityMapMode('nope')).toBe(false);
        expect(isStabilityMapMode(3)).toBe(false);
    });

    it('the angular velocity is u_t / r, counterclockwise positive, with r^2 bounded below', () => {
        expect(angularVelocity(10, 0, 0, 30, 1)).toBeCloseTo(3, 12);
        expect(angularVelocity(0, 10, 30, 0, 1)).toBeCloseTo(-3, 12);
        expect(angularVelocity(0.1, 0, 0, 1, 4)).toBeCloseTo(0.1 / 4, 12);
    });

    it('Q is sigma kappa / (3.36 G Sigma) with sigma^2 = t / 2; 0 without epicyclic support, the cap without gas', () => {
        expect(cellToomre(2, 50, 9, 3)).toBeCloseTo(Math.sqrt(25) * 3 / (STELLAR_TOOMRE * 3 * 2), 12);
        expect(cellToomre(2, 50, -9, 3)).toBe(0);
        expect(cellToomre(0, 50, 9, 3)).toBe(PROTOSTAR_STABILITY_CAP);
    });

    it('beta is |Omega| over the rate of the thin-disc cooling; the cap where the gas does not cool', () => {
        const rate = coolingLogRate(2 * 100 / 400, 2, 1.5, COOLING);
        expect(cellCooling(1.5, 100, 2, -0.7, SCALES)).toBeCloseTo(0.7 / -rate, 9);
        expect(cellCooling(1.5, 10, 1, 0.7, SCALES)).toBe(PROTOSTAR_STABILITY_CAP);          // T = 0.025 T0, below the floor
        expect(cellCooling(1.5, 100, 1, 0.7, { ...SCALES, cooling: { ...COOLING, rate: 0 } })).toBe(PROTOSTAR_STABILITY_CAP);
    });

    it('a disc in solid rotation has kappa = 2 Omega in every cell, its edge included (one-sided differences are exact)', () => {
        const omega = 0.4, t = 60, rho = 1.2;
        const map = stabilityMap(disc(200, rho, t, r => omega * r), CENTER, SCALES);
        const expected = Math.sqrt(t / 2) * 2 * omega / (STELLAR_TOOMRE * SCALES.gravityDensity * rho);
        for (const r of [20, 80, 150, 196]) {
            const cell = cellAt(map, r);
            expect(cell.kappa2).toBeCloseTo(4 * omega * omega, 4);
            expect(cell.q).toBeCloseTo(expected, 4);
            expect(cell.rho).toBeCloseTo(rho, 6);
        }
    });

    it('a flat rotation curve gives kappa = sqrt(2) Omega, a Keplerian one kappa = Omega (to the finite differences)', () => {
        const flat = stabilityMap(disc(250, 1, 60, () => 40), CENTER, SCALES);
        const kepler = stabilityMap(disc(250, 1, 60, r => 400 / Math.sqrt(r)), CENTER, SCALES);
        for (const r of [60, 120, 200]) {
            const f = cellAt(flat, r), k = cellAt(kepler, r);
            const omegaFlat = 40 / f.r, omegaKepler = 400 / k.r ** 1.5;
            expect(Math.abs(Math.sqrt(f.kappa2) / (Math.SQRT2 * omegaFlat) - 1)).toBeLessThan(0.02);
            expect(Math.abs(Math.sqrt(k.kappa2) / omegaKepler - 1)).toBeLessThan(0.02);
        }
    });

    it('beta follows the cell\'s temperature mu t / T0 and its Omega', () => {
        const omega = 0.4, t = 200, mu = 2.65;
        const map = stabilityMap(disc(200, 2, t, r => omega * r, mu), CENTER, SCALES);
        const cell = cellAt(map, 100);
        expect(cell.beta).toBeCloseTo(omega / -coolingLogRate(mu * t / SCALES.t0, mu, 2, COOLING), 3);
    });

    it('cells without gas get the cap and no density; a counter-rotating shear has no epicyclic support (Q = 0)', () => {
        const map = stabilityMap(disc(100, 1, 60, r => 0.4 * r), CENTER, SCALES);
        const outside = cellAt(map, 220);
        expect(outside.q).toBe(PROTOSTAR_STABILITY_CAP);
        expect(outside.beta).toBe(PROTOSTAR_STABILITY_CAP);
        expect(outside.rho).toBe(0);
        // v = 1 / r^2: the angular momentum r v falls outwards, kappa^2 = (1 / r^3) d(r^2 v^2) / dr < 0.
        const unstable = stabilityMap(disc(250, 1, 60, r => 4000 / (r * r)), CENTER, SCALES);
        const cell = cellAt(unstable, 150);
        expect(cell.kappa2).toBeLessThan(0);
        expect(cell.q).toBe(0);
    });
});
