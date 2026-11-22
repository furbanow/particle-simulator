// Acceptance of the fusion of parcels of constant mass (proposal A4, docs/spikes/a4-constant-mass-fusion.md): a fusing particle changes
// type and keeps its mass and its velocity, none is removed.
//
//  - protostar.constant-mass.momentum: the total momentum of a fusing gas with no gravity, summed in double precision from a read-back of the
//    velocities and types, over 10 000 substeps: unchanged by the fusions (to 1e-6 of the thermal momentum), and with the cooling and the heating
//    on (reported). It reads only what the old build also has, so it runs on the build before and shows the momentum that removal loses.
//  - protostar.constant-mass.energy: the energy the fusions release against the power the heating deposits, and the fusions that happen against
//    the expected ones: the same in expectation (the position pass and the power deposit read the same rate).
//  - protostar.constant-mass.population: the default cloud: the live particles, those of the core, the counts per type of the GPU against the
//    CPU's, and the shares of mass the statistic shows.
//  - protostar.constant-mass.nebula: what the nebula layer weighs, from the positions, and the layer itself drawn and read back.
//  - protostar.constant-mass.appearance: the default cloud drawn by the whole rendering stack at a few frames, the canvas read back as JPEGs (a described check
//    of the look of the particles, the glow and the nebula; it runs on the build before too, to compare).

import * as THREE from 'three';
import { BASE_DT, MAX_SPECIES, PROTOSTAR_FUSION_C2, PROTOSTAR_RADIATION_SLIDER, TOTAL_MASS } from '../../config';
import { NebulaLayer } from '../../render/nebulaLayer';
import { PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../../simulation/protostar/declaration';
import { reactionArrays } from '../../simulation/protostar/reactions';
import {
    CONSTANT_MASS_APPEARANCE_FRAMES, CONSTANT_MASS_APPEARANCE_QUALITY, CONSTANT_MASS_CORE_RADIUS, CONSTANT_MASS_ENERGY, CONSTANT_MASS_ENERGY_TOLERANCE, CONSTANT_MASS_FEEDBACK, CONSTANT_MASS_MOMENTUM,
    CONSTANT_MASS_MOMENTUM_TOLERANCE, CONSTANT_MASS_POPULATION_EVERY,
} from '../config';
import { momentumChange, totalMomentum, typeChanges, type MomentumSums } from '../conservation';
import { frameSeconds, protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { boxForDensity } from '../ignitionScan';
import { sumChannel, significant } from '../numbers';
import { mulberry32 } from '../random';
import { readPositions, readTarget } from '../readback';
import { fillThermalGas } from '../thermalGas';
import { renderStack } from './perf';
import { countTypes } from '../typeCounts';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 5;
const sig = (v: number): number => significant(v, DIGITS);

/**
 * The mass a particle of each type carries in the deposit: the mass of the type's parcel (A4), or in a build before it the splat mass (the
 * lab reads only what both have, so that the scenarios run on the build before).
 */
function depositMasses(context: LabContext): readonly number[] {
    const inputs = protostarModel(context).debugGrids.debugDepositInputs as unknown as Record<string, readonly number[]>;
    return inputs.depositMass ?? inputs.splatMass;
}

/** The particles of the state, read back: positions (x, y, type, w) and velocities (vx, vy). */
async function readState(context: LabContext, count: number): Promise<{ positions: Float32Array; velocities: Float32Array }> {
    const { renderer, simulation } = context;
    return {
        positions: await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count),
        velocities: await readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, count),
    };
}

// ---- The momentum ----

interface MomentumRun {
    ok: boolean;
    metrics: Record<string, JsonValue>;
    details: string;
}

