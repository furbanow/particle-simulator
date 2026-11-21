// The default cloud of the sticky dust: clump statistics of its density grid over time, and the
// recalibration of the pull after the isotropic stencil (docs/spikes/a10-granular-dust.md). Nothing
// here depends on how the dust computes its pressure or its sticking: the same scenarios run on the
// builds before and after a change of the physics, which is how the two are compared.

import { DENSITY_RES, DUST_GRADIENT_CORNER_WEIGHT, GRAVITY_SLIDER, REST_DENSITY } from '../../config';
import { STICKY_DUST_STAT } from '../../simulation/stickyDust/declaration';
import { clumpStats, firstCrossing, type ClumpStats } from '../clumpStats';
import {
    DUST_CLOUD_CLUMP_MIN_TEXELS, DUST_CLOUD_FRAMES, DUST_CLOUD_LEVELS, DUST_CLOUD_PARTICLES, DUST_CLOUD_SAMPLE_EVERY, DUST_CLOUD_SEED,
    DUST_RECALIBRATION_ARMS,
} from '../config';
import { frameSeconds, restart, runFrames, stickyDustModel } from '../driver';
import { significant } from '../numbers';
import { readTarget } from '../readback';
import { withSeededRandom } from '../random';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);

interface CloudSample extends ClumpStats {
    frame: number;
    /** Simulated seconds. */
    time: number;
    concentration: number | null;
    supernovae: number;
}

export interface CloudRun {
    samples: CloudSample[];
    /** Simulated time at which the dense mass fraction first reaches each of DUST_CLOUD_LEVELS (null: never). */
    arrival: (number | null)[];
    /** Simulated time of the first supernova (null: none within the run). */
    firstSupernova: number | null;
}

/**
 * Restarts the default dust cloud and steps it `frames` frames, reading the density grid every
 * DUST_CLOUD_SAMPLE_EVERY frames. `prepare` runs after the restart (to change the pull, ...). The frames
 * call Simulation.endFrame(), so the supernovae can trigger: the run is reproducible up to the frame at
 * which an asynchronous read-back lands.
 */
export async function runDefaultCloud(context: LabContext, frames: number, prepare?: () => void): Promise<CloudRun> {
    const { simulation, renderer } = context;
    await restart(context, { algorithm: 'stickyDust', count: DUST_CLOUD_PARTICLES, seed: DUST_CLOUD_SEED });
    prepare?.();
    const density = stickyDustModel(context).debugDensity;
    const seconds = frameSeconds(context);
    const samples: CloudSample[] = [];
    let firstSupernova: number | null = null;
    await withSeededRandom(DUST_CLOUD_SEED, () => runFrames(context, frames, {
        endFrame: true,
        async onFrame(frame) {
            const supernovae = simulation.stat(STICKY_DUST_STAT.supernovae) ?? 0;
            if (supernovae > 0 && firstSupernova === null) firstSupernova = frame * seconds;
            if (frame % DUST_CLOUD_SAMPLE_EVERY !== 0) return;
            const grid = await readTarget(renderer, density.target);
            samples.push({
                ...clumpStats(grid, DENSITY_RES, REST_DENSITY, DUST_CLOUD_CLUMP_MIN_TEXELS),
                frame, time: frame * seconds, concentration: simulation.stat(STICKY_DUST_STAT.concentration), supernovae,
            });
        },
    }));
    const fractions = samples.map((s): [number, number] => [s.time, s.denseMassFraction]);
    return { samples, arrival: DUST_CLOUD_LEVELS.map(level => firstCrossing(fractions, level)), firstSupernova };
}

const sampleMetrics = (s: CloudSample): Record<string, JsonValue> => ({
    frame: s.frame, time: round(s.time), peakDensity: round(s.peak), denseMassFraction: round(s.denseMassFraction), denseTexels: s.denseTexels,
    clumps: s.clumps, largestClumpMass: round(s.largestClumpMass), concentration: s.concentration === null ? null : round(s.concentration),
    supernovae: s.supernovae,
});

const arrivalMetrics = (run: CloudRun): Record<string, JsonValue> => Object.fromEntries(
    DUST_CLOUD_LEVELS.map((level, i) => [`timeToDenseMass${Math.round(level * 100)}pc`, run.arrival[i] === null ? null : round(run.arrival[i] as number)]));

