// The gate of C2 (the nested grid, docs/spikes/c2-nested-grid.md), on the real GPU:
//  - spike.c2.nested: where the densest cell of the default cloud goes (the reduction's peak, read every frame of the stats: how far it
//    moves between two readings, how often it jumps), and what a second chain NESTED_RATIO times finer centred on it costs (each of its
//    passes rendered alone, against the main grid's) and holds (its share of the mass).
//  - protostar.nested.point-mass: the force of a point mass across the box's boundary (the law, the anisotropy, the continuity).
//  - protostar.nested.conservation: energy and momentum of the conservative cloud over 100 orbits, the box fixed and moving.
//  - protostar.nested.cloud: the default cloud with the flag off and on at several ratios (the peak, its temperature, omega dt, Jeans).
//  - cost.protostar.nested: each pass of the nested grid alone, and the whole frame with the flag on and off.

import * as THREE from 'three';
import {
    PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, PROTOSTAR_NESTED_RATIO, PROTOSTAR_NESTED_SOFTENING_DIVISOR,
    PROTOSTAR_RESTITUTION as PROTOSTAR_RESTITUTION_APP, PROTOSTAR_STATS_INTERVAL, PROTOSTAR_T0_KELVIN, TOTAL_MASS,
} from '../../config';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import { GRID_CHAIN_PASSES, type GridChain, type GridChainPassName } from '../../simulation/protostar/gridChain';
import { forceNestedRatio, PROTOSTAR_GRID_PASSES } from '../../simulation/protostar/grids';
import { boxCells, boxOrigin } from '../../simulation/protostar/nestedBox';
import {
    CONSERVATIVE_OVERRIDES, ELASTIC_WALLS, NESTED_BLOB_OFFSET, NESTED_BLOB_PARTICLES, NESTED_CLOUD_FRAMES, NESTED_CLOUD_RATIOS,
    NESTED_CLOUD_DIVISORS, NESTED_CLOUD_READ_EVERY, NESTED_CONSERVATION_BUDGET_MS, NESTED_CONSERVATION_ORBITS, NESTED_CONSERVATION_PARTICLES, NESTED_COST_COUNTS,
    NESTED_COST_FRAME, NESTED_COST_FRAMES, NESTED_FORCE_TOLERANCE, NESTED_FRAGMENT_DENSITY, NESTED_JEANS_CELLS, NESTED_JUDGED_RADII,
    NESTED_MOMENTUM_EVERY, NESTED_MOVE_CELLS, NESTED_MOVE_FRAMES, NESTED_OUTSIDE_CELLS, NESTED_RATIO, NESTED_RING_ANGLES, NESTED_RING_RADII,
    NESTED_SPIKE_COUNTS, NESTED_SPIKE_LAST_FRAME, NESTED_SPIKE_WINDOWS, OMEGA_DT_LIMIT, PASS_COST_REPEATS, PASS_COST_ROUNDS,
} from '../config';
import { burnTemperature, probeCore } from '../core';
import { frameSeconds, protostarModel, rebuildPipeline, restart, runFrames } from '../driver';
import { mean, quantile, significant, sumChannel } from '../numbers';
import { readPositions, readTarget } from '../readback';
import { LAB_CELL, LAB_T0 } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';
import { driftRun, runMetrics, summary as driftSummary } from './energy';

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



const ACCEL = 'textureAccel';
const rms = (values: readonly number[]): number => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / Math.max(1, values.length));

// ---- protostar.nested.point-mass ----

type PointCase = 'off' | 'centred' | 'outside';

interface PointRun {
    /** Acceleration (ax, ay) of each probe, ring by ring then angle by angle. */
    accel: [number, number][];
    /** Whether each probe reads the fine level. */
    inside: boolean[];
    selfForce: number;
    /** The blob's mass in deposit units times gravityPerDeposit: a(r) = gm r / (r^2 + eps^2)^(3/2). */
    gm: number;
    softening: number;
}

