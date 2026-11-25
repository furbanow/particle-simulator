// The adaptive time step of the protostar (phase B5, docs/spikes/b5-adaptive-time-step.md) on the real GPU:
//  - baseline.protostar.adaptive-step: the default cloud at the fixed count of substeps, with the adaptive step, and at a much smaller step
//    (references at 1/4 and 1/8 of the fixed substep); the substeps of every frame, the core's omega dt, and how close the core's history
//    (peak density, burst of the fusion rate, fusions made) is to the references';
//  - protostar.adaptive-maclaurin: the cold Maclaurin disc's free fall (phase A8) under the three, against its analytic time;
//  - cost.protostar.adaptive-step: the cost of the adaptive step against the fixed count, runs alternated, per simulated second.
// Options of the page URL (these scenarios read them themselves): `stepSeeds`, `stepFrames`, `stepReferenceFrames`, `stepParticles`,
// `stepPaced=0` (the frames follow one another with no wait for the next animation frame), `stepVariants` (other constants of the adaptive step),
// `stepOverrides` (protostar parameters set for every run), `stepDump=1` (every frame in the results), `costPairs`, `costFrames`, `costCounts`.

import {
    BASE_DT, PROTOSTAR_GRID_RES, PROTOSTAR_STEP_COURANT, PROTOSTAR_STEP_OMEGA, PROTOSTAR_T0_KELVIN,
} from '../../config';
import { probeCore } from '../core';
import { frameSeconds, nextAnimationFrame, protostarGrids, protostarModel, restart } from '../driver';
import { crossingTime, maclaurinFallShare } from '../initialReference';
import { decimate, quantile, significant } from '../numbers';
import { readTarget } from '../readback';
import {
    ADAPTIVE_STEP, applyStepMode, clearStepMode, FIXED_STEP, referenceStep, type StepMode,
} from '../stepMode';
import { compareCore, histogram, parseSchedule, peak, stepSummary, type CoreComparison, type CoreSeries } from '../stepStats';
import { LAB_SEED, MACLAURIN_JUDGED_LEVELS, MACLAURIN_LEVELS, MACLAURIN_TOLERANCE } from '../config';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';
import { collapseRun } from './initialConditions';

const DIGITS = 4;
const sig = (v: number): number => significant(v, DIGITS);
const MEGA = 1e6;

// ---- Lab constants of these scenarios ----
const STEP_PARTICLES = 400000;
const STEP_FRAMES = 1200;
const STEP_SEEDS = 3;
/** The references run until the first burst is over and the core settles: frames. */
const REFERENCE_FRAMES = 330;
const REFERENCES = [4, 8] as const;
/** Frames between two readings of the core's omega (the grids read back whole). */
const OMEGA_EVERY = 5;
/** What omega dt the criterion is meant to keep in the core (with its safety margin), and the largest the lab tolerates. */
const OMEGA_DT_JUDGED = 0.15;
/** The fusion counts of the comparison are read at these times (s). */
const FUSED_AT = [2.5, 3, 4, 5.5, 8] as const;
/** The comparison with the references stops here (s): the first collapse and burst, before the history turns chaotic. */
const COMPARE_UNTIL = 8;
/** The speeds of the Maclaurin comparison: the default speed's fixed count is 2 substeps, the half of it 1. */
const MACLAURIN_STEP_SPEED = 1.7;
const COST_PAIRS = 5;
const COST_FRAMES = 1200;
const COST_COUNTS = [400000, 1000000] as const;
const COST_WINDOW = 100;
/**
 * The substeps per frame the cost scenario replays for the adaptive step (run lengths, see parseSchedule): those the adaptive step chose in
 * the default cloud after the Gamow rates (seed 20240611, paced frames, 2.69 on average): the live decisions of an unpaced loop do not see the reads land.
 */
const COST_REPLAY_SCHEDULE = '2x90,3x19,2x285,3x806';

