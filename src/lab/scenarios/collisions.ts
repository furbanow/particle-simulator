// Acceptance of the collisions of the protostar's gas (proposal C1, the `collisions` flag; docs/spikes/c1-mpc-collisions.md), on gases
// set up directly (the model's debug initial state) without gravity, cooling, heating or fusion, with elastic walls and one substep of
// BASE_DT per frame:
//  - protostar.collisions.parity: one substep in the collisional limit against the CPU twin (collisionStep() of collisions.ts);
//  - protostar.collisions.conservation: the momentum and the energy of a gas that collides for COLLISION_CONSERVATION_FRAMES;
//  - protostar.collisions.sod: Sod's shock tube against the exact solution (riemann.ts) for several gammas: the gas is planar, gamma = 2;
//  - protostar.collisions.sound-speed: the frequency of a standing sound wave, cs = sqrt(gamma P / rho) = sqrt(2) sigma;
//  - protostar.collisions.equipartition: hydrogen and helium parcels of different dispersions reach the same one, at a rate that falls with
//    the number of particles per cell.
// Each runs in the collisional limit (every cell collides at every substep), at the application's collision rate, and without collisions.

import { BASE_DT, PROTOSTAR_COLLISION_ANGLE, PROTOSTAR_COLLISION_RATE, PROTOSTAR_GAS_GAMMA, PROTOSTAR_GRID_RES } from '../../config';
import type { InitialState } from '../../simulation/gpuModel';
import { collisionShift, collisionStep, soundSpeed, type CollisionScales } from '../../simulation/protostar/collisions';
import {
    COLLISION_ALWAYS, COLLISION_CONSERVATION, COLLISION_CONSERVATION_DRIFT, COLLISION_CONSERVATION_FRAMES, COLLISION_GAS_OVERRIDES,
    COLLISION_PARITY_BULK, COLLISION_PARITY_MARGIN, COLLISION_PARITY_PARTICLES, COLLISION_PARITY_TOLERANCE, COLLISION_SEED, COLLISION_SIGMA,
    ELASTIC_WALLS, EQUIPARTITION_COUNTS, EQUIPARTITION_FRAMES, EQUIPARTITION_RATIO, EQUIPARTITION_READ_EVERY, LAB_AREA, SOD_BINS,
    SOD_DENSITY_RATIO, SOD_GAMMAS, SOD_PARTICLES, SOD_PRESSURE_RATIO, SOD_SECONDS, SOUND_AMPLITUDE, SOUND_MODE, SOUND_PARTICLES,
    SOUND_READ_EVERY, SOUND_SECONDS,
} from '../config';
import { protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { significant } from '../numbers';
import { eFoldingTime, fitDampedCosine } from '../oscillation';
import { mulberry32 } from '../random';
import { readPositions, readTarget } from '../readback';
import { rightShockSpeed, starRegion, type GasState } from '../riemann';
import { columnProfiles, normalizedProfiles, profileErrors, type TubeUnits } from '../shockTube';
import { gaussianPair, LAB_CELL, LAB_T0 } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const W = LAB_AREA.width;
const H = LAB_AREA.height;
const WARMUP_COUNT = 1000;
const round = (v: number): number => significant(v, 4);
const HYDROGEN = 0;
const HELIUM = 1;

/** The three ways a scenario runs: every cell colliding at every substep, the application's rate, no collision. */
const MODES = [
    { name: 'collisional limit', collisions: true, rate: COLLISION_ALWAYS },
    { name: 'application rate', collisions: true, rate: PROTOSTAR_COLLISION_RATE },
    { name: 'no collisions', collisions: false, rate: PROTOSTAR_COLLISION_RATE },
] as const;

/** Writes particle i of an initial state: position, type, alive; velocity. */
function put(state: InitialState, i: number, x: number, y: number, vx: number, vy: number, type = HYDROGEN): void {
    state.positions.set([x, y, type, 1], i * 4);
    state.velocities.set([vx, vy, 0, 0], i * 4);
}

/** Restarts the protostar with the gas `fill` writes (`count` particles), the collisions on or off at `rate`, elastic walls, one substep per frame. */
async function startGas(context: LabContext, count: number, fill: (state: InitialState) => void, collisions: boolean, rate: number): Promise<void> {
    // The running algorithm must be the protostar before its model can be given the initial state.
    await restart(context, { count: WARMUP_COUNT });
    const model = protostarModel(context);
    model.debugInitialState = fill;
    try {
        await restart(context, { count, overrides: { ...COLLISION_GAS_OVERRIDES }, params: { collisions }, timeScale: 1, seed: COLLISION_SEED });
    } finally {
        model.debugInitialState = null;
    }
    model.velocityUniforms.restitution.value = ELASTIC_WALLS;
    model.debugGrids.common.collisionRate.value = rate;
}

/** The velocities and the positions of the first `count` particles (4 floats each). */
async function readState(context: LabContext, count: number): Promise<{ positions: Float32Array; velocities: Float32Array }> {
    const { renderer, simulation } = context;
    await context.sync.wait(simulation.positionTexture);
    return {
        positions: await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count),
        velocities: await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count),
    };
}

