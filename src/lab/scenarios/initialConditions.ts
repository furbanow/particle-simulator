// The protostar's initial conditions on the real GPU (phase P5b, docs/spikes/a8-initial-conditions.md):
//  - protostar.initial-conditions: the energies of a cloud as the sliders set it (virial ratio, rotation energy) against what the
//    multichannel reduction and the particles read back at t = 0, and Toomre's Q of the velocity field it has;
//  - protostar.initial-grid-force: the acceleration the gravity grid gives the particles at t = 0 against the table of the disc
//    (the table that fixes the circular speed);
//  - protostar.maclaurin-collapse: the cold Maclaurin disc against its analytic free-fall time;
//  - protostar.initial-cost: what the table and the cloud cost at restart, and perf.protostar.restart the whole restart.

import { PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_DISC_TABLE_NODES, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, TOTAL_MASS } from '../../config';
import type { InitialState } from '../../simulation/gpuModel';
import { buildDiscTable, discAcceleration, radiusFraction } from '../../simulation/protostar/disc';
import { fillCloud } from '../../simulation/protostar/initialConditions';
import { measureToomre } from '../../simulation/protostar/toomre';
import {
    CONSERVATIVE_OVERRIDES, INITIAL_BINS, INITIAL_CASES, INITIAL_COST_COUNTS, INITIAL_COST_REPEATS, INITIAL_FORCE_RANGE, INITIAL_FORCE_TOLERANCE,
    INITIAL_KINETIC_TOLERANCE, INITIAL_PARTICLES, LAB_AREA, INITIAL_ROTATION_TOLERANCE, INITIAL_VIRIAL_TOLERANCE, LAB_SEED, MACLAURIN_JUDGED_LEVELS,
    MACLAURIN_LEVELS, MACLAURIN_MAX_FALL_TIMES, MACLAURIN_PREDICTION_RADII, MACLAURIN_SOFTENING, MACLAURIN_SPEEDS, MACLAURIN_TOLERANCE,
} from '../config';
import { frameSeconds, protostarModel, restart } from '../driver';
import {
    crossingTime, fitSoftening, halfMassRadius, maclaurinFallShare, maclaurinFreeFallTime, meanPosition, measureEnergies, radialProfile,
} from '../initialReference';
import { mulberry32 } from '../random';
import { quantile, significant } from '../numbers';
import { readPositions } from '../readback';
import { drawAndReduce } from './energy';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 5;
const sig = (v: number): number => significant(v, DIGITS);
const ACCEL = 'textureAccel';

const numeric = (value: unknown): number => typeof value === 'number' ? value : NaN;

/** The cloud as the model of the running restart laid it out: radius, center, G_eff, softening (px). */
function geometry(context: LabContext) {
    const size = context.simulation.screenSize.value;
    const length = Math.min(size.x, size.y);
    const params = protostarModel(context).debugParams;
    return {
        length, radius: PROTOSTAR_CLOUD_RADIUS * length, center: { x: size.x / 2, y: size.y / 2 },
        gravity: numeric(params.gravity) * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS,
        softening: numeric(params.softening) / 100 * length,
    };
}

// ---- protostar.initial-conditions ----

