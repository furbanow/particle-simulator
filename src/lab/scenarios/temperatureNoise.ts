// Acceptance of the correction of the noise of the temperature (proposal A3, lever 1, with the Gamow rates of A2): the mean
// fusion rate of a thermal gas of known dispersion against the true rate, with the correction off
// (the bias the plan predicts) and on. The gas is uniform, at rest apart from its Maxwellian
// velocities, with gravity, cooling and feedback off; it is a pure hydrogen gas at 15 MK (the proton-proton chain, whose local
// exponent is 3.9) or a pure helium gas at 100 MK (the triple alpha, 41), at the reference temperature of its law, so the true
// rate per particle is lambda rho^n. The gas is
// drawn again, with a new seed, for each reading, and the grids are drawn twice from the same
// particles (the correction switched off, then on), so both rates come from the same noise.
// The mean rate over a handful of neighborhoods is dominated by rare hot ones at a large exponent
// and few particles (the relative spread of one neighborhood is sqrt(exp(alpha^2 / N) - 1)): the
// readings go on until the standard error is small, or the case's time is up, and a case whose
// standard error stays above NOISE_JUDGED_ERROR (N = 100 at alpha = 41) is reported, not judged.

import { MAX_SPECIES, PROTOSTAR_GRID_RES, PROTOSTAR_T0_KELVIN } from '../../config';
import { molecularWeightFactors } from '../../simulation/protostar/composition';
import { PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../../simulation/protostar/declaration';
import { logGammaRatio, logNoiseBiasCurved } from '../../simulation/protostar/noiseBias';
import { barrierTerm, localExponent } from '../../simulation/protostar/reactions';
import {
    LAB_AREA, NOISE_JUDGED_ERROR, NOISE_LAWS, NOISE_MAX_PARTICLES, NOISE_MIN_READINGS,
    NOISE_NEIGHBORHOODS, NOISE_RATE, NOISE_SEED, NOISE_TARGET_ERROR, NOISE_TOLERANCE, THERMAL_GAS_MARGIN,
    THERMAL_GAS_OVERRIDES,
} from '../config';
import { protostarGrids, protostarModel, restart } from '../driver';
import { boxDensity } from '../ignitionScan';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readAttachment, readTarget } from '../readback';
import { fillThermalGas, interiorCells, LAB_CELL, thermalSigma, type Box } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const MEGA = 1e6;

/** A pure gas at the reference temperature of one reaction's law: which reaction, its type, the dispersion that reads as its temperature. */
interface NoiseGas {
    name: string;
    reaction: number;
    type: number;
    /** The dispersion, in T0, that gives the temperature T_ref of the law (a helium gas reads 2.65 times its dispersion). */
    dispersion: number;
    /** d ln r / d ln T of the law at T_ref, and the barrier term there (what the noise correction of the shaders needs). */
    exponent: number;
    barrier: number;
    barrierPower: number;
}