/** Sums of the momentum and the kinetic energy (per unit particle mass) of 4-float velocities, in float64. */
function totals(velocities: ArrayLike<number>, count: number): { px: number; py: number; energy: number } {
    let px = 0, py = 0, energy = 0;
    for (let i = 0; i < count; i++) {
        const vx = velocities[i * 4], vy = velocities[i * 4 + 1];
        px += vx;
        py += vy;
        energy += vx * vx + vy * vy;
    }
    return { px, py, energy: energy / 2 };
}

/** A thermal gas of `count` particles moving at `bulk`, uniform inside the area but `margin` px. */
function thermalFill(count: number, margin: number, bulk: readonly [number, number], keep: { positions?: Float32Array; velocities?: Float32Array }) {
    return (state: InitialState): void => {
        const random = mulberry32(COLLISION_SEED);
        for (let i = 0; i < count; i++) {
            const [gx, gy] = gaussianPair(random(), random());
            put(state, i, margin + random() * (W - 2 * margin), margin + random() * (H - 2 * margin),
                bulk[0] + COLLISION_SIGMA * gx, bulk[1] + COLLISION_SIGMA * gy);
        }
        keep.positions = state.positions.slice(0, count * 4);
        keep.velocities = state.velocities.slice(0, count * 4);
    };
}

// ---- Parity with the twin ----

