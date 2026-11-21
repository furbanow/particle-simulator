// Acceptance of the correction of the noise of the temperature (proposal A3, lever 1): the mean
// fusion rate of a thermal gas of known dispersion against the true rate, with the correction off
// (the bias the plan predicts) and on. The gas is uniform, at rest apart from its Maxwellian
// velocities, with gravity, cooling and feedback off; hydrogen fuses at lambda rho (T / T_ref)^alpha
// with the real exponents (4 for the proton-proton chain, 40 for the triple alpha: set below the
// sliders' range) and the gas at T = T_ref, so the true rate per particle is lambda rho. The gas is
// drawn again, with a new seed, for each reading, and the grids are drawn twice from the same
// particles (the correction switched off, then on), so both rates come from the same noise.
// The mean rate over a handful of neighborhoods is dominated by rare hot ones at a large exponent
// and few particles (the relative spread of one neighborhood is sqrt(exp(alpha^2 / N) - 1)): the
// readings go on until the standard error is small, or the case's time is up, and a case whose
// standard error stays above NOISE_JUDGED_ERROR (N = 100 and 200 at alpha = 40) is reported, not judged.

import { PROTOSTAR_GRID_RES } from '../../config';
import { logGammaRatio, logNoiseBias, noiseBias } from '../../simulation/protostar/noiseBias';
import {
    LAB_AREA, NOISE_EXPONENTS, NOISE_JUDGED_ERROR, NOISE_MAX_PARTICLES, NOISE_MIN_READINGS,
    NOISE_NEIGHBORHOODS, NOISE_RATE, NOISE_SEED, NOISE_TARGET_ERROR, NOISE_TOLERANCE, THERMAL_GAS_MARGIN,
    THERMAL_GAS_OVERRIDES, THERMAL_GAS_TEMPERATURE,
} from '../config';
import { protostarGrids, protostarModel, restart } from '../driver';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readAttachment, readTarget } from '../readback';
import { fillThermalGas, interiorCells, LAB_CELL, thermalSigma, type Box } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const SIGMA = thermalSigma(THERMAL_GAS_TEMPERATURE);

/** Mean and standard error of the mean. */
function meanAndError(values: readonly number[]): { mean: number; error: number } {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.length > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1) : NaN;
    return { mean, error: Math.sqrt(variance / values.length) };
}

/** The box of a case: the lab's area inside its margin, shrunk (about its center) for the densest gases, and the particle count for `neighborhood` particles per 3 x 3 cells. */
export function noiseBox(neighborhood: number): { box: Box; count: number } {
    const full = { width: LAB_AREA.width - 2 * THERMAL_GAS_MARGIN, height: LAB_AREA.height - 2 * THERMAL_GAS_MARGIN };
    const fullCells = full.width * full.height / (LAB_CELL * LAB_CELL);
    const perCell = neighborhood / 9;
    const scale = Math.min(1, Math.sqrt(NOISE_MAX_PARTICLES / (perCell * fullCells)));
    const [w, h] = [full.width * scale, full.height * scale];
    const [cx, cy] = [LAB_AREA.width / 2, LAB_AREA.height / 2];
    const box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
    return { box, count: Math.round(perCell * w * h / (LAB_CELL * LAB_CELL)) };
}

interface Reading {
    /** Mean rate of the particles over the true rate, without and with the correction. */
    uncorrected: number;
    corrected: number;
    /** Mean effective number of particles the gas pass computed, over the interior cells (weighted by their mass). */
    effectiveParticles: number;
    /** Particles per 3 x 3 neighborhood actually deposited (sum of the count channel over the interior over their cells x 9). */
    neighborhood: number;
}

/** Draws a gas, deposits it twice (correction off, on) and reads the mean rate of the interior particles. */
async function reading(context: LabContext, count: number, box: Box, alpha: number, seed: number): Promise<Reading> {
    const { renderer } = context;
    const model = protostarModel(context);
    model.debugInitialState = state => fillThermalGas(state, box, SIGMA, mulberry32(seed));
    try {
        await restart(context, { count, overrides: { ...THERMAL_GAS_OVERRIDES, feedback: 0, fusionRate: NOISE_RATE, fusionExponent: alpha }, timeScale: 1, seed });
    } finally {
        model.debugInitialState = null;
    }
    const grids = model.debugGrids;
    const targets = protostarGrids(context);
    const interior = interiorCells(box);
    const sums = async (): Promise<{ rate: number; mass: number; massDensity: number }> => {
        const [power, moments, gas] = [await readTarget(renderer, targets.power), await readTarget(renderer, targets.moments), await readTarget(renderer, targets.gas)];
        let rate = 0, mass = 0, massDensity = 0;
        for (let cy = interior.y0; cy < interior.y1; cy++) {
            for (let cx = interior.x0; cx < interior.x1; cx++) {
                const k = (cy * PROTOSTAR_GRID_RES + cx) * 4;
                rate += power[k + 1];
                mass += moments[k];
                massDensity += moments[k] * gas[k];
            }
        }
        return { rate, mass, massDensity };
    };
    // The grids are drawn from the particles as they are (no step), with the correction off and then on.
    grids.common.noiseCorrection.value = 0;
    model.beforeSubstep(0);
    const off = await sums();
    grids.common.noiseCorrection.value = 1;
    model.beforeSubstep(0);
    const on = await sums();
    const thermo = await readAttachment(renderer, targets.gas, 1);
    const moments = await readTarget(renderer, targets.moments);
    let weighted = 0, mass = 0, cells = 0;
    for (let cy = interior.y0; cy < interior.y1; cy++) {
        for (let cx = interior.x0; cx < interior.x1; cx++) {
            const k = (cy * PROTOSTAR_GRID_RES + cx) * 4;
            weighted += moments[k] * thermo[k + 1];
            mass += moments[k];
            cells++;
        }
    }
    // The true rate of a particle is lambda rho (T = T_ref): rho is the mean density the particles see.
    const trueRate = NOISE_RATE * (on.massDensity / on.mass);
    return {
        uncorrected: off.rate / off.mass / trueRate, corrected: on.rate / on.mass / trueRate,
        effectiveParticles: weighted / mass, neighborhood: 9 * on.mass / cells,
    };
}

