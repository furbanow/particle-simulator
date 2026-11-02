import { describe, expect, it } from 'vitest';
import { MASS_RANGE, MASS_SLIDER_STEPS } from '../src/config';
import {
    DEFAULT_SPECIES, formatMass, massToSlider, randomSpeciesHsl, randomSpeciesMasses, sliderToMass, speciesDensity,
} from '../src/species';

describe('mass slider (logarithmic)', () => {
    it('maps the slider ends to the mass range', () => {
        expect(sliderToMass(0)).toBe(MASS_RANGE[0]);
        expect(sliderToMass(MASS_SLIDER_STEPS)).toBe(MASS_RANGE[1]);
    });

    it('round-trips the default species masses', () => {
        for (const { mass } of DEFAULT_SPECIES) {
            expect(sliderToMass(massToSlider(mass))).toBeCloseTo(mass, 2);
        }
    });

    it('rounds to 0.01 below 1, 0.1 below 10 and 1 above', () => {
        for (let pos = 0; pos <= MASS_SLIDER_STEPS; pos += 7) {
            const m = sliderToMass(pos);
            const step = m < 1 ? 0.01 : m < 10 ? 0.1 : 1;
            expect(Math.abs(m / step - Math.round(m / step))).toBeLessThan(1e-6);
        }
    });

    it('formats with the matching precision', () => {
        expect(formatMass(0.4)).toBe('0.40');
        expect(formatMass(2.5)).toBe('2.5');
        expect(formatMass(42)).toBe('42');
    });
});

describe('species', () => {
    it('density is mass over disc area', () => {
        expect(speciesDensity({ color: '#fff', mass: Math.PI, size: 2 })).toBeCloseTo(1);
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