async function pointRun(context: LabContext, which: PointCase, center: [number, number]): Promise<PointRun> {
    const { renderer, simulation } = context;
    const cell = LAB_CELL;
    const probes = NESTED_RING_RADII.length * NESTED_RING_ANGLES;
    const count = NESTED_BLOB_PARTICLES + probes;
    const model = protostarModel(context);
    const position = (k: number): [number, number] => {
        const radius = NESTED_RING_RADII[Math.floor(k / NESTED_RING_ANGLES)] * cell;
        const angle = 2 * Math.PI * ((k % NESTED_RING_ANGLES) + 0.5) / NESTED_RING_ANGLES;
        return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    };
    model.debugInitialState = state => {
        state.positions.fill(0);
        state.velocities.fill(0);
        for (let i = 0; i < state.count; i++) {
            const [x, y] = i < NESTED_BLOB_PARTICLES ? center : position(i - NESTED_BLOB_PARTICLES);
            state.positions.set([x, y, i < NESTED_BLOB_PARTICLES ? 0 : 1, 1], i * 4);
        }
    };
    const size = boxCells({ gridRes: PROTOSTAR_GRID_RES, ratio: PROTOSTAR_NESTED_RATIO });
    const origin = which === 'centred' ? boxOrigin({ x: center[0], y: center[1] }, cell, { gridRes: PROTOSTAR_GRID_RES, ratio: PROTOSTAR_NESTED_RATIO })
        : { x: Math.floor(center[0] / cell) + NESTED_OUTSIDE_CELLS, y: Math.floor(center[1] / cell) - size / 2 };
    model.debugForceNestedBox(which === 'off' ? null : origin);
    try {
        await restart(context, {
            count, overrides: { radiation: 0, feedback: 0, fusionRate: 0 }, timeScale: 0.85, params: { [PROTOSTAR_PARAM.nestedGrid]: which !== 'off' },
        });
    } finally {
        model.debugInitialState = null;
    }
    const inputs = model.debugGrids.debugDepositInputs;
    model.debugGrids.setDepositMasses(inputs.depositMass.map((m, k) => (k === 0 ? m : 0)));
    simulation.step();
    await context.sync.wait(simulation.positionTexture);
    const accel = await readPositions(renderer, simulation.debugPipeline.debugVariableTarget(ACCEL), count);
    const common = model.debugGrids.common;
    const lo = common.nestedLo.value, hi = common.nestedHi.value;
    const fine = which !== 'off';
    let sx = 0, sy = 0;
    for (let i = 0; i < NESTED_BLOB_PARTICLES; i++) { sx += accel[i * 4]; sy += accel[i * 4 + 1]; }
    const out: PointRun = {
        accel: [], inside: [], selfForce: Math.hypot(sx, sy) / NESTED_BLOB_PARTICLES,
        gm: model.debugGridScales!.gravityPerDeposit * NESTED_BLOB_PARTICLES * inputs.depositMass[0] * inputs.depositMassScale,
        softening: model.debugGridScales!.softening,
    };
    for (let k = 0; k < probes; k++) {
        const i = NESTED_BLOB_PARTICLES + k;
        const [x, y] = position(k);
        out.accel.push([accel[i * 4], accel[i * 4 + 1]]);
        out.inside.push(fine && x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y);
    }
    model.debugForceNestedBox(null);
    return out;
}

