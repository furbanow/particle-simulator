// The baseline of the current protostar model: what it does today, recorded so that later phases
// can be compared with it. These scenarios do not judge the physics (a status of `pass` means they
// ran and produced finite numbers); the numbers go to docs/lab-baseline.md.

import { PROTOSTAR_GRID_RES, PROTOSTAR_STATS_INTERVAL, PROTOSTAR_T0_KELVIN } from '../../config';
import { defaultParams } from '../../simulation/params';
import { HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_REACTIONS } from '../../simulation/protostar/declaration';
import {
    fusionLawOf, ignitionKelvins, ignitionRatio, ignitionTemperatures,
} from '../../simulation/protostar/ignition';
import {
    BASELINE_SERIES_POINTS, IGNITION_REFERENCE_DENSITY, IGNITION_REFERENCE_RATE, IGNITION_SENSITIVITY_DENSITIES,
    IGNITION_SENSITIVITY_RATES, OMEGA_DT_LIMIT, REAL_IGNITION_RATIO,
} from '../config';
import { probeCore } from '../core';
import { frameSeconds, modelStats, protostarGrids, restart, runFrames, sleep, substepsPerFrame } from '../driver';
import { decimate, mean, significant, sumChannel } from '../numbers';
import { readTarget } from '../readback';
import type { JsonValue, Scenario, ScenarioOutcome } from '../types';

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
    /** Oscillation frequency in the core (1/s) times the substep: the Verlet integrator needs it well below 1. */
    omegaDt: number;
}

const round = (values: readonly number[]): number[] => values.map(v => significant(v, SIGNIFICANT_DIGITS));

/** (a) The default cloud, a fixed seed, `baselineFrames` frames at the algorithm's default speed. */
export const defaultCloud: Scenario = {
    id: 'baseline.protostar.default-cloud',
    title: 'Baseline: protostar default cloud, core temperature, density and fusion rate over time',
    tags: ['baseline', 'protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const { baselineParticles: count, baselineFrames: frames } = context.options;
        await restart(context, { count });
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
            },
        };
        return {
            status: finite ? 'pass' : 'fail',
            metrics,
            details: finite
                ? `${samples.length} readings over ${frames} frames; peak core ${fixed(peak(s => s.coreMK))} MK, peak density ${fixed(peak(s => s.maxDensity))} rho0`
                : 'a reading was not finite, or none was taken',
        };
    },
};

/** (b) The ignition temperature of each fusion reaction at a reference rate and density, and their ratio He / H. */
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
        const law = (i: number): JsonValue => {
            const l = fusionLawOf(PROTOSTAR_REACTIONS[i], params);
            return { lambda: l.rate, alpha: l.exponent, densityExponent: l.densityExponent, referenceMK: significant(l.reference * PROTOSTAR_T0_KELVIN / MEGA, SIGNIFICANT_DIGITS) };
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
                realRatio: significant(REAL_IGNITION_RATIO, 3),
                meetsRealRatio: ratio >= REAL_IGNITION_RATIO,
                laws: { hydrogen: law(h), helium: law(he) },
                sensitivity,
            },
            details: `He/H = ${ratio.toFixed(2)} at ${IGNITION_REFERENCE_RATE}/s and ${IGNITION_REFERENCE_DENSITY} rho0 (real physics: ${REAL_IGNITION_RATIO.toFixed(1)}); baseline only, the target is for P3b`,
        };
    },
};

/** (c) The energy balance of a conservative run: waits for the potential energy (A7, phase P1a). */
export const energyDrift: Scenario = {
    id: 'baseline.protostar.energy-drift',
    title: 'Energy drift of a conservative protostar run (K + U)',
    tags: ['baseline', 'protostar', 'pending'],
    async run(): Promise<ScenarioOutcome> {
        return { status: 'skip', metrics: {}, details: 'needs A7 (phase P1a)' };
    },
};
