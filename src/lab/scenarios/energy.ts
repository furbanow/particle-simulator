// The energy diagnostics of the protostar (phase P1a): the potential energy of the gravity grid and the
// multichannel reduction that sums it. Three scenarios:
//  - protostar.energy-reference: K and U of the reduction against a CPU reference computed from a read-back of the
//    positions and velocities (direct pair sum, and a CPU twin of the grid scheme), on a small cloud;
//  - protostar.reduction-channels: every channel of the reduction against the CPU sum of the grids read back, and the
//    exact ones (mass, center of mass, momentum, kinetic energy) against sums over the particles;
//  - baseline.protostar.energy-drift: K + U of a conservative run over as many orbits as the budget allows.
// See docs/algorithms.md ("Energy diagnostics") and docs/lab-baseline.md for the numbers.

import {
    BASE_DT, PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_RESTITUTION, PROTOSTAR_COARSE_FACTOR, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, PROTOSTAR_NEAR_RADIUS,
    PROTOSTAR_STATS_REDUCE_RES, TOTAL_MASS,
} from '../../config';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import type { ProtostarModel } from '../../simulation/protostar/gpuModel';
import {
    REDUCTION_TEXEL, selfPotentialPerMassSquared, unpackReduction, type Reduction,
} from '../../simulation/protostar/reduction';
import {
    CONSERVATIVE_OVERRIDES, DEPOSIT_WEIGHT_MARGIN, ENERGY_DRIFT_CHUNK_FRAMES, ENERGY_DRIFT_CLOUDS, ENERGY_DRIFT_FRAMES_SOFTWARE,
    ENERGY_DRIFT_ORBITS, ENERGY_DRIFT_PARTICLES, ENERGY_DRIFT_READ_EVERY, ENERGY_DRIFT_REPORT_ORBITS, ENERGY_DRIFT_SETTLE_ORBITS, ENERGY_DRIFT_TARGET,
    ENERGY_ATTRIBUTION_BUDGET_MS, ENERGY_ATTRIBUTION_ORBITS, ENERGY_ATTRIBUTION_STEP_DIVISORS, ELASTIC_WALLS, ENERGY_GRID_TOLERANCE, ENERGY_KINETIC_TOLERANCE, ENERGY_REFERENCE_FRAMES,
    ENERGY_REFERENCE_PARTICLES, ENERGY_TWIN_TOLERANCE, GRAVITY_TWIN_TOLERANCE, LAB_AREA, REDUCTION_FRAMES, REDUCTION_PARTICLES,
    REDUCTION_PARTICLE_TOLERANCE, REDUCTION_SUM_TOLERANCE,
} from '../config';
import { referenceDeposit } from '../depositReference';
import { frameSeconds, protostarGrids, protostarModel, restart, runFrames } from '../driver';
import {
    directEnergies, driftStatistics, gridGravity, gridPotentialSum, orbitalPeriod, reductionReference, type DriftStatistics,
} from '../energyReference';
import { decimate, extractChannel, significant, sumChannel } from '../numbers';
import { readAttachment, readPositions, readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 5;
const sig = (v: number): number => significant(v, DIGITS);
/** The center of the mass and momentum checks, px: the deposit reproduces a particle's position to a fraction of the weight error. */
const CENTER_TOLERANCE_PX = 0.01;

const relative = (value: number, reference: number, floor = 0): number =>
    Math.abs(value - reference) / Math.max(Math.abs(reference), floor, Number.MIN_VALUE);

/** The grids as the model draws them from the textures as they are now, and the reduction of them, read back. */
export async function drawAndReduce(context: LabContext): Promise<{ texels: Float32Array; reduction: Reduction }> {
    const model = protostarModel(context);
    model.beforeSubstep(0);                              // draws the grids from the current state (and keeps the previous potential)
    model.debugGrids.reduceStats();
    const texels = await readTarget(context.renderer, protostarGrids(context).reduce2);
    const scales = model.debugReductionScales;
    if (!scales) throw new Error('the model has not drawn its grids');
    return { texels, reduction: unpackReduction(texels, scales, true) };
}

// ---- protostar.energy-reference ----

/** Converts the self term (deposit units) the way unpackReduction does, to add it back to a corrected potential. */
const selfTermInSimulationUnits = (gravityPerDeposit: number, softening: number, massSquared: number, massPerDeposit: number): number =>
    0.5 * selfPotentialPerMassSquared(gravityPerDeposit, softening) * massSquared * massPerDeposit;


interface ReferenceReport {
    metrics: Record<string, JsonValue>;
    ok: boolean;
    detail: string;
}

async function referenceCloud(context: LabContext, frames: number): Promise<ReferenceReport> {
    const { renderer, simulation } = context;
    await restart(context, { count: ENERGY_REFERENCE_PARTICLES });
    await runFrames(context, frames);
    const model = protostarModel(context);
    const grids = model.debugGrids;
    const targets = protostarGrids(context);
    const { reduction } = await drawAndReduce(context);
    const scales = model.debugReductionScales!;
    const count = simulation.activeCount;
    const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const velocities = await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count);
    const inputs = grids.debugDepositInputs;
    const gravity = scales.gravityPerDeposit / scales.massPerDeposit;

    // (1) The direct pair sum: no grid.
    const direct = directEnergies(positions, velocities, count, inputs.depositMass, gravity, scales.softening);
    // (2) The twin of the grid scheme: the deposit of the positions read back, summed as the shaders sum it.
    const deposit = referenceDeposit(positions, count, inputs, DEPOSIT_WEIGHT_MARGIN);
    const twin = gridGravity(deposit.mass, {
        resolution: PROTOSTAR_GRID_RES, coarseFactor: PROTOSTAR_COARSE_FACTOR, nearRadius: PROTOSTAR_NEAR_RADIUS,
        cell: inputs.gridCell, softening: scales.softening, gravityPerDeposit: scales.gravityPerDeposit,
    });
    const massSquared = sumChannel(deposit.composition, 2);
    const selfTerm = 0.5 * selfPotentialPerMassSquared(scales.gravityPerDeposit, scales.softening) * massSquared;
    const rawTwin = gridPotentialSum(deposit.mass, twin.phi);
    const potentialTwin = (rawTwin - selfTerm) * scales.massPerDeposit;
    const potentialTwinUncorrected = rawTwin * scales.massPerDeposit;

    // The gravity grid the GPU drew against the twin's.
    const force = await readTarget(renderer, targets.gravity);
    const scale = (field: ArrayLike<number>): number => Array.from(field).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const fieldError = (gpu: Float64Array, twinField: Float64Array): number => {
        let worst = 0;
        for (let c = 0; c < twinField.length; c++) worst = Math.max(worst, Math.abs(gpu[c] - twinField[c]));
        return worst / Math.max(scale(twinField), Number.MIN_VALUE);
    };
    const fields = {
        ax: fieldError(extractChannel(force, 0), twin.ax),
        ay: fieldError(extractChannel(force, 1), twin.ay),
        phi: fieldError(extractChannel(force, 2), twin.phi),
    };

    const kineticError = relative(reduction.energy.kinetic, direct.kinetic);
    const twinError = relative(reduction.energy.potentialNow, potentialTwin);
    const gridError = relative(reduction.energy.potentialNow, direct.potential);
    const uncorrectedError = relative(reduction.energy.potentialNow + selfTermInSimulationUnits(scales.gravityPerDeposit, scales.softening, massSquared, scales.massPerDeposit),
        direct.potential);
    const ok = kineticError <= ENERGY_KINETIC_TOLERANCE && twinError <= ENERGY_TWIN_TOLERANCE && gridError <= ENERGY_GRID_TOLERANCE
        && Math.max(fields.ax, fields.ay, fields.phi) <= GRAVITY_TWIN_TOLERANCE;
    const virial = (2 * direct.kinetic) / Math.abs(direct.potential);
    return {
        ok,
        metrics: {
            particles: count,
            frames,
            liveParticles: direct.particles,
            gravityPerMass: sig(gravity),
            softeningPx: sig(scales.softening),
            kinetic: { gpu: sig(reduction.energy.kinetic), direct: sig(direct.kinetic), relativeError: sig(kineticError) },
            potential: {
                gpu: sig(reduction.energy.potentialNow), twinOfTheGrid: sig(potentialTwin), direct: sig(direct.potential),
                relativeErrorToTwin: sig(twinError), relativeErrorToDirect: sig(gridError),
                relativeErrorToDirectWithoutSelfTerm: sig(uncorrectedError),
                twinWithoutSelfTerm: sig(potentialTwinUncorrected),
            },
            selfTermShareOfPotential: sig(Math.abs(selfTerm * scales.massPerDeposit / direct.potential)),
            virialRatio: sig(virial),
            gravityGridVsTwin: { ax: sig(fields.ax), ay: sig(fields.ay), phi: sig(fields.phi) },
        },
        detail: `${frames} frames: K ${kineticError.toExponential(1)}, U to the twin ${twinError.toExponential(1)}, U to the pair sum ${(gridError * 100).toFixed(2)} % `
            + `(${(uncorrectedError * 100).toFixed(2)} % without the self term), virial ${virial.toFixed(2)}`,
    };
}

