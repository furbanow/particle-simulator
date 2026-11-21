// Composition of the gas as the grids need it: the mean molecular weight of each type. Pure
// functions (tested); the GPU model turns the table into a per-type uniform array, which the
// deposit of the composition (second attachment of the moments pass) reads (see grids.ts).

import { PROTONS_PER_NUCLEON } from '../../config';
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
