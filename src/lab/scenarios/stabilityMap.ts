// The stability map of the protostar (phase P1b, proposal A12), on the real GPU:
//  - protostar.stability-map: the default cloud at t = 0. The map the GPU draws against the TypeScript twin (stability.ts) computed on the
//    grids read back (parity), then what it says: the medians of Q and beta over rings, against Q measured on the particles (toomre.ts),
//    and the share of the gas where Q < 1, beta < 3 and both (the professor's figures for the default cloud: Q from 0.19 to 0.56, beta
//    about 0.6 at 0.2 R, with the cooling of before A6);
//  - protostar.stability-evolution: the same cloud run for some seconds, the map read now and then: the shares, and the core's Q and beta.

import {
    PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_STABILITY_BETA_CRITICAL, PROTOSTAR_STABILITY_CAP, PROTOSTAR_STABILITY_MIN_DENSITY,
    PROTOSTAR_STABILITY_Q_CRITICAL, PROTOSTAR_T0_KELVIN, TOTAL_MASS,
} from '../../config';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import { stabilityMap, type StabilityScales } from '../../simulation/protostar/stability';
import { measureToomre } from '../../simulation/protostar/toomre';
import {
    STABILITY_CLASS_MISMATCH, STABILITY_EVOLUTION_EVERY, STABILITY_EVOLUTION_SECONDS, STABILITY_PARITY_TOLERANCE, STABILITY_PARTICLES,
    STABILITY_RADII, STABILITY_RING_WIDTH,
} from '../config';
import { frameSeconds, modelStats, protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { quantile, significant } from '../numbers';
import { readAttachment, readPositions, readTarget } from '../readback';
import { drawAndReduce } from './energy';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const sig = (v: number): number => significant(v, DIGITS);
const numeric = (value: unknown): number => typeof value === 'number' ? value : NaN;
const finite = (v: number): number | null => v < PROTOSTAR_STABILITY_CAP && Number.isFinite(v) ? sig(v) : null;

/** The scales the model draws its map with, recomputed from its parameters (G_eff rho0, T0, the cooling's sliders). */
function scalesOf(context: LabContext): StabilityScales {
    const model = protostarModel(context);
    const size = context.simulation.screenSize.value;
    const length = Math.min(size.x, size.y), radius = PROTOSTAR_CLOUD_RADIUS * length;
    const params = model.debugParams;
    const gravity = numeric(params[PROTOSTAR_PARAM.gravity]) * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS;
    const common = model.debugGrids.common;
    return {
        cell: common.gridCell.value, gravityDensity: gravity * TOTAL_MASS / (Math.PI * radius * radius), t0: common.fusionTRef.value,
        cooling: {
            rate: numeric(params[PROTOSTAR_PARAM.radiation]), opacity: numeric(params[PROTOSTAR_PARAM.kappa]),
            floor: numeric(params[PROTOSTAR_PARAM.minTemperature]),
        },
    };
}

interface MapReading {
    map: Float32Array;
    gas: Float32Array;
    thermo: Float32Array;
    center: { x: number; y: number };
    resolution: number;
    scales: StabilityScales;
}

/** Shows the map (fragmentation), lets the model draw it from its grids as they are, and reads it back with the grids it came from. */
async function readMap(context: LabContext): Promise<MapReading> {
    const { renderer, simulation } = context;
    const model = protostarModel(context);
    model.setParam(PROTOSTAR_PARAM.stabilityMap, 'fragmentation');
    const size = simulation.screenSize.value;
    const center = model.centerOfMass ?? { x: size.x / 2, y: size.y / 2 };
    if (!model.overlay()) throw new Error('the model drew no stability map');
    const target = model.debugStabilityTarget;
    if (!target) throw new Error('the model has no stability target');
    const grids = protostarGrids(context);
    const map = await readTarget(renderer, target);
    const gas = await readTarget(renderer, grids.gas);
    const thermo = await readAttachment(renderer, grids.gas, 1);
    return { map, gas, thermo, center: { x: center.x, y: center.y }, resolution: target.width, scales: scalesOf(context) };
}

const classOf = (q: number, beta: number): number =>
    (q < PROTOSTAR_STABILITY_Q_CRITICAL ? 1 : 0) + (beta < PROTOSTAR_STABILITY_BETA_CRITICAL ? 2 : 0);

/** What the map says about the gas: the shares of the mass (cells of rho >= MIN_DENSITY) where Q < 1, beta < 3, both; the densest cell. */
function summarize(reading: MapReading): Record<string, JsonValue> {
    const { map, thermo, resolution: res, scales } = reading;
    let mass = 0, toomre = 0, cooling = 0, both = 0, densest = -1;
    for (let k = 0; k < res * res; k++) {
        const rho = map[k * 4 + 2];
        if (!(rho >= PROTOSTAR_STABILITY_MIN_DENSITY)) continue;
        const cls = classOf(map[k * 4], map[k * 4 + 1]);
        mass += rho;
        if (cls & 1) toomre += rho;
        if (cls & 2) cooling += rho;
        if (cls === 3) both += rho;
        if (densest < 0 || rho > map[densest * 4 + 2]) densest = k;
    }
    const core = densest < 0 ? null : {
        rho: sig(map[densest * 4 + 2]), q: finite(map[densest * 4]), beta: finite(map[densest * 4 + 1]),
        temperatureMK: sig(reading.gas[densest * 4 + 1] * thermo[densest * 4 + 2] / scales.t0 * PROTOSTAR_T0_KELVIN / 1e6),
        radius: sig(Math.hypot((densest % res + 0.5) * scales.cell - reading.center.x, (Math.floor(densest / res) + 0.5) * scales.cell - reading.center.y)),
    };
    return {
        shareQBelow1: sig(toomre / (mass || 1)), shareBetaBelow3: sig(cooling / (mass || 1)), shareBoth: sig(both / (mass || 1)),
        densest: core,
    };
}

/** Medians of Q and beta of the map's cells (with gas) in the ring of radius `radius` px and half-width `width` px. */
function ringMedians(reading: MapReading, radius: number, width: number): { q: number; beta: number; cells: number } {
    const { map, resolution: res, scales, center } = reading;
    const qs: number[] = [], betas: number[] = [];
    for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
            const k = (j * res + i) * 4;
            if (!(map[k + 2] >= PROTOSTAR_STABILITY_MIN_DENSITY)) continue;
            const r = Math.hypot((i + 0.5) * scales.cell - center.x, (j + 0.5) * scales.cell - center.y);
            if (Math.abs(r - radius) > width) continue;
            qs.push(map[k]);
            betas.push(map[k + 1]);
        }
    }
    return { q: qs.length ? quantile(qs, 0.5) : NaN, beta: betas.length ? quantile(betas, 0.5) : NaN, cells: qs.length };
}