/**
 * The potential kept before the grids are drawn again is the one of the previous substep: after one substep the synchronized
 * potential of the reduction equals the "now" potential read one substep earlier, exactly (same pass, same grids).
 */
async function stashCheck(context: LabContext): Promise<{ ok: boolean; metrics: Record<string, JsonValue> }> {
    const { simulation } = context;
    await restart(context, { count: ENERGY_REFERENCE_PARTICLES });
    simulation.timeScale = 1;                                           // one substep per step
    await runFrames(context, 3);
    const model = protostarModel(context);
    const targets = protostarGrids(context);
    const read = async (): Promise<Reduction> => {
        model.debugGrids.reduceStats();
        return unpackReduction(await readTarget(context.renderer, targets.reduce2), model.debugReductionScales!, true);
    };
    const before = await read();                                        // the grids of the last substep: A
    simulation.step();                                                  // keeps A's potential, draws B, moves the particles
    const after = await read();                                         // reduction of B, with A's potential
    const stashed = after.energy.potential ?? NaN;
    const expected = before.energy.potentialNow;
    const error = relative(stashed, expected);
    const moved = relative(after.energy.potentialNow, expected);
    return {
        ok: error <= ENERGY_TWIN_TOLERANCE && moved > error * 10,
        metrics: {
            stashedPotential: sig(stashed), potentialOfThePreviousGrids: sig(expected), relativeDifference: sig(error),
            potentialOfTheNewGrids: sig(after.energy.potentialNow), changeOverOneSubstep: sig(moved),
        },
    };
}

