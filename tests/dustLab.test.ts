import { describe, expect, it } from 'vitest';
import { clumpStats, firstCrossing } from '../src/lab/clumpStats';

/** An RGBA grid of `res` x `res` texels whose R channel is given by `rho(x, y)`. */
function grid(res: number, rho: (x: number, y: number) => number): Float32Array {
    const rgba = new Float32Array(res * res * 4);
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) rgba[(y * res + x) * 4] = rho(x, y);
    return rgba;
}

describe('lab: clump statistics of a density grid', () => {
    it('counts the groups of touching dense texels and the mass they hold', () => {
        // A 2 x 2 block of 10, a lone dense texel of 10 (too small to count), a diagonal pair that does not touch, background 1.
        const rgba = grid(8, (x, y) => {
            if (x >= 1 && x <= 2 && y >= 1 && y <= 2) return 10;
            if (x === 6 && y === 6) return 10;
            if ((x === 5 && y === 1) || (x === 6 && y === 2)) return 10;
            return 1;
        });
        const stats = clumpStats(rgba, 8, 5, 2);
        expect(stats.denseTexels).toBe(7);
        expect(stats.clumps).toBe(1);
        expect(stats.largestClumpMass).toBe(40);
        expect(stats.peak).toBe(10);
        expect(stats.totalMass).toBe(7 * 10 + 57 * 1);
        expect(stats.denseMassFraction).toBeCloseTo(70 / 127, 12);
        expect(clumpStats(rgba, 8, 5, 1).clumps).toBe(4);
    });

    it('does not wrap around the edges of the grid', () => {
        const rgba = grid(4, (x) => (x === 0 || x === 3 ? 9 : 0));
        const stats = clumpStats(rgba, 4, 5, 1);
        expect(stats.clumps).toBe(2);
        expect(stats.largestClumpMass).toBe(36);
    });

    it('is empty on an empty grid', () => {
        expect(clumpStats(new Float32Array(16 * 4), 4, 5, 1)).toEqual({
            totalMass: 0, peak: 0, denseTexels: 0, denseMassFraction: 0, clumps: 0, largestClumpMass: 0,
        });
    });
});

describe('lab: first crossing of a series', () => {
    const series: [number, number][] = [[0, 0], [1, 0.1], [2, 0.5], [3, 0.9]];

    it('interpolates between the samples around the level', () => {
        expect(firstCrossing(series, 0.3)).toBeCloseTo(1.5, 12);
        expect(firstCrossing(series, 0.1)).toBe(1);
    });

    it('is null when the level is never reached, the first time when the series starts above it', () => {
        expect(firstCrossing(series, 2)).toBeNull();
        expect(firstCrossing(series, -1)).toBe(0);
        expect(firstCrossing([], 1)).toBeNull();
    });
});
