import { describe, expect, it } from 'vitest';
import { DEFAULT_POPULATION_WEIGHT, MASS_RANGE, MASS_SLIDER_STEPS, SIZE_RANGE } from '../src/config';
import { formatMass, massToSlider, randomSpeciesHsl, randomSpeciesMasses, sliderToMass } from '../src/species';
import { STICKY_DUST_TYPES as DEFAULT_SPECIES, stickyDustDensity } from '../src/simulation/stickyDust/declaration';

describe('mass slider (logarithmic)', () => {
    it('maps the slider ends to the mass range', () => {
        expect(sliderToMass(0)).toBe(MASS_RANGE[0]);
        expect(sliderToMass(MASS_SLIDER_STEPS)).toBe(MASS_RANGE[1]);
    });

    it('round-trips the default species masses to within one rounding step', () => {
        for (const { values: { mass } } of DEFAULT_SPECIES) {
            const step = mass < 1 ? 0.01 : mass < 10 ? 0.1 : 1;
            expect(Math.abs(sliderToMass(massToSlider(mass)) - mass)).toBeLessThanOrEqual(step);
        }
    });

    it('rounds to 0.01 below 1, 0.1 below 10 and 1 above', () => {
        for (let pos = 0; pos <= MASS_SLIDER_STEPS; pos += 7) {
            const m = sliderToMass(pos);
            const step = m < 1 ? 0.01 : m < 10 ? 0.1 : 1;
            expect(Math.abs(m / step - Math.round(m / step))).toBeLessThan(1e-6);
        }
    });

    it('formats with four significant digits and no trailing zeros', () => {
        expect(formatMass(1.008)).toBe('1.008');
        expect(formatMass(4.0026)).toBe('4.003');
        expect(formatMass(20.18)).toBe('20.18');
        expect(formatMass(0.4)).toBe('0.4');
        expect(formatMass(2.5)).toBe('2.5');
        expect(formatMass(42)).toBe('42');
    });
});

describe('default species: the first ten elements', () => {
    it('are hydrogen to neon, in order', () => {
        expect(DEFAULT_SPECIES.map(s => s.symbol)).toEqual(['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne']);
        expect(DEFAULT_SPECIES[0].name).toBe('Hydrogène');
        expect(DEFAULT_SPECIES[9].name).toBe('Néon');
    });

    it('use the standard atomic masses in u', () => {
        expect(DEFAULT_SPECIES[0].values.mass).toBe(1.008);
        expect(DEFAULT_SPECIES[9].values.mass).toBe(20.180);
        DEFAULT_SPECIES.slice(1).forEach((s, i) => expect(s.values.mass).toBeGreaterThan(DEFAULT_SPECIES[i].values.mass));
        for (const { values: { mass } } of DEFAULT_SPECIES) {
            expect(mass).toBeGreaterThanOrEqual(MASS_RANGE[0]);
            expect(mass).toBeLessThanOrEqual(MASS_RANGE[1]);
        }
    });

    it('have sizes proportional to the atomic radii, inside the slider range', () => {
        const [h, he, li] = DEFAULT_SPECIES;
        expect(li.values.size).toBe(SIZE_RANGE[1]);                 // lithium is the largest atom
        expect(h.values.size / he.values.size).toBeCloseTo(53 / 31);
        for (const { values: { size } } of DEFAULT_SPECIES) {
            expect(size).toBeGreaterThanOrEqual(SIZE_RANGE[0]);
            expect(size).toBeLessThanOrEqual(SIZE_RANGE[1]);
        }
    });

    it('share the same population weight (uniform population)', () => {
        for (const { values: { weight } } of DEFAULT_SPECIES) expect(weight).toBe(DEFAULT_POPULATION_WEIGHT);
    });
});

describe('species', () => {
    it('density is mass over disc area', () => {
        expect(stickyDustDensity({ name: 'Test', symbol: 'T', color: '#fff', values: { mass: Math.PI, size: 2, weight: 1 } })).toBeCloseTo(1);
    });

    it('random masses keep the shuffled ladder order for visible species', () => {
        const masses = randomSpeciesMasses(10, 4);
        expect(masses).toHaveLength(10);
        const sorted = [...masses.slice(0, 4)].sort((a, b) => a - b);
        // Rungs 1/4 .. 1 nudged by at most 0.35 of a rung: neighbours never swap.
        sorted.forEach((m, i) => expect(Math.abs(m - (i + 1) / 4)).toBeLessThanOrEqual(0.35 / 4 + 1e-9));
        for (const m of masses) {
            expect(m).toBeGreaterThanOrEqual(MASS_RANGE[0]);
            expect(m).toBeLessThanOrEqual(MASS_RANGE[1]);
        }
    });

    it('random colors are bright and in range', () => {
        for (const { h, s, l } of randomSpeciesHsl(10, 3)) {
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(1);
            expect(s).toBeGreaterThanOrEqual(0.7);
            expect(l).toBeGreaterThanOrEqual(0.58);
        }
    });
});