export const energyReference: Scenario = {
    id: 'protostar.energy-reference',
    title: 'Protostar: K and U of the reduction against a CPU reference (pair sum and twin of the grid scheme)',
    tags: ['protostar', 'energy', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const reports: ReferenceReport[] = [];
        for (const frames of ENERGY_REFERENCE_FRAMES) reports.push(await referenceCloud(context, frames));
        const stash = await stashCheck(context);
        const ok = reports.every(r => r.ok) && stash.ok;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                clouds: Object.fromEntries(reports.map((r, i) => [`frames${ENERGY_REFERENCE_FRAMES[i]}`, r.metrics])),
                previousPotentialKept: stash.metrics,
                tolerances: {
                    kinetic: ENERGY_KINETIC_TOLERANCE, twin: ENERGY_TWIN_TOLERANCE, gridToPairSum: ENERGY_GRID_TOLERANCE,
                    gravityGridToTwin: GRAVITY_TWIN_TOLERANCE,
                },
            },
            details: `${reports.map(r => r.detail).join('; ')}; previous potential kept: ${stash.ok ? 'ok' : 'WRONG'}`
                + (ok ? '' : `; clouds ok: ${reports.map(r => r.ok).join(', ')}`),
        };
    },
};

// ---- protostar.reduction-channels ----

