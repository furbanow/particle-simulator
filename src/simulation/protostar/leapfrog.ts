// Pure twin of the protostar's time integration: what protostar-velocity.frag and protostar-position.frag
// do to one particle in one substep when cooling, heating and fusion are off. The shaders and this file
// must say the same thing; docs/spikes/p5a-integrator-order.md derives it and the tests (tests/leapfrog.test.ts)
// pin its order on a Kepler orbit and on a particle that bounces on the walls.
//
// The state textures hold, at the start of a substep that sees the positions x_n: the position x_n, the
// velocity v_(n-1) (it lags the position by one substep) and the acceleration a_(n-1). With
// a_n = a(x_n) from the grids drawn for x_n, one substep computes:
//
//     v_n       = v_(n-1) + (a_(n-1) + a_n) dt / 2         the second half kick of the last step and the first of this one
//     x_(n+1)   = x_n + v_n dt + a_n dt^2 / 2              the drift, from the same inputs
//     stored    = (x_(n+1), v_n, a_n)
//
// That is velocity Verlet: its positions obey x_(n+1) = 2 x_n - x_(n-1) + a_n dt^2, the same sequence as
// the kick-drift-kick leapfrog, with one force evaluation per substep.
//
// The time step may change between two substeps (the adaptive step of phase B5). The two half kicks of v_n
// belong to the step that ended at x_n, so they take that step's length `dtPrev`; the drift takes the length
// `dt` of the step that starts at x_n. Written as the one-step map (x_n, v_n) -> (x_(n+1), v_(n+1)) with
// the step h_n = dt, it is the velocity Verlet scheme with a step of any length at each step: second order
// for any sequence of steps, and symplectic as long as the sequence does not depend on the state.

import type { Vec2 } from './drift';

/** What the three state textures hold between two substeps. */
export interface StoredState {
    /** x_n, the position the next substep's force is evaluated at. */
    position: Vec2;
    /** v_(n-1): the velocity at the previous position. */
    velocity: Vec2;
    /** a_(n-1): the acceleration at the previous position. */
    accel: Vec2;
}

/** The reflecting walls of the area: [0, width] x [0, height], and the share of the normal speed they return. */
export interface Walls {
    width: number;
    height: number;
    restitution: number;
}

export interface SubstepResult {
    state: StoredState;
    /** v_n, the velocity that goes with the position the substep started from (before any bounce): the one the energy is measured with. */
    velocity: Vec2;
}

/** Position x reflected once about the walls 0 and `size` (the mirror image), then held inside for a particle that went further than that. */
export function mirror(x: number, size: number): number {
    const reflected = x < 0 ? -x : x > size ? 2 * size - x : x;
    return Math.min(Math.max(reflected, 0), size);
}

/**
 * The share of the step, from 0 to 1, at which a particle going from `x` (inside) to `next` reaches a wall of the axis [0, size],
 * or -1 when `next` is inside. The drift is taken as uniform: exact for the position, first order in dt for the instant.
 */
export function wallHit(x: number, next: number, size: number): number {
    if (next < 0) return Math.min(Math.max(x / (x - next), 0), 1);
    if (next > size) return Math.min(Math.max((size - x) / (next - x), 0), 1);
    return -1;
}

/**
 * The velocity the substep stores for an axis that bounced, given the velocity v_n, the acceleration a_n and the share `hit` of the
 * step at which the wall was reached. The particle reaches the wall with v_n + a_n hit dt, leaves it with `restitution` times that
 * reversed, and is pulled by the same acceleration for the rest of the step. The next substep adds its two half kicks (a_n and a_(n+1),
 * taken equal) to the velocity stored, so the stored one is -restitution (v_n + a_n hit dt) - a_n hit dt.
 */
export function bounceVelocity(v: number, a: number, hit: number, dt: number, restitution: number): number {
    return -restitution * (v + a * hit * dt) - a * hit * dt;
}

/**
 * One substep of length `dt`. `first` is the first substep of a run: the stored velocity is then the velocity at x_0 itself
 * (not at the position before it), and no half kick is owed. `dtPrev` is the length of the substep before this one (the
 * one whose second half kick is taken now); it equals `dt` as long as the time step does not change.
 *
 * A wall bounce is handled as an event of the step: the drifted position is reflected (the mirror image of where the step
 * ended), and the velocity stored is the one that makes the next substep's kicks give the speed the particle has after bouncing
 * at the instant it reaches the wall (`bounceVelocity`). Reflecting v_n alone and clamping the position, as the shaders did
 * before phase P5a, gave every bounce a systematic gain of energy of the first order in dt, about 1.5 u a dt with u the normal
 * speed and a the pull towards the inside: an extra inward speed a dt, and a position left on the wall instead of brought back
 * inside. Taking the bounce in the middle of the step (reflecting the half-step velocity) leaves a first-order error of either
 * sign, which averages out between particles; the instant of the bounce makes it second order. The velocity stored after a bounce
 * is exact whatever the next substep's length: the next substep's half kicks are over this substep's `dt` (their `dtPrev`).
 */
export function substep(
    state: StoredState, force: (x: Vec2) => Vec2, dt: number, walls: Walls | null, first = false, dtPrev = dt,
): SubstepResult {
    const { position, velocity, accel } = state;
    const a = force(position);
    const kickX = first ? 0 : 0.5 * (accel.x + a.x) * dtPrev;
    const kickY = first ? 0 : 0.5 * (accel.y + a.y) * dtPrev;
    const vx = velocity.x + kickX, vy = velocity.y + kickY;
    let nextX = position.x + vx * dt + 0.5 * a.x * dt * dt, nextY = position.y + vy * dt + 0.5 * a.y * dt * dt;
    let storedX = vx, storedY = vy;
    if (walls) {
        const hitX = wallHit(position.x, nextX, walls.width);
        const hitY = wallHit(position.y, nextY, walls.height);
        if (hitX >= 0) { storedX = bounceVelocity(vx, a.x, hitX, dt, walls.restitution); nextX = mirror(nextX, walls.width); }
        if (hitY >= 0) { storedY = bounceVelocity(vy, a.y, hitY, dt, walls.restitution); nextY = mirror(nextY, walls.height); }
    }
    return {
        state: { position: { x: nextX, y: nextY }, velocity: { x: storedX, y: storedY }, accel: a },
        velocity: { x: vx, y: vy },
    };
}