/** Runs the fusing gas for the substeps of CONSTANT_MASS_MOMENTUM and reports the change of the momentum at its checkpoints. */
async function runMomentum(context: LabContext, name: string, overrides: Record<string, number>, judged: boolean): Promise<MomentumRun> {
    const spec = CONSTANT_MASS_MOMENTUM;
    const count = context.software ? 10_000 : spec.particles;
    const substeps = context.software ? 200 : spec.substeps;
    const model = protostarModel(context);
    const box = boxForDensity(spec.density);
    const heliumEvery = 100 / spec.heliumPercent;
    const typeOf = (index: number): number => index % heliumEvery === 0 ? 1 : 0;
    model.debugInitialState = state => fillThermalGas(state, box, spec.sigma, mulberry32(spec.seed), spec.bulk, typeOf);
    try {
        await restart(context, {
            count, timeScale: spec.timeScale, seed: spec.seed, flatRates: true, weights: [100 - spec.heliumPercent, spec.heliumPercent, 0],
            overrides: { gravity: 0, radiation: 0, feedback: 0, fusionRate: spec.hydrogenRate, heFusionRate: spec.heliumRate, ...overrides },
        });
    } finally {
        model.debugInitialState = null;
    }
    const masses = depositMasses(context);
    const massOf = (type: number): number => masses[Math.min(MAX_SPECIES - 1, Math.max(0, type))] ?? 0;
    const at = async (): Promise<{ sums: MomentumSums; counts: number[]; nearWall: number }> => {
        const { positions, velocities } = await readState(context, count);
        const size = context.simulation.screenSize.value;
        let nearWall = 0;
        for (let i = 0; i < count; i++) {
            const [x, y] = [positions[i * 4], positions[i * 4 + 1]];
            if (x < 1 || y < 1 || x > size.x - 1 || y > size.y - 1) nearWall++;
        }
        return { sums: totalMomentum(positions, velocities, count, massOf), counts: countTypes(positions, count, 3), nearWall };
    };
    const first = await at();
    const per = Math.max(1, Math.floor(substeps / (context.software ? 2 : spec.checkpoints)));
    const rows: Record<string, JsonValue>[] = [];
    let worst = 0, worstAbsolute = 0, last = first, wallsReached = 0;
    for (let done = 0; done < substeps; done += per) {
        await runFrames(context, Math.min(per, substeps - done));
        last = await at();
        const change = momentumChange(first.sums, last.sums);
        worst = Math.max(worst, change.relativeThermal);
        worstAbsolute = Math.max(worstAbsolute, change.relativeAbsolute);
        wallsReached = Math.max(wallsReached, last.nearWall);
        rows.push({
            substep: done + Math.min(per, substeps - done), live: last.sums.live, counts: last.counts, mass: sig(last.sums.mass),
            relativeThermal: sig(change.relativeThermal), relativeAbsolute: sig(change.relativeAbsolute),
        });
    }
    const seconds = substeps * frameSeconds(context);
    const fused = 1 - last.counts[0] / first.counts[0];
    const noRemoval = last.sums.live === first.sums.live && last.sums.live === count;
    const ok = !judged || (worst <= CONSTANT_MASS_MOMENTUM_TOLERANCE && noRemoval && fused > 0.5 && last.counts[2] > 0);
    return {
        ok,
        metrics: {
            name, particles: count, substeps, simulatedSeconds: sig(seconds), liveAtStart: first.sums.live, liveAtEnd: last.sums.live,
            countsAtStart: first.counts, countsAtEnd: last.counts, hydrogenFused: sig(fused), momentumStartMassVelocity: [sig(first.sums.px), sig(first.sums.py)],
            thermalMomentum: sig(first.sums.mass * Math.sqrt(first.sums.doubleKinetic / (2 * first.sums.mass))),
            worstRelativeToThermalMomentum: sig(worst), worstRelativeToSumOfMV: sig(worstAbsolute),
            particlesWithin1pxOfAWall: wallsReached, judged, checkpoints: rows,
        },
        details: `${name}: ${count} particles, ${substeps} substeps (${seconds.toFixed(1)} s): live ${first.sums.live} -> ${last.sums.live}, `
            + `types ${first.counts.join('/')} -> ${last.counts.join('/')}, the momentum moved by at most ${worst.toExponential(2)} of the thermal momentum `
            + `(${worstAbsolute.toExponential(2)} of sum m|v|)${wallsReached > 0 ? `, ${wallsReached} particles reached a wall` : ''}`,
    };
}

