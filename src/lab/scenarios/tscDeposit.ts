// The TSC deposit (proposal C4, the `tscDeposit` switch of both algorithms), measured before it is adopted: is the gain in noise and
// in aliasing real, and what does it cost? Each scenario runs both kernels in the same session.
//  - deposit.tsc.parity: the GPU deposit with each kernel against the CPU reference of each kernel (the protostar's moments and
//    composition, the dust's density grid): the switch must really change the kernel, and the TSC shaders match the reference;
//  - protostar.tsc.noise: the professor's test, a thermal gas at rest: the noise of the temperature and of the density from cell to cell,
//    the effective number of particles it implies against the one the gas pass computes (NOISE_N_SHAPE), and the theory of depositKernel.ts;
//  - protostar.tsc.aliasing: the pull of a point mass on massless probes as the mass moves inside its cell (aliasing) and around it
//    (anisotropy), and the force of the mass on itself;
//  - dust.tsc.noise: the noise of the mass of the dust's density texels, and of the coarser levels its gravity reads, in a uniform cloud;
//  - cost.tsc-deposit: simulation ms per frame with each kernel, alternated, and the deposit passes alone on a frozen state.

import { DENSITY_RES, PROTOSTAR_GRID_RES, PROTOSTAR_NOISE_N_SHAPE, PROTOSTAR_NOISE_N_SHAPE_TSC } from '../../config';
import { neighborhoodNoiseShape, type DepositKernel } from '../../simulation/depositKernel';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import { STICKY_DUST_PARAM } from '../../simulation/stickyDust/declaration';
import {
    COST_CHUNK_FRAMES, COST_EARLY_FRAMES, COST_FROZEN_ROUNDS, COST_FROZEN_SUBSTEPS, COST_ROUNDS, DEPOSIT_ROUNDINGS, DEPOSIT_ROUNDOFF_FLOAT32,
    DEPOSIT_ROUNDOFF_HALF, DEPOSIT_WEIGHT_ERROR, DEPOSIT_WEIGHT_MARGIN, DUST_DEPOSIT_SEED, DUST_DEPOSIT_SPARSE_FRAMES, DUST_DEPOSIT_SPARSE_PARTICLES,
    LAB_AREA, PERF_WARMUP_FRAMES, PERF_WARMUP_MS, SECOND_DEPOSIT_FRAMES, SECOND_DEPOSIT_PARTICLES, SECOND_DEPOSIT_WEIGHTS, THERMAL_GAS_MARGIN,
    THERMAL_GAS_OVERRIDES, TSC_BLOB_OFFSETS, TSC_BLOB_PARTICLES, TSC_COST_DUST_COUNTS, TSC_COST_PROTOSTAR_COUNTS, TSC_DUST_COUNTS, TSC_DUST_FILL,
    TSC_DUST_LEVELS, TSC_NOISE_COUNTS, TSC_NOISE_DRAWS, TSC_NOISE_TEMPERATURE, TSC_RING_ANGLES, TSC_RING_RADII,
} from '../config';
import { compareDeposit, referenceDeposit } from '../depositReference';
import { protostarGrids, protostarModel, restart, runFrames, stickyDustModel } from '../driver';
import { alternatingOrders, mean, quantile, significant } from '../numbers';
import { mulberry32, withSeededRandom } from '../random';
import { readAttachment, readPositions, readTarget } from '../readback';
import { fillThermalGas, interiorCells, LAB_CELL, thermalSigma, type Box } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';
import { validateDeposit } from './dustGranular';
import { timeChunks, warmUp } from './perf';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);
const KERNELS: readonly DepositKernel[] = ['cic', 'tsc'];
const ACCEL = 'textureAccel';
const SEED = 9090;

const SOFTWARE_SKIP = (context: LabContext): ScenarioOutcome => ({
    status: 'skip', metrics: {}, details: `a software renderer (${context.rendererName}) would take hours to draw millions of particles`,
});

