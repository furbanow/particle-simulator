// Cost of the second deposit (spike P0c): the same run timed with the composition on the second
// attachment of the moments pass and without it (the moments pass alone, as it was), alternated
// round after round inside one run so that the drift of the GPU clocks and of the cloud (its core
// forms) hits both alike. Two measurements: whole simulation frames, and the grid passes alone on
// a frozen state (a dense or a diffuse cloud costs the blending hardware differently).
// Only the synchronized figures mean anything, see docs/lab.md.

import {
    COST_CHUNK_FRAMES, COST_EARLY_FRAMES, COST_FROZEN_ROUNDS, COST_FROZEN_SUBSTEPS, COST_PARTICLES, COST_ROUNDS,
    PERF_WARMUP_FRAMES, PERF_WARMUP_MS,
} from '../config';
import { protostarModel, restart } from '../driver';
import { alternatingOrders, mean, quantile, significant } from '../numbers';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';
import { timeChunks, warmUp } from './perf';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);

type Mode = 'without' | 'with';
const MODES: readonly Mode[] = ['without', 'with'];
type Series = Record<Mode, number[]>;

/** Rounds of one timed chunk per mode, in alternating orders; `measure(mode)` returns ms. */
async function alternate(rounds: number, measure: (mode: Mode) => Promise<number>): Promise<Series> {
    const series: Series = { without: [], with: [] };
    for (const order of alternatingOrders(MODES, rounds)) {
        for (const mode of order) series[mode].push(await measure(mode));
    }
    return series;
}

interface Comparison {
    medianWithout: number;
    medianWith: number;
    /** Paired differences with - without, one per round (ms). */
    differences: number[];
    summary: Record<string, JsonValue>;
}

function compare(unit: string, series: Series): Comparison {
    const medianWithout = quantile(series.without, 0.5);
    const medianWith = quantile(series.with, 0.5);
    const differences = series.with.map((v, i) => v - series.without[i]);
    return {
        medianWithout, medianWith, differences,
        summary: {
            unit,
            medianWithout: round(medianWithout),
            medianWith: round(medianWith),
            medianDifference: round(quantile(differences, 0.5)),
            meanDifference: round(mean(differences)),
            minDifference: round(Math.min(...differences)),
            maxDifference: round(Math.max(...differences)),
            medianDifferenceOverWithout: round(quantile(differences, 0.5) / medianWithout),
            withoutChunks: series.without.map(round),
            withChunks: series.with.map(round),
            differencesPerRound: differences.map(round),
        },
    };
}

/** ms per grid update (all the grid passes of one substep) of a frozen state, with and without the composition. */
async function frozenGridCost(context: LabContext): Promise<Comparison> {
    const model = protostarModel(context);
    const grids = model.debugGrids;
    const texture = () => context.simulation.positionTexture;
    const chunk = async (mode: Mode): Promise<number> => {
        grids.compositionEnabled = mode === 'with';
        const start = performance.now();
        for (let i = 0; i < COST_FROZEN_SUBSTEPS; i++) model.beforeSubstep(0);
        await context.sync.wait(texture());
        return (performance.now() - start) / COST_FROZEN_SUBSTEPS;
    };
    try {
        // Warm-up: the GPU settles on this state's load (clocks included).
        const start = performance.now();
        do { await alternate(1, chunk); } while (performance.now() - start < PERF_WARMUP_MS);
        return compare('ms per substep (grid passes only)', await alternate(COST_FROZEN_ROUNDS, chunk));
    } finally {
        grids.compositionEnabled = true;
    }
}

export const secondDepositCost: Scenario = {
    id: 'cost.protostar.second-deposit',
    title: 'Cost of the second deposit: simulation ms/frame with and without it, alternated (400 000 particles)',
    tags: ['cost', 'slow', 'protostar'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) {
            return { status: 'skip', metrics: { valid: false }, details: `INVALID: software renderer (${context.rendererName}), timings are meaningless.` };
        }
        const { simulation } = context;
        let simulatedFrames = 0;
        const simulate = () => { simulation.step(); simulation.endFrame(); simulatedFrames++; };

        await restart(context, { count: COST_PARTICLES });
        // After the restart: before it, the running algorithm may be another one (the scenarios before this one).
        const grids = protostarModel(context).debugGrids;
        // The early state is a number of frames, not a duration: the cloud has not collapsed yet, whatever the machine's speed.
        await warmUp(context, simulate, COST_EARLY_FRAMES, COST_EARLY_FRAMES, 0);
        const framesAtEarly = simulatedFrames;
        const early = await frozenGridCost(context);
        await warmUp(context, simulate, COST_CHUNK_FRAMES, PERF_WARMUP_FRAMES, PERF_WARMUP_MS);
        const framesAtWholeFrames = simulatedFrames;

        let frames: Series;
        try {
            frames = await alternate(COST_ROUNDS, async mode => {
                grids.compositionEnabled = mode === 'with';
                return (await timeChunks(context, simulate, COST_CHUNK_FRAMES, 1))[0];
            });
        } finally {
            grids.compositionEnabled = true;
        }
        const whole = compare('ms per frame (simulation only)', frames);
        const late = await frozenGridCost(context);

        const substeps = Math.max(1, Math.ceil(simulation.timeScale - 1e-6));
        const median = (c: Comparison): number => quantile(c.differences, 0.5);
        const metrics: Record<string, JsonValue> = {
            valid: true,
            renderer: context.rendererName,
            particles: simulation.activeCount,
            substepsPerFrame: substeps,
            chunkFrames: COST_CHUNK_FRAMES,
            rounds: COST_ROUNDS,
            framesAtEarlyCloud: framesAtEarly,
            framesAtFirstTimedChunk: framesAtWholeFrames,
            framesAtLateCloud: simulatedFrames,
            simulationFrames: whole.summary,
            gridPassesEarlyCloud: early.summary,
            gridPassesLateCloud: late.summary,
        };
        return {
            status: 'pass',
            metrics,
            details: `simulation frame ${whole.medianWithout.toFixed(2)} ms without the second deposit, +${median(whole).toFixed(2)} ms with it `
                + `(${Math.min(...whole.differences).toFixed(2)} to ${Math.max(...whole.differences).toFixed(2)} over ${COST_ROUNDS} rounds); `
                + `grid passes alone: +${median(early).toFixed(3)} ms per substep on the early cloud, +${median(late).toFixed(3)} on the late one`,
        };
    },
};
