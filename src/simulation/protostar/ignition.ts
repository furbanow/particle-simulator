// Ignition temperature of the fusion reactions: the temperature at which a particle's expected
// fusion rate reaches a reference rate, at a reference density. Pure functions (tested), the
// inverse of fusionRate() in reactions.ts, which is itself the TypeScript twin of fusionRateOf in
// src/shaders/protostar-common.glsl:
//
//     rate = lambda * (rho X)^n * f(T) / f(T_ref)       f(T) = T^-p exp(-b T^-q), Gamow's law (A2)
//
// (capped at PROTOSTAR_FUSION_RATE_MAX). Keep the three in step: a change of the law in the shader changes fusionRate() and
// this file. The law has no closed-form inverse: the ignition temperature is found by bisection on ln T, the law being
// increasing up to its (very hot) maximum. Its logarithm is a function of ln(lambda) alone: a decade of lambda divides the
// temperature by 10^(1 / alpha), alpha the local exponent where the gas ignites (1.8 for the proton-proton chain at 15 MK,
// 1.06 for the triple alpha at 100 MK). T is the temperature of the gas, the velocity dispersion times mu / mu_H (A1, composition.ts):
// these are the temperatures a thermometer reads, not dispersions. The dispersion at which a pure gas ignites is that divided by its
// factor (2.65 for helium): see kineticIgnitionRatio(). The lab (src/lab) reports the ratio He / H of these temperatures: the
// real value is about 100 MK / 15 MK = 6.7.

import { PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_T0_KELVIN } from '../../config';
import type { ParamValues } from '../algorithm';
import { barrierTerm, lawAt, type FusionLaw, type FusionReaction } from './reactions';

/** The rate law of `reaction` at the parameter values `params` (what reactionArrays() hands the shader). */
export function fusionLawOf(reaction: FusionReaction, params: ParamValues): FusionLaw {
    const rate = params[reaction.rateParam];
    return {
        rate: typeof rate === 'number' ? rate : 0,
        densityExponent: reaction.densityExponent,
        reference: reaction.referenceTemperature / PROTOSTAR_T0_KELVIN,
        power: reaction.law.power,
        barrier: barrierTerm(reaction.law, reaction.referenceTemperature),
        barrierPower: reaction.law.barrierPower,
    };
}

/** Bounds of the search, in T / T_ref: far below any ignition, and the largest the laws are used at. */
const SEARCH_MIN = 1e-12;
const SEARCH_MAX = 1e6;
const SEARCH_STEPS = 200;

/**
 * Temperature, in T0, at which the law gives `targetRate` (fusions per second and per particle) at `density` (in rho0) in a gas
 * whose fuel is the fraction `fuel` of the mass. Infinity when no finite temperature does: a law that never fires, a rate above
 * the cap, no gas, a flat law, or a rate above the maximum of the law (a temperature far above anything the model reaches).
 */
export function ignitionTemperature(law: FusionLaw, density: number, targetRate: number, fuel = 1): number {
    if (law.rate <= 0 || density <= 0 || fuel <= 0 || targetRate <= 0 || targetRate >= PROTOSTAR_FUSION_RATE_MAX) return Infinity;
    const wanted = Math.log(targetRate) - Math.log(law.rate) - law.densityExponent * Math.log(density * fuel);
    const logLaw = (logTau: number): number => lawAt(law, law.reference * Math.exp(logTau)).logLaw;
    let low = Math.log(SEARCH_MIN);
    let high = Math.log(SEARCH_MAX);
    if (law.power > 0 && law.barrier > 0) high = Math.min(high, Math.log(law.barrierPower * law.barrier / law.power) / law.barrierPower);
    if (!(logLaw(high) > wanted) || !(logLaw(low) < wanted)) return Infinity;
    for (let i = 0; i < SEARCH_STEPS; i++) {
        const middle = (low + high) / 2;
        if (logLaw(middle) < wanted) low = middle; else high = middle;
    }
    return law.reference * Math.exp((low + high) / 2);
}

/** The ignition temperature of each reaction of the table (in T0), for the same reference point. */
export const ignitionTemperatures = (reactions: readonly FusionReaction[], params: ParamValues,
                                     density: number, targetRate: number): number[] =>
    reactions.map(r => ignitionTemperature(fusionLawOf(r, params), density, targetRate));

/** The same temperatures in kelvins. */
export const ignitionKelvins = (temperaturesT0: readonly number[]): number[] =>
    temperaturesT0.map(t => t * PROTOSTAR_T0_KELVIN);

/**
 * Ignition temperature of the reaction `heavier` over that of `lighter` (the table's indices), for
 * the same reference rate and density: helium over hydrogen is the "ignition ratio" of the
 * acceptance tests. NaN when either is not finite.
 */
export function ignitionRatio(reactions: readonly FusionReaction[], params: ParamValues, density: number,
                              targetRate: number, lighter: number, heavier: number): number {
    const [low, high] = [lighter, heavier].map(i => ignitionTemperature(fusionLawOf(reactions[i], params), density, targetRate));
    return Number.isFinite(low) && Number.isFinite(high) && low > 0 ? high / low : NaN;
}

/**
 * The ratio of the velocity dispersions at which two pure gases ignite, from the ratio of their ignition temperatures and the
 * factors mu / mu_H of the two gases (molecularWeightFactors()): a gas of larger molecular weight reads hotter at the same
 * dispersion, so it ignites at a lower one. 2.65 for helium over hydrogen.
 */
export const kineticIgnitionRatio = (temperatureRatio: number, lighterFactor: number, heavierFactor: number): number =>
    temperatureRatio * lighterFactor / heavierFactor;