const pointMass: Scenario = {
    id: 'protostar.nested.point-mass',
    title: 'Nested grid (C2): the pull of a point mass on probes inside and outside the box (the softened law, the anisotropy), and across its edge',
    tags: ['protostar', 'nested-grid', 'gravity', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: 1000 });
        const cell = LAB_CELL;
        const width = context.simulation.screenSize.value.x, height = context.simulation.screenSize.value.y;
        const center: [number, number] = [(Math.floor(width / cell / 2) + 0.5 + NESTED_BLOB_OFFSET) * cell,
            (Math.floor(height / cell / 2) + 0.5 + NESTED_BLOB_OFFSET) * cell];
        const runs = {} as Record<PointCase, PointRun>;
        for (const which of ['off', 'centred', 'outside'] as const) runs[which] = await pointRun(context, which, center);
        const law = (run: PointRun, r: number, eps: number): number => run.gm * r / (r * r + eps * eps) ** 1.5;
        const fineEps = runs.off.softening / PROTOSTAR_NESTED_SOFTENING_DIVISOR;
        const rings = (run: PointRun) => NESTED_RING_RADII.map((radius, ring) => {
            const r = radius * cell;
            const pulls: number[] = [], tangential: number[] = [];
            let inside = 0;
            for (let a = 0; a < NESTED_RING_ANGLES; a++) {
                const k = ring * NESTED_RING_ANGLES + a;
                const angle = 2 * Math.PI * (a + 0.5) / NESTED_RING_ANGLES;
                const [ax, ay] = run.accel[k];
                pulls.push(-(ax * Math.cos(angle) + ay * Math.sin(angle)));
                tangential.push(-ax * Math.sin(angle) + ay * Math.cos(angle));
                if (run.inside[k]) inside++;
            }
            const meanPull = mean(pulls);
            const eps = inside === NESTED_RING_ANGLES ? fineEps : run.softening;
            return {
                radiusCells: radius, insideShare: inside / NESTED_RING_ANGLES, meanPull: round(meanPull),
                lawRatio: round(meanPull / law(run, r, eps)), anisotropyRms: round(rms(pulls.map(p => p / meanPull - 1))),
                tangentialOverPull: round(rms(tangential) / meanPull),
            };
        });
        const off = rings(runs.off), centred = rings(runs.centred);
        // Across the edge: the point outside the box; the probes that read the fine level against the same probes with the flag off.
        const changes: number[] = [];
        runs.outside.accel.forEach(([ax, ay], k) => {
            if (!runs.outside.inside[k]) return;
            const [bx, by] = runs.off.accel[k];
            changes.push(Math.hypot(ax - bx, ay - by) / Math.hypot(bx, by));
        });
        const judged = centred.filter(r => r.radiusCells >= NESTED_JUDGED_RADII[0] && r.radiusCells <= NESTED_JUDGED_RADII[1]);
        const lawError = Math.max(...judged.map(r => Math.abs(r.lawRatio - 1)));
        const anisotropy = Math.max(...judged.map(r => r.anisotropyRms));
        const crossing = changes.length ? Math.max(...changes) : NaN;
        const crossingRms = rms(changes);
        const inner = (run: PointRun, rows: { meanPull: number }[]): number => run.selfForce / rows[2].meanPull;
        const ok = lawError < NESTED_FORCE_TOLERANCE && anisotropy < NESTED_FORCE_TOLERANCE && crossingRms < NESTED_FORCE_TOLERANCE;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                blobParticles: NESTED_BLOB_PARTICLES, ringAngles: NESTED_RING_ANGLES, softeningPx: round(runs.off.softening), fineSofteningPx: round(fineEps),
                off, centred,
                judged: { radiiCells: [...NESTED_JUDGED_RADII], maxLawError: round(lawError), maxAnisotropyRms: round(anisotropy), tolerance: NESTED_FORCE_TOLERANCE },
                acrossTheEdge: { probesInside: changes.length, maxChange: round(crossing), rmsChange: round(crossingRms) },
                selfForceOverPullAtOneCell: { off: round(inner(runs.off, off)), centred: round(inner(runs.centred, centred)), outside: round(runs.outside.selfForce / off[2].meanPull) },
            },
            details: `inside the box (eps/${PROTOSTAR_NESTED_SOFTENING_DIVISOR}): law within ${(100 * lawError).toFixed(2)} %, anisotropy ${(100 * anisotropy).toFixed(2)} % `
                + `(${NESTED_JUDGED_RADII[0]} to ${NESTED_JUDGED_RADII[1]} cells); pull at 0.25 / 1 cell ${centred[0].lawRatio} / ${centred[2].lawRatio} of the law (flag off ${off[0].lawRatio} / ${off[2].lawRatio} of the main law); `
                + `a point ${NESTED_OUTSIDE_CELLS} cells outside: its pull on ${changes.length} probes inside changes by ${(100 * crossingRms).toFixed(2)} % rms (max ${(100 * crossing).toFixed(2)} %); `
                + `self-force ${(100 * inner(runs.centred, centred)).toFixed(3)} % of the pull at 1 cell (off ${(100 * inner(runs.off, off)).toFixed(3)} %)`,
        };
    },
};