export const reductionChannels: Scenario = {
    id: 'protostar.reduction-channels',
    title: 'Protostar: every channel of the multichannel reduction against CPU sums (grids and particles)',
    tags: ['protostar', 'energy', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation } = context;
        await restart(context, { count: REDUCTION_PARTICLES });
        await runFrames(context, REDUCTION_FRAMES);
        const model = protostarModel(context);
        const grids = model.debugGrids;
        const { texels, reduction } = await drawAndReduce(context);
        const targets = protostarGrids(context);          // after the drawing: the gas pass has two targets that take turns
        const scales = model.debugReductionScales!;
        const count = simulation.activeCount;

        // (1) The twin of the reduction on the grids read back.
        const read = {
            gas: await readTarget(renderer, targets.gas),
            thermo: await readAttachment(renderer, targets.gas, 1),
            moments: await readTarget(renderer, targets.moments),
            composition: await readAttachment(renderer, targets.moments, 1),
            force: await readTarget(renderer, targets.gravity),
            power: await readTarget(renderer, targets.power),
            source: await readAttachment(renderer, targets.gas, 3),
        };
        const sums = reductionReference({
            ...read, gravityPerDeposit: scales.gravityPerDeposit, resolution: PROTOSTAR_GRID_RES, block: PROTOSTAR_GRID_RES / PROTOSTAR_STATS_REDUCE_RES,
            cell: grids.common.gridCell.value, fusionTRef: grids.common.fusionTRef.value,
        });
        // |sum m v| <= sqrt(sum m x sum m |v|^2): the scale of a momentum, which cancels.
        const momentumScale = Math.sqrt(sums.mass * sums.doubleKinetic);
        const at = (texel: number, channel: number): number => texels[texel * 4 + channel];
        const { core, extremes, energy, moments } = REDUCTION_TEXEL;
        const channels: Record<string, number> = {
            peakDensity: relative(at(core, 0), sums.peakDensity),
            peakTemperature: relative(at(core, 1), sums.peakTemperature),
            fusionRate: relative(at(core, 2), sums.fusionRate),
            mass: relative(at(core, 3), sums.mass),
            peakX: relative(at(extremes, 0), sums.peak.x),
            peakY: relative(at(extremes, 1), sums.peak.y),
            maxSpeed: relative(at(extremes, 2), sums.maxSpeed),
            maxAcceleration: relative(at(extremes, 3), sums.maxAcceleration),
            doubleKinetic: relative(at(energy, 0), sums.doubleKinetic),
            potential: relative(at(energy, 1), sums.potential),
            minSoftening: relative(at(energy, 2), sums.minSoftening),
            massPositionX: relative(at(moments, 0), sums.massPosition.x),
            massPositionY: relative(at(moments, 1), sums.massPosition.y),
            momentumX: relative(at(moments, 2), sums.momentum.x, momentumScale),
            momentumY: relative(at(moments, 3), sums.momentum.y, momentumScale),
        };
        const worstChannel = Object.entries(channels).reduce((a, b) => b[1] > a[1] ? b : a);

        // (2) The sums that the deposit makes exact, against sums over the particles themselves.
        const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
        const velocities = await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count);
        const masses = grids.debugDepositInputs.depositMass;
        let mass = 0, x = 0, y = 0, px = 0, py = 0, kinetic = 0, fastest = 0, live = 0;
        for (let i = 0; i < count; i++) {
            if (!(positions[i * 4 + 3] >= 0)) continue;
            const m = masses[Math.round(positions[i * 4 + 2])];
            const [vx, vy] = [velocities[i * 4], velocities[i * 4 + 1]];
            live++;
            mass += m; x += m * positions[i * 4]; y += m * positions[i * 4 + 1];
            px += m * vx; py += m * vy; kinetic += 0.5 * m * (vx * vx + vy * vy);
            fastest = Math.max(fastest, Math.hypot(vx, vy));
        }
        const center = reduction.centerOfMass;
        const particleScale = Math.sqrt(mass * 2 * kinetic);
        const exact = {
            mass: relative(reduction.mass, mass),
            kinetic: relative(reduction.energy.kinetic, kinetic),
            centerXPx: Math.abs((center?.x ?? NaN) - x / mass),
            centerYPx: Math.abs((center?.y ?? NaN) - y / mass),
            momentumX: Math.abs(reduction.momentum.x - px) / particleScale,
            momentumY: Math.abs(reduction.momentum.y - py) / particleScale,
        };
        // (3) What the proxies are worth: the speed bound against the fastest particle and the fraction of particles above it.
        let faster = 0;
        for (let i = 0; i < count; i++) {
            if (positions[i * 4 + 3] >= 0 && Math.hypot(velocities[i * 4], velocities[i * 4 + 1]) > reduction.maxSpeed) faster++;
        }
        const channelsOk = Object.values(channels).every(v => v <= REDUCTION_SUM_TOLERANCE);
        const exactOk = exact.mass <= REDUCTION_PARTICLE_TOLERANCE && exact.kinetic <= REDUCTION_PARTICLE_TOLERANCE
            && exact.centerXPx <= CENTER_TOLERANCE_PX && exact.centerYPx <= CENTER_TOLERANCE_PX
            && exact.momentumX <= REDUCTION_PARTICLE_TOLERANCE && exact.momentumY <= REDUCTION_PARTICLE_TOLERANCE;
        const busiest = Math.max(...Array.from({ length: PROTOSTAR_GRID_RES ** 2 }, (_, c) => read.moments[c * 4]));
        return {
            status: channelsOk && exactOk ? 'pass' : 'fail',
            metrics: {
                particles: count, liveParticles: live, frames: REDUCTION_FRAMES,
                busiestCellMass: sig(busiest),
                peak: { densityRho0: sig(reduction.peakDensity), temperatureT0: sig(reduction.peakTemperature), xPx: sig(reduction.peak.x), yPx: sig(reduction.peak.y) },
                centerOfMassPx: center ? { x: sig(center.x), y: sig(center.y) } : null,
                maxSpeedPxPerS: sig(reduction.maxSpeed),
                maxAccelerationPxPerS2: sig(reduction.maxAcceleration),
                fastestParticlePxPerS: sig(fastest),
                particlesFasterThanTheSpeedBound: faster,
                speedBoundOverFastestParticle: sig(reduction.maxSpeed / fastest),
                kinetic: sig(reduction.energy.kinetic), potentialNow: sig(reduction.energy.potentialNow),
                mass: sig(reduction.mass),
                gridsAgainstTheirTwin: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, sig(v)])),
                particlesAgainstTheReduction: Object.fromEntries(Object.entries(exact).map(([k, v]) => [k, sig(v)])),
                tolerances: { sums: REDUCTION_SUM_TOLERANCE, particles: REDUCTION_PARTICLE_TOLERANCE, centerPx: CENTER_TOLERANCE_PX },
                scales: { massPerDeposit: sig(scales.massPerDeposit), depositVelScale: sig(scales.depositVelScale) },
            },
            details: `worst channel against the twin of the grids: ${worstChannel[0]} ${worstChannel[1].toExponential(1)}; against the particles: `
                + `mass ${exact.mass.toExponential(1)}, K ${exact.kinetic.toExponential(1)}, center ${exact.centerXPx.toFixed(4)} / ${exact.centerYPx.toFixed(4)} px, `
                + `momentum ${exact.momentumX.toExponential(1)} / ${exact.momentumY.toExponential(1)}; speed bound ${(reduction.maxSpeed / fastest).toFixed(2)} x the fastest particle `
                + `(${faster} particles above it)`,
        };
    },
};

