// The supernova of the sticky dust on the real GPU simulation (docs/spikes/a9-coherent-supernova.md): the homologous, stratified ejection and
// the law of the shock front on a cloud where nothing else acts, the ejecta falling back under gravity, and the history of the default
// cloud's supernovae live in dustSupernovaHistory.ts.

import {
    DUST_GRAVITY_GAIN, GLOBAL_DRAG, GRAVITY_SLIDER, KINETIC_PRESSURE, K_PRESSURE, MAX_SPEED, SHOCK_STRENGTH, STICK_RATE, STICKINESS_SLIDER,
    SUPERNOVA_THRESHOLD_SLIDER,
} from '../../config';
import { frontRadiusAt } from '../../simulation/shockWave';
import { STICKY_DUST_PARAM, STICKY_DUST_STAT } from '../../simulation/stickyDust/declaration';
import { ejectionSpeed, shockKick } from '../../simulation/stickyDust/ejecta';
import type { StickyDustModel } from '../../simulation/stickyDust/gpuModel';
import { FRONT_POWERS, fitFront, fitHomology } from '../blastFit';
import {
    INFALL_DRIFT_LIMIT, INFALL_EQUIVALENCE_LIMIT, LAB_AREA, SUPERNOVA_BIN, SUPERNOVA_BLAST_PARTICLES, SUPERNOVA_DISC_SHARE,
    SUPERNOVA_EDGE_GUARD, SUPERNOVA_EXPONENT_WINDOW, SUPERNOVA_FRONT_SECONDS, SUPERNOVA_FRONT_TOLERANCE, SUPERNOVA_GRAVITY_PARTICLES,
    SUPERNOVA_GRAVITY_SECONDS, SUPERNOVA_HOMOLOGY_MAX_INTERCEPT, SUPERNOVA_HOMOLOGY_MIN_R2, SUPERNOVA_KICK_FLOOR, SUPERNOVA_KICK_SECONDS,
    SUPERNOVA_POWERS, SUPERNOVA_SAMPLE_EVERY, SUPERNOVA_SEED, SUPERNOVA_SLOPE_TOLERANCE, SUPERNOVA_TIMER_FRAMES, SUPERNOVA_WAIT_FRAMES,
} from '../config';
import { frameSeconds, restart, runFrames, stickyDustModel, substepsPerFrame } from '../driver';
import { quantile, significant } from '../numbers';
import { mulberry32, withSeededRandom } from '../random';
import { readPositions } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);

/** Everything the particles' state is made of in a scenario that sets its own cloud: the species of each particle and what the species weigh. */
interface Cloud {
    count: number;
    /** Species index of each particle. */
    species: Uint8Array;
    /** Relative mass of each species (the deposit's splat masses). */
    mass: number[];
    /** The speed factor of each species in the ejection. */
    scale: number[];
}

async function cloudOf(context: LabContext, model: StickyDustModel): Promise<Cloud> {
    const { renderer, simulation } = context;
    const count = simulation.activeCount;
    const initial = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const species = new Uint8Array(count);
    for (let i = 0; i < count; i++) species[i] = Math.round(initial[i * 4 + 2]);
    return {
        count, species, mass: Array.from(simulation.speciesUniforms.splatMass.value as ArrayLike<number>),
        scale: Array.from(model.velocityUniforms.speciesEjectScale.value as ArrayLike<number>),
    };
}

/**
 * The cloud of the blast and of the infall: a disc of the zone's radius at the center of the area holding SUPERNOVA_DISC_SHARE of
 * the particles, the others uniform over the rest of the area. Positions as the position texels have them (x, y, species, 1).
 */
