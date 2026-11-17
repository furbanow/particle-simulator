// Timing side of the GPU benchmark: runs the application's frames on a target, one per animation
// frame as the frame loop does, and returns the particle cap (no GPU or DOM here: the target and
// the clock do it). Timing the intervals between animation frames counts everything a frame costs
// (GPU work, read-backs to the CPU, presentation), where no GPU synchronization would be reliable.

import {
    BENCHMARK_DROPPED_FRAMES, BENCHMARK_DURATION_MS, BENCHMARK_LOAD_WARMUP_FRAMES, BENCHMARK_MAX_PROBES,
    BENCHMARK_PROBE_FRAMES, BENCHMARK_PROBE_MAX_MS, BENCHMARK_REFRESH_FRAMES, BENCHMARK_WARMUP_FRAMES, type Range,
} from '../config';
import { capFromProbes, nextProbe, probePlan, targetFrameMs, trimmedMean, type Probe } from './estimate';

/** What is benchmarked: the whole frame of the application. */
export interface BenchmarkTarget {
    /** Particle counts the target can run. */
    readonly range: Range;
    /** Restarts with `count` particles. */
    prepare(count: number): void;
    /** One full frame: simulation step and rendering. */
    frame(): void;
}

export interface BenchmarkClock {
    now(): number;
    /** Resolves at the next animation frame, with its timestamp. */
    nextFrame(): Promise<number>;
}

export const browserClock: BenchmarkClock = {
    now: () => performance.now(),
    nextFrame: () => new Promise(resolve => requestAnimationFrame(resolve)),
};

/**
 * Intervals between the next animation frames, `render` being called in each one: `frames` of
 * them after `warmup` untimed ones, or fewer once `maxMs` is over.
 */
async function frameIntervals(clock: BenchmarkClock, warmup: number, frames: number, maxMs: number,
                              render: () => void): Promise<number[]> {
    let last = await clock.nextFrame();
    for (let i = 0; i < warmup; i++) {
        render();
        last = await clock.nextFrame();
    }
    const first = last;
    const intervals: number[] = [];
    while (intervals.length < frames && last - first < maxMs) {
        render();
        const now = await clock.nextFrame();
        intervals.push(now - last);
        last = now;
    }
    return intervals;
}

/**
 * Times the display's own frame interval, then tries a few particle counts (nextProbe, probePlan),
 * each one warmed up and timed, and returns the cap they give. The first count is always tried;
 * the next ones only while their predicted duration fits BENCHMARK_DURATION_MS. `onProgress` gets
 * the elapsed fraction of that duration.
 */
export async function runBenchmark(target: BenchmarkTarget, clock: BenchmarkClock = browserClock,
                                   onProgress: (fraction: number) => void = () => {}): Promise<number> {
    const start = clock.now();
    const deadline = start + BENCHMARK_DURATION_MS;
    const progress = () => onProgress(Math.min(1, (clock.now() - start) / BENCHMARK_DURATION_MS));
    const refresh = await frameIntervals(clock, 0, BENCHMARK_REFRESH_FRAMES, Infinity, progress);
    const targetMs = targetFrameMs(trimmedMean(refresh, BENCHMARK_DROPPED_FRAMES));

    const probes: Probe[] = [];
    let running = 0;                         // particle count of the running simulation
    let prepareMs = 0;                       // duration of the last restart
    for (let count = nextProbe(probes, targetMs, target.range);
         count !== null && probes.length < BENCHMARK_MAX_PROBES;
         count = nextProbe(probes, targetMs, target.range)) {
        const plan = probePlan(count, running);
        if (probes.some(p => p.count === plan.count)) break;
        const warmup = plan.restart ? BENCHMARK_WARMUP_FRAMES : BENCHMARK_LOAD_WARMUP_FRAMES;
        const last = probes.at(-1);
        if (last) {
            // A restart as long as the last one, a frame time proportional to the count (at least the target's).
            const frameMs = Math.max(targetMs, last.frameMs * plan.count / last.count);
            const predictedMs = (plan.restart ? prepareMs : 0) + warmup * frameMs
                + Math.min(BENCHMARK_PROBE_FRAMES * frameMs, BENCHMARK_PROBE_MAX_MS + frameMs);
            if (clock.now() + predictedMs > deadline) break;
        }
        if (plan.restart) {
            const t = clock.now();
            target.prepare(plan.count);
            prepareMs = clock.now() - t;
            running = plan.count;
        }
        const render = () => {
            for (let i = 0; i < plan.load; i++) target.frame();
            progress();
        };
        const intervals = await frameIntervals(clock, warmup, BENCHMARK_PROBE_FRAMES, BENCHMARK_PROBE_MAX_MS, render);
        const frameMs = trimmedMean(intervals, BENCHMARK_DROPPED_FRAMES);
        probes.push({ count: plan.count, frameMs });
    }
    return capFromProbes(probes, targetMs, target.range);
}
