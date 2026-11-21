// The protostar's time integration on the GPU against its CPU twin (phase P5a): the velocity and position passes, one substep at a
// time, on a gas that fills the area (so that particles bounce on the walls), compared with `substep()` (leapfrog.ts) fed with the
// acceleration that the GPU's own acceleration pass stored. It checks the arithmetic of the scheme (the half kicks, the first step, the
// mirror and the stored velocity of a bounce); that the scheme is of the second order, and what the walls did to the energy, are
// the unit tests' and the energy scenarios'. See docs/spikes/p5a-integrator-order.md.

import { PROTOSTAR_RESTITUTION } from '../../config';
import type { Vec2 } from '../../simulation/protostar/drift';
import { substep, type StoredState } from '../../simulation/protostar/leapfrog';
import {
    CONSERVATIVE_OVERRIDES, INTEGRATION_MIN_BOUNCES, INTEGRATION_PARTICLES, INTEGRATION_POSITION_TOLERANCE, INTEGRATION_SIGMA,
    INTEGRATION_STEPS, INTEGRATION_VELOCITY_TOLERANCE, LAB_AREA,
} from '../config';
import { frameSeconds, protostarModel, restart } from '../driver';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readPositions } from '../readback';
import { gaussianPair } from '../thermalGas';
import type { JsonValue, Scenario, ScenarioOutcome } from '../types';

const SEED = 31415;
const ACCEL = 'textureAccel';

interface Particle { px: number; py: number; vx: number; vy: number; ax: number; ay: number; alive: boolean }

/** The first `count` particles of the three state textures. */
async function readState(context: Parameters<Scenario['run']>[0], count: number): Promise<Particle[]> {
    const pipeline = context.simulation.debugPipeline;
    const [positions, velocities, accel] = await Promise.all([
        readPositions(context.renderer, pipeline.debugPositionTarget, count),
        readPositions(context.renderer, pipeline.debugVelocityTarget, count),
        readPositions(context.renderer, pipeline.debugVariableTarget(ACCEL), count),
    ]);
    return Array.from({ length: count }, (_, i) => ({
        px: positions[i * 4], py: positions[i * 4 + 1], vx: velocities[i * 4], vy: velocities[i * 4 + 1],
        ax: accel[i * 4], ay: accel[i * 4 + 1], alive: positions[i * 4 + 3] >= 0,
    }));
}

export const integration: Scenario = {
    id: 'protostar.integration',
    title: 'The protostar integration step (velocity Verlet, first step, wall bounces) against its CPU twin, on the GPU\'s own accelerations',
    tags: ['protostar', 'energy', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { width, height } = LAB_AREA;
        const model = protostarModel(context);
        const random = mulberry32(SEED);
        model.debugInitialState = state => {
            for (let i = 0; i < state.count; i += 2) {
                const [gx, gy] = gaussianPair(random(), random());
                const [hx, hy] = gaussianPair(random(), random());
                const gas = [[gx, gy], [hx, hy]];
                for (let j = 0; j < 2 && i + j < state.count; j++) {
                    const k = i + j;
                    state.positions.set([random() * width, random() * height, 0, 1], k * 4);
                    state.velocities.set([INTEGRATION_SIGMA * gas[j][0], INTEGRATION_SIGMA * gas[j][1], 0, 0], k * 4);
                }
            }
        };
        try {
            // One substep a frame, of BASE_DT x 0.85 (the default speed halved).
            await restart(context, { count: INTEGRATION_PARTICLES, overrides: CONSERVATIVE_OVERRIDES, timeScale: 0.85 });
        } finally {
            model.debugInitialState = null;
        }
        const dt = frameSeconds(context);
        const restitution = model.velocityUniforms.restitution.value as number;
        const walls = { width, height, restitution };

        let previous = await readState(context, INTEGRATION_PARTICLES);
        const steps: Record<string, JsonValue>[] = [];
        let bounces = 0, mismatches = 0, worstPosition = 0, worstVelocity = 0;
        for (let s = 1; s <= INTEGRATION_STEPS; s++) {
            context.simulation.step();
            await context.sync.wait(context.simulation.positionTexture);
            const now = await readState(context, INTEGRATION_PARTICLES);
            let stepBounces = 0, stepPosition = 0, stepVelocity = 0, stepMismatches = 0;
            for (let i = 0; i < INTEGRATION_PARTICLES; i++) {
                const before = previous[i], after = now[i];
                if (!before.alive || !after.alive) continue;
                const state: StoredState = {
                    position: { x: before.px, y: before.py }, velocity: { x: before.vx, y: before.vy }, accel: { x: before.ax, y: before.ay },
                };
                const force = (): Vec2 => ({ x: after.ax, y: after.ay });         // the acceleration the pass stored for this step: a(x_n)
                const expected = substep(state, force, dt, walls, s === 1).state;
                // Where the step would end without the walls: outside the area is a bounce.
                const kick = s === 1 ? 0 : 0.5;
                const vx = before.vx + kick * (before.ax + after.ax) * dt, vy = before.vy + kick * (before.ay + after.ay) * dt;
                const nx = before.px + vx * dt + 0.5 * after.ax * dt * dt, ny = before.py + vy * dt + 0.5 * after.ay * dt * dt;
                if (nx < 0 || nx > width || ny < 0 || ny > height) stepBounces++;
                const positionError = Math.max(Math.abs(after.px - expected.position.x), Math.abs(after.py - expected.position.y));
                const velocityError = Math.max(Math.abs(after.vx - expected.velocity.x), Math.abs(after.vy - expected.velocity.y));
                stepPosition = Math.max(stepPosition, positionError);
                stepVelocity = Math.max(stepVelocity, velocityError);
                if (positionError > INTEGRATION_POSITION_TOLERANCE || velocityError > INTEGRATION_VELOCITY_TOLERANCE) stepMismatches++;
            }
            bounces += stepBounces;
            mismatches += stepMismatches;
            worstPosition = Math.max(worstPosition, stepPosition);
            worstVelocity = Math.max(worstVelocity, stepVelocity);
            steps.push({
                step: s, bounces: stepBounces, mismatches: stepMismatches,
                worstPositionError: significant(stepPosition, 3), worstVelocityError: significant(stepVelocity, 3),
            });
            previous = now;
        }
        const metrics: Record<string, JsonValue> = {
            particles: INTEGRATION_PARTICLES, dt: significant(dt, 5), restitution, bounces, mismatches,
            worstPositionErrorPx: significant(worstPosition, 3), worstVelocityErrorPxPerS: significant(worstVelocity, 3),
            positionTolerance: INTEGRATION_POSITION_TOLERANCE, velocityTolerance: INTEGRATION_VELOCITY_TOLERANCE, steps,
        };
        const details = `${INTEGRATION_STEPS} steps of ${INTEGRATION_PARTICLES} particles, ${bounces} bounces: worst error ${worstPosition.toExponential(1)} px, `
            + `${worstVelocity.toExponential(1)} px/s, ${mismatches} particles beyond the tolerances (${INTEGRATION_POSITION_TOLERANCE} px, ${INTEGRATION_VELOCITY_TOLERANCE} px/s); `
            + `walls return ${restitution} of the speed (the application's ${PROTOSTAR_RESTITUTION})`;
        if (bounces < INTEGRATION_MIN_BOUNCES) return { status: 'fail', metrics, details: `too few bounces to check anything (${bounces}); ${details}` };
        return { status: mismatches === 0 ? 'pass' : 'fail', metrics, details };
    },
};