export const momentumConservation: Scenario = {
    id: 'protostar.constant-mass.momentum',
    title: 'Protostar: the total momentum of a fusing gas (no gravity), summed in double precision, over 10 000 substeps',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const fusionOnly = await runMomentum(context, 'fusion only (cooling and feedback off)', {}, true);
        const thermodynamics = await runMomentum(context, 'with the cooling and a feedback of the sliders\' minimum', {
            radiation: PROTOSTAR_RADIATION_SLIDER.default, feedback: CONSTANT_MASS_FEEDBACK,
        }, false);
        return {
            status: fusionOnly.ok ? 'pass' : 'fail',
            metrics: { fusionOnly: fusionOnly.metrics, withCoolingAndHeating: thermodynamics.metrics },
            details: `${fusionOnly.details}. ${thermodynamics.details}`,
        };
    },
};

// ---- The energy ----

interface EnergyGas {
    name: string;
    weights: readonly number[];
    type: number;
    rateParam: 'fusionRate' | 'heFusionRate';
}

const ENERGY_GASES: readonly EnergyGas[] = [
    { name: 'hydrogen', weights: [1, 0, 0], type: 0, rateParam: 'fusionRate' },
    { name: 'helium', weights: [0, 1, 0], type: 1, rateParam: 'heFusionRate' },
];

async function runEnergy(context: LabContext, gas: EnergyGas): Promise<{ ok: boolean; metrics: Record<string, JsonValue>; details: string }> {
    const spec = CONSTANT_MASS_ENERGY;
    const count = context.software ? 20_000 : spec.particles;
    const steps = context.software ? 20 : spec.steps;
    const { renderer } = context;
    const model = protostarModel(context);
    const box = boxForDensity(spec.density);
    model.debugInitialState = state => fillThermalGas(state, box, spec.sigma, mulberry32(spec.seed), [0, 0], () => gas.type);
    const rate = gas.type === 0 ? spec.hydrogenRate : spec.heliumRate;
    try {
        await restart(context, {
            count, timeScale: 1, seed: spec.seed, flatRates: true, weights: gas.weights,
            overrides: { gravity: 0, radiation: 0, feedback: 1, [gas.rateParam]: rate },
        });
    } finally {
        model.debugInitialState = null;
    }
    const masses = depositMasses(context);
    // What a unit of fused mass of the type releases, in T0 (feedback x defect fraction x c^2), as the shaders have it.
    const energy = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES, { fusionRate: 0, heFusionRate: 0, feedback: 1 }, 'mass', PROTOSTAR_FUSION_C2, 1, MAX_SPECIES).energy;
    let depositMass = NaN;                              // the mass of a particle in deposit units: known once the first substep has set the scale
    let before = await readPositions(renderer, context.simulation.debugPipeline.debugPositionTarget, count);
    let expectedEvents = 0, events = 0, depositedEnergy = 0, releasedEnergy = 0, lost = 0, worstStep = 0;
    for (let step = 0; step < steps; step++) {
        context.simulation.step();
        depositMass = masses[gas.type] * model.debugGrids.debugDepositInputs.depositMassScale;
        const power = await readTarget(renderer, protostarGrids(context).power);
        const after = await readPositions(renderer, context.simulation.debugPipeline.debugPositionTarget, count);
        const dt = BASE_DT * context.simulation.timeScale;
        const stepExpected = sumChannel(power, 1) * dt;
        const { moved, lost: gone } = typeChanges(before, after, count, 3);
        const stepEvents = moved[gas.type].reduce((s, n) => s + n, 0);
        expectedEvents += stepExpected;
        events += stepEvents;
        depositedEnergy += sumChannel(power, 0) * dt;
        releasedEnergy += stepEvents * depositMass * energy[gas.type];
        lost += gone;
        if (stepExpected > 0) worstStep = Math.max(worstStep, Math.abs(stepEvents / stepExpected - 1));
        before = after;
    }
    const eventRatio = events / expectedEvents;
    const energyRatio = releasedEnergy / depositedEnergy;
    const noise = 1 / Math.sqrt(events);
    const ok = lost === 0 && Math.abs(eventRatio - 1) <= CONSTANT_MASS_ENERGY_TOLERANCE && Math.abs(energyRatio - 1) <= CONSTANT_MASS_ENERGY_TOLERANCE;
    return {
        ok,
        metrics: {
            gas: gas.name, particles: count, steps, ratePerSecondAtStart: rate * spec.density ** (gas.type === 0 ? 1 : 2),
            expectedFusions: sig(expectedEvents), fusions: events, fusionsOverExpected: sig(eventRatio),
            depositedEnergy: sig(depositedEnergy), releasedEnergy: sig(releasedEnergy), releasedOverDeposited: sig(energyRatio),
            poissonNoiseOfTheEvents: sig(noise), worstStepFusionsOverExpected: sig(worstStep + 1), particlesLost: lost,
            energyPerUnitFusedMass: sig(energy[gas.type]), depositMass: sig(depositMass), tolerance: CONSTANT_MASS_ENERGY_TOLERANCE,
        },
        details: `${gas.name}: ${events} fusions against ${expectedEvents.toFixed(0)} expected (${eventRatio.toFixed(4)}, noise ${noise.toFixed(4)}), `
            + `energy released ${releasedEnergy.toExponential(3)} against deposited ${depositedEnergy.toExponential(3)} (${energyRatio.toFixed(4)}); ${lost} lost`,
    };
}