async function initialCase(context: LabContext, name: string, params: Record<string, number | string>): Promise<{ metrics: Record<string, JsonValue>; ok: boolean; detail: string }> {
    const { renderer, simulation } = context;
    await restart(context, { count: INITIAL_PARTICLES, params });
    const model = protostarModel(context);
    const cloud = model.debugInitialCloud;
    if (!cloud) throw new Error('The model kept no initial cloud');
    const geo = geometry(context);
    const count = simulation.activeCount;
    const { reduction } = await drawAndReduce(context);
    const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const velocities = await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count);
    const energies = measureEnergies(positions, velocities, count, geo.center, TOTAL_MASS, INITIAL_BINS, r => cloud.table.circularSpeedAt(r));

    const virial = numeric(model.debugParams.alphaVir), rotation = numeric(model.debugParams.betaRot);
    const effectiveVirial = Math.max(virial, 2 * rotation);
    const tableU = cloud.potentialEnergy, gridU = -reduction.energy.potentialNow;
    const kinetic = reduction.energy.kinetic;
    const toomre = measureToomre(positions, velocities, count, geo.center, TOTAL_MASS, geo.gravity, 40)
        .filter(p => Number.isFinite(p.q) && p.radius > 0.1 * geo.radius && p.radius < 0.9 * geo.radius);
    const qAt = (fraction: number): number =>
        toomre.reduce((best, p) => Math.abs(p.radius - fraction * geo.radius) < Math.abs(best.radius - fraction * geo.radius) ? p : best, toomre[0]).q;
    const qMin = toomre.reduce((m, p) => Math.min(m, p.q), Infinity);

    const gridVirial = 2 * kinetic / gridU, tableVirial = 2 * kinetic / tableU;
    const kineticError = effectiveVirial > 0 ? Math.abs(kinetic / (effectiveVirial / 2 * tableU) - 1) : Math.abs(kinetic) / tableU;
    const gridError = effectiveVirial > 0 ? Math.abs(gridVirial / effectiveVirial - 1) : Math.abs(gridVirial);
    const rotationError = rotation > 0 ? Math.abs(energies.rotationPattern / (rotation * tableU) - 1) : energies.rotationPattern / tableU;
    const ok = kineticError <= INITIAL_KINETIC_TOLERANCE && gridError <= INITIAL_VIRIAL_TOLERANCE && rotationError <= INITIAL_ROTATION_TOLERANCE;
    return {
        ok,
        metrics: {
            name, params: { ...params }, alphaVir: virial, betaRot: rotation,
            potentialEnergyTable: sig(tableU), potentialEnergyGrid: sig(gridU), gridOverTable: sig(gridU / tableU),
            kineticReduction: sig(kinetic), kineticParticles: sig(energies.kinetic), kineticOverAlphaU: sig(kinetic / (effectiveVirial / 2 * tableU || 1)),
            virialFromGrid: sig(gridVirial), virialFromTable: sig(tableVirial),
            rotationPattern: sig(energies.rotationPattern / tableU), rotationRings: sig(energies.rotationRings / tableU),
            rotationFactor: sig(cloud.rotationFactor), dispersion: sig(cloud.dispersion),
            toomreMin: sig(qMin), toomreQuarter: sig(qAt(0.25)), toomreHalf: sig(qAt(0.5)), toomreThreeQuarters: sig(qAt(0.75)),
        },
        detail: `${name}: 2K/|U| ${gridVirial.toFixed(3)} (grid) ${tableVirial.toFixed(3)} (table) for ${effectiveVirial}, E_rot/|U| ${(energies.rotationPattern / tableU).toFixed(4)} `
            + `(${(energies.rotationRings / tableU).toFixed(4)} in rings) for ${rotation}, U grid/table ${(gridU / tableU).toFixed(3)}, Q ${qMin.toFixed(2)} (min) ${qAt(0.5).toFixed(2)} (0.5 R)`,
    };
}

export const initialConditions: Scenario = {
    id: 'protostar.initial-conditions',
    title: 'The initial cloud\'s energies as the sliders set them (virial ratio, rotation energy) against the reduction and the particles at t = 0, and Toomre\'s Q',
    tags: ['protostar', 'initial', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const cases: Record<string, JsonValue>[] = [];
        const details: string[] = [];
        let failures = 0;
        for (const { name, params } of INITIAL_CASES) {
            const result = await initialCase(context, name, params);
            cases.push(result.metrics);
            details.push(result.detail);
            if (!result.ok) failures++;
        }
        return {
            status: failures === 0 ? 'pass' : 'fail',
            metrics: {
                particles: INITIAL_PARTICLES, cases,
                tolerances: { kinetic: INITIAL_KINETIC_TOLERANCE, virialFromGrid: INITIAL_VIRIAL_TOLERANCE, rotationPattern: INITIAL_ROTATION_TOLERANCE },
            },
            details: `${failures} of ${INITIAL_CASES.length} clouds outside the tolerances (K ${INITIAL_KINETIC_TOLERANCE}, grid virial ${INITIAL_VIRIAL_TOLERANCE}, rotation ${INITIAL_ROTATION_TOLERANCE}); ${details.join('; ')}`,
        };
    },
};

// ---- protostar.initial-grid-force ----

