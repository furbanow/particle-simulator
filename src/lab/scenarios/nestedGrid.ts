// The gate of C2 (the nested grid, docs/spikes/c2-nested-grid.md), on the real GPU:
//  - spike.c2.nested: where the densest cell of the default cloud goes (the reduction's peak, read every frame of the stats: how far it
//    moves between two readings, how often it jumps), and what a second chain NESTED_RATIO times finer centred on it costs (each of its
//    passes rendered alone, against the main grid's) and holds (its share of the mass).

import * as THREE from 'three';
import { PROTOSTAR_GRID_RES, PROTOSTAR_STATS_INTERVAL } from '../../config';
import { GRID_CHAIN_PASSES, type GridChain, type GridChainPassName } from '../../simulation/protostar/gridChain';
import { NESTED_RATIO, NESTED_SPIKE_COUNTS, NESTED_SPIKE_LAST_FRAME, NESTED_SPIKE_WINDOWS, PASS_COST_REPEATS, PASS_COST_ROUNDS } from '../config';
import { protostarModel, restart, runFrames } from '../driver';
import { quantile, significant, sumChannel } from '../numbers';
import { readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const round = (v: number): number => significant(v, 4);

/** ms per render of `render` (median over the rounds, the synchronization taken off), with the clear alpha at 0 as the deposits need. */
async function renderTime(context: LabContext, render: () => THREE.WebGLRenderTarget): Promise<number> {
    const { renderer } = context;
    const once = async (repeats: number): Promise<number> => {
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);
        const start = performance.now();
        let target: THREE.WebGLRenderTarget | null = null;
        for (let i = 0; i < repeats; i++) target = render();
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(null);
        await context.sync.wait(target?.texture ?? context.simulation.positionTexture);
        return performance.now() - start;
    };
    await once(PASS_COST_REPEATS);
    const samples: number[] = [];
    for (let r = 0; r < PASS_COST_ROUNDS; r++) {
        const sync = await once(0);
        samples.push(Math.max(0, (await once(PASS_COST_REPEATS)) - sync) / PASS_COST_REPEATS);
    }
    return quantile(samples, 0.5);
}

const nested: Scenario = {
    id: 'spike.c2.nested',
    title: 'Gate of C2: the track of the densest cell of the default cloud, and the cost and the mass of a nested chain 8 times finer centred on it',
    tags: ['spike', 'protostar', 'nested-grid', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: { valid: false }, details: 'software renderer: timings are meaningless' };
        const { renderer } = context;
        const cases: Record<string, JsonValue>[] = [];
        const notes: string[] = [];
        for (const count of NESTED_SPIKE_COUNTS) {
            await restart(context, { count });
            const model = protostarModel(context);
            const cell = model.debugGrids.common.gridCell.value;
            const track: { frame: number; x: number; y: number }[] = [];
            const windows: Record<string, JsonValue>[] = [];
            let frame = 0;
            for (const window of [...NESTED_SPIKE_WINDOWS, { name: 'end', frames: NESTED_SPIKE_LAST_FRAME }]) {
                await runFrames(context, window.frames - frame, {
                    endFrame: true,
                    async onFrame() {
                        frame++;
                        if (frame % PROTOSTAR_STATS_INTERVAL !== 0) return;
                        await model.debugReading;
                        const peak = model.peakPosition;
                        if (peak) track.push({ frame, x: peak.x, y: peak.y });
                    },
                });
                if (window.name === 'end') break;
                const peak = model.peakPosition ?? { x: 0, y: 0 };
                const fineCell = cell / NESTED_RATIO;
                const origin = new THREE.Vector2(peak.x - fineCell * PROTOSTAR_GRID_RES / 2, peak.y - fineCell * PROTOSTAR_GRID_RES / 2);
                model.beforeSubstep(0);
                const grids = model.debugGrids;
                const chain: GridChain = grids.debugBuildNestedChain(NESTED_RATIO, origin);
                try {
                    renderer.setClearAlpha(0);
                    chain.render();
                    renderer.setClearAlpha(1);
                    const fineMass = sumChannel(await readTarget(renderer, chain.targets.moments), 0);
                    const mainMass = sumChannel(await readTarget(renderer, grids.targets.moments), 0);
                    const main: Record<string, number> = {}, fine: Record<string, number> = {};
                    for (const name of ['moments', 'gravity'] as const) main[name] = round(await renderTime(context, () => grids.debugRenderPass(name)));
                    for (const name of GRID_CHAIN_PASSES) fine[name] = round(await renderTime(context, () => chain.debugRenderPass(name as GridChainPassName)));
                    const fineTotal = Object.values(fine).reduce((a, b) => a + b, 0);
                    windows.push({ window: window.name, frame, peakPx: [round(peak.x), round(peak.y)], massShare: round(fineMass / mainMass),
                        mainMs: main, fineMs: fine, fineChainMs: round(fineTotal) });
                    notes.push(`${count / 1000}k ${window.name}: fine chain ${fineTotal.toFixed(3)} ms (moments ${fine.moments} vs main ${main.moments}, `
                        + `gravity ${fine.gravity} vs ${main.gravity}), ${(100 * fineMass / mainMass).toFixed(0)} % of the mass inside`);
                } finally {
                    chain.dispose();
                    renderer.setRenderTarget(null);
                }
                model.beforeSubstep(0);
            }
            // The track: the distance (in main cells) between two readings, and how often it exceeds a quarter of the nested box.
            const steps = track.slice(1).map((p, i) => Math.hypot(p.x - track[i].x, p.y - track[i].y) / cell);
            const quarterBox = PROTOSTAR_GRID_RES / NESTED_RATIO / 4;
            cases.push({
                particles: count, windows, readings: track.length,
                stepCells: { median: round(quantile(steps, 0.5)), p90: round(quantile(steps, 0.9)), max: round(Math.max(...steps)) },
                jumpsBeyondQuarterBox: steps.filter(s => s > quarterBox).length,
                track: track.map(p => [p.frame, round(p.x / cell), round(p.y / cell)]),
            });
            notes.push(`${count / 1000}k track: median step ${quantile(steps, 0.5).toFixed(2)} cells, max ${Math.max(...steps).toFixed(1)}, `
                + `${steps.filter(s => s > quarterBox).length} jumps beyond ${quarterBox} cells`);
        }
        return { status: 'pass', metrics: { ratio: NESTED_RATIO, cases }, details: notes.join('; ') };
    },
};

export const nestedGridScenarios: readonly Scenario[] = [nested];