/** A number of the page URL (the lab's page is the only place these scenarios run). */
function queryNumber(name: string, fallback: number): number {
    const value = Number(new URLSearchParams(globalThis.location?.search ?? '').get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
const queryFlag = (name: string, fallback: boolean): boolean => {
    const raw = new URLSearchParams(globalThis.location?.search ?? '').get(name);
    return raw === null ? fallback : raw !== '0';
};

/** Protostar parameters set below the sliders' minima for every run (`?stepOverrides={"radiation":0}`): what part of the physics a convergence comes from. */
function queryOverrides(): Record<string, number> | undefined {
    const raw = new URLSearchParams(globalThis.location?.search ?? '').get('stepOverrides');
    return raw ? JSON.parse(raw) as Record<string, number> : undefined;
}

/**
 * The adaptive modes to run (`?stepVariants=[{"omega":0.1,"courant":0.5,"minRatio":0.5,"ratio":8,"readInterval":1}, ...]`: other constants than the
 * application's, for tuning them); the application's own when omitted.
 */
function adaptiveModes(): StepMode[] {
    const raw = new URLSearchParams(globalThis.location?.search ?? '').get('stepVariants');
    if (!raw) return [ADAPTIVE_STEP];
    const list = JSON.parse(raw) as { omega?: number; courant?: number; minRatio?: number; ratio?: number; readInterval?: number }[];
    return list.map(criterion => ({
        name: `adaptive omega ${criterion.omega ?? 'app'} courant ${criterion.courant ?? 'app'} min ${criterion.minRatio ?? 'app'} max ${criterion.ratio ?? 'app'} read ${criterion.readInterval ?? 'app'}`,
        adaptive: true, refine: 0, criterion,
    }));
}

// ---- One run of the default cloud ----

interface CloudRun {
    mode: StepMode;
    seed: number;
    core: CoreSeries;
    /** Per frame: the substeps run, the criterion's and the reduction's numbers as the model saw them (null for the references and the fixed count). */
    steps: number[];
    dtCriticalMs: (number | null)[];
    maxSpeed: number[];
    maxAcceleration: number[];
    age: (number | null)[];
    /** Every OMEGA_EVERY frames: the core's omega (1/s) and omega dt at the substep that frame ran. */
    omega: { frame: number; seconds: number; omega: number; omegaDt: number; steps: number }[];
    wallSeconds: number;
}

/**
 * The default cloud for `frames` frames in `mode`, the core read after every frame from the reduction of the grids of the last
 * substep. The model's endFrame() is called (not the simulation's: no drift correction, which would land at the frame the asynchronous
 * read-back does) so that the adaptive step reads its reduction as it does in the application. `paced`: one frame per animation frame,
 * as the application runs, so that the reads of the adaptive step land with the same lag.
 */
async function cloudRun(context: LabContext, mode: StepMode, seed: number, frames: number, count: number, paced: boolean): Promise<CloudRun> {
    const { renderer, simulation } = context;
    await restart(context, { count, seed, overrides: queryOverrides() });
    applyStepMode(context, mode);
    const model = protostarModel(context);
    const grids = protostarGrids(context);
    const perFrame = frameSeconds(context);
    const size = simulation.screenSize.value;
    const cell = Math.max(size.x, size.y) / PROTOSTAR_GRID_RES;
    const run: CloudRun = {
        mode, seed, core: { seconds: [], density: [], temperatureMK: [], rate: [] }, steps: [], dtCriticalMs: [], maxSpeed: [], maxAcceleration: [],
        age: [], omega: [], wallSeconds: 0,
    };
    const started = performance.now();
    try {
        for (let frame = 1; frame <= frames; frame++) {
            simulation.step();
            const steps = simulation.lastSubsteps;
            model.endFrame();
            const info = model.debugStepInfo;
            if (paced) await nextAnimationFrame();
            model.debugGrids.reduceStats();
            const texels = await readTarget(renderer, grids.reduce2);
            // The reduction describes the grids of the frame's last substep, drawn from the positions at its start: dt before the end of the frame.
            run.core.seconds.push(frame * perFrame - perFrame / steps);
            run.core.density.push(texels[0]);
            run.core.temperatureMK.push(texels[1] * PROTOSTAR_T0_KELVIN / MEGA);
            run.core.rate.push(texels[2]);
            run.maxSpeed.push(texels[4 + 2]);
            run.maxAcceleration.push(texels[4 + 3]);
            run.steps.push(steps);
            run.dtCriticalMs.push(info?.dtCritical === null || info === null ? null : info.dtCritical * 1000);
            run.age.push(info?.age ?? null);
            if (frame % OMEGA_EVERY === 0) {
                const core = probeCore(await readTarget(renderer, grids.gas), await readTarget(renderer, grids.gravity), PROTOSTAR_GRID_RES, cell);
                run.omega.push({ frame, seconds: frame * perFrame, omega: core.omega, omegaDt: core.omega * perFrame / steps, steps });
            }
        }
    } finally {
        clearStepMode(context);
    }
    run.wallSeconds = (performance.now() - started) / 1000;
    return run;
}

const comparisonMetrics = (c: CoreComparison): Record<string, JsonValue> => ({
    densityLogRms: sig(c.densityLogRms), densityLogMax: sig(c.densityLogMax), peakDensityRelative: sig(c.peakDensityRelative),
    peakDensityTimeDelta: sig(c.peakDensityTimeDelta), burstTimeDelta: c.burstTimeDelta === null ? null : sig(c.burstTimeDelta),
    burstPeakRelative: sig(c.burstPeakRelative), peakTemperatureRelative: sig(c.peakTemperatureRelative),
    fusedRelative: Object.fromEntries(FUSED_AT.map((t, k) => [String(t), sig(c.fusedRelative[k])])),
});

/** Every frame of a run, for an offline look (`?stepDump=1`): what the criterion saw and decided, and the core. */
function frameDump(run: CloudRun): Record<string, JsonValue> {
    const rounded = (values: readonly (number | null)[]): (number | null)[] => values.map(v => v === null ? null : sig(v));
    return {
        seconds: rounded(run.core.seconds), steps: run.steps, dtCriticalMs: rounded(run.dtCriticalMs), maxSpeed: rounded(run.maxSpeed),
        maxAcceleration: rounded(run.maxAcceleration), age: run.age, density: rounded(run.core.density),
        temperatureMK: rounded(run.core.temperatureMK), rate: rounded(run.core.rate),
        omega: { frame: run.omega.map(o => o.frame), omega: rounded(run.omega.map(o => o.omega)), omegaDt: rounded(run.omega.map(o => o.omegaDt)) },
    };
}

function runMetrics(run: CloudRun): Record<string, JsonValue> {
    const { mean, shares } = stepSummary(run.steps);
    const seconds = run.core.seconds[run.core.seconds.length - 1];
    const substeps = run.steps.reduce((sum, s) => sum + s, 0);
    const omegaDt = run.omega.map(o => o.omegaDt);
    const omegaMax = omegaDt.reduce((m, v) => Math.max(m, v), 0);
    const over = (limit: number): number | null => run.omega.length ? sig(omegaDt.filter(v => v > limit).length / omegaDt.length) : null;
    const ages = run.age.filter((a): a is number => a !== null);
    const keep = decimate(run.omega, 60);
    const sample = decimate(run.core.seconds.map((_, i) => i), 60);
    return {
        mode: run.mode.name, seed: run.seed, frames: run.steps.length, simulatedSeconds: sig(seconds), wallSeconds: significant(run.wallSeconds, 3),
        substeps: {
            total: substeps, meanPerFrame: sig(mean), perSimulatedSecond: sig(substeps / seconds),
            histogram: histogram(run.steps), shareOfFrames: shares.map(sig),
        },
        omegaDt: {
            max: sig(omegaMax), median: omegaDt.length ? sig(quantile(omegaDt, 0.5)) : null,
            shareOver0p1: over(0.1), shareOver0p15: over(OMEGA_DT_JUDGED), shareOver0p2: over(0.2),
            series: { seconds: keep.map(o => sig(o.seconds)), omega: keep.map(o => sig(o.omega)), omegaDt: keep.map(o => sig(o.omegaDt)), steps: keep.map(o => o.steps) },
        },
        age: ages.length ? { median: quantile(ages, 0.5), max: Math.max(...ages), histogram: histogram(ages) } : null,
        criterion: run.dtCriticalMs.some(v => v !== null) ? {
            series: {
                seconds: sample.map(i => sig(run.core.seconds[i])), steps: sample.map(i => run.steps[i]),
                dtCriticalMs: sample.map(i => { const v = run.dtCriticalMs[i]; return v === null ? null : sig(v); }),
                maxSpeed: sample.map(i => sig(run.maxSpeed[i])), maxAcceleration: sample.map(i => sig(run.maxAcceleration[i])),
            },
        } : null,
        core: {
            peakDensity: sig(peak(run.core.density, run.core.seconds).value), peakDensityAt: sig(peak(run.core.density, run.core.seconds).seconds),
            peakTemperatureMK: sig(peak(run.core.temperatureMK, run.core.seconds).value),
            peakFusionRate: sig(peak(run.core.rate, run.core.seconds).value), peakFusionRateAt: sig(peak(run.core.rate, run.core.seconds).seconds),
            series: {
                seconds: sample.map(i => sig(run.core.seconds[i])), density: sample.map(i => sig(run.core.density[i])),
                temperatureMK: sample.map(i => sig(run.core.temperatureMK[i])), rate: sample.map(i => sig(run.core.rate[i])),
            },
        },
    };
}

/** The first `frames` frames of a series (a reference is shorter than the runs it is compared with). */
const head = (series: CoreSeries, frames: number): CoreSeries => ({
    seconds: series.seconds.slice(0, frames), density: series.density.slice(0, frames),
    temperatureMK: series.temperatureMK.slice(0, frames), rate: series.rate.slice(0, frames),
});

export const adaptiveCloud: Scenario = {
    id: 'baseline.protostar.adaptive-step',
    title: 'Adaptive time step: the default cloud at the fixed count, adaptive, and at 1/4 and 1/8 of the substep (substeps, omega dt, the core against the references)',
    tags: ['baseline', 'protostar', 'slow', 'step'],
    async run(context): Promise<ScenarioOutcome> {
        const seeds = queryNumber('stepSeeds', STEP_SEEDS);
        const frames = queryNumber('stepFrames', STEP_FRAMES);
        const referenceFrames = Math.min(frames, queryNumber('stepReferenceFrames', REFERENCE_FRAMES));
        const count = queryNumber('stepParticles', context.software ? 20000 : STEP_PARTICLES);
        const paced = queryFlag('stepPaced', true);
        const dump = queryFlag('stepDump', false);
        const perSeed: Record<string, JsonValue>[] = [];
        const lines: string[] = [];
        let worstOmegaDt = 0;
        for (let k = 0; k < seeds; k++) {
            const seed = LAB_SEED + k;
            const fixed = await cloudRun(context, FIXED_STEP, seed, frames, count, paced);
            const adaptives: CloudRun[] = [];
            for (const mode of adaptiveModes()) adaptives.push(await cloudRun(context, mode, seed, frames, count, paced));
            const references = new Map<number, CloudRun>();
            for (const refine of REFERENCES) references.set(refine, await cloudRun(context, referenceStep(refine), seed, referenceFrames, count, false));
            const reference = references.get(8)!;
            const against = (run: CloudRun, ref: CloudRun): CoreComparison =>
                compareCore(run.core, head(ref.core, referenceFrames), COMPARE_UNTIL, FUSED_AT);
            const f = against(fixed, reference), r4 = against(references.get(4)!, reference);
            const comparisons = adaptives.map(run => against(run, reference));
            perSeed.push({
                seed,
                ...(dump ? { frames: { fixed: frameDump(fixed), ...Object.fromEntries(adaptives.map(run => [run.mode.name, frameDump(run)])),
                    ...Object.fromEntries([...references].map(([r, run]) => [`dt/${r}`, frameDump(run)])) } } : {}),
                fixed: runMetrics(fixed), adaptive: adaptives.map(runMetrics),
                references: Object.fromEntries([...references].map(([refine, run]) => [`dt/${refine}`, runMetrics(run)])),
                againstDt8: {
                    fixed: comparisonMetrics(f), 'dt/4': comparisonMetrics(r4),
                    adaptive: Object.fromEntries(adaptives.map((run, i) => [run.mode.name, comparisonMetrics(comparisons[i])])),
                },
            });
            const omegaMax = (run: CloudRun): number => run.omega.reduce((m, o) => Math.max(m, o.omegaDt), 0);
            adaptives.forEach((run, i) => {
                const a = comparisons[i];
                worstOmegaDt = Math.max(worstOmegaDt, omegaMax(run));
                lines.push(`seed ${seed} ${run.mode.name}: substeps/frame fixed ${stepSummary(fixed.steps).mean.toFixed(2)}, adaptive ${stepSummary(run.steps).mean.toFixed(2)}; `
                    + `omega dt max ${omegaMax(fixed).toFixed(3)} fixed, ${omegaMax(run).toFixed(3)} adaptive; density rms log error vs dt/8: fixed ${f.densityLogRms.toFixed(4)}, `
                    + `adaptive ${a.densityLogRms.toFixed(4)}, dt/4 ${r4.densityLogRms.toFixed(4)}; burst time delta fixed ${f.burstTimeDelta?.toFixed(3)}, adaptive ${a.burstTimeDelta?.toFixed(3)}, dt/4 ${r4.burstTimeDelta?.toFixed(3)} s`);
            });
        }
        const ok = worstOmegaDt <= OMEGA_DT_JUDGED;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: count, frames, referenceFrames, seeds, paced, criterion: { omega: PROTOSTAR_STEP_OMEGA, courant: PROTOSTAR_STEP_COURANT },
                judged: { omegaDtMax: OMEGA_DT_JUDGED, worstAdaptiveOmegaDt: sig(worstOmegaDt) }, compareUntilSeconds: COMPARE_UNTIL,
                frameSeconds: sig(BASE_DT * context.simulation.timeScale), runs: perSeed,
            },
            details: `${ok ? 'within' : 'beyond'} omega dt ${OMEGA_DT_JUDGED} (worst ${worstOmegaDt.toFixed(3)}); ${lines.join('; ')}`,
        };
    },
};