export const energyAccounting: Scenario = {
    id: 'protostar.constant-mass.energy',
    title: 'Protostar: the fusions and the energy they release against the expected ones (the power grid), pure hydrogen and pure helium gases',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const results = [];
        for (const gas of ENERGY_GASES) results.push(await runEnergy(context, gas));
        return {
            status: results.every(r => r.ok) ? 'pass' : 'fail',
            metrics: { gases: results.map(r => r.metrics) },
            details: results.map(r => r.details).join('. '),
        };
    },
};

// ---- The population of the default cloud ----

interface Snapshot {
    frame: number;
    seconds: number;
    live: number;
    counts: number[];
    gpuCounts: number[];
    statCounts: number[];
    shares: number[];
    core: number;
}

/** The default cloud: the live particles and those of the core over time, and the counts per type read on the GPU against the CPU's. */
export const population: Scenario = {
    id: 'protostar.constant-mass.population',
    title: 'Protostar: the particles of the default cloud over time: none removed, the core\'s population, the GPU count per type against the CPU\'s',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation, options } = context;
        const count = options.baselineParticles;
        const frames = options.baselineFrames;
        await restart(context, { count });
        const model = protostarModel(context);
        const hasGpuCount = typeof (model as unknown as { debugCountTypes?: unknown }).debugCountTypes === 'function';
        const snapshots: Snapshot[] = [];
        const take = async (frame: number): Promise<void> => {
            const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
            const counts = countTypes(positions, count, 3);
            let live = 0;
            for (let i = 0; i < count; i++) if (positions[i * 4 + 3] >= 0) live++;
            const gpuCounts = hasGpuCount ? (await (model as unknown as { debugCountTypes(): Promise<number[]> }).debugCountTypes()).slice(0, 3) : [];
            const peak = model.peakPosition;
            let core = 0;
            if (peak) {
                const r2 = CONSTANT_MASS_CORE_RADIUS ** 2;
                for (let i = 0; i < count; i++) {
                    if (!(positions[i * 4 + 3] >= 0)) continue;
                    const [dx, dy] = [positions[i * 4] - peak.x, positions[i * 4 + 1] - peak.y];
                    if (dx * dx + dy * dy <= r2) core++;
                }
            }
            const masses = simulation.liveTypeMasses?.() ?? [];
            const total = masses.slice(0, 3).reduce((s, m) => s + m, 0);
            snapshots.push({
                frame, seconds: frame * frameSeconds(context), live, counts, gpuCounts,
                statCounts: [0, 1, 2].map(k => simulation.liveTypeCounts()?.[k] ?? -1),
                shares: [0, 1, 2].map(k => total > 0 ? (masses[k] ?? 0) / total : -1), core,
            });
        };
        await take(0);
        await runFrames(context, frames, {
            endFrame: true,
            async onFrame(frame) {
                if (frame % CONSTANT_MASS_POPULATION_EVERY === 0) await take(frame);
            },
        });
        const first = snapshots[0], last = snapshots[snapshots.length - 1];
        const coreSeries = snapshots.map(s => s.core);
        const coreMax = Math.max(...coreSeries);
        const noRemoval = snapshots.every(s => s.live === count);
        const gpuMatches = !hasGpuCount || snapshots.every(s => s.gpuCounts.every((n, k) => n === s.counts[k]));
        const shareSums = snapshots.map(s => s.shares.reduce((a, b) => a + b, 0));
        const sharesOk = !hasGpuCount || shareSums.every(sum => Math.abs(sum - 1) < 1e-9 || sum === -3);
        return {
            status: noRemoval && gpuMatches && sharesOk ? 'pass' : (hasGpuCount ? 'fail' : 'pass'),
            metrics: {
                particles: count, frames, hasGpuCount, liveAtStart: first.live, liveAtEnd: last.live, noneRemoved: noRemoval,
                gpuCountEqualsCpuCount: gpuMatches, coreRadiusPx: CONSTANT_MASS_CORE_RADIUS,
                corePopulationMax: coreMax, corePopulationAtEnd: last.core, corePopulationAtEndOverMax: sig(last.core / Math.max(1, coreMax)),
                snapshots: snapshots.map(s => ({
                    frame: s.frame, seconds: sig(s.seconds), live: s.live, counts: s.counts, gpuCounts: s.gpuCounts,
                    statistic: s.statCounts, massShares: s.shares.map(sig), core: s.core,
                })),
            },
            details: `${count} particles, ${frames} frames: live ${first.live} -> ${last.live}, types ${first.counts.join('/')} -> ${last.counts.join('/')}, `
                + `core population ${first.core} -> ${last.core} (max ${coreMax}); GPU count ${hasGpuCount ? (gpuMatches ? 'equals' : 'DIFFERS FROM') : 'absent from'} the CPU's`,
        };
    },
};

