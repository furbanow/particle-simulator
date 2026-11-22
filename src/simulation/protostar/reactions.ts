// Fusion reactions of the protostar algorithm: which type fuses into which, how many particles it
// consumes and which law and parameters give its rate. Pure data and functions (tested); the GPU
// model turns the table into per-type uniform arrays, so a new reaction (C + He -> O, ...) is one
// more row and its parameters, without touching the shaders.

import { PROTOSTAR_FUEL_CHANNELS, PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_T0_KELVIN } from '../../config';
import { t } from '../../i18n';
import type { ParamValues, ParticleType, TypeTransition } from '../algorithm';
import { logNoiseBiasCurved, logUnbiasedResonant } from './noiseBias';

/**
 * The temperature dependence of a reaction (A2), per nucleus: r goes as T^-p exp(-b (T / unit)^-q). Gamow's peak for a
 * non-resonant reaction (the proton-proton chain: p = 2/3, q = 1/3), a resonance for the triple alpha (p = 3, q = 1). The rate
 * is normalised at the reaction's reference temperature (see FusionReaction), so only the shape is in the law.
 */
export interface RateLaw {
    /** p, the power of T in the prefactor. */
    readonly power: number;
    /** b, in the exponent -b (T / unit)^-q. */
    readonly barrier: number;
    /** q. */
    readonly barrierPower: number;
    /** The temperature in which b is quoted, kelvins. */
    readonly unitKelvin: number;
}

/** The barrier term b (T / unit)^-q of a law at a temperature (kelvins). */
export const barrierTerm = (law: RateLaw, kelvin: number): number => law.barrier * (kelvin / law.unitKelvin) ** -law.barrierPower;

/** The local temperature exponent d ln r / d ln T = q b (T / unit)^-q - p of a law at a temperature (kelvins): 3.9 at 15 MK for the proton-proton chain. */
export const localExponent = (law: RateLaw, kelvin: number): number =>
    law.barrierPower * barrierTerm(law, kelvin) - law.power;

export interface FusionReaction {
    /** Rank of the type that fuses. A type fuses in at most one reaction. */
    readonly from: number;
    /** Rank of the type it gives. */
    readonly to: number;
    /** `from` particles consumed per `to` particle made (4 for 4 H -> He). */
    readonly consumed: number;
    /** Process name, shown in the type editor. */
    readonly label: string;
    /** Parameter key of its rate constant lambda (1/s): the rate of a particle of the fuel at the reference temperature and density, in pure fuel. */
    readonly rateParam: string;
    /** Its temperature law (Gamow's), a shape: the rate is normalised at the reference temperature. */
    readonly law: RateLaw;
    /** Temperature at which the rate is lambda (rho X)^n, in kelvins. */
    readonly referenceTemperature: number;
    /**
     * Exponent n of the density of the fuel rho X (X: the mass fraction of the fusing type in the neighborhood), per fusing
     * particle: 1 for a two-body reaction (proton-proton), 2 for three bodies (triple alpha).
     */
    readonly densityExponent: number;
}

/** The transitions the declaration shows in the type editor. */
export const reactionTransitions = (reactions: readonly FusionReaction[]): TypeTransition[] =>
    reactions.map(r => ({ from: r.from, to: r.to, label: t('algo.protostar.reaction.format', { label: r.label, consumed: r.consumed }) }));

/** Mass defect of one reaction, in the unit of the type masses (u): consumed * m_from - m_to. */
export function massDefect(reaction: FusionReaction, mass: (rank: number) => number): number {
    return reaction.consumed * mass(reaction.from) - mass(reaction.to);
}

/**
 * Fraction of the fused mass released as energy (0 when the reaction would need energy: no
 * feedback then). 4 H -> He: (4 x 1.00783 - 4.0026) / (4 x 1.00783) = 0.71 %.
 */
export function defectFraction(reaction: FusionReaction, mass: (rank: number) => number): number {
    const fused = reaction.consumed * mass(reaction.from);
    return fused > 0 ? Math.max(0, massDefect(reaction, mass)) / fused : 0;
}

/**
 * Mass bookkeeping: one particle is one atom. A particle that fuses becomes a `to` particle with
 * probability 1 / consumed, else it is removed (absorbed). On average `consumed` fused particles
 * leave one `to` particle: particles fused into mass made, per fused particle, m_to / consumed.
 */
export const survivalProbability = (reaction: FusionReaction): number => 1 / reaction.consumed;

/** Expected mass left per fused `from` particle (m_to / consumed). */
export const expectedMassAfter = (reaction: FusionReaction, mass: (rank: number) => number): number =>
    survivalProbability(reaction) * mass(reaction.to);

/** Per-type uniform arrays of the reaction table, indexed by the rank of the fusing type. */
export interface ReactionArrays {
    /** Rank it fuses into, -1 when the type does not fuse. */
    to: number[];
    /** Probability that a fusing particle survives as the new type (1 / consumed). */
    keep: number[];
    /** lambda, 1/s. */
    rate: number[];
    /** p, the power of T of the law's prefactor. */
    power: number[];
    /** G, the barrier term b (T_ref / unit)^-q of the law at the reference temperature. */
    barrier: number[];
    /** q. */
    barrierPower: number[];
    /** Reference temperature, in T0. */
    reference: number[];
    /** n. */
    densityExponent: number[];
    /** Energy released per unit fused mass, in T0 (feedback x defect fraction x c^2 / T0). */
    energy: number[];
    /**
     * The channel of the fuel fractions (gas pass, `Gas.fuel`) that holds the mass fraction of this type: the rank of its reaction among
     * the reactions of the table (at most PROTOSTAR_FUEL_CHANNELS of them), -1 for a type that is the fuel of no reaction (the products
     * and the custom elements: they are in neither X nor Y).
     */
    fuel: number[];
}

