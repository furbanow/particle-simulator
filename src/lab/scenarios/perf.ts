// Performance probe: ms per frame of each algorithm at fixed particle counts. The numbers only
// mean something on a real GPU; on a software rasterizer the probe runs a couple of frames to
// exercise its code and says so (status `skip`, `valid: false`).

import type { AlgorithmId } from '../../simulation/algorithms';
import {
    LAB_AREA, PERF_ALGORITHMS, PERF_ANIMATION_FRAME_TRUST, PERF_COUNTS, PERF_FRAMES_SOFTWARE, PERF_WARMUP_FRAMES,
    PERF_WARMUP_FRAMES_SOFTWARE,
} from '../config';
import { nextAnimationFrame, restart, runFrames, substepsPerFrame } from '../driver';
import { mean, quantile, significant } from '../numbers';
import { RenderStack } from '../renderStack';
import type { LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const stacks = new WeakMap<LabContext, RenderStack>();

function renderStack(context: LabContext): RenderStack {
    let stack = stacks.get(context);
    if (!stack) {
        stack = new RenderStack(context.renderer, context.simulation, LAB_AREA.width, LAB_AREA.height);
        stacks.set(context, stack);
    }
    return stack;
}

/** Intervals between animation frames, each running `frame` (the way the application's GPU benchmark times a frame). */
async function frameIntervals(warmup: number, frames: number, frame: () => void): Promise<number[]> {
    let last = await nextAnimationFrame();
    for (let i = 0; i < warmup; i++) {
        frame();
        last = await nextAnimationFrame();
    }
    const intervals: number[] = [];
    for (let i = 0; i < frames; i++) {
        frame();
        const now = await nextAnimationFrame();
        intervals.push(now - last);
        last = now;
    }
    return intervals;
}

async function probe(context: LabContext, algorithm: AlgorithmId, count: number): Promise<ScenarioOutcome> {
    const { simulation, software } = context;
    const warmup = software ? PERF_WARMUP_FRAMES_SOFTWARE : PERF_WARMUP_FRAMES;
    const frames = software ? PERF_FRAMES_SOFTWARE : context.options.perfFrames;
    await restart(context, { algorithm, count });
    const stack = renderStack(context);
    stack.prepare();

    // Simulation only (step + endFrame), the GPU synchronized every few frames and at the end: the pure GPU cost, free of the display's refresh.
    await runFrames(context, warmup, { endFrame: true });
    const simStart = performance.now();
    await runFrames(context, frames, { endFrame: true });
    const simMs = (performance.now() - simStart) / frames;

    // The same with whole frames (simulation, particles, nebula, bloom, output).
    await runFrames(context, warmup, { step: () => stack.frame() });
    const frameStart = performance.now();
    await runFrames(context, frames, { step: () => stack.frame() });
    const frameMs = (performance.now() - frameStart) / frames;

    // Whole frames, one per animation frame: the application's way, which cannot go below the display's refresh interval.
    const intervals = await frameIntervals(warmup, frames, () => stack.frame());
    const median = quantile(intervals, 0.5);
    const animationFramesIgnoreGpu = median < PERF_ANIMATION_FRAME_TRUST * frameMs;

    const valid = !software;
    const metrics = {
        valid,
        renderer: context.rendererName,
        algorithm,
        particles: simulation.activeCount,
        requestedParticles: count,
        timeScale: simulation.timeScale,
        substepsPerFrame: substepsPerFrame(context),
        warmupFrames: warmup,
        timedFrames: frames,
        simulationMsPerFrame: significant(simMs, DIGITS),
        wholeFrameMsPerFrame: significant(frameMs, DIGITS),
        animationFrameMeanMs: significant(mean(intervals), DIGITS),
        animationFrameMedianMs: significant(median, DIGITS),
        animationFrameP95Ms: significant(quantile(intervals, 0.95), DIGITS),
        animationFramesIgnoreGpu,
    };
    const summary = `${simulation.activeCount} particles: simulation ${simMs.toFixed(2)} ms/frame, whole frame ${frameMs.toFixed(2)} ms/frame (animation-frame median ${median.toFixed(2)} ms)`;
    if (simulation.activeCount !== count) {
        return { status: 'fail', metrics, details: `asked for ${count} particles, the simulation runs ${simulation.activeCount}` };
    }
    if (!valid) {
        return { status: 'skip', metrics, details: `INVALID: software renderer (${context.rendererName}), timings are meaningless; ${summary}` };
    }
    return {
        status: 'pass', metrics,
        details: animationFramesIgnoreGpu ? `${summary}; the animation-frame intervals do not reflect the GPU load here, read the synchronized figures` : summary,
    };
}

const label = (count: number): string => count >= 1e6 ? `${count / 1e6}m` : `${count / 1e3}k`;

/** One scenario per algorithm and count. */
export const perfScenarios: Scenario[] = PERF_ALGORITHMS.flatMap(algorithm => PERF_COUNTS.map((count): Scenario => ({
    id: `perf.${algorithm}.${label(count)}`,
    title: `Performance: ${algorithm} at ${count.toLocaleString('en-US')} particles (ms/frame)`,
    tags: ['perf', 'slow', algorithm],
    run: context => probe(context, algorithm, count),
})));