export const collisionParity: Scenario = {
    id: 'protostar.collisions.parity',
    title: 'Collisions of the gas (C1): one substep in the collisional limit, the GPU velocities against the CPU twin (collisions.ts)',
    tags: ['protostar', 'collisions', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const count = COLLISION_PARITY_PARTICLES;
        const keep: { positions?: Float32Array; velocities?: Float32Array } = {};
        await startGas(context, count, thermalFill(count, COLLISION_PARITY_MARGIN, COLLISION_PARITY_BULK, keep), true, COLLISION_ALWAYS);
        context.simulation.step();
        const after = (await readState(context, count)).velocities;
        const positions = keep.positions ?? new Float32Array(0), before = keep.velocities ?? new Float32Array(0);
        // The CPU twin from the same float32 state: the first substep of a run has the seed 1 (the model counts them from a restart), and
        // owes no kick (G = 0 anyway).
        const pick = (a: Float32Array, c: number): Float64Array => Float64Array.from({ length: count }, (_, i) => a[i * 4 + c]);
        const scales: CollisionScales = { cell: LAB_CELL, densityPerParticle: 1, t0: LAB_T0, rate: COLLISION_ALWAYS, angle: PROTOSTAR_COLLISION_ANGLE };
        const reference = collisionStep({ x: pick(positions, 0), y: pick(positions, 1), vx: pick(before, 0), vy: pick(before, 1) },
            collisionShift(1, LAB_CELL), 1, BASE_DT, scales);
        let worst = 0, changed = 0;
        for (let i = 0; i < count; i++) {
            worst = Math.max(worst, Math.abs(after[i * 4] - reference.vx[i]), Math.abs(after[i * 4 + 1] - reference.vy[i]));
            if (Math.abs(after[i * 4] - before[i * 4]) > 1e-3 * COLLISION_SIGMA) changed++;
        }
        const cells = [...reference.cells.values()];
        const t0 = totals(before, count), t1 = totals(after, count);
        const momentum = Math.hypot(t1.px - t0.px, t1.py - t0.py) / (count * COLLISION_SIGMA);
        const energy = Math.abs(t1.energy / t0.energy - 1);
        const metrics: Record<string, JsonValue> = {
            particles: count, cells: cells.length, cellsThatCollided: cells.filter(c => c.sign !== 0).length,
            particlesChanged: changed, worstOverSigma: round(worst / COLLISION_SIGMA), momentumOverNSigma: round(momentum), energyChange: round(energy),
        };
        const ok = worst / COLLISION_SIGMA < COLLISION_PARITY_TOLERANCE && momentum < COLLISION_CONSERVATION && energy < COLLISION_CONSERVATION
            && changed > count / 2;
        return {
            status: ok ? 'pass' : 'fail', metrics,
            details: `${changed} of ${count} velocities turned; GPU against twin ${round(worst / COLLISION_SIGMA)} sigma at worst; momentum ${round(momentum)} N sigma, energy ${round(energy)}`,
        };
    },
};

// ---- Conservation over many substeps ----

export const collisionConservation: Scenario = {
    id: 'protostar.collisions.conservation',
    title: 'Collisions of the gas (C1): the momentum and the energy of a moving gas over many substeps, with and without the collisions',
    tags: ['protostar', 'collisions', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const count = COLLISION_PARITY_PARTICLES;
        const runs: Record<string, JsonValue>[] = [];
        let ok = true;
        for (const mode of MODES) {
            const keep: { positions?: Float32Array; velocities?: Float32Array } = {};
            await startGas(context, count, thermalFill(count, COLLISION_PARITY_MARGIN, COLLISION_PARITY_BULK, keep), mode.collisions, mode.rate);
            await runFrames(context, COLLISION_CONSERVATION_FRAMES);
            const { positions, velocities } = await readState(context, count);
            const before = keep.velocities ?? new Float32Array(0);
            const t0 = totals(before, count), t1 = totals(velocities, count);
            let nearWall = 0, changed = 0;
            for (let i = 0; i < count; i++) {
                const x = positions[i * 4], y = positions[i * 4 + 1];
                if (x < 1 || y < 1 || x > W - 1 || y > H - 1) nearWall++;
                if (Math.abs(velocities[i * 4] - before[i * 4]) > 1e-3 * COLLISION_SIGMA) changed++;
            }
            const momentum = Math.hypot(t1.px - t0.px, t1.py - t0.py) / (count * COLLISION_SIGMA);
            const energy = t1.energy / t0.energy - 1;
            ok &&= nearWall === 0 && momentum < COLLISION_CONSERVATION_DRIFT && Math.abs(energy) < COLLISION_CONSERVATION_DRIFT;
            runs.push({ mode: mode.name, particlesChanged: changed, particlesAtAWall: nearWall, momentumOverNSigma: round(momentum), energyChange: round(energy) });
        }
        return {
            status: ok ? 'pass' : 'fail', metrics: { particles: count, frames: COLLISION_CONSERVATION_FRAMES, runs },
            details: runs.map(r => `${r.mode}: momentum ${r.momentumOverNSigma}, energy ${r.energyChange}`).join('; '),
        };
    },
};

// ---- Sod's shock tube ----