/** The grid's pull at t = 0 against the disc's table, ring by ring, for one cloud. */
async function gridForceCase(context: LabContext, name: string, params: Record<string, number | string>, overrides?: Record<string, number>): Promise<{ metrics: Record<string, JsonValue>; ok: boolean; detail: string; radii: number[]; pulls: number[] }> {
    const { renderer, simulation } = context;
    // One substep a frame (the default speed halved): the acceleration texture then holds a(x_0) after the first frame.
    await restart(context, { count: INITIAL_PARTICLES, params, overrides, timeScale: 0.85 });
    const model = protostarModel(context);
    const cloud = model.debugInitialCloud;
    if (!cloud) throw new Error('The model kept no initial cloud');
    const geo = geometry(context);
    const count = simulation.activeCount;
    const pipeline = simulation.debugPipeline;
    const positions = await readPositions(renderer, pipeline.debugPositionTarget, count);
    simulation.step();
    await context.sync.wait(simulation.positionTexture);
    const accelerations = await readPositions(renderer, pipeline.debugVariableTarget(ACCEL), count);
    const expected = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const a = discAcceleration(cloud.table, positions[i * 4] - geo.center.x, positions[i * 4 + 1] - geo.center.y);
        expected[i * 4] = a.x; expected[i * 4 + 1] = a.y;
    }
    const gpu = radialProfile(positions, accelerations, count, geo.center, INITIAL_BINS);
    const table = radialProfile(positions, expected, count, geo.center, INITIAL_BINS);
    const [lo, hi] = INITIAL_FORCE_RANGE;
    const ratios = gpu.map((bin, b) => bin.radial / table[b].radial);
    const judged = gpu.map((_, b) => b).filter(b => gpu[b].radius >= lo * geo.radius && gpu[b].radius <= hi * geo.radius);
    const errors = judged.map(b => Math.abs(ratios[b] - 1));
    const worst = Math.max(...errors), median = quantile(errors, 0.5);
    const meanRatio = judged.reduce((s, b) => s + ratios[b], 0) / judged.length;
    const cross = judged.map(b => Math.abs(gpu[b].tangential / gpu[b].radial));
    return {
        ok: worst <= INITIAL_FORCE_TOLERANCE,
        radii: judged.map(b => gpu[b].radius), pulls: judged.map(b => -gpu[b].radial),
        metrics: {
            name, params, radiusPx: sig(geo.radius), softeningPx: sig(geo.softening), cellPx: Math.max(LAB_AREA.width, LAB_AREA.height) / PROTOSTAR_GRID_RES,
            judgedBins: judged.length, worstRelativeError: sig(worst), medianRelativeError: sig(median), meanRatio: sig(meanRatio),
            tangentialOverRadialMax: sig(Math.max(...cross)),
            profile: {
                radiusOverR: gpu.filter((_, b) => b % 3 === 1).map(bin => sig(bin.radius / geo.radius)),
                gridOverTable: ratios.filter((_, b) => b % 3 === 1).map(sig),
            },
        },
        detail: `${name}: the grid's pull is ${meanRatio.toFixed(3)} of the table's on average between ${lo} and ${hi} R, worst ring ${(worst * 100).toFixed(1)} % `
            + `(median ${(median * 100).toFixed(1)} %), tangential part at most ${(Math.max(...cross) * 100).toFixed(1)} % of the radial one`,
    };
}

export const initialGridForce: Scenario = {
    id: 'protostar.initial-grid-force',
    title: 'The acceleration the gravity grid gives the particles at t = 0 against the table of the disc (uniform and Maclaurin)',
    tags: ['protostar', 'initial', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const clouds: [string, Record<string, number | string>][] = [
            ['uniform disc', { alphaVir: 0, betaRot: 0 }],
            ['Maclaurin disc', { alphaVir: 0, betaRot: 0, profile: 'maclaurin' }],
        ];
        const results = [];
        for (const [name, params] of clouds) results.push(await gridForceCase(context, name, params));
        const ok = results.every(r => r.ok);
        return {
            status: ok ? 'pass' : 'fail',
            metrics: { particles: INITIAL_PARTICLES, tolerance: INITIAL_FORCE_TOLERANCE, rings: INITIAL_BINS, clouds: results.map(r => r.metrics) },
            details: `tolerance ${INITIAL_FORCE_TOLERANCE * 100} % per ring; ${results.map(r => r.detail).join('; ')}`,
        };
    },
};

// ---- protostar.maclaurin-collapse ----

interface CollapseRun {
    speed: number;
    dt: number;
    /** Half-mass radius over its initial value, one per frame from the start, and the time of each reading. */
    times: number[];
    radii: number[];
}

