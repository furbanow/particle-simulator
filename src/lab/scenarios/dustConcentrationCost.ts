// What one GPU search of the densest disk costs (docs/spikes/b4-gpu-concentration.md): ten searches queued back to back on the same particles,
// the GPU waited for at the end, so the figure is the GPU time of a search and not the latency of its read-back. Three clouds per count: spread
// uniformly (nothing blends into the same texel), the default cloud after its collapse (a clump of a few cells holds nearly all the particles), and a
// clump of 3 px (the worst case for the blending of the coarse grid).

import {
    CONCENTRATION_COST_COUNTS, CONCENTRATION_COST_FRAMES, CONCENTRATION_COST_REPEATS, LAB_AREA, SUPERNOVA_SEED,
} from '../config';
import { syntheticCloud } from '../concentrationParity';
import { restart, runFrames, stickyDustModel } from '../driver';
import { quantile, significant } from '../numbers';
import { mulberry32 } from '../random';
import { readPositions } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const label = (count: number): string => count >= 1e6 ? `${count / 1e6}m` : `${count / 1e3}k`;

/** Milliseconds a search takes on the particles the simulation holds now: the median of CONCENTRATION_COST_REPEATS batches of back-to-back searches. */
async function searchMs(context: LabContext): Promise<number> {
    const model = stickyDustModel(context);
    await model.debugMeasure(true);
    const batch = 10;
    const times: number[] = [];
    for (let r = 0; r < CONCENTRATION_COST_REPEATS; r++) {
        const start = performance.now();
        await Promise.all(Array.from({ length: batch }, () => model.debugMeasure(true)));
        times.push((performance.now() - start) / batch);
    }
    return quantile(times, 0.5);
}

export const dustConcentrationCostScenarios: Scenario[] = CONCENTRATION_COST_COUNTS.map((count): Scenario => ({
    id: `perf.dustConcentration.${label(count)}`,
    title: `Performance: the sticky dust's GPU search of the densest disk at ${count.toLocaleString('en-US')} particles (ms per search)`,
    tags: ['perf', 'slow', 'stickyDust'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: { valid: false }, details: 'INVALID: software renderer, timings are meaningless.' };
        if (!context.floatBlend) return { status: 'skip', metrics: {}, details: 'No EXT_float_blend: the application reads the positions back.' };
        const { renderer, simulation } = context;
        await restart(context, { algorithm: 'stickyDust', count, seed: SUPERNOVA_SEED });
        const initial = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
        const species = Uint8Array.from({ length: count }, (_, i) => Math.round(initial[i * 4 + 2]));
        const velocities = new Float32Array(count * 4);
        const metrics: Record<string, JsonValue> = { valid: true, renderer: context.rendererName, particles: count };
        const lines: string[] = [];
        for (const kind of ['uniform', 'compact'] as const) {
            simulation.debugPipeline.debugSetState(syntheticCloud(kind, count, species, mulberry32(SUPERNOVA_SEED), LAB_AREA.width, LAB_AREA.height), velocities);
            const ms = await searchMs(context);
            metrics[kind] = significant(ms, 3);
            lines.push(`${kind} ${ms.toFixed(2)} ms`);
        }
        await restart(context, { algorithm: 'stickyDust', count, seed: SUPERNOVA_SEED });
        await runFrames(context, CONCENTRATION_COST_FRAMES);
        const collapsed = await searchMs(context);
        metrics.collapsed = significant(collapsed, 3);
        lines.push(`default cloud after ${CONCENTRATION_COST_FRAMES} frames ${collapsed.toFixed(2)} ms`);
        return { status: 'pass', metrics, details: `${count} particles, per search: ${lines.join(', ')}` };
    },
}));
