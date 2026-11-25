// Composition of the gas as the grids need it: the mean molecular weight of each type. Pure
// functions (tested); the GPU model turns the table into a per-type uniform array, which the
// deposit of the composition (second attachment of the moments pass) reads (see grids.ts).

import { PROTONS_PER_NUCLEON, PROTOSTAR_REFERENCE_INVERSE_MU } from '../../config';
import { ELEMENTS } from '../../species';
import type { ParticleType } from '../algorithm';

/**
 * Atomic number of the element with this symbol, null when it is not one of ELEMENTS. That table
 * lists the first ten elements of the periodic table in order, so Z is the rank plus one.
 */
export function atomicNumber(symbol: string): number | null {
    const rank = ELEMENTS.findIndex(e => e.symbol === symbol);
    return rank < 0 ? null : rank + 1;
}

/**
 * 1 / mu of a fully ionised element, per atomic mass unit: (1 + Z) / A, one nucleus and Z
 * electrons sharing the A u of the atom. Hydrogen 1.984 (mu = 0.504), helium 0.7495 (mu = 1.334),
 * carbon 12 0.5833. 0 for a mass that is not positive.
 */
export const inverseMeanMolecularWeight = (z: number, atomicMass: number): number =>
    atomicMass > 0 ? (1 + z) / atomicMass : 0;

/**
 * The factor 1 / mu of each of `types`, padded to `size` entries with 0, for the deposit shader:
 * a particle of mass m (any unit) adds m * factor to the m / mu sum of its cell, so that
 * 1 / mu_mean = sum(m / mu) / sum(m) in the units of the factor (per u).
 *
 * A is the type's current mass (`massKey` of its values, in u: the user may edit it, and the
 * fusion products have the mass of their isotope), Z comes from its symbol. A symbol that is not
 * an element of the table gets Z = PROTONS_PER_NUCLEON * A.
 */
export function inverseMolecularWeights(types: readonly ParticleType[], massKey: string, size: number): number[] {
    const factors = new Array<number>(size).fill(0);
    types.slice(0, size).forEach((type, k) => {
        const a = type.values[massKey];
        factors[k] = inverseMeanMolecularWeight(atomicNumber(type.symbol) ?? PROTONS_PER_NUCLEON * a, a);
    });
    return factors;
}

/**
 * The mean 1 / mu of a neighborhood, per u, from the sums of its cells' deposits: `compositionSum` is the x channel of the
 * composition (sum w m (1 + Z) / A) and `massSum` that of the moments (sum w m), the same weights. It is the mass-weighted
 * mean of (1 + Z) / A, that is sum_k X_k (1 + Z_k) / A_k. Null when the sums do not give one: no mass, or no composition (a
 * neighborhood of particles whose type has a mass of 0 has a mass but no composition).
 */
export function meanInverseMolecularWeight(compositionSum: number, massSum: number): number | null {
    return massSum > 0 && compositionSum > 0 ? compositionSum / massSum : null;
}

/**
 * The factor mu_mean / mu_H that turns a velocity dispersion into a temperature (A1: T = factor x <|v - u|^2>, with T0 the
 * temperature of a hydrogen gas of that dispersion): 1 for pure hydrogen, 2.65 for pure helium, 1.18 for a gas of 75 %
 * hydrogen and 25 % helium by mass. 1 (the dispersion is the temperature) when the neighborhood has no composition, which is the
 * neutral choice for a cell the sums cannot describe. Twin of the gas pass of protostar-gas.frag.
 */
export function molecularWeightFactor(compositionSum: number, massSum: number, referenceInverseMu = PROTOSTAR_REFERENCE_INVERSE_MU): number {
    const inverseMu = meanInverseMolecularWeight(compositionSum, massSum);
    return inverseMu === null ? 1 : referenceInverseMu / inverseMu;
}

/**
 * The factor of a gas made of one type alone, for each of `types`, padded to `size` entries with 1: 1 for hydrogen of mass
 * 1.00783 u, 2.65 for helium (mu 1.334 against 0.504), 3.40 for carbon 12. A type of mass 0 has no composition: 1.
 */
export function molecularWeightFactors(types: readonly ParticleType[], massKey: string, size: number): number[] {
    const factors = new Array<number>(size).fill(1);
    inverseMolecularWeights(types, massKey, size).slice(0, types.length).forEach((inverseMu, k) => {
        factors[k] = inverseMu > 0 ? PROTOSTAR_REFERENCE_INVERSE_MU / inverseMu : 1;
    });
    return factors;
}
