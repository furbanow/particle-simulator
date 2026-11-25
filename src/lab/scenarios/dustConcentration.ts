// The GPU search of the densest disk (docs/spikes/b4-gpu-concentration.md) against its CPU reference, analyzeConcentration, on the same
// particles: clouds built for the purpose (a clump at the edge of the screen, a tie between two clumps, a collapsed clump...) and the default
// cloud as it collapses, at 400 000 and 3 000 000 particles. The GPU's answer must have its center within one cell of the coarse grid of the CPU's
// and its share of the mass within CONCENTRATION_PARITY_SHARE_POINTS percentage points.

import { CONCENTRATION_CELLS_PER_RADIUS } from '../../config';
import { concentrationGrid, type Concentration } from '../../simulation/concentration';
import { STICKY_DUST_PARAM } from '../../simulation/stickyDust/declaration';
import type { StickyDustModel } from '../../simulation/stickyDust/gpuModel';
import { agrees, CLOUD_KINDS, compareConcentration, syntheticCloud, type Agreement, type CloudKind } from '../concentrationParity';
import {
    CONCENTRATION_PARITY_HEAVY_PARTICLES, CONCENTRATION_PARITY_PARTICLES, CONCENTRATION_PARITY_RADII, CONCENTRATION_PARITY_SHARE_POINTS,
    CONCENTRATION_PARITY_SNAPSHOTS, LAB_AREA, SUPERNOVA_SEED,
} from '../config';
import { restart, runFrames, stickyDustModel } from '../driver';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readPositions } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const round = (v: number): number => significant(v, 4);

interface Row {
    cloud: string;
    particles: number;
    radius: number;
    /** Wall ms for the GPU search to hand its result back (the passes and the read-back of two texels). */
    gpuMs: number;
    gpu: Concentration;
    cpu: Concentration;
    agreement: Agreement;
    /** The cell of the coarse grid, px: the center's tolerance. */
    cellPx: number;
    /** A tie between two clumps: either answer is right, the row is reported, not judged. */
    tie: boolean;
    ok: boolean;
}

const figures = (c: Concentration): Record<string, JsonValue> => ({
    centerX: round(c.centerX), centerY: round(c.centerY), share: round(c.fraction), members: c.members, rms: round(c.spread),
});

/** Runs the GPU search and the CPU reference on the particles the simulation holds now (`positions`: their texels, read back or just written). */
async function compare(context: LabContext, model: StickyDustModel, cloud: string, positions: Float32Array, radius: number, tie = false): Promise<Row> {
    const count = context.simulation.activeCount;
    model.setParam(STICKY_DUST_PARAM.concentrationRadius, radius);
    const start = performance.now();
    const gpu = await model.debugMeasure(true);
    const gpuMs = performance.now() - start;
    const cpu = await model.debugMeasure(false, positions);
    const agreement = compareConcentration(gpu, cpu);
    const cellPx = concentrationGrid(radius, LAB_AREA.width, LAB_AREA.height).cellSize;
    return {
        cloud, particles: count, radius, gpuMs, gpu, cpu, agreement, cellPx, tie,
        ok: tie || agrees(agreement, cellPx, CONCENTRATION_PARITY_SHARE_POINTS),
    };
}

const rowMetrics = (r: Row): Record<string, JsonValue> => ({
    cloud: r.cloud, particles: r.particles, radius: r.radius, cellPx: round(r.cellPx), tie: r.tie, agrees: r.ok,
    centerDifferencePx: round(r.agreement.centerPx), shareDifferencePoints: round(r.agreement.sharePoints),
    rmsDifferencePx: round(r.agreement.spreadPx), membersDifferenceRelative: round(r.agreement.membersRelative),
    gpuWallMs: round(r.gpuMs), gpu: figures(r.gpu), cpu: figures(r.cpu),
});

const worst = (rows: readonly Row[], pick: (a: Agreement) => number): number => rows.reduce((m, r) => Math.max(m, Math.abs(pick(r.agreement))), 0);

/** The species of each particle after a restart (the position texture holds them in z). */
async function speciesOf(context: LabContext): Promise<Uint8Array> {
    const { renderer, simulation } = context;
    const count = simulation.activeCount;
    const initial = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const species = new Uint8Array(count);
    for (let i = 0; i < count; i++) species[i] = Math.round(initial[i * 4 + 2]);
    return species;
}

/** The synthetic clouds, each at the default radius; the radii on the blob and on the collapsed clump. */
async function syntheticRows(context: LabContext, particles: number, radii: readonly number[]): Promise<Row[]> {
    const { simulation } = context;
    await restart(context, { algorithm: 'stickyDust', count: particles, seed: SUPERNOVA_SEED });
    const model = stickyDustModel(context);
    const species = await speciesOf(context);
    const zone = model.debugParams.concentrationRadius as number;
    const pipeline = simulation.debugPipeline;
    const velocities = new Float32Array(particles * 4);
    const rows: Row[] = [];
    for (const kind of CLOUD_KINDS) {
        const positions = syntheticCloud(kind as CloudKind, particles, species, mulberry32(SUPERNOVA_SEED + 1), LAB_AREA.width, LAB_AREA.height);
        pipeline.debugSetState(positions, velocities);
        const tie = kind === 'twin-blobs';
        rows.push(await compare(context, model, kind, positions, zone, tie));
        if (kind === 'blob' || kind === 'compact') {
            for (const radius of radii) if (radius !== zone) rows.push(await compare(context, model, `${kind}, radius ${radius}`, positions, radius));
        }
    }
    model.setParam(STICKY_DUST_PARAM.concentrationRadius, zone);
    return rows;
}

