// Entry of the lab page (lab.html, served by `make dev` only: vite never builds it). It runs the
// registry's scenarios on the real GPU simulation and publishes the results as a table, as JSON in
// <pre id="lab-json"> and as window.__labResults, then sets window.__labDone.
//
// Query string: ?scenarios=a,b (ids, groups or tags, see select.ts), ?autorun=0 (wait for the
// button), ?baselineFrames=, ?baselineParticles=, ?perfFrames=, ?noiseReadings=, ?noiseBudgetSeconds=, ?cloudSeeds=, ?cloudVariants=, ?perfVariant= (quick experiments).

import * as THREE from 'three';
import { createRenderer } from '../gl/createRenderer';
import { Simulation } from '../simulation/Simulation';
import {
    BASELINE_FRAMES, BASELINE_FRAMES_SOFTWARE, BASELINE_PARTICLES, BASELINE_PARTICLES_SOFTWARE, CLOUD_VARIANT_SEEDS, LAB_AREA, NOISE_CASE_BUDGET_SECONDS,
    NOISE_MAX_READINGS, PERF_FRAMES,
} from './config';
import { GpuSync } from './gpuSync';
import { SCENARIOS } from './registry';
import { appendRow, showJson } from './report';
import { runScenarios } from './runner';
import { isSoftwareRenderer, parseOptions, selectScenarios } from './select';
import type { LabContext, LabResults } from './types';

declare global {
    interface Window {
        /** The results, once the run is over. */
        __labResults?: LabResults;
        /** Set to true when the run is over (results or not). */
        __labDone?: boolean;
        /** Starts a run from the console: `await __lab.run('baseline,perf')`. */
        __lab?: { run(filter?: string): Promise<LabResults> };
    }
}

const byId = <T extends HTMLElement>(id: string): T => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`lab.html has no #${id}`);
    return found as T;
};

function unmaskedRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

const status = byId('lab-status');
const log = (message: string): void => { status.textContent = message; console.log(`[lab] ${message}`); };

function createContext(): LabContext {
    const renderer = createRenderer();
    if (!renderer) throw new Error('WebGL 2 with float render targets (EXT_color_buffer_float) is unavailable');
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setSize(LAB_AREA.width, LAB_AREA.height);
    byId('lab-canvas').appendChild(renderer.domElement);
    const simulation = new Simulation(renderer, 'protostar');
    simulation.resize(LAB_AREA.width, LAB_AREA.height);     // before any reset()
    const rendererName = unmaskedRenderer(renderer.getContext());
    const software = isSoftwareRenderer(rendererName);
    return {
        renderer, rendererName, software,
        floatBlend: renderer.extensions.has('EXT_float_blend'),
        simulation, sync: new GpuSync(renderer),
        options: parseOptions(location.search, {
            baselineParticles: software ? BASELINE_PARTICLES_SOFTWARE : BASELINE_PARTICLES,
            baselineFrames: software ? BASELINE_FRAMES_SOFTWARE : BASELINE_FRAMES,
            perfFrames: PERF_FRAMES,
            noiseReadings: NOISE_MAX_READINGS,
            noiseBudgetSeconds: NOISE_CASE_BUDGET_SECONDS,
            cloudSeeds: CLOUD_VARIANT_SEEDS,
            cloudVariants: '[]',
            perfVariant: '{}',
        }),
        log,
    };
}

async function main(): Promise<void> {
    window.__labDone = false;
    const query = new URLSearchParams(location.search);
    let context: LabContext;
    try {
        context = createContext();
    } catch (error) {
        log(`cannot start: ${error instanceof Error ? error.message : String(error)}`);
        window.__labDone = true;
        return;
    }
    byId('lab-renderer').textContent = `${context.rendererName}${context.software ? '  (software renderer: timings invalid)' : ''}`;

    const table = byId<HTMLTableElement>('lab-table').tBodies[0];
    let running = false;
    const run = async (filter: string | null): Promise<LabResults> => {
        if (running) throw new Error('a run is already in progress');
        running = true;
        window.__labDone = false;
        window.__labResults = undefined;
        table.replaceChildren();
        byId('lab-json').textContent = '';
        try {
            const scenarios = selectScenarios(SCENARIOS, filter);
            log(`running ${scenarios.length} scenario(s)`);
            const results = await runScenarios(context, scenarios, result => appendRow(table, result));
            window.__labResults = results;
            showJson(byId('lab-json'), results);
            const failed = results.scenarios.filter(s => s.status === 'fail').length;
            log(`done in ${(results.totalMs / 1000).toFixed(1)} s: ${results.scenarios.length - failed} ok, ${failed} failed`);
            return results;
        } finally {
            running = false;
            window.__labDone = true;
        }
    };
    window.__lab = { run: filter => run(filter ?? null) };

    const filterInput = byId<HTMLInputElement>('lab-filter');
    filterInput.value = query.get('scenarios') ?? '';
    byId('lab-run').addEventListener('click', () => { void run(filterInput.value || null); });
    byId('lab-list').textContent = SCENARIOS.map(s => `${s.id}  [${s.tags.join(', ')}]`).join('\n');
    if (query.get('autorun') !== '0') await run(filterInput.value || null);
    else log('ready');
}

main().catch(error => {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    window.__labDone = true;
});
