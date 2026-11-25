import { describe, expect, it } from 'vitest';
import { PROTOSTAR_COLLISION_ANGLE } from '../src/config';
import {
    cellCollision, cellRandom, collide, collisionCell, collisionProbability, collisionShift, collisionStep, COLLISION_GRID_RES, pcgHash,
    soundSpeed, type CollisionScales,
} from '../src/simulation/protostar/collisions';
import { rightShockSpeed, sampleRiemann, starRegion, type GasState } from '../src/lab/riemann';
import { mulberry32 } from '../src/lab/random';
import { gaussianPair } from '../src/lab/thermalGas';

const CELL = 8;
/** Every cell collides (an enormous rate): the step is a pure rotation of every cell of two particles or more. */
const ALWAYS: CollisionScales = { cell: CELL, densityPerParticle: 1, t0: 1, rate: 1e12, angle: PROTOSTAR_COLLISION_ANGLE };

/** n particles uniform over `width` x `height` px with Gaussian velocities of `sigma` per component around `bulk`. */
function gas(n: number, random: () => number, sigma: number, width = 64, height = 64, bulk = [0, 0]) {
    const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        x[i] = random() * width;
        y[i] = random() * height;
        const [gx, gy] = gaussianPair(random(), random());
        vx[i] = bulk[0] + sigma * gx;
        vy[i] = bulk[1] + sigma * gy;
    }
    return { x, y, vx, vy };
}

const sum = (a: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const sumSquares = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i] + b[i] * b[i]; return s; };

describe('cell random numbers', () => {
    it('hash 32-bit unsigned integers deterministically', () => {
        for (const v of [0, 1, 12345, 0xffffffff, 2 ** 31]) {
            const h = pcgHash(v);
            expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
            expect(pcgHash(v)).toBe(h);
        }
        expect(pcgHash(1)).not.toBe(pcgHash(2));
    });

    it('are uniform over the cells and change with the seed and the stream', () => {
        const values: number[] = [];
        for (let k = 0; k < 10_000; k++) values.push(cellRandom(k, 77, 0));
        const mean = sum(values) / values.length;
        const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
        expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
        expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.003);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...values)).toBeLessThan(1);
        expect(cellRandom(5, 77, 0)).not.toBe(cellRandom(5, 78, 0));
        expect(cellRandom(5, 77, 0)).not.toBe(cellRandom(5, 77, 1));
    });

    it('shift the grid by a vector of [0, cell)^2 that changes every substep', () => {
        const shifts = Array.from({ length: 200 }, (_, seed) => collisionShift(seed + 1, CELL));
        for (const [sx, sy] of shifts) {
            expect(sx).toBeGreaterThanOrEqual(0);
            expect(sx).toBeLessThan(CELL);
            expect(sy).toBeGreaterThanOrEqual(0);
            expect(sy).toBeLessThan(CELL);
        }
        expect(Math.abs(sum(shifts.map(s => s[0])) / shifts.length - CELL / 2)).toBeLessThan(0.6);
        expect(new Set(shifts.map(s => s.join())).size).toBe(shifts.length);
    });
});

