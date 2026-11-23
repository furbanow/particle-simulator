// The collisions of the protostar's gas (proposal C1, the `collisions` flag), as pure functions: the TypeScript twin of the
// collision functions of protostar-common.glsl, the collision deposit (protostar-collision.vert) and the collision block of
// protostar-velocity.frag, which the tests and the lab check.
//
// Multiparticle collision dynamics (Malevanets & Kapral 1999; "stochastic rotation dynamics"). At every substep:
//  - the grid of the protostar's cells (cell a, GRID_RES of them over max(width, height)) is shifted by a random vector of [0, a)^2,
//    the same for every cell (Ihle & Kroll 2001: without the shift, a gas at rest and the same gas moving would not collide alike);
//    GRID_RES + 1 cells per axis cover the area whatever the shift;
//  - every particle is deposited into the cell that holds it (nearest grid point: the exact count n, sum v and sum |v|^2 of the cell's
//    particles, which give the cell's mean velocity u and its dispersion t = <|v - u|^2>);
//  - a cell collides with probability 1 - exp(-nu dt), nu = rate rho sqrt(t) (rho in rho0, t in T0: a collision frequency n sigma v
//    of hard bodies, the inverse of the mean free time), and then every velocity of the cell turns about the cell's mean,
//    v <- u + R(+-theta) (v - u), with one sign drawn per cell.
// The rotation keeps sum v and sum |v - u|^2 of the cell, so with particles of equal mass (the parcels of A4) the cell's mass,
// momentum and kinetic energy are conserved exactly. The gas relaxes to a Maxwell-Boltzmann distribution, its pressure becomes
// isotropic and it obeys the ideal gas law of a strictly planar gas: two degrees of freedom, gamma = 2, P = rho t / 2, sound speed
// sqrt(gamma P / rho) = sqrt(t). Mixed species reach the same dispersion (the same thermal energy per unit mass): the parcels all
// weigh the same, so this is equipartition per parcel, and the temperature of a cell, mu_mean / mu_H times its dispersion, is the
// temperature of the mixture in equilibrium (A1); what is lost is the sedimentation of the heavier ions.
//
// Where the collision happens in the scheme: at the start of substep n + 1 the state textures hold x(n+1) and v(n) (velocity Verlet
// on lagged storage, leapfrog.ts), exactly the state after the drift of substep n. The model deposits that state with the other grids
// (beforeSubstep) and the velocity pass turns v(n) before its kicks; the position pass turns it the same way for the drift. A
// collision "after Verlet" in the same pass, with no pass of its own over the particle textures.
//
// The cell's random numbers: a PCG hash of the cell's index and of the substep's seed (cellRandom(), the twin of collisionRandom() in
// protostar-common.glsl), so the deposit, the velocity pass and the position pass agree on what every cell does without storing it.

import {
    PROTOSTAR_COLLISION_ANGLE, PROTOSTAR_COLLISION_MIN_PARTICLES, PROTOSTAR_COLLISION_RATE, PROTOSTAR_GAS_GAMMA, PROTOSTAR_GRID_RES,
} from '../../config';

/** Cells per axis of the shifted collision grid: one more than the grids, so that every shift of [0, cell) covers the area. */
export const COLLISION_GRID_RES = PROTOSTAR_GRID_RES + 1;

/** The random streams of a cell (the `stream` of cellRandom). */
export const COLLISION_STREAM = { collide: 0, sign: 1 } as const;

/** The salt that keeps the cells' random numbers apart from the particles' ones (random01() of protostar-common.glsl), which hash the same seed. */
export const COLLISION_SEED_SALT = 0x9e3779b9;

/** The PCG hash of protostar-common.glsl (pcgHash), on 32-bit unsigned integers. */
export function pcgHash(value: number): number {
    const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
    const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
    return ((word >>> 22) ^ word) >>> 0;
}

/** Uniform random number in [0, 1) of cell `cellIndex` (x + y COLLISION_GRID_RES) for `stream`, at the substep of seed `seed`. */
export function cellRandom(cellIndex: number, seed: number, stream: number): number {
    const salted = pcgHash((seed ^ COLLISION_SEED_SALT) >>> 0);
    return pcgHash((Math.imul(cellIndex, 4) + stream + salted) >>> 0) / 4294967296;
}

/** The shift of the collision grid at the substep of seed `seed`, px: a vector of [0, cell)^2 (set on the CPU, a uniform of the passes). */
export function collisionShift(seed: number, cell: number): [number, number] {
    // Two values of the hash of the seed (the cells' indices are below COLLISION_GRID_RES^2: these two are beyond them).
    const base = COLLISION_GRID_RES * COLLISION_GRID_RES;
    return [cellRandom(base, seed, 2) * cell, cellRandom(base, seed, 3) * cell];
}

/** The cell of the shifted grid that holds (x, y), as (column, row) clamped to the grid. */
export function collisionCell(x: number, y: number, shift: readonly [number, number], cell: number): [number, number] {
    const last = COLLISION_GRID_RES - 1;
    return [
        Math.min(last, Math.max(0, Math.floor((x + shift[0]) / cell))),
        Math.min(last, Math.max(0, Math.floor((y + shift[1]) / cell))),
    ];
}

/** Collision frequency (1/s) of a cell of density `density` (rho0) and dispersion `dispersion` (T0): rate rho sqrt(t). */
export const collisionFrequency = (density: number, dispersion: number, rate = PROTOSTAR_COLLISION_RATE): number =>
    rate * density * Math.sqrt(Math.max(dispersion, 0));