// ---- The cold Maclaurin disc ----

export const adaptiveMaclaurin: Scenario = {
    id: 'protostar.adaptive-maclaurin',
    title: 'Adaptive time step: the cold Maclaurin disc\'s free fall at the fixed count, adaptive, and at 1/4 and 1/8 of the substep, against the analytic time',
    tags: ['protostar', 'initial', 'step'],
    async run(context): Promise<ScenarioOutcome> {
        const modes: StepMode[] = [FIXED_STEP, ...adaptiveModes(), referenceStep(4), referenceStep(8)];
        const rows: Record<string, JsonValue>[] = [];
        const estimates = new Map<string, number[]>();
        const lines: string[] = [];
        let worstJudged = 0;
        for (const mode of modes) {
            const run = await collapseRun(context, MACLAURIN_STEP_SPEED, mode);
            const found = MACLAURIN_LEVELS.map(level => crossingTime(run.times, run.radii, level) / maclaurinFallShare(level) / run.tff);
            estimates.set(mode.name, found);
            if (mode.name !== 'dt/4' && mode.name !== 'dt/8') {
                for (const level of MACLAURIN_JUDGED_LEVELS) worstJudged = Math.max(worstJudged, Math.abs(found[MACLAURIN_LEVELS.indexOf(level)] - 1));
            }
            const { mean, shares } = stepSummary(run.steps);
            rows.push({
                mode: mode.name, frames: run.times.length - 1, freeFallSeconds: sig(run.tff), levels: [...MACLAURIN_LEVELS],
                freeFallEstimateOverAnalytic: found.map(sig),
                crossingSeconds: MACLAURIN_LEVELS.map(level => sig(crossingTime(run.times, run.radii, level))),
                substeps: { meanPerFrame: sig(mean), histogram: histogram(run.steps), shareOfFrames: shares.map(sig), perFrame: run.steps.length <= 200 ? run.steps : decimate(run.steps, 100) },
            });
            lines.push(`${mode.name}: ${found.map((e, k) => `${e.toFixed(4)} at ${MACLAURIN_LEVELS[k]}`).join(', ')} (substeps/frame ${mean.toFixed(2)})`);
        }
        const reference = estimates.get('dt/8')!;
        const difference = (name: string): number[] => estimates.get(name)!.map((e, k) => e - reference[k]);
        const ok = worstJudged <= MACLAURIN_TOLERANCE;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: STEP_PARTICLES, speed: MACLAURIN_STEP_SPEED, tolerance: MACLAURIN_TOLERANCE, judgedLevels: [...MACLAURIN_JUDGED_LEVELS],
                worstJudgedError: sig(worstJudged), runs: rows,
                minusDt8: Object.fromEntries(modes.filter(m => m.name !== 'dt/8').map(m => [m.name, difference(m.name).map(sig)])),
            },
            details: `${ok ? 'within' : 'beyond'} ${MACLAURIN_TOLERANCE * 100} % of t_ff at ${MACLAURIN_JUDGED_LEVELS.join(' and ')} (worst ${(worstJudged * 100).toFixed(2)} %); ${lines.join('; ')}`,
        };
    },
};

