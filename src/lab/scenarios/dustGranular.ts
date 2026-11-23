// The granular physics of the sticky dust (docs/spikes/a10-granular-dust.md): the deposit of the agitation
// energy against a CPU reference, and the free cooling of a uniform cloud against Haff's law.

import type { DepositKernel } from '../../simulation/depositKernel';
import {
    BASE_DT, DENSITY_RES, GLOBAL_DRAG, KINETIC_PRESSURE, K_PRESSURE, MOMENTUM_SCALE, RESTITUTION, TEX_SIZE, TOTAL_MASS,
} from '../../config';
import { REFERENCE_RES } from '../../simulation/densityField';
import { DEFAULT_SCALES, agitation, type MomentScales } from '../../simulation/stickyDust/granular';
import {
    AGITATION_DENSITY_CLASSES, AGITATION_MEDIAN_LIMIT, AGITATION_MIN_CONTRIBUTIONS, DEPOSIT_ROUNDINGS, DEPOSIT_ROUNDOFF_HALF,
    DEPOSIT_WEIGHT_ERROR, DEPOSIT_WEIGHT_MARGIN, DUST_DEPOSIT_CLUMPED_FRAMES, DUST_DEPOSIT_CLUMPED_PARTICLES, DUST_DEPOSIT_SEED,
    DUST_COLD_BULK, DUST_COLD_PARTICLES, DUST_COLD_SIGMA, DUST_DEPOSIT_SPARSE_FRAMES, DUST_DEPOSIT_SPARSE_PARTICLES, HAFF_EXPONENT_TOLERANCE, HAFF_FIT_FLOOR, HAFF_FRAMES, HAFF_MIN_MASS,
    HAFF_MIN_R2, HAFF_PARTICLES, HAFF_SAMPLE_EVERY, HAFF_SIGMA, HAFF_STICK_RATE, LAB_AREA, REFERENCE_WEIGHT_BITS,
} from '../config';
import {
    agitationOfGrid, compareDustDeposit, meanAgitation, momentsAt, referenceDustDeposit, referenceFromGrid, referenceUncertainty,
    type DustChannelComparison, type DustDepositInputs,
} from '../dustDeposit';
import { frameSeconds, restart, runFrames, stickyDustModel } from '../driver';
import { fitHaff } from '../haffFit';
import { quantile, significant } from '../numbers';
import { mulberry32, withSeededRandom } from '../random';
import { readPositions, readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);
/** A normal deviate of standard deviation 1 from two uniform ones (Box-Muller). */
const gaussian = (random: () => number): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

const CHANNELS = ['mass', 'momentumX', 'momentumY', 'energy'] as const;

/** Error statistics of a set of relative errors. */
function errorStats(errors: readonly number[]): Record<string, JsonValue> {
    return {
        texels: errors.length, median: round(quantile(errors, 0.5)), p95: round(quantile(errors, 0.95)),
        p99: round(quantile(errors, 0.99)), max: round(errors.length === 0 ? NaN : Math.max(...errors)),
    };
}

export interface DepositReport {
    metrics: Record<string, JsonValue>;
    comparisons: DustChannelComparison[];
    /** Median relative error of the agitation over the texels judged, with the reference and without. */
    medianError: number;
    medianErrorWithoutReference: number;
}

/**
 * Restarts the default cloud with `particles` particles, steps it, then deposits its state as it is now (the
 * last substep's grid was drawn from the state before it) and compares the density grid with the CPU reference:
 * channel by channel against the tolerance model, then the agitation T the shader will compute from it against the exact variance
 * of the particles in each texel, with the energy deposited about the reference velocity and about zero.
 */
