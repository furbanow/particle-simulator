// Cost of the energy diagnostics (phase P1a), the figure that decides the default of the `diagnostics`
// flag. The extra work has three parts: the potential channel of the gravity pass (always drawn: a
// uniform branch inside the near-field loops would cost more than the sum it saves), the wider
// reduction (every 10 frames, with or without the flag), and what only the flag runs: the potential
// kept before each reading, the first-frame reading and the energy bookkeeping.
//
// Three modes, alternated chunk after chunk (and in every order) inside one run, so that the drift of
// the GPU clocks and of the cloud (its core forms) hits all of them alike:
//  - plain:    no potential channel, flag off  (the gravity pass as it was before; the reduction is the new one)
//  - flag off: potential channel drawn, flag off
//  - on:       potential channel drawn, flag on (the application's default)
// Only the synchronized figures mean anything, see docs/lab.md.

import {
    COST_CHUNK_FRAMES, COST_EARLY_FRAMES, COST_FROZEN_ROUNDS, COST_FROZEN_SUBSTEPS, COST_PARTICLES, COST_ROUNDS,
    PERF_WARMUP_FRAMES, PERF_WARMUP_MS,
} from '../config';
import { protostarModel, restart } from '../driver';
import { alternatingOrders, quantile, significant } from '../numbers';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';
import { timeChunks, warmUp } from './perf';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);

type Mode = 'plain' | 'flagOff' | 'on';
const MODES: readonly Mode[] = ['plain', 'flagOff', 'on'];
/** The frozen grid passes only tell the potential channel apart: the flag adds a pass before the update, not inside it. */
const FROZEN_MODES = ['plain', 'flagOff'] as const;
type Series<M extends string = Mode> = Record<M, number[]>;

function setMode(context: LabContext, mode: Mode): void {
    protostarModel(context).debugGrids.potentialEnabled = mode !== 'plain';
    context.simulation.setParam(PROTOSTAR_PARAM.diagnostics, mode === 'on');
}

/** Rounds of one timed chunk per mode, in alternating orders (three modes: the six orders in turn); `measure(mode)` returns ms. */
async function alternate<M extends string>(modes: readonly M[], rounds: number, measure: (mode: M) => Promise<number>): Promise<Series<M>> {
    const series = Object.fromEntries(modes.map(m => [m, [] as number[]])) as Series<M>;
    for (const order of alternatingOrders(modes, rounds)) {
        for (const mode of order) series[mode].push(await measure(mode));
    }
    return series;
}

/** Medians and quartiles of the paired differences `a - b` (one per round). */
function paired<M extends string>(series: Series<M>, a: M, b: M): Record<string, JsonValue> {
    const differences = series[a].map((v, i) => v - series[b][i]);
    return {
        medianDifference: round(quantile(differences, 0.5)),
        lowerQuartile: round(quantile(differences, 0.25)),
        upperQuartile: round(quantile(differences, 0.75)),
        minDifference: round(Math.min(...differences)),
        maxDifference: round(Math.max(...differences)),
        medianOver: round(quantile(differences, 0.5) / quantile(series[b], 0.5)),
        roundsWhereSlower: differences.filter(d => d > 0).length,
        differencesPerRound: differences.map(round),
    };
}

function summarize<M extends string>(unit: string, series: Series<M>, modes: readonly M[], pairs: readonly (readonly [string, M, M])[]): Record<string, JsonValue> {
    return {
        unit,
        medians: Object.fromEntries(modes.map(m => [m, round(quantile(series[m], 0.5))])),
        chunks: Object.fromEntries(modes.map(m => [m, series[m].map(round)])),
        ...Object.fromEntries(pairs.map(([name, a, b]) => [name, paired(series, a, b)])),
    };
}

const WHOLE_FRAME_PAIRS = [['flagOffMinusPlain', 'flagOff', 'plain'], ['onMinusFlagOff', 'on', 'flagOff'], ['onMinusPlain', 'on', 'plain']] as const;
const FROZEN_PAIRS = [['flagOffMinusPlain', 'flagOff', 'plain']] as const;

