// The protostar's cost and frame times in the builds before and after the fusion of parcels of constant mass (proposal A4,
// docs/spikes/a4-constant-mass-fusion.md). Both read only the application's public surface (restart, step, endFrame), so they run on the build
// before too, which is how the two are compared.
//
//  - perf.protostarPhases.<count>: the simulation ms/frame in two windows of the default cloud's life after one restart: frames 10 to 50 (the cloud has
//    barely started to collapse: the same load in every build) and frames 1000 to 1040 (the hydrogen is mostly burnt: the build that removes the
//    fused particles has about a quarter of them left, the one that keeps them has all).
//  - perf.protostarHitch.<count>: the time between the starts of two frames over the periodic readings of the model (the old build reads the positions
//    back every 12 frames, the new one a few texels every 10), each frame followed by a wait for the GPU: median, p95, p99 and the worst.

import {
    PROTOSTAR_HITCH_COUNTS, PROTOSTAR_HITCH_FRAMES, PROTOSTAR_HITCH_WARMUP_FRAMES, PROTOSTAR_PHASE_CHUNK_FRAMES, PROTOSTAR_PHASE_CHUNKS,
    PROTOSTAR_PHASE_COUNTS, PROTOSTAR_PHASES,
} from '../config';
import { restart } from '../driver';
import { mean, quantile, significant } from '../numbers';
import type { JsonValue, Scenario, ScenarioOutcome } from '../types';
import { timeChunks } from './perf';

const round = (v: number): number => significant(v, 4);
const label = (count: number): string => count >= 1e6 ? `${count / 1e6}m` : `${count / 1e3}k`;

const describe = (times: readonly number[]): Record<string, JsonValue> => times.length === 0 ? { n: 0 } : {
    n: times.length, meanMs: round(mean(times)), medianMs: round(quantile(times, 0.5)), p95Ms: round(quantile(times, 0.95)),
    p99Ms: round(quantile(times, 0.99)), maxMs: round(Math.max(...times)),
};

export const protostarPhaseScenarios: Scenario[] = PROTOSTAR_PHASE_COUNTS.map((count): Scenario => ({
    id: `perf.protostarPhases.${label(count)}`,
    title: `Performance: protostar at ${count.toLocaleString('en-US')} particles, an early and a late window of the default cloud (ms/frame, simulation only)`,
    tags: ['perf', 'slow', 'protostar'],
    async run(context): Promise<ScenarioOutcome> {
        const { simulation, software } = context;
        const simulate = (): void => { simulation.step(); simulation.endFrame(); };
        await restart(context, { count: software ? 20_000 : count });
        const windows: Record<string, JsonValue> = {};
        const notes: string[] = [];
        let done = 0;
        for (const { name, warmupFrames } of PROTOSTAR_PHASES) {
            const target = software ? 4 : warmupFrames;
            while (done + PROTOSTAR_PHASE_CHUNK_FRAMES <= target) { await timeChunks(context, simulate, PROTOSTAR_PHASE_CHUNK_FRAMES, 1); done += PROTOSTAR_PHASE_CHUNK_FRAMES; }
            const chunks = await timeChunks(context, simulate, PROTOSTAR_PHASE_CHUNK_FRAMES, software ? 1 : PROTOSTAR_PHASE_CHUNKS);
            done += PROTOSTAR_PHASE_CHUNK_FRAMES * chunks.length;
            const median = quantile(chunks, 0.5);
            windows[name] = {
                fromFrame: target, toFrame: target + PROTOSTAR_PHASE_CHUNK_FRAMES * chunks.length, simulationMsPerFrame: round(median),
                minMsPerFrame: round(Math.min(...chunks)), maxMsPerFrame: round(Math.max(...chunks)), chunksMsPerFrame: chunks.map(round),
            };
            notes.push(`${name} (frames ${target} to ${target + PROTOSTAR_PHASE_CHUNK_FRAMES * chunks.length}): ${median.toFixed(3)} ms/frame`);
        }
        const metrics = { valid: !software, renderer: context.rendererName, particles: simulation.activeCount, ...windows };
        return software
            ? { status: 'skip', metrics, details: `INVALID: software renderer, timings are meaningless; ${notes.join('; ')}` }
            : { status: 'pass', metrics, details: `${simulation.activeCount} particles: ${notes.join('; ')}` };
    },
}));

export const protostarHitchScenarios: Scenario[] = PROTOSTAR_HITCH_COUNTS.map((count): Scenario => ({
    id: `perf.protostarHitch.${label(count)}`,
    title: `Performance: the protostar's frame times over its periodic readings at ${count.toLocaleString('en-US')} particles (hitches)`,
    tags: ['perf', 'slow', 'protostar'],
    async run(context): Promise<ScenarioOutcome> {
        const { simulation, software, sync } = context;
        if (software) return { status: 'skip', metrics: { valid: false }, details: 'INVALID: software renderer, timings are meaningless.' };
        await restart(context, { count });
        const times: number[] = [];
        let last = performance.now();
        for (let frame = 1; frame <= PROTOSTAR_HITCH_WARMUP_FRAMES + PROTOSTAR_HITCH_FRAMES; frame++) {
            simulation.step();
            simulation.endFrame();
            await sync.wait(simulation.positionTexture);
            const now = performance.now();
            if (frame > PROTOSTAR_HITCH_WARMUP_FRAMES) times.push(now - last);
            last = now;
        }
        const median = quantile(times, 0.5);
        const worst = Math.max(...times);
        return {
            status: simulation.activeCount === count ? 'pass' : 'fail',
            metrics: {
                valid: true, renderer: context.rendererName, particles: simulation.activeCount, warmupFrames: PROTOSTAR_HITCH_WARMUP_FRAMES,
                frames: PROTOSTAR_HITCH_FRAMES, all: describe(times), worstExcessOverMedianMs: round(worst - median),
            },
            details: `${simulation.activeCount} particles, ${PROTOSTAR_HITCH_FRAMES} frames: median ${median.toFixed(2)} ms, p95 ${quantile(times, 0.95).toFixed(2)} ms, `
                + `p99 ${quantile(times, 0.99).toFixed(2)} ms, worst ${worst.toFixed(2)} ms (${(worst - median).toFixed(2)} ms over the median)`,
        };
    },
}));

export const perfProtostarScenarios: Scenario[] = [...protostarPhaseScenarios, ...protostarHitchScenarios];
