// Acceptance of the fusion heating by velocity scaling (proposal A5): the energy it adds and the
// momentum it leaves alone, on gases of known temperature, set up directly (the model's debug
// initial state) with gravity and cooling off and a hydrogen that fuses at a fixed rate whatever
// its temperature, so that the heating is known and the same everywhere. One substep is run, and
// the velocities before and after are compared. Two setups:
//  - blobs of particles exactly at the center of a grid cell, on a lattice of isolated cells: each
//    blob reads the gas state of its own cell alone, so the energy gained must be q dt per particle
//    to rounding and the momentum must not move (the plan's per-cell criterion);
//  - a uniform gas of 400 000 particles with all the interpolation of the real thing, where the same
//    holds on average over the cells, and where the scaling is compared with the random kick it
//    replaces (the same gas, the kick forced by raising the floor of the cold cells).

import { PROTOSTAR_GRID_RES } from '../../config';
import type { InitialState } from '../../simulation/gpuModel';
import { heatedVelocity } from '../../simulation/protostar/heating';
import {
    HEATING_BLOB_BULK, HEATING_BLOB_PARTICLES, HEATING_BLOB_SPACING, HEATING_BLOB_TEMPERATURES, HEATING_COLD_ENERGY_TOLERANCE, HEATING_COLD_EVERY, HEATING_COLD_TEMPERATURE,
    HEATING_ENERGY_TOLERANCE, HEATING_MOMENTUM_TOLERANCE, HEATING_RATE, HEATING_SEED, HEATING_UNIFORM_PARTICLES, HEATING_UNIFORM_PARTICLES_SOFTWARE, LAB_AREA,
    THERMAL_GAS_INTERIOR_CELLS, THERMAL_GAS_MARGIN, THERMAL_GAS_OVERRIDES, THERMAL_GAS_TEMPERATURE,
} from '../config';
import { protostarGrids, protostarModel, restart } from '../driver';
import { heatingTotals, sampleGas, type GasSample } from '../heatingReference';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readPositions, readTarget } from '../readback';
import { fillBlobs, fillThermalGas, LAB_CELL, LAB_T0, thermalSigma, type Blob, type Box } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
/** A dispersion floor that no gas reaches: the cold-cell kick for every particle, as before the scaling. */
const KICK_ALWAYS = 1e30;
const COUNT_FOR_WARMUP = 1000;

const T0 = LAB_T0;
const CELL = LAB_CELL;
/** The standard deviation per component of the uniform gas (T = 2 sigma^2), px/s. */
const SIGMA = thermalSigma(THERMAL_GAS_TEMPERATURE);

/** One substep of a gas, before and after. */
interface HeatedRun {
    count: number;
    /** (vx, vy) before and after, four floats per particle. */
    before: Float32Array;
    after: Float32Array;
    positions: Float32Array;
    /** The grids the substep read: (rho, T, u) and q / T0 per cell. */
    gas: Float32Array;
    heat: Float32Array;
    dt: number;
    maxSpeed: number;
    floor: number;
}

/** Runs one substep of the gas `fill` draws (`count` particles), with the cold cells' kick forced when `kick`. */
async function heatOnce(context: LabContext, count: number, fill: (state: InitialState) => void, kick: boolean): Promise<HeatedRun> {
    const { renderer, simulation, sync } = context;
    // The running algorithm must be the protostar before its model can be given the initial state.
    await restart(context, { count: COUNT_FOR_WARMUP });
    const model = protostarModel(context);
    let before = new Float32Array(0);
    let positions = new Float32Array(0);
    model.debugInitialState = state => {
        fill(state);
        before = state.velocities.slice(0, count * 4);
        positions = state.positions.slice(0, count * 4);
    };
    try {
        await restart(context, { count, overrides: { ...THERMAL_GAS_OVERRIDES, fusionRate: HEATING_RATE }, flatRates: true, timeScale: 1, seed: HEATING_SEED });
    } finally {
        model.debugInitialState = null;
    }
    const floor = kick ? KICK_ALWAYS : model.velocityUniforms.heatingTFloor.value as number;
    model.velocityUniforms.heatingTFloor.value = floor;
    const maxSpeed = model.velocityUniforms.maxSpeed.value as number;
    simulation.step();
    await sync.wait(simulation.positionTexture);
    const grids = protostarGrids(context);
    return {
        count, before, positions, dt: 1 / 60 * simulation.timeScale, maxSpeed, floor,
        after: await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count),
        gas: await readTarget(renderer, grids.gas),
        heat: await readTarget(renderer, grids.heat),
    };
}