// ---- The nebula ----

/** What the nebula layer weighs: from the positions, then the layer itself drawn and read back. */
export const nebulaWeight: Scenario = {
    id: 'protostar.constant-mass.nebula',
    title: 'Protostar: the mass the nebula layer splats as the cloud fuses: constant, against the weights of the atomic masses it replaces',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, simulation, options } = context;
        const count = options.baselineParticles;
        const size = simulation.screenSize.value;
        await restart(context, { count });
        const view = { zoom: { value: 1 }, center: { value: new THREE.Vector2(size.x / 2, size.y / 2) } };
        const positionUniform = { value: simulation.positionTexture as THREE.Texture | null };
        const layer = new NebulaLayer(renderer, simulation.geometry, simulation.speciesUniforms, simulation.screenSize, positionUniform, view);
        layer.resize(size.x, size.y);
        const splat = simulation.speciesUniforms.splatMass.value;
        const atomic = PROTOSTAR_TYPES.map(type => type.values.mass);
        const hydrogenMass = atomic[0];
        const rows: Record<string, JsonValue>[] = [];
        let firstDrawn = NaN, worstDrawn = 0;
        const snapshot = async (frame: number): Promise<void> => {
            const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
            const counts = countTypes(positions, count, 3);
            // What the layer splats: the splat mass of each particle's type. The weights it had when they were the atomic masses of the types:
            // those of the hydrogen cloud at the start (TOTAL_MASS / count per hydrogen), times the atomic mass over the hydrogen's.
            const real = counts.reduce((s, n, k) => s + n * splat[k], 0);
            const proportional = counts.reduce((s, n, k) => s + n * (TOTAL_MASS / count) * atomic[k] / hydrogenMass, 0);
            positionUniform.value = simulation.positionTexture;
            layer.render();
            const drawn = sumChannel(await readTarget(renderer, layer.target), 3);
            // The layer's half-float sums saturate in the dense core (a texel of hundreds of particles of 0.05): judged on the uniform cloud of the start only.
            if (Number.isNaN(firstDrawn)) firstDrawn = Math.abs(drawn / real - 1);
            worstDrawn = Math.max(worstDrawn, Math.abs(drawn / real - 1));
            rows.push({
                frame, counts, splatMassOfAType: sig(splat[0]), totalSplatMass: sig(real), totalIfProportionalToAtomicMass: sig(proportional),
                brighteningIfProportional: sig(proportional / real), drawnTotalMass: sig(drawn), drawnOverExpected: sig(drawn / real),
            });
        };
        await snapshot(0);
        await runFrames(context, options.baselineFrames, {
            endFrame: true,
            async onFrame(frame) {
                if (frame % (CONSTANT_MASS_POPULATION_EVERY * 4) === 0) await snapshot(frame);
            },
        });
        layer.target.dispose();
        const constant = rows.every(row => Math.abs((row.totalSplatMass as number) / TOTAL_MASS - 1) < 1e-4);
        const last = rows[rows.length - 1];
        return {
            status: constant && firstDrawn < 0.02 ? 'pass' : 'fail',
            metrics: { particles: count, totalMass: TOTAL_MASS, drawnOverExpectedAtStart: sig(firstDrawn + 1), worstDrawnDeviation: sig(worstDrawn), snapshots: rows },
            details: `the nebula splats ${(last.totalSplatMass as number).toFixed(0)} of ${TOTAL_MASS} at the end (${rows.length} snapshots; the layer's own sum within `
                + `${(firstDrawn * 100).toFixed(2)} % of it at the start, ${(worstDrawn * 100).toFixed(1)} % at worst); proportional to the atomic masses it would splat ${(last.brighteningIfProportional as number).toFixed(2)} times more`,
        };
    },
};

