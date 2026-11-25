import { describe, expect, it } from 'vitest';
import {
    compareCore, cumulative, firstCrossing, histogram, parseSchedule, peak, smooth, stepSummary, valueAt, type CoreSeries,
} from '../src/lab/stepStats';

// The lab's statistics of the adaptive time step (src/lab/stepStats.ts).

const frames = (n: number, dt = 0.1): number[] => Array.from({ length: n }, (_, i) => i * dt);

/** A core that collapses to a burst at `burst` seconds: the density rises as a Gaussian in time, the rate is a narrow peak. */
function core(burst: number, peakDensity: number, n = 100): CoreSeries {
    const seconds = frames(n);
    return {
        seconds,
        density: seconds.map(t => 1 + (peakDensity - 1) * Math.exp(-(((t - burst) / 2) ** 2))),
        temperatureMK: seconds.map(t => 5 + 90 * Math.exp(-(((t - burst) / 0.3) ** 2))),
        rate: seconds.map(t => 1000 * Math.exp(-(((t - burst) / 0.3) ** 2))),
    };
}

describe('the counts of substeps', () => {
    it('are histogrammed by value and summarized', () => {
        expect(histogram([2, 2, 3, 1, 2, 4])).toEqual([0, 1, 3, 1, 1]);
        const { mean, shares } = stepSummary([2, 2, 3, 1]);
        expect(mean).toBe(2);
        expect(shares).toEqual([0, 0.25, 0.5, 0.25]);
        expect(histogram([])).toEqual([0]);
    });
});

describe('the series helpers', () => {
    it('find the peak, the first crossing and the value at a time', () => {
        const t = [0, 1, 2, 3, 4];
        const v = [0, 2, 8, 4, 1];
        expect(peak(v, t)).toEqual({ value: 8, seconds: 2 });
        expect(firstCrossing(v, t, 5)).toBeCloseTo(1.5, 12);
        expect(firstCrossing(v, t, 9)).toBeNull();
        expect(firstCrossing(v, t, 0)).toBe(0);
        expect(valueAt(v, t, 2.5)).toBeCloseTo(6, 12);
        expect(valueAt(v, t, -1)).toBe(0);
        expect(valueAt(v, t, 99)).toBe(1);
    });

    it('integrates a rate and smooths it', () => {
        expect(cumulative([2, 2, 2], [0, 1, 3])).toEqual([0, 2, 6]);
        expect(smooth([0, 3, 0, 3, 0], 3)).toEqual([1.5, 1, 2, 1, 1.5]);
    });
});

describe('the comparison of a core with its reference', () => {
    it('finds nothing between two identical histories', () => {
        const c = compareCore(core(5, 40), core(5, 40), 8, [3, 5, 7]);
        expect(c.densityLogRms).toBe(0);
        expect(c.peakDensityRelative).toBe(0);
        expect(c.burstTimeDelta).toBeCloseTo(0, 12);
        expect(c.burstPeakRelative).toBe(0);
        expect(c.fusedRelative.every(f => f === 0)).toBe(true);
    });

    it('reads a later and lower burst', () => {
        const c = compareCore(core(5.4, 36), core(5, 40), 8, [3, 7]);
        expect(c.burstTimeDelta).toBeCloseTo(0.4, 6);
        expect(c.peakDensityRelative).toBeCloseTo(-4 / 40 * 39 / 39, 1);
        expect(c.peakDensityTimeDelta).toBeCloseTo(0.4, 12);
        expect(c.densityLogRms).toBeGreaterThan(0);
        expect(c.fusedRelative[0]).toBeLessThan(0);             // fewer fusions by 3 s
    });

    it('stops at the time asked', () => {
        const long = core(5, 40, 200);
        const early = compareCore(long, { ...long, density: long.density.map((d, i) => long.seconds[i] > 6 ? d * 3 : d) }, 6, []);
        expect(early.densityLogRms).toBe(0);
    });
});

describe('the comparison of cores read at other times', () => {
    it('resamples the run at the reference\'s times: the same history read at other instants is the same history', () => {
        const reference = core(5, 40, 200);
        const seconds = reference.seconds.map(t => t - 0.037);
        // the same functions of time, read 37 ms earlier in each frame: resampled it differs only by the interpolation
        const same = compareCore({
            seconds, density: seconds.map(t => 1 + 39 * Math.exp(-(((t - 5) / 2) ** 2))),
            temperatureMK: seconds.map(t => 5 + 90 * Math.exp(-(((t - 5) / 0.3) ** 2))), rate: seconds.map(t => 1000 * Math.exp(-(((t - 5) / 0.3) ** 2))),
        }, reference, 8, [3, 7]);
        expect(same.densityLogRms).toBeLessThan(5e-3);
        expect(Math.abs(same.burstTimeDelta ?? 1)).toBeLessThan(0.02);
    });
});

describe('a schedule of substeps', () => {
    it('is read from run lengths', () => {
        expect(parseSchedule('2x3,3x2,2x1')).toEqual([2, 2, 2, 3, 3, 2]);
        expect(() => parseSchedule('2x0')).toThrow();
        expect(() => parseSchedule('abc')).toThrow();
    });
});
