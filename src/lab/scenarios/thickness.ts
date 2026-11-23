// The adaptive thickness of the protostar (phase P9, proposal A11, docs/spikes/a11-adaptive-thickness.md), on the real GPU:
//  - protostar.thickness.parity: with the flag off, the gravity grid is the fixed softening's to the bit (against the drawings' pass on the
//    same grids); with it on, the thickness of every cell, the fusion law's factor and the gravity grid against the twins of thickness.ts;
//  - protostar.thickness.start: the thickness of the initial cloud (the default one and a virial one) against initialThickness();
//  - protostar.thickness.kernel: the response of the gravity to a ripple of the surface density, flag off and on, against kernelResponse()
//    (the gravity term of the ripple's relation of dispersion, omega^2 = c_s^2 k^2 - 2 pi G Sigma k K(k));
//  - protostar.thickness.loop: a conservative virial disc with the flag on: the loop temperature -> thickness -> gravity stays quiet;
//  - protostar.thickness.momentum: the total momentum of the conservative default cloud, flag off and on.

import { PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, PROTOSTAR_COARSE_FACTOR, PROTOSTAR_NEAR_RADIUS,
    PROTOSTAR_THICKNESS_CEILING, PROTOSTAR_THICKNESS_FLOOR_CELLS, PROTOSTAR_THICKNESS_REFERENCE, TOTAL_MASS } from '../../config';