function relativeVariance(values: readonly number[]): number {
    const m = mean(values);
    return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length / (m * m);
}

// ---- deposit.tsc.parity ----

/** The protostar's composition deposit drawn with `kernel`, against the CPU reference of each kernel: the worst error over tolerance. */
async function protostarParity(context: LabContext, kernel: DepositKernel): Promise<Record<DepositKernel, number>> {
    const { renderer, simulation } = context;
    await restart(context, { count: SECOND_DEPOSIT_PARTICLES, weights: SECOND_DEPOSIT_WEIGHTS, params: { [PROTOSTAR_PARAM.tscDeposit]: kernel === 'tsc' } });
    await runFrames(context, SECOND_DEPOSIT_FRAMES);
    const model = protostarModel(context);
    model.beforeSubstep(0);                          // the grids of the positions as they are now
    const count = simulation.activeCount;
    const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const gpu = await readAttachment(renderer, protostarGrids(context).moments, 1);
    const tolerance = { roundoff: context.floatBlend ? DEPOSIT_ROUNDOFF_FLOAT32 : DEPOSIT_ROUNDOFF_HALF, roundings: DEPOSIT_ROUNDINGS, weightError: DEPOSIT_WEIGHT_ERROR };
    const worst = (reference: DepositKernel): number => Math.max(...compareDeposit(gpu,
        referenceDeposit(positions, count, model.debugGrids.debugDepositInputs, DEPOSIT_WEIGHT_MARGIN, reference), tolerance).map(c => c.maxExcess));
    return { cic: worst('cic'), tsc: worst('tsc') };
}

const parity: Scenario = {
    id: 'deposit.tsc.parity',
    title: 'TSC deposit (C4): the GPU deposit of each kernel against the CPU reference of each kernel, protostar and dust',
    tags: ['protostar', 'dust', 'tsc', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const protostar: Record<string, JsonValue> = {};
        const dust: Record<string, JsonValue> = {};
        let ok = true;
        for (const kernel of KERNELS) {
            const other: DepositKernel = kernel === 'cic' ? 'tsc' : 'cic';
            const excess = await protostarParity(context, kernel);
            protostar[kernel] = { againstSameKernel: round(excess[kernel]), againstOtherKernel: round(excess[other]) };
            // The dust's sparse cloud, judged against the half-float tolerance model of dust.deposit (its grid is half floats).
            const prepare = async (): Promise<void> => {
                await restart(context, {
                    algorithm: 'stickyDust', count: DUST_DEPOSIT_SPARSE_PARTICLES, seed: DUST_DEPOSIT_SEED, params: { [STICKY_DUST_PARAM.tscDeposit]: kernel === 'tsc' },
                });
                await withSeededRandom(DUST_DEPOSIT_SEED, () => runFrames(context, DUST_DEPOSIT_SPARSE_FRAMES));
            };
            const same = await validateDeposit(context, prepare, `sparse donut, ${kernel}`, kernel);
            const crossed = await validateDeposit(context, prepare, `sparse donut, ${kernel} against ${other}`, other);
            const worst = (r: typeof same): number => Math.max(...r.comparisons.map(c => c.maxExcess));
            dust[kernel] = { againstSameKernel: round(worst(same)), againstOtherKernel: round(worst(crossed)) };
            // (Infinity, printed null, against the other kernel: it has mass in cells the other leaves empty.)
            // Within tolerance against its own kernel, far outside it against the other one (the switch changed the kernel).
            ok &&= excess[kernel] <= 1 && excess[other] > 1 && worst(same) <= 1 && worst(crossed) > 1;
        }
        return {
            status: ok ? 'pass' : 'fail',
            metrics: { worstErrorOverTolerance: { protostar, dust } },
            details: KERNELS.map(k => `${k}: protostar ${JSON.stringify(protostar[k])}, dust ${JSON.stringify(dust[k])}`).join('; '),
        };
    },
};

// ---- protostar.tsc.noise ----