// ---- protostar.stability-map ----

export const stabilityMapAtStart: Scenario = {
    id: 'protostar.stability-map',
    title: 'The stability map (Q, t_cool Omega) of the default cloud at t = 0: GPU against the TypeScript twin, and against Q measured on the particles',
    tags: ['protostar', 'stability', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation } = context;
        await restart(context, { count: STABILITY_PARTICLES });
        await drawAndReduce(context);
        const reading = await readMap(context);
        const { map, resolution: res } = reading;
        const twin = stabilityMap({ gas: reading.gas, thermo: reading.thermo, resolution: res }, reading.center, reading.scales);

        // Parity, over the cells the overlay draws.
        const qDiff: number[] = [], betaDiff: number[] = [];
        let cells = 0, mismatched = 0;
        for (let k = 0; k < res * res; k++) {
            if (!(twin[k * 4 + 2] >= PROTOSTAR_STABILITY_MIN_DENSITY)) continue;
            cells++;
            const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-3);
            qDiff.push(rel(map[k * 4], twin[k * 4]));
            if (twin[k * 4 + 1] < PROTOSTAR_STABILITY_CAP) betaDiff.push(rel(map[k * 4 + 1], twin[k * 4 + 1]));
            if (classOf(map[k * 4], map[k * 4 + 1]) !== classOf(twin[k * 4], twin[k * 4 + 1])) mismatched++;
        }
        const qP99 = quantile(qDiff, 0.99), betaP99 = betaDiff.length ? quantile(betaDiff, 0.99) : 0;
        const ok = qP99 <= STABILITY_PARITY_TOLERANCE && betaP99 <= STABILITY_PARITY_TOLERANCE && mismatched <= STABILITY_CLASS_MISMATCH * cells;

        // What it says, against the particles.
        const count = simulation.activeCount;
        const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
        const velocities = await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count);
        const size = simulation.screenSize.value;
        const radius = PROTOSTAR_CLOUD_RADIUS * Math.min(size.x, size.y);
        const gravity = reading.scales.gravityDensity * Math.PI * radius * radius / TOTAL_MASS;
        const particles = measureToomre(positions, velocities, count, { x: size.x / 2, y: size.y / 2 }, TOTAL_MASS, gravity, 40);
        const rings = STABILITY_RADII.map(fraction => {
            const r = fraction * radius;
            const ring = ringMedians(reading, r, STABILITY_RING_WIDTH * radius);
            const nearest = particles.filter(p => Number.isFinite(p.q))
                .reduce((best, p) => Math.abs(p.radius - r) < Math.abs(best.radius - r) ? p : best);
            return { fraction, cells: ring.cells, qMap: sig(ring.q), betaMap: finite(ring.beta), qParticles: sig(nearest.q), qMapOverParticles: sig(ring.q / nearest.q) };
        });
        const summary = summarize(reading);
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: STABILITY_PARTICLES, cells, qRelativeP99: sig(qP99), qRelativeMax: sig(Math.max(...qDiff)),
                betaRelativeP99: sig(betaP99), betaRelativeMax: sig(betaDiff.length ? Math.max(...betaDiff) : 0), classMismatches: mismatched,
                tolerance: STABILITY_PARITY_TOLERANCE, rings, ...summary,
            },
            details: `GPU vs twin over ${cells} cells: Q p99 ${qP99.toExponential(2)}, beta p99 ${betaP99.toExponential(2)}, ${mismatched} classes differ; `
                + rings.map(r => `${r.fraction} R: Q ${r.qMap} (particles ${r.qParticles}), beta ${r.betaMap}`).join('; ')
                + `; Q < 1 on ${summary.shareQBelow1} of the mass, beta < 3 on ${summary.shareBetaBelow3}, both on ${summary.shareBoth}`,
        };
    },
};