// ---- baseline.protostar.energy-drift ----

interface DriftSeries {
    frames: number[];
    orbits: number[];
    drift: number[];
    driftUnsynchronized: number[];
    virial: number[];
    kinetic: number[];
    potential: number[];
    peakDensity: number[];
    centerOfMassX: number[];
    centerOfMassY: number[];
    maxSpeed: number[];
    maxAcceleration: number[];
}

export interface DriftRun {
    name: string;
    orbitPeriod: number;
    orbitsRun: number;
    frames: number;
    /** Substeps the frames ran in all (the fixed count of the speed, or the adaptive step's). */
    substeps: number;
    wallSeconds: number;
    series: DriftSeries;
    synchronized: DriftStatistics | null;
    synchronizedSettled: DriftStatistics | null;
    unsynchronized: DriftStatistics | null;
    unsynchronizedSettled: DriftStatistics | null;
    initial: { kinetic: number; potential: number; total: number; virial: number | null } | null;
}

/**
 * `?energyStep=fixed`, `adaptive` or `varying` sets the time step of these runs (phase B5), whatever the application's default (they run with the
 * application's when the option is absent): the fixed count of substeps, the adaptive step, or a count that changes every frame (the pattern below, 1 to
 * 4 substeps, as a stress of the half kicks over the previous step's length).
 */
const VARYING_SUBSTEPS = [2, 3, 1, 2, 4, 2, 3, 1] as const;
const energyStepChoice = (): string | null => new URLSearchParams(globalThis.location?.search ?? '').get('energyStep');

function stepOverride(): Record<string, boolean> {
    const choice = energyStepChoice();
    return choice === 'fixed' || choice === 'varying' ? { adaptiveTimeStep: false } : choice === 'adaptive' ? { adaptiveTimeStep: true } : {};
}

/** A conservative run: the cloud, its length, the time step and the walls. */
export interface DriftSpec {
    name: string;
    /** Initial conditions and switches, through the sliders. */
    params: Record<string, number | boolean>;
    particles: number;
    orbits: number;
    maxFrames: number;
    budgetMs: number;
    /** Speed after the restart; the time step is BASE_DT x speed / ceil(speed). Default speed when omitted. */
    timeScale?: number;
    /** Restitution of the walls; the application's when omitted. */
    restitution?: number;
    /** After the restart, before the first frame (the nested grid's scenarios force its box there). */
    afterRestart?(model: ProtostarModel): void;
    /** After every frame (1-based). */
    onFrame?(frame: number, model: ProtostarModel): void;
}

/** A conservative run of one cloud for up to `orbits` orbits (at the half-mass radius), reading the energy every few frames. */
export async function driftRun(context: LabContext, spec: DriftSpec): Promise<DriftRun> {
    try {
        return await driftRunUnchecked(context, spec);
    } finally {
        protostarModel(context).velocityUniforms.restitution.value = PROTOSTAR_RESTITUTION;
        protostarModel(context).debugSubsteps = null;
    }
}