describe('collision cells', () => {
    it('take the cell that holds the shifted position, within GRID_RES + 1 cells', () => {
        expect(collisionCell(0, 0, [0, 0], CELL)).toEqual([0, 0]);
        expect(collisionCell(7.99, 8, [0, 0], CELL)).toEqual([0, 1]);
        expect(collisionCell(4, 4, [4, 3.9], CELL)).toEqual([1, 0]);
        const edge = (COLLISION_GRID_RES - 1) * CELL;
        expect(collisionCell(edge, edge, [CELL - 1e-9, CELL - 1e-9], CELL)).toEqual([COLLISION_GRID_RES - 1, COLLISION_GRID_RES - 1]);
    });

    it('collide with probability 1 - exp(-rate rho sqrt(t) dt), not below two particles', () => {
        expect(collisionProbability(2, 0.25, 0.01, 100)).toBeCloseTo(1 - Math.exp(-100 * 2 * 0.5 * 0.01), 12);
        expect(collisionProbability(0, 1, 1, 100)).toBe(0);
        const one = cellCollision({ count: 1, vx: 3, vy: 4, v2: 25 }, 0, 1, 1, ALWAYS);
        expect(one).toEqual({ ux: 3, uy: 4, dispersion: 0, sign: 0 });
        // Over many cells, the share that collides is the probability.
        const scales = { ...ALWAYS, rate: 1 };
        const p = collisionProbability(10, 1, 0.05, 1);
        let collided = 0;
        const cells = 20_000;
        for (let k = 0; k < cells; k++) if (cellCollision({ count: 10, vx: 0, vy: 0, v2: 10 }, k, 9, 0.05, scales).sign !== 0) collided++;
        expect(Math.abs(collided / cells - p)).toBeLessThan(4 * Math.sqrt(p * (1 - p) / cells));
    });

    it('turn the velocity about the mean by the angle, either way', () => {
        const c = { ux: 1, uy: 2, dispersion: 1, sign: 1 };
        const [x, y] = collide(2, 2, c, Math.PI / 2);
        expect(x).toBeCloseTo(1, 12);
        expect(y).toBeCloseTo(3, 12);
        const [x2, y2] = collide(2, 2, { ...c, sign: -1 }, Math.PI / 2);
        expect(x2).toBeCloseTo(1, 12);
        expect(y2).toBeCloseTo(1, 12);
        expect(collide(2, 2, { ...c, sign: 0 }, Math.PI / 2)).toEqual([2, 2]);
    });
});

describe('a collision step', () => {
    it('conserves the momentum and the kinetic energy of every cell and of the whole', () => {
        const random = mulberry32(3);
        const p = gas(20_000, random, 30, 64, 64, [12, -5]);
        const { vx, vy, cells } = collisionStep(p, [2.5, 6.1], 11, 0.01, ALWAYS);
        expect([...cells.values()].filter(c => c.sign !== 0).length).toBeGreaterThan(60);
        expect(sum(vx)).toBeCloseTo(sum(p.vx), 6);
        expect(sum(vy)).toBeCloseTo(sum(p.vy), 6);
        expect(sumSquares(vx, vy) / sumSquares(p.vx, p.vy) - 1).toBeLessThan(1e-12);
        // Cell by cell.
        const byCell = new Map<string, number[]>();
        for (let i = 0; i < vx.length; i++) {
            const key = collisionCell(p.x[i], p.y[i], [2.5, 6.1], CELL).join();
            const s = byCell.get(key) ?? [0, 0, 0, 0, 0, 0];
            s[0] += p.vx[i]; s[1] += p.vy[i]; s[2] += p.vx[i] ** 2 + p.vy[i] ** 2;
            s[3] += vx[i]; s[4] += vy[i]; s[5] += vx[i] ** 2 + vy[i] ** 2;
            byCell.set(key, s);
        }
        for (const s of byCell.values()) {
            expect(s[3]).toBeCloseTo(s[0], 8);
            expect(s[4]).toBeCloseTo(s[1], 8);
            expect(Math.abs(s[5] - s[2]) / s[2]).toBeLessThan(1e-12);
        }
    });

    it('leaves a cell that does not collide alone', () => {
        const p = gas(2_000, mulberry32(4), 10);
        const { vx, vy } = collisionStep(p, [0, 0], 1, 0.01, { ...ALWAYS, rate: 0 });
        expect([...vx]).toEqual([...p.vx]);
        expect([...vy]).toEqual([...p.vy]);
    });
});

/**
 * Repeated collisions of the particles, `perCell` of them per cell on average, whose positions are drawn anew before every step (a
 * stand-in for the streaming that mixes the cells in the simulation): the velocity distribution relaxes.
 */
