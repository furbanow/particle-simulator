// Gate P8 of the plan (proposal B3, one pass per particle; docs/spikes/b3-single-pass.md):
//  - cost.protostar.passes: the time of each pass of a protostar substep (the grid passes, then the velocity, position and acceleration
//    passes), each rendered alone again and again on a frozen state of the default cloud, early and late in its life, with the TSC deposit
//    and the collisions off and on: what share of a substep the three particle passes are, so what a single pass could save at most;
//  - spike.b3.mrt: whether a TEX_SIZE^2 target of three unblended float (and half float) attachments works in ping-pong on this device,
//    what a three-attachment write costs against a one-attachment one, and how many samplers the merged pass would need against the limit.

import * as THREE from 'three';
import { TEX_SIZE } from '../../config';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import { PROTOSTAR_GRID_PASSES, type ProtostarGridPassName } from '../../simulation/protostar/grids';
import {
    MRT_SPIKE_REPEATS, MRT_SPIKE_STEPS, PASS_COST_COUNTS, PASS_COST_FLAGS, PASS_COST_FRAME_CHUNK, PASS_COST_FRAME_CHUNKS, PASS_COST_REPEATS,
    PASS_COST_ROUNDS, PASS_COST_WINDOWS,
} from '../config';
import { protostarModel, restart } from '../driver';
import { quantile, significant } from '../numbers';
import { readAttachment } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';
import { timeChunks } from './perf';

const round = (v: number): number => significant(v, 4);
const label = (count: number): string => count >= 1e6 ? `${count / 1e6}m` : `${count / 1e3}k`;

/** The particle passes of the protostar, by the name GpuPipeline.debugRenderParticlePass() takes. */
const PARTICLE_PASSES = ['velocity', 'position', 'textureAccel'] as const;
type ParticlePassName = (typeof PARTICLE_PASSES)[number];
/** The same passes drawn over the rows of the active particles only (a scissor), for the comparison with B3. */
const ROWS_PASSES = ['velocity@rows', 'position@rows', 'textureAccel@rows'] as const;
type PassName = ProtostarGridPassName | ParticlePassName | (typeof ROWS_PASSES)[number];

/** ms of `repeats` calls of `render` (each returns the texture it wrote) up to the GPU's end, the synchronization included. */
async function timeRenders(context: LabContext, render: () => THREE.Texture, repeats: number): Promise<number> {
    const start = performance.now();
    let texture = context.simulation.positionTexture;
    for (let i = 0; i < repeats; i++) texture = render();
    await context.sync.wait(texture);
    return performance.now() - start;
}

/** ms per render of each pass on the state as it is (medians over the rounds), the synchronization's own time taken off. */
async function passTimes(context: LabContext, passes: readonly PassName[]): Promise<Record<PassName, number>> {
    const pipeline = context.simulation.debugPipeline;
    const grids = protostarModel(context).debugGrids;
    const rows = Math.ceil(context.simulation.activeCount / TEX_SIZE);
    const render = (name: PassName): THREE.Texture => {
        if ((PARTICLE_PASSES as readonly string[]).includes(name)) return pipeline.debugRenderParticlePass(name).texture;
        if ((ROWS_PASSES as readonly string[]).includes(name)) return pipeline.debugRenderParticlePass(name.replace('@rows', ''), rows).texture;
        return grids.debugRenderPass(name as ProtostarGridPassName).texture;
    };
    const samples = new Map<PassName, number[]>(passes.map(name => [name, []]));
    // One untimed round: the materials are compiled and the clocks settle.
    for (const name of passes) await timeRenders(context, () => render(name), PASS_COST_REPEATS);
    for (let r = 0; r < PASS_COST_ROUNDS; r++) {
        const sync = await timeRenders(context, () => context.simulation.positionTexture, 0);
        for (const name of passes) {
            const ms = await timeRenders(context, () => render(name), PASS_COST_REPEATS);
            samples.get(name)?.push(Math.max(0, ms - sync) / PASS_COST_REPEATS);
        }
    }
    const out = {} as Record<PassName, number>;
    for (const [name, values] of samples) out[name] = quantile(values, 0.5);
    return out;
}

