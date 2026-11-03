import { describe, expect, it } from 'vitest';
import { RANDOM_WEIGHT_RANGE } from '../src/config';
import { populationShares, randomPopulationWeights, splitPopulation } from '../src/population';

describe('population shares', () => {
    it('are proportional to the weights and sum to 1', () => {
        const shares = populationShares([1, 3, 0, 4], 4);
        expect(shares).toEqual([0.125, 0.375, 0, 0.5]);
    });

    it('ignore the weights beyond the species count', () => {
        expect(populationShares([1, 1, 100], 2)).toEqual([0.5, 0.5]);
    });

    it('fall back to uniform when every weight is zero', () => {
        expect(populationShares([0, 0, 0, 0], 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    });
});

describe('population split', () => {
    it('sums exactly to the total and stays within one particle of the exact share', () => {
        const weights = [0.5, 0.13, 0.77, 0.02, 0.5, 0.31, 1, 0, 0.66, 0.4];
        for (const total of [1, 7, 999, 30000, 500000]) {
            const counts = splitPopulation(total, weights, 8);
            expect(counts).toHaveLength(weights.length);
            expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
            const shares = populationShares(weights, 8);
            shares.forEach((s, k) => expect(Math.abs(counts[k] - s * total)).toBeLessThan(1));
            expect(counts.slice(8)).toEqual([0, 0]);
        }
    });

    it('gives nothing to a zero-weight species', () => {
        expect(splitPopulation(10, [1, 0, 1], 3)).toEqual([5, 0, 5]);
    });

    it('is uniform for equal weights', () => {
        expect(splitPopulation(30000, new Array(10).fill(0.5), 10)).toEqual(new Array(10).fill(3000));
    });
});

describe('random population weights', () => {
    it('stay inside the random range', () => {
        const weights = randomPopulationWeights(100);
        expect(weights).toHaveLength(100);
        for (const w of weights) {
            expect(w).toBeGreaterThanOrEqual(RANDOM_WEIGHT_RANGE[0]);
            expect(w).toBeLessThanOrEqual(RANDOM_WEIGHT_RANGE[1]);
        }
    });
});