function relax(vx: Float64Array, vy: Float64Array, steps: number, random: () => number, perCell: number): void {
    const n = vx.length;
    const side = Math.sqrt(n / perCell) * CELL;
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let s = 0; s < steps; s++) {
        for (let i = 0; i < n; i++) { x[i] = random() * side; y[i] = random() * side; }
        const out = collisionStep({ x, y, vx, vy }, [random() * CELL, random() * CELL], s + 1, 0.01, ALWAYS);
        vx.set(out.vx);
        vy.set(out.vy);
    }
}

/** Two species, even and odd indices, of dispersions 4 and 1. */
function twoSpecies(n: number, random: () => number): { vx: Float64Array; vy: Float64Array; ratio: () => number } {
    const vx = new Float64Array(n), vy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const [a, b] = gaussianPair(random(), random());
        const sigma = i % 2 === 0 ? 2 : 1;
        vx[i] = sigma * a;
        vy[i] = sigma * b;
    }
    const dispersionOf = (parity: number): number => {
        let s = 0;
        for (let i = parity; i < n; i += 2) s += vx[i] ** 2 + vy[i] ** 2;
        return s / (n / 2);
    };
    return { vx, vy, ratio: () => dispersionOf(0) / dispersionOf(1) };
}

describe('relaxation', () => {
    it('multiplies the anisotropy of the pressure by cos 2 theta per collision: +-90 degrees swaps Pxx and Pyy, 45 degrees evens them', () => {
        // The traceless part of the pressure tensor, ((Pxx - Pyy) / 2, Pxy), turns by 2 theta in a cell; with the sign drawn per cell
        // it is multiplied by cos 2 theta on average. At 90 degrees (the default: the smallest kinetic viscosity of the planar
        // rotation, which goes as 1 / sin^2 theta) the two normal pressures trade places at every collision, so the pressure is
        // isotropic over two substeps, far shorter than any sound period of the grid.
        const anisotropyAfter = (angle: number): number => {
            const random = mulberry32(5);
            const n = 20_000;
            const vx = new Float64Array(n), vy = new Float64Array(n);
            for (let i = 0; i < n; i++) { const [a, b] = gaussianPair(random(), random()); vx[i] = 40 * a; vy[i] = 10 * b; }
            const energy = sumSquares(vx, vy);
            const side = Math.sqrt(n / 100) * CELL;
            const x = Float64Array.from({ length: n }, () => random() * side), y = Float64Array.from({ length: n }, () => random() * side);
            const out = collisionStep({ x, y, vx, vy }, [0, 0], 1, 0.01, { ...ALWAYS, angle });
            expect(Math.abs(sumSquares(out.vx, out.vy) / energy - 1)).toBeLessThan(1e-12);
            const pxx = (v: ArrayLike<number>): number => sumSquares(v, new Float64Array(n)) / n;
            return (pxx(out.vx) - pxx(out.vy)) / (pxx(vx) - pxx(vy));
        };
        expect(anisotropyAfter(Math.PI / 2)).toBeCloseTo(-1, 1);
        expect(Math.abs(anisotropyAfter(Math.PI / 4))).toBeLessThan(0.05);
        expect(anisotropyAfter(Math.PI / 3)).toBeCloseTo(Math.cos(2 * Math.PI / 3), 1);
    });

    it('turns speeds all alike into a Maxwell-Boltzmann distribution (Gaussian components)', () => {
        const random = mulberry32(6);
        const n = 40_000;
        const vx = new Float64Array(n), vy = new Float64Array(n);
        for (let i = 0; i < n; i++) { const a = random() * 2 * Math.PI; vx[i] = 20 * Math.cos(a); vy[i] = 20 * Math.sin(a); }
        // A ring of speeds has the kurtosis 1.5 per component; a Gaussian has 3.
        const kurtosis = (v: Float64Array): number => {
            const m2 = sum(v.map(a => a * a)) / v.length;
            return sum(v.map(a => a ** 4)) / v.length / (m2 * m2);
        };
        expect(kurtosis(vx)).toBeCloseTo(1.5, 1);
        relax(vx, vy, 15, random, 5);
        expect(Math.abs(kurtosis(vx) - 3)).toBeLessThan(0.1);
    });

    it('brings two species to the same dispersion (equipartition per parcel), conserving the energy', () => {
        const random = mulberry32(7);
        const { vx, vy, ratio } = twoSpecies(20_000, random);
        expect(ratio()).toBeCloseTo(4, 0);
        const energy = sumSquares(vx, vy);
        relax(vx, vy, 12, random, 5);
        expect(Math.abs(ratio() - 1)).toBeLessThan(0.04);
        expect(Math.abs(sumSquares(vx, vy) / energy - 1)).toBeLessThan(1e-9);
    });

    it('exchanges energy between particles about N / 4 times slower with N particles per cell', () => {
        // A rotation keeps every |v - u| of the cell: particles trade energy only through the change of the cell's mean from one
        // collision to the next, of order sigma / sqrt(N). The excess ratio - 1 falls by e in about N / 4 collisions (5.5 at N = 20,
        // 26 at N = 100, measured), where a pressure tensor becomes isotropic in one or two.
        const excessAfter = (perCell: number, steps: number): number => {
            const random = mulberry32(8);
            const { vx, vy, ratio } = twoSpecies(20_000, random);
            const before = ratio() - 1;
            relax(vx, vy, steps, random, perCell);
            return (ratio() - 1) / before;
        };
        const steps = 20;
        const e20 = excessAfter(20, steps), e100 = excessAfter(100, steps);
        expect(e20).toBeLessThan(Math.exp(-steps / (20 / 2)));
        expect(e20).toBeGreaterThan(Math.exp(-steps / (20 / 8)));
        expect(e100).toBeLessThan(Math.exp(-steps / (100 / 2)));
        expect(e100).toBeGreaterThan(Math.exp(-steps / (100 / 8)));
    });
});

