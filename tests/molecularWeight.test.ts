import { describe, expect, it } from 'vitest';
import { HYDROGEN_1_MASS, MAX_SPECIES, PROTOSTAR_REFERENCE_INVERSE_MU } from '../src/config';
import type { ParticleType } from '../src/simulation/algorithm';
import { defaultParams } from '../src/simulation/params';
import { CARBON, HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../src/simulation/protostar/declaration';
import {
    inverseMolecularWeights, meanInverseMolecularWeight, molecularWeightFactor, molecularWeightFactors,
} from '../src/simulation/protostar/composition';
import { ignitionRatio, kineticIgnitionRatio } from '../src/simulation/protostar/ignition';

const factors = inverseMolecularWeights(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
const masses = PROTOSTAR_TYPES.map(t => t.values.mass);

/** The sums of the two deposits (m, m (1 + Z) / A) of a gas with `counts` particles of each type, the way the deposit passes add them. */
function depositSums(counts: readonly number[]): { massSum: number; compositionSum: number } {
    let massSum = 0, compositionSum = 0;
    counts.forEach((n, k) => {
        massSum += n * masses[k];
        compositionSum += n * masses[k] * factors[k];
    });
    return { massSum, compositionSum };
}

const factorOf = (counts: readonly number[]): number => {
    const { massSum, compositionSum } = depositSums(counts);
    return molecularWeightFactor(compositionSum, massSum);
};

describe('temperature with the mean molecular weight (A1)', () => {
    describe('mean molecular weight of a neighborhood', () => {
        it('is the mass-weighted mean of (1 + Z) / A, that is 1 / mu = sum X_k (1 + Z_k) / A_k', () => {
            // 2 H and 1 He by number: X_H = 2 m_H / (2 m_H + m_He).
            const { massSum, compositionSum } = depositSums([2, 1]);
            const xH = 2 * masses[HYDROGEN] / massSum;
            const xHe = masses[HELIUM] / massSum;
            expect(meanInverseMolecularWeight(compositionSum, massSum)).toBeCloseTo(xH * 2 / masses[HYDROGEN] + xHe * 3 / masses[HELIUM], 12);
        });

        it('does not depend on the unit of the masses (a common factor cancels)', () => {
            const { massSum, compositionSum } = depositSums([5, 2, 1]);
            expect(meanInverseMolecularWeight(37 * compositionSum, 37 * massSum)).toBeCloseTo(meanInverseMolecularWeight(compositionSum, massSum)!, 12);
        });

        it('is that of a pure gas whatever the number of its particles', () => {
            for (const k of [HYDROGEN, HELIUM, CARBON]) {
                const counts = [0, 0, 0];
                counts[k] = 12345;
                const { massSum, compositionSum } = depositSums(counts);
                expect(meanInverseMolecularWeight(compositionSum, massSum)).toBeCloseTo(factors[k], 12);
            }
        });

        it('is unknown for a neighborhood with no mass or no composition (empty cells, types of mass 0)', () => {
            expect(meanInverseMolecularWeight(0, 0)).toBeNull();
            expect(meanInverseMolecularWeight(1, 0)).toBeNull();
            expect(meanInverseMolecularWeight(0, 5)).toBeNull();
            expect(meanInverseMolecularWeight(-1, 5)).toBeNull();
        });
    });

    describe('the factor mu / mu_H that turns the dispersion into a temperature', () => {
        it('is 1 for pure hydrogen: the temperature scale T0 stands for hydrogen and is unchanged', () => {
            expect(factorOf([1000, 0, 0])).toBeCloseTo(1, 12);
            expect(PROTOSTAR_REFERENCE_INVERSE_MU).toBeCloseTo(2 / HYDROGEN_1_MASS, 14);
            expect(factors[HYDROGEN]).toBe(PROTOSTAR_REFERENCE_INVERSE_MU);
        });

        it('is mu(He) / mu(H) = 2.65 for pure helium and 3.40 for pure carbon 12', () => {
            expect(factorOf([0, 1000, 0])).toBeCloseTo((masses[HELIUM] / 3) / (masses[HYDROGEN] / 2), 12);
            expect(factorOf([0, 1000, 0])).toBeCloseTo(2.6477, 4);
            expect(factorOf([0, 0, 1000])).toBeCloseTo((12 / 7) / (masses[HYDROGEN] / 2), 12);
            expect(factorOf([0, 0, 1000])).toBeCloseTo(3.4019, 4);
        });

        it('lies between the pure values for a mixture, and grows with the helium', () => {
            const he = factorOf([0, 1, 0]);
            let previous = 1;
            for (const heliumPerHundredHydrogen of [1, 10, 33, 100, 1000, 100000]) {
                const f = factorOf([100, heliumPerHundredHydrogen, 0]);
                expect(f).toBeGreaterThan(previous);
                expect(f).toBeLessThan(he);
                previous = f;
            }
            // 75 % of hydrogen and 25 % of helium by mass: 1 / mu = 0.75 (2 / m_H) + 0.25 (3 / m_He).
            const heliumNumber = 0.25 / masses[HELIUM];
            const hydrogenNumber = 0.75 / masses[HYDROGEN];
            expect(factorOf([hydrogenNumber, heliumNumber, 0])).toBeCloseTo(1.1842, 4);
        });

        it('is 1 where the neighborhood has no composition (the dispersion is the temperature there)', () => {
            expect(molecularWeightFactor(0, 0)).toBe(1);
            expect(molecularWeightFactor(0, 3)).toBe(1);
            expect(molecularWeightFactor(2, 0)).toBe(1);
        });

        it('makes a helium gas 2.65 times hotter than a hydrogen one at the same dispersion, a mixture in between', () => {
            const dispersion = 3.2;
            const hydrogen = dispersion * factorOf([1000, 0, 0]);
            const helium = dispersion * factorOf([0, 1000, 0]);
            const mixed = dispersion * factorOf([500, 500, 0]);
            expect(helium / hydrogen).toBeCloseTo(2.6477, 4);
            expect(mixed).toBeGreaterThan(hydrogen);
            expect(mixed).toBeLessThan(helium);
        });

        it('lists the factor of each type of a table, padded with 1', () => {
            const list = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
            expect(list).toHaveLength(MAX_SPECIES);
            expect(list.slice(0, 3).map(v => Number(v.toFixed(4)))).toEqual([1, 2.6477, 3.4019]);
            expect(list.slice(3).every(v => v === 1)).toBe(true);
            expect(molecularWeightFactors(PROTOSTAR_TYPES, 'mass', 2)).toHaveLength(2);
        });
    });

    describe('types that are not real elements', () => {
        const custom = (symbol: string, mass: number): ParticleType => ({ name: symbol, symbol, color: '#fff', values: { mass } });

        it('takes Z = A / 2 for a symbol that is not in the element table (the stability valley)', () => {
            // A = 16, Z = 8: (1 + 8) / 16 = 0.5625 per u, mu = 1.78, 3.5 times hydrogen's.
            const [factor] = molecularWeightFactors([custom('Xx', 16)], 'mass', 1);
            expect(factor).toBeCloseTo(PROTOSTAR_REFERENCE_INVERSE_MU / (9 / 16), 12);
            expect(factor).toBeCloseTo(3.528, 3);
        });

        it('stays finite for a very heavy custom element: 1 / mu tends to 1 / 2 per u, a factor of 2 / (1 / mu_H)', () => {
            const [factor] = molecularWeightFactors([custom('Zz', 1e6)], 'mass', 1);
            expect(Number.isFinite(factor)).toBe(true);
            expect(factor).toBeCloseTo(PROTOSTAR_REFERENCE_INVERSE_MU / 0.5, 3);
        });

        it('has no composition, so a factor of 1, for a mass of 0', () => {
            expect(molecularWeightFactors([custom('Xx', 0)], 'mass', 1)).toEqual([1]);
        });

        it('follows the edited mass of a real element: a hydrogen of 2 u is twice as hot at the same dispersion', () => {
            const heavy: ParticleType = { ...PROTOSTAR_TYPES[HYDROGEN], values: { ...PROTOSTAR_TYPES[HYDROGEN].values, mass: 2 * HYDROGEN_1_MASS } };
            expect(molecularWeightFactors([heavy], 'mass', 1)[0]).toBeCloseTo(2, 12);
        });
    });

    describe('the ignition temperatures', () => {
        const params = defaultParams(PROTOSTAR);
        const [h, he] = [HYDROGEN, HELIUM].map(from => PROTOSTAR_REACTIONS.findIndex(r => r.from === from));

        it('turn a ratio of temperatures into a ratio of dispersions by the factors of the two gases', () => {
            const f = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', 3);
            const temperatures = ignitionRatio(PROTOSTAR_REACTIONS, params, 60, 0.5, h, he);
            expect(kineticIgnitionRatio(temperatures, f[HYDROGEN], f[HELIUM])).toBeCloseTo(temperatures / 2.6477, 3);
            // Hydrogen against itself: no change.
            expect(kineticIgnitionRatio(3, 1, 1)).toBe(3);
        });
    });
});
