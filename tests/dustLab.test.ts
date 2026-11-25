import { describe, expect, it } from 'vitest';
import { clumpStats, firstCrossing } from '../src/lab/clumpStats';
import {
    compareDustDeposit, referenceDustDeposit, referenceFromGrid, referenceUncertainty, type DustDepositInputs,
} from '../src/lab/dustDeposit';
import { fitHaff, fitLine } from '../src/lab/haffFit';

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

describe('lab: Haff fit', () => {
    it('finds the line of 1 / sqrt(T) and the exponent -2 in a clean law', () => {
        const T0 = 5000, t0 = 3;
        const series = Array.from({ length: 30 }, (_, i): [number, number] => [i * 0.7, T0 / (1 + i * 0.7 / t0) ** 2]);
        const fit = fitHaff(series);
        expect(fit.t0).toBeCloseTo(t0, 8);
        expect(fit.initialAgitation).toBeCloseTo(T0, 4);
        expect(fit.exponent).toBeCloseTo(-2, 8);
        expect(fit.line.r2).toBeCloseTo(1, 12);
        expect(fit.line.slope).toBeCloseTo(1 / (Math.sqrt(T0) * t0), 12);
    });

    it('sees a different law: an exponential decay is not a line of 1 / sqrt(T)', () => {
        const series = Array.from({ length: 30 }, (_, i): [number, number] => [i * 0.4, 5000 * Math.exp(-i * 0.4)]);
        expect(fitHaff(series).line.r2).toBeLessThan(0.95);
    });

    it('fits a line and leaves out non-positive agitations', () => {
        const fit = fitLine([[0, 1], [1, 3], [2, 5]]);
        expect([fit.slope, fit.intercept, fit.r2]).toEqual([2, 1, 1]);
        expect(Number.isNaN(fitLine([[0, 1]]).slope)).toBe(true);
        expect(fitHaff([[0, 100], [1, 0], [2, 25], [3, -1]]).line.slope).toBeCloseTo((0.2 - 0.1) / 2, 12);
    });
});

