// Acceptance of the thin-disc radiative cooling (proposal A6) and of the Jeans floor (A13), phase P4.
//  - protostar.thin-disc-cooling: blobs of particles exactly at the center of isolated cells (each reads its own cell alone),
//    hydrogen and helium, of known dispersions and densities, one substep with no gravity, fusion or feedback: the dispersion of each
//    blob must be multiplied by the exact solution of the T^4 law (cooling.ts, coolingRatio) to rounding, its mean velocity must not
//    move, a blob that would cool below T_min must stop at it and a blob already below it must be left alone. The law is
//    integrated exactly, so stiff steps (3 c mu T^3 dt / (Sigma tau_eff) up to 1e3) are judged the same way.
//  - protostar.jeans-floor: blobs again, with the gravity of the defaults (the first substep of a run owes no half kick, so the gravity
//    does not touch the velocities) and the flag on: a blob whose dispersion is below the floor must end at t_J = 2 N_J dx G Sigma exactly,
//    one above it must be left alone, a cold one (nothing to scale) gets the floor as a kick. Then the default cloud with the flag off and
//    on: the Jeans length of every cell with mass, in cells, over the run (the Truelove criterion: at least N_J = 4).

import { PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, PROTOSTAR_JEANS_CELLS, PROTOSTAR_STATS_INTERVAL, PROTOSTAR_T0_KELVIN, TOTAL_MASS } from '../../config';
import type { InitialState } from '../../simulation/gpuModel';
import { coolingRatio, jeansCells, jeansPerDensity, type RadiativeCooling } from '../../simulation/protostar/cooling';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import {
    COOLING_BLOB_BULK, COOLING_BLOB_COUNTS, COOLING_BLOB_TEMPERATURES, COOLING_FLOOR, COOLING_RATE, COOLING_OPACITY, COOLING_SEED,
    COOLING_TOLERANCE, COOLING_WALL_CELLS, HEATING_BLOB_SPACING, JEANS_CLOUD_FRAMES, JEANS_CLOUD_MIN_DENSITY, JEANS_GRAVITY, JEANS_TOLERANCE, LAB_AREA,
} from '../config';
import { frameSeconds, protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readPositions, readTarget } from '../readback';
import { fillBlobs, LAB_CELL, LAB_T0, thermalSigma, type Blob } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const CELL = LAB_CELL;
const COUNT_FOR_WARMUP = 1000;
/** Rank of the helium type (its blobs have mu = 2.65 mu_H). */
const HELIUM_RANK = 1;
const MEGA = 1e6;

/** A blob and its composition. */
interface TypedBlob extends Blob {
    type: number;
    /** Its dispersion, T0. */
    dispersion: number;
}

/** One substep of blobs: the velocities before and after, and the grids the substep read (gas: rho, t, u; heat: q, mu). */
interface BlobRun {
    before: Float32Array;
    after: Float32Array;
    gas: Float32Array;
    heat: Float32Array;
    dt: number;
    jeansPerDensity: number;
}

/** Restarts on the blobs (no fusion, no feedback), runs one substep and reads everything back. */
async function blobStep(context: LabContext, blobs: readonly TypedBlob[], overrides: Record<string, number | boolean>): Promise<BlobRun> {
    const { renderer, simulation, sync } = context;
    const count = blobs.reduce((s, b) => s + b.count, 0);
    await restart(context, { count: COUNT_FOR_WARMUP });
    const model = protostarModel(context);
    let before = new Float32Array(0);
    model.debugInitialState = (state: InitialState) => {
        fillBlobs(state, blobs, CELL, mulberry32(COOLING_SEED + 1));
        let first = 0;
        for (const blob of blobs) {
            for (let k = 0; k < blob.count; k++) state.positions[(first + k) * 4 + 2] = blob.type;
            first += blob.count;
        }
        before = state.velocities.slice(0, count * 4);
    };
    try {
        await restart(context, {
            count, timeScale: 1, seed: COOLING_SEED,
            overrides: { feedback: 0, fusionRate: 0, heFusionRate: 0, ...overrides },
        });
    } finally {
        model.debugInitialState = null;
    }
    simulation.step();
    await sync.wait(simulation.positionTexture);
    const grids = protostarGrids(context);
    return {
        before, dt: frameSeconds(context),
        after: await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count),
        gas: await readTarget(renderer, grids.gas),
        heat: await readTarget(renderer, grids.heat),
        jeansPerDensity: model.velocityUniforms.jeansPerDensity.value as number,
    };
}

