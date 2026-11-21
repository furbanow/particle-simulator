// Ignition temperature of the fusion reactions: the temperature at which a particle's expected
// fusion rate reaches a reference rate, at a reference density. Pure functions (tested), the
// inverse of fusionRate() in reactions.ts, which is itself the TypeScript twin of fusionRateOf in
// src/shaders/protostar-common.glsl:
//
//     rate = lambda * rho^n * (T / T_ref)^alpha        (capped at PROTOSTAR_FUSION_RATE_MAX)
//
// Keep the three in step: a change of the law in the shader changes fusionRate() and this file.
// T is the temperature of the gas, the velocity dispersion times mu / mu_H (A1, composition.ts): these are the
// temperatures a thermometer reads, not dispersions. The dispersion at which a pure gas ignites is that divided by its
// factor (2.65 for helium): see kineticIgnitionRatio(). The lab (src/lab) reports the ratio He / H of these temperatures:
// the real value is about 100 MK / 15 MK = 6.7, whereas the rate laws as they are give a much smaller one (see docs/lab-baseline.md).

import { PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_T0_KELVIN } from '../../config';
import type { ParamValues } from '../algorithm';
import type { FusionLaw, FusionReaction } from './reactions';

/** The rate law of `reaction` at the parameter values `params` (what reactionArrays() hands the shader). */
export function fusionLawOf(reaction: FusionReaction, params: ParamValues): FusionLaw {
    const rate = params[reaction.rateParam];
    const exponent = params[reaction.exponentParam];
    return {
        rate: typeof rate === 'number' ? rate : 0,
        densityExponent: reaction.densityExponent,
        reference: reaction.referenceTemperature / PROTOSTAR_T0_KELVIN,
        exponent: typeof exponent === 'number' ? exponent : 0,
    };
}

/**
 * Temperature, in T0, at which the law gives `targetRate` (fusions per second and per particle) at
 * `density` (in rho0). Infinity when no finite temperature does: a law that never fires, a rate
 * above the cap, no gas or a flat law (exponent 0).
 */
export function ignitionTemperature(law: FusionLaw, density: number, targetRate: number): number {
    if (law.rate <= 0 || law.exponent <= 0 || density <= 0 || targetRate <= 0 || targetRate >= PROTOSTAR_FUSION_RATE_MAX) {
        return Infinity;
    }
    const logRatio = Math.log(targetRate) - Math.log(law.rate) - law.densityExponent * Math.log(density);
    return law.reference * Math.exp(logRatio / law.exponent);
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
