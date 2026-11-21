import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/simulation/protostar/drift';
import { bounceVelocity, mirror, substep, wallHit, type StoredState, type Walls } from '../src/simulation/protostar/leapfrog';

/** The order of convergence seen between two errors measured at a step and at half that step. */
const observedOrder = (coarse: number, fine: number): number => Math.log2(coarse / fine);

// ---- A Kepler orbit: the reference of what the protostar's time integration is meant to do ----

const MU = 1;
const kepler = (x: Vec2): Vec2 => {
    const r3 = Math.hypot(x.x, x.y) ** 3;
    return { x: -MU * x.x / r3, y: -MU * x.y / r3 };
};
const START: Vec2 = { x: 1, y: 0 };
const START_VELOCITY: Vec2 = { x: 0, y: 0.7 };
const orbitEnergy = (x: Vec2, v: Vec2): number => 0.5 * (v.x * v.x + v.y * v.y) - MU / Math.hypot(x.x, x.y);
const ENERGY = orbitEnergy(START, START_VELOCITY);
const PERIOD = 2 * Math.PI * Math.sqrt((MU / (-2 * ENERGY)) ** 3 / MU);

/** Runs the orbit for `periods` periods at PERIOD / `stepsPerPeriod`; the largest relative energy error (each v_n with the position it belongs to) and the end state. */
function runKepler(stepsPerPeriod: number, periods: number): { maxEnergyError: number; end: StoredState; positions: Vec2[] } {
    const dt = PERIOD / stepsPerPeriod;
    let state: StoredState = { position: START, velocity: START_VELOCITY, accel: { x: 0, y: 0 } };
    let maxEnergyError = 0;
    const positions: Vec2[] = [START];
    const steps = Math.round(periods * stepsPerPeriod);
    for (let n = 0; n < steps; n++) {
        const here = state.position;
        const { state: next, velocity } = substep(state, kepler, dt, null, n === 0);
        maxEnergyError = Math.max(maxEnergyError, Math.abs(orbitEnergy(here, velocity) - ENERGY) / Math.abs(ENERGY));
        state = next;
        positions.push(state.position);
    }
    return { maxEnergyError, end: state, positions };
}

describe('the protostar time integration (twin of the velocity and position passes)', () => {
    it('moves the particle by the Verlet recurrence x(n+1) = 2 x(n) - x(n-1) + a(n) dt^2', () => {
        const dt = PERIOD / 100;
        const { positions } = runKepler(100, 2);
        for (let n = 1; n + 1 < positions.length; n++) {
            const a = kepler(positions[n]);
            expect(positions[n + 1].x).toBeCloseTo(2 * positions[n].x - positions[n - 1].x + a.x * dt * dt, 10);
            expect(positions[n + 1].y).toBeCloseTo(2 * positions[n].y - positions[n - 1].y + a.y * dt * dt, 10);
        }
    });

    it('starts from the velocity at x_0 itself: no half kick is owed at the first substep', () => {
        const dt = 0.01;
        const a0 = kepler(START);
        const first = substep({ position: START, velocity: START_VELOCITY, accel: { x: 0, y: 0 } }, kepler, dt, null, true);
        expect(first.velocity).toEqual(START_VELOCITY);
        expect(first.state.position.x).toBeCloseTo(START.x + START_VELOCITY.x * dt + 0.5 * a0.x * dt * dt, 14);
        expect(first.state.position.y).toBeCloseTo(START.y + START_VELOCITY.y * dt + 0.5 * a0.y * dt * dt, 14);
        // the next substep completes the kick: v_1 = v_0 + (a_0 + a_1) dt / 2
        const second = substep(first.state, kepler, dt, null);
        const a1 = kepler(first.state.position);
        expect(second.velocity.x).toBeCloseTo(START_VELOCITY.x + 0.5 * (a0.x + a1.x) * dt, 14);
        expect(second.velocity.y).toBeCloseTo(START_VELOCITY.y + 0.5 * (a0.y + a1.y) * dt, 14);
    });

    it('is of the second order: the energy error of a Kepler orbit falls by 4 when the step is halved', () => {
        const errors = [100, 200, 400].map(steps => runKepler(steps, 10).maxEnergyError);
        for (let i = 0; i + 1 < errors.length; i++) {
            const order = observedOrder(errors[i], errors[i + 1]);
            expect(order).toBeGreaterThan(1.8);
            expect(order).toBeLessThan(2.2);
        }
    });

    it('does not drift: ten times more periods leave the energy error where it was', () => {
        const short = runKepler(100, 10).maxEnergyError;
        const long = runKepler(100, 100).maxEnergyError;
        expect(long).toBeLessThan(1.2 * short);
        expect(long).toBeLessThan(0.02);                 // 100 steps a period, an eccentric orbit: a few 1e-3
    });

    it('closes the orbit to the second order: the position after one period converges as dt^2', () => {
        const distance = (steps: number): number => {
            const { end } = runKepler(steps, 1);
            // the state holds the position one substep ahead of the velocity, which is of no matter here: the orbit is closed
            return Math.hypot(end.position.x - START.x, end.position.y - START.y);
        };
        const errors = [100, 200, 400].map(distance);
        for (let i = 0; i + 1 < errors.length; i++) expect(observedOrder(errors[i], errors[i + 1])).toBeGreaterThan(1.8);
    });
});