/** Per blob: its cell's state as the grids hold it, the dispersion before and after around the blob's own mean, how far its mean moved. */
interface BlobResult {
    blob: TypedBlob;
    rho: number;
    mu: number;
    /** Dispersion the grid read, px^2/s^2. */
    t: number;
    before: number;
    after: number;
    /** |mean after - mean before| over sigma. */
    drift: number;
}

function measureBlobs(run: BlobRun, blobs: readonly TypedBlob[]): BlobResult[] {
    const out: BlobResult[] = [];
    let first = 0;
    for (const blob of blobs) {
        const cell = (blob.cell[1] * PROTOSTAR_GRID_RES + blob.cell[0]) * 4;
        const mean = (v: Float32Array): [number, number] => {
            let x = 0, y = 0;
            for (let k = 0; k < blob.count; k++) { x += v[(first + k) * 4]; y += v[(first + k) * 4 + 1]; }
            return [x / blob.count, y / blob.count];
        };
        const dispersion = (v: Float32Array, m: readonly [number, number]): number => {
            let s = 0;
            for (let k = 0; k < blob.count; k++) s += (v[(first + k) * 4] - m[0]) ** 2 + (v[(first + k) * 4 + 1] - m[1]) ** 2;
            return s / blob.count;
        };
        const [m0, m1] = [mean(run.before), mean(run.after)];
        out.push({
            blob, rho: run.gas[cell], mu: run.heat[cell + 1], t: run.gas[cell + 1],
            before: dispersion(run.before, m0), after: dispersion(run.after, m1),
            drift: Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) / Math.max(blob.sigma, 1e-9),
        });
        first += blob.count;
    }
    return out;
}

/** Blobs on a lattice of isolated cells, cycling through the counts (densities), the dispersions and the two compositions. */
function blobLattice(temperatures: readonly number[], counts: readonly number[], random: () => number): TypedBlob[] {
    const blobs: TypedBlob[] = [];
    // The hottest blobs move a few px in a step: they stay COOLING_WALL_CELLS cells from the walls, or some of their particles would bounce.
    const span = (cells: number): number => Math.floor((cells - 1 - 2 * COOLING_WALL_CELLS) / HEATING_BLOB_SPACING) + 1;
    const columns = span(Math.floor(LAB_AREA.width / CELL));
    const rows = span(Math.floor(LAB_AREA.height / CELL));
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < columns; i++) {
            const n = blobs.length;
            const dispersion = temperatures[n % temperatures.length];
            blobs.push({
                cell: [COOLING_WALL_CELLS + i * HEATING_BLOB_SPACING, COOLING_WALL_CELLS + j * HEATING_BLOB_SPACING],
                count: counts[Math.floor(n / temperatures.length) % counts.length],
                sigma: thermalSigma(dispersion), dispersion,
                bulk: [(2 * random() - 1) * COOLING_BLOB_BULK, (2 * random() - 1) * COOLING_BLOB_BULK],
                type: Math.floor(n / (temperatures.length * counts.length)) % 2 === 0 ? 0 : HELIUM_RANK,
            });
        }
    }
    return blobs;
}

const round = (v: number): number => significant(v, DIGITS);