/** q (px^2/s^3) of a gas sample. */
const heatingOf = (g: GasSample): number => g.heat * T0;

/** Indices of the particles of a run whose cell lies at least `margin` cells inside `box`. */
function interiorParticles(run: HeatedRun, box: Box, margin: number): number[] {
    const [x0, y0, x1, y1] = [box.x0 + margin * CELL, box.y0 + margin * CELL, box.x1 - margin * CELL, box.y1 - margin * CELL];
    const out: number[] = [];
    for (let i = 0; i < run.count; i++) {
        const x = run.positions[i * 4], y = run.positions[i * 4 + 1];
        if (x >= x0 && x < x1 && y >= y0 && y < y1) out.push(i);
    }
    return out;
}

// ---- The blobs ----

interface BlobReport {
    /** Largest relative error of the energy gained over q dt per particle, over the hot blobs (and over the cold ones, in their own frame). */
    hotEnergyError: number;
    coldEnergyError: number;
    /** Largest momentum gained over the particles' thermal momentum (n sigma), hot blobs. */
    hotMomentum: number;
    /** The same for the cold blobs, over n times the speed of their kick: a kick in a random direction moves the momentum. */
    coldMomentum: number;
    blobs: number;
    cold: number;
}

/** Every HEATING_COLD_EVERY-th blob is cold. */
const isColdBlob = (index: number): boolean => (index + 1) % HEATING_COLD_EVERY === 0;

function blobLattice(random: () => number): Blob[] {
    const blobs: Blob[] = [];
    const [lowT, highT] = HEATING_BLOB_TEMPERATURES;
    const columns = Math.floor((PROTOSTAR_GRID_RES - 4) / HEATING_BLOB_SPACING) + 1;
    const rows = Math.floor((Math.ceil(LAB_AREA.height / CELL) - 4) / HEATING_BLOB_SPACING) + 1;
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < columns; i++) {
            const cold = isColdBlob(blobs.length);
            const temperature = lowT + (highT - lowT) * random();
            blobs.push({
                cell: [2 + i * HEATING_BLOB_SPACING, 2 + j * HEATING_BLOB_SPACING], count: HEATING_BLOB_PARTICLES,
                sigma: SIGMA * Math.sqrt(cold ? HEATING_COLD_TEMPERATURE / THERMAL_GAS_TEMPERATURE : temperature),
                bulk: [(2 * random() - 1) * HEATING_BLOB_BULK, (2 * random() - 1) * HEATING_BLOB_BULK],
            });
        }
    }
    return blobs;
}

function judgeBlobs(run: HeatedRun, blobs: readonly Blob[]): BlobReport {
    const report: BlobReport = { hotEnergyError: 0, coldEnergyError: 0, hotMomentum: 0, coldMomentum: 0, blobs: blobs.length, cold: 0 };
    let first = 0;
    for (const [index, blob] of blobs.entries()) {
        const indices = Array.from({ length: blob.count }, (_, k) => first + k);
        first += blob.count;
        const cell = (blob.cell[1] * PROTOSTAR_GRID_RES + blob.cell[0]) * 4;
        const q = run.heat[cell] * T0;
        const expected = blob.count * q * run.dt;
        const totals = heatingTotals(run.before, run.after, indices);
        // The energy in the frame that moves with the blob: the cold blobs' bulk velocity is not heat.
        let energy = 0;
        for (const i of indices) {
            energy += 0.5 * ((run.after[i * 4] - blob.bulk[0]) ** 2 + (run.after[i * 4 + 1] - blob.bulk[1]) ** 2
                - (run.before[i * 4] - blob.bulk[0]) ** 2 - (run.before[i * 4 + 1] - blob.bulk[1]) ** 2);
        }
        const error = Math.abs(energy - expected) / expected;
        const momentum = Math.hypot(...totals.momentum);
        if (!isColdBlob(index)) {
            report.hotEnergyError = Math.max(report.hotEnergyError, error);
            report.hotMomentum = Math.max(report.hotMomentum, momentum / (blob.count * blob.sigma));
        } else {
            report.cold++;
            report.coldEnergyError = Math.max(report.coldEnergyError, error);
            report.coldMomentum = Math.max(report.coldMomentum, momentum / (blob.count * Math.sqrt(2 * q * run.dt)));
        }
    }
    return report;
}