async function driftRunUnchecked(context: LabContext, spec: DriftSpec): Promise<DriftRun> {
    const { name, particles, orbits, maxFrames } = spec;
    const { simulation } = context;
    await restart(context, { count: particles, overrides: { ...CONSERVATIVE_OVERRIDES, ...stepOverride() }, params: spec.params, timeScale: spec.timeScale });
    const model = protostarModel(context);
    model.velocityUniforms.restitution.value = spec.restitution ?? PROTOSTAR_RESTITUTION;
    spec.afterRestart?.(model);
    const length = Math.min(LAB_AREA.width, LAB_AREA.height);
    const num = (key: string): number => Number(simulation.params[key]);
    const gravity = num(PROTOSTAR_PARAM.gravity) * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS;
    const softening = num(PROTOSTAR_PARAM.softening) / 100 * length;
    const radius = PROTOSTAR_CLOUD_RADIUS * length;
    const orbitPeriod = orbitalPeriod(gravity, TOTAL_MASS / 2, radius / Math.SQRT2, softening);
    const perFrame = frameSeconds(context);
    const totalFrames = Math.min(maxFrames, Math.ceil(orbits * orbitPeriod / perFrame));

    const series: DriftSeries = {
        frames: [], orbits: [], drift: [], driftUnsynchronized: [], virial: [], kinetic: [], potential: [], peakDensity: [],
        centerOfMassX: [], centerOfMassY: [], maxSpeed: [], maxAcceleration: [],
    };
    const varying = energyStepChoice() === 'varying';
    if (varying) model.debugSubsteps = VARYING_SUBSTEPS[0];
    const first: { energy: DriftRun['initial']; unsynchronized: number | null } = { energy: null, unsynchronized: null };
    let frames = 0;
    let substeps = 0;
    const started = performance.now();
    const take = async (): Promise<void> => {
        await model.debugReading;
        const reduction = model.reduction;
        const e = model.energy;
        if (!reduction || !e) return;
        const unsynchronized = reduction.energy.kinetic + reduction.energy.potentialNow;
        first.unsynchronized ??= unsynchronized;
        first.energy ??= { kinetic: e.kinetic, potential: e.potential, total: e.total, virial: e.virial };
        series.frames.push(frames);
        series.orbits.push(frames * perFrame / orbitPeriod);
        series.drift.push(e.drift ?? NaN);
        series.driftUnsynchronized.push((unsynchronized - first.unsynchronized) / Math.abs(first.unsynchronized));
        series.virial.push(e.virial ?? NaN);
        series.kinetic.push(e.kinetic);
        series.potential.push(e.potential);
        series.peakDensity.push(reduction.peakDensity);
        series.centerOfMassX.push(reduction.centerOfMass?.x ?? NaN);
        series.centerOfMassY.push(reduction.centerOfMass?.y ?? NaN);
        series.maxSpeed.push(reduction.maxSpeed);
        series.maxAcceleration.push(reduction.maxAcceleration);
    };
    while (frames < totalFrames && performance.now() - started < spec.budgetMs) {
        const chunk = Math.min(ENERGY_DRIFT_CHUNK_FRAMES, totalFrames - frames);
        await runFrames(context, chunk, {
            async onFrame() {
                frames++;
                substeps += simulation.lastSubsteps;
                spec.onFrame?.(frames, model);
                if (varying) model.debugSubsteps = VARYING_SUBSTEPS[frames % VARYING_SUBSTEPS.length];
                model.endFrame();                                      // the model alone: the reduction only
                if (frames === 1 || frames % ENERGY_DRIFT_READ_EVERY === 0) await take();
            },
        });
    }
    await take();
    const settle = ENERGY_DRIFT_SETTLE_ORBITS;
    return {
        name, orbitPeriod, orbitsRun: frames * perFrame / orbitPeriod, frames, substeps, wallSeconds: (performance.now() - started) / 1000, series,
        synchronized: driftStatistics(series.orbits, series.drift),
        synchronizedSettled: driftStatistics(series.orbits, series.drift, settle),
        unsynchronized: driftStatistics(series.orbits, series.driftUnsynchronized),
        unsynchronizedSettled: driftStatistics(series.orbits, series.driftUnsynchronized, settle),
        initial: first.energy,
    };
}

const percent = (v: number | undefined): number | null => v === undefined || !Number.isFinite(v) ? null : sig(v * 100);

function statisticsMetrics(s: DriftStatistics | null): JsonValue {
    if (!s) return null;
    return {
        readings: s.count, finalPercent: percent(s.final), maxAbsPercent: percent(s.maxAbs), lastTenthMeanPercent: percent(s.lateMean),
        slopePercentPerOrbit: percent(s.slopePerOrbit), oscillationAmplitudePercent: percent(s.oscillation),
    };
}

