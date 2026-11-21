// How the scenarios drive the real Simulation: algorithm and restart helpers, direct access to the
// model (the lab-only controls that bypass the sliders), stepping loops.

import { BASE_DT } from '../config';
import { defaultTypeCount, PARTICLE_COUNT_PARAM, type ParamValues } from '../simulation/algorithm';
import { ALGORITHMS, type AlgorithmId } from '../simulation/algorithms';
import { defaultParams } from '../simulation/params';
import { PROTOSTAR_PROPERTY, PROTOSTAR_STAT } from '../simulation/protostar/declaration';
import { ProtostarModel } from '../simulation/protostar/gpuModel';
import type { ProtostarGridTargets } from '../simulation/protostar/grids';
import { LAB_SEED, LAB_SYNC_EVERY } from './config';
import { withSeededRandom } from './random';
import type { LabContext } from './types';

export const protostarModel = (context: LabContext): ProtostarModel => {
    const model = context.simulation.debugPipeline.debugModel;
    if (!(model instanceof ProtostarModel)) throw new Error('The running algorithm is not the protostar');
    return model;
};

export const protostarGrids = (context: LabContext): ProtostarGridTargets => protostarModel(context).debugGridTargets;

/** Lab-only control: sets values on the GPU model directly, whatever the slider ranges (gravity >= 0.1, feedback >= 0.01, ...). */
function applyDirect(context: LabContext, overrides: ParamValues): void {
    const model = protostarModel(context);
    for (const [key, value] of Object.entries(overrides)) model.setParam(key, value);
}

export interface RunOptions {
    algorithm?: AlgorithmId;
    /** Particle count (a multiple of the slider step is not required). */
    count: number;
    /**
     * Protostar parameters that bypass the sliders' ranges and are set on the model itself. Simulation.reset() hands
     * the model the slider-validated values back, so they are set before (the initial cloud reads the gravity) and again after.
     */
    overrides?: ParamValues;
    /** Seed of Math.random for the restart (the cloud); LAB_SEED by default. */
    seed?: number;
    /**
     * Protostar population weights of the first types for this restart only (the cloud's composition: hydrogen, helium,
     * carbon...); the edited types get their weights back afterwards.
     */
    weights?: readonly number[];
}

/**
 * Restarts the simulation as the application does after a click on Start: the algorithm at its
 * default parameters and speed, a seeded cloud, `resize()` already done by the lab page.
 */
export async function restart(context: LabContext, options: RunOptions): Promise<void> {
    const { simulation } = context;
    const id = options.algorithm ?? 'protostar';
    const algorithm = ALGORITHMS[id];
    simulation.useAlgorithm(id);
    simulation.timeScale = algorithm.defaultSpeed ?? 1;
    simulation.paused = false;
    for (const [key, value] of Object.entries(defaultParams(algorithm))) simulation.setParam(key, value);
    simulation.setParam(PARTICLE_COUNT_PARAM, options.count);
    const overrides = options.overrides ?? {};
    const direct = id === 'protostar' && Object.keys(overrides).length > 0;
    if (direct) applyDirect(context, overrides);
    const weightKey = PROTOSTAR_PROPERTY.weight;
    const previousWeights = simulation.species.map(type => type.values[weightKey]);
    options.weights?.forEach((weight, k) => { if (k < simulation.species.length) simulation.species[k].values[weightKey] = weight; });
    try {
        await withSeededRandom(options.seed ?? LAB_SEED, () => simulation.reset(defaultTypeCount(algorithm.particleTypes)));
    } finally {
        if (options.weights) simulation.species.forEach((type, k) => { type.values[weightKey] = previousWeights[k]; });
    }
    if (direct) applyDirect(context, overrides);
}

/**
 * Builds the running algorithm's pipeline again (and the model with it: its grids are created
 * anew, which is what the half-float switch needs). Goes through the other algorithm and back, so
 * a restart() must follow.
 */
export function rebuildPipeline(context: LabContext): void {
    const { simulation } = context;
    const current = simulation.algorithmKey;
    simulation.useAlgorithm(current === 'protostar' ? 'stickyDust' : 'protostar');
    simulation.useAlgorithm(current);
}

export interface FrameLoop {
    /** What one frame does; Simulation.step() by default (a whole rendered frame for the timing probe). */
    step?(): void;
    /** Calls Simulation.endFrame() after each step, as the application does (stats reductions, periodic read-back). Off by default: see random.ts. */
    endFrame?: boolean;
    /** After each frame (1-based); may be asynchronous. */
    onFrame?(frame: number): void | Promise<void>;
}

/** Steps the simulation `frames` frames (the substeps of the current speed each), synchronizing with the GPU now and then. */
export async function runFrames(context: LabContext, frames: number, loop: FrameLoop = {}): Promise<void> {
    const { simulation, sync } = context;
    for (let frame = 1; frame <= frames; frame++) {
        if (loop.step) loop.step();
        else simulation.step();
        if (loop.endFrame) simulation.endFrame();
        if (loop.onFrame) await loop.onFrame(frame);
        if (frame % LAB_SYNC_EVERY === 0) await sync.wait(simulation.positionTexture);
    }
    await sync.wait(simulation.positionTexture);
}

/** Simulated seconds of one frame at the current speed. */
export const frameSeconds = (context: LabContext): number => BASE_DT * context.simulation.timeScale;

/** Substeps the simulation runs per frame at the current speed (as Simulation.step() computes them). */
export const substepsPerFrame = (context: LabContext): number => Math.max(1, Math.ceil(context.simulation.timeScale - 1e-6));

/** The model's own stats (smoothed fusion rate, ...), null while unknown. */
export function modelStats(context: LabContext): { coreTemperature: number | null; coreDensity: number | null; fusionRate: number | null } {
    const { simulation } = context;
    return {
        coreTemperature: simulation.stat(PROTOSTAR_STAT.coreTemperature),
        coreDensity: simulation.stat(PROTOSTAR_STAT.coreDensity),
        fusionRate: simulation.stat(PROTOSTAR_STAT.fusionRate),
    };
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
export const nextAnimationFrame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