export async function validateDeposit(context: LabContext, prepare: () => Promise<void>, title: string,
                                      kernel: DepositKernel = 'cic'): Promise<DepositReport> {
    const { renderer, simulation } = context;
    await prepare();
    const model = stickyDustModel(context);
    const density = model.debugDensity;
    const pipeline = simulation.debugPipeline;
    const count = simulation.activeCount;
    const scales = DEFAULT_SCALES;
    const read = async (): Promise<Float32Array> => readTarget(renderer, density.target);
    const deposit = async (referenceEnabled: boolean): Promise<{ grid: Float32Array; referenceGrid: Float32Array; referenceOffset: [number, number] }> => {
        density.referenceEnabled = referenceEnabled;
        try {
            density.render(simulation.positionTexture, simulation.velocityTexture);
        } finally {
            density.referenceEnabled = true;
        }
        return {
            grid: await read(), referenceGrid: await readTarget(renderer, density.debugReferenceTarget),
            referenceOffset: [density.referenceOffset.value.x, density.referenceOffset.value.y],
        };
    };
    await withSeededRandom(DUST_DEPOSIT_SEED + 1, () => density.shiftGrid());
    const domainOffset: [number, number] = [density.domainOffset.value.x, density.domainOffset.value.y];
    const domainSize = density.domainSize.value;
    const withReference = await deposit(true);
    const positions = await readPositions(renderer, pipeline.debugPositionTarget, count);
    const velocities = await readPositions(renderer, pipeline.debugVelocityTarget, count);
    const splatMass = simulation.speciesUniforms.splatMass.value;

    const inputs: DustDepositInputs = {
        resolution: DENSITY_RES, domainOffset, domainSize, splatMass, scales,
        reference: (x, y) => ({
            velocity: referenceFromGrid(withReference.referenceGrid, REFERENCE_RES, withReference.referenceOffset, domainSize, MOMENTUM_SCALE, x, y),
            uncertainty: referenceUncertainty(withReference.referenceGrid, REFERENCE_RES, withReference.referenceOffset, domainSize,
                MOMENTUM_SCALE, x, y, REFERENCE_WEIGHT_BITS),
        }),
    };
    const reference = referenceDustDeposit(positions, velocities, count, inputs, DEPOSIT_WEIGHT_MARGIN, kernel);
    const comparisons = compareDustDeposit(withReference.grid, reference, {
        roundoff: DEPOSIT_ROUNDOFF_HALF, roundings: DEPOSIT_ROUNDINGS, weightError: DEPOSIT_WEIGHT_ERROR,
    });

    // The exact moments of each texel, unscaled and about zero: the variance the particles really have there.
    const exactScales: MomentScales = { momentum: 1, energy: 1 };
    const exact = referenceDustDeposit(positions, velocities, count, { ...inputs, scales: exactScales, reference: () => ({ velocity: [0, 0], uncertainty: 0 }) },
        DEPOSIT_WEIGHT_MARGIN, kernel);
    const texel = domainSize / DENSITY_RES;
    const referenceAtCenter = (grid: Float32Array, offset: readonly [number, number]) => (x: number, y: number): [number, number] =>
        referenceFromGrid(grid, REFERENCE_RES, offset, domainSize, MOMENTUM_SCALE, (x + 0.5) * texel - domainOffset[0], (y + 0.5) * texel - domainOffset[1]);
    const gridT = agitationOfGrid(withReference.grid, DENSITY_RES, scales, referenceAtCenter(withReference.referenceGrid, withReference.referenceOffset));
    const naive = await deposit(false);
    const naiveT = agitationOfGrid(naive.grid, DENSITY_RES, scales, () => [0, 0]);

    const classes = AGITATION_DENSITY_CLASSES;
    const withClass = (errors: number[][]): Record<string, JsonValue> => Object.fromEntries(
        classes.map((lo, k) => [`mass${lo}${k + 1 < classes.length ? `to${classes[k + 1]}` : 'up'}`, errorStats(errors[k])]));
    const withErrors = classes.map((): number[] => []);
    const withoutErrors = classes.map((): number[] => []);
    const allWith: number[] = [];
    const allWithout: number[] = [];
    let nonFinite = 0;
    let saturated = 0;
    let denseTexels = 0;
    for (let i = 0; i < DENSITY_RES * DENSITY_RES; i++) {
        const m = momentsAt(withReference.grid, i);
        if (!Number.isFinite(m.energy) || !Number.isFinite(naive.grid[i * 4 + 3])) nonFinite++;
        const exactMoments = momentsAt(exact.grid, i);
        if (exactMoments.mass >= classes[classes.length - 1]) {
            denseTexels++;
            if (m.mass < 0.99 * exactMoments.mass) saturated++;
        }
        if (reference.contributions[i] < AGITATION_MIN_CONTRIBUTIONS || !(exactMoments.mass >= classes[0])) continue;
        const truth = agitation(exactMoments, [0, 0], exactScales);
        if (!(truth > 0)) continue;
        let k = 0;
        while (k + 1 < classes.length && exactMoments.mass >= classes[k + 1]) k++;
        const e = Math.abs(gridT[i] - truth) / truth;
        const n = Math.abs(naiveT[i] - truth) / truth;
        withErrors[k].push(e);
        withoutErrors[k].push(Number.isFinite(n) ? n : Infinity);
        allWith.push(e);
        allWithout.push(Number.isFinite(n) ? n : Infinity);
    }
    const metrics: Record<string, JsonValue> = {
        state: title, particles: count, depositedParticles: reference.deposited,
        busiestTexel: reference.contributions.reduce((most, n) => Math.max(most, n), 0),
        channels: Object.fromEntries(comparisons.map((c, i) => [CHANNELS[i], {
            maxExcessOverTolerance: round(c.maxExcess), maxRelativeError: round(c.maxRelativeError), texelsOverTolerance: c.texelsOverTolerance,
            sumGpu: round(c.sumGpu), sumReference: round(c.sumReference),
        }])),
        nonFiniteTexels: nonFinite,
        denseTexels, denseTexelsHoldingUnder99PercentOfTheirMass: saturated,
        agitationJudgedWhereAtLeastParticleClouds: AGITATION_MIN_CONTRIBUTIONS,
        agitationRelativeError: { all: errorStats(allWith), byMass: withClass(withErrors) },
        agitationRelativeErrorWithoutReference: { all: errorStats(allWithout), byMass: withClass(withoutErrors) },
    };
    return { metrics, comparisons, medianError: quantile(allWith, 0.5), medianErrorWithoutReference: quantile(allWithout, 0.5) };
}