/**
 * Predicted fall of the half-mass radius under the pull of a Maclaurin disc softened by `softening` (px): the table of the disc at each
 * of a few radii gives, at the half-mass particle, the pull over the linear one, and the radius a(t) of the homologously shrinking disc
 * follows a'' = -factor(a) (3 pi / 4) G M / a^2. No grid, no particles: what a softening alone does to the free fall.
 */
function softenedPrediction(geo: ReturnType<typeof geometry>, gm: number, levels: readonly number[], softening: number): { crossings: number[]; ratioAtStart: number } {
    const tables = MACLAURIN_PREDICTION_RADII.map(f => buildDiscTable({
        radius: f * geo.radius, gravity: gm / TOTAL_MASS, totalMass: TOTAL_MASS, softening, profile: 'maclaurin',
    }));
    const half = radiusFraction('maclaurin', 0.5);
    // g softened over g linear at the half-mass particle of the disc of each radius
    const ratio = tables.map(table => table.pullAt(half * table.radius) / (0.75 * Math.PI * gm * half / table.radius ** 2));
    const logs = MACLAURIN_PREDICTION_RADII.map(Math.log);
    const factor = (a: number): number => {
        const x = Math.log(a / geo.radius);
        if (x >= logs[0]) return ratio[0];
        for (let k = 1; k < logs.length; k++) {
            if (x >= logs[k]) {
                const t = (x - logs[k]) / (logs[k - 1] - logs[k]);
                return ratio[k] + t * (ratio[k - 1] - ratio[k]);
            }
        }
        return ratio[ratio.length - 1];
    };
    // a'' = -factor(a) (3 pi / 4) G M / a^2 from rest at R, velocity Verlet with steps of 1/20000 of the free-fall time
    const mu = 0.75 * Math.PI * gm;
    const tff = maclaurinFreeFallTime(gm, geo.radius);
    const dt = tff / 20000;
    let a = geo.radius, v = 0, t = 0, acceleration = -factor(a) * mu / (a * a);
    const crossings = levels.map(() => NaN);
    const times: number[] = [0], radii: number[] = [1];
    while (a > 0.03 * geo.radius && t < 2 * tff) {
        v += 0.5 * acceleration * dt; a += v * dt; acceleration = -factor(a) * mu / (a * a); v += 0.5 * acceleration * dt; t += dt;
        times.push(t); radii.push(a / geo.radius);
    }
    levels.forEach((level, k) => { crossings[k] = crossingTime(times, radii, level); });
    return { crossings, ratioAtStart: ratio[0] };
}

async function collapseRun(context: LabContext, speed: number): Promise<CollapseRun & { tff: number; geo: ReturnType<typeof geometry>; gm: number }> {
    const { renderer, simulation } = context;
    await restart(context, {
        count: INITIAL_PARTICLES, params: { profile: 'maclaurin', alphaVir: 0, betaRot: 0 },
        overrides: { ...CONSERVATIVE_OVERRIDES, softening: MACLAURIN_SOFTENING }, timeScale: speed,
    });
    const geo = geometry(context);
    const count = simulation.activeCount;
    const gm = geo.gravity * TOTAL_MASS;
    const tff = maclaurinFreeFallTime(gm, geo.radius);
    const dt = frameSeconds(context);
    const pipeline = simulation.debugPipeline;
    let positions = await readPositions(renderer, pipeline.debugPositionTarget, count);
    const initial = halfMassRadius(positions, count, meanPosition(positions, count));
    const times = [0], radii = [1];
    for (let frame = 1; frame * dt < MACLAURIN_MAX_FALL_TIMES * tff; frame++) {
        simulation.step();
        await context.sync.wait(simulation.positionTexture);
        positions = await readPositions(renderer, pipeline.debugPositionTarget, count);
        const radius = halfMassRadius(positions, count, meanPosition(positions, count)) / initial;
        times.push(frame * dt); radii.push(radius);
        if (radius < 0.03) break;
    }
    return { speed, dt, times, radii, tff, geo, gm };
}