/** The passes of one window at each flag setting, then the flags back off. */
async function windowCost(context: LabContext): Promise<Record<string, JsonValue>> {
    const { simulation } = context;
    const model = protostarModel(context);
    const out: Record<string, JsonValue> = {};
    for (const flags of PASS_COST_FLAGS) {
        simulation.setParam(PROTOSTAR_PARAM.tscDeposit, flags.tscDeposit);
        simulation.setParam(PROTOSTAR_PARAM.collisions, flags.collisions);
        simulation.setParam(PROTOSTAR_PARAM.adaptiveThickness, flags.adaptiveThickness);
        model.beforeSubstep(0);                     // the grids of this setting (and the collision grid) from the frozen particles
        const grid = PROTOSTAR_GRID_PASSES.filter(name => name !== 'collision' || flags.collisions);
        const times = await passTimes(context, [...grid, ...PARTICLE_PASSES, ...ROWS_PASSES]);
        const gridSum = grid.reduce((sum, name) => sum + times[name], 0);
        const particleSum = PARTICLE_PASSES.reduce((sum, name) => sum + times[name], 0);
        const substep = gridSum + particleSum;
        // B3's bound: the merged pass costs at least what the velocity pass does (it does all of its work and more), so at most the
        // position and the acceleration passes are saved.
        const saving = times.position + times.textureAccel;
        const rowsSaving = particleSum - ROWS_PASSES.reduce((sum, name) => sum + times[name], 0);
        out[flags.name] = {
            msPerPass: Object.fromEntries(Object.entries(times).map(([name, ms]) => [name, round(ms)])),
            gridPassesMs: round(gridSum), particlePassesMs: round(particleSum), substepMs: round(substep),
            particleShare: round(particleSum / substep), b3SavingBoundMs: round(saving), b3SavingBoundShare: round(saving / substep),
            activeRowsSavingMs: round(rowsSaving), activeRowsSavingShare: round(rowsSaving / substep),
        };
    }
    simulation.setParam(PROTOSTAR_PARAM.tscDeposit, false);
    simulation.setParam(PROTOSTAR_PARAM.collisions, false);
    simulation.setParam(PROTOSTAR_PARAM.adaptiveThickness, false);
    model.beforeSubstep(0);
    return out;
}

const passCost: Scenario = {
    id: 'cost.protostar.passes',
    title: 'Cost of each pass of a protostar substep on a frozen default cloud (400 000 and 1 000 000 particles, early and late, flags off and on): the bound of B3',
    tags: ['cost', 'slow', 'protostar', 'single-pass'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) {
            return { status: 'skip', metrics: { valid: false }, details: `INVALID: software renderer (${context.rendererName}), timings are meaningless.` };
        }
        const { simulation } = context;
        const simulate = (): void => { simulation.step(); simulation.endFrame(); };
        const cases: Record<string, JsonValue>[] = [];
        const notes: string[] = [];
        for (const count of PASS_COST_COUNTS) {
            await restart(context, { count });
            let done = 0;
            for (const window of PASS_COST_WINDOWS) {
                while (done < window.frames) { await timeChunks(context, simulate, PASS_COST_FRAME_CHUNK, 1); done += PASS_COST_FRAME_CHUNK; }
                const frames = await timeChunks(context, simulate, PASS_COST_FRAME_CHUNK, PASS_COST_FRAME_CHUNKS);
                done += PASS_COST_FRAME_CHUNK * PASS_COST_FRAME_CHUNKS;
                const settings = await windowCost(context);
                const substeps = Math.max(1, Math.ceil(simulation.timeScale - 1e-6));
                cases.push({
                    particles: simulation.activeCount, window: window.name, frame: done, substepsPerFrame: substeps,
                    simulationMsPerFrameFlagsOff: round(quantile(frames, 0.5)), settings,
                });
                const off = settings.off as Record<string, number>;
                const on = settings['tsc+collisions'] as Record<string, number>;
                notes.push(`${label(count)} ${window.name}: substep ${off.substepMs} ms, particle passes ${(100 * off.particleShare).toFixed(0)} %, `
                    + `B3 bound ${off.b3SavingBoundMs} ms (${(100 * off.b3SavingBoundShare).toFixed(1)} %), active rows only `
                    + `${off.activeRowsSavingMs} ms; flags on ${on.substepMs} ms, `
                    + `bound ${on.b3SavingBoundMs} ms (${(100 * on.b3SavingBoundShare).toFixed(1)} %)`);
            }
        }
        return {
            status: 'pass',
            metrics: { valid: true, renderer: context.rendererName, repeats: PASS_COST_REPEATS, rounds: PASS_COST_ROUNDS, cases },
            details: notes.join('; '),
        };
    },
};