export function runMetrics(run: DriftRun): Record<string, JsonValue> {
    const s = run.series;
    const keep = decimate(s.frames.map((_, i) => i), 60);
    const pick = (values: number[]): number[] => keep.map(i => sig(values[i]));
    return {
        orbitPeriodSeconds: sig(run.orbitPeriod),
        orbitsRun: sig(run.orbitsRun),
        frames: run.frames,
        meanSubstepsPerFrame: sig(run.substeps / Math.max(1, run.frames)),
        wallSeconds: significant(run.wallSeconds, 3),
        initial: run.initial ? {
            kinetic: sig(run.initial.kinetic), potential: sig(run.initial.potential), total: sig(run.initial.total),
            specificTotal: sig(run.initial.total / TOTAL_MASS), virialRatio: run.initial.virial === null ? null : sig(run.initial.virial),
        } : null,
        driftPercentAtOrbits: Object.fromEntries(ENERGY_DRIFT_REPORT_ORBITS.map(orbit => {
            const i = s.orbits.findIndex(o => o >= orbit);
            return [String(orbit), i < 0 ? null : percent(s.drift[i])];
        })),
        synchronizedEnergy: { all: statisticsMetrics(run.synchronized), afterSettling: statisticsMetrics(run.synchronizedSettled) },
        unsynchronizedEnergy: { all: statisticsMetrics(run.unsynchronized), afterSettling: statisticsMetrics(run.unsynchronizedSettled) },
        finalPeakDensity: s.peakDensity.length ? sig(s.peakDensity[s.peakDensity.length - 1]) : null,
        finalVirialRatio: s.virial.length ? sig(s.virial[s.virial.length - 1]) : null,
        centerOfMassDriftPx: s.centerOfMassX.length ? sig(Math.hypot(
            s.centerOfMassX[s.centerOfMassX.length - 1] - s.centerOfMassX[0], s.centerOfMassY[s.centerOfMassY.length - 1] - s.centerOfMassY[0])) : null,
        series: {
            orbits: pick(s.orbits), driftPercent: keep.map(i => sig(s.drift[i] * 100)),
            unsynchronizedDriftPercent: keep.map(i => sig(s.driftUnsynchronized[i] * 100)),
            virialRatio: pick(s.virial), peakDensity: pick(s.peakDensity), maxSpeed: pick(s.maxSpeed), maxAcceleration: pick(s.maxAcceleration),
        },
    };
}

export const summary = (run: DriftRun): string => {
    const all = run.synchronized, late = run.synchronizedSettled, lag = run.unsynchronized;
    const p = (v: number | undefined): string => v === undefined ? 'n/a' : `${(v * 100).toFixed(2)} %`;
    return `${run.name}: ${run.orbitsRun.toFixed(0)} orbits, drift ${p(all?.final)} (max ${p(all?.maxAbs)}, +/- ${p(all?.oscillation)} about ${p(late?.slopePerOrbit)}/orbit after settling; `
        + `unsynchronized K + U max ${p(lag?.maxAbs)})`;
};

export const energyDrift: Scenario = {
    id: 'baseline.protostar.energy-drift',
    title: 'Energy drift of a conservative protostar run (K + U over 100 orbits, elastic walls, the default time step)',
    tags: ['baseline', 'protostar', 'energy', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) {
            const run = await driftRun(context, {
                name: 'default', params: {}, particles: 20000, orbits: ENERGY_DRIFT_ORBITS, maxFrames: ENERGY_DRIFT_FRAMES_SOFTWARE, budgetMs: 60_000,
            });
            return { status: 'skip', metrics: { valid: false, ...runMetrics(run) }, details: `INVALID: software renderer (${context.rendererName}), a token run only; ${summary(run)}` };
        }
        const runs: DriftRun[] = [];
        for (const cloud of ENERGY_DRIFT_CLOUDS) {
            runs.push(await driftRun(context, {
                name: cloud.name, params: cloud.params, particles: ENERGY_DRIFT_PARTICLES, orbits: ENERGY_DRIFT_ORBITS,
                maxFrames: Number.MAX_SAFE_INTEGER, budgetMs: cloud.budgetMs, restitution: cloud.elasticWalls ? ELASTIC_WALLS : PROTOSTAR_RESTITUTION,
            }));
        }
        // The criterion of the plan, judged on the default cloud in its conservative configuration, whole run included.
        const judged = runs[0];
        const maxDrift = judged.synchronized?.maxAbs ?? NaN;
        const complete = judged.orbitsRun >= ENERGY_DRIFT_ORBITS - 1e-6;
        const meets = maxDrift < ENERGY_DRIFT_TARGET;
        const metrics: Record<string, JsonValue> = {
            valid: true,
            renderer: context.rendererName,
            particles: ENERGY_DRIFT_PARTICLES,
            timeScale: context.simulation.timeScale,
            timeStep: energyStepChoice() ?? (context.simulation.params[PROTOSTAR_PARAM.adaptiveTimeStep] === true ? 'adaptive (default)' : 'fixed (default)'),
            frameSeconds: sig(frameSeconds(context)),
            baseDt: sig(BASE_DT),
            configuration: {
                overrides: { ...CONSERVATIVE_OVERRIDES }, wallRestitution: { conservativeRuns: ELASTIC_WALLS, application: PROTOSTAR_RESTITUTION },
                orbitDefinition: 'period of a circular orbit at the initial half-mass radius, the softened law',
            },
            criterion: {
                target: `K + U within ${ENERGY_DRIFT_TARGET * 100} % over ${ENERGY_DRIFT_ORBITS} orbits`,
                judgedOn: judged.name, maxAbsDriftPercent: percent(maxDrift), orbitsRun: sig(judged.orbitsRun), meets,
            },
            clouds: Object.fromEntries(runs.map(r => [r.name, runMetrics(r)])),
        };
        const description = runs.map(summary).join('; ');
        if (!meets) {
            return {
                status: 'fail', metrics,
                details: `K + U drifts by up to ${(maxDrift * 100).toFixed(2)} % (target < ${ENERGY_DRIFT_TARGET * 100} %) over ${judged.orbitsRun.toFixed(0)} orbits; ${description}`,
            };
        }
        if (!complete) {
            return { status: 'skip', metrics, details: `only ${judged.orbitsRun.toFixed(0)} of ${ENERGY_DRIFT_ORBITS} orbits fit in the budget, inside the target so far; ${description}` };
        }
        return { status: 'pass', metrics, details: `within ${ENERGY_DRIFT_TARGET * 100} % over ${judged.orbitsRun.toFixed(0)} orbits; ${description}` };
    },
};