export const thinDiscCooling: Scenario = {
    id: 'protostar.thin-disc-cooling',
    title: 'Thin-disc cooling (A6): blobs of hydrogen and helium of known T and Sigma cool by the exact solution of dT/dt = -c mu T^4 / (Sigma tau_eff) in one substep, stop at T_min, keep their mean velocity',
    tags: ['protostar', 'cooling', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const blobs = blobLattice(COOLING_BLOB_TEMPERATURES, COOLING_BLOB_COUNTS, mulberry32(COOLING_SEED));
        const cooling: RadiativeCooling = { rate: COOLING_RATE, opacity: COOLING_OPACITY, floor: COOLING_FLOOR };
        const run = await blobStep(context, blobs, {
            gravity: 0, [PROTOSTAR_PARAM.radiation]: cooling.rate, [PROTOSTAR_PARAM.kappa]: cooling.opacity, [PROTOSTAR_PARAM.minTemperature]: cooling.floor,
        });
        let worst = 0, worstDrift = 0, floored = 0, below = 0, cooled = 0, maxStiffness = 0, belowChanged = 0;
        const sample: JsonValue[] = [];
        const worstBlobs: { error: number; row: JsonValue }[] = [];
        for (const r of measureBlobs(run, blobs)) {
            const temperature = r.mu * r.t / LAB_T0;
            const expected = coolingRatio(temperature, r.mu, r.rho, run.dt, cooling);
            const measured = r.after / r.before;
            const error = Math.abs(measured / expected - 1);
            worst = Math.max(worst, error);
            worstDrift = Math.max(worstDrift, r.drift);
            if (temperature <= cooling.floor) { below++; belowChanged = Math.max(belowChanged, Math.abs(measured - 1)); }
            else if (expected * temperature <= cooling.floor * (1 + 1e-9)) floored++;
            else cooled++;
            const column = 3 * cooling.opacity * r.rho ** 2 / 16 + Math.sqrt(3) / 4 * r.rho + 1 / (2 * cooling.opacity);
            maxStiffness = Math.max(maxStiffness, 3 * cooling.rate * r.mu * temperature ** 3 * run.dt / column);
            worstBlobs.push({ error: Math.max(error, r.drift), row: { type: r.blob.type, particles: r.blob.count, cell: [...r.blob.cell], rho: round(r.rho), mu: round(r.mu),
                temperatureT0: round(temperature), set: round(r.blob.dispersion), expectedRatio: round(expected), measuredRatio: round(measured), drift: round(r.drift) } });
            if (sample.length < 12) {
                sample.push({ type: r.blob.type, particles: r.blob.count, rho: round(r.rho), mu: round(r.mu), temperatureT0: round(temperature),
                    expectedRatio: round(expected), measuredRatio: round(measured) });
            }
        }
        const ok = worst <= COOLING_TOLERANCE && worstDrift <= COOLING_TOLERANCE && belowChanged <= COOLING_TOLERANCE && floored > 0 && below > 0 && cooled > 0;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                blobs: blobs.length, dt: round(run.dt), cooling: { rate: cooling.rate, opacity: cooling.opacity, floorT0: cooling.floor },
                tolerance: COOLING_TOLERANCE, worstRatioError: worst, worstMeanDrift: worstDrift, blobsCooledByTheLaw: cooled, blobsStoppedAtFloor: floored, blobsBelowFloor: below,
                belowFloorChange: belowChanged, largestStiffness: round(maxStiffness), sample,
                worst: worstBlobs.sort((a, b) => b.error - a.error).slice(0, 8).map(w => w.row),
            },
            details: `${blobs.length} blobs (H and He, ${COOLING_BLOB_COUNTS.join('/')} particles, ${COOLING_BLOB_TEMPERATURES.join('/')} T0): dispersion ratio within ${worst.toExponential(1)} of the exact law `
                + `(stiffness up to ${maxStiffness.toExponential(1)}), mean velocity moved ${worstDrift.toExponential(1)} sigma, ${cooled} cooled by the law, ${floored} stopped at T_min, ${below} below it unchanged (${belowChanged.toExponential(1)})`,
        };
    },
};