describe('lab: CPU reference of the dust deposit', () => {
    const RES = 8;
    const inputs: DustDepositInputs = {
        resolution: RES, domainOffset: [0, 0], domainSize: 16, splatMass: [2, 5, 0, 0, 0, 0, 0, 0, 0, 0],
        scales: { momentum: 0.5, energy: 0.25 },
        reference: () => ({ velocity: [1, 1], uncertainty: 0 }),
    };
    // Domain 16 px over 8 texels: 2 px a texel. A particle at (5, 8) is at (2.5, 4) in texel units: on the center of texel 2 in x,
    // between the centers of texels 3 and 4 in y (weights 1/2 and 1/2).
    it('spreads mass, momentum and energy about the reference with cloud-in-cell weights', () => {
        const positions = [5, 8, 1, 1];
        const velocities = [3, -1, 0, 0];
        const reference = referenceDustDeposit(positions, velocities, 1, inputs, 0);
        const at = (x: number, y: number, channel: number): number => reference.grid[(y * RES + x) * 4 + channel];
        expect(at(2, 3, 0)).toBeCloseTo(5 * 0.5 * 1, 12);
        expect(at(2, 4, 0)).toBeCloseTo(5 * 0.5 * 1, 12);
        let total = 0;
        for (let i = 0; i < RES * RES; i++) total += reference.grid[i * 4];
        expect(total).toBeCloseTo(5, 12);
        // The momentum is m v S, the energy m |v - ref|^2 S: |(3, -1) - (1, 1)|^2 = 8.
        expect(at(2, 3, 1)).toBeCloseTo(5 * 0.5 * 3 * 0.5, 12);
        expect(at(2, 3, 2)).toBeCloseTo(5 * 0.5 * -1 * 0.5, 12);
        expect(at(2, 3, 3)).toBeCloseTo(5 * 0.5 * 8 * 0.25, 12);
        expect(reference.deposited).toBe(1);
        expect(reference.payloadMax[3]).toBeCloseTo(5 * 8 * 0.25, 12);
    });

    it('skips removed particles and counts the contributions of the neighbouring texels', () => {
        const reference = referenceDustDeposit([5, 7, 0, -1, 5, 7, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0], 2, inputs, 0.01);
        expect(reference.deposited).toBe(1);
        expect(Array.from(reference.contributions).reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(4);
    });

    it('judges a grid against the tolerance model, the energy with the slack of the reference', () => {
        const positions = [5.3, 6.4, 0, 1, 7.9, 5.5, 1, 1];
        const velocities = [3, -1, 0, 0, -4, 2, 0, 0];
        const withSlack: DustDepositInputs = { ...inputs, reference: () => ({ velocity: [1, 1], uncertainty: 0.5 }) };
        const reference = referenceDustDeposit(positions, velocities, 2, withSlack, 1e-3);
        const tolerance = { roundoff: 2 ** -11, roundings: 4, weightError: 2 ** -15 };
        const exact = Array.from(reference.grid);
        expect(compareDustDeposit(exact, reference, tolerance).every(c => c.maxExcess === 0)).toBe(true);
        const off = [...exact];
        off[(3 * RES + 2) * 4 + 3] *= 1.0001;                         // a rounding-sized error is allowed
        expect(compareDustDeposit(off, reference, tolerance)[3].maxExcess).toBeLessThan(1);
        const far = [...exact];
        far[(3 * RES + 2) * 4 + 3] *= 1.5;
        expect(compareDustDeposit(far, reference, tolerance)[3].maxExcess).toBeGreaterThan(1);
        const stray = [...exact];
        stray[0 * 4 + 3] = 1;                                         // a texel no particle reaches must hold exactly 0
        expect(compareDustDeposit(stray, reference, tolerance)[3].maxExcess).toBe(Infinity);
    });

    it('allows rounding errors relative to the opposite contributions of a momentum that nearly cancels', () => {
        // Two grains moving in opposite directions at the same position: the net momentum is 0, each addition is rounded.
        const reference = referenceDustDeposit([5, 8, 0, 1, 5, 8, 0, 1], [300, 0, 0, 0, -299, 0, 0, 0], 2, inputs, 0);
        const tolerance = { roundoff: 2 ** -11, roundings: 4, weightError: 2 ** -15 };
        const at = (2 * 0 + 3) * RES + 2;
        const gpu = Array.from(reference.grid);
        gpu[at * 4 + 1] += 1e-3 * reference.magnitude[at * 4 + 1];
        expect(reference.grid[at * 4 + 1]).toBeGreaterThan(0);
        expect(reference.magnitude[at * 4 + 1]).toBeGreaterThan(100 * reference.grid[at * 4 + 1]);
        expect(compareDustDeposit(gpu, reference, tolerance)[1].maxExcess).toBeLessThan(1);
    });

    it('reads the reference grid bilinearly, mass and momentum first, then divides', () => {
        const res = 2;
        // Two texels of mass 1 and 3 moving at 10 and 30 (scaled momentum = m v S), two empty.
        const S = 0.01;
        const grid = new Float32Array(res * res * 4);
        grid.set([1, 1 * 10 * S, 0, 0, 3, 3 * 30 * S, 0, 0], 0);
        // Midway between the centers of the first row's two texels (at y = 0.5, on the row): mass 2, momentum x (10 + 90) / 2 S = 50 S, so 25.
        const mid = referenceFromGrid(grid, res, [0, 0], 2, S, 1, 0.5);
        expect(mid[0]).toBeCloseTo(25, 5);
        expect(referenceFromGrid(new Float32Array(16), res, [0, 0], 2, S, 1, 1)).toEqual([0, 0]);
        expect(referenceUncertainty(grid, res, [0, 0], 2, S, 1, 0.5, 8)).toBeCloseTo(2 * 20 * 2 ** -9, 6);
    });
});
