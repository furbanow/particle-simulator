// Pure side of the GPU benchmark: which particle count to try next, and the particle cap the tried
// counts give. A count "keeps" the target when its mean frame interval is at most the target interval.

import {
    BENCHMARK_FIRST_COUNT, BENCHMARK_FRAME_TOLERANCE, BENCHMARK_GROWTH, BENCHMARK_RESOLUTION, BENCHMARK_TARGET_FPS,
    PARTICLE_CAP_RANGE, PARTICLE_CAP_STEP, type Range,
} from '../config';
import { clamp } from '../util/math';

/** Mean interval between two frames of the application, run with `count` particles. */
export interface Probe {
    readonly count: number;
    readonly frameMs: number;
}

/** Mean of the intervals without the `dropped` longest ones, leaving out at most a third of them. */
export function trimmedMean(intervals: readonly number[], dropped: number): number {
    const kept = [...intervals].sort((a, b) => a - b)
        .slice(0, intervals.length - Math.min(dropped, Math.floor(intervals.length / 3)));
    return kept.reduce((sum, x) => sum + x, 0) / kept.length;
}

/**
 * The longest mean frame interval that still keeps the target frame rate: the target's interval,
 * or the display's own (`refreshMs`) when it is slower, with some tolerance for its jitter.
 */
export const targetFrameMs = (refreshMs: number): number =>
    Math.max(1000 / BENCHMARK_TARGET_FPS, refreshMs) * BENCHMARK_FRAME_TOLERANCE;

/** The largest count keeping the target and the smallest one missing it (null when none was tried). */
function bounds(probes: readonly Probe[], targetMs: number): { keep: Probe | null; miss: Probe | null } {
    let keep: Probe | null = null, miss: Probe | null = null;
    for (const p of probes) {
        if (p.frameMs <= targetMs) { if (!keep || p.count > keep.count) keep = p; }
        else if (!miss || p.count < miss.count) miss = p;
    }
    return { keep, miss };
}

/**
 * Count missing the target, scaled down to it as if the frame time were proportional to the count.
 * The fixed part of the frame time makes it an overestimate: the search goes on from there.
 */
const proportionalCount = (miss: Probe, targetMs: number): number => miss.count * targetMs / miss.frameMs;

/**
 * The next count to try, within `range`: BENCHMARK_FIRST_COUNT, then BENCHMARK_GROWTH times the
 * largest count keeping the target while none misses it, the proportional estimate below the
 * smallest one missing it (at least BENCHMARK_RESOLUTION below) while none keeps it, then the
 * geometric middle of the two. Null once they are within BENCHMARK_RESOLUTION, or at the ends of
 * the range.
 */
export function nextProbe(probes: readonly Probe[], targetMs: number, range: Range): number | null {
    const { keep, miss } = bounds(probes, targetMs);
    let next: number;
    if (keep && miss) {
        if (miss.count / keep.count <= BENCHMARK_RESOLUTION) return null;
        next = Math.sqrt(keep.count * miss.count);
    } else if (keep) next = keep.count * BENCHMARK_GROWTH;
    else if (miss) next = Math.min(proportionalCount(miss, targetMs), miss.count / BENCHMARK_RESOLUTION);
    else next = BENCHMARK_FIRST_COUNT;
    next = Math.round(clamp(next, range));
    return probes.some(p => p.count === next) ? null : next;
}

/** How the runner tries a count: restarted with it, or by repeating each frame of the running count. */
export interface ProbePlan {
    readonly restart: boolean;
    /** Frames rendered per animation frame. */
    readonly load: number;
    /** The count tried: the one asked for, or the running count times the load. */
    readonly count: number;
}

/**
 * How to try `count` particles with `running` particles already running: from twice the running
 * count up, each frame is repeated `load` times rather than restarting the simulation (a restart
 * takes long); `load` frames of N particles cost at least one frame of load × N, since the fixed
 * part of the frame is repeated too, so the cap stays on the safe side. Below, a restart.
 */
export function probePlan(count: number, running: number): ProbePlan {
    if (running <= 0 || count < 2 * running) return { restart: true, load: 1, count };
    const load = Math.floor(count / running);
    return { restart: false, load, count: running * load };
}

/**
 * The particle cap the probes give: the largest count keeping the target; when none does, the
 * proportional estimate below the smallest count (at least the bottom of `range`).
 */
export function capFromProbes(probes: readonly Probe[], targetMs: number, range: Range): number {
    const { keep, miss } = bounds(probes, targetMs);
    const count = keep ? keep.count : miss ? proportionalCount(miss, targetMs) : range[0];
    return particleCap(clamp(count, range));
}

/** A particle cap: rounded down to PARTICLE_CAP_STEP (the safe side), within PARTICLE_CAP_RANGE. */
export function particleCap(count: number): number {
    return clamp(Math.floor(count / PARTICLE_CAP_STEP) * PARTICLE_CAP_STEP, PARTICLE_CAP_RANGE);
}
