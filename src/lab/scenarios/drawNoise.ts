// Gate of C3 (continuous composition per particle; docs/spikes/c3-continuous-composition.md):
//  - spike.c3.draw-noise: is the noise of A4's fusion draw visible? The default cloud is run from one seed with other draws only (the
//    random stream of the substeps started elsewhere), once again as it was (determinism), and with the gravity nudged by 1e-6 (the
//    chaos of the cloud with no draw changed). The spread of what the user sees (the hydrogen burnt in the first burst, the peak power,
//    the helium flash, the shares of the mass at the end and in the core) between the draws is compared with the nudged runs', and the
//    binomial noise of the fuel share where the gas burns is measured on the snapshots.

import { MAX_SPECIES, PROTOSTAR_GRID_RES, PROTOSTAR_T0_KELVIN } from '../../config';
import { defaultParams } from '../../simulation/params';
import { HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import {
    CONSTANT_MASS_CORE_RADIUS, DRAW_NOISE_BURST_SECONDS, DRAW_NOISE_FLASH_CARBON, DRAW_NOISE_NUDGE, DRAW_NOISE_READ_EVERY,
    DRAW_NOISE_SNAPSHOT_EVERY, DRAW_NOISE_STREAM_STRIDE, DRAW_NOISE_STREAMS, LAB_SEED,
} from '../config';
import { burnTemperature } from '../core';
import { coreShares, firstReaching, fuelShareNoise, spread } from '../drawNoise';
import { frameSeconds, protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { significant } from '../numbers';
import { readPositions, readTarget } from '../readback';
import { LAB_T0 } from '../thermalGas';
import { countTypes } from '../typeCounts';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const MEGA = 1e6;
const TYPES = 3;                                   // hydrogen, helium, carbon
const sig = (v: number | null): JsonValue => v === null || !Number.isFinite(v) ? null : significant(v, 4);

interface Arm {
    name: string;
    /** Where the random stream starts (substeps). */
    stream: number;
    /** The gravity times this. */
    gravityFactor: number;
    /** A draw arm (one of the spread of the draws). */
    draw: boolean;
}

interface Snapshot {
    seconds: number;
    shares: number[];
    core: number[];
    coreParticles: number;
    hydrogenNoise: number | null;
    heliumNoise: number | null;
    parcelsWhereBurning: number | null;
    burnMK: number | null;
}

interface RunResult {
    arm: Arm;
    /** [s, expected fusions per second] every DRAW_NOISE_READ_EVERY frames. */
    rates: [number, number][];
    snapshots: Snapshot[];
    /** The type of every particle at the end (the replay's check). */
    finalTypes: Float32Array;
}

async function runArm(context: LabContext, arm: Arm): Promise<RunResult> {
    const { renderer, simulation, options } = context;
    const count = options.baselineParticles;
    const gravity = defaultParams(PROTOSTAR)[PROTOSTAR_PARAM.gravity];
    const overrides = arm.gravityFactor !== 1 && typeof gravity === 'number' ? { [PROTOSTAR_PARAM.gravity]: gravity * arm.gravityFactor } : undefined;
    await restart(context, { count, seed: LAB_SEED, overrides });
    const model = protostarModel(context);
    model.debugStartRandomStream(arm.stream);
    const cell = Math.max(simulation.screenSize.value.x, simulation.screenSize.value.y) / PROTOSTAR_GRID_RES;
    const rates: [number, number][] = [];
    const snapshots: Snapshot[] = [];
    let positions: Float32Array = new Float32Array(0);
    await runFrames(context, options.baselineFrames, {
        endFrame: true,
        async onFrame(frame) {
            const seconds = frame * frameSeconds(context);
            const grids = protostarGrids(context);
            if (frame % DRAW_NOISE_READ_EVERY === 0) {
                const [, , rate] = await readTarget(renderer, grids.reduce2);
                rates.push([seconds, rate]);
            }
            if (frame % DRAW_NOISE_SNAPSHOT_EVERY !== 0 && frame !== options.baselineFrames) return;
            positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
            const gas = await readTarget(renderer, grids.gas);
            const heat = await readTarget(renderer, grids.heat);
            const cells = PROTOSTAR_GRID_RES * PROTOSTAR_GRID_RES;
            const weights = new Float64Array(cells);
            for (let i = 0; i < cells; i++) weights[i] = gas[i * 4] * heat[i * 4];
            const counts = countTypes(positions, count, MAX_SPECIES);
            const total = counts.reduce((s, n) => s + n, 0);
            const peak = model.peakPosition;
            const core = peak ? coreShares(positions, count, peak, CONSTANT_MASS_CORE_RADIUS, TYPES) : { shares: [0, 0, 0], particles: 0 };
            const h = fuelShareNoise(positions, count, cell, PROTOSTAR_GRID_RES, weights, HYDROGEN);
            const he = fuelShareNoise(positions, count, cell, PROTOSTAR_GRID_RES, weights, HELIUM);
            const burn = burnTemperature(gas, heat, cells, LAB_T0);
            snapshots.push({
                seconds, shares: counts.slice(0, TYPES).map(n => n / Math.max(1, total)), core: core.shares, coreParticles: core.particles,
                hydrogenNoise: h?.noise ?? null, heliumNoise: he?.noise ?? null, parcelsWhereBurning: h?.parcels ?? he?.parcels ?? null,
                burnMK: burn === null ? null : burn * PROTOSTAR_T0_KELVIN / MEGA,
            });
        },
    });
    const finalTypes = new Float32Array(count);
    for (let i = 0; i < count; i++) finalTypes[i] = positions[i * 4 + 2];
    return { arm, rates, snapshots, finalTypes };
}

/** What the user sees of a run, the outcomes compared between the runs. */
function outcomes(run: RunResult): Record<string, number | null> {
    const { snapshots, rates } = run;
    const atBurst = snapshots.reduce((best, s) => Math.abs(s.seconds - DRAW_NOISE_BURST_SECONDS) < Math.abs(best.seconds - DRAW_NOISE_BURST_SECONDS) ? s : best);
    const last = snapshots[snapshots.length - 1];
    const peak = rates.reduce((best, r) => r[1] > best[1] ? r : best, [0, 0]);
    const late = snapshots.slice(Math.floor(snapshots.length * 0.75)).map(s => s.burnMK).filter((v): v is number => v !== null);
    return {
        hydrogenBurntInFirstBurst: 1 - atBurst.shares[0],
        peakFusionsPerSecond: peak[1],
        peakAtSeconds: peak[0],
        heliumFlashSeconds: firstReaching(snapshots.map(s => [s.seconds, s.shares[2]] as const), DRAW_NOISE_FLASH_CARBON),
        finalHydrogen: last.shares[0],
        finalHelium: last.shares[1],
        finalCarbon: last.shares[2],
        coreHydrogenAtEnd: last.core[0],
        coreCarbonAtEnd: last.core[2],
        burnMKLastQuarter: late.length > 0 ? late.reduce((s, v) => s + v, 0) / late.length : null,
    };
}

/** The first time two runs' shares of the mass differ by more than `level` (any type), or null. */
function divergence(a: RunResult, b: RunResult, level: number): number | null {
    const n = Math.min(a.snapshots.length, b.snapshots.length);
    for (let i = 0; i < n; i++) {
        if (a.snapshots[i].shares.some((s, k) => Math.abs(s - b.snapshots[i].shares[k]) > level)) return a.snapshots[i].seconds;
    }
    return null;
}

const drawNoise: Scenario = {
    id: 'spike.c3.draw-noise',
    title: 'Spike C3: the default cloud with other fusion draws only, against the same cloud nudged by 1e-6 of gravity (is the draw noise of A4 visible?)',
    tags: ['spike', 'protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const arms: Arm[] = [
            ...Array.from({ length: DRAW_NOISE_STREAMS }, (_, k): Arm => ({ name: `draw ${k}`, stream: k * DRAW_NOISE_STREAM_STRIDE, gravityFactor: 1, draw: true })),
            { name: 'draw 0 again', stream: 0, gravityFactor: 1, draw: false },
            { name: 'gravity + 1e-6', stream: 0, gravityFactor: 1 + DRAW_NOISE_NUDGE, draw: false },
            { name: 'gravity - 1e-6', stream: 0, gravityFactor: 1 - DRAW_NOISE_NUDGE, draw: false },
        ];
        const runs: RunResult[] = [];
        for (const arm of arms) runs.push(await runArm(context, arm));
        const base = runs[0];
        const replay = runs.find(r => r.arm.name === 'draw 0 again');
        const replayDiffers = replay ? replay.finalTypes.reduce((n, t, i) => n + (t !== base.finalTypes[i] ? 1 : 0), 0) : -1;
        const table = runs.map(r => ({ name: r.arm.name, values: outcomes(r) }));
        const keys = Object.keys(outcomes(base));
        const draws = table.filter((_, i) => runs[i].arm.draw);
        const nudged = table.filter((_, i) => runs[i].arm.gravityFactor !== 1);
        const spreadOf = (rows: typeof table): Record<string, JsonValue> => Object.fromEntries(keys.map(key => {
            const s = spread(rows.map(row => row.values[key]));
            return [key, s ? { mean: sig(s.mean), std: sig(s.std), relative: sig(s.relative) } : null];
        }));
        // The noise of the fuel where it burns, over the snapshots where something burns: median and range of the draw runs.
        const noiseSeries = (pick: (s: Snapshot) => number | null): JsonValue => base.snapshots.map(s => [sig(s.seconds), sig(pick(s))]);
        const hNoise = base.snapshots.map(s => s.hydrogenNoise).filter((v): v is number => v !== null).sort((x, y) => x - y);
        const heNoise = base.snapshots.map(s => s.heliumNoise).filter((v): v is number => v !== null).sort((x, y) => x - y);
        const median = (v: number[]): number | null => v.length > 0 ? v[Math.floor(v.length / 2)] : null;
        // The Poisson noise of the fusions of one reading of the stats (the expected rate times the interval between readings).
        const interval = DRAW_NOISE_READ_EVERY * frameSeconds(context);
        const poisson = base.rates.filter(r => r[1] > 0).map(r => 1 / Math.sqrt(r[1] * interval)).sort((x, y) => x - y);
        const divergenceOf = (other: RunResult | undefined, level: number): JsonValue => other ? sig(divergence(base, other, level)) : null;
        const levels = [0.001, 0.01, 0.05];
        const pairs = runs.slice(1).map(r => ({ name: r.arm.name, ...Object.fromEntries(levels.map(l => [`${l * 100}%`, divergenceOf(r, l)])) }));
        return {
            status: replayDiffers === 0 ? 'pass' : 'fail',
            metrics: {
                particles: context.options.baselineParticles, frames: context.options.baselineFrames, seed: LAB_SEED,
                replayParticlesOfAnotherType: replayDiffers,
                runs: table.map(row => ({ name: row.name, ...Object.fromEntries(Object.entries(row.values).map(([k, v]) => [k, sig(v)])) })),
                spreadOfDraws: spreadOf(draws), spreadOfNudges: spreadOf([table[0], ...nudged]),
                firstDivergenceFromDraw0Seconds: pairs,
                fuelShareNoise: {
                    hydrogenMedian: sig(median(hNoise)), hydrogenRange: [sig(hNoise[0] ?? null), sig(hNoise[hNoise.length - 1] ?? null)],
                    heliumMedian: sig(median(heNoise)), heliumRange: [sig(heNoise[0] ?? null), sig(heNoise[heNoise.length - 1] ?? null)],
                    hydrogenSeries: noiseSeries(s => s.hydrogenNoise), heliumSeries: noiseSeries(s => s.heliumNoise),
                    parcelsWhereBurningSeries: noiseSeries(s => s.parcelsWhereBurning),
                },
                poissonNoisePerReading: { intervalSeconds: sig(interval), median: sig(median(poisson)), worst: sig(poisson[poisson.length - 1] ?? null) },
                sharesSeries: Object.fromEntries(runs.map(r => [r.arm.name, r.snapshots.map(s => [sig(s.seconds), ...s.shares.map(sig)])])),
            },
            details: `${runs.length} runs; the replay ${replayDiffers === 0 ? 'is identical' : `differs (${replayDiffers} particles)`}; `
                + `H burnt in the first burst: draws ${draws.map(d => sig(d.values.hydrogenBurntInFirstBurst)).join(', ')}, nudges ${nudged.map(d => sig(d.values.hydrogenBurntInFirstBurst)).join(', ')}; `
                + `carbon at the end: draws ${draws.map(d => sig(d.values.finalCarbon)).join(', ')}, nudges ${nudged.map(d => sig(d.values.finalCarbon)).join(', ')}`,
        };
    },
};

export const drawNoiseScenarios: Scenario[] = [drawNoise];