const worstExcess = (comparisons: DustChannelComparison[]): number => Math.max(...comparisons.map(c => c.maxExcess));

/**
 * The deposit of the dust's density grid against a CPU reference computed from the positions and velocities read back. On
 * a sparse cloud and on a cold flow it is judged against the tolerance model of a half-float deposit (every channel, the energy about
 * the reference velocity included, and a texel nothing reaches holds exactly 0: the alpha channel is cleared locally), and on the cold
 * flow the agitation the velocity pass derives must be within AGITATION_MEDIAN_LIMIT of the exact one (in the median). On the default
 * cloud once its clumps have formed (thousands of particles in a texel, the accumulation of the half floats loses the small
 * contributions) it is measured: the agitation derived, with the reference and without.
 */
export const dustDeposit: Scenario = {
    id: 'dust.deposit',
    title: 'Sticky dust: the density grid (mass, momentum, agitation energy) against a CPU reference, and the agitation derived from it',
    tags: ['dust', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { simulation } = context;
        const evolved = (particles: number, frames: number) => async (): Promise<void> => {
            await restart(context, { algorithm: 'stickyDust', count: particles, seed: DUST_DEPOSIT_SEED });
            await withSeededRandom(DUST_DEPOSIT_SEED, () => runFrames(context, frames));
        };
        const sparse = await validateDeposit(context, evolved(DUST_DEPOSIT_SPARSE_PARTICLES, DUST_DEPOSIT_SPARSE_FRAMES), 'sparse donut after a few frames');
        const clumped = context.software ? null
            : await validateDeposit(context, evolved(DUST_DEPOSIT_CLUMPED_PARTICLES, DUST_DEPOSIT_CLUMPED_FRAMES), 'default cloud with its clumps');
        // A cold flow: grains of a small agitation in a bulk flow far faster than it, where the energy about zero would be lost.
        const cold = await validateDeposit(context, async () => {
            await restart(context, { algorithm: 'stickyDust', count: DUST_COLD_PARTICLES, weights: [1, 0, 0], seed: DUST_DEPOSIT_SEED });
            const count = simulation.activeCount;
            const random = mulberry32(DUST_DEPOSIT_SEED + 3);
            const positions = new Float32Array(count * 4);
            const velocities = new Float32Array(count * 4);
            for (let i = 0; i < count; i++) {
                positions.set([LAB_AREA.width * (0.25 + 0.5 * random()), LAB_AREA.height * (0.25 + 0.5 * random()), 0, 1], i * 4);
                velocities[i * 4] = DUST_COLD_BULK[0] + DUST_COLD_SIGMA * gaussian(random);
                velocities[i * 4 + 1] = DUST_COLD_BULK[1] + DUST_COLD_SIGMA * gaussian(random);
            }
            simulation.debugPipeline.debugSetState(positions, velocities);
            // The reference is made from the deposit before: one deposit to start from (about zero), the one measured then uses it.
            stickyDustModel(context).debugDensity.render(simulation.positionTexture, simulation.velocityTexture);
        }, `cold flow: ${DUST_COLD_SIGMA} px/s of agitation (T ${2 * DUST_COLD_SIGMA ** 2}) in a bulk flow of ${Math.hypot(...DUST_COLD_BULK).toFixed(0)} px/s`);
        const held = worstExcess(sparse.comparisons) <= 1 && sparse.metrics.nonFiniteTexels === 0
            && worstExcess(cold.comparisons) <= 1 && cold.medianError <= AGITATION_MEDIAN_LIMIT;
        const pct = (v: number): string => `${(100 * v).toFixed(2)} %`;
        return {
            status: held ? 'pass' : 'fail',
            metrics: { sparse: sparse.metrics, coldFlow: cold.metrics, clumped: clumped ? clumped.metrics : null },
            details: `sparse cloud: worst error over tolerance ${worstExcess(sparse.comparisons).toPrecision(3)} (must be <= 1); `
                + `cold flow: worst error over tolerance ${worstExcess(cold.comparisons).toPrecision(3)}, agitation median error ${pct(cold.medianError)} `
                + `(without the reference velocity ${pct(cold.medianErrorWithoutReference)})`
                + (clumped ? `; clumped cloud: worst error over tolerance ${worstExcess(clumped.comparisons).toPrecision(3)}, agitation median error ${pct(clumped.medianError)} `
                    + `(without the reference velocity ${pct(clumped.medianErrorWithoutReference)})` : ''),
        };
    },
};