// ---- The uniform gas ----

interface UniformReport {
    particles: number;
    interiorParticles: number;
    /** Energy gained over q dt summed over the interior particles, minus one. */
    energyError: number;
    /** The same over all the particles. */
    energyErrorAll: number;
    /** Heating as a fraction of the thermal energy of the gas in the step. */
    heatingFraction: number;
    /** Largest difference, over the particles, between the GPU velocity and the twin of the shader, over the thermal speed. */
    twinError: number | null;
    /** Net momentum gained by the interior particles, over N sigma (N: their number). */
    momentum: number;
    /** Over the cells of 8 x 8 px of the interior holding at least 10 particles: the mean and the standard deviation of the energy gained over q dt. */
    cellMean: number;
    cellSpread: number;
}

function judgeUniform(run: HeatedRun, box: Box, twin: boolean): UniformReport {
    const interior = interiorParticles(run, box, THERMAL_GAS_INTERIOR_CELLS);
    const inInterior = new Set(interior);
    const samples = new Array<GasSample>(run.count);
    let heatingSum = 0, heatingSumInterior = 0;
    for (let i = 0; i < run.count; i++) {
        samples[i] = sampleGas(run.positions[i * 4], run.positions[i * 4 + 1], run.gas, run.heat, PROTOSTAR_GRID_RES, CELL);
        heatingSum += heatingOf(samples[i]) * run.dt;
        if (inInterior.has(i)) heatingSumInterior += heatingOf(samples[i]) * run.dt;
    }
    const all = heatingTotals(run.before, run.after, Array.from({ length: run.count }, (_, i) => i));
    const inner = heatingTotals(run.before, run.after, interior);

    let twinError = 0;
    for (let i = 0; i < run.count && twin; i++) {
        const g = samples[i];
        const expected = heatedVelocity([run.before[i * 4], run.before[i * 4 + 1]], g.u, g.t, heatingOf(g), run.dt, run.maxSpeed, run.floor, 0);
        twinError = Math.max(twinError, Math.hypot(run.after[i * 4] - expected[0], run.after[i * 4 + 1] - expected[1]) / SIGMA);
    }

    // The same sums per cell of the interior.
    const perCell = new Map<number, { n: number; gained: number; expected: number }>();
    for (const i of interior) {
        const key = Math.floor(run.positions[i * 4] / CELL) * 1024 + Math.floor(run.positions[i * 4 + 1] / CELL);
        const entry = perCell.get(key) ?? { n: 0, gained: 0, expected: 0 };
        entry.n++;
        entry.gained += 0.5 * (run.after[i * 4] ** 2 + run.after[i * 4 + 1] ** 2 - run.before[i * 4] ** 2 - run.before[i * 4 + 1] ** 2);
        entry.expected += heatingOf(samples[i]) * run.dt;
        perCell.set(key, entry);
    }
    const ratios = [...perCell.values()].filter(c => c.n >= 10).map(c => c.gained / c.expected);
    const cellMean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    const cellSpread = Math.sqrt(ratios.reduce((s, r) => s + (r - cellMean) ** 2, 0) / ratios.length);
    return {
        particles: run.count, interiorParticles: interior.length,
        energyError: inner.energy / heatingSumInterior - 1, energyErrorAll: all.energy / heatingSum - 1,
        heatingFraction: heatingSum / run.count / (THERMAL_GAS_TEMPERATURE * T0 / 2),
        twinError: twin ? twinError : null,
        momentum: Math.hypot(...inner.momentum) / (interior.length * SIGMA),
        cellMean, cellSpread,
    };
}