/** The tube's left half holds SOD_DENSITY_RATIO times the particles of the right one, at a pressure SOD_PRESSURE_RATIO times higher. */
function sodFill(count: number) {
    const left = Math.round(count * SOD_DENSITY_RATIO / (SOD_DENSITY_RATIO + 1));
    const rightSigma = COLLISION_SIGMA * Math.sqrt(SOD_DENSITY_RATIO / SOD_PRESSURE_RATIO);
    const fill = (state: InitialState): void => {
        const random = mulberry32(COLLISION_SEED);
        for (let i = 0; i < count; i++) {
            const inLeft = i < left;
            const sigma = inLeft ? COLLISION_SIGMA : rightSigma;
            const [gx, gy] = gaussianPair(random(), random());
            put(state, i, (inLeft ? 0 : W / 2) + random() * W / 2, random() * H, sigma * gx, sigma * gy);
        }
    };
    return { fill, left };
}

export const collisionSod: Scenario = {
    id: 'protostar.collisions.sod',
    title: 'Collisions of the gas (C1): Sod\'s shock tube against the exact solution for several gammas (the planar gas has gamma = 2)',
    tags: ['protostar', 'collisions', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const count = SOD_PARTICLES;
        const leftState: GasState = { rho: 1, u: 0, p: 1 };
        const rightState: GasState = { rho: 1 / SOD_DENSITY_RATIO, u: 0, p: 1 / SOD_PRESSURE_RATIO };
        const frames = Math.round(SOD_SECONDS / BASE_DT);
        const binWidth = W / SOD_BINS;
        const runs: Record<string, JsonValue>[] = [];
        let bestInLimit: number | null = null;
        for (const mode of MODES) {
            const { fill, left } = sodFill(count);
            await startGas(context, count, fill, mode.collisions, mode.rate);
            await runFrames(context, frames);
            const { positions, velocities } = await readState(context, count);
            const units: TubeUnits = { leftCount: left / (SOD_BINS / 2), sigma: COLLISION_SIGMA, x0: W / 2, seconds: frames * BASE_DT, binWidth };
            const columns = columnProfiles(positions, velocities, count, W, SOD_BINS);
            const profile = normalizedProfiles(columns, units);
            // Two columns at each wall are left out (the reflected rarefaction has not reached them yet, but the walls' own layer has).
            const errors = SOD_GAMMAS.map(gamma => ({ gamma, ...profileErrors(profile, leftState, rightState, gamma, units, 2, SOD_BINS - 2) }));
            const best = errors.reduce((a, b) => (b.rho + b.p < a.rho + a.p ? b : a));
            if (mode.rate === COLLISION_ALWAYS) bestInLimit = best.gamma;
            // The shock: the last column whose density is above the middle of the jump of the exact gamma = 2 solution.
            const star = starRegion(leftState, rightState, PROTOSTAR_GAS_GAMMA);
            const middle = (star.rhoRight + rightState.rho) / 2;
            let shockColumn = -1;
            profile.forEach((s, b) => { if (s.rho > middle && b < SOD_BINS - 2) shockColumn = b; });
            const shockSpeed = rightShockSpeed(leftState, rightState, PROTOSTAR_GAS_GAMMA, star) ?? 0;
            const anisotropy = columns.pxx.map((pxx, b) => Math.abs(pxx - columns.pyy[b]) / Math.max(1e-9, pxx + columns.pyy[b]));
            runs.push({
                mode: mode.name, bestGamma: round(best.gamma),
                errors: errors.map(e => ({ gamma: round(e.gamma), rho: round(e.rho), u: round(e.u), p: round(e.p) })),
                shockPx: (shockColumn + 1) * binWidth, exactShockPx: round(W / 2 + shockSpeed * COLLISION_SIGMA * units.seconds),
                meanPressureAnisotropy: round(anisotropy.reduce((s, a) => s + a, 0) / anisotropy.length),
                profile: { rho: profile.map(s => round(s.rho)), u: profile.map(s => round(s.u)), p: profile.map(s => round(s.p)) },
            });
        }
        const ok = bestInLimit === PROTOSTAR_GAS_GAMMA;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: { particles: count, seconds: frames * BASE_DT, sigma: COLLISION_SIGMA, bins: SOD_BINS, runs },
            details: runs.map(r => `${r.mode}: best gamma ${r.bestGamma}, shock at ${r.shockPx} px (exact ${r.exactShockPx})`).join('; '),
        };
    },
};