/** The probability that a cell collides during a step of `dt` seconds: 1 - exp(-nu dt). */
export const collisionProbability = (density: number, dispersion: number, dt: number, rate = PROTOSTAR_COLLISION_RATE): number =>
    -Math.expm1(-collisionFrequency(density, dispersion, rate) * dt);

/** The sound speed of the gas of dispersion `dispersion` (px^2/s^2, or any unit squared): sqrt(gamma P / rho) with P / rho = t / 2. */
export const soundSpeed = (dispersion: number, gamma = PROTOSTAR_GAS_GAMMA): number => Math.sqrt(gamma * dispersion / 2);

/** The sums of one cell of the collision deposit: what protostar-collision.vert adds up (count n, sum v, sum |v|^2). */
export interface CellSums {
    count: number;
    vx: number;
    vy: number;
    v2: number;
}

/** What a cell does at a substep. */
export interface CellCollision {
    /** Mean velocity of the cell. */
    ux: number;
    uy: number;
    /** Dispersion <|v - u|^2> of the cell (0 for fewer than two particles). */
    dispersion: number;
    /** -1 or +1: the sign of the rotation; 0 when the cell does not collide. */
    sign: number;
}

/** The scales of a collision step. */
export interface CollisionScales {
    /** Cell size, px. */
    cell: number;
    /** rho / rho0 per particle in a cell (one particle's mass over the cell's area, in rho0). */
    densityPerParticle: number;
    /** T0, px^2/s^2 (the dispersion's unit in the frequency). */
    t0: number;
    /** Collision frequency at rho0 and T0, 1/s (PROTOSTAR_COLLISION_RATE). */
    rate: number;
    /** The rotation's angle, rad (PROTOSTAR_COLLISION_ANGLE). */
    angle: number;
}

export const defaultCollisionScales = (cell: number, densityPerParticle: number, t0: number): CollisionScales => ({
    cell, densityPerParticle, t0, rate: PROTOSTAR_COLLISION_RATE, angle: PROTOSTAR_COLLISION_ANGLE,
});

/** What cell `cellIndex` with sums `sums` does in a step of `dt` at the substep of seed `seed` (collisionAt() of protostar-common.glsl). */
export function cellCollision(sums: CellSums, cellIndex: number, seed: number, dt: number, scales: CollisionScales): CellCollision {
    if (sums.count <= 0) return { ux: 0, uy: 0, dispersion: 0, sign: 0 };
    const ux = sums.vx / sums.count;
    const uy = sums.vy / sums.count;
    const dispersion = Math.max(sums.v2 / sums.count - ux * ux - uy * uy, 0);
    if (sums.count < PROTOSTAR_COLLISION_MIN_PARTICLES) return { ux, uy, dispersion, sign: 0 };
    const p = collisionProbability(sums.count * scales.densityPerParticle, dispersion / scales.t0, dt, scales.rate);
    if (!(cellRandom(cellIndex, seed, COLLISION_STREAM.collide) < p)) return { ux, uy, dispersion, sign: 0 };
    const sign = cellRandom(cellIndex, seed, COLLISION_STREAM.sign) < 0.5 ? -1 : 1;
    return { ux, uy, dispersion, sign };
}

/** v turned about the cell's mean by the cell's rotation (unchanged when it does not collide). */
export function collide(vx: number, vy: number, c: CellCollision, angle: number): [number, number] {
    if (c.sign === 0) return [vx, vy];
    const cos = Math.cos(angle);
    const sin = c.sign * Math.sin(angle);
    const wx = vx - c.ux;
    const wy = vy - c.uy;
    return [c.ux + cos * wx - sin * wy, c.uy + sin * wx + cos * wy];
}

/** Particles of a collision step: positions and velocities, px and px/s (x, y, vx, vy per particle). */
export interface ParticleArrays {
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    vx: ArrayLike<number>;
    vy: ArrayLike<number>;
}

/**
 * One collision step of `particles` on the CPU (the reference of the lab, and the tests): the deposit into the shifted cells, then
 * every particle turned about its cell's mean. Returns the new velocities and what each cell did, by cell index.
 */
export function collisionStep(particles: ParticleArrays, shift: readonly [number, number], seed: number, dt: number,
                              scales: CollisionScales): { vx: Float64Array; vy: Float64Array; cells: Map<number, CellCollision> } {
    const n = particles.x.length;
    const index = new Int32Array(n);
    const sums = new Map<number, CellSums>();
    for (let i = 0; i < n; i++) {
        const [cx, cy] = collisionCell(particles.x[i], particles.y[i], shift, scales.cell);
        const k = cx + cy * COLLISION_GRID_RES;
        index[i] = k;
        const s = sums.get(k) ?? { count: 0, vx: 0, vy: 0, v2: 0 };
        const vx = particles.vx[i], vy = particles.vy[i];
        s.count++;
        s.vx += vx;
        s.vy += vy;
        s.v2 += vx * vx + vy * vy;
        sums.set(k, s);
    }
    const cells = new Map<number, CellCollision>();
    for (const [k, s] of sums) cells.set(k, cellCollision(s, k, seed, dt, scales));
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const c = cells.get(index[i]);
        const [ax, ay] = c ? collide(particles.vx[i], particles.vy[i], c, scales.angle) : [particles.vx[i], particles.vy[i]];
        vx[i] = ax;
        vy[i] = ay;
    }
    return { vx, vy, cells };
}