// ---- baseline.protostar.energy-drift-attribution ----

/**
 * Where the energy goes. The conservative run of the default cloud with elastic walls for a few orbits, the time step divided by 1, 2 and
 * 4, and once with the application's walls (they return half of the speed) at the default step. If the drift shrinks with the step it is
 * the integrator's; the walls' share is the difference of the last two runs at the same step.
 */
export const energyDriftAttribution: Scenario = {
    id: 'baseline.protostar.energy-drift-attribution',
    title: 'Where the energy of a conservative protostar run goes: time step and walls',
    tags: ['baseline', 'protostar', 'energy', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: 'Software renderer: too slow for the variants.' };
        const base = context.simulation.algorithm.defaultSpeed ?? 1;
        const variants = [
            ...ENERGY_ATTRIBUTION_STEP_DIVISORS.map(divisor => ({ divisor, restitution: ELASTIC_WALLS })),
            { divisor: 1, restitution: PROTOSTAR_RESTITUTION },
        ];
        const lines: string[] = [];
        const results: Record<string, JsonValue> = {};
        for (const { divisor, restitution } of variants) {
            // A speed of at most 1 runs one substep per frame, of BASE_DT x speed: the default speed's two substeps become one of the same length at base / 2.
            const timeScale = base / 2 / divisor;
            const label = `dt/${divisor}, ${restitution === ELASTIC_WALLS ? 'elastic walls' : 'walls as they are'}`;
            const run = await driftRun(context, {
                name: label, params: {}, particles: ENERGY_DRIFT_PARTICLES, orbits: ENERGY_ATTRIBUTION_ORBITS, maxFrames: Number.MAX_SAFE_INTEGER,
                budgetMs: ENERGY_ATTRIBUTION_BUDGET_MS, timeScale, restitution,
            });
            const dt = BASE_DT * timeScale / Math.max(1, Math.ceil(timeScale - 1e-6));
            const last = run.series.drift.length - 1;
            const at = (orbit: number): number => run.series.drift[run.series.orbits.findIndex(o => o >= orbit)];
            results[label] = {
                timeStepMs: sig(dt * 1000), orbitsRun: sig(run.orbitsRun), finalDriftPercent: percent(run.series.drift[last]),
                maxAbsDriftPercent: percent(run.synchronized?.maxAbs), finalVirialRatio: sig(run.series.virial[last]),
                finalPeakDensity: sig(run.series.peakDensity[last]),
                afterOneOrbitPercent: percent(at(1)), afterThreeOrbitsPercent: percent(at(3)), afterSixOrbitsPercent: percent(at(6)),
                slopeAfterSettlingPercentPerOrbit: percent(run.synchronizedSettled?.slopePerOrbit),
            };
            lines.push(`${label} (${(dt * 1000).toFixed(1)} ms): ${(run.series.drift[last] * 100).toFixed(2)} % after ${run.orbitsRun.toFixed(1)} orbits`);
        }
        return { status: 'pass', metrics: { orbitsPerVariant: ENERGY_ATTRIBUTION_ORBITS, variants: results }, details: lines.join('; ') };
    },
};