function discAndBackground(cloud: Cloud, zone: number, seed: number): Float32Array {
    const random = mulberry32(seed);
    const cx = LAB_AREA.width / 2, cy = LAB_AREA.height / 2;
    const positions = new Float32Array(cloud.count * 4);
    for (let i = 0; i < cloud.count; i++) {
        let x: number, y: number;
        if (random() < SUPERNOVA_DISC_SHARE) {
            const r = zone * Math.sqrt(random()), a = 2 * Math.PI * random();
            x = cx + r * Math.cos(a);
            y = cy + r * Math.sin(a);
        } else {
            do {
                x = LAB_AREA.width * random();
                y = LAB_AREA.height * random();
            } while (Math.hypot(x - cx, y - cy) <= zone + SUPERNOVA_EDGE_GUARD);
        }
        positions.set([x, y, cloud.species[i], 1], i * 4);
    }
    return positions;
}

/** Switches off everything but the supernova: no pressure, sticking or drag, and no gravity until `gravity` is given. */
function freeFlight(model: StickyDustModel, gravity = 0): void {
    const u = model.velocityUniforms;
    u.kGravity.value = gravity;
    u.kPressure.value = 0;
    u.kineticPressure.value = 0;
    u.globalDrag.value = 0;
    u.stickRate.value = 0;
}

/** What the sliders set and the lab overrides, back to the application's values. */
function restoreDust(model: StickyDustModel): void {
    const u = model.velocityUniforms;
    u.kGravity.value = GRAVITY_SLIDER.default * DUST_GRAVITY_GAIN;
    u.kPressure.value = K_PRESSURE;
    u.kineticPressure.value = KINETIC_PRESSURE;
    u.globalDrag.value = GLOBAL_DRAG;
    u.stickRate.value = STICK_RATE * STICKINESS_SLIDER.default / 100;
    model.setParam(STICKY_DUST_PARAM.supernovaThreshold, SUPERNOVA_THRESHOLD_SLIDER.default);
}

/** One supernova is enough: the threshold goes beyond reach once it has fired. */
const noMoreSupernovae = (model: StickyDustModel): void => model.setParam(STICKY_DUST_PARAM.supernovaThreshold, 1000);

const supernovaCount = (context: LabContext): number => context.simulation.stat(STICKY_DUST_STAT.supernovae) ?? 0;

const speed = (velocities: Float32Array, i: number): number => Math.hypot(velocities[i * 4], velocities[i * 4 + 1]);