interface NoiseReading {
    temperatureVariance: number;
    densityVariance: number;
    /** Mean temperature of the interior cells over the gas's own. */
    temperatureRatio: number;
    /** Mean effective number of particles the gas pass computes. */
    gridParticles: number;
}

async function noiseReading(context: LabContext, kernel: DepositKernel, count: number, seed: number, box: Box): Promise<NoiseReading> {
    const { renderer } = context;
    const sigma = thermalSigma(TSC_NOISE_TEMPERATURE);
    const model = protostarModel(context);
    model.debugInitialState = state => fillThermalGas(state, box, sigma, mulberry32(seed));
    try {
        await restart(context, {
            count, overrides: { ...THERMAL_GAS_OVERRIDES, feedback: 0, fusionRate: 0 }, seed,
            params: { [PROTOSTAR_PARAM.tscDeposit]: kernel === 'tsc' },
        });
    } finally {
        model.debugInitialState = null;
    }
    protostarModel(context).beforeSubstep(0);       // the grids of the gas as it was drawn
    const targets = protostarGrids(context);
    const gas = await readTarget(renderer, targets.gas);
    const thermo = await readAttachment(renderer, targets.gas, 1);
    const cells = interiorCells(box);
    const temperatures: number[] = [], densities: number[] = [], particles: number[] = [];
    for (let cy = cells.y0; cy < cells.y1; cy++) {
        for (let cx = cells.x0; cx < cells.x1; cx++) {
            const cell = (cy * PROTOSTAR_GRID_RES + cx) * 4;
            densities.push(gas[cell]);
            temperatures.push(gas[cell + 1]);
            particles.push(thermo[cell + 1]);
        }
    }
    return {
        temperatureVariance: relativeVariance(temperatures), densityVariance: relativeVariance(densities),
        temperatureRatio: mean(temperatures) / (2 * sigma * sigma), gridParticles: mean(particles),
    };
}

const noise: Scenario = {
    id: 'protostar.tsc.noise',
    title: 'TSC deposit (C4): noise of the temperature and of the density from cell to cell of a thermal gas at rest, per kernel',
    tags: ['protostar', 'tsc', 'noise', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return SOFTWARE_SKIP(context);
        await restart(context, { count: 1000 });     // a protostar model to hand the initial states to
        const box: Box = { x0: THERMAL_GAS_MARGIN, y0: THERMAL_GAS_MARGIN, x1: LAB_AREA.width - THERMAL_GAS_MARGIN, y1: LAB_AREA.height - THERMAL_GAS_MARGIN };
        const rows: Record<string, JsonValue>[] = [];
        const gains: number[] = [];
        for (const count of TSC_NOISE_COUNTS) {
            const byKernel = {} as Record<DepositKernel, NoiseReading>;
            for (const kernel of KERNELS) {
                const readings: NoiseReading[] = [];
                // The same draws for both kernels: the same particles at the same places.
                for (let d = 0; d < TSC_NOISE_DRAWS; d++) readings.push(await noiseReading(context, kernel, count, SEED + d, box));
                const avg = (f: (r: NoiseReading) => number): number => mean(readings.map(f));
                byKernel[kernel] = {
                    temperatureVariance: avg(r => r.temperatureVariance), densityVariance: avg(r => r.densityVariance),
                    temperatureRatio: avg(r => r.temperatureRatio), gridParticles: avg(r => r.gridParticles),
                };
            }
            const row: Record<string, JsonValue> = { particles: count };
            for (const kernel of KERNELS) {
                const r = byKernel[kernel];
                // The temperature of N particles is a Gamma law of shape about N: its relative variance is 1 / N_eff.
                const fitted = 1 / r.temperatureVariance;
                row[kernel] = {
                    temperatureRelativeVariance: round(r.temperatureVariance), densityRelativeVariance: round(r.densityVariance),
                    meanTemperatureOverTrue: round(r.temperatureRatio), gridEffectiveParticles: round(r.gridParticles),
                    fittedEffectiveParticles: round(fitted), fittedOverGrid: round(fitted / r.gridParticles),
                    // What NOISE_N_SHAPE would be for the cells' own estimate (the particles read between cells: more, see depositKernel.ts).
                    shapeAtCellCenters: round((kernel === 'tsc' ? PROTOSTAR_NOISE_N_SHAPE_TSC : PROTOSTAR_NOISE_N_SHAPE) * fitted / r.gridParticles),
                    shapeTheoryAtCellCenters: round(neighborhoodNoiseShape(kernel, 0)),
                };
            }
            const gain = byKernel.cic.temperatureVariance / byKernel.tsc.temperatureVariance;
            gains.push(gain);
            row.temperatureVarianceGain = round(gain);
            row.densityVarianceGain = round(byKernel.cic.densityVariance / byKernel.tsc.densityVariance);
            row.temperatureNoiseGainPercent = round(100 * (1 - Math.sqrt(1 / gain)));
            rows.push(row);
        }
        const theory = neighborhoodNoiseShape('tsc', 0) / neighborhoodNoiseShape('cic', 0);
        return {
            status: gains.every(Number.isFinite) ? 'pass' : 'fail',
            metrics: { temperatureT0: TSC_NOISE_TEMPERATURE, draws: TSC_NOISE_DRAWS, rows, temperatureVarianceGainTheoryAtCellCenters: round(theory) },
            details: rows.map(r => `${String(r.particles)} particles: variance of T ${String(r.temperatureVarianceGain)}x lower with TSC `
                + `(noise -${String(r.temperatureNoiseGainPercent)} %), of rho ${String(r.densityVarianceGain)}x`).join('; ')
                + `; theory ${theory.toFixed(3)}x`,
        };
    },
};

