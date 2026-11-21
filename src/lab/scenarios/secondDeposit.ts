// Validation of the second deposit (the composition, attachment 1 of the moments target): the GPU grid against a
// CPU reference computed from the position texture read back, in float32 and in the forced
// half-float path. See docs/spikes/a1-second-deposit.md.

import * as THREE from 'three';
import { forceHalfFloatDeposit } from '../../simulation/protostar/grids';
import {
    DEPOSIT_ROUNDINGS, DEPOSIT_ROUNDOFF_FLOAT32, DEPOSIT_ROUNDOFF_HALF, DEPOSIT_WEIGHT_ERROR, DEPOSIT_WEIGHT_MARGIN,
    SECOND_DEPOSIT_FRAMES, SECOND_DEPOSIT_LOAD_FRAMES, SECOND_DEPOSIT_LOAD_PARTICLES, SECOND_DEPOSIT_MIN_OVERLAP,
    RATIO_MIN_MASS, SECOND_DEPOSIT_PARTICLES, SECOND_DEPOSIT_WEIGHTS,
} from '../config';
import { compareDeposit, ratioError, referenceDeposit, type ChannelComparison } from '../depositReference';
import { protostarGrids, protostarModel, rebuildPipeline, restart, runFrames } from '../driver';
import { extractChannel, significant } from '../numbers';
import { readAttachment, readPositions, readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const CHANNEL_NAMES = ['mOverMu', 'count', 'massSquared', 'spare'] as const;

interface PathReport {
    metrics: Record<string, JsonValue>;
    /** The deposit holds: every channel within its tolerance and the spare channel exactly 0. */
    ok: boolean;
    comparisons: ChannelComparison[];
}

/**
 * Restarts a cloud, steps it, deposits its current state again and compares the composition grid
 * with the CPU reference. Done in the path the grids currently deposit in.
 */
async function validateCurrentPath(context: LabContext, particles: number, frames: number, roundoff: number): Promise<PathReport> {
    const { renderer, simulation } = context;
    await restart(context, { count: particles, weights: SECOND_DEPOSIT_WEIGHTS });
    await runFrames(context, frames);
    const model = protostarModel(context);
    // The grids of the last substep were drawn from the positions before it: deposit the positions as they are now.
    model.beforeSubstep(0);
    const grids = protostarGrids(context);
    const count = simulation.activeCount;
    const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const gpu = await readAttachment(renderer, grids.moments, 1);
    const gpuMoments = await readTarget(renderer, grids.moments);
    const inputs = model.debugGrids.debugDepositInputs;
    const reference = referenceDeposit(positions, count, inputs, DEPOSIT_WEIGHT_MARGIN);
    const comparisons = compareDeposit(gpu, reference, { roundoff, roundings: DEPOSIT_ROUNDINGS, weightError: DEPOSIT_WEIGHT_ERROR });

    const types = new Set<number>();
    for (let i = 0; i < count; i++) if (positions[i * 4 + 3] >= 0) types.add(Math.round(positions[i * 4 + 2]));
    let occupied = 0;
    let busiest = 0;
    for (let cell = 0; cell < reference.contributions.length; cell++) {
        const n = reference.composition[cell * 4 + 1];
        if (n > 0) occupied++;
        if (n > busiest) busiest = n;
    }
    const metrics: Record<string, JsonValue> = {
        particles: count,
        frames,
        textureType: grids.moments.textures[1].type === THREE.FloatType ? 'float32' : 'halfFloat',
        typesPresent: types.size,
        depositedParticles: reference.deposited,
        occupiedCells: occupied,
        meanWeightPerOccupiedCell: significant(reference.deposited / Math.max(1, occupied), DIGITS),
        busiestCellWeight: significant(busiest, DIGITS),
        inverseMolecularWeight: inputs.inverseMolecularWeight.slice(0, 3).map(v => significant(v, DIGITS)),
        roundoff,
    };
    // What the gas pass will compute: the mean 1 / mu, the ratio of two channels of different attachments, cell by cell and over 3x3 sums.
    const ratio = (radius: number): number => ratioError(
        extractChannel(gpu, 0), extractChannel(gpuMoments, 0), extractChannel(reference.composition, 0), reference.mass,
        inputs.gridResolution, radius, RATIO_MIN_MASS);
    metrics.meanInverseMuMaxRelativeError = { cell: significant(ratio(0), DIGITS), neighborhood3x3: significant(ratio(1), DIGITS) };
    comparisons.forEach((c, i) => {
        metrics[CHANNEL_NAMES[i]] = {
            maxExcessOverTolerance: significant(c.maxExcess, DIGITS),
            maxRelativeError: significant(c.maxRelativeError, DIGITS),
            cellsOverTolerance: c.cellsOverTolerance,
            sumGpu: significant(c.sumGpu, 8),
            sumReference: significant(c.sumReference, 8),
        };
    });
    const ok = comparisons.every(c => c.maxExcess <= 1) && comparisons[3].sumGpu === 0;
    return { metrics, ok, comparisons };
}

/** Runs `body` with the grids depositing in half floats, whatever the device, then puts the default back. */
async function inHalfFloat<T>(context: LabContext, body: () => Promise<T>): Promise<T> {
    forceHalfFloatDeposit(true);
    try {
        rebuildPipeline(context);
        return await body();
    } finally {
        forceHalfFloatDeposit(false);
        rebuildPipeline(context);
    }
}

const worstExcess = (comparisons: ChannelComparison[]): number => Math.max(...comparisons.map(c => c.maxExcess));

/** Small cloud, several particles per cell, three types: the GPU deposit equals the CPU reference in both paths. */
export const secondDeposit: Scenario = {
    id: 'protostar.second-deposit',
    title: 'Protostar: second deposit (m/mu, count, m^2) against a CPU reference, float32 and half float',
    tags: ['protostar', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const full = await validateCurrentPath(context, SECOND_DEPOSIT_PARTICLES, SECOND_DEPOSIT_FRAMES, DEPOSIT_ROUNDOFF_FLOAT32);
        const half = await inHalfFloat(context, () =>
            validateCurrentPath(context, SECOND_DEPOSIT_PARTICLES, SECOND_DEPOSIT_FRAMES, DEPOSIT_ROUNDOFF_HALF));
        const expectedFull = context.floatBlend ? 'float32' : 'halfFloat';
        const pathsTaken = full.metrics.textureType === expectedFull && half.metrics.textureType === 'halfFloat';
        const overlap = Number(full.metrics.busiestCellWeight) >= SECOND_DEPOSIT_MIN_OVERLAP;
        const types = Number(full.metrics.typesPresent) >= SECOND_DEPOSIT_WEIGHTS.length;
        const ok = full.ok && half.ok && pathsTaken && overlap && types;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                float32Path: full.metrics, halfFloatPath: half.metrics,
                pathsTaken, overlapExercised: overlap, allTypesPresent: types,
            },
            details: `worst error over tolerance (must be <= 1): float32 ${worstExcess(full.comparisons).toPrecision(3)}, half float ${worstExcess(half.comparisons).toPrecision(3)}; `
                + `busiest cell holds a weight of ${String(full.metrics.busiestCellWeight)}, ${String(full.metrics.typesPresent)} types`
                + (ok ? '' : `; float32 ok: ${full.ok}, half ok: ${half.ok}, paths taken: ${pathsTaken}, overlap: ${overlap}, types: ${types}`),
        };
    },
};