/**
 * Haff's free cooling in 2D: grains filling the area uniformly with Gaussian velocities cool by sticking alone, so that
 * T^(-1/2) grows linearly with time, T = T0 / (1 + t / t0)^2. The agitation is measured twice: on the density grid (the
 * variance about each texel's mean flow, which the sticking acts on) and exactly on the particles read back (about the
 * global mean flow). The slope of T^(-1/2) must also be the sticking rate times the density the particles feel.
 */
export const dustHaff: Scenario = {
    id: 'dust.haff',
    title: "Sticky dust: free cooling of a uniform cloud follows Haff's law, T ~ (1 + t / t0)^-2",
    tags: ['dust', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: 'Software renderer: a million particles for 700 frames would take too long.' };
        const { renderer, simulation } = context;
        await restart(context, { algorithm: 'stickyDust', count: HAFF_PARTICLES, weights: [1, 0, 0], seed: DUST_DEPOSIT_SEED });
        const model = stickyDustModel(context);
        const density = model.debugDensity;
        const pipeline = simulation.debugPipeline;
        const count = simulation.activeCount;
        const u = model.velocityUniforms;
        const random = mulberry32(DUST_DEPOSIT_SEED);
        const positions = new Float32Array(count * 4);
        const velocities = new Float32Array(count * 4);
        let mx = 0, my = 0;
        for (let i = 0; i < count; i++) {
            positions.set([LAB_AREA.width * (0.02 + 0.96 * random()), LAB_AREA.height * (0.02 + 0.96 * random()), 0, 1], i * 4);
            velocities[i * 4] = HAFF_SIGMA * gaussian(random);
            velocities[i * 4 + 1] = HAFF_SIGMA * gaussian(random);
            mx += velocities[i * 4];
            my += velocities[i * 4 + 1];
        }
        for (let i = 0; i < count; i++) { velocities[i * 4] -= mx / count; velocities[i * 4 + 1] -= my / count; }
        const trueAgitation = async (): Promise<number> => {
            const v = await readPositions(renderer, pipeline.debugVelocityTarget, count);
            let sum = 0, sx = 0, sy = 0;
            for (let i = 0; i < count; i++) {
                sum += v[i * 4] ** 2 + v[i * 4 + 1] ** 2;
                sx += v[i * 4];
                sy += v[i * 4 + 1];
            }
            return sum / count - (sx / count) ** 2 - (sy / count) ** 2;
        };
        const seconds = frameSeconds(context);
        const exact: [number, number][] = [];
        const grid: [number, number][] = [];
        let densityFelt = NaN;
        const overrides = (): void => {
            u.kGravity.value = 0;
            u.kPressure.value = 0;
            u.kineticPressure.value = 0;
            u.globalDrag.value = 0;
            u.restitution.value = 1;
            u.stickRate.value = HAFF_STICK_RATE;
            u.collisionSpeed.value = 1e6;
        };
        try {
            pipeline.debugSetState(positions, velocities);
            overrides();
            exact.push([0, await trueAgitation()]);
            await withSeededRandom(DUST_DEPOSIT_SEED + 2, () => runFrames(context, HAFF_FRAMES, {
                async onFrame(frame) {
                    if (frame % HAFF_SAMPLE_EVERY !== 0) return;
                    exact.push([frame * seconds, await trueAgitation()]);
                    const rgba = await readTarget(renderer, density.target);
                    const referenceGrid = await readTarget(renderer, density.debugReferenceTarget);
                    const offset = [density.domainOffset.value.x, density.domainOffset.value.y] as const;
                    const referenceOffset = [density.referenceOffset.value.x, density.referenceOffset.value.y] as const;
                    const size = density.domainSize.value;
                    const texel = size / DENSITY_RES;
                    const mean = meanAgitation(rgba, DENSITY_RES, DEFAULT_SCALES, HAFF_MIN_MASS, (x, y) => referenceFromGrid(
                        referenceGrid, REFERENCE_RES, referenceOffset, size, MOMENTUM_SCALE, (x + 0.5) * texel - offset[0], (y + 0.5) * texel - offset[1]));
                    grid.push([frame * seconds, mean.temperature]);
                    if (Number.isNaN(densityFelt)) densityFelt = mean.mass2 / mean.mass;
                },
            }));
        } finally {
            u.kPressure.value = K_PRESSURE;
            u.kineticPressure.value = KINETIC_PRESSURE;
            u.globalDrag.value = GLOBAL_DRAG;
            u.restitution.value = RESTITUTION;
        }
        const floor = (series: [number, number][]): [number, number][] => series.filter(([, T]) => T >= HAFF_FIT_FLOOR * series[0][1]);
        const gridFit = fitHaff(floor(grid));
        const exactFit = fitHaff(floor(exact));
        const predictedSlope = HAFF_STICK_RATE * densityFelt;
        const initialExact = exact[0][1];
        const ok = Math.abs(gridFit.exponent + 2) <= HAFF_EXPONENT_TOLERANCE && gridFit.line.r2 >= HAFF_MIN_R2;
        const fitMetrics = (fit: ReturnType<typeof fitHaff>, series: [number, number][]): Record<string, JsonValue> => ({
            points: floor(series).length, slopeOfInverseRootT: round(fit.line.slope), r2OfInverseRootT: round(fit.line.r2), t0: round(fit.t0),
            exponent: round(fit.exponent), exponentR2: round(fit.exponentR2), initialAgitationFromFit: round(fit.initialAgitation),
        });
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: count, frames: HAFF_FRAMES, seconds: round(HAFF_FRAMES * seconds), sigma: HAFF_SIGMA, stickRate: HAFF_STICK_RATE,
                substepSeconds: round(BASE_DT * simulation.timeScale / Math.max(1, Math.ceil(simulation.timeScale - 1e-6))), totalMass: TOTAL_MASS, texSize: TEX_SIZE,
                expectedInitialAgitation: round(2 * HAFF_SIGMA ** 2), initialAgitationExact: round(initialExact),
                densityFelt: round(densityFelt), predictedSlope: round(predictedSlope),
                grid: fitMetrics(gridFit, grid), exact: fitMetrics(exactFit, exact),
                slopeOverPredicted: round(gridFit.line.slope / predictedSlope),
                gridSeries: grid.map(([t, T]) => [round(t), round(T)]), exactSeries: exact.map(([t, T]) => [round(t), round(T)]),
            },
            details: `agitation fell from ${initialExact.toFixed(0)} to ${exact[exact.length - 1][1].toFixed(1)} px^2/s^2 (exactly) in ${(HAFF_FRAMES * seconds).toFixed(1)} s; `
                + `on the grid: exponent ${gridFit.exponent.toFixed(3)} (expected -2), T^-1/2 linear with R^2 ${gridFit.line.r2.toFixed(5)}, slope ${gridFit.line.slope.toPrecision(4)} `
                + `against ${predictedSlope.toPrecision(4)} predicted (rate x density felt); exact: exponent ${exactFit.exponent.toFixed(3)}, R^2 ${exactFit.line.r2.toFixed(5)}`,
        };
    },
};

export const dustGranularScenarios: Scenario[] = [dustDeposit, dustHaff];