/** G_eff (px^3 / (mass s^2)) and rho0 (mass / px^2) of a run in the lab's area with the gravity slider at `gravity`. */
function labScales(gravity: number): { gravity: number; rho0: number } {
    const length = Math.min(LAB_AREA.width, LAB_AREA.height);
    const radius = PROTOSTAR_CLOUD_RADIUS * length;
    return { gravity: gravity * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS, rho0: TOTAL_MASS / (Math.PI * radius * radius) };
}

/** The Jeans length of the cells holding at least `minDensity` rho0, in cells: its minimum and the share of their mass below N_J cells. */
function jeansCensus(gas: Float32Array, perDensity: number, minDensity: number): { min: number; unresolvedMass: number } {
    let min = Infinity, mass = 0, unresolved = 0;
    for (let i = 0; i < PROTOSTAR_GRID_RES * PROTOSTAR_GRID_RES; i++) {
        const rho = gas[i * 4];
        if (!(rho >= minDensity)) continue;
        const cells = jeansCells(gas[i * 4 + 1], rho, perDensity, PROTOSTAR_JEANS_CELLS);
        min = Math.min(min, cells);
        mass += rho;
        if (cells < PROTOSTAR_JEANS_CELLS) unresolved += rho;
    }
    return { min, unresolvedMass: mass > 0 ? unresolved / mass : 0 };
}

/** The default cloud for JEANS_CLOUD_FRAMES frames with the floor `on` or off: the census of every stats reading, and the history's key numbers. */
async function jeansCloud(context: LabContext, on: boolean, perDensity: number): Promise<Record<string, JsonValue>> {
    const { simulation, renderer } = context;
    await restart(context, { count: context.options.baselineParticles, params: { [PROTOSTAR_PARAM.jeansFloor]: on } });
    const readings: { seconds: number; min: number; unresolvedMass: number; coreMK: number; maxDensity: number }[] = [];
    await runFrames(context, JEANS_CLOUD_FRAMES, {
        endFrame: true,
        async onFrame(frame) {
            if (frame % PROTOSTAR_STATS_INTERVAL !== 0) return;
            const grids = protostarGrids(context);
            const gas = await readTarget(renderer, grids.gas);
            const [maxDensity, temperature] = await readTarget(renderer, grids.reduce2);
            readings.push({ seconds: frame * frameSeconds(context), ...jeansCensus(gas, perDensity, JEANS_CLOUD_MIN_DENSITY),
                coreMK: temperature * PROTOSTAR_T0_KELVIN / MEGA, maxDensity });
        },
    });
    const counts = simulation.liveTypeCounts() ?? [];
    const total = counts.reduce((s, n) => s + n, 0) || 1;
    const sorted = (f: (r: typeof readings[number]) => number): number[] => readings.map(f).sort((a, b) => a - b);
    const median = (a: number[]): number => a[Math.floor(a.length / 2)] ?? NaN;
    return {
        jeansFloor: on, readings: readings.length,
        minJeansCells: round(Math.min(...readings.map(r => r.min))),
        medianMinJeansCells: round(median(sorted(r => r.min))),
        worstUnresolvedMass: round(Math.max(...readings.map(r => r.unresolvedMass))),
        medianUnresolvedMass: round(median(sorted(r => r.unresolvedMass))),
        peakCoreMK: round(Math.max(...readings.map(r => r.coreMK))),
        peakDensity: round(Math.max(...readings.map(r => r.maxDensity))),
        massFractionsAtEnd: counts.slice(0, 3).map(n => round(n / total)),
        series: {
            seconds: readings.map(r => round(r.seconds)), minJeansCells: readings.map(r => round(r.min)),
            unresolvedMass: readings.map(r => round(r.unresolvedMass)), coreMK: readings.map(r => round(r.coreMK)),
        },
    };
}

