// The history of the sticky dust's supernovae in the default cloud (docs/spikes/a9-coherent-supernova.md): when they fire, what triggers them
// and what becomes of their ejecta. It reads only the application's public surface (the stats, the uniforms of the velocity pass and the
// state textures), so it runs on the builds before and after the change of the supernova too, which is how the two are compared.

import { DENSITY_RES, REST_DENSITY } from '../../config';
import { STICKY_DUST_STAT } from '../../simulation/stickyDust/declaration';
import { clumpStats } from '../clumpStats';
import {
    DUST_CLOUD_CLUMP_MIN_TEXELS, SUPERNOVA_HISTORY_FOLLOW_SECONDS, SUPERNOVA_HISTORY_FRAMES, SUPERNOVA_HISTORY_MARKS,
    SUPERNOVA_HISTORY_PROFILE, SUPERNOVA_HISTORY_SAMPLE, SUPERNOVA_SEED, SUPERNOVA_SWEEP_SEEDS, SUPERNOVA_SWEEP_SPEEDS,
} from '../config';
import { frameSeconds, restart, runFrames, stickyDustModel } from '../driver';
import { significant } from '../numbers';
import { withSeededRandom } from '../random';
import { readPositions, readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const round = (v: number): number => significant(v, 4);
const supernovaCount = (context: LabContext): number => context.simulation.stat(STICKY_DUST_STAT.supernovae) ?? 0;

interface EventTrack {
    time: number;
    frame: number;
    centre: [number, number];
    /** The concentration meter at the read-back that triggered it. */
    concentration: number | null;
    members: Int32Array;
    memberMassShare: number;
    /** Share of the total mass within each of SUPERNOVA_HISTORY_PROFILE px of the center, at the event, and the rms distance (px) of the zone's mass. */
    profile: number[];
    spread: number;
    /** Seconds after the event, mean distance of the ejecta to the center (in zones), share of their mass inside the zone. */
    samples: { dt: number; meanDistance: number; inside: number }[];
}

interface HistoryRun {
    particles: number;
    seconds: number;
    zone: number;
    events: EventTrack[];
    grid: { t: number; denseMassFraction: number; clumps: number; peak: number; concentration: number | null }[];
}

/**
 * The default cloud for SUPERNOVA_HISTORY_FRAMES frames with its supernovae, the ejecta of each followed for SUPERNOVA_HISTORY_FOLLOW_SECONDS.
 * `edgeSpeed` (px/s), when given, replaces the ejection speed the power slider sets (the sweeps go beyond the slider's range).
 */
async function runHistory(context: LabContext, edgeSpeed: number | null, seed = SUPERNOVA_SEED): Promise<HistoryRun> {
    const { renderer, simulation } = context;
    await restart(context, { algorithm: 'stickyDust', count: 400000, seed });
    const model = stickyDustModel(context);
    if (edgeSpeed !== null) model.velocityUniforms.supernovaSpeed.value = edgeSpeed;
    const density = model.debugDensity;
    const pipeline = simulation.debugPipeline;
    const count = simulation.activeCount;
    const seconds = frameSeconds(context);
    const mass = Array.from(simulation.speciesUniforms.splatMass.value as ArrayLike<number>);
    const zone = model.debugParams.concentrationRadius as number;
    const events: EventTrack[] = [];
    const grid: HistoryRun['grid'] = [];
    let seen = 0;
    let totalMass = 0;
    await withSeededRandom(seed, () => runFrames(context, SUPERNOVA_HISTORY_FRAMES, {
        endFrame: true,
        async onFrame(frame) {
            const fired = supernovaCount(context);
            const sampling = frame % SUPERNOVA_HISTORY_SAMPLE === 0;
            if (fired === seen && !sampling) return;
            const tracking = events.some(e => frame * seconds - e.time <= SUPERNOVA_HISTORY_FOLLOW_SECONDS);
            const p = fired > seen || (sampling && tracking) ? await readPositions(renderer, pipeline.debugPositionTarget, count) : null;
            const centre = model.velocityUniforms.supernovaCenter.value;
            if (fired > seen && p) {
                seen = fired;
                if (totalMass === 0) for (let i = 0; i < count; i++) totalMass += mass[Math.round(p[i * 4 + 2])];
                const ids: number[] = [];
                let held = 0, moment = 0;
                const within = SUPERNOVA_HISTORY_PROFILE.map(() => 0);
                for (let i = 0; i < count; i++) {
                    const r = Math.hypot(p[i * 4] - centre.x, p[i * 4 + 1] - centre.y);
                    if (r > zone) continue;
                    const m = mass[Math.round(p[i * 4 + 2])];
                    ids.push(i);
                    held += m;
                    moment += m * r * r;
                    SUPERNOVA_HISTORY_PROFILE.forEach((radius, k) => { if (r <= radius) within[k] += m; });
                }
                events.push({
                    time: frame * seconds, frame, centre: [centre.x, centre.y], concentration: simulation.stat(STICKY_DUST_STAT.concentration),
                    members: Int32Array.from(ids), memberMassShare: held / totalMass, profile: within.map(m => m / totalMass), spread: Math.sqrt(moment / held), samples: [],
                });
            }
            if (sampling) {
                const rgba = await readTarget(renderer, density.target);
                const stats = clumpStats(rgba, DENSITY_RES, REST_DENSITY, DUST_CLOUD_CLUMP_MIN_TEXELS);
                grid.push({
                    t: frame * seconds, denseMassFraction: stats.denseMassFraction, clumps: stats.clumps, peak: stats.peak,
                    concentration: simulation.stat(STICKY_DUST_STAT.concentration),
                });
                if (p) {
                    for (const e of events) {
                        const dt = frame * seconds - e.time;
                        if (dt > SUPERNOVA_HISTORY_FOLLOW_SECONDS || dt <= 0) continue;
                        let m = 0, distance = 0, inside = 0;
                        for (const i of e.members) {
                            const r = Math.hypot(p[i * 4] - e.centre[0], p[i * 4 + 1] - e.centre[1]);
                            const w = mass[Math.round(p[i * 4 + 2])];
                            m += w;
                            distance += w * r / zone;
                            if (r <= zone) inside += w;
                        }
                        e.samples.push({ dt, meanDistance: distance / m, inside: inside / m });
                    }
                }
            }
        },
    }));
    return { particles: count, seconds: SUPERNOVA_HISTORY_FRAMES * seconds, zone, events, grid };
}

/** What the ejecta of an event are doing `mark` seconds after it (the nearest sample, within one sampling interval), null when it was not followed that far. */
function ejectaAt(run: HistoryRun, e: EventTrack, mark: number): { meanDistanceInZones: number; insideZone: number } | null {
    const nearest = e.samples.reduce<EventTrack['samples'][number] | null>((best, s) => !best || Math.abs(s.dt - mark) < Math.abs(best.dt - mark) ? s : best, null);
    const interval = run.seconds / SUPERNOVA_HISTORY_FRAMES * SUPERNOVA_HISTORY_SAMPLE;
    return nearest && Math.abs(nearest.dt - mark) <= interval ? { meanDistanceInZones: round(nearest.meanDistance), insideZone: round(nearest.inside) } : null;
}

const historyMetrics = (run: HistoryRun): Record<string, JsonValue> => ({
    particles: run.particles, seconds: round(run.seconds), zoneRadius: run.zone, supernovae: run.events.length, times: run.events.map(e => round(e.time)),
    events: run.events.map(e => ({
        time: round(e.time), centre: [Math.round(e.centre[0]), Math.round(e.centre[1])], concentration: e.concentration === null ? null : round(e.concentration),
        members: e.members.length, massShareOfTheZone: round(e.memberMassShare), rmsDistance: round(e.spread), massShareWithin: Object.fromEntries(SUPERNOVA_HISTORY_PROFILE.map((radius, k) => [`${radius}px`, round(e.profile[k])])),
        ejecta: Object.fromEntries(SUPERNOVA_HISTORY_MARKS.map(mark => [`after${mark}s`, ejectaAt(run, e, mark)])),
    })),
    grid: run.grid.filter((_, i) => i % 5 === 4 || i === run.grid.length - 1).map(g => ({
        t: round(g.t), denseMassFraction: round(g.denseMassFraction), clumps: g.clumps, peak: round(g.peak),
        concentration: g.concentration === null ? null : round(g.concentration),
    })),
});

const timesOf = (run: HistoryRun): string => run.events.map(e => `${e.time.toFixed(2)} s`).join(', ') || 'none';

export const dustSupernovaHistory: Scenario = {
    id: 'dust.supernova.history',
    title: 'Sticky dust: the supernovae of the default cloud over 30 s (times, triggers, what becomes of the ejecta)',
    tags: ['dust', 'baseline', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const run = await runHistory(context, null);
        const last = run.grid[run.grid.length - 1];
        const at4 = run.events.map(e => ejectaAt(run, e, 4)).map(m => m ? `${m.meanDistanceInZones} zones` : 'n/a').join(', ');
        return {
            status: run.events.length > 0 ? 'pass' : 'fail', metrics: historyMetrics(run),
            details: `${run.events.length} supernovae in ${run.seconds.toFixed(0)} s, at ${timesOf(run)}; ejecta after 4 s: ${at4}; `
                + `at the end ${(100 * last.denseMassFraction).toFixed(1)} % of the mass dense, ${last.clumps} clumps`,
        };
    },
};

/** The same run for several ejection speeds (px/s at the edge of the zone; the default is 70 % of SUPERNOVA_SPEED): the data of the retuning. */
export const dustSupernovaSweep: Scenario = {
    id: 'dust.supernova.sweep',
    title: 'Sticky dust: the default cloud\'s supernovae at other ejection speeds (tuning of SUPERNOVA_SPEED)',
    tags: ['dust', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const arms: Record<string, JsonValue> = {};
        const lines: string[] = [];
        for (const speed of SUPERNOVA_SWEEP_SPEEDS) {
            for (let k = 0; k < SUPERNOVA_SWEEP_SEEDS; k++) {
                const run = await runHistory(context, speed, SUPERNOVA_SEED + k);
                const last = run.grid[run.grid.length - 1];
                const at = (mark: number): string => run.events.map(e => ejectaAt(run, e, mark)).map(m => m ? String(m.meanDistanceInZones) : '-').join('/');
                arms[`speed${speed}.seed${k}`] = historyMetrics(run);
                lines.push(`${speed} px/s, seed ${k}: ${run.events.length} at ${timesOf(run)}; distance in zones after 2 s ${at(2)}, after 4 s ${at(4)}; `
                    + `end ${(100 * last.denseMassFraction).toFixed(0)} % dense, ${last.clumps} clumps`);
            }
        }
        return { status: 'pass', metrics: arms, details: lines.join(' | ') };
    },
};

export const dustSupernovaHistoryScenarios: Scenario[] = [dustSupernovaHistory, dustSupernovaSweep];