// ---- spike.b3.mrt ----

const MRT_INIT = `
layout(location = 1) out highp vec4 out1;
layout(location = 2) out highp vec4 out2;
void main() {
    vec2 c = floor(gl_FragCoord.xy);
    float base = mod(c.y * float(SIZE) + c.x, 1000.0);
    gl_FragColor = vec4(base, 0.0, -base, 1.0);
    out1 = vec4(base, 1.0, -base, 1.0);
    out2 = vec4(base, 2.0, -base, 1.0);
}
`;

/** Attachment k takes attachment (k + 1) % 3 of the other target, plus 1 in x: after s steps it holds (base + s, (k + s) % 3, -base, 1). */
const MRT_STEP = `
uniform sampler2D in0;
uniform sampler2D in1;
uniform sampler2D in2;
layout(location = 1) out highp vec4 out1;
layout(location = 2) out highp vec4 out2;
void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    vec4 one = vec4(1.0, 0.0, 0.0, 0.0);
    gl_FragColor = texelFetch(in1, c, 0) + one;
    out1 = texelFetch(in2, c, 0) + one;
    out2 = texelFetch(in0, c, 0) + one;
}
`;

/** The same reads and arithmetic, one attachment written: the cost of the two extra outputs. */
const SINGLE_STEP = `
uniform sampler2D in0;
uniform sampler2D in1;
uniform sampler2D in2;
void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    gl_FragColor = texelFetch(in0, c, 0) + texelFetch(in1, c, 0) + texelFetch(in2, c, 0);
}
`;

/** A full-screen pass that reads nothing: the fixed cost of a particle pass over the whole state texture. */
const EMPTY_PASS = `
void main() { gl_FragColor = vec4(1.0); }
`;

const SAMPLER_TYPES = (gl: WebGL2RenderingContext): ReadonlySet<number> => new Set([
    gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D,
]);

/** The active sampler uniforms of a compiled material's program (empty if it was never drawn). */
function activeSamplers(context: LabContext, material: THREE.ShaderMaterial): string[] {
    const gl = context.renderer.getContext() as WebGL2RenderingContext;
    const program = (context.renderer.properties.get(material) as { currentProgram?: { program: WebGLProgram } }).currentProgram?.program;
    if (!program) return [];
    const types = SAMPLER_TYPES(gl);
    const names: string[] = [];
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        if (info && types.has(info.type)) names.push(info.name);
    }
    return names;
}

/** Steps a three-attachment ping-pong of `type` and checks every texel of the three attachments of the result. */
async function pingPong(context: LabContext, type: THREE.TextureDataType): Promise<Record<string, JsonValue>> {
    const { renderer } = context;
    const targets = [gridTarget(TEX_SIZE, type, 3), gridTarget(TEX_SIZE, type, 3)] as const;
    const defines = `#define SIZE ${TEX_SIZE}\n`;
    const init = new GridPass(defines + MRT_INIT, {}, targets[0]);
    const inputs = { in0: { value: null as THREE.Texture | null }, in1: { value: null as THREE.Texture | null }, in2: { value: null as THREE.Texture | null } };
    const steps = [new GridPass(MRT_STEP, inputs, targets[1]), new GridPass(MRT_STEP, inputs, targets[0])];
    const errors = [0, 0, 0];
    let maxError = 0;
    try {
        init.render(renderer);
        let current = 0;
        for (let s = 0; s < MRT_SPIKE_STEPS; s++) {
            const [a, b, c] = targets[current].textures;
            inputs.in0.value = a; inputs.in1.value = b; inputs.in2.value = c;
            steps[current].render(renderer);
            current = 1 - current;
        }
        renderer.setRenderTarget(null);
        for (let k = 0; k < 3; k++) {
            const data = await readAttachment(renderer, targets[current], k);
            for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
                const base = i % 1000;
                const expected = [base + MRT_SPIKE_STEPS, (k + MRT_SPIKE_STEPS) % 3, -base, 1];
                for (let ch = 0; ch < 4; ch++) {
                    const e = Math.abs(data[i * 4 + ch] - expected[ch]);
                    if (e > 0) errors[k]++;
                    maxError = Math.max(maxError, e);
                }
            }
        }
    } finally {
        init.material.dispose();
        for (const step of steps) step.material.dispose();
        for (const target of targets) target.dispose();
    }
    return { wrongValuesPerAttachment: errors, maxError, exact: errors.every(e => e === 0) };
}