describe('sound speed', () => {
    it('is sqrt(gamma P / rho), P / rho = t / 2: sqrt(t) for the planar gas', () => {
        expect(soundSpeed(9)).toBeCloseTo(3, 12);
        expect(soundSpeed(9, 5 / 3)).toBeCloseTo(Math.sqrt(7.5), 12);
    });
});

describe('the exact Riemann solver', () => {
    const sodLeft: GasState = { rho: 1, u: 0, p: 1 };
    const sodRight: GasState = { rho: 0.125, u: 0, p: 0.1 };

    it('gives Toro\'s star region of Sod\'s problem (test 1, gamma = 1.4)', () => {
        const star = starRegion(sodLeft, sodRight, 1.4);
        expect(star.p).toBeCloseTo(0.30313, 5);
        expect(star.u).toBeCloseTo(0.92745, 5);
        expect(star.rhoLeft).toBeCloseTo(0.42632, 5);
        expect(star.rhoRight).toBeCloseTo(0.26557, 5);
    });

    it('gives Toro\'s two rarefactions (test 2, the "123" problem)', () => {
        const star = starRegion({ rho: 1, u: -2, p: 0.4 }, { rho: 1, u: 2, p: 0.4 }, 1.4);
        expect(star.p).toBeCloseTo(0.00189, 5);
        expect(star.u).toBeCloseTo(0, 8);
        expect(star.rhoLeft).toBeCloseTo(0.02185, 5);
    });

    it('conserves mass, momentum and energy between the waves for gamma = 2', () => {
        const gamma = 2;
        const half = 3;
        const steps = 60_000;
        let mass = 0, momentum = 0, energy = 0;
        const star = starRegion(sodLeft, sodRight, gamma);
        for (let i = 0; i < steps; i++) {
            const xi = -half + (i + 0.5) * (2 * half / steps);
            const s = sampleRiemann(sodLeft, sodRight, gamma, xi, star);
            const dx = 2 * half / steps;
            mass += s.rho * dx;
            momentum += s.rho * s.u * dx;
            energy += (s.p / (gamma - 1) + 0.5 * s.rho * s.u * s.u) * dx;
        }
        const e0 = (state: GasState) => state.p / (gamma - 1);
        // At t = 1 the domain [-3, 3] still holds every wave: its mass and energy are the initial ones, its momentum grew by p_L - p_R.
        expect(mass).toBeCloseTo(half * (sodLeft.rho + sodRight.rho), 4);
        expect(energy).toBeCloseTo(half * (e0(sodLeft) + e0(sodRight)), 4);
        expect(momentum).toBeCloseTo(sodLeft.p - sodRight.p, 4);
        expect(rightShockSpeed(sodLeft, sodRight, gamma, star)).toBeGreaterThan(star.u);
    });
});