// ---- protostar.nested.conservation ----

const conservation: Scenario = {
    id: 'protostar.nested.conservation',
    title: 'Nested grid (C2): energy and momentum of the conservative default cloud over 100 orbits, flag off, box fixed at the center, box moving',
    tags: ['protostar', 'nested-grid', 'energy', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: { valid: false }, details: 'software renderer: too slow' };
        const cell = LAB_CELL;
        const size = context.simulation.screenSize.value;
        const centre = boxOrigin({ x: size.x / 2, y: size.y / 2 }, cell, { gridRes: PROTOSTAR_GRID_RES, ratio: PROTOSTAR_NESTED_RATIO });
        // fixed-eps: the fine level at the main softening, which tells the junction's share of a drift from the time step's in a denser core.
        const cases = [
            { name: 'off', on: false, move: false, divisor: null },
            { name: 'fixed', on: true, move: false, divisor: null },
            { name: 'moving', on: true, move: true, divisor: null },
            { name: 'fixed-eps', on: true, move: false, divisor: 1 },
        ];
        const out: Record<string, JsonValue> = {};
        const notes: string[] = [];
        for (const c of cases) {
            const momentum: number[] = [];
            const run = await driftRun(context, {
                name: c.name, params: { [PROTOSTAR_PARAM.nestedGrid]: c.on }, particles: NESTED_CONSERVATION_PARTICLES,
                orbits: NESTED_CONSERVATION_ORBITS, maxFrames: Number.MAX_SAFE_INTEGER, budgetMs: NESTED_CONSERVATION_BUDGET_MS, restitution: ELASTIC_WALLS,
                afterRestart: model => {
                    model.debugNestedSofteningDivisor = c.divisor;
                    model.debugForceNestedBox(c.on ? centre : null);
                },
                onFrame: (frame, model) => {
                    if (c.move && frame % NESTED_MOVE_FRAMES === 0) {
                        const step = (frame / NESTED_MOVE_FRAMES) % 2 === 1 ? NESTED_MOVE_CELLS : 0;
                        model.debugForceNestedBox({ x: centre.x + step, y: centre.y - step });
                    }
                    const r = model.reduction;
                    if (frame % NESTED_MOMENTUM_EVERY === 0 && r && r.energy.kinetic > 0) {
                        // |P| over M times the rms speed: the share of the motion that is a drift of the whole cloud.
                        momentum.push(Math.hypot(r.momentum.x, r.momentum.y) / (TOTAL_MASS * Math.sqrt(2 * r.energy.kinetic / TOTAL_MASS)));
                    }
                },
            });
            protostarModel(context).debugForceNestedBox(null);
            protostarModel(context).debugNestedSofteningDivisor = null;
            out[c.name] = { ...runMetrics(run), momentumOverMassRmsSpeed: { max: round(Math.max(0, ...momentum)), final: round(momentum[momentum.length - 1] ?? NaN) } };
            notes.push(`${driftSummary(run)}, |P| / (M v_rms) up to ${Math.max(0, ...momentum).toExponential(2)}`);
        }
        return { status: 'pass', metrics: { overrides: { ...CONSERVATIVE_OVERRIDES }, box: [centre.x, centre.y], moveCells: NESTED_MOVE_CELLS, moveFrames: NESTED_MOVE_FRAMES, ...out }, details: notes.join('; ') };
    },
};

// ---- protostar.nested.cloud ----

interface CloudReading {
    frame: number;
    seconds: number;
    box: boolean;
    peakDensity: number;
    mainPeakDensity: number;
    coreMK: number;
    burnMK: number | null;
    omegaDt: number;
    jeansUnresolvedShare: number | null;
    fragments: number | null;
}