/** The N for which the bias of exponent `alpha` is `bias` (bisection in ln N: the bias falls as N grows). */
function particlesForBias(bias: number, alpha: number): number {
    let [low, high] = [Math.log(1), Math.log(1e9)];
    for (let i = 0; i < 80; i++) {
        const mid = (low + high) / 2;
        if (logNoiseBias(Math.exp(mid), alpha) > Math.log(bias)) low = mid; else high = mid;
    }
    return Math.exp((low + high) / 2);
}

interface CaseReport {
    metrics: Record<string, JsonValue>;
    judged: boolean;
    ok: boolean;
    kappa: number | null;
    summary: string;
}

async function runCase(context: LabContext, neighborhood: number, alpha: number): Promise<CaseReport> {
    const { noiseReadings, noiseBudgetSeconds } = context.options;
    const { box, count } = noiseBox(neighborhood);
    const uncorrected: number[] = [];
    const corrected: number[] = [];
    let effective = 0, actual = 0;
    const started = performance.now();
    let readings = 0;
    for (; readings < noiseReadings; readings++) {
        const r = await reading(context, count, box, alpha, NOISE_SEED + readings);
        uncorrected.push(r.uncorrected);
        corrected.push(r.corrected);
        effective += r.effectiveParticles;
        actual += r.neighborhood;
        const c = meanAndError(corrected);
        if (readings + 1 >= NOISE_MIN_READINGS && c.error / c.mean <= NOISE_TARGET_ERROR) { readings++; break; }
        if (performance.now() - started > noiseBudgetSeconds * 1000) { readings++; break; }
    }
    const off = meanAndError(uncorrected);
    const on = meanAndError(corrected);
    const n = actual / readings;
    const relativeError = on.error / on.mean;
    const judged = relativeError <= NOISE_JUDGED_ERROR;
    const ok = !judged || Math.abs(on.mean - 1) <= NOISE_TOLERANCE;
    // The effective number of particles that would explain the uncorrected bias, when it is large enough to tell.
    const fit = off.mean > 1.1 && off.error / off.mean < 0.03 ? particlesForBias(off.mean, alpha) : null;
    return {
        judged, ok, kappa: fit === null ? null : fit / n,
        metrics: {
            neighborhood, alpha, particles: count, readings, seconds: significant((performance.now() - started) / 1000, 3),
            particlesPerNeighborhood: significant(n, 4), effectiveParticlesShader: significant(effective / readings, 4),
            uncorrected: { ratio: significant(off.mean, DIGITS), error: significant(off.error, 2) },
            corrected: { ratio: significant(on.mean, DIGITS), error: significant(on.error, 2), relativeError: significant(relativeError, 2) },
            predictedBiasIndependentN: significant(Math.exp(logGammaRatio(n, alpha)), DIGITS),
            predictedBiasShaderN: significant(noiseBias(effective / readings, alpha), DIGITS),
            effectiveParticlesFromBias: fit === null ? null : significant(fit, 4),
            judged, withinTolerance: judged ? ok : null,
        },
        summary: `N=${Math.round(n)} a=${alpha}: raw x${off.mean.toPrecision(3)} (predicted ${Math.exp(logGammaRatio(n, alpha)).toPrecision(3)} for N independent, ${noiseBias(effective / readings, alpha).toPrecision(3)} for N_eff), `
            + `corrected ${on.mean.toPrecision(3)} +- ${on.error.toPrecision(2)} (${readings} readings)${judged ? '' : ' [not judged]'}`,
    };
}

export const temperatureNoise: Scenario = {
    id: 'protostar.temperature-noise',
    title: 'Noise of the temperature: mean fusion rate of a thermal gas against the true rate, N from 100 to 6 400, alpha 4 and 40, correction off and on',
    tags: ['protostar', 'noise', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: `a software renderer (${context.rendererName}) would take hours to draw millions of particles` };
        await restart(context, { count: 1000 });       // the protostar must be running before its model is configured
        const cases: CaseReport[] = [];
        for (const alpha of NOISE_EXPONENTS) {
            for (const neighborhood of NOISE_NEIGHBORHOODS) cases.push(await runCase(context, neighborhood, alpha));
        }
        const fits = cases.flatMap(c => c.kappa === null ? [] : [c.kappa]);
        const kappa = fits.length > 0 ? fits.reduce((s, v) => s + v, 0) / fits.length : null;
        const ok = cases.every(c => c.ok) && cases.filter(c => c.judged).length >= NOISE_EXPONENTS.length * 3;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                temperatureT0: THERMAL_GAS_TEMPERATURE, rateConstant: NOISE_RATE, tolerance: NOISE_TOLERANCE, judgedError: NOISE_JUDGED_ERROR,
                cases: cases.map(c => c.metrics),
                effectiveOverNominalFromBias: kappa === null ? null : significant(kappa, 3),
                effectiveOverNominalFromBiasCases: fits.map(v => significant(v, 3)),
            },
            details: cases.map(c => c.summary).join('\n'),
        };
    },
};