// ---- protostar.tsc.aliasing ----

interface AliasingRun {
    /** Radial pull (toward the blob, px/s^2) of each probe, by ring then angle. */
    pulls: number[][];
    tangential: number[][];
    /** The blob's acceleration on itself (mean over its particles), px/s^2. */
    selfForce: number;
}

async function aliasingRun(context: LabContext, kernel: DepositKernel, offset: number): Promise<AliasingRun> {
    const { renderer, simulation } = context;
    const cell = LAB_CELL;
    const center = [(Math.floor(LAB_AREA.width / cell / 2) + 0.5 + offset) * cell, (Math.floor(LAB_AREA.height / cell / 2) + 0.5 + offset) * cell];
    const probes = TSC_RING_RADII.length * TSC_RING_ANGLES;
    const count = TSC_BLOB_PARTICLES + probes;
    const model = protostarModel(context);
    model.debugInitialState = state => {
        state.positions.fill(0);
        state.velocities.fill(0);
        for (let i = 0; i < state.count; i++) {
            let [x, y, type] = [center[0], center[1], 0];
            if (i >= TSC_BLOB_PARTICLES) {
                const k = i - TSC_BLOB_PARTICLES;
                const radius = TSC_RING_RADII[Math.floor(k / TSC_RING_ANGLES)] * cell;
                const angle = 2 * Math.PI * ((k % TSC_RING_ANGLES) + 0.5) / TSC_RING_ANGLES;
                [x, y, type] = [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), 1];
            }
            state.positions.set([x, y, type, 1], i * 4);
        }
    };
    try {
        // One substep a frame: the acceleration texture holds a(x_0) after the first frame.
        await restart(context, {
            count, overrides: { radiation: 0, feedback: 0, fusionRate: 0 }, timeScale: 0.85,
            params: { [PROTOSTAR_PARAM.tscDeposit]: kernel === 'tsc' },
        });
    } finally {
        model.debugInitialState = null;
    }
    // The probes (type 1) weigh nothing: only the blob is deposited.
    const masses = model.debugGrids.debugDepositInputs.depositMass.map((m, k) => (k === 0 ? m : 0));
    model.debugGrids.setDepositMasses(masses);
    simulation.step();
    await context.sync.wait(simulation.positionTexture);
    const accel = await readPositions(renderer, simulation.debugPipeline.debugVariableTarget(ACCEL), count);
    let sx = 0, sy = 0;
    for (let i = 0; i < TSC_BLOB_PARTICLES; i++) { sx += accel[i * 4]; sy += accel[i * 4 + 1]; }
    const pulls: number[][] = [], tangential: number[][] = [];
    for (let r = 0; r < TSC_RING_RADII.length; r++) {
        pulls.push([]); tangential.push([]);
        for (let a = 0; a < TSC_RING_ANGLES; a++) {
            const angle = 2 * Math.PI * (a + 0.5) / TSC_RING_ANGLES;
            const i = TSC_BLOB_PARTICLES + r * TSC_RING_ANGLES + a;
            const [ax, ay] = [accel[i * 4], accel[i * 4 + 1]];
            pulls[r].push(-(ax * Math.cos(angle) + ay * Math.sin(angle)));
            tangential[r].push(-ax * Math.sin(angle) + ay * Math.cos(angle));
        }
    }
    return { pulls, tangential, selfForce: Math.hypot(sx, sy) / TSC_BLOB_PARTICLES };
}