// ---- Cost ----

interface CostRun {
    mode: 'fixed' | 'adaptive';
    totalMs: number;
    windowsMsPerFrame: number[];
    substeps: number;
    frames: number;
    simulatedSeconds: number;
}

/**
 * `frames` frames of the default cloud (the application's loop: step and endFrame), the GPU waited for every COST_WINDOW frames. The
 * adaptive mode runs with the flag on (the reduction read every few frames, the work of the criterion) but with the substeps of `schedule`
 * instead of its own decisions: an unpaced loop yields to the event loop only at its waits, so the reads would land late and the
 * decisions would not be those of the application; the replay has the work of the application's.
 */
async function costRun(context: LabContext, mode: StepMode, count: number, frames: number, schedule: readonly number[]): Promise<CostRun> {
    const { simulation } = context;
    await restart(context, { count });
    applyStepMode(context, mode);
    const model = protostarModel(context);
    let substeps = 0;
    const windows: number[] = [];
    const started = performance.now();
    try {
        for (let done = 0; done < frames; done += COST_WINDOW) {
            const windowStart = performance.now();
            const n = Math.min(COST_WINDOW, frames - done);
            for (let i = 0; i < n; i++) {
                if (mode.adaptive) model.debugSubsteps = schedule[Math.min(done + i, schedule.length - 1)];
                simulation.step();
                substeps += simulation.lastSubsteps;
                simulation.endFrame();
            }
            await context.sync.wait(simulation.positionTexture);
            windows.push((performance.now() - windowStart) / n);
        }
    } finally {
        clearStepMode(context);
    }
    return {
        mode: mode.adaptive ? 'adaptive' : 'fixed', totalMs: performance.now() - started, windowsMsPerFrame: windows, substeps, frames,
        simulatedSeconds: frames * frameSeconds(context),
    };
}