import type { InitialState } from '../../simulation/gpuModel';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import {
    initialThickness, kernelResponse, layerThickness, softenedGravityAt, thicknessPerDispersion, type ThicknessBounds,
} from '../../simulation/protostar/thickness';
import {
    CONSERVATIVE_OVERRIDES, ELASTIC_WALLS, GRAVITY_TWIN_TOLERANCE, LAB_AREA, LAB_SEED, THICKNESS_KERNEL_AMPLITUDE, THICKNESS_KERNEL_CHECKED_MODE,
    THICKNESS_KERNEL_HEIGHTS, THICKNESS_KERNEL_MODES, THICKNESS_KERNEL_PARTICLES, THICKNESS_KERNEL_SIGMA, THICKNESS_KERNEL_TOLERANCE,
    THICKNESS_LOOP_GROWTH, THICKNESS_LOOP_MIN_DENSITY, THICKNESS_LOOP_PARTICLES, THICKNESS_LOOP_READ_EVERY, THICKNESS_LOOP_SECONDS,
    THICKNESS_MOMENTUM_FRAMES, THICKNESS_MOMENTUM_PARTICLES, THICKNESS_MOMENTUM_READ_EVERY, THICKNESS_PARITY_FRAMES,
    THICKNESS_PARITY_PARTICLES, THICKNESS_PARITY_STRIDE, THICKNESS_START_PARTICLES, THICKNESS_START_RADIUS, THICKNESS_START_TOLERANCE,
    THICKNESS_TWIN_TOLERANCE, THICKNESS_VIRIAL_PARAMS,
} from '../config';
import { momentumChange, totalMomentum } from '../conservation';
import { frameSeconds, protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { mean, quantile, significant } from '../numbers';
import { mulberry32 } from '../random';
import { readAttachment, readPositions, readTarget } from '../readback';
import { gaussianPair } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const sig = (v: number): number => significant(v, 4);
const RES = PROTOSTAR_GRID_RES;
const LENGTH = Math.min(LAB_AREA.width, LAB_AREA.height);
const RADIUS = PROTOSTAR_CLOUD_RADIUS * LENGTH;
const numeric = (value: unknown): number => typeof value === 'number' ? value : NaN;

/** What the model computes the thickness with, recomputed from its parameters (G_eff, rho0, the bounds). */
function thicknessScales(context: LabContext): { perDispersion: number; bounds: ThicknessBounds; cell: number; gravity: number } {
    const model = protostarModel(context);
    const gravity = numeric(model.debugParams[PROTOSTAR_PARAM.gravity]) * PROTOSTAR_GRAVITY_UNIT * LENGTH ** 3 / TOTAL_MASS;
    const rho0 = TOTAL_MASS / (Math.PI * RADIUS * RADIUS);
    const cell = model.debugGrids.common.gridCell.value;
    return {
        perDispersion: thicknessPerDispersion(gravity, rho0), cell, gravity,
        bounds: { floor: PROTOSTAR_THICKNESS_FLOOR_CELLS * cell, ceiling: PROTOSTAR_THICKNESS_CEILING * RADIUS },
    };
}

/** The grids the thickness is read from, drawn from the current state. */
async function readThicknessGrids(context: LabContext): Promise<{ gas: Float32Array; thermo: Float32Array; source: Float32Array; gravity: Float32Array }> {
    const { renderer } = context;
    protostarModel(context).beforeSubstep(0);
    const targets = protostarGrids(context);
    return {
        gas: await readTarget(renderer, targets.gas),
        thermo: await readAttachment(renderer, targets.gas, 1),
        source: await readAttachment(renderer, targets.gas, 3),
        gravity: await readTarget(renderer, targets.gravity),
    };
}

// ---- protostar.thickness.parity ----

const parity: Scenario = {
    id: 'protostar.thickness.parity',
    title: 'Adaptive thickness (A11): the fixed softening to the bit with the flag off; the thickness, the fusion factor and the gravity against the twins with it on',
    tags: ['protostar', 'thickness', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer } = context;
        await restart(context, { count: THICKNESS_PARITY_PARTICLES });
        await runFrames(context, THICKNESS_PARITY_FRAMES);
        const model = protostarModel(context);
        const grids = model.debugGrids;

        // (1) Off: the protostar's pass (masses and softening from the source) against the drawings' (moments, softening2), same grids.
        model.beforeSubstep(0);
        const gravity = await readTarget(renderer, protostarGrids(context).gravity);
        const fixed = await readTarget(renderer, grids.debugRenderFixedGravity());
        let differing = 0;
        for (let k = 0; k < gravity.length; k++) if (!Object.is(gravity[k], fixed[k])) differing++;

        // (2) On: the thickness of every cell and the gravity at a lattice of cells against the twins.
        model.setParam(PROTOSTAR_PARAM.adaptiveThickness, true);
        const read = await readThicknessGrids(context);
        const scales = thicknessScales(context);
        const reference = PROTOSTAR_THICKNESS_REFERENCE * LENGTH;
        let hError = 0, factorError = 0, hMin = Infinity, hMax = 0;
        for (let c = 0; c < RES * RES; c++) {
            const rho = read.gas[c * 4], t = read.gas[c * 4 + 1];
            const twin = layerThickness(rho > 0 ? t : 0, rho, scales.perDispersion, scales.bounds);
            const h = Math.sqrt(read.source[c * 4 + 1]);
            hError = Math.max(hError, Math.abs(h - twin) / twin);
            if (rho > 0) {
                hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
                factorError = Math.max(factorError, Math.abs(read.thermo[c * 4 + 3] - reference / twin) / (reference / twin));
            }
        }
        const mass = new Float64Array(RES * RES), h2 = new Float64Array(RES * RES);
        for (let c = 0; c < RES * RES; c++) { mass[c] = read.source[c * 4]; h2[c] = read.source[c * 4 + 1]; }
        const grid = { res: RES, cell: scales.cell, mass, h2 };
        const perDeposit = model.debugReductionScales!.gravityPerDeposit;
        const worst = [0, 0, 0], largest = [0, 0, 0];
        for (let j = 1; j < RES; j += THICKNESS_PARITY_STRIDE) {
            for (let i = 1; i < RES; i += THICKNESS_PARITY_STRIDE) {
                const twin = softenedGravityAt(grid, PROTOSTAR_COARSE_FACTOR, PROTOSTAR_NEAR_RADIUS, i, j).map(v => v * perDeposit);
                for (let ch = 0; ch < 3; ch++) {
                    worst[ch] = Math.max(worst[ch], Math.abs(read.gravity[(j * RES + i) * 4 + ch] - twin[ch]));
                    largest[ch] = Math.max(largest[ch], Math.abs(twin[ch]));
                }
            }
        }
        const fieldError = worst.map((w, ch) => w / Math.max(largest[ch], Number.MIN_VALUE));
        model.setParam(PROTOSTAR_PARAM.adaptiveThickness, false);
        const ok = differing === 0 && hError <= THICKNESS_TWIN_TOLERANCE && factorError <= THICKNESS_TWIN_TOLERANCE
            && Math.max(...fieldError) <= GRAVITY_TWIN_TOLERANCE;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                flagOffDifferingFloats: differing, floats: gravity.length,
                thicknessRelativeError: sig(hError), fusionFactorRelativeError: sig(factorError),
                thicknessRangePx: [sig(hMin), sig(hMax)], boundsPx: [sig(scales.bounds.floor), sig(scales.bounds.ceiling)],
                gravityVsTwin: { ax: sig(fieldError[0]), ay: sig(fieldError[1]), phi: sig(fieldError[2]) },
            },
            details: `off: ${differing} of ${gravity.length} floats differ from the fixed softening's pass; on: h to the twin ${hError.toExponential(1)}, `
                + `fusion factor ${factorError.toExponential(1)}, gravity ${Math.max(...fieldError).toExponential(1)} (h from ${hMin.toFixed(1)} to ${hMax.toFixed(1)} px)`,
        };
    },
};