export const jeansFloor: Scenario = {
    id: 'protostar.jeans-floor',
    title: 'Jeans floor (A13): blobs under the floor end at t_J = 2 N_J dx G Sigma exactly, the others are left alone; the default cloud\'s Jeans length in cells with the flag off and on',
    tags: ['protostar', 'jeans', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        // The blobs: the floor at the default gravity; dispersions from far under to above the floor of their density, and cold ones.
        const blobs = blobLattice([1e-5, 0.002, 0.02, 0.2, 2], COOLING_BLOB_COUNTS, mulberry32(COOLING_SEED + 2)).map(b => ({ ...b, type: 0 }));
        const run = await blobStep(context, blobs, { gravity: JEANS_GRAVITY, [PROTOSTAR_PARAM.radiation]: 0, [PROTOSTAR_PARAM.jeansFloor]: true });
        const scales = labScales(JEANS_GRAVITY);
        const perDensity = jeansPerDensity(PROTOSTAR_JEANS_CELLS, CELL, scales.gravity, scales.rho0);
        const plumbing = Math.abs(run.jeansPerDensity / perDensity - 1);
        let raised = 0, untouched = 0, kicked = 0, worstRaised = 0, worstUntouched = 0, worstKick = 0, worstDrift = 0;
        for (const r of measureBlobs(run, blobs)) {
            const floor = perDensity * r.rho;
            const cold = r.t <= (protostarModel(context).velocityUniforms.heatingTFloor.value as number);
            if (cold) {
                // The kick has a random direction per particle: the dispersion around the new mean is the floor to within the sampling noise.
                kicked++;
                worstKick = Math.max(worstKick, Math.abs(r.after / floor - 1));
            } else if (r.t < floor) {
                raised++;
                worstRaised = Math.max(worstRaised, Math.abs(r.after / (r.before * floor / r.t) - 1));
                worstDrift = Math.max(worstDrift, r.drift);
            } else {
                untouched++;
                worstUntouched = Math.max(worstUntouched, Math.abs(r.after / r.before - 1));
            }
        }
        const blobsOk = plumbing <= JEANS_TOLERANCE && worstRaised <= JEANS_TOLERANCE && worstUntouched <= JEANS_TOLERANCE && raised > 0 && untouched > 0;

        const off = await jeansCloud(context, false, perDensity);
        const on = await jeansCloud(context, true, perDensity);
        return {
            status: blobsOk ? 'pass' : 'fail',
            metrics: {
                cellPx: CELL, jeansCells: PROTOSTAR_JEANS_CELLS, perDensityPx2PerS2: round(perDensity), perDensityT0: round(perDensity / LAB_T0), plumbingError: plumbing,
                blobs: { raised, untouched, kicked, worstRaised, worstUntouched, worstKick: round(worstKick), worstMeanDrift: worstDrift },
                cloud: { frames: JEANS_CLOUD_FRAMES, minDensity: JEANS_CLOUD_MIN_DENSITY, off, on },
            },
            details: `floor ${round(perDensity / LAB_T0)} T0 per rho0; blobs: ${raised} raised to t_J within ${worstRaised.toExponential(1)}, ${untouched} left alone (${worstUntouched.toExponential(1)}), `
                + `${kicked} cold kicked to ${worstKick.toFixed(3)}; cloud (cells >= ${JEANS_CLOUD_MIN_DENSITY} rho0): smallest Jeans length ${off.minJeansCells} cells off, ${on.minJeansCells} on; `
                + `unresolved mass, worst reading ${off.worstUnresolvedMass} off, ${on.worstUnresolvedMass} on; peak core ${off.peakCoreMK} MK off, ${on.peakCoreMK} on`,
        };
    },
};

export const coolingScenarios: readonly Scenario[] = [thinDiscCooling, jeansFloor];
