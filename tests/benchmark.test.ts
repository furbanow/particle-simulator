import { describe, expect, it } from 'vitest';
import {
    BENCHMARK_DURATION_MS, BENCHMARK_FIRST_COUNT, BENCHMARK_FRAME_TOLERANCE, BENCHMARK_MAX_PROBES, PARTICLE_CAP_RANGE,
    type Range,
} from '../src/config';
import { capFromProbes, nextProbe, particleCap, probePlan, targetFrameMs, trimmedMean } from '../src/benchmark/estimate';
import { runBenchmark, type BenchmarkClock, type BenchmarkTarget } from '../src/benchmark/runner';

const RANGE: Range = [1000, 2000000];
const TARGET = 1000 / 60 * BENCHMARK_FRAME_TOLERANCE;

describe('benchmark search', () => {
    it('leaves the slowest frames out of the mean, at most a third of them', () => {
        expect(trimmedMean([16, 16, 50, 16, 33, 16], 2)).toBe(16);
        expect(trimmedMean([30, 60, 90], 2)).toBe(45);
        expect(trimmedMean([40], 2)).toBe(40);
    });

    it('targets 60 FPS, or the display rate when it is slower, with some tolerance', () => {
        expect(targetFrameMs(1000 / 144)).toBeCloseTo(TARGET);
        expect(targetFrameMs(20)).toBeCloseTo(20 * BENCHMARK_FRAME_TOLERANCE);
    });

    it('starts at the first count and grows while the target is kept', () => {
        expect(nextProbe([], TARGET, RANGE)).toBe(BENCHMARK_FIRST_COUNT);
        expect(nextProbe([{ count: 400000, frameMs: 16.7 }], TARGET, RANGE)).toBe(800000);
        expect(nextProbe([{ count: 1600000, frameMs: 16.7 }], TARGET, RANGE)).toBe(RANGE[1]);
        expect(nextProbe([{ count: RANGE[1], frameMs: 16.7 }], TARGET, RANGE)).toBeNull();
    });

    it('goes down proportionally while every count misses the target', () => {
        // 4 times too slow: a quarter of the count.
        expect(nextProbe([{ count: 400000, frameMs: TARGET * 4 }], TARGET, RANGE)).toBe(100000);
        // Barely too slow: at least one resolution step down.
        expect(nextProbe([{ count: 400000, frameMs: TARGET * 1.01 }], TARGET, RANGE)).toBe(320000);
        expect(nextProbe([{ count: RANGE[0], frameMs: TARGET * 2 }], TARGET, RANGE)).toBeNull();
    });

    it('bisects between the last count keeping the target and the first missing it, down to the resolution', () => {
        const keep = { count: 400000, frameMs: 16.7 };
        expect(nextProbe([keep, { count: 800000, frameMs: 20 }], TARGET, RANGE)).toBe(565685);
        expect(nextProbe([keep, { count: 480000, frameMs: 20 }], TARGET, RANGE)).toBeNull();
    });

    it('repeats the frames from twice the running count up, and restarts below', () => {
        expect(probePlan(400000, 0)).toEqual({ restart: true, load: 1, count: 400000 });
        expect(probePlan(800000, 400000)).toEqual({ restart: false, load: 2, count: 800000 });
        expect(probePlan(2000000, 400000)).toEqual({ restart: false, load: 5, count: 2000000 });
        expect(probePlan(1500000, 400000)).toEqual({ restart: false, load: 3, count: 1200000 });
        expect(probePlan(565685, 400000)).toEqual({ restart: true, load: 1, count: 565685 });
        expect(probePlan(320000, 400000)).toEqual({ restart: true, load: 1, count: 320000 });
    });

    it('caps at the largest count keeping the target, else below the smallest one', () => {
        expect(capFromProbes([{ count: 400000, frameMs: 16.7 }, { count: 565685, frameMs: 19 }], TARGET, RANGE)).toBe(400000);
        expect(capFromProbes([{ count: 400000, frameMs: TARGET * 2 }], TARGET, RANGE)).toBe(200000);
        expect(capFromProbes([], TARGET, RANGE)).toBe(PARTICLE_CAP_RANGE[0]);
    });

    it('rounds a cap down to its step, within its range', () => {
        expect(particleCap(419999)).toBe(410000);
        expect(particleCap(0)).toBe(PARTICLE_CAP_RANGE[0]);
        expect(particleCap(Infinity)).toBe(PARTICLE_CAP_RANGE[1]);
    });
});

/**
 * A display refreshing every `refreshMs` and a GPU whose frame takes `frameCost(count)` ms, on a
 * fake clock: the next animation frame comes once the display refreshed and the last frame is done.
 */
function fakeMachine(frameCost: (count: number) => number, refreshMs = 1000 / 60, prepareMs = 100) {
    let time = 0;
    let count = 0;
    let pending = 0;                         // cost of the frames rendered since the last animation frame
    const tried: number[] = [];
    const target: BenchmarkTarget = {
        range: RANGE,
        prepare: n => { count = n; tried.push(n); time += prepareMs; },
        frame: () => { pending += frameCost(count); },
    };
    const clock: BenchmarkClock = {
        now: () => time,
        nextFrame: async () => {
            time += Math.max(refreshMs, pending);
            pending = 0;
            return time;
        },
    };
    return { target, clock, tried, elapsed: () => time };
}

describe('benchmark run', () => {
    it('finds about 400 000 particles on a GPU running them at 60 FPS', async () => {
        // About a GTX 1060 on the protostar: 60 FPS up to 400 000 particles, 50 FPS at 800 000.
        const machine = fakeMachine(n => 11 + n * 1.1e-5);
        const cap = await runBenchmark(machine.target, machine.clock);
        expect(cap).toBeGreaterThanOrEqual(400000);
        expect(cap).toBeLessThan(600000);
        expect(machine.tried[0]).toBe(BENCHMARK_FIRST_COUNT);
        expect(machine.tried).not.toContain(800000);              // tried by repeating the frames
        expect(machine.elapsed()).toBeLessThan(2000);
    });

    it('tries the first count even when it is very slow, and stops in time', async () => {
        const machine = fakeMachine(n => n * 1e-3);             // 400 ms per frame at 400 000 particles
        const progress: number[] = [];
        const cap = await runBenchmark(machine.target, machine.clock, f => progress.push(f));
        expect(machine.tried[0]).toBe(BENCHMARK_FIRST_COUNT);
        expect(cap).toBeLessThanOrEqual(10000 + PARTICLE_CAP_RANGE[0]);
        expect(machine.elapsed()).toBeLessThan(BENCHMARK_DURATION_MS + 500);
        expect(progress.every(f => f >= 0 && f <= 1)).toBe(true);
    });

    it('goes up to the top of the range on a fast GPU, within the probe limit', async () => {
        const machine = fakeMachine(() => 2);
        const cap = await runBenchmark(machine.target, machine.clock);
        // The last count is a whole multiple of the running one (frames repeated), so it may stop just under the top.
        expect(cap).toBeGreaterThanOrEqual(RANGE[1] * 0.85);
        expect(machine.tried.length).toBeLessThanOrEqual(BENCHMARK_MAX_PROBES);
    });

    it('does not fail every count on a display slower than 60 Hz', async () => {
        const machine = fakeMachine(() => 2, 20);
        // Every count tried keeps up with the display: the cap grows until the time is over.
        expect(await runBenchmark(machine.target, machine.clock)).toBeGreaterThan(BENCHMARK_FIRST_COUNT);
        expect(machine.elapsed()).toBeLessThan(BENCHMARK_DURATION_MS + 500);
    });
});