const rms = (values: readonly number[]): number => Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);

const aliasing: Scenario = {
    id: 'protostar.tsc.aliasing',
    title: 'TSC deposit (C4): the pull of a point mass on probes against its place in its cell (aliasing) and the angle, and its force on itself',
    tags: ['protostar', 'tsc', 'gravity', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: 1000 });     // a protostar model to hand the initial states to
        const result: Record<string, JsonValue> = {};
        const summary: string[] = [];
        for (const kernel of KERNELS) {
            const runs: AliasingRun[] = [];
            for (const offset of TSC_BLOB_OFFSETS) runs.push(await aliasingRun(context, kernel, offset));
            const rings = TSC_RING_RADII.map((radius, r) => {
                const ringMeans = runs.map(run => mean(run.pulls[r]));
                const overall = mean(ringMeans);
                // Aliasing: how the ring's mean pull moves with the blob's place in its cell. Anisotropy: how the pull varies around the ring.
                const aliasingRms = rms(ringMeans.map(m => m / overall - 1));
                const anisotropyRms = mean(runs.map(run => rms(run.pulls[r].map(p => p / mean(run.pulls[r]) - 1))));
                const tangentialRms = mean(runs.map(run => rms(run.tangential[r]))) / overall;
                return { radiusCells: radius, meanPull: round(overall), aliasingRms: round(aliasingRms), anisotropyRms: round(anisotropyRms), tangentialOverPull: round(tangentialRms) };
            });
            const innerPull = rings[0].meanPull;
            const selfForces = runs.map(run => run.selfForce / innerPull);
            result[kernel] = {
                rings,
                selfForceOverInnerPull: { byOffset: selfForces.map(round), max: round(Math.max(...selfForces)) },
            };
            summary.push(`${kernel}: aliasing ${rings.map(r => `${r.radiusCells}c ${(100 * r.aliasingRms).toFixed(2)}%`).join(', ')}; `
                + `anisotropy ${rings.map(r => `${(100 * r.anisotropyRms).toFixed(2)}%`).join(', ')}; self-force up to ${(100 * Math.max(...selfForces)).toFixed(2)} % of the pull at ${TSC_RING_RADII[0]} cells`);
        }
        return {
            status: 'pass',
            metrics: { blobParticles: TSC_BLOB_PARTICLES, offsetsAlongDiagonal: [...TSC_BLOB_OFFSETS], ringAngles: TSC_RING_ANGLES, ...result },
            details: summary.join(' | '),
        };
    },
};

// ---- dust.tsc.noise ----