// ---- The speed of sound ----

export const collisionSoundSpeed: Scenario = {
    id: 'protostar.collisions.sound-speed',
    title: 'Collisions of the gas (C1): the frequency of a standing sound wave against cs = sqrt(gamma P / rho) = sqrt(2) sigma',
    tags: ['protostar', 'collisions'],
    async run(context): Promise<ScenarioOutcome> {
        const count = SOUND_PARTICLES;
        const k = 2 * Math.PI * SOUND_MODE / W;
        const expected = soundSpeed(2 * COLLISION_SIGMA * COLLISION_SIGMA);
        const frames = Math.round(SOUND_SECONDS / BASE_DT);
        const runs: Record<string, JsonValue>[] = [];
        let limitGamma = 0;
        for (const mode of MODES) {
            const fill = (state: InitialState): void => {
                const random = mulberry32(COLLISION_SEED);
                for (let i = 0; i < count; i++) {
                    // x from 1 + a cos(k x) by rejection (k W is a whole number of turns: antinodes at the walls, which reflect).
                    let x = random() * W;
                    while (random() * (1 + SOUND_AMPLITUDE) > 1 + SOUND_AMPLITUDE * Math.cos(k * x)) x = random() * W;
                    const [gx, gy] = gaussianPair(random(), random());
                    put(state, i, x, random() * H, COLLISION_SIGMA * gx, COLLISION_SIGMA * gy);
                }
            };
            await startGas(context, count, fill, mode.collisions, mode.rate);
            const times: number[] = [], amplitudes: number[] = [];
            const cell = LAB_CELL;
            await runFrames(context, frames, {
                async onFrame(frame) {
                    if (frame % SOUND_READ_EVERY !== 0) return;
                    // The moments grid of the last substep: the positions at its start, (frame - 1) dt.
                    const moments = await readTarget(context.renderer, protostarGrids(context).moments);
                    let mass = 0, projection = 0;
                    for (let j = 0; j < PROTOSTAR_GRID_RES; j++) {
                        for (let i = 0; i < PROTOSTAR_GRID_RES; i++) {
                            const m = moments[(j * PROTOSTAR_GRID_RES + i) * 4];
                            mass += m;
                            projection += m * Math.cos(k * (i + 0.5) * cell);
                        }
                    }
                    times.push((frame - 1) * BASE_DT);
                    amplitudes.push(mass > 0 ? 2 * projection / mass : 0);
                },
            });
            const omegaExpected = expected * k;
            const fit = fitDampedCosine(times, amplitudes, [0.2 * omegaExpected, 3 * omegaExpected], 3 * omegaExpected);
            // The undamped frequency of the fitted oscillator, sqrt(omega^2 + beta^2): what the sound speed sets.
            const speed = Math.hypot(fit.omega, fit.beta) / k;
            const gamma = (speed / COLLISION_SIGMA) ** 2;
            if (mode.rate === COLLISION_ALWAYS) limitGamma = gamma;
            runs.push({
                mode: mode.name, omega: round(fit.omega), damping: round(fit.beta), amplitude: round(fit.amplitude), residual: round(fit.residual),
                soundSpeed: round(speed), overExpected: round(speed / expected), effectiveGamma: round(gamma),
                series: { seconds: times.map(round), amplitude: amplitudes.map(round) },
            });
        }
        const ok = Math.abs(limitGamma / PROTOSTAR_GAS_GAMMA - 1) < 0.1;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: { particles: count, sigma: COLLISION_SIGMA, wavelengthPx: W / SOUND_MODE, expectedSoundSpeed: round(expected), runs },
            details: runs.map(r => `${r.mode}: cs ${r.soundSpeed} px/s (${r.overExpected} of sqrt(2) sigma, gamma ${r.effectiveGamma}), damping ${r.damping}/s`).join('; '),
        };
    },
};