export const maclaurinCollapse: Scenario = {
    id: 'protostar.maclaurin-collapse',
    title: 'The cold Maclaurin disc\'s collapse (no cooling, feedback or fusion, tiny softening) against its analytic free-fall time',
    tags: ['protostar', 'initial', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const coldParams = { profile: 'maclaurin', alphaVir: 0, betaRot: 0 };
        const overrides = { ...CONSERVATIVE_OVERRIDES, softening: MACLAURIN_SOFTENING };
        // What the grid's own smoothing amounts to: the Plummer length at which the table of the disc best matches the pull the grid gives at t = 0.
        const force = await gridForceCase(context, 'Maclaurin disc, tiny softening', coldParams, overrides);
        const geo0 = geometry(context);
        const gm0 = geo0.gravity * TOTAL_MASS;
        const fit = fitSoftening(force.radii, force.pulls, softening => {
            const table = buildDiscTable({ radius: geo0.radius, gravity: geo0.gravity, totalMass: TOTAL_MASS, softening, profile: 'maclaurin' });
            return r => table.pullAt(r);
        }, 0.3, 60);
        const sliderTable = buildDiscTable({ radius: geo0.radius, gravity: geo0.gravity, totalMass: TOTAL_MASS, softening: geo0.softening, profile: 'maclaurin' });
        const linear = (r: number): number => 0.75 * Math.PI * gm0 * r / geo0.radius ** 3;
        const gridOverLinear = force.radii.map((r, b) => force.pulls[b] / linear(r));
        const gridOverSliderTable = force.radii.map((r, b) => force.pulls[b] / sliderTable.pullAt(r));

        const runs: Record<string, JsonValue>[] = [];
        const lines: string[] = [];
        let worstJudged = 0;
        for (const speed of MACLAURIN_SPEEDS) {
            const run = await collapseRun(context, speed);
            const bySlider = softenedPrediction(run.geo, run.gm, MACLAURIN_LEVELS, run.geo.softening);
            const byGrid = softenedPrediction(run.geo, run.gm, MACLAURIN_LEVELS, fit.softening);
            const share = (crossings: readonly number[]): number[] => MACLAURIN_LEVELS.map((level, k) => crossings[k] / maclaurinFallShare(level) / run.tff);
            const estimates = MACLAURIN_LEVELS.map(level => crossingTime(run.times, run.radii, level) / maclaurinFallShare(level) / run.tff);
            const predictedBySlider = share(bySlider.crossings), predictedByGrid = share(byGrid.crossings);
            for (const level of MACLAURIN_JUDGED_LEVELS) worstJudged = Math.max(worstJudged, Math.abs(estimates[MACLAURIN_LEVELS.indexOf(level)] - 1));
            const stride = Math.max(1, Math.floor(run.times.length / 40));
            runs.push({
                speed: run.speed, substepSeconds: sig(run.dt / Math.max(1, Math.ceil(run.speed - 1e-6))), frames: run.times.length - 1,
                freeFallSeconds: sig(run.tff), radiusPx: sig(run.geo.radius), softeningPx: sig(run.geo.softening), gm: sig(run.gm),
                levels: [...MACLAURIN_LEVELS],
                crossingSeconds: MACLAURIN_LEVELS.map(level => sig(crossingTime(run.times, run.radii, level))),
                freeFallEstimateOverAnalytic: estimates.map(sig),
                predictedBySliderSofteningOverAnalytic: predictedBySlider.map(sig),
                predictedByGridSofteningOverAnalytic: predictedByGrid.map(sig),
                residualAfterGridSoftening: estimates.map((e, k) => sig(e / predictedByGrid[k] - 1)),
                series: {
                    tOverFreeFall: run.times.filter((_, k) => k % stride === 0).map(t => sig(t / run.tff)),
                    radiusOverInitial: run.radii.filter((_, k) => k % stride === 0).map(sig),
                },
            });
            lines.push(`speed ${speed}: t_ff estimated ${estimates.map((e, k) => `${e.toFixed(4)} at ${MACLAURIN_LEVELS[k]}`).join(', ')} of the analytic ${run.tff.toFixed(3)} s; `
                + `softening of the slider alone ${predictedBySlider.map(p => p.toFixed(4)).join(', ')}; with the grid's own smoothing (${fit.softening.toFixed(1)} px) ${predictedByGrid.map(p => p.toFixed(4)).join(', ')}`);
        }
        const met = worstJudged <= MACLAURIN_TOLERANCE;
        return {
            status: met ? 'pass' : 'fail',
            metrics: {
                particles: INITIAL_PARTICLES, tolerance: MACLAURIN_TOLERANCE, judgedLevels: [...MACLAURIN_JUDGED_LEVELS], worstJudgedError: sig(worstJudged),
                sliderSofteningPx: sig(geo0.softening), gridSofteningPx: sig(fit.softening), gridSofteningFitRms: sig(fit.rmsError),
                gridPullOverLinear: { radiusOverR: force.radii.map(r => sig(r / geo0.radius)).filter((_, b) => b % 4 === 0), ratio: gridOverLinear.map(sig).filter((_, b) => b % 4 === 0) },
                gridPullOverTableAtSliderSoftening: gridOverSliderTable.map(sig).filter((_, b) => b % 4 === 0),
                runs,
            },
            details: `${met ? 'within' : 'beyond'} ${MACLAURIN_TOLERANCE * 100} % at ${MACLAURIN_JUDGED_LEVELS.join(' and ')} of the radius (worst ${(worstJudged * 100).toFixed(2)} %); ${lines.join('; ')}`,
        };
    },
};