const round = (report: object): Record<string, JsonValue> =>
    Object.fromEntries(Object.entries(report).map(([k, v]) => [k, typeof v === 'number' ? significant(v, DIGITS) : v])) as Record<string, JsonValue>;

export const heating: Scenario = {
    id: 'protostar.heating',
    title: 'Fusion heating by velocity scaling: energy gained = q dt per particle and no momentum change, on blobs and on a uniform gas (against the random kick)',
    tags: ['protostar', 'heating', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const random = mulberry32(HEATING_SEED);
        const blobs = blobLattice(random);
        const blobCount = blobs.reduce((s, b) => s + b.count, 0);
        const blobFill = (state: InitialState): void => fillBlobs(state, blobs, CELL, mulberry32(HEATING_SEED + 1));
        const scaled = judgeBlobs(await heatOnce(context, blobCount, blobFill, false), blobs);
        const kicked = judgeBlobs(await heatOnce(context, blobCount, blobFill, true), blobs);

        const box: Box = { x0: THERMAL_GAS_MARGIN, y0: THERMAL_GAS_MARGIN, x1: LAB_AREA.width - THERMAL_GAS_MARGIN, y1: LAB_AREA.height - THERMAL_GAS_MARGIN };
        const gasFill = (state: InitialState): void => fillThermalGas(state, box, SIGMA, mulberry32(HEATING_SEED + 2));
        const uniform: { particles: number; scaling: UniformReport; kick: UniformReport }[] = [];
        for (const particles of context.software ? HEATING_UNIFORM_PARTICLES_SOFTWARE : HEATING_UNIFORM_PARTICLES) {
            uniform.push({
                particles,
                scaling: judgeUniform(await heatOnce(context, particles, gasFill, false), box, true),
                kick: judgeUniform(await heatOnce(context, particles, gasFill, true), box, false),
            });
        }
        const dense = uniform[uniform.length - 1];

        // The blobs are exact; the uniform gas is statistical: its energy error is judged at 3 / N (N: particles per neighborhood), the densest one's.
        const neighborhood = (particles: number): number => 9 * particles / ((box.x1 - box.x0) * (box.y1 - box.y0) / (CELL * CELL));
        const uniformLimit = Math.max(HEATING_ENERGY_TOLERANCE, 3 / neighborhood(dense.particles));
        const ok = scaled.hotEnergyError <= HEATING_ENERGY_TOLERANCE && scaled.coldEnergyError <= HEATING_COLD_ENERGY_TOLERANCE
            && scaled.hotMomentum <= HEATING_MOMENTUM_TOLERANCE && Math.abs(dense.scaling.energyError) <= uniformLimit;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                temperatureT0: THERMAL_GAS_TEMPERATURE, sigmaPxPerSecond: significant(SIGMA, DIGITS), cellPx: CELL,
                tolerances: { energy: HEATING_ENERGY_TOLERANCE, momentum: HEATING_MOMENTUM_TOLERANCE, uniformEnergy: significant(uniformLimit, 2) },
                blobsScaling: round(scaled), blobsKick: round(kicked),
                uniform: uniform.map(u => ({
                    particles: u.particles, particlesPerNeighborhood: Math.round(neighborhood(u.particles)),
                    scaling: round(u.scaling), kick: round(u.kick),
                })),
            },
            details: `blobs: energy within ${scaled.hotEnergyError.toExponential(1)} of q dt (hot), ${scaled.coldEnergyError.toExponential(1)} (cold), momentum ${scaled.hotMomentum.toExponential(1)} of n sigma; `
                + `the kick: ${kicked.hotEnergyError.toExponential(1)}, ${kicked.hotMomentum.toExponential(1)}; uniform gas (${Math.round(neighborhood(dense.particles))} per neighborhood): `
                + `energy ${dense.scaling.energyError.toExponential(1)}, cell spread ${dense.scaling.cellSpread.toExponential(1)} (kick ${dense.kick.cellSpread.toExponential(1)}), `
                + `momentum ${dense.scaling.momentum.toExponential(1)} (kick ${dense.kick.momentum.toExponential(1)})`,
        };
    },
};