// ---- The look ----

/** The default cloud drawn by the whole rendering stack (particles, glow, nebula, post-processing) at a few frames, each read back from the canvas. */
export const appearance: Scenario = {
    id: 'protostar.constant-mass.appearance',
    title: 'Protostar: the default cloud as the application draws it, at a few frames (JPEGs of the canvas)',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer, options, software } = context;
        if (software) return { status: 'skip', metrics: {}, details: 'the software renderer draws nothing worth looking at in time' };
        await restart(context, { count: options.baselineParticles });
        const stack = renderStack(context);
        stack.prepare();
        const images: Record<string, JsonValue> = {};
        let done = 0;
        for (const frame of CONSTANT_MASS_APPEARANCE_FRAMES) {
            await runFrames(context, frame - done - 1, { endFrame: true });
            stack.frame();
            await context.sync.wait(context.simulation.positionTexture);
            images[`frame${frame}`] = renderer.domElement.toDataURL('image/jpeg', CONSTANT_MASS_APPEARANCE_QUALITY);
            done = frame;
        }
        const size = renderer.domElement;
        return { status: 'pass', metrics: { canvas: `${size.width} x ${size.height}`, images }, details: `${CONSTANT_MASS_APPEARANCE_FRAMES.length} frames drawn` };
    },
};

export const constantMassScenarios: Scenario[] = [momentumConservation, energyAccounting, population, nebulaWeight, appearance];
