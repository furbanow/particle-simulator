import { describe, expect, it } from 'vitest';
import { coreShares, firstReaching, fuelShareNoise, spread } from '../src/lab/drawNoise';

/** Positions (x, y, type, w = 1) of the given particles. */
function positionsOf(particles: readonly (readonly [number, number, number])[]): Float32Array {
    const data = new Float32Array(particles.length * 4);
    particles.forEach(([x, y, type], i) => data.set([x, y, type, 1], i * 4));
    return data;
}

describe('fuelShareNoise', () => {
    it('is the binomial noise sqrt((1 - X) / (X N)) of the 3 x 3 neighborhood of the burning cell', () => {
        // A 4 x 4 grid of cells of 10 px; 30 hydrogens and 10 heliums in cell (1, 1), 20 hydrogens in cell (2, 1), 5 heliums far away in (3, 3).
        const particles: [number, number, number][] = [];
        for (let i = 0; i < 30; i++) particles.push([15, 15, 0]);
        for (let i = 0; i < 10; i++) particles.push([15, 15, 1]);
        for (let i = 0; i < 20; i++) particles.push([25, 15, 0]);
        for (let i = 0; i < 5; i++) particles.push([35, 35, 1]);
        const weights = new Float64Array(16);
        weights[1 * 4 + 1] = 1;                                     // only cell (1, 1) burns
        const result = fuelShareNoise(positionsOf(particles), particles.length, 10, 4, weights, 0);
        // Its neighborhood holds cells (0..2, 0..2): 50 hydrogens of 60 parcels (cell (3, 3) is outside).
        const x = 50 / 60;
        expect(result?.fuelShare).toBeCloseTo(x, 12);
        expect(result?.parcels).toBe(60);
        expect(result?.noise).toBeCloseTo(Math.sqrt((1 - x) / (x * 60)), 12);
    });

    it('is zero for a pure fuel and null where nothing burns', () => {
        const particles: [number, number, number][] = Array.from({ length: 8 }, () => [5, 5, 0]);
        const weights = new Float64Array(4);
        expect(fuelShareNoise(positionsOf(particles), 8, 10, 2, weights, 0)).toBeNull();
        weights[0] = 2;
        expect(fuelShareNoise(positionsOf(particles), 8, 10, 2, weights, 0)?.noise).toBe(0);
        expect(fuelShareNoise(positionsOf(particles), 8, 10, 2, weights, 1)).toBeNull();
    });
});

describe('coreShares', () => {
    it('counts the types within the radius only', () => {
        const data = positionsOf([[0, 0, 0], [1, 0, 1], [0, 2, 2], [5, 5, 0], [0, 1, 1]]);
        const core = coreShares(data, 5, { x: 0, y: 0 }, 2, 3);
        expect(core.particles).toBe(4);
        expect(core.shares).toEqual([0.25, 0.5, 0.25]);
    });
});

describe('spread and firstReaching', () => {
    it('gives the mean, the sample deviation and their ratio, ignoring the missing values', () => {
        const s = spread([1, 3, null, Number.NaN]);
        expect(s).toEqual({ mean: 2, std: Math.SQRT2, relative: Math.SQRT2 / 2, n: 2 });
        expect(spread([null])).toBeNull();
    });

    it('finds the first time a series reaches a level', () => {
        expect(firstReaching([[1, 0], [2, 0.005], [3, 0.02], [4, 0.5]], 0.01)).toBe(3);
        expect(firstReaching([[1, 0]], 0.01)).toBeNull();
    });
});