/**
 * The uniform arrays for `types` (reactions between missing types are left out).
 * `c2` is c^2 in T0, `feedback` the feedback strength. `flat` (the lab) makes every law independent of the temperature (the
 * rate is lambda (rho X)^n), for gases whose heating must be known whatever their temperature.
 */
export function reactionArrays(reactions: readonly FusionReaction[], types: readonly ParticleType[],
                               params: ParamValues, massKey: string, c2: number, feedback: number,
                               size: number, flat = false): ReactionArrays {
    const arrays: ReactionArrays = {
        to: new Array<number>(size).fill(-1),
        keep: new Array<number>(size).fill(0),
        rate: new Array<number>(size).fill(0),
        power: new Array<number>(size).fill(0),
        barrier: new Array<number>(size).fill(0),
        barrierPower: new Array<number>(size).fill(1),
        reference: new Array<number>(size).fill(1),
        densityExponent: new Array<number>(size).fill(1),
        energy: new Array<number>(size).fill(0),
        fuel: new Array<number>(size).fill(-1),
    };
    const mass = (rank: number) => types[rank].values[massKey];
    let channels = 0;
    for (const r of reactions) {
        if (r.from >= types.length || r.to >= types.length || r.from >= size || arrays.to[r.from] >= 0
            || channels >= PROTOSTAR_FUEL_CHANNELS) continue;
        const rate = params[r.rateParam];
        arrays.to[r.from] = r.to;
        arrays.keep[r.from] = survivalProbability(r);
        arrays.rate[r.from] = typeof rate === 'number' ? rate : 0;
        arrays.power[r.from] = flat ? 0 : r.law.power;
        arrays.barrier[r.from] = flat ? 0 : barrierTerm(r.law, r.referenceTemperature);
        arrays.barrierPower[r.from] = r.law.barrierPower;
        arrays.reference[r.from] = r.referenceTemperature / PROTOSTAR_T0_KELVIN;
        arrays.densityExponent[r.from] = r.densityExponent;
        arrays.energy[r.from] = feedback * defectFraction(r, mass) * c2;
        arrays.fuel[r.from] = channels++;
    }
    return arrays;
}

/** The rate law of a reaction, with the temperatures in T0 and the densities in rho0. */
export interface FusionLaw {
    /** lambda, 1/s. */
    readonly rate: number;
    readonly densityExponent: number;
    /** Reference temperature, in T0. */
    readonly reference: number;
    /** p. */
    readonly power: number;
    /** G, the barrier term of the law at the reference temperature. */
    readonly barrier: number;
    /** q. */
    readonly barrierPower: number;
}

/** A law at a temperature: ln [f(T) / f(T_ref)], the local exponent d ln f / d ln T, and the barrier term there (what the noise correction needs). */
export interface LawPoint {
    logLaw: number;
    exponent: number;
    barrier: number;
}

/**
 * The temperature law at `temperature` (in T0), in logarithms: ln [f(T) / f(T_ref)] = -p ln tau - G (tau^-q - 1) with
 * tau = T / T_ref and f(T) = T^-p exp(-b (T / unit)^-q), G = b (T_ref / unit)^-q the barrier term at the reference; the local
 * exponent is q G tau^-q - p. Twin of the head of fusionRateOf in protostar-common.glsl.
 */
export function lawAt(law: FusionLaw, temperature: number): LawPoint {
    const logTau = Math.log(temperature / law.reference);
    const power = Math.exp(-law.barrierPower * logTau);
    return {
        logLaw: -law.power * logTau - law.barrier * (power - 1),
        exponent: law.barrierPower * law.barrier * power - law.power,
        barrier: law.barrier * power,
    };
}

/**
 * Expected fusions per second of one particle of the fuel: lambda (rho X)^n f(T) / f(T_ref), capped, corrected for the noise of T
 * when it is estimated from `particles` independent particles (noiseBias.ts; no correction for infinitely many): the rate is
 * replaced by its exact unbiased estimate for a resonant law (q = 1, the triple alpha), divided by the bias of the curved law
 * (the local exponent and the curvature of its logarithm) for the others and where the exact one does not apply. `fuel` is X,
 * the mass fraction of the fusing type in the neighborhood (1: pure fuel). T is the temperature of the gas (A1: the velocity
 * dispersion times mu / mu_H, composition.ts), not the dispersion. With the fixed thickness of the cloud `density` is the
 * surface density. Computed from logarithms, like fusionRateOf in protostar-common.glsl: the law's exponential underflows far
 * below the reference temperature.
 */
export function fusionRate(law: FusionLaw, density: number, temperature: number, particles = Infinity, fuel = 1): number {
    if (law.rate <= 0 || density <= 0 || temperature <= 0 || fuel <= 0) return 0;
    const point = lawAt(law, temperature);
    const exact = particles !== Infinity && law.barrierPower === 1
        ? logUnbiasedResonant(particles, temperature / law.reference, law.power, law.barrier) : null;
    const logLaw = exact ?? point.logLaw - logNoiseBiasCurved(particles, point.exponent, point.barrier, law.barrierPower);
    const log = Math.log(law.rate) + law.densityExponent * Math.log(density * fuel) + logLaw;
    return Math.min(Math.exp(log), PROTOSTAR_FUSION_RATE_MAX);
}

/** Fusion probability over a step: 1 - exp(-rate dt). */
export function fusionProbability(law: FusionLaw, density: number, temperature: number, dt: number, fuel = 1): number {
    return 1 - Math.exp(-fusionRate(law, density, temperature, Infinity, fuel) * dt);
}