/** ms per grid update of a frozen state with and without the potential channel. */
async function frozenGridCost(context: LabContext): Promise<Series<typeof FROZEN_MODES[number]>> {
    const model = protostarModel(context);
    const texture = () => context.simulation.positionTexture;
    const chunk = async (mode: typeof FROZEN_MODES[number]): Promise<number> => {
        setMode(context, mode);
        const start = performance.now();
        for (let i = 0; i < COST_FROZEN_SUBSTEPS; i++) model.beforeSubstep(0);
        await context.sync.wait(texture());
        return (performance.now() - start) / COST_FROZEN_SUBSTEPS;
    };
    const start = performance.now();
    do { await alternate(FROZEN_MODES, 1, chunk); } while (performance.now() - start < PERF_WARMUP_MS);
    return alternate(FROZEN_MODES, COST_FROZEN_ROUNDS, chunk);
}

/** ms of one call of a pass on a frozen state: the reduction (two passes), and the potential kept before the grids (two passes). */
async function passCosts(context: LabContext): Promise<Record<string, JsonValue>> {
    const model = protostarModel(context);
    const grids = model.debugGrids;
    const texture = () => context.simulation.positionTexture;
    const time = async (run: () => void): Promise<number> => {
        const rounds: number[] = [];
        for (let r = 0; r < 7; r++) {
            const start = performance.now();
            for (let i = 0; i < COST_FROZEN_SUBSTEPS; i++) run();
            await context.sync.wait(texture());
            rounds.push((performance.now() - start) / COST_FROZEN_SUBSTEPS);
        }
        return quantile(rounds, 0.5);
    };
    await time(() => grids.reduceStats());                      // warm-up
    return {
        unit: 'ms per call (median of 7 chunks of calls, the GPU waited for at the end of each)',
        reduceStats: round(await time(() => grids.reduceStats())),
        stashPotential: round(await time(() => grids.stashPotential())),
    };
}

export const diagnosticsCost: Scenario = {
    id: 'cost.protostar.diagnostics',
    title: 'Cost of the energy diagnostics: simulation ms/frame without the potential, flag off and flag on, alternated (400 000 particles)',
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
        await warmUp(context, simulate, COST_EARLY_FRAMES, COST_EARLY_FRAMES, 0);
        const framesAtEarly = simulatedFrames;
        const early = await frozenGridCost(context);
        const costs = await passCosts(context);
        await warmUp(context, simulate, COST_CHUNK_FRAMES, PERF_WARMUP_FRAMES, PERF_WARMUP_MS);
        const framesAtWholeFrames = simulatedFrames;

        let frames: Series;
        try {
            frames = await alternate(MODES, COST_ROUNDS, async mode => {
                setMode(context, mode);
                return (await timeChunks(context, simulate, COST_CHUNK_FRAMES, 1))[0];
            });
        } finally {
            setMode(context, 'on');
        }
        const late = await frozenGridCost(context);
        grids.potentialEnabled = true;
        simulation.setParam(PROTOSTAR_PARAM.diagnostics, true);

        const metrics: Record<string, JsonValue> = {
            valid: true,
            renderer: context.rendererName,
            particles: simulation.activeCount,
            substepsPerFrame: Math.max(1, Math.ceil(simulation.timeScale - 1e-6)),
            chunkFrames: COST_CHUNK_FRAMES,
            rounds: COST_ROUNDS,
            framesAtEarlyCloud: framesAtEarly,
            framesAtFirstTimedChunk: framesAtWholeFrames,
            framesAtLateCloud: simulatedFrames,
            simulationFrames: summarize('ms per frame (simulation only)', frames, MODES, WHOLE_FRAME_PAIRS),
            gridPassesEarlyCloud: summarize('ms per substep (grid passes only)', early, FROZEN_MODES, FROZEN_PAIRS),
            gridPassesLateCloud: summarize('ms per substep (grid passes only)', late, FROZEN_MODES, FROZEN_PAIRS),
            passes: costs,
        };
        const diff = <M extends string>(a: M, b: M, series: Series<M>): number => quantile(series[a].map((v, i) => v - series[b][i]), 0.5);
        const signed = (v: number, digits = 2): string => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
        return {
            status: 'pass',
            metrics,
            details: `simulation frame ${quantile(frames.plain, 0.5).toFixed(2)} ms plain; potential channel ${signed(diff('flagOff', 'plain', frames))} ms, `
                + `flag on ${signed(diff('on', 'flagOff', frames))} ms more (median of ${COST_ROUNDS} paired rounds); `
                + `grid passes alone, potential channel: ${signed(diff('flagOff', 'plain', early), 3)} ms per substep early, ${signed(diff('flagOff', 'plain', late), 3)} late`,
        };
    },
};