/** Fine cells denser than NESTED_FRAGMENT_DENSITY and than their 8 neighbors. */
function countFragments(gas: Float32Array, res: number): number {
    let n = 0;
    for (let y = 1; y < res - 1; y++) {
        for (let x = 1; x < res - 1; x++) {
            const d = gas[(y * res + x) * 4];
            if (d < NESTED_FRAGMENT_DENSITY) continue;
            let peak = true;
            for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
                if ((dx || dy) && gas[((y + dy) * res + x + dx) * 4] >= d) { peak = false; break; }
            }
            if (peak) n++;
        }
    }
    return n;
}

async function cloudRun(context: LabContext, ratio: number | null, divisor: number | null = null): Promise<{ readings: CloudReading[]; boxFrame: number | null }> {
    const { renderer, simulation } = context;
    if (ratio !== null && ratio !== PROTOSTAR_NESTED_RATIO) {
        forceNestedRatio(ratio);
        rebuildPipeline(context);
    }
    try {
        const model = protostarModel(context);
        model.debugNestedSofteningDivisor = divisor;
        await restart(context, { count: context.options.baselineParticles, params: { [PROTOSTAR_PARAM.nestedGrid]: ratio !== null } });
        const size = simulation.screenSize.value;
        const cell = Math.max(size.x, size.y) / PROTOSTAR_GRID_RES;
        const length = Math.min(size.x, size.y);
        const gravity = Number(simulation.params[PROTOSTAR_PARAM.gravity]) * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS;
        const radius = PROTOSTAR_CLOUD_RADIUS * length;
        const rho0 = TOTAL_MASS / (Math.PI * radius * radius);
        const readings: CloudReading[] = [];
        let boxFrame: number | null = null;
        await runFrames(context, NESTED_CLOUD_FRAMES, {
            endFrame: true,
            async onFrame(frame) {
                if (boxFrame === null && model.debugNestedBox) boxFrame = frame;
                if (frame % NESTED_CLOUD_READ_EVERY !== 0) return;
                await model.debugReading;
                const r = model.reduction;
                if (!r) return;
                const targets = model.debugGridTargets;
                const nested = r.nested && targets.nested ? targets.nested : null;
                const gasTarget = nested ? nested.gas : targets.gas;
                const levelCell = nested ? cell / model.debugGrids.nestedRatio : cell;
                const gas = await readTarget(renderer, gasTarget);
                const force = await readTarget(renderer, nested ? nested.combine : targets.gravity);
                const core = probeCore(gas, force, PROTOSTAR_GRID_RES, levelCell);
                const heat = await readTarget(renderer, nested ? nested.heat : targets.heat);
                const burn = burnTemperature(gas, heat, PROTOSTAR_GRID_RES * PROTOSTAR_GRID_RES, LAB_T0);
                // The Jeans length of the sheet, t / (2 G Sigma), against NESTED_JEANS_CELLS cells of the level, over its mass.
                let unresolved = 0, mass = 0;
                for (let i = 0; i < PROTOSTAR_GRID_RES * PROTOSTAR_GRID_RES; i++) {
                    const rho = gas[i * 4];
                    if (!(rho > 0)) continue;
                    mass += rho;
                    if (gas[i * 4 + 1] / (2 * gravity * rho * rho0) < NESTED_JEANS_CELLS * levelCell) unresolved += rho;
                }
                readings.push({
                    frame, seconds: frame * frameSeconds(context), box: r.nested !== null, peakDensity: r.peakDensity, mainPeakDensity: r.mainPeakDensity,
                    coreMK: r.peakTemperature * PROTOSTAR_T0_KELVIN / 1e6, burnMK: burn === null ? null : burn * PROTOSTAR_T0_KELVIN / 1e6,
                    omegaDt: core.omega * frameSeconds(context) / Math.max(1, simulation.lastSubsteps),
                    jeansUnresolvedShare: mass > 0 ? unresolved / mass : null, fragments: nested ? countFragments(gas, PROTOSTAR_GRID_RES) : null,
                });
            },
        });
        return { readings, boxFrame };
    } finally {
        protostarModel(context).debugNestedSofteningDivisor = null;
        if (ratio !== null && ratio !== PROTOSTAR_NESTED_RATIO) {
            forceNestedRatio(null);
            rebuildPipeline(context);
        }
    }
}

