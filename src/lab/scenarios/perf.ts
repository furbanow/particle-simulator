// Performance probe: ms per frame of each algorithm at fixed particle counts (the median of
// chunks of frames, each ended by a wait for the GPU). The numbers only
// mean something on a real GPU; on a software rasterizer the probe runs a couple of frames to
// exercise its code and says so (status `skip`, `valid: false`).

import type { AlgorithmId } from '../../simulation/algorithms';
import {
    LAB_AREA, PERF_ALGORITHMS, PERF_ANIMATION_FRAME_TRUST, PERF_CHUNK_FRAMES, PERF_COUNTS, PERF_FRAMES_SOFTWARE,
    PERF_WARMUP_FRAMES, PERF_WARMUP_MS,
} from '../config';
import { nextAnimationFrame, protostarModel, restart, substepsPerFrame } from '../driver';
import { mean, quantile, significant } from '../numbers';
import { RenderStack } from '../renderStack';
import type { LabContext, Scenario, ScenarioOutcome } from '../types';
import { parseCloudVariants } from './baseline';

const DIGITS = 4;
const stacks = new WeakMap<LabContext, RenderStack>();

export function renderStack(context: LabContext): RenderStack {
    let stack = stacks.get(context);
    if (!stack) {
        stack = new RenderStack(context.renderer, context.simulation, LAB_AREA.width, LAB_AREA.height);
        stacks.set(context, stack);
    }
    return stack;
}

/** ms per frame of each chunk of `chunkFrames` frames, the GPU being waited for at the end of each. */
export async function timeChunks(context: LabContext, frame: () => void, chunkFrames: number, chunks: number): Promise<number[]> {
    const texture = () => context.simulation.positionTexture;
    const out: number[] = [];
    for (let c = 0; c < chunks; c++) {
        const start = performance.now();
        for (let i = 0; i < chunkFrames; i++) frame();
        await context.sync.wait(texture());
        out.push((performance.now() - start) / chunkFrames);
    }
    return out;
}

/** Runs `frame` for at least `frames` frames and `minMs` (in synchronized chunks), untimed. */
export async function warmUp(context: LabContext, frame: () => void, chunkFrames: number, frames: number, minMs: number): Promise<void> {
    const start = performance.now();
    for (let done = 0; done < frames || performance.now() - start < minMs; done += chunkFrames) {
        await timeChunks(context, frame, chunkFrames, 1);
    }
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
    const chunkFrames = software ? 1 : PERF_CHUNK_FRAMES;
    const warmupFrames = software ? 1 : PERF_WARMUP_FRAMES;
    const warmupMs = software ? 0 : PERF_WARMUP_MS;
    const frames = software ? PERF_FRAMES_SOFTWARE : context.options.perfFrames;
    const chunks = Math.max(1, Math.round(frames / chunkFrames));
    // The protostar's variant of the page URL (`?perfVariant={"molecularWeight":false,"overrides":{...}}`): the physics of another build,
    // so that two builds are timed on the same dynamics (the cost of a change of shaders, not of a change of defaults).
    const variant = algorithm === 'protostar' ? parseCloudVariants(`[${context.options.perfVariant}]`)[0] : undefined;
    await restart(context, { algorithm, count, overrides: variant?.overrides, shippedFlags: true });
    if (variant?.molecularWeight === false) protostarModel(context).debugGrids.molecularWeightEnabled = false;
    const stack = renderStack(context);
    stack.prepare();

    // Simulation only (step + endFrame), the GPU waited for after each chunk: the pure GPU cost, free of the display's refresh.
    const simulate = () => { simulation.step(); simulation.endFrame(); };
    await warmUp(context, simulate, chunkFrames, warmupFrames, warmupMs);
    const simChunks = await timeChunks(context, simulate, chunkFrames, chunks);
    const simMs = quantile(simChunks, 0.5);

    // The same with whole frames (simulation, particles, nebula, bloom, output).
    const whole = () => stack.frame();
    await warmUp(context, whole, chunkFrames, warmupFrames, warmupMs);
    const frameChunks = await timeChunks(context, whole, chunkFrames, chunks);
    const frameMs = quantile(frameChunks, 0.5);

    // Whole frames, one per animation frame: the application's way, which cannot go below the display's refresh interval.
    const intervals = await frameIntervals(warmupFrames, chunkFrames * chunks, whole);
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
        warmupFrames,
        warmupMs,
        timedFrames: chunkFrames * chunks,
        chunkFrames,
        simulationMsPerFrame: significant(simMs, DIGITS),
        simulationChunksMsPerFrame: simChunks.map(v => significant(v, DIGITS)),
        wholeFrameMsPerFrame: significant(frameMs, DIGITS),
        wholeFrameChunksMsPerFrame: frameChunks.map(v => significant(v, DIGITS)),
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
export const perfScenarios: Scenario[] = PERF_ALGORITHMS.flatMap(algorithm => PERF_COUNTS[algorithm].map((count): Scenario => ({
    id: `perf.${algorithm}.${label(count)}`,
    title: `Performance: ${algorithm} at ${count.toLocaleString('en-US')} particles (ms/frame)`,
    tags: ['perf', 'slow', algorithm],
    run: context => probe(context, algorithm, count),
})));