// ---- protostar.stability-evolution ----

export const stabilityEvolution: Scenario = {
    id: 'protostar.stability-evolution',
    title: 'The stability map of the default cloud as it collapses: the shares of the gas where Q < 1, beta < 3 and both, the core\'s Q and beta',
    tags: ['protostar', 'stability'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: STABILITY_PARTICLES });
        const every = Math.max(1, Math.round(STABILITY_EVOLUTION_EVERY / frameSeconds(context)));
        const snapshots: Record<string, JsonValue>[] = [];
        let frames = 0;
        while (frames * frameSeconds(context) < STABILITY_EVOLUTION_SECONDS) {
            await runFrames(context, every, { endFrame: true });
            frames += every;
            const reading = await readMap(context);
            const stats = modelStats(context);
            snapshots.push({
                time: sig(frames * frameSeconds(context)), ...summarize(reading),
                coreTemperatureMK: stats.coreTemperature === null ? null : sig(stats.coreTemperature * PROTOSTAR_T0_KELVIN / 1e6),
                coreDensity: stats.coreDensity === null ? null : sig(stats.coreDensity),
            });
        }
        return {
            status: 'pass',
            metrics: { particles: STABILITY_PARTICLES, snapshots },
            details: snapshots.map(s => `t ${String(s.time)} s: both ${String(s.shareBoth)}, Q<1 ${String(s.shareQBelow1)}, beta<3 ${String(s.shareBetaBelow3)}`).join('; '),
        };
    },
};

export const stabilityScenarios: readonly Scenario[] = [stabilityMapAtStart, stabilityEvolution];
