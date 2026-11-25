// The frame hitches of the sticky dust's periodic concentration read (docs/spikes/b4-gpu-concentration.md): the default cloud with no supernova,
// so that the read repeats every CLUSTER_CHECK_INTERVAL frames, each frame followed by a wait for the GPU, the time between the starts of two
// frames recorded (the callbacks of an asynchronous read-back run in that time too). It reads only the application's public surface, so it also
// runs on the build before the GPU reduction, which is how the two are compared.

import { CLUSTER_CHECK_INTERVAL } from '../../config';
import { STICKY_DUST_PARAM } from '../../simulation/stickyDust/declaration';
import { HITCH_COUNTS, HITCH_FRAMES, HITCH_WARMUP_FRAMES, HITCH_WINDOW_FRAMES } from '../config';
import { restart, stickyDustModel } from '../driver';
import { mean, quantile, significant } from '../numbers';
import type { JsonValue, Scenario } from '../types';

const round = (v: number): number => significant(v, 4);
const label = (count: number): string => count >= 1e6 ? `${count / 1e6}m` : `${count / 1e3}k`;

const describe = (times: readonly number[]): Record<string, JsonValue> => times.length === 0 ? { n: 0 } : {
    n: times.length, meanMs: round(mean(times)), medianMs: round(quantile(times, 0.5)), p95Ms: round(quantile(times, 0.95)),
    p99Ms: round(quantile(times, 0.99)), maxMs: round(Math.max(...times)),
};

export const dustHitchScenarios: Scenario[] = HITCH_COUNTS.map((count): Scenario => ({
    id: `perf.dustHitch.${label(count)}`,
    title: `Performance: the sticky dust's frame times over its periodic concentration read at ${count.toLocaleString('en-US')} particles (hitches)`,
    tags: ['perf', 'slow', 'stickyDust'],
    async run(context) {
        const { simulation, software, sync } = context;
        if (software) return { status: 'skip', metrics: { valid: false }, details: 'INVALID: software renderer, timings are meaningless.' };
        await restart(context, { algorithm: 'stickyDust', count });
        // Nothing triggers a supernova: the read goes on every CLUSTER_CHECK_INTERVAL frames.
        stickyDustModel(context).setParam(STICKY_DUST_PARAM.supernovaThreshold, 1000);
        const times: number[] = [];
        let last = performance.now();
        for (let frame = 1; frame <= HITCH_WARMUP_FRAMES + HITCH_FRAMES; frame++) {
            simulation.step();
            simulation.endFrame();
            await sync.wait(simulation.positionTexture);
            const now = performance.now();
            if (frame > HITCH_WARMUP_FRAMES) times.push(now - last);
            last = now;
        }
        // Frame f (1-based after the restart) requests a read when f is a multiple of the interval; the answer lands within a few frames.
        const inWindow = (k: number): boolean => (HITCH_WARMUP_FRAMES + k + 1) % CLUSTER_CHECK_INTERVAL < HITCH_WINDOW_FRAMES;
        const window = times.filter((_, k) => inWindow(k));
        const quiet = times.filter((_, k) => !inWindow(k));
        const quietMedian = quantile(quiet, 0.5);
        const metrics: Record<string, JsonValue> = {
            valid: true, renderer: context.rendererName, particles: simulation.activeCount, warmupFrames: HITCH_WARMUP_FRAMES, frames: HITCH_FRAMES,
            all: describe(times), readbackFrames: describe(window), quietFrames: describe(quiet),
            worstExcessOverQuietMedianMs: round(Math.max(...times) - quietMedian),
        };
        return {
            status: simulation.activeCount === count ? 'pass' : 'fail', metrics,
            details: `${simulation.activeCount} particles, ${HITCH_FRAMES} frames: median ${quantile(times, 0.5).toFixed(2)} ms, p99 ${quantile(times, 0.99).toFixed(2)} ms, `
                + `worst ${Math.max(...times).toFixed(2)} ms (${(Math.max(...times) - quietMedian).toFixed(2)} ms over the quiet frames' median); `
                + `read-back frames: mean ${mean(window).toFixed(2)}, worst ${Math.max(...window).toFixed(2)} ms; quiet frames: mean ${mean(quiet).toFixed(2)}, worst ${Math.max(...quiet).toFixed(2)} ms`,
        };
    },
}));