// ---- protostar.thickness.start ----

/** The median thickness (px) of the cells holding gas within `radius` (px) of the area's centre. */
function medianThickness(gas: Float32Array, source: Float32Array, cell: number, radius: number): number {
    const values: number[] = [];
    for (let j = 0; j < RES; j++) {
        for (let i = 0; i < RES; i++) {
            const c = j * RES + i;
            if (!(gas[c * 4] > 0)) continue;
            if (Math.hypot((i + 0.5) * cell - LAB_AREA.width / 2, (j + 0.5) * cell - LAB_AREA.height / 2) > radius) continue;
            values.push(Math.sqrt(source[c * 4 + 1]));
        }
    }
    return quantile(values, 0.5);
}

const start: Scenario = {
    id: 'protostar.thickness.start',
    title: 'Adaptive thickness (A11): the thickness of the initial cloud (default and virial) against initialThickness()',
    tags: ['protostar', 'thickness', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const cases: Record<string, JsonValue>[] = [];
        let ok = true;
        const notes: string[] = [];
        for (const [name, params] of [['default', {}], ['virial', THICKNESS_VIRIAL_PARAMS]] as const) {
            await restart(context, { count: THICKNESS_START_PARTICLES, params: { ...params, adaptiveThickness: true } });
            const read = await readThicknessGrids(context);
            const scales = thicknessScales(context);
            const model = protostarModel(context);
            const expected = initialThickness({
                radius: RADIUS, gravity: scales.gravity, totalMass: TOTAL_MASS, profile: 'uniform',
                virial: numeric(model.debugParams[PROTOSTAR_PARAM.alphaVir]), rotation: numeric(model.debugParams[PROTOSTAR_PARAM.betaRot]),
                softening: numeric(model.debugParams[PROTOSTAR_PARAM.softening]) / 100 * LENGTH, bounds: scales.bounds,
            });
            const measured = medianThickness(read.gas, read.source, scales.cell, THICKNESS_START_RADIUS * RADIUS);
            const error = measured / expected - 1;
            ok &&= Math.abs(error) <= THICKNESS_START_TOLERANCE;
            cases.push({ name, medianPx: sig(measured), expectedPx: sig(expected), relativeError: sig(error),
                medianOverL: sig(measured / LENGTH), medianOverR: sig(measured / RADIUS), cells: sig(measured / scales.cell) });
            notes.push(`${name}: h ${(measured / LENGTH).toFixed(4)} L = ${(measured / RADIUS).toFixed(3)} R (expected ${(expected / LENGTH).toFixed(4)} L, ${(100 * error).toFixed(1)} %)`);
        }
        return { status: ok ? 'pass' : 'fail', metrics: { cases }, details: notes.join('; ') };
    },
};

// ---- protostar.thickness.kernel ----

/** The sin(k x) part of a_x over the middle half of the area (cells), per unit amplitude: 2 <a_x sin k x>. */
function sinePart(gravity: Float32Array, k: number, cell: number): number {
    let sum = 0, n = 0;
    for (let j = 0; j < RES; j++) {
        const y = (j + 0.5) * cell;
        if (y < LAB_AREA.height / 4 || y > 3 * LAB_AREA.height / 4) continue;
        for (let i = 0; i < RES; i++) {
            const x = (i + 0.5) * cell;
            if (x < LAB_AREA.width / 4 || x > 3 * LAB_AREA.width / 4) continue;
            sum += gravity[(j * RES + i) * 4] * Math.sin(k * x);
            n++;
        }
    }
    return 2 * sum / Math.max(n, 1);
}

/** A gas filling the area at rest with the dispersion sigma per component, its x displaced by -(A / k) sin(k x): Sigma0 (1 + A cos k x). */
const rippleGas = (k: number, amplitude: number) => (state: InitialState): void => {
    const random = mulberry32(LAB_SEED);
    for (let i = 0; i < state.count; i++) {
        const u = random() * LAB_AREA.width;
        const x = amplitude > 0 ? u - (amplitude / k) * Math.sin(k * u) : u;
        const [gx, gy] = gaussianPair(random(), random());
        state.positions.set([x, random() * LAB_AREA.height, 0, 1], i * 4);
        state.velocities.set([THICKNESS_KERNEL_SIGMA * gx, THICKNESS_KERNEL_SIGMA * gy, 0, 0], i * 4);
    }
};