/** Relative variance of the texels' mass inside `[lo, hi)` texels (both axes) at the level `level` (blocks of 2^level texels summed). */
function levelVariance(grid: Float32Array, lo: number, hi: number, level: number): number {
    const block = 2 ** level;
    const values: number[] = [];
    for (let by = Math.ceil(lo / block); (by + 1) * block <= hi; by++) {
        for (let bx = Math.ceil(lo / block); (bx + 1) * block <= hi; bx++) {
            let sum = 0;
            for (let y = by * block; y < (by + 1) * block; y++) for (let x = bx * block; x < (bx + 1) * block; x++) sum += grid[(y * DENSITY_RES + x) * 4];
            values.push(sum);
        }
    }
    return relativeVariance(values);
}

const dustNoise: Scenario = {
    id: 'dust.tsc.noise',
    title: 'TSC deposit (C4): noise of the mass of the dust density texels and of their coarser levels in a uniform cloud, per kernel',
    tags: ['dust', 'tsc', 'noise', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation } = context;
        const rows: Record<string, JsonValue>[] = [];
        for (const count of TSC_DUST_COUNTS) {
            const row: Record<string, JsonValue> = { particles: count };
            const variances = {} as Record<DepositKernel, number[]>;
            for (const kernel of KERNELS) {
                await restart(context, { algorithm: 'stickyDust', count, weights: [1, 0, 0], seed: SEED, params: { [STICKY_DUST_PARAM.tscDeposit]: kernel === 'tsc' } });
                const n = simulation.activeCount;
                const random = mulberry32(SEED + count);
                const positions = new Float32Array(n * 4);
                const lo = (1 - TSC_DUST_FILL) / 2;
                for (let i = 0; i < n; i++) {
                    positions.set([LAB_AREA.width * (lo + TSC_DUST_FILL * random()), LAB_AREA.height * (lo + TSC_DUST_FILL * random()), 0, 1], i * 4);
                }
                simulation.debugPipeline.debugSetState(positions, new Float32Array(n * 4));
                const density = stickyDustModel(context).debugDensity;
                density.domainOffset.value.set(0, 0);
                density.render(simulation.positionTexture, simulation.velocityTexture);
                const grid = await readTarget(renderer, density.target);
                // The texels well inside the cloud (the domain is DENSITY_DOMAIN_SCALE times the area: texel = domainSize / DENSITY_RES px).
                const texel = density.domainSize.value / DENSITY_RES;
                const [x0, x1] = [LAB_AREA.width * lo / texel + 4, LAB_AREA.width * (lo + TSC_DUST_FILL) / texel - 4];
                const [y0, y1] = [LAB_AREA.height * lo / texel + 4, LAB_AREA.height * (lo + TSC_DUST_FILL) / texel - 4];
                const [a, b] = [Math.ceil(Math.max(x0, y0)), Math.floor(Math.min(x1, y1))];
                variances[kernel] = Array.from({ length: TSC_DUST_LEVELS + 1 }, (_, level) => levelVariance(grid, a, b, level));
                row[kernel] = { relativeVarianceByLevel: variances[kernel].map(round) };
            }
            row.varianceGainByLevel = variances.cic.map((v, level) => round(v / variances.tsc[level]));
            rows.push(row);
        }
        return {
            status: 'pass',
            metrics: { fill: TSC_DUST_FILL, rows },
            details: rows.map(r => `${String(r.particles)} grains: variance gain by level ${JSON.stringify(r.varianceGainByLevel)}`).join('; '),
        };
    },
};

// ---- cost.tsc-deposit ----

type Timings = Record<DepositKernel, number[]>;

async function alternate(rounds: number, measure: (kernel: DepositKernel) => Promise<number>): Promise<Timings> {
    const out: Timings = { cic: [], tsc: [] };
    for (const order of alternatingOrders(KERNELS, rounds)) for (const kernel of order) out[kernel].push(await measure(kernel));
    return out;
}