/**
 * The same comparison on the baseline's 400 000-particle cloud once its core has formed: thousands of particles in a
 * cell. The float32 deposit must still hold; the half-float one is measured, not judged (its 11-bit mantissa cannot).
 */
export const secondDepositLoad: Scenario = {
    id: 'protostar.second-deposit-load',
    title: 'Protostar: second deposit under load (collapsed core), float32 and half float',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) {
            return { status: 'skip', metrics: {}, details: 'Software renderer: 400 000 particles would take too long.' };
        }
        const full = await validateCurrentPath(context, SECOND_DEPOSIT_LOAD_PARTICLES, SECOND_DEPOSIT_LOAD_FRAMES, DEPOSIT_ROUNDOFF_FLOAT32);
        const half = await inHalfFloat(context, () =>
            validateCurrentPath(context, SECOND_DEPOSIT_LOAD_PARTICLES, SECOND_DEPOSIT_LOAD_FRAMES, DEPOSIT_ROUNDOFF_HALF));
        const ok = full.ok && half.comparisons.every(c => Number.isFinite(c.sumGpu));
        const countShare = half.comparisons[1].sumGpu / half.comparisons[1].sumReference;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                float32Path: full.metrics, halfFloatPath: half.metrics,
                halfFloatCountSumOverReference: significant(countShare, DIGITS),
            },
            details: `float32 worst error over tolerance ${worstExcess(full.comparisons).toPrecision(3)} (must be <= 1); `
                + `half float keeps ${(countShare * 100).toFixed(2)} % of the particle count, busiest cell ${String(full.metrics.busiestCellWeight)} (float32 path)`,
        };
    },
};