/** The default cloud, as it forms its clumps: the series of the clump statistics and a summary. */
const defaultCloud: Scenario = {
    id: 'dust.default-cloud',
    title: 'Sticky dust: the default cloud forms its clumps (clump statistics of the density grid over time)',
    tags: ['dust', 'baseline', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const run = await runDefaultCloud(context, DUST_CLOUD_FRAMES);
        const last = run.samples[run.samples.length - 1];
        const peakClumps = Math.max(...run.samples.map(s => s.clumps));
        const ok = last.denseMassFraction > 0 && run.arrival[0] !== null;
        const stride = Math.ceil(run.samples.length / 30);
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: context.simulation.activeCount, frames: DUST_CLOUD_FRAMES, restDensity: REST_DENSITY, seconds: round(last.time),
                ...arrivalMetrics(run), firstSupernova: run.firstSupernova === null ? null : round(run.firstSupernova),
                peakNumberOfClumps: peakClumps, final: sampleMetrics(last),
                series: run.samples.filter((_, i) => i % stride === 0 || i === run.samples.length - 1).map(sampleMetrics),
            },
            details: `${DUST_CLOUD_FRAMES} frames (${last.time.toFixed(1)} s): dense mass share ${(100 * last.denseMassFraction).toFixed(1)} % at the end, `
                + `peak density ${last.peak.toFixed(0)}, ${last.clumps} clumps (at most ${peakClumps}); `
                + `time to ${DUST_CLOUD_LEVELS.map((level, i) => `${Math.round(level * 100)} %: ${run.arrival[i] === null ? 'never' : `${(run.arrival[i] as number).toFixed(2)} s`}`).join(', ')}; `
                + `first supernova ${run.firstSupernova === null ? 'none' : `${run.firstSupernova.toFixed(2)} s`}`,
        };
    },
};

/**
 * What the gain on the pull has to be: the default cloud under the original stencil and under the isotropic one with a few
 * gains, each from the same seed; the time at which it has gathered a given share of its mass in dense texels is the
 * felt strength of the pull.
 */
const recalibration: Scenario = {
    id: 'dust.recalibration',
    title: 'Sticky dust: time for the default cloud to gather its mass in clumps, original stencil against the isotropic one and gains on the pull',
    tags: ['dust', 'baseline', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        context.simulation.useAlgorithm('stickyDust');
        const model = stickyDustModel(context);
        const arms: Record<string, JsonValue> = {};
        const lines: string[] = [];
        try {
            for (const arm of DUST_RECALIBRATION_ARMS) {
                const run = await runDefaultCloud(context, DUST_CLOUD_FRAMES, () => {
                    model.debugUseCornerWeight(arm.cornerWeight);
                    model.velocityUniforms.kGravity.value = GRAVITY_SLIDER.default * arm.gain;
                });
                const last = run.samples[run.samples.length - 1];
                arms[arm.name] = {
                    cornerWeight: arm.cornerWeight, gain: arm.gain, ...arrivalMetrics(run),
                    firstSupernova: run.firstSupernova === null ? null : round(run.firstSupernova),
                    final: sampleMetrics(last),
                    denseMassSeries: run.samples.filter((_, i) => i % 3 === 0).map(s => [round(s.time), round(s.denseMassFraction)]),
                };
                lines.push(`${arm.name}: ${run.arrival.map(t => t === null ? '-' : t.toFixed(2)).join(' / ')} s, supernova ${run.firstSupernova === null ? '-' : run.firstSupernova.toFixed(2)} s`);
            }
        } finally {
            model.debugUseCornerWeight(DUST_GRADIENT_CORNER_WEIGHT);
        }
        return {
            status: 'pass',
            metrics: { particles: DUST_CLOUD_PARTICLES, frames: DUST_CLOUD_FRAMES, levels: [...DUST_CLOUD_LEVELS], arms },
            details: `time to ${DUST_CLOUD_LEVELS.map(l => `${Math.round(l * 100)} %`).join(' / ')} of the mass in dense texels: ${lines.join('; ')}`,
        };
    },
};

export const dustCloudScenarios: Scenario[] = [defaultCloud, recalibration];