/** The default cloud at the given frames of its collapse (no supernova: the model's endFrame is not called), compared at the default radius and at the others. */
async function collapseRows(context: LabContext, particles: number, frames: readonly number[], radii: readonly number[]): Promise<Row[]> {
    const { renderer, simulation } = context;
    await restart(context, { algorithm: 'stickyDust', count: particles, seed: SUPERNOVA_SEED });
    const model = stickyDustModel(context);
    const zone = model.debugParams.concentrationRadius as number;
    const rows: Row[] = [];
    let done = 0;
    for (const frame of frames) {
        if (frame > done) await runFrames(context, frame - done);
        done = frame;
        const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, particles);
        rows.push(await compare(context, model, `default cloud, frame ${frame}`, positions, zone));
        if (frame === frames[frames.length - 1]) {
            for (const radius of radii) if (radius !== zone) rows.push(await compare(context, model, `default cloud, frame ${frame}, radius ${radius}`, positions, radius));
        }
    }
    model.setParam(STICKY_DUST_PARAM.concentrationRadius, zone);
    return rows;
}

function outcome(rows: readonly Row[], what: string): ScenarioOutcome {
    const judged = rows.filter(r => !r.tie);
    const failed = judged.filter(r => !r.ok);
    const metrics: Record<string, JsonValue> = {
        rows: rows.map(rowMetrics),
        worstCenterDifferenceCells: round(judged.reduce((m, r) => Math.max(m, r.agreement.centerPx / r.cellPx), 0)),
        worstCenterDifferencePx: round(worst(judged, a => a.centerPx)),
        worstShareDifferencePoints: round(worst(judged, a => a.sharePoints)),
        worstRmsDifferencePx: round(worst(judged, a => a.spreadPx)),
        cellsPerRadius: CONCENTRATION_CELLS_PER_RADIUS,
        shareTolerancePoints: CONCENTRATION_PARITY_SHARE_POINTS,
    };
    const line = `${what}: ${rows.length} comparisons, worst centre ${(metrics.worstCenterDifferencePx as number)} px `
        + `(${metrics.worstCenterDifferenceCells} cells), worst share ${metrics.worstShareDifferencePoints} points, worst rms ${metrics.worstRmsDifferencePx} px`;
    return {
        status: failed.length === 0 ? 'pass' : 'fail', metrics,
        details: failed.length === 0 ? line : `${line}; OUT OF TOLERANCE: ${failed.map(r => `${r.cloud} (R ${r.radius})`).join(', ')}`,
    };
}

export const dustConcentrationParity: Scenario = {
    id: 'dust.concentration.parity',
    title: 'Sticky dust: the GPU search of the densest disk against the CPU reference (center, share of the mass, rms radius), on built clouds and the default cloud',
    tags: ['dust', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: 'Software renderer: 400 000 particles would take too long.' };
        if (!context.floatBlend) return { status: 'skip', metrics: {}, details: 'No EXT_float_blend: the application reads the positions back and runs the CPU reference.' };
        const rows = [
            ...await syntheticRows(context, CONCENTRATION_PARITY_PARTICLES, CONCENTRATION_PARITY_RADII),
            ...await collapseRows(context, CONCENTRATION_PARITY_PARTICLES, CONCENTRATION_PARITY_SNAPSHOTS, CONCENTRATION_PARITY_RADII),
        ];
        return outcome(rows, `${CONCENTRATION_PARITY_PARTICLES} particles`);
    },
};

export const dustConcentrationParityHeavy: Scenario = {
    id: 'dust.concentration.parity-heavy',
    title: 'Sticky dust: the same comparison at 3 000 000 particles (float32 sums of a million particles in a few texels)',
    tags: ['dust', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: 'Software renderer: 3 000 000 particles would take too long.' };
        if (!context.floatBlend) return { status: 'skip', metrics: {}, details: 'No EXT_float_blend: the application reads the positions back and runs the CPU reference.' };
        const rows = [
            ...await syntheticRows(context, CONCENTRATION_PARITY_HEAVY_PARTICLES, [LAB_AREA.height / 2]),
            ...await collapseRows(context, CONCENTRATION_PARITY_HEAVY_PARTICLES, [0, 150], []),
        ];
        return outcome(rows, `${CONCENTRATION_PARITY_HEAVY_PARTICLES} particles`);
    },
};

export const dustConcentrationScenarios: Scenario[] = [dustConcentrationParity, dustConcentrationParityHeavy];