const cloud: Scenario = {
    id: 'protostar.nested.cloud',
    title: 'Nested grid (C2): the default cloud with the flag off and on at the ratios 2, 4, 8: the peak density and temperature, omega dt in the core, the Jeans length',
    tags: ['protostar', 'nested-grid', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: { valid: false }, details: 'software renderer: too slow' };
        const out: Record<string, JsonValue> = {};
        const notes: string[] = [];
        let omegaMax = 0;
        const runs: { ratio: number | null; divisor: number | null }[] = [
            ...[null, ...NESTED_CLOUD_RATIOS].map(ratio => ({ ratio, divisor: null })),
            ...NESTED_CLOUD_DIVISORS.map(divisor => ({ ratio: PROTOSTAR_NESTED_RATIO, divisor })),
        ];
        for (const { ratio, divisor } of runs) {
            const { readings, boxFrame } = await cloudRun(context, ratio, divisor);
            const name = ratio === null ? 'off' : divisor === null ? `ratio${ratio}` : `ratio${ratio}-eps/${divisor}`;
            const withBox = readings.filter(r => r.box);
            const peak = readings.reduce((best, r) => (r.peakDensity > best.peakDensity ? r : best), readings[0]);
            const last = readings[readings.length - 1];
            const omega = Math.max(0, ...readings.map(r => r.omegaDt));
            if (ratio !== null) omegaMax = Math.max(omegaMax, omega);
            out[name] = {
                boxFrame, boxSeconds: boxFrame === null ? null : round(boxFrame * frameSeconds(context)),
                maxPeakDensity: round(peak.peakDensity), atSeconds: round(peak.seconds), coreMKThere: round(peak.coreMK),
                final: { peakDensity: round(last.peakDensity), mainPeakDensity: round(last.mainPeakDensity), coreMK: round(last.coreMK), burnMK: last.burnMK === null ? null : round(last.burnMK),
                    jeansUnresolvedShare: last.jeansUnresolvedShare === null ? null : round(last.jeansUnresolvedShare), fragments: last.fragments },
                maxOmegaDt: round(omega),
                series: readings.map(r => [r.frame, r.box ? 1 : 0, round(r.peakDensity), round(r.coreMK), r.burnMK === null ? null : round(r.burnMK), round(r.omegaDt),
                    r.jeansUnresolvedShare === null ? null : round(r.jeansUnresolvedShare), r.fragments]),
            };
            notes.push(`${name}: box ${boxFrame === null ? 'never' : `at ${(boxFrame * frameSeconds(context)).toFixed(1)} s`}, peak ${peak.peakDensity.toFixed(0)} rho0 at ${peak.seconds.toFixed(1)} s `
                + `(${peak.coreMK.toFixed(1)} MK), final ${last.peakDensity.toFixed(0)} rho0 / ${last.coreMK.toFixed(1)} MK / burn ${last.burnMK?.toFixed(1) ?? '-'} MK, `
                + `omega dt up to ${omega.toFixed(3)}, ${withBox.length} of ${readings.length} readings with the box`);
        }
        return {
            status: 'pass',
            metrics: { frames: NESTED_CLOUD_FRAMES, readEvery: NESTED_CLOUD_READ_EVERY, omegaDtLimit: OMEGA_DT_LIMIT, seriesColumns: ['frame', 'box', 'peak rho0', 'core MK', 'burn MK', 'omega dt', 'Jeans unresolved share', 'fragments'], ...out },
            details: `${notes.join('; ')}; omega dt with the box up to ${omegaMax.toFixed(3)} (limit of the lab ${OMEGA_DT_LIMIT})`,
        };
    },
};

// ---- cost.protostar.nested ----

async function frameTime(context: LabContext, frames: number): Promise<number> {
    await context.sync.wait(context.simulation.positionTexture);
    const start = performance.now();
    await runFrames(context, frames, { endFrame: true });
    return (performance.now() - start) / frames;
}