// ---- protostar.initial-cost and perf.protostar.restart ----

const median = (values: readonly number[]): number => quantile(values, 0.5);

/** ms of `body`, the median of `repeats` runs. */
function timeIt(repeats: number, body: () => void): number {
    const times: number[] = [];
    for (let k = 0; k < repeats; k++) {
        const start = performance.now();
        body();
        times.push(performance.now() - start);
    }
    return median(times);
}

export const initialCost: Scenario = {
    id: 'protostar.initial-cost',
    title: 'What the disc\'s table and the initial cloud cost at restart (ms), at 400 000, 1 000 000 and 2 000 000 particles',
    tags: ['protostar', 'initial', 'perf'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: INITIAL_COST_COUNTS[0] });
        const geo = geometry(context);
        const options = { radius: geo.radius, gravity: geo.gravity, totalMass: TOTAL_MASS, softening: geo.softening };
        const tableMs: Record<string, number> = {};
        for (const profile of ['uniform', 'maclaurin'] as const) tableMs[profile] = sig(timeIt(INITIAL_COST_REPEATS, () => buildDiscTable({ ...options, profile })));
        const cloudMs: Record<string, Record<string, number>> = {};
        for (const count of INITIAL_COST_COUNTS) {
            const state: InitialState = {
                positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4),
                count, typeCounts: [count], width: context.simulation.screenSize.value.x, height: context.simulation.screenSize.value.y, params: {},
            };
            const row: Record<string, number> = {};
            for (const [name, profile, turbulence] of [['uniform white', 'uniform', 'white'], ['uniform correlated', 'uniform', 'correlated'], ['maclaurin white', 'maclaurin', 'white']] as const) {
                row[name] = sig(timeIt(3, () => { fillCloud(state, { ...options, profile, virial: 0.33, rotation: 0.08, turbulence }, mulberry32(LAB_SEED)); }));
            }
            cloudMs[String(count)] = row;
        }
        return {
            status: 'pass',
            metrics: { tableMs, fillCloudMs: cloudMs, tableNodes: PROTOSTAR_DISC_TABLE_NODES },
            details: `table ${tableMs.uniform} ms (uniform), ${tableMs.maclaurin} ms (Maclaurin); fillCloud (table included) ${Object.entries(cloudMs).map(([n, row]) => `${n}: ${row['uniform white']} ms`).join(', ')}`,
        };
    },
};

/** The whole restart (Simulation.reset: the cloud, the upload, the GPU's own set-up), ms, at three counts; it reads only the public surface. */
export const restartCost: Scenario = {
    id: 'perf.protostar.restart',
    title: 'The whole restart of the protostar (Simulation.reset) at 400 000, 1 000 000 and 2 000 000 particles, ms',
    tags: ['protostar', 'perf', 'initial'],
    async run(context): Promise<ScenarioOutcome> {
        const rows: Record<string, JsonValue> = {};
        const lines: string[] = [];
        await restart(context, { count: INITIAL_COST_COUNTS[0] });             // compiles the shaders, once
        for (const count of INITIAL_COST_COUNTS) {
            const times: number[] = [];
            for (let k = 0; k < INITIAL_COST_REPEATS; k++) {
                const start = performance.now();
                await restart(context, { count, seed: LAB_SEED + k });
                await context.sync.wait(context.simulation.positionTexture);
                times.push(performance.now() - start);
            }
            rows[String(count)] = { median: sig(median(times)), min: sig(Math.min(...times)), max: sig(Math.max(...times)) };
            lines.push(`${count}: ${median(times).toFixed(0)} ms`);
        }
        return { status: 'pass', metrics: { restartMs: rows }, details: `median of ${INITIAL_COST_REPEATS}: ${lines.join(', ')}` };
    },
};