// ---- Equipartition between hydrogen and helium ----

export const collisionEquipartition: Scenario = {
    id: 'protostar.collisions.equipartition',
    title: 'Collisions of the gas (C1): hydrogen and helium parcels of different dispersions reach the same one (equipartition per parcel)',
    tags: ['protostar', 'collisions'],
    async run(context): Promise<ScenarioOutcome> {
        const runs: Record<string, JsonValue>[] = [];
        let ok = true;
        for (const count of EQUIPARTITION_COUNTS) {
            for (const mode of MODES) {
                const fill = (state: InitialState): void => {
                    const random = mulberry32(COLLISION_SEED);
                    for (let i = 0; i < count; i++) {
                        const helium = i % 2 === 1;
                        const sigma = helium ? COLLISION_SIGMA / Math.sqrt(EQUIPARTITION_RATIO) : COLLISION_SIGMA;
                        const [gx, gy] = gaussianPair(random(), random());
                        put(state, i, random() * W, random() * H, sigma * gx, sigma * gy, helium ? HELIUM : HYDROGEN);
                    }
                };
                await startGas(context, count, fill, mode.collisions, mode.rate);
                const substeps: number[] = [], ratios: number[] = [];
                const record = async (frame: number): Promise<void> => {
                    const { positions, velocities } = await readState(context, count);
                    const s = [[0, 0, 0, 0], [0, 0, 0, 0]];      // per type: n, sum vx, sum vy, sum |v|^2
                    for (let i = 0; i < count; i++) {
                        const type = Math.round(positions[i * 4 + 2]) === HELIUM ? 1 : 0;
                        const vx = velocities[i * 4], vy = velocities[i * 4 + 1];
                        s[type][0]++; s[type][1] += vx; s[type][2] += vy; s[type][3] += vx * vx + vy * vy;
                    }
                    const dispersion = ([n, x, y, v2]: number[]): number => v2 / n - (x / n) ** 2 - (y / n) ** 2;
                    substeps.push(frame);
                    ratios.push(dispersion(s[0]) / dispersion(s[1]));
                };
                await record(0);
                await runFrames(context, EQUIPARTITION_FRAMES, { async onFrame(frame) { if (frame % EQUIPARTITION_READ_EVERY === 0) await record(frame); } });
                const perCell = count / (W * H / (LAB_CELL * LAB_CELL));
                const eFold = eFoldingTime(substeps, ratios.map(r => r - 1));
                const final = ratios.at(-1) ?? 0;
                if (!mode.collisions) ok &&= Math.abs(final / EQUIPARTITION_RATIO - 1) < 0.02;
                else ok &&= Math.abs(final - 1) < Math.abs(ratios[0] - 1) / 2;
                runs.push({
                    particles: count, mode: mode.name, particlesPerCell: round(perCell), finalRatio: round(final),
                    eFoldingSubsteps: eFold === null ? null : round(eFold), eFoldingOverPerCell: eFold === null ? null : round(eFold / perCell),
                    series: { substeps, ratio: ratios.map(round) },
                });
            }
        }
        return {
            status: ok ? 'pass' : 'fail', metrics: { initialRatio: EQUIPARTITION_RATIO, runs },
            details: runs.map(r => `${r.particles} ${r.mode}: ratio ${r.finalRatio}, e-fold ${r.eFoldingSubsteps} substeps`).join('; '),
        };
    },
};

export const collisionScenarios: Scenario[] = [collisionParity, collisionConservation, collisionSod, collisionSoundSpeed, collisionEquipartition];
