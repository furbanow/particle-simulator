import * as THREE from 'three';
import { forceHalfFloatDeposit } from '../../simulation/protostar/grids';
import { HALF_FLOAT_MASS_TOLERANCE, SELFTEST_FRAMES } from '../config';
import { protostarGrids, rebuildPipeline, restart, runFrames } from '../driver';
import { maxChannel, relativeDiff, sumChannel } from '../numbers';
import { readTarget } from '../readback';
import type { LabContext, Scenario, ScenarioOutcome } from '../types';

/** More particles per cell than the self-test, so that the 11-bit mantissa of the half floats is stressed. */
const PARTICLES = 100000;

interface Deposit {
    type: THREE.TextureDataType;
    moments: Float32Array;
    gas: Float32Array;
}

async function depositAfterRun(context: LabContext): Promise<Deposit> {
    await restart(context, { count: PARTICLES });
    await runFrames(context, SELFTEST_FRAMES);
    const grids = protostarGrids(context);
    return {
        type: grids.moments.texture.type,
        moments: await readTarget(context.renderer, grids.moments),
        gas: await readTarget(context.renderer, grids.gas),
    };
}

/** The deposit grids in half floats (the path of the GPUs without EXT_float_blend) against the float32 ones, same seed. */
export const halfFloatDeposit: Scenario = {
    id: 'protostar.half-float-deposit',
    title: 'Protostar: half-float deposit path against the float32 one',
    tags: ['protostar', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        if (!context.floatBlend) {
            return { status: 'skip', metrics: {}, details: 'This device has no EXT_float_blend: its grids already deposit in half floats.' };
        }
        const full = await depositAfterRun(context);
        forceHalfFloatDeposit(true);
        let half: Deposit;
        try {
            rebuildPipeline(context);
            half = await depositAfterRun(context);
        } finally {
            forceHalfFloatDeposit(false);
            rebuildPipeline(context);
        }
        let worstCell = 0;
        let cells = 0;
        for (let i = 0; i < full.moments.length; i += 4) {
            if (full.moments[i] <= 0) continue;
            cells++;
            worstCell = Math.max(worstCell, relativeDiff(half.moments[i], full.moments[i]));
        }
        const massFull = sumChannel(full.moments, 0);
        const massHalf = sumChannel(half.moments, 0);
        const massError = relativeDiff(massHalf, PARTICLES);
        const densityFull = maxChannel(full.gas, 0);
        const densityHalf = maxChannel(half.gas, 0);
        const forced = half.type === THREE.HalfFloatType && full.type === THREE.FloatType;
        const ok = forced && massError < HALF_FLOAT_MASS_TOLERANCE;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: PARTICLES,
                frames: SELFTEST_FRAMES,
                forcedPathTaken: forced,
                depositedMassFloat: massFull,
                depositedMassHalf: massHalf,
                depositedMassErrorHalf: massError,
                occupiedCells: cells,
                worstCellRelativeDifference: worstCell,
                maxDensityFloat: densityFull,
                maxDensityHalf: densityHalf,
                maxDensityRelativeDifference: relativeDiff(densityHalf, densityFull),
            },
            details: ok
                ? `half-float deposit holds the mass to ${massError.toExponential(2)} (worst cell ${worstCell.toExponential(2)})`
                : `forced path taken: ${forced}; mass error ${massError.toExponential(2)} (tolerance ${HALF_FLOAT_MASS_TOLERANCE})`,
        };
    },
};