/** ms per render of a TEX_SIZE^2 float pass: empty (one output, no read), three reads and one output, three reads and three outputs. */
async function writeCosts(context: LabContext): Promise<Record<string, JsonValue>> {
    const { renderer } = context;
    const sources = gridTarget(TEX_SIZE, THREE.FloatType, 3);
    const [a, b, c] = sources.textures;
    const inputs = { in0: { value: a }, in1: { value: b }, in2: { value: c } };
    const passes = {
        empty: new GridPass(EMPTY_PASS, {}, gridTarget(TEX_SIZE, THREE.FloatType)),
        threeReadsOneOutput: new GridPass(SINGLE_STEP, inputs, gridTarget(TEX_SIZE, THREE.FloatType)),
        threeReadsThreeOutputs: new GridPass(MRT_STEP, inputs, gridTarget(TEX_SIZE, THREE.FloatType, 3)),
    };
    const samples: Record<string, number[]> = { empty: [], threeReadsOneOutput: [], threeReadsThreeOutputs: [] };
    try {
        for (let r = 0; r <= PASS_COST_ROUNDS; r++) {
            const sync = await timeRenders(context, () => context.simulation.positionTexture, 0);
            for (const [name, pass] of Object.entries(passes)) {
                const ms = await timeRenders(context, () => { pass.render(renderer); return pass.target.texture; }, MRT_SPIKE_REPEATS);
                if (r > 0) samples[name].push(Math.max(0, ms - sync) / MRT_SPIKE_REPEATS);     // round 0 compiles and warms up
            }
        }
    } finally {
        renderer.setRenderTarget(null);
        for (const pass of Object.values(passes)) pass.dispose();
        sources.dispose();
    }
    return Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, round(quantile(values, 0.5))]));
}

const mrtSpike: Scenario = {
    id: 'spike.b3.mrt',
    title: 'Feasibility of B3: three unblended attachments of TEX_SIZE^2 in ping-pong (float and half float), their write cost, the sampler budget',
    tags: ['spike', 'protostar', 'single-pass'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation } = context;
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const limits = {
            maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
            maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number,
            maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS) as number,
            maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number,
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        };
        const extensions = Object.fromEntries(['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend']
            .map(name => [name, renderer.extensions.has(name)]));
        // The samplers of the three particle passes as compiled (one frame of the protostar with the collisions and TSC on draws them all).
        await restart(context, { count: 10_000, params: { collisions: true, tscDeposit: true } });
        simulation.step();
        simulation.endFrame();
        const pipeline = simulation.debugPipeline;
        const perPass = Object.fromEntries(PARTICLE_PASSES.map(name => [name, activeSamplers(context, pipeline.debugParticleMaterial(name))]));
        const union = [...new Set(Object.values(perPass).flat())].sort();
        const float = await pingPong(context, THREE.FloatType);
        const half = await pingPong(context, THREE.HalfFloatType);
        const costs = await writeCosts(context);
        const fits = union.length <= limits.maxTextureImageUnits && limits.maxDrawBuffers >= 3;
        const pass = fits && float.exact === true && half.exact === true;
        return {
            status: pass ? 'pass' : 'fail',
            metrics: {
                renderer: context.rendererName, texSize: TEX_SIZE, limits, extensions, samplersPerPass: perPass, mergedSamplers: union,
                mergedSamplerCount: union.length, floatPingPong: float, halfFloatPingPong: half, msPerFullScreenPass: costs,
            },
            details: `float ping-pong ${float.exact ? 'exact' : 'WRONG'}, half float ${half.exact ? 'exact' : 'WRONG'}; merged pass `
                + `${union.length} samplers of ${limits.maxTextureImageUnits}, ${limits.maxDrawBuffers} draw buffers; ${TEX_SIZE}^2 pass: empty `
                + `${String(costs.empty)} ms, 3 reads 1 output ${String(costs.threeReadsOneOutput)} ms, 3 reads 3 outputs ${String(costs.threeReadsThreeOutputs)} ms`,
        };
    },
};

export const singlePassScenarios: readonly Scenario[] = [passCost, mrtSpike];