// ---- The walls ----

describe('the walls of the area', () => {
    it('mirrors a position that went through a wall, and holds one that went further than the area', () => {
        expect(mirror(-3, 100)).toBe(3);
        expect(mirror(104, 100)).toBe(96);
        expect(mirror(40, 100)).toBe(40);
        expect(mirror(-250, 100)).toBe(100);
        expect(mirror(450, 100)).toBe(0);
    });

    it('finds the instant of the bounce as a share of the step, and -1 when there is none', () => {
        expect(wallHit(2, -2, 100)).toBeCloseTo(0.5, 12);
        expect(wallHit(98, 102, 100)).toBeCloseTo(0.5, 12);
        expect(wallHit(10, 90, 100)).toBe(-1);
        expect(wallHit(0, -1, 100)).toBe(0);
        expect(wallHit(100, 101, 100)).toBe(0);
    });

    it('bounces a free particle as a mirror: the speed reversed and scaled by the restitution', () => {
        for (const hit of [0, 0.3, 1]) {
            expect(bounceVelocity(-40, 0, hit, 0.02, 1)).toBeCloseTo(40, 12);
            expect(bounceVelocity(-40, 0, hit, 0.02, 0.5)).toBeCloseTo(20, 12);
        }
    });

    // A particle in a harmonic well, pulled to the middle of a box it overshoots: it bounces on both walls for as long as the run lasts.
    const WALLS: Walls = { width: 100, height: 100, restitution: 1 };
    const well = (x: Vec2): Vec2 => ({ x: -(x.x - 50), y: 0 });
    const wellEnergy = (x: Vec2, v: Vec2): number => 0.5 * v.x * v.x + 0.5 * (x.x - 50) ** 2;

    /** The scheme as the shaders had it before phase P5a: the velocity v_n flipped alone, the position held on the wall. */
    function legacySubstep(state: StoredState, dt: number, first: boolean): { state: StoredState; velocity: Vec2 } {
        const a = well(state.position);
        const kick = first ? 0 : 0.5 * (state.accel.x + a.x) * dt;
        const v = state.velocity.x + kick;
        const next = state.position.x + v * dt + 0.5 * a.x * dt * dt;
        const stored = (next < 0 && v < 0) || (next > WALLS.width && v > 0) ? -v * WALLS.restitution : v;
        return {
            state: { position: { x: Math.min(Math.max(next, 0), WALLS.width), y: 50 }, velocity: { x: stored, y: 0 }, accel: a },
            velocity: { x: v, y: 0 },
        };
    }

    /** The relative energy of the well after `seconds` of bouncing, at the step dt, in the scheme given. */
    function bounceDrift(dt: number, seconds: number, speed: number, scheme: 'legacy' | 'new'): number {
        let state: StoredState = { position: { x: 50, y: 50 }, velocity: { x: speed, y: 0 }, accel: { x: 0, y: 0 } };
        const start = wellEnergy(state.position, state.velocity);
        let worst = 0;
        const steps = Math.round(seconds / dt);
        for (let n = 0; n < steps; n++) {
            const here = state.position;
            const result = scheme === 'new' ? substep(state, well, dt, WALLS, n === 0) : legacySubstep(state, dt, n === 0);
            const drift = (wellEnergy(here, result.velocity) - start) / start;
            if (Math.abs(drift) > Math.abs(worst)) worst = drift;
            state = result.state;
        }
        return worst;
    }

    it('gains energy at every bounce when only the velocity is flipped and the position clamped (the scheme before P5a)', () => {
        const drifts = [0.01, 0.005, 0.0025].map(dt => bounceDrift(dt, 60, 60, 'legacy'));
        for (const d of drifts) expect(d).toBeGreaterThan(0.05);
        // first order at best: halving the step does not divide the gain by 4
        expect(observedOrder(drifts[0], drifts[1])).toBeLessThan(1.8);
        expect(observedOrder(drifts[1], drifts[2])).toBeLessThan(1.8);
    });

    it('conserves the energy of a bouncing particle to the second order with the instant of the bounce taken into account', () => {
        const drifts = [0.02, 0.01, 0.005, 0.0025].map(dt => Math.abs(bounceDrift(dt, 300, 70, 'new')));
        for (let i = 0; i + 1 < drifts.length; i++) expect(observedOrder(drifts[i], drifts[i + 1])).toBeGreaterThan(1.7);
        expect(drifts[1]).toBeLessThan(0.01);
        const legacy = Math.abs(bounceDrift(0.01, 60, 60, 'legacy'));
        expect(legacy).toBeGreaterThan(20 * Math.abs(bounceDrift(0.01, 60, 60, 'new')));
    });

    it('keeps the particle inside the area, in both axes', () => {
        let state: StoredState = { position: { x: 3, y: 98 }, velocity: { x: -300, y: 400 }, accel: { x: 0, y: 0 } };
        for (let n = 0; n < 200; n++) {
            state = substep(state, () => ({ x: 0, y: 0 }), 0.05, { width: 100, height: 100, restitution: 0.5 }, n === 0).state;
            expect(state.position.x).toBeGreaterThanOrEqual(0);
            expect(state.position.x).toBeLessThanOrEqual(100);
            expect(state.position.y).toBeGreaterThanOrEqual(0);
            expect(state.position.y).toBeLessThanOrEqual(100);
        }
    });
});