/** Mean and extremes of a list of numbers, rounded. */
const spread = (values: readonly number[]): Record<string, JsonValue> => values.length === 0 ? { n: 0 } : {
    n: values.length, median: round(quantile(values, 0.5)), min: round(Math.min(...values)), max: round(Math.max(...values)),
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The blast: a disc at the center of a uniform cloud, nothing else acting. The ejection must be homologous and stratified, the shock
// front must follow R^2 = R0^2 + 2 K t, and what it kicks must be what the formula says.
// ---------------------------------------------------------------------------------------------------------------------------------

export const dustSupernovaBlast: Scenario = {
    id: 'dust.supernova.blast',
    title: 'Sticky dust: a supernova in a cold uniform cloud, ejecta speed against distance and species, the front radius against time',
    tags: ['dust', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: 'Software renderer: hundreds of frames of 300 000 particles would take too long.' };
        const { renderer, simulation } = context;
        await restart(context, { algorithm: 'stickyDust', count: SUPERNOVA_BLAST_PARTICLES, seed: SUPERNOVA_SEED });
        const model = stickyDustModel(context);
        const u = model.velocityUniforms;
        const pipeline = simulation.debugPipeline;
        const cloud = await cloudOf(context, model);
        const { count } = cloud;
        const zone = model.debugParams.concentrationRadius as number;
        const top = u.supernovaSpeed.value;
        const positions = discAndBackground(cloud, zone, SUPERNOVA_SEED);
        const velocities = new Float32Array(count * 4);

        const seconds = frameSeconds(context);
        const substeps = substepsPerFrame(context);
        const substep = seconds / substeps;
        const frames = SUPERNOVA_WAIT_FRAMES + Math.ceil(SUPERNOVA_FRONT_SECONDS / seconds);
        const kickFrame = Math.round((SUPERNOVA_KICK_SECONDS / substep - 1) / substeps);
        const metrics: Record<string, JsonValue> = {};
        const front: [number, number][] = [];
        const frontSeries: JsonValue[] = [];
        let fired = -1;
        let centre = [0, 0];
        let distance = new Float32Array(0);
        let members: number[] = [], background: number[] = [];
        let worstFront = 0;
        const homology: Record<string, JsonValue> = {};
        let homologyOk = true;
        let ordered = true;
        let slopeOfPrevious = Infinity;
        let kickRatios: number[] = [];
        let worstEjectionError = 0;
        let ejecta = 0;
        let outside = 0;
        let clamped = 0;

        try {
            pipeline.debugSetState(positions, velocities);
            freeFlight(model);
            await withSeededRandom(SUPERNOVA_SEED, () => runFrames(context, frames, {
                endFrame: true,
                async onFrame(frame) {
                    if (fired < 0) {
                        if (supernovaCount(context) === 0) return;
                        fired = frame;
                        noMoreSupernovae(model);
                        centre = [u.supernovaCenter.value.x, u.supernovaCenter.value.y];
                        distance = new Float32Array(count);
                        members = [];
                        background = [];
                        for (let i = 0; i < count; i++) {
                            distance[i] = Math.hypot(positions[i * 4] - centre[0], positions[i * 4 + 1] - centre[1]);
                            if (distance[i] <= zone - SUPERNOVA_EDGE_GUARD) members.push(i);
                            else if (distance[i] > zone + SUPERNOVA_EDGE_GUARD) background.push(i);
                        }
                        // The ejection, as it comes out of the first substep (nothing has acted on it since but a second substep's drag-free flight).
                        const v = await readPositions(renderer, pipeline.debugVelocityTarget, count);
                        const radius = u.ejectaRadius.value;
                        ejecta = radius;
                        let px = 0, py = 0, momentumScale = 0, energy = 0, energyBefore = 0, spreadSum = 0, massSum = 0;
                        for (const i of members) {
                            const m = cloud.mass[cloud.species[i]];
                            px += m * v[i * 4];
                            py += m * v[i * 4 + 1];
                            momentumScale += m * speed(v, i);
                            energy += m * speed(v, i) ** 2;
                            energyBefore += m * (top * cloud.scale[cloud.species[i]]) ** 2;
                            spreadSum += m * distance[i] ** 2;
                            massSum += m;
                            const expected = ejectionSpeed(distance[i], radius, top, cloud.scale[cloud.species[i]]);
                            worstEjectionError = Math.max(worstEjectionError, Math.abs(speed(v, i) - expected));
                        }
                        metrics.netMomentumOverSumOfMomenta = round(Math.hypot(px, py) / momentumScale);
                        // The same specific energy as the flat ejection of the model before A9 (every particle at top x its species' factor).
                        metrics.kineticEnergyOverTheFlatEjection = round(energy / energyBefore);
                        metrics.rmsDistanceOfTheMembers = round(Math.sqrt(spreadSum / massSum));
                        const present = [...new Set(members.map(i => cloud.species[i]))].sort((a, b) => a - b);
                        for (const s of present) {
                            // The particles whose speed the velocity pass bounds (outliers of a compact clump, fast light species) are not on the line.
                            const all = members.filter(i => cloud.species[i] === s);
                            const ids = all.filter(i => top * cloud.scale[s] * distance[i] / ejecta < MAX_SPEED);
                            clamped += all.length - ids.length;
                            const fit = fitHomology(ids.map(i => distance[i]), ids.map(i => speed(v, i)));
                            const expected = top * cloud.scale[s] / ejecta;
                            const slopeError = Math.abs(fit.slope / expected - 1);
                            if (!(fit.r2 >= SUPERNOVA_HOMOLOGY_MIN_R2) || !(Math.abs(fit.intercept) <= SUPERNOVA_HOMOLOGY_MAX_INTERCEPT * top * cloud.scale[s])
                                || !(slopeError <= SUPERNOVA_SLOPE_TOLERANCE)) homologyOk = false;
                            if (!(fit.slope < slopeOfPrevious)) ordered = false;
                            slopeOfPrevious = fit.slope;
                            homology[`species${s}`] = {
                                mass: round(cloud.mass[s]), particles: ids.length, scale: round(cloud.scale[s]), slope: round(fit.slope),
                                expectedSlope: round(expected), slopeOverExpected: round(fit.slope / expected), intercept: round(fit.intercept),
                                r2: round(fit.r2),
                            };
                        }
                        return;
                    }
                    const j = frame - fired;
                    const t = (1 + j * substeps) * substep;
                    // The front is followed until it stops (at the farthest corner of the area, or where the kick is negligible).
                    if (t > SUPERNOVA_FRONT_SECONDS || u.shockActive.value === 0 || (j > 6 && j % 4 !== 0 && j !== kickFrame)) return;
                    const v = await readPositions(renderer, pipeline.debugVelocityTarget, count);
                    let observed = 0;
                    for (const i of background) {
                        if (distance[i] > observed && speed(v, i) > SUPERNOVA_KICK_FLOOR) observed = distance[i];
                    }
                    front.push([t, observed]);
                    worstFront = Math.max(worstFront, Math.abs(observed - u.shockOuter.value));
                    frontSeries.push({ t: round(t), observed: round(observed), uniform: round(u.shockOuter.value), law: round(frontRadiusAt(zone, top, t)) });
                    if (j === kickFrame) {
                        kickRatios = [];
                        for (const i of background) {
                            const s = speed(v, i);
                            if (s > SUPERNOVA_KICK_FLOOR) kickRatios.push(s / shockKick(distance[i], zone, top, SHOCK_STRENGTH, cloud.scale[cloud.species[i]]));
                        }
                    }
                },
            }));
            // The gravity passes are scissored to the screen's part of the density field: no particle may have left it (nor be lost).
            const end = await readPositions(renderer, pipeline.debugPositionTarget, count);
            for (let i = 0; i < count; i++) {
                if (!(end[i * 4] >= 0 && end[i * 4] <= LAB_AREA.width && end[i * 4 + 1] >= 0 && end[i * 4 + 1] <= LAB_AREA.height)) outside++;
            }
        } finally {
            restoreDust(model);
        }
        if (fired < 0) return { status: 'fail', metrics: {}, details: `no supernova within ${SUPERNOVA_WAIT_FRAMES} frames` };

        const fit = fitFront(front, FRONT_POWERS);
        const twoK = 2 * zone * top;
        const exponent = 1 / fit.bestPower;
        const frontOk = fit.rmsSedov <= SUPERNOVA_FRONT_TOLERANCE && fit.bestPower >= SUPERNOVA_EXPONENT_WINDOW[0] && fit.bestPower <= SUPERNOVA_EXPONENT_WINDOW[1]
            && Math.abs(fit.squared.slope / twoK - 1) <= SUPERNOVA_SLOPE_TOLERANCE && worstFront <= SUPERNOVA_FRONT_TOLERANCE;
        const kicksOk = kickRatios.length > 0 && Math.abs(quantile(kickRatios, 0.5) - 1) <= 1e-3 && Math.max(...kickRatios) <= 1.01 && Math.min(...kickRatios) >= 0.99;
        const ok = homologyOk && ordered && frontOk && kicksOk && worstEjectionError <= 1e-2 * top && outside === 0;
        Object.assign(metrics, {
            particles: count, zoneRadius: zone, ejectaRadius: round(ejecta), ejectionSpeed: round(top), members: members.length, background: background.length,
            ejectionFiredAtFrame: fired, particlesOutsideTheScreenAtTheEnd: outside, ejectaAtTheMaximumSpeed: clamped, substepSeconds: round(substep), worstEjectionSpeedError: round(worstEjectionError),
            homology, slopesDecreaseWithMass: ordered,
            front: {
                samples: front.length, seconds: round(front[front.length - 1][0]), finalRadius: round(front[front.length - 1][1]),
                r2OfSquaredRadiusAgainstTime: round(fit.squared.r2), slopeOverTwoK: round(fit.squared.slope / twoK),
                interceptOverStartRadiusSquared: round(fit.squared.intercept / (zone * zone)),
                bestPower: round(fit.bestPower), exponentOfTime: round(exponent), rmsConstantSpeed: round(fit.rmsLinear), rmsLaw: round(fit.rmsSedov),
                rmsBestPower: round(fit.rmsBest), worstGapToTheUniform: round(worstFront), series: frontSeries,
            },
            kicks: { atSeconds: SUPERNOVA_KICK_SECONDS, kicked: kickRatios.length, ratioToFormula: spread(kickRatios) },
        });
        return {
            status: ok ? 'pass' : 'fail', metrics,
            details: `ejecta speed against distance: ${Object.entries(homology).map(([k, h]) => `${k} slope ${(h as { slopeOverExpected: number }).slopeOverExpected} of the formula, R^2 ${(h as { r2: number }).r2}`).join('; ')}; `
                + `front: R^2 linear in t with slope ${fit.squared.slope.toFixed(0)} (2 K = ${twoK.toFixed(0)}), best power ${fit.bestPower.toFixed(2)} (exponent ${exponent.toFixed(3)}), `
                + `RMS ${fit.rmsSedov.toFixed(2)} px against ${fit.rmsLinear.toFixed(2)} px for a constant speed; kicks ${kickRatios.length} at ${spread(kickRatios).median} of the formula`,
        };
    },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The infall: a blob holding every particle, ejected with and without gravity from the instant of the ejection. Gravity acts during the
// ejection timer (the equivalence principle) and what does not escape falls back.
// ---------------------------------------------------------------------------------------------------------------------------------

interface InfallSample {
    /** Seconds after the ejection (the end of the frame's substeps). */
    t: number;
    frame: number;
    /** Mass-weighted mean radial speed, mean distance (in zones) and share of the mass inside the zone, of the ejecta. */
    meanRadialSpeed: number;
    meanDistance: number;
    inside: number;
    /** Mean radial speed by species, of the ejecta that started in SUPERNOVA_BIN. */
    byBin: number[];
}

interface InfallArm {
    power: number;
    gravity: boolean;
    firedAtFrame: number;
    samples: InfallSample[];
}

async function infallArm(context: LabContext, power: number, gravityOn: boolean): Promise<InfallArm> {
    const { renderer, simulation } = context;
    await restart(context, { algorithm: 'stickyDust', count: SUPERNOVA_GRAVITY_PARTICLES, seed: SUPERNOVA_SEED, params: { [STICKY_DUST_PARAM.supernovaPower]: power } });
    const model = stickyDustModel(context);
    const u = model.velocityUniforms;
    const pipeline = simulation.debugPipeline;
    const cloud = await cloudOf(context, model);
    const { count } = cloud;
    const zone = model.debugParams.concentrationRadius as number;
    const positions = discAndBackground(cloud, zone, SUPERNOVA_SEED);
    const seconds = frameSeconds(context);
    const substeps = substepsPerFrame(context);
    const substep = seconds / substeps;
    const samples: InfallSample[] = [];
    let fired = -1;
    let centre = [0, 0];
    const members: number[] = [];
    const initialDistance = new Float32Array(count);
    const timerFrames: readonly number[] = SUPERNOVA_TIMER_FRAMES;
    try {
        pipeline.debugSetState(positions, new Float32Array(count * 4));
        freeFlight(model);
        await withSeededRandom(SUPERNOVA_SEED, () => runFrames(context, SUPERNOVA_WAIT_FRAMES + Math.ceil(SUPERNOVA_GRAVITY_SECONDS / seconds), {
            endFrame: true,
            async onFrame(frame) {
                if (fired < 0) {
                    if (supernovaCount(context) === 0) return;
                    fired = frame;
                    noMoreSupernovae(model);
                    // The cloud has not moved: nothing acted on it. Gravity comes in now, for the arm that has it, with the ejection timer still running.
                    if (gravityOn) u.kGravity.value = GRAVITY_SLIDER.default * DUST_GRAVITY_GAIN;
                    centre = [u.supernovaCenter.value.x, u.supernovaCenter.value.y];
                    for (let i = 0; i < count; i++) {
                        initialDistance[i] = Math.hypot(positions[i * 4] - centre[0], positions[i * 4 + 1] - centre[1]);
                        if (initialDistance[i] <= zone - SUPERNOVA_EDGE_GUARD) members.push(i);
                    }
                    return;
                }
                const j = frame - fired;
                const t = (1 + j * substeps) * substep;
                if (t > SUPERNOVA_GRAVITY_SECONDS || !(timerFrames.includes(j) || j % SUPERNOVA_SAMPLE_EVERY === 0)) return;
                const p = await readPositions(renderer, pipeline.debugPositionTarget, count);
                const v = await readPositions(renderer, pipeline.debugVelocityTarget, count);
                let mass = 0, radial = 0, distance = 0, inside = 0;
                const bin = cloud.mass.map(() => ({ sum: 0, n: 0 }));
                for (const i of members) {
                    const dx = p[i * 4] - centre[0], dy = p[i * 4 + 1] - centre[1];
                    const r = Math.hypot(dx, dy);
                    const m = cloud.mass[cloud.species[i]];
                    const vr = r > 1e-6 ? (v[i * 4] * dx + v[i * 4 + 1] * dy) / r : 0;
                    mass += m;
                    radial += m * vr;
                    distance += m * r / zone;
                    if (r <= zone) inside += m;
                    const a = initialDistance[i] / zone;
                    if (a >= SUPERNOVA_BIN[0] && a <= SUPERNOVA_BIN[1]) {
                        bin[cloud.species[i]].sum += vr;
                        bin[cloud.species[i]].n++;
                    }
                }
                samples.push({
                    t, frame: j, meanRadialSpeed: radial / mass, meanDistance: distance / mass, inside: inside / mass,
                    byBin: bin.map(b => b.n > 0 ? b.sum / b.n : NaN),
                });
            },
        }));
    } finally {
        restoreDust(model);
    }
    return { power, gravity: gravityOn, firedAtFrame: fired, samples };
}

const sampleAt = (arm: InfallArm, frame: number): InfallSample | undefined => arm.samples.find(s => s.frame === frame);
const armSeries = (arm: InfallArm): JsonValue[] => arm.samples.filter(s => s.frame % 40 === 0 || (SUPERNOVA_TIMER_FRAMES as readonly number[]).includes(s.frame))
    .map(s => ({ t: round(s.t), meanRadialSpeed: round(s.meanRadialSpeed), meanDistanceInZones: round(s.meanDistance), insideZone: round(s.inside) }));

export const dustSupernovaInfall: Scenario = {
    id: 'dust.supernova.infall',
    title: 'Sticky dust: the ejecta fall under gravity from the first instant (equivalence principle), and what does not escape comes back',
    tags: ['dust', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: 'Software renderer: too slow.' };
        const arms: InfallArm[] = [];
        for (const power of SUPERNOVA_POWERS) for (const gravity of [false, true]) arms.push(await infallArm(context, power, gravity));
        // Compared while the fastest ejecta have not reached a wall (a reflection changes the radial speed of the arm without gravity too).
        const compareFrame = SUPERNOVA_TIMER_FRAMES[1];
        const metrics: Record<string, JsonValue> = {};
        let ok = arms.every(a => a.firedAtFrame >= 0);
        const details: string[] = [];
        for (const power of SUPERNOVA_POWERS) {
            const off = arms.find(a => a.power === power && !a.gravity) as InfallArm;
            const on = arms.find(a => a.power === power && a.gravity) as InfallArm;
            // Nothing acts on the arm without gravity: the mean radial speed stays what the ejection made it (until the fastest ejecta reach the walls).
            const offSpeeds = off.samples.filter(s => s.frame <= compareFrame).map(s => s.meanRadialSpeed);
            const offDrift = (Math.max(...offSpeeds) - Math.min(...offSpeeds)) / Math.abs(offSpeeds[0]);
            // During the ejection timer: gravity has already slowed the ejecta, by how much, and the same for every species in the same bin.
            const slowed = sampleAt(on, compareFrame) && sampleAt(off, compareFrame)
                ? ((sampleAt(on, compareFrame) as InfallSample).meanRadialSpeed - (sampleAt(off, compareFrame) as InfallSample).meanRadialSpeed) / Math.abs((sampleAt(off, compareFrame) as InfallSample).meanRadialSpeed)
                : NaN;
            const firstFrame = SUPERNOVA_TIMER_FRAMES[0];
            const byBinOn = (sampleAt(on, firstFrame) as InfallSample).byBin, byBinOff = (sampleAt(off, firstFrame) as InfallSample).byBin;
            const deceleration = byBinOn.map((x, s) => (x - byBinOff[s]) / ((sampleAt(on, firstFrame) as InfallSample).t)).filter(x => Number.isFinite(x));
            const strength = deceleration.map(Math.abs);
            const ratio = strength.length > 0 ? Math.max(...strength) / Math.min(...strength) : NaN;
            // Falling back: the mean radial speed turns negative and the ejecta come back toward the center (their mean distance falls
            // below half of what it was at the first sample), which the arm without gravity never does.
            const distances = on.samples.map(s => s.meanDistance);
            const farthest = Math.max(...distances);
            const last = on.samples[on.samples.length - 1];
            const offLast = off.samples[off.samples.length - 1];
            const infall = on.samples.some(s => s.meanRadialSpeed < 0);
            const closest = Math.min(...distances.slice(1));
            const fellBack = infall && closest < 0.5 * distances[0];
            const offFellBack = off.samples.some(s => s.meanRadialSpeed < 0) && Math.min(...off.samples.map(s => s.meanDistance).slice(1)) < 0.5 * off.samples[0].meanDistance;
            if (!(offDrift < INFALL_DRIFT_LIMIT) || !(slowed < -0.01) || !(ratio < INFALL_EQUIVALENCE_LIMIT) || offFellBack) ok = false;
            if (power === Math.min(...SUPERNOVA_POWERS) && !fellBack) ok = false;
            metrics[`power${power}`] = {
                withoutGravity: { driftOfMeanRadialSpeed: round(offDrift), series: armSeries(off), finalMeanDistanceInZones: round(offLast.meanDistance), finalInsideZone: round(offLast.inside) },
                withGravity: {
                    series: armSeries(on), farthestMeanDistanceInZones: round(farthest), closestMeanDistanceInZones: round(closest), finalMeanDistanceInZones: round(last.meanDistance),
                    finalInsideZone: round(last.inside), meanRadialSpeedTurnsNegative: infall, fellBack,
                },
                slowedDuringTimer: round(slowed), comparedAtFrame: compareFrame, decelerationOfSpeciesInBin: spread(deceleration), decelerationRatioMaxOverMin: round(ratio),
            };
            details.push(`power ${power} %: mean radial speed ${(100 * slowed).toFixed(0)} % against the arm without gravity inside the ejection timer (frame ${compareFrame}), deceleration max/min over species ${ratio.toFixed(2)}; `
                + `mean distance of the ejecta ${distances[0].toFixed(2)} zones at first, farthest ${farthest.toFixed(2)}, closest after ${closest.toFixed(2)}, ${last.meanDistance.toFixed(2)} at the end (without gravity ${offLast.meanDistance.toFixed(2)}); `
                + `${infall ? 'falls back' : 'does not fall back'}`);
        }
        metrics.particles = SUPERNOVA_GRAVITY_PARTICLES;
        metrics.seconds = SUPERNOVA_GRAVITY_SECONDS;
        return { status: ok ? 'pass' : 'fail', metrics, details: details.join('; ') };
    },
};

export const dustSupernovaScenarios: Scenario[] = [dustSupernovaBlast, dustSupernovaInfall];