const kernel: Scenario = {
    id: 'protostar.thickness.kernel',
    title: 'Adaptive thickness (A11): the response of the gravity to a ripple of the surface density, flag off (e^-k eps) and on (e^-k h (1 + k h / 2)), against the twin',
    tags: ['protostar', 'thickness'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: 1000 });                 // the running algorithm must be the protostar to take an initial state
        const model = protostarModel(context);
        const sigma0 = TOTAL_MASS / (LAB_AREA.width * LAB_AREA.height);
        const runs: Record<string, JsonValue>[] = [];
        const notes: string[] = [];
        let ok = true;
        const settings = [
            { name: 'off', adaptive: false, height: THICKNESS_KERNEL_HEIGHTS[0] },
            ...THICKNESS_KERNEL_HEIGHTS.map(height => ({ name: `on, h ${height} px`, adaptive: true, height })),
        ];
        for (const setting of settings) {
            // G such that a layer of dispersion sigma^2 per component over Sigma0 is `height` thick: pi G Sigma0 = sigma^2 / h.
            const gravityEff = THICKNESS_KERNEL_SIGMA ** 2 / (setting.height * Math.PI * sigma0);
            const gravity = gravityEff * TOTAL_MASS / (PROTOSTAR_GRAVITY_UNIT * LENGTH ** 3);
            const modes: Record<string, JsonValue>[] = [];
            for (const mode of THICKNESS_KERNEL_MODES) {
                const k = 2 * Math.PI * mode / LAB_AREA.width;
                const response = async (amplitude: number): Promise<{ part: number; h: number; cell: number }> => {
                    model.debugInitialState = rippleGas(k, amplitude);
                    try {
                        await restart(context, {
                            count: THICKNESS_KERNEL_PARTICLES, overrides: { ...CONSERVATIVE_OVERRIDES, gravity },
                            params: { adaptiveThickness: setting.adaptive }, timeScale: 1,
                        });
                    } finally {
                        model.debugInitialState = null;
                    }
                    const read = await readThicknessGrids(context);
                    const cell = model.debugGrids.common.gridCell.value;
                    return { part: sinePart(read.gravity, k, cell), h: medianThickness(read.gas, read.source, cell, LAB_AREA.height / 4), cell };
                };
                const flat = await response(0);
                const rippled = await response(THICKNESS_KERNEL_AMPLITUDE);
                const measured = -(rippled.part - flat.part) / (2 * Math.PI * gravityEff * sigma0 * THICKNESS_KERNEL_AMPLITUDE);
                const softening = setting.adaptive ? flat.h : numeric(model.debugParams[PROTOSTAR_PARAM.softening]) / 100 * LENGTH;
                const expected = kernelResponse(k, flat.cell, softening, setting.adaptive);
                const fixedLaw = kernelResponse(k, flat.cell, softening, false);
                const error = measured / expected - 1;
                if (mode <= THICKNESS_KERNEL_CHECKED_MODE) ok &&= Math.abs(error) <= THICKNESS_KERNEL_TOLERANCE;
                modes.push({ mode, kPerPx: sig(k), kSoftening: sig(k * softening), measured: sig(measured), expected: sig(expected),
                    relativeError: sig(error), plainExponential: sig(fixedLaw) });
            }
            const worst = modes.filter(m => numeric(m.mode) <= THICKNESS_KERNEL_CHECKED_MODE)
                .reduce((w, m) => Math.max(w, Math.abs(numeric(m.relativeError))), 0);
            runs.push({ name: setting.name, gravity: sig(gravity), modes });
            notes.push(`${setting.name}: worst ${(100 * worst).toFixed(1)} % to the twin`);
        }
        return { status: ok ? 'pass' : 'fail', metrics: { amplitude: THICKNESS_KERNEL_AMPLITUDE, sigma: THICKNESS_KERNEL_SIGMA, runs }, details: notes.join('; ') };
    },
};

// ---- protostar.thickness.loop ----

