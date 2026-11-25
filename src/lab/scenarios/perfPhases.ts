// The sticky dust's cost in two phases of the default cloud, each a window of frames after a restart: before the collapse
// (the donut barely changed: the same load in every build) and after the first supernova (clumps forming again). The performance
// probe (perf.ts) times whatever frames follow its warm-up, which lasts 1.5 s of wall time, hundreds of frames at these speeds, so its window is
// late and depends on the build: a less crushed clump is cheaper to deposit and to draw, a second supernova costs a read-back.

import { PERF_PHASE_CHUNK_FRAMES, PERF_PHASE_CHUNKS, PERF_PHASE_COUNTS, PERF_PHASE_REPS, PERF_PHASES } from '../config';
import { restart } from '../driver';
import { quantile, significant } from '../numbers';
import type { Scenario } from '../types';
import { timeChunks } from './perf';

const label = (count: number): string => count >= 1e6 ? `${count / 1e6}m` : `${count / 1e3}k`;

/** One scenario per phase and count: the median of the chunks of the phase's window, over several restarts. */
export const perfPhaseScenarios: Scenario[] = PERF_PHASES.flatMap(({ name, warmupFrames }) => PERF_PHASE_COUNTS.map((count): Scenario => ({
    id: `perf.dust${name}.${label(count)}`,
    title: `Performance: sticky dust at ${count.toLocaleString('en-US')} particles, frames ${warmupFrames} to ${warmupFrames + PERF_PHASE_CHUNK_FRAMES * PERF_PHASE_CHUNKS} after a restart (ms/frame, simulation only)`,
    tags: ['perf', 'slow', 'stickyDust'],
    async run(context) {
        const { simulation, software } = context;
        const simulate = (): void => { simulation.step(); simulation.endFrame(); };
        const chunks: number[] = [];
        const reps = software ? 1 : PERF_PHASE_REPS;
        for (let rep = 0; rep < reps; rep++) {
            await restart(context, { algorithm: 'stickyDust', count });
            await timeChunks(context, simulate, warmupFrames, 1);
            chunks.push(...await timeChunks(context, simulate, PERF_PHASE_CHUNK_FRAMES, software ? 1 : PERF_PHASE_CHUNKS));
        }
        const median = quantile(chunks, 0.5);
        const metrics = {
            valid: !software, renderer: context.rendererName, particles: simulation.activeCount, restarts: reps,
            warmupFrames, chunkFrames: PERF_PHASE_CHUNK_FRAMES, chunksPerRestart: PERF_PHASE_CHUNKS,
            simulationMsPerFrame: significant(median, 4), minMsPerFrame: significant(Math.min(...chunks), 4),
            maxMsPerFrame: significant(Math.max(...chunks), 4), chunksMsPerFrame: chunks.map(v => significant(v, 4)),
        };
        return software
            ? { status: 'skip', metrics, details: `INVALID: software renderer, timings are meaningless; ${median.toFixed(2)} ms/frame` }
            : {
                status: 'pass', metrics,
                details: `${simulation.activeCount} particles, frames ${warmupFrames} to ${warmupFrames + PERF_PHASE_CHUNK_FRAMES * PERF_PHASE_CHUNKS}: ${median.toFixed(3)} ms/frame `
                    + `(median of ${chunks.length} chunks, range ${Math.min(...chunks).toFixed(3)} to ${Math.max(...chunks).toFixed(3)})`,
            };
    },
})));