function summarize(t: Timings): Record<string, JsonValue> {
    const differences = t.tsc.map((v, i) => v - t.cic[i]);
    const cic = quantile(t.cic, 0.5);
    return {
        medianCic: round(cic), medianTsc: round(quantile(t.tsc, 0.5)), medianDifference: round(quantile(differences, 0.5)),
        medianDifferenceOverCic: round(quantile(differences, 0.5) / cic),
        minDifference: round(Math.min(...differences)), maxDifference: round(Math.max(...differences)),
    };
}

async function costCase(context: LabContext, algorithm: 'protostar' | 'stickyDust', count: number): Promise<Record<string, JsonValue>> {
    const { simulation } = context;
    const key = algorithm === 'protostar' ? PROTOSTAR_PARAM.tscDeposit : STICKY_DUST_PARAM.tscDeposit;
    const simulate = (): void => { simulation.step(); simulation.endFrame(); };
    await restart(context, { algorithm, count });
    await warmUp(context, simulate, COST_EARLY_FRAMES, COST_EARLY_FRAMES, 0);
    // The deposit passes alone on the frozen state (the protostar's every grid pass: the deposits are two of them).
    const frozen = async (kernel: DepositKernel): Promise<number> => {
        simulation.setParam(key, kernel === 'tsc');
        const start = performance.now();
        if (algorithm === 'protostar') {
            const model = protostarModel(context);
            for (let i = 0; i < COST_FROZEN_SUBSTEPS; i++) model.beforeSubstep(0);
        } else {
            const density = stickyDustModel(context).debugDensity;
            for (let i = 0; i < COST_FROZEN_SUBSTEPS; i++) density.render(simulation.positionTexture, simulation.velocityTexture);
        }
        await context.sync.wait(simulation.positionTexture);
        return (performance.now() - start) / COST_FROZEN_SUBSTEPS;
    };
    const passes = await alternate(COST_FROZEN_ROUNDS, frozen);
    await warmUp(context, simulate, COST_CHUNK_FRAMES, PERF_WARMUP_FRAMES, PERF_WARMUP_MS);
    const frames = await alternate(COST_ROUNDS, async kernel => {
        simulation.setParam(key, kernel === 'tsc');
        return (await timeChunks(context, simulate, COST_CHUNK_FRAMES, 1))[0];
    });
    simulation.setParam(key, false);
    return { algorithm, particles: simulation.activeCount, depositPassesMsPerSubstep: summarize(passes), simulationMsPerFrame: summarize(frames) };
}

const cost: Scenario = {
    id: 'cost.tsc-deposit',
    title: 'TSC deposit (C4): simulation ms per frame and deposit passes alone, alternated between the kernels, protostar and dust',
    tags: ['cost', 'slow', 'tsc', 'protostar', 'dust'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) {
            return { status: 'skip', metrics: { valid: false }, details: `INVALID: software renderer (${context.rendererName}), timings are meaningless.` };
        }
        const cases: Record<string, JsonValue>[] = [];
        for (const count of TSC_COST_PROTOSTAR_COUNTS) cases.push(await costCase(context, 'protostar', count));
        for (const count of TSC_COST_DUST_COUNTS) cases.push(await costCase(context, 'stickyDust', count));
        const line = (c: Record<string, JsonValue>): string => {
            const f = c.simulationMsPerFrame as Record<string, number>;
            const p = c.depositPassesMsPerSubstep as Record<string, number>;
            return `${String(c.algorithm)} ${String(c.particles)}: frame ${f.medianCic} -> ${f.medianTsc} ms (${(100 * f.medianDifferenceOverCic).toFixed(1)} %), `
                + `passes ${p.medianCic} -> ${p.medianTsc} ms`;
        };
        return { status: 'pass', metrics: { valid: true, renderer: context.rendererName, rounds: COST_ROUNDS, chunkFrames: COST_CHUNK_FRAMES, cases }, details: cases.map(line).join('; ') };
    },
};

export const tscDepositScenarios: readonly Scenario[] = [parity, noise, aliasing, dustNoise, cost];