const loop: Scenario = {
    id: 'protostar.thickness.loop',
    title: 'Adaptive thickness (A11): stability of the loop temperature -> thickness -> gravity in a conservative virial disc',
    tags: ['protostar', 'thickness', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer } = context;
        await restart(context, { count: THICKNESS_LOOP_PARTICLES, overrides: { ...CONSERVATIVE_OVERRIDES },
            params: { ...THICKNESS_VIRIAL_PARAMS, adaptiveThickness: true } });
        const scales = thicknessScales(context);
        const frames = Math.round(THICKNESS_LOOP_SECONDS / frameSeconds(context));
        const changes: number[] = [], medians: number[] = [], times: number[] = [];
        let previous: Float32Array | null = null;
        let outOfBounds = 0, nonFinite = 0;
        await runFrames(context, frames, {
            async onFrame(frame) {
                if (frame % THICKNESS_LOOP_READ_EVERY !== 0) return;
                const targets = protostarGrids(context);
                const gas = await readTarget(renderer, targets.gas);
                const source = await readAttachment(renderer, targets.gas, 3);
                const h: number[] = [];
                let squares = 0, n = 0;
                for (let c = 0; c < RES * RES; c++) {
                    const value = Math.sqrt(source[c * 4 + 1]);
                    if (!Number.isFinite(value)) nonFinite++;
                    if (value < scales.bounds.floor * (1 - 1e-6) || value > scales.bounds.ceiling * (1 + 1e-6)) outOfBounds++;
                    if (!(gas[c * 4] >= THICKNESS_LOOP_MIN_DENSITY)) continue;
                    h.push(value);
                    if (previous) {
                        const before = Math.sqrt(previous[c * 4 + 1]);
                        squares += ((value - before) / before) ** 2;
                        n++;
                    }
                }
                if (previous && n > 0) changes.push(Math.sqrt(squares / n));
                previous = source;
                medians.push(quantile(h, 0.5));
                times.push(frame * frameSeconds(context));
            },
        });
        const third = Math.max(1, Math.floor(changes.length / 3));
        const early = mean(changes.slice(0, third)), late = mean(changes.slice(-third));
        const ok = nonFinite === 0 && outOfBounds === 0 && late <= THICKNESS_LOOP_GROWTH * early;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                seconds: THICKNESS_LOOP_SECONDS, readings: medians.length, nonFinite, outOfBounds,
                rmsRelativeChangeEarly: sig(early), rmsRelativeChangeLate: sig(late),
                medianThicknessPx: medians.map(sig), timesSeconds: times.map(sig),
            },
            details: `rms change of h between readings ${(100 * early).toFixed(1)} % early, ${(100 * late).toFixed(1)} % late; median h `
                + `${medians[0]?.toFixed(1)} -> ${medians[medians.length - 1]?.toFixed(1)} px; ${outOfBounds} out of bounds, ${nonFinite} not finite`,
        };
    },
};

// ---- protostar.thickness.momentum ----

const momentum: Scenario = {
    id: 'protostar.thickness.momentum',
    title: 'Adaptive thickness (A11): the total momentum of the conservative default cloud (G > 0), flag off and on',
    tags: ['protostar', 'thickness'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation } = context;
        const runs: Record<string, JsonValue>[] = [];
        const notes: string[] = [];
        for (const adaptive of [false, true]) {
            await restart(context, { count: THICKNESS_MOMENTUM_PARTICLES, overrides: { ...CONSERVATIVE_OVERRIDES }, params: { adaptiveThickness: adaptive } });
            protostarModel(context).velocityUniforms.restitution.value = ELASTIC_WALLS;
            const count = simulation.activeCount;
            const sums = async () => {
                await context.sync.wait(simulation.positionTexture);
                const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
                const velocities = await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count);
                return totalMomentum(positions, velocities, count, () => 1);
            };
            const first = await sums();
            const series: number[] = [];
            await runFrames(context, THICKNESS_MOMENTUM_FRAMES, {
                async onFrame(frame) {
                    if (frame % THICKNESS_MOMENTUM_READ_EVERY === 0) series.push(momentumChange(first, await sums()).relativeThermal);
                },
            });
            const worst = Math.max(...series);
            runs.push({ adaptiveThickness: adaptive, relativeThermal: series.map(sig), worst: sig(worst) });
            notes.push(`${adaptive ? 'on' : 'off'}: |dP| up to ${worst.toExponential(2)} M sigma`);
        }
        return { status: 'pass', metrics: { frames: THICKNESS_MOMENTUM_FRAMES, runs }, details: notes.join('; ') };
    },
};

export const thicknessScenarios: readonly Scenario[] = [parity, start, kernel, loop, momentum];