const noiseGases = (): NoiseGas[] => {
    const factors = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
    return NOISE_LAWS.map(reaction => {
        const r = PROTOSTAR_REACTIONS[reaction];
        return {
            name: `${PROTOSTAR_TYPES[r.from].symbol} at ${r.referenceTemperature / MEGA} MK`, reaction, type: r.from,
            dispersion: r.referenceTemperature / PROTOSTAR_T0_KELVIN / factors[r.from],
            exponent: localExponent(r.law, r.referenceTemperature), barrier: barrierTerm(r.law, r.referenceTemperature), barrierPower: r.law.barrierPower,
        };
    });
};

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
async function reading(context: LabContext, count: number, box: Box, gas: NoiseGas, seed: number): Promise<Reading> {
    const { renderer } = context;
    const model = protostarModel(context);
    const reaction = PROTOSTAR_REACTIONS[gas.reaction];
    // The rate constant that makes the true rate per particle NOISE_RATE times the density, whatever the reaction's density exponent.
    const lambda = NOISE_RATE / boxDensity(box) ** (reaction.densityExponent - 1);
    const weights = PROTOSTAR_TYPES.map((_, k) => k === gas.type ? 1 : 0);
    model.debugInitialState = state => fillThermalGas(state, box, thermalSigma(gas.dispersion), mulberry32(seed), [0, 0], () => gas.type);
    try {
        await restart(context, { count, overrides: { ...THERMAL_GAS_OVERRIDES, feedback: 0, [reaction.rateParam]: lambda }, timeScale: 1, seed, weights });
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
    // The true rate of a particle is lambda rho^n (T = T_ref, pure fuel): rho is the mean density the particles see.
    const trueRate = lambda * (on.massDensity / on.mass) ** reaction.densityExponent;
    return {
        uncorrected: off.rate / off.mass / trueRate, corrected: on.rate / on.mass / trueRate,
        effectiveParticles: weighted / mass, neighborhood: 9 * on.mass / cells,
    };
}

/** The N for which the bias of the law of `gas` at its reference temperature is `bias` (bisection in ln N: the bias falls as N grows). */
function particlesForBias(bias: number, gas: NoiseGas): number {
    let [low, high] = [Math.log(1), Math.log(1e9)];
    for (let i = 0; i < 80; i++) {
        const mid = (low + high) / 2;
        if (logNoiseBiasCurved(Math.exp(mid), gas.exponent, gas.barrier, gas.barrierPower) > Math.log(bias)) low = mid; else high = mid;
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

async function runCase(context: LabContext, neighborhood: number, gas: NoiseGas): Promise<CaseReport> {
    const alpha = gas.exponent;
    const { noiseReadings, noiseBudgetSeconds } = context.options;
    const { box, count } = noiseBox(neighborhood);
    const uncorrected: number[] = [];
    const corrected: number[] = [];
    let effective = 0, actual = 0;
    const started = performance.now();
    let readings = 0;
    for (; readings < noiseReadings; readings++) {
        const r = await reading(context, count, box, gas, NOISE_SEED + readings);
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
    const fit = off.mean > 1.1 && off.error / off.mean < 0.03 ? particlesForBias(off.mean, gas) : null;
    return {
        judged, ok, kappa: fit === null ? null : fit / n,
        metrics: {
            neighborhood, gas: gas.name, alpha: significant(alpha, 4), particles: count, readings, seconds: significant((performance.now() - started) / 1000, 3),
            particlesPerNeighborhood: significant(n, 4), effectiveParticlesShader: significant(effective / readings, 4),
            uncorrected: { ratio: significant(off.mean, DIGITS), error: significant(off.error, 2) },
            corrected: { ratio: significant(on.mean, DIGITS), error: significant(on.error, 2), relativeError: significant(relativeError, 2) },
            predictedBiasIndependentN: significant(Math.exp(logGammaRatio(n, alpha)), DIGITS),
            predictedBiasShaderN: significant(Math.exp(logNoiseBiasCurved(effective / readings, alpha, gas.barrier, gas.barrierPower)), DIGITS),
            effectiveParticlesFromBias: fit === null ? null : significant(fit, 4),
            judged, withinTolerance: judged ? ok : null,
        },
        summary: `${gas.name} N=${Math.round(n)} a=${alpha.toFixed(1)}: raw x${off.mean.toPrecision(3)} (predicted ${Math.exp(logGammaRatio(n, alpha)).toPrecision(3)} for N independent, ${Math.exp(logNoiseBiasCurved(effective / readings, alpha, gas.barrier, gas.barrierPower)).toPrecision(3)} for N_eff, Gamow's curvature included), `
            + `corrected ${on.mean.toPrecision(3)} +- ${on.error.toPrecision(2)} (${readings} readings)${judged ? '' : ' [not judged]'}`,
    };
}

export const temperatureNoise: Scenario = {
    id: 'protostar.temperature-noise',
    title: 'Noise of the temperature: mean fusion rate of a thermal gas against the true rate, N from 100 to 6 400, hydrogen at 15 MK (local exponent 3.9) and helium at 100 MK (41), correction off and on',
    tags: ['protostar', 'noise', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: `a software renderer (${context.rendererName}) would take hours to draw millions of particles` };
        await restart(context, { count: 1000 });       // the protostar must be running before its model is configured
        const cases: CaseReport[] = [];
        const gases = noiseGases();
        for (const gas of gases) {
            for (const neighborhood of NOISE_NEIGHBORHOODS) cases.push(await runCase(context, neighborhood, gas));
        }
        const fits = cases.flatMap(c => c.kappa === null ? [] : [c.kappa]);
        const kappa = fits.length > 0 ? fits.reduce((s, v) => s + v, 0) / fits.length : null;
        const ok = cases.every(c => c.ok) && cases.filter(c => c.judged).length >= gases.length * 3;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                gases: gases.map(g => ({ name: g.name, dispersionT0: significant(g.dispersion, 5), localExponent: significant(g.exponent, 4) })), rateConstant: NOISE_RATE, tolerance: NOISE_TOLERANCE, judgedError: NOISE_JUDGED_ERROR,
                cases: cases.map(c => c.metrics),
                effectiveOverNominalFromBias: kappa === null ? null : significant(kappa, 3),
                effectiveOverNominalFromBiasCases: fits.map(v => significant(v, 3)),
            },
            details: cases.map(c => c.summary).join('\n'),
        };
    },
};