const cost: Scenario = {
    id: 'cost.protostar.nested',
    title: 'Nested grid (C2): each pass of its fine level and of the join alone, and the whole frame with the flag on and off, at 400k and 1M particles late in the default cloud',
    tags: ['cost', 'protostar', 'nested-grid', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: { valid: false }, details: 'software renderer: timings are meaningless' };
        const cases: Record<string, JsonValue>[] = [];
        const notes: string[] = [];
        for (const count of NESTED_COST_COUNTS) {
            await restart(context, { count, params: { [PROTOSTAR_PARAM.nestedGrid]: true } });
            const model = protostarModel(context);
            await runFrames(context, NESTED_COST_FRAME, { endFrame: true });
            await model.debugReading;
            const box = model.debugNestedBox;
            if (!box) {
                cases.push({ particles: count, box: null });
                notes.push(`${count / 1000}k: no box at frame ${NESTED_COST_FRAME}`);
                continue;
            }
            model.debugForceNestedBox(box);              // hold it while timing
            model.beforeSubstep(0);
            const grids = model.debugGrids;
            const main: Record<string, number> = {};
            for (const name of PROTOSTAR_GRID_PASSES.filter(n => n !== 'collision')) main[name] = round(await renderTime(context, () => grids.debugRenderPass(name)));
            const level = grids.debugNestedLevel!;
            const fine: Record<string, number> = {};
            for (const name of GRID_CHAIN_PASSES) fine[name] = round(await renderTime(context, () => level.chain.debugRenderPass(name)));
            for (const name of ['gather', 'insideCoarse', 'insideGravity', 'combine'] as const) fine[name] = round(await renderTime(context, () => level.debugRenderJoin(name)));
            const mainTotal = Object.values(main).reduce((a, b) => a + b, 0), fineTotal = Object.values(fine).reduce((a, b) => a + b, 0);
            const times: { on: number[]; off: number[] } = { on: [], off: [] };
            for (let pass = 0; pass < 3; pass++) {
                for (const on of pass % 2 ? [false, true] : [true, false]) {
                    model.setParam(PROTOSTAR_PARAM.nestedGrid, on);
                    if (on) model.debugForceNestedBox(box);
                    await runFrames(context, 5, { endFrame: true });
                    (on ? times.on : times.off).push(await frameTime(context, NESTED_COST_FRAMES));
                }
            }
            model.debugForceNestedBox(null);
            const on = quantile(times.on, 0.5), off = quantile(times.off, 0.5);
            cases.push({ particles: count, box, substepMs: { main, fine, mainTotal: round(mainTotal), fineTotal: round(fineTotal) }, frameMs: { on: round(on), off: round(off), ratio: round(on / off) } });
            notes.push(`${count / 1000}k: fine level ${fineTotal.toFixed(3)} ms per substep against ${mainTotal.toFixed(3)} for the main grid (+${(100 * fineTotal / mainTotal).toFixed(0)} %); `
                + `frame ${on.toFixed(2)} ms on, ${off.toFixed(2)} off (+${(100 * (on / off - 1)).toFixed(0)} %)`);
        }
        return { status: 'pass', metrics: { frame: NESTED_COST_FRAME, cases }, details: notes.join('; ') };
    },
};


// ---- protostar.nested.net-force ----

/**
 * Where the momentum goes: the conservative default cloud run NET_FORCE_FRAMES frames with the box held at its center (and the flag off),
 * then the sum of the forces on all the particles (zero if every pair pulls both ways alike) over the sum of their sizes, split between the
 * particles that read the fine level and the others; at divisors 1 and 2 of the softening, and at 2 with the step halved (debugSubsteps).
 */
const NET_FORCE_FRAMES = 3000;