const spread = (values: readonly number[]): { median: number; min: number; max: number } =>
    ({ median: sig(quantile(values, 0.5)), min: sig(Math.min(...values)), max: sig(Math.max(...values)) });

export const adaptiveCost: Scenario = {
    id: 'cost.protostar.adaptive-step',
    title: 'Cost of the adaptive time step: the default cloud\'s whole run, the fixed count and the adaptive step\'s substeps replayed, alternated, ms per frame and per simulated second',
    tags: ['cost', 'slow', 'protostar', 'step'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) {
            return { status: 'skip', metrics: { valid: false }, details: `INVALID: software renderer (${context.rendererName}), timings are meaningless.` };
        }
        const pairs = queryNumber('costPairs', COST_PAIRS);
        const frames = queryNumber('costFrames', COST_FRAMES);
        const counts = queryNumber('costCounts', 0) > 0 ? [queryNumber('costCounts', 0)] : COST_COUNTS;
        const scheduleText = new URLSearchParams(globalThis.location?.search ?? '').get('costSchedule') ?? COST_REPLAY_SCHEDULE;
        const schedule = parseSchedule(scheduleText);
        const bySize: Record<string, JsonValue> = {};
        const lines: string[] = [];
        for (const count of counts) {
            const runs: Record<'fixed' | 'adaptive', CostRun[]> = { fixed: [], adaptive: [] };
            await costRun(context, ADAPTIVE_STEP, count, 60, schedule);                // warms the GPU and compiles the shaders
            for (let pair = 0; pair < pairs; pair++) {
                const order = pair % 2 === 0 ? [FIXED_STEP, ADAPTIVE_STEP] : [ADAPTIVE_STEP, FIXED_STEP];
                for (const mode of order) runs[mode.adaptive ? 'adaptive' : 'fixed'].push(await costRun(context, mode, count, frames, schedule));
            }
            const ratios = runs.fixed.map((f, i) => runs.adaptive[i].totalMs / f.totalMs);
            const window = (run: CostRun, from: number, to: number): number => quantile(run.windowsMsPerFrame.slice(from, to), 0.5);
            const windows = runs.fixed[0].windowsMsPerFrame.length;
            const phases = [[0, Math.round(windows / 4)], [Math.round(windows / 4), Math.round(windows / 2)], [Math.round(windows / 2), windows]] as const;
            bySize[String(count)] = {
                pairs, frames, schedule: scheduleText,
                fixed: { msPerFrame: spread(runs.fixed.map(r => r.totalMs / r.frames)), substepsPerSimulatedSecond: spread(runs.fixed.map(r => r.substeps / r.simulatedSeconds)) },
                adaptive: { msPerFrame: spread(runs.adaptive.map(r => r.totalMs / r.frames)), substepsPerSimulatedSecond: spread(runs.adaptive.map(r => r.substeps / r.simulatedSeconds)) },
                ratioAdaptiveOverFixed: spread(ratios),
                msPerSubstep: {
                    fixed: spread(runs.fixed.map(r => r.totalMs / r.substeps)), adaptive: spread(runs.adaptive.map(r => r.totalMs / r.substeps)),
                },
                byPhaseMsPerFrame: phases.map(([from, to]) => ({
                    frames: [from * COST_WINDOW, to * COST_WINDOW],
                    fixed: spread(runs.fixed.map(r => window(r, from, to))), adaptive: spread(runs.adaptive.map(r => window(r, from, to))),
                })),
                runsMs: { fixed: runs.fixed.map(r => sig(r.totalMs)), adaptive: runs.adaptive.map(r => sig(r.totalMs)) },
            };
            lines.push(`${count} particles: fixed ${spread(runs.fixed.map(r => r.totalMs / r.frames)).median} ms/frame, adaptive ${spread(runs.adaptive.map(r => r.totalMs / r.frames)).median} ms/frame, `
                + `ratio ${spread(ratios).median} (${spread(ratios).min} to ${spread(ratios).max}); substeps per simulated second ${spread(runs.fixed.map(r => r.substeps / r.simulatedSeconds)).median} fixed, ${spread(runs.adaptive.map(r => r.substeps / r.simulatedSeconds)).median} adaptive`);
        }
        return { status: 'pass', metrics: { valid: true, renderer: context.rendererName, sizes: bySize }, details: lines.join('; ') };
    },
};

export const adaptiveStepScenarios: readonly Scenario[] = [adaptiveCloud, adaptiveMaclaurin, adaptiveCost];