describe('the lab\'s fits', () => {
    it('find the frequency and the damping of a noisy damped cosine', async () => {
        const { fitDampedCosine, eFoldingTime } = await import('../src/lab/oscillation');
        const random = mulberry32(9);
        const times = Array.from({ length: 200 }, (_, i) => i * 0.035);
        const values = times.map(t => 0.05 * Math.exp(-0.2 * t) * Math.cos(2.1 * t + 0.3) + 0.001 + 0.002 * (random() - 0.5));
        const fit = fitDampedCosine(times, values, [0.5, 6], 2);
        expect(fit.omega).toBeCloseTo(2.1, 2);
        expect(fit.beta).toBeCloseTo(0.2, 1);
        expect(fit.amplitude).toBeCloseTo(0.05, 2);
        expect(fit.residual).toBeLessThan(0.1);
        expect(eFoldingTime([0, 1, 2, 3], [8, 4, 2, 1])).toBeCloseTo(1 / Math.LN2, 9);
        expect(eFoldingTime([0, 1], [1, 2])).toBeNull();
        expect(eFoldingTime([0, 1, 2, 3, 4], [8, 4, 2, 0.5, 0.6], 1)).toBeCloseTo(1 / Math.LN2, 9);
    });
});

describe('the shock tube profiles', () => {
    it('are null for the exact solution sampled at the column centers, and grow for another gamma', async () => {
        const { profileErrors } = await import('../src/lab/shockTube');
        const left: GasState = { rho: 1, u: 0, p: 1 }, right: GasState = { rho: 0.125, u: 0, p: 0.1 };
        const units = { leftCount: 1000, sigma: 60, x0: 512, seconds: 2, binWidth: 16 };
        const profile = Array.from({ length: 64 }, (_, b) => sampleRiemann(left, right, 2, ((b + 0.5) * 16 - 512) / (2 * 60)));
        const same = profileErrors(profile, left, right, 2, units, 2, 62);
        expect(same.rho + same.u + same.p).toBeLessThan(1e-12);
        expect(profileErrors(profile, left, right, 1.4, units, 2, 62).rho).toBeGreaterThan(0.01);
    });

    it('add up particles into columns with their mean velocity and dispersions', async () => {
        const { columnProfiles } = await import('../src/lab/shockTube');
        const positions = [1, 0, 0, 0, 3, 0, 0, 0, 9, 0, 0, 0];
        const velocities = [1, 2, 0, 0, 3, -2, 0, 0, 5, 5, 0, 0];
        const p = columnProfiles(positions, velocities, 3, 10, 2);
        expect(p.count).toEqual([2, 1]);
        expect(p.ux).toEqual([2, 5]);
        expect(p.pxx[0]).toBeCloseTo(1, 12);
        expect(p.pyy[0]).toBeCloseTo(4, 12);
        expect(p.pxx[1]).toBe(0);
    });
});
