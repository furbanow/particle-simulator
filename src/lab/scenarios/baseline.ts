// The baseline of the current protostar model: what it does today, recorded so that later phases
// can be compared with it. These scenarios do not judge the physics (a status of `pass` means they
// ran and produced finite numbers); the numbers go to docs/lab-baseline.md.

import { MAX_SPECIES, PROTOSTAR_GRID_RES, PROTOSTAR_STATS_INTERVAL, PROTOSTAR_T0_KELVIN } from '../../config';
import type { ParamValues } from '../../simulation/algorithm';
import { defaultParams } from '../../simulation/params';
import { molecularWeightFactors } from '../../simulation/protostar/composition';
import { HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../../simulation/protostar/declaration';
import {
    fusionLawOf, ignitionKelvins, ignitionRatio, ignitionTemperatures, kineticIgnitionRatio,
} from '../../simulation/protostar/ignition';
import {
    BASELINE_SERIES_POINTS, CLOUD_VARIANT_SEEDS, LAB_SEED, IGNITION_REFERENCE_DENSITY, IGNITION_REFERENCE_RATE, IGNITION_SENSITIVITY_DENSITIES,
    IGNITION_SENSITIVITY_RATES, OMEGA_DT_LIMIT, REAL_IGNITION_RATIO,
} from '../config';
import { probeCore } from '../core';
import { frameSeconds, modelStats, protostarGrids, protostarModel, restart, runFrames, sleep, substepsPerFrame } from '../driver';
import { decimate, mean, significant, sumChannel } from '../numbers';
import { readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const MEGA = 1e6;
const SIGNIFICANT_DIGITS = 5;
/** How long to wait for the model's asynchronous stats after the last frame. */
const STATS_WAIT_MS = 2000;
const STATS_POLL_MS = 50;

/** One reading of the GPU reduction of the stats (what the model reduces every PROTOSTAR_STATS_INTERVAL frames). */
interface Sample {
    frame: number;
    seconds: number;
    /** Densest cell, rho0. */
    maxDensity: number;
    /** Temperature of the densest cell, MK. */
    coreMK: number;
    /** Expected fusions per second in the whole cloud. */
    fusionRate: number;
    /** Live particles of each of the first three types (hydrogen, helium, carbon), from the model's last read-back; -1 before the first. */
    counts: readonly number[];
    /** Oscillation frequency in the core (1/s) times the substep: the Verlet integrator needs it well below 1. */
    omegaDt: number;
}

const round = (values: readonly number[]): number[] => values.map(v => significant(v, SIGNIFICANT_DIGITS));

/**
 * Variants of the default cloud that switch parts of the physics of phases P3a and P3b off, or tune its parameters, to see what
 * each does (the application runs none of them): the heating by the random kick of the cold cells instead of by scaling, the fusion
 * rate without the correction of the noise of T, the average of T over time with another time constant (0: none), the temperature
 * without the molecular weight (the dispersion, as before A1), protostar parameters set directly (below the sliders' minima too).
 */
export interface CloudVariant {
    name: string;
    kick?: boolean;
    uncorrected?: boolean;
    tau?: number;
    /** False: the temperature is the velocity dispersion, as before the mean molecular weight (A1). */
    molecularWeight?: boolean;
    /** Protostar parameters (gravity, fusionRate, feedback, ...) set on the model, whatever the sliders' ranges. */
    overrides?: ParamValues;
    /** Panel parameters set through the Simulation before the restart (the initial conditions: alphaVir, betaRot, profile, turbulence), within the sliders' ranges. */
    params?: ParamValues;
    /** Frames to run instead of the option's. */
    frames?: number;
    /** Seed of the cloud (LAB_SEED when omitted). */
    seed?: number;
}

/** (a) The default cloud, a fixed seed, `baselineFrames` frames at the algorithm's default speed. */
async function runDefaultCloud(context: LabContext, variant?: CloudVariant): Promise<ScenarioOutcome> {
    const { baselineParticles: count } = context.options;
    const frames = variant?.frames ?? context.options.baselineFrames;
    await restart(context, { count, seed: variant?.seed, overrides: variant?.overrides, params: variant?.params });
    if (variant) {
        // A restart gives the switches their application values back: only the ones the variant changes are set.
        const model = protostarModel(context);
        if (variant.kick) model.velocityUniforms.heatingTFloor.value = 1e30;
        if (variant.uncorrected) model.debugGrids.common.noiseCorrection.value = 0;
        if (variant.tau !== undefined) model.debugGrids.temperatureTau = variant.tau;
        if (variant.molecularWeight === false) model.debugGrids.molecularWeightEnabled = false;
    }
    const { simulation } = context;
    const samples: Sample[] = [];
    const substepSeconds = frameSeconds(context) / substepsPerFrame(context);
    const started = performance.now();
    await runFrames(context, frames, {
        endFrame: true,
        async onFrame(frame) {
            // The model has just reduced the grids (every PROTOSTAR_STATS_INTERVAL frames): read the same texel itself.
            if (frame % PROTOSTAR_STATS_INTERVAL !== 0) return;
            const grids = protostarGrids(context);
            const [density, temperature, rate] = await readTarget(context.renderer, grids.reduce2);
            const size = simulation.screenSize.value;
            const core = probeCore(await readTarget(context.renderer, grids.gas), await readTarget(context.renderer, grids.gravity),
                PROTOSTAR_GRID_RES, Math.max(size.x, size.y) / PROTOSTAR_GRID_RES);
            samples.push({
                frame, seconds: frame * frameSeconds(context), maxDensity: density,
                coreMK: temperature * PROTOSTAR_T0_KELVIN / MEGA, fusionRate: rate,
                omegaDt: core.omega * substepSeconds,
                counts: [0, 1, 2].map(k => simulation.liveTypeCounts()?.[k] ?? -1),
            });
        },
    });
    const wallSeconds = (performance.now() - started) / 1000;

    // The model's own stats come back asynchronously (smoothed fusion rate); wait for them.
    let stats = modelStats(context);
    for (let waited = 0; stats.fusionRate === null && waited < STATS_WAIT_MS; waited += STATS_POLL_MS) {
        await sleep(STATS_POLL_MS);
        stats = modelStats(context);
    }
    const grids = protostarGrids(context);
    const massRatio = sumChannel(await readTarget(context.renderer, grids.moments), 0) / count;
    const counts = simulation.liveTypeCounts();

    const finite = samples.length > 0 && samples.every(s => [s.maxDensity, s.coreMK, s.fusionRate, s.omegaDt].every(Number.isFinite));
    const last = samples.at(-1);
    const lateWindow = samples.slice(Math.floor(samples.length * 0.75));
    const firstFusion = samples.find(s => s.fusionRate > 0);
    const peak = (pick: (s: Sample) => number): number => samples.reduce((m, s) => Math.max(m, pick(s)), 0);
    const peakSeconds = (pick: (s: Sample) => number): number | null =>
        samples.reduce<Sample | null>((best, s) => best === null || pick(s) > pick(best) ? s : best, null)?.seconds ?? null;
    const overLimit = samples.find(s => s.omegaDt > OMEGA_DT_LIMIT);
    const series = decimate(samples, BASELINE_SERIES_POINTS);
    const fixed = (v: number | null): JsonValue => v === null ? null : significant(v, SIGNIFICANT_DIGITS);
    const metrics: Record<string, JsonValue> = {
        particles: count,
        frames,
        timeScale: simulation.timeScale,
        substepsPerFrame: substepsPerFrame(context),
        simulatedSeconds: significant(frames * frameSeconds(context), SIGNIFICANT_DIGITS),
        wallSeconds: significant(wallSeconds, 3),
        substepSeconds: significant(substepSeconds, SIGNIFICANT_DIGITS),
        final: last ? {
            coreTemperatureMK: fixed(last.coreMK), maxDensity: fixed(last.maxDensity),
            fusionRatePerSecond: fixed(last.fusionRate), coreOmegaDt: fixed(last.omegaDt),
        } : null,
        peak: {
            coreTemperatureMK: fixed(peak(s => s.coreMK)), maxDensity: fixed(peak(s => s.maxDensity)),
            fusionRatePerSecond: fixed(peak(s => s.fusionRate)), coreOmegaDt: fixed(peak(s => s.omegaDt)),
        },
        peakAtSeconds: {
            coreTemperature: fixed(peakSeconds(s => s.coreMK)), maxDensity: fixed(peakSeconds(s => s.maxDensity)),
            fusionRate: fixed(peakSeconds(s => s.fusionRate)),
        },
        omegaDtOverLimit: { limit: OMEGA_DT_LIMIT, firstFrame: overLimit?.frame ?? null, firstSeconds: fixed(overLimit?.seconds ?? null) },
        lastQuarterMean: {
            coreTemperatureMK: fixed(mean(lateWindow.map(s => s.coreMK))),
            maxDensity: fixed(mean(lateWindow.map(s => s.maxDensity))),
            fusionRatePerSecond: fixed(mean(lateWindow.map(s => s.fusionRate))),
            coreOmegaDt: fixed(mean(lateWindow.map(s => s.omegaDt))),
        },
        firstFusion: firstFusion ? { frame: firstFusion.frame, seconds: fixed(firstFusion.seconds) } : null,
        modelStats: {
            coreTemperatureMK: fixed(stats.coreTemperature === null ? null : stats.coreTemperature * PROTOSTAR_T0_KELVIN / MEGA),
            coreDensity: fixed(stats.coreDensity),
            fusionRateSmoothed: fixed(stats.fusionRate),
        },
        typeCountsAtEnd: Object.fromEntries(PROTOSTAR.particleTypes.defaults.map((type, k) => [type.symbol, counts[k] ?? 0])),
        depositedMassOverCount: fixed(massRatio),
        series: {
            frame: series.map(s => s.frame),
            seconds: round(series.map(s => s.seconds)),
            coreTemperatureMK: round(series.map(s => s.coreMK)),
            maxDensity: round(series.map(s => s.maxDensity)),
            fusionRatePerSecond: round(series.map(s => s.fusionRate)),
            coreOmegaDt: round(series.map(s => s.omegaDt)),
            hydrogen: series.map(s => s.counts[0]),
            helium: series.map(s => s.counts[1]),
            carbon: series.map(s => s.counts[2]),
        },
    };
    return {
        status: finite ? 'pass' : 'fail',
        metrics,
        details: finite
            ? `${samples.length} readings over ${frames} frames; peak core ${fixed(peak(s => s.coreMK))} MK, peak density ${fixed(peak(s => s.maxDensity))} rho0`
            : 'a reading was not finite, or none was taken',
    };
}

export const defaultCloud: Scenario = {
    id: 'baseline.protostar.default-cloud',
    title: 'Baseline: protostar default cloud, core temperature, density and fusion rate over time',
    tags: ['baseline', 'protostar', 'slow'],
    run: context => runDefaultCloud(context),
};

/**
 * The variants of the ablation: what each part of P3a does to the default cloud. The first is the physics before it, which
 * must be reproduced. Each is run with a few seeds: the burn history of the star is chaotic, one run does not tell its plateau.
 */
const CLOUD_VARIANTS: readonly Omit<CloudVariant, 'seed'>[] = [
    { name: 'before P3a (kick, no correction, no average)', kick: true, uncorrected: true, tau: 0 },
    { name: 'scaling only', uncorrected: true, tau: 0 },
    { name: 'scaling + correction', tau: 0 },
    { name: 'scaling + correction + average, tau 0.05 s', tau: 0.05 },
    { name: 'scaling + correction + average, tau 0.1 s', tau: 0.1 },
    { name: 'scaling + correction + average, tau 0.2 s', tau: 0.2 },
];

/** The default cloud under each variant of phase P3a and each of a few seeds (about 15 s per run): summaries, and the whole series of the first seed. */
export const defaultCloudVariants: Scenario = {
    id: 'baseline.protostar.default-cloud-variants',
    title: 'Baseline: the default cloud with the parts of phase P3a (heating by scaling, correction of the noise of T, average of T) switched on one by one, three seeds each',
    tags: ['baseline', 'protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const runs: Record<string, JsonValue>[] = [];
        let finite = true;
        for (const variant of CLOUD_VARIANTS) {
            for (let k = 0; k < CLOUD_VARIANT_SEEDS; k++) {
                const seed = LAB_SEED + k;
                const outcome = await runDefaultCloud(context, { ...variant, seed });
                finite &&= outcome.status === 'pass';
                const { metrics } = outcome;
                runs.push({
                    variant: variant.name, seed,
                    peak: metrics.peak, peakAtSeconds: metrics.peakAtSeconds, firstFusion: metrics.firstFusion,
                    lastQuarterMean: metrics.lastQuarterMean, final: metrics.final, typeCountsAtEnd: metrics.typeCountsAtEnd,
                    series: k === 0 ? metrics.series : null,
                });
            }
        }
        return {
            status: finite ? 'pass' : 'fail',
            metrics: { particles: context.options.baselineParticles, frames: context.options.baselineFrames, runs },
            details: `${runs.length} runs of the default cloud`,
        };
    },
};

/**
 * (b) The ignition temperature of each fusion reaction at a reference rate and density, and their ratio He / H. The temperatures
 * are those the rate laws read, the gas's temperature (the dispersion times mu / mu_H since A1); the same ratio of the velocity
 * dispersions of the two pure gases at their ignition is the temperatures' ratio over the molecular weights' (2.65).
 */
export const ignitionRatioBaseline: Scenario = {
    id: 'baseline.protostar.ignition-ratio',
    title: 'Baseline: ignition temperature ratio He/H of the current rate laws',
    tags: ['baseline', 'protostar', 'fast', 'pure'],
    async run(): Promise<ScenarioOutcome> {
        const params = defaultParams(PROTOSTAR);
        const index = (from: number): number => PROTOSTAR_REACTIONS.findIndex(r => r.from === from);
        const [h, he] = [index(HYDROGEN), index(HELIUM)];
        const ratioAt = (rate: number, density: number): number => ignitionRatio(PROTOSTAR_REACTIONS, params, density, rate, h, he);
        const temperatures = ignitionTemperatures(PROTOSTAR_REACTIONS, params, IGNITION_REFERENCE_DENSITY, IGNITION_REFERENCE_RATE);
        const kelvins = ignitionKelvins(temperatures);
        const ratio = ratioAt(IGNITION_REFERENCE_RATE, IGNITION_REFERENCE_DENSITY);
        const factors = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
        const kineticRatio = kineticIgnitionRatio(ratio, factors[HYDROGEN], factors[HELIUM]);
        const law = (i: number): JsonValue => {
            const l = fusionLawOf(PROTOSTAR_REACTIONS[i], params);
            return { lambda: l.rate, power: significant(l.power, 4), barrier: significant(l.barrier, 4), barrierPower: significant(l.barrierPower, 4), densityExponent: l.densityExponent, referenceMK: significant(l.reference * PROTOSTAR_T0_KELVIN / MEGA, SIGNIFICANT_DIGITS) };
        };
        const sensitivity = IGNITION_SENSITIVITY_RATES.flatMap(rate => IGNITION_SENSITIVITY_DENSITIES.map(density => ({
            ratePerSecond: rate, density, ratio: significant(ratioAt(rate, density), 4),
        })));
        return {
            status: Number.isFinite(ratio) ? 'pass' : 'fail',
            metrics: {
                reference: { ratePerSecond: IGNITION_REFERENCE_RATE, densityRho0: IGNITION_REFERENCE_DENSITY },
                hydrogenIgnitionMK: significant(kelvins[h] / MEGA, SIGNIFICANT_DIGITS),
                heliumIgnitionMK: significant(kelvins[he] / MEGA, SIGNIFICANT_DIGITS),
                ratioHeOverH: significant(ratio, 4),
                kineticRatioHeOverH: significant(kineticRatio, 4),
                realRatio: significant(REAL_IGNITION_RATIO, 3),
                meetsRealRatio: ratio >= REAL_IGNITION_RATIO,
                laws: { hydrogen: law(h), helium: law(he) },
                sensitivity,
            },
            details: `He/H = ${ratio.toFixed(2)} at ${IGNITION_REFERENCE_RATE}/s and ${IGNITION_REFERENCE_DENSITY} rho0 (real physics: ${REAL_IGNITION_RATIO.toFixed(1)}); the ratio of the rate laws as they are (in velocity dispersion: ${kineticRatio.toFixed(2)}), whatever the gas is made of`,
        };
    },
};


/** The variants of the `cloudVariants` option: a JSON array of objects (see CloudVariant), the invalid ones left out. */
export function parseCloudVariants(json: string): Omit<CloudVariant, 'seed'>[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
    return parsed.filter(isRecord).map((v, i): Omit<CloudVariant, 'seed'> => {
        const overrides: ParamValues = {};
        if (isRecord(v.overrides)) {
            for (const [key, value] of Object.entries(v.overrides)) if (typeof value === 'number' && Number.isFinite(value)) overrides[key] = value;
        }
        const params: ParamValues = {};
        if (isRecord(v.params)) {
            for (const [key, value] of Object.entries(v.params)) {
                if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) params[key] = value;
            }
        }
        return {
            name: typeof v.name === 'string' ? v.name : `variant ${i + 1}`,
            kick: v.kick === true, uncorrected: v.uncorrected === true,
            tau: typeof v.tau === 'number' ? v.tau : undefined,
            molecularWeight: v.molecularWeight === false ? false : undefined,
            overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
            params: Object.keys(params).length > 0 ? params : undefined,
            frames: typeof v.frames === 'number' && v.frames > 0 ? Math.round(v.frames) : undefined,
        };
    });
}

/**
 * The default cloud under the variants the page URL gives (`?cloudVariants=[{"name":"G 8","overrides":{"gravity":8}},{"name":"correlated","params":{"turbulence":"correlated"}}]`), each with
 * `cloudSeeds` seeds: a tool for tuning the defaults (phase P3b-1's minimal recalibration) and for the ablation of the molecular
 * weight (`molecularWeight: false` is the temperature of the code before A1). Skips when no variant is given.
 */
export const defaultCloudTuning: Scenario = {
    id: 'baseline.protostar.default-cloud-tuning',
    title: 'Baseline: the default cloud under the variants of the cloudVariants option (parameters, molecular weight on or off), a few seeds each',
    tags: ['baseline', 'protostar', 'slow', 'tuning'],
    async run(context): Promise<ScenarioOutcome> {
        const variants = parseCloudVariants(context.options.cloudVariants);
        if (variants.length === 0) return { status: 'skip', metrics: {}, details: 'no variant: give the cloudVariants option (a JSON array)' };
        const runs: Record<string, JsonValue>[] = [];
        let finite = true;
        for (const variant of variants) {
            for (let k = 0; k < context.options.cloudSeeds; k++) {
                const seed = LAB_SEED + k;
                const outcome = await runDefaultCloud(context, { ...variant, seed });
                finite &&= outcome.status === 'pass';
                const { metrics } = outcome;
                runs.push({
                    variant: variant.name, seed, overrides: variant.overrides ?? null, params: variant.params ?? null, molecularWeight: variant.molecularWeight ?? true,
                    frames: variant.frames ?? context.options.baselineFrames,
                    peak: metrics.peak, peakAtSeconds: metrics.peakAtSeconds, firstFusion: metrics.firstFusion,
                    lastQuarterMean: metrics.lastQuarterMean, final: metrics.final, typeCountsAtEnd: metrics.typeCountsAtEnd,
                    series: metrics.series,
                });
            }
        }
        return {
            status: finite ? 'pass' : 'fail',
            metrics: { particles: context.options.baselineParticles, runs },
            details: `${runs.length} runs of the default cloud`,
        };
    },
};
