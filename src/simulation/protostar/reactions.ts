// Fusion reactions of the protostar algorithm: which type fuses into which, how many particles it
// consumes and which parameters give its rate. Pure data and functions (tested); the GPU model
// turns the table into per-type uniform arrays, so a new reaction (He -> C, ...) is one more row
// and its parameters, without touching the shaders.

import type { ParamValues, ParticleType, TypeTransition } from '../algorithm';

export interface FusionReaction {
    /** Rank of the type that fuses. A type fuses in at most one reaction. */
    readonly from: number;
    /** Rank of the type it gives. */
    readonly to: number;
    /** `from` particles consumed per `to` particle made (4 for 4 H -> He). */
    readonly consumed: number;
    /** Process name, shown in the type editor. */
    readonly label: string;
    /** Parameter keys of its rate constant lambda0 (1/s) and of its temperature exponent alpha. */
    readonly rateParam: string;
    readonly exponentParam: string;
}

/** The transitions the declaration shows in the type editor. */
export const reactionTransitions = (reactions: readonly FusionReaction[]): TypeTransition[] =>
    reactions.map(r => ({ from: r.from, to: r.to, label: `${r.label} (${r.consumed} pour 1)` }));

/** Mass defect of one reaction, in the unit of the type masses (u): consumed * m_from - m_to. */
export function massDefect(reaction: FusionReaction, mass: (rank: number) => number): number {
    return reaction.consumed * mass(reaction.from) - mass(reaction.to);
}

/**
 * Fraction of the fused mass released as energy (0 when the reaction would need energy: no
 * feedback then). 4 H -> He: (4 x 1.008 - 4.0026) / (4 x 1.008) = 0.73 %.
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
    /** lambda0, 1/s. */
    rate: number[];
    /** alpha. */
    exponent: number[];
    /** Energy released per unit fused mass, in T0 (feedback x defect fraction x c^2 / T0). */
    energy: number[];
}

/**
 * The uniform arrays for `types` (reactions between missing types are left out).
 * `c2` is c^2 in T0, `feedback` the feedback strength.
 */
export function reactionArrays(reactions: readonly FusionReaction[], types: readonly ParticleType[],
                               params: ParamValues, massKey: string, c2: number, feedback: number,
                               size: number): ReactionArrays {
    const arrays: ReactionArrays = {
        to: new Array<number>(size).fill(-1),
        keep: new Array<number>(size).fill(0),
        rate: new Array<number>(size).fill(0),
        exponent: new Array<number>(size).fill(0),
        energy: new Array<number>(size).fill(0),
    };
    const mass = (rank: number) => types[rank].values[massKey];
    for (const r of reactions) {
        if (r.from >= types.length || r.to >= types.length || r.from >= size || arrays.to[r.from] >= 0) continue;
        const rate = params[r.rateParam];
        const exponent = params[r.exponentParam];
        arrays.to[r.from] = r.to;
        arrays.keep[r.from] = survivalProbability(r);
        arrays.rate[r.from] = typeof rate === 'number' ? rate : 0;
        arrays.exponent[r.from] = typeof exponent === 'number' ? exponent : 0;
        arrays.energy[r.from] = feedback * defectFraction(r, mass) * c2;
    }
    return arrays;
}

/** Fusion probability over a step: 1 - exp(-rate dt), with rate = lambda0 rho alpha-power of T. */
export function fusionProbability(rate: number, density: number, temperature: number, exponent: number,
                                  dt: number): number {
    const r = rate * Math.max(0, density) * Math.max(0, temperature) ** exponent;
    return 1 - Math.exp(-r * dt);
}