const netForce: Scenario = {
    id: 'protostar.nested.net-force',
    title: 'Nested grid (C2): the net force on the conservative cloud (the momentum leak), the box at the center, by softening and step',
    tags: ['protostar', 'nested-grid', 'momentum', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation } = context;
        const size = simulation.screenSize.value;
        const centre = boxOrigin({ x: size.x / 2, y: size.y / 2 }, LAB_CELL, { gridRes: PROTOSTAR_GRID_RES, ratio: PROTOSTAR_NESTED_RATIO });
        const out: Record<string, JsonValue> = {};
        const notes: string[] = [];
        for (const c of [
            { name: 'off', on: false, divisor: null, substeps: null, band: null },
            { name: 'eps/2-no-band', on: true, divisor: 2, substeps: null, band: 0 },
            { name: 'eps/2', on: true, divisor: 2, substeps: null, band: null },
            { name: 'eps/2-band-3', on: true, divisor: 2, substeps: null, band: 3 },
        ]) {
            const model = protostarModel(context);
            await restart(context, { count: NESTED_CONSERVATION_PARTICLES, overrides: { ...CONSERVATIVE_OVERRIDES }, params: { [PROTOSTAR_PARAM.nestedGrid]: c.on } });
            model.velocityUniforms.restitution.value = ELASTIC_WALLS;
            model.debugNestedSofteningDivisor = c.divisor;
            model.debugSubsteps = c.substeps;
            model.debugForceNestedBox(c.on ? centre : null);
            const level = model.debugGrids.debugNestedLevel;
            if (level) level.debugBandCells = c.band;
            const energies: number[] = [];
            await runFrames(context, NET_FORCE_FRAMES, {
                endFrame: true,
                async onFrame(frame) {
                    if (frame % 30 !== 0) return;
                    await model.debugReading;
                    const e = model.reduction?.energy;
                    if (e) energies.push(e.kinetic + e.potentialNow);
                },
            });
            const count = simulation.activeCount;
            const accel = await readPositions(renderer, simulation.debugPipeline.debugVariableTarget(ACCEL), count);
            const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
            const lo = model.debugGrids.common.nestedLo.value, hi = model.debugGrids.common.nestedHi.value;
            const sum = { in: [0, 0], out: [0, 0] }, size2 = { in: 0, out: 0 };
            for (let i = 0; i < count; i++) {
                const ax = accel[i * 4], ay = accel[i * 4 + 1];
                const x = positions[i * 4], y = positions[i * 4 + 1];
                const inside = c.on && x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y ? 'in' : 'out';
                sum[inside][0] += ax; sum[inside][1] += ay; size2[inside] += Math.hypot(ax, ay);
            }
            const total = Math.hypot(sum.in[0] + sum.out[0], sum.in[1] + sum.out[1]) / (size2.in + size2.out);
            const drift = energies.length > 1 ? (energies[energies.length - 1] - energies[0]) / Math.abs(energies[0]) : NaN;
            out[c.name] = { netOverSum: round(total), inside: [round(sum.in[0] / (size2.in || 1)), round(sum.in[1] / (size2.in || 1))],
                outside: [round(sum.out[0] / (size2.out || 1)), round(sum.out[1] / (size2.out || 1))], insideShareOfForce: round(size2.in / (size2.in + size2.out)),
                energyDrift: round(drift), peakDensity: round(model.reduction?.peakDensity ?? NaN) };
            notes.push(`${c.name}: net force ${total.toExponential(2)} of the sum, inside ${(Math.hypot(sum.in[0], sum.in[1]) / (size2.in + size2.out)).toExponential(2)}, `
                + `outside ${(Math.hypot(sum.out[0], sum.out[1]) / (size2.in + size2.out)).toExponential(2)}; K + U ${(100 * drift).toFixed(2)} % in ${NET_FORCE_FRAMES} frames; peak ${model.reduction?.peakDensity.toFixed(0)} rho0`);
            model.debugForceNestedBox(null);
            model.debugNestedSofteningDivisor = null;
            model.debugSubsteps = null;
            if (level) level.debugBandCells = null;
            model.velocityUniforms.restitution.value = PROTOSTAR_RESTITUTION_APP;
        }
        return { status: 'pass', metrics: out, details: notes.join('; ') };
    },
};

export const nestedGridScenarios: readonly Scenario[] = [nested, pointMass, conservation, cloud, cost, netForce];
