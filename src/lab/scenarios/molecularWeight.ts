// Acceptance of the mean molecular weight in the temperature (proposal A1, docs/spikes/a1-mean-molecular-weight.md), on thermal
// gases drawn directly (the model's debug initial state), with gravity, cooling and feedback off, and the grids drawn from the
// particles as they are (no step: nothing evolves).
//
//  - protostar.molecular-weight: at equal velocity dispersion a helium gas must read mu_He / mu_H = 2.65 times the temperature
//    of a hydrogen gas, a mixture in between (against a CPU computation of its composition), pure hydrogen unchanged, the
//    dispersion itself (the energy) untouched, and the core temperature of the stats the temperature, not the dispersion.
//  - protostar.ignition-gas: the temperature at which a pure hydrogen gas and a pure helium gas reach the same reference fusion
//    rate, measured on the GPU (the mean rate of the particles against the temperature of the gas) and compared with the rate
//    laws' own twin (src/simulation/protostar/ignition.ts); their ratio, the number the plan wants to be 6.7.

import { MAX_SPECIES, PROTOSTAR_GRID_RES, PROTOSTAR_T0_KELVIN } from '../../config';
import * as THREE from 'three';
import type { ParamValues } from '../../simulation/algorithm';
import { defaultParams } from '../../simulation/params';
import { forceHalfFloatDeposit } from '../../simulation/protostar/grids';
import { HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../../simulation/protostar/declaration';
import { molecularWeightFactor, molecularWeightFactors } from '../../simulation/protostar/composition';
import { fusionLawOf, ignitionRatio, ignitionTemperature, kineticIgnitionRatio } from '../../simulation/protostar/ignition';
import { fusionRate } from '../../simulation/protostar/reactions';
import {
    IGNITION_GAS_DECADES, IGNITION_GAS_DENSITY, IGNITION_GAS_PARTICLES, IGNITION_GAS_RATES, IGNITION_GAS_SEED, IGNITION_GAS_TEMPERATURES,
    IGNITION_GAS_TOLERANCE, IGNITION_REFERENCE_DENSITY, IGNITION_REFERENCE_RATE, MU_FACTOR_TOLERANCE, MU_FACTOR_TOLERANCE_HALF_FLOAT,
    MU_GAS_DENSITY, MU_GAS_PARTICLES, MU_GAS_SEED, MU_MIXED_DISPERSION_TOLERANCE, MU_MIXED_HELIUM_PERCENT, REAL_IGNITION_RATIO, THERMAL_GAS_TEMPERATURE,
} from '../config';
import { referenceDeposit } from '../depositReference';
import { protostarGrids, protostarModel, rebuildPipeline, restart } from '../driver';
import { boxForDensity, interpolateIgnition, localExponent, type ScanPoint } from '../ignitionScan';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readAttachment, readPositions, readTarget } from '../readback';
import { fillThermalGas, interiorCells, LAB_T0, thermalSigma, type Box } from '../thermalGas';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 5;
const COUNT_FOR_WARMUP = 1000;
const LAB_CLOUD_PARTICLES_SOFTWARE = 40_000;
const RES = PROTOSTAR_GRID_RES;
/** Gravity, cooling and feedback off; the fusion laws as they are in the application (their exponents and rates are the defaults). */
const GAS_OVERRIDES = { gravity: 0, cooling: 0, feedback: 0 } as const;
const MEGA = 1e6;

/** A gas of one or two types: the population weights of the restart (the first types) and the type of each particle. */
export interface Composition {
    name: string;
    weights: readonly number[];
    typeOf(index: number): number;
}

export const PURE_HYDROGEN: Composition = { name: 'hydrogen', weights: [1, 0, 0], typeOf: () => HYDROGEN };
export const PURE_HELIUM: Composition = { name: 'helium', weights: [0, 1, 0], typeOf: () => HELIUM };
/** One helium atom in every `100 / percent` particles, evenly: the number split of the weights is exact for a count divisible by it. */
export const mixed = (heliumPercent: number): Composition => ({
    name: `${100 - heliumPercent} % hydrogen, ${heliumPercent} % helium (by number)`,
    weights: [100 - heliumPercent, heliumPercent, 0],
    typeOf: index => (index % 100) < heliumPercent ? HELIUM : HYDROGEN,
});

/** What the grids hold over the interior cells of a gas, mass-weighted means (the temperatures in T0). */
export interface GasReading {
    particles: number;
    /** rho / rho0. */
    density: number;
    /** The velocity dispersion (energy per unit mass is half of it), in T0. */
    dispersion: number;
    /** The temperature the gas reads (the dispersion times mu / mu_H), in T0. */
    temperature: number;
    /** The temperature averaged over time, in T0 (the first draw: the same). */
    averaged: number;
    /** mu_mean / mu_H. */
    factor: number;
    /** Effective number of particles behind the temperature. */
    effectiveParticles: number;
    /** Mean expected fusions per second of a particle. */
    rate: number;
    /** The factor of each interior cell, row by row, for the cell-by-cell comparison. */
    cellFactors: Float32Array;
    cells: { x0: number; x1: number; y0: number; y1: number };
}

export interface Gas {
    reading: GasReading;
    box: Box;
}

/** Draws a gas of `composition`, every particle of dispersion `dispersion` (T0), and reads its grids right away. */
export async function drawGas(context: LabContext, composition: Composition, box: Box, count: number, dispersion: number, seed: number,
                               overrides: ParamValues = {}): Promise<Gas> {
    const { renderer } = context;
    const model = protostarModel(context);
    model.debugInitialState = state => fillThermalGas(state, box, thermalSigma(dispersion), mulberry32(seed), [0, 0], composition.typeOf);
    try {
        await restart(context, { count, overrides: { ...GAS_OVERRIDES, ...overrides }, timeScale: 1, seed, weights: composition.weights });
    } finally {
        model.debugInitialState = null;
    }
    model.beforeSubstep(0);                             // the grids from the particles as they are
    const targets = protostarGrids(context);
    const [gas, moments, power, thermo] = [
        await readTarget(renderer, targets.gas), await readTarget(renderer, targets.moments),
        await readTarget(renderer, targets.power), await readAttachment(renderer, targets.gas, 1),
    ];
    // The deposit mass of an average particle of the gas: no channel of the composition counts the particles any more.
    const inputs = model.debugGrids.debugDepositInputs;
    const weightSum = composition.weights.reduce((sum, w) => sum + w, 0);
    const meanDepositMass = composition.weights.reduce((sum, w, k) => sum + w * inputs.splatMass[k], 0) / weightSum * inputs.depositMassScale;
    const cells = interiorCells(box);
    const cellFactors = new Float32Array(Math.max(0, cells.x1 - cells.x0) * Math.max(0, cells.y1 - cells.y0));
    let mass = 0, density = 0, dispersionSum = 0, temperature = 0, averaged = 0, factor = 0, effective = 0, rate = 0, particles = 0, n = 0;
    for (let cy = cells.y0; cy < cells.y1; cy++) {
        for (let cx = cells.x0; cx < cells.x1; cx++) {
            const k = (cy * RES + cx) * 4;
            const m = moments[k];
            mass += m;
            density += m * gas[k];
            dispersionSum += m * gas[k + 1];
            temperature += m * gas[k + 1] * thermo[k + 2];
            averaged += m * thermo[k];
            factor += m * thermo[k + 2];
            effective += m * thermo[k + 1];
            rate += power[k + 1];
            particles += m / meanDepositMass;
            cellFactors[n++] = thermo[k + 2];
        }
    }
    return {
        box,
        reading: {
            particles, density: density / mass, dispersion: dispersionSum / mass / LAB_T0, temperature: temperature / mass / LAB_T0,
            averaged: averaged / mass / LAB_T0, factor: factor / mass, effectiveParticles: effective / mass, rate: rate / particles,
            cellFactors, cells,
        },
    };
}

const maxAbsRelative = (values: ArrayLike<number>, expected: number | ((i: number) => number)): number => {
    let worst = 0;
    for (let i = 0; i < values.length; i++) {
        const e = typeof expected === 'number' ? expected : expected(i);
        worst = Math.max(worst, Math.abs(values[i] - e) / Math.abs(e));
    }
    return worst;
};

/**
 * The factor of each interior cell the way the gas pass computes it, from a CPU deposit of the particles read back: the sums of
 * the 3 x 3 cells' masses and of the composition, in double precision.
 */
async function cpuFactors(context: LabContext, gas: Gas, count: number): Promise<Float64Array> {
    const { renderer, simulation } = context;
    const model = protostarModel(context);
    const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const reference = referenceDeposit(positions, count, model.debugGrids.debugDepositInputs, 0);
    const { cells } = gas.reading;
    const out = new Float64Array(Math.max(0, cells.x1 - cells.x0) * Math.max(0, cells.y1 - cells.y0));
    let n = 0;
    for (let cy = cells.y0; cy < cells.y1; cy++) {
        for (let cx = cells.x0; cx < cells.x1; cx++) {
            let massSum = 0, compositionSum = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const cell = (cy + dy) * RES + cx + dx;
                    massSum += reference.mass[cell];
                    compositionSum += reference.composition[cell * 4];
                }
            }
            out[n++] = molecularWeightFactor(compositionSum, massSum);
        }
    }
    return out;
}

/** The size and the box of the equal-dispersion gases: the lab's own on a real GPU, smaller on a software renderer. */
const muGas = (context: LabContext): { count: number; density: number } =>
    context.software ? { count: LAB_CLOUD_PARTICLES_SOFTWARE, density: 1 } : { count: MU_GAS_PARTICLES, density: MU_GAS_DENSITY };

interface PathReport {
    ok: boolean;
    metrics: Record<string, JsonValue>;
    details: string;
}

/**
 * The three gases (hydrogen, helium, a mixture) at equal dispersion in the deposit path the grids currently use. `strict`: every
 * check judges (the float32 path); not strict (the half-float path, whose sums stagnate in a dense cell), only the factors and the
 * temperature ratio are judged, against `tolerance`, the rest is reported.
 */
async function equalDispersion(context: LabContext, tolerance: number, strict: boolean): Promise<PathReport> {
    const { renderer } = context;
    const factors = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
    const { count, density } = muGas(context);
    const box = boxForDensity(density);
    const dispersion = THERMAL_GAS_TEMPERATURE;
    const compositions = [PURE_HYDROGEN, PURE_HELIUM, mixed(MU_MIXED_HELIUM_PERCENT)];
    const gases: Gas[] = [];
    for (const composition of compositions) gases.push(await drawGas(context, composition, box, count, dispersion, MU_GAS_SEED));
    const [hydrogen, helium, mix] = gases;

    // The factor cell by cell: the pure gases against their own, the mixture against a CPU deposit of its particles.
    const mixedExpected = await cpuFactors(context, mix, count);
    const errors = {
        hydrogen: maxAbsRelative(hydrogen.reading.cellFactors, 1),
        helium: maxAbsRelative(helium.reading.cellFactors, factors[HELIUM]),
        mixed: maxAbsRelative(mix.reading.cellFactors, i => mixedExpected[i]),
    };
    // The same particles at the same places with the same velocities: the dispersion (the energy) cannot depend on the gas.
    // The pure gases have the same deposit masses, so the same dispersion to rounding; the mixture weighs its particles
    // differently, which changes the sampling of the same dispersion (fewer effective particles: its estimate is a little lower).
    const dispersionSpread = Math.abs(helium.reading.dispersion / hydrogen.reading.dispersion - 1);
    const dispersionMixed = Math.abs(mix.reading.dispersion / hydrogen.reading.dispersion - 1);
    const ratio = helium.reading.temperature / hydrogen.reading.temperature;
    const expectedRatio = factors[HELIUM] / factors[HYDROGEN];
    const ratioError = Math.abs(ratio / expectedRatio - 1);
    const between = mix.reading.temperature > hydrogen.reading.temperature && mix.reading.temperature < helium.reading.temperature;

    // The core temperature of the stats is the temperature (the reduction reads the factor of the densest cell).
    const grids = protostarModel(context).debugGrids;
    grids.reduceStats();
    const targets = protostarGrids(context);
    const core = await readTarget(renderer, targets.reduce2);
    const [gas, thermo] = [await readTarget(renderer, targets.gas), await readAttachment(renderer, targets.gas, 1)];
    let peak = 0, peakCell = 0;
    for (let cell = 0; cell < RES * RES; cell++) if (gas[cell * 4] > peak) { peak = gas[cell * 4]; peakCell = cell; }
    const coreExpected = gas[peakCell * 4 + 1] * thermo[peakCell * 4 + 2] / LAB_T0;     // in T0: the mixture's last drawn grids
    const coreError = Math.abs(core[1] / coreExpected - 1);
    const coreIsTemperature = coreError < 1e-5 && Math.abs(core[1] - gas[peakCell * 4 + 1] / LAB_T0) > 1e-3 * core[1];

    const summary = (g: Gas): JsonValue => ({
        particlesPerNeighborhood: significant(9 * g.reading.particles / Math.max(1, g.reading.cellFactors.length), 4),
        density: significant(g.reading.density, 4), dispersionT0: significant(g.reading.dispersion, DIGITS),
        temperatureT0: significant(g.reading.temperature, DIGITS), temperatureMK: significant(g.reading.temperature * PROTOSTAR_T0_KELVIN / MEGA, DIGITS),
        averagedT0: significant(g.reading.averaged, DIGITS), factor: significant(g.reading.factor, DIGITS),
        effectiveParticles: significant(g.reading.effectiveParticles, 4),
    });
    const factorsOk = errors.hydrogen <= tolerance && errors.helium <= tolerance && errors.mixed <= tolerance && ratioError <= tolerance && between;
    const ok = factorsOk && (!strict || (dispersionSpread <= tolerance && dispersionMixed <= MU_MIXED_DISPERSION_TOLERANCE && coreIsTemperature));
    return {
        ok,
        metrics: {
            particles: count, densityRho0: density, dispersionT0: dispersion, tolerance,
            depositPath: gasTextureType(context),
            hydrogen: summary(hydrogen), helium: summary(helium), mixed: summary(mix), mixedHeliumPercentByNumber: MU_MIXED_HELIUM_PERCENT,
            factorMaxRelativeError: { hydrogenAgainst1: significant(errors.hydrogen, 3), heliumAgainstMuRatio: significant(errors.helium, 3), mixedAgainstCpu: significant(errors.mixed, 3) },
            temperatureRatioHeOverH: significant(ratio, DIGITS), expectedRatio: significant(expectedRatio, DIGITS), ratioError: significant(ratioError, 3),
            mixedBetweenPureGases: between,
            dispersionDifferenceHeliumHydrogen: significant(dispersionSpread, 3), dispersionDifferenceMixedHydrogen: significant(dispersionMixed, 3),
            coreTemperatureOfStatsT0: significant(core[1], DIGITS), coreTemperatureExpectedT0: significant(coreExpected, DIGITS),
            coreTemperatureIsTheTemperature: coreIsTemperature,
        },
        details: `equal dispersion ${dispersion} T0: helium / hydrogen = ${ratio.toFixed(4)} (mu ratio ${expectedRatio.toFixed(4)}, error ${ratioError.toExponential(1)}); `
            + `mixture ${(mix.reading.temperature / hydrogen.reading.temperature).toFixed(3)} (cell factors within ${errors.mixed.toExponential(1)} of the CPU's); `
            + `hydrogen's factor within ${errors.hydrogen.toExponential(1)} of 1; dispersion differs by ${dispersionSpread.toExponential(1)} (helium) and ${dispersionMixed.toExponential(1)} (mixture) from hydrogen's; `
            + `stats' core temperature ${core[1].toFixed(4)} T0 (expected ${coreExpected.toFixed(4)})`,
    };
}

/** The type of the deposit's textures the model currently uses. */
const gasTextureType = (context: LabContext): string =>
    protostarGrids(context).moments.textures[1].type === THREE.FloatType ? 'float32' : 'halfFloat';

export const molecularWeight: Scenario = {
    id: 'protostar.molecular-weight',
    title: 'Protostar: at equal velocity dispersion a helium gas reads mu_He / mu_H times the temperature of a hydrogen gas, a mixture in between',
    tags: ['protostar', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: COUNT_FOR_WARMUP });       // the protostar must be running before its model is configured
        const full = await equalDispersion(context, context.floatBlend ? MU_FACTOR_TOLERANCE : MU_FACTOR_TOLERANCE_HALF_FLOAT, true);
        // The same with the grids forced to deposit in half floats (the path of the devices without EXT_float_blend), always rebuilt after.
        forceHalfFloatDeposit(true);
        let half: PathReport;
        try {
            rebuildPipeline(context);
            await restart(context, { count: COUNT_FOR_WARMUP });
            half = await equalDispersion(context, MU_FACTOR_TOLERANCE_HALF_FLOAT, false);
        } finally {
            forceHalfFloatDeposit(false);
            rebuildPipeline(context);
        }
        const ok = full.ok && half.ok;
        return {
            status: ok ? 'pass' : 'fail',
            metrics: { float32Path: full.metrics, halfFloatPath: half.metrics },
            details: `${full.details}. Half-float path: ${half.details}`,
        };
    },
};

// ---- The ignition temperatures on pure gases ----

/** Draws the scan of one pure gas: (temperature, mean rate) at each temperature of the list, the gas drawn at the dispersion that gives it. */
async function scanGas(context: LabContext, composition: Composition, factor: number, box: Box, count: number): Promise<GasReading[]> {
    const readings: GasReading[] = [];
    for (const temperature of IGNITION_GAS_TEMPERATURES) {
        // The dispersion that gives `temperature` as the gas reads it: a helium gas at 2.65 times less.
        readings.push((await drawGas(context, composition, box, count, temperature / factor, IGNITION_GAS_SEED)).reading);
    }
    return readings;
}

export const ignitionGas: Scenario = {
    id: 'protostar.ignition-gas',
    title: 'Protostar: ignition temperature of pure hydrogen and pure helium gases at the same reference rate, measured on the GPU against the laws',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: `a software renderer (${context.rendererName}) would take hours to draw millions of particles` };
        await restart(context, { count: COUNT_FOR_WARMUP });
        const params = defaultParams(PROTOSTAR);
        const factors = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
        const box = boxForDensity(IGNITION_GAS_DENSITY);
        const index = (from: number): number => PROTOSTAR_REACTIONS.findIndex(r => r.from === from);
        const gases = [
            { composition: PURE_HYDROGEN, factor: factors[HYDROGEN], law: fusionLawOf(PROTOSTAR_REACTIONS[index(HYDROGEN)], params) },
            { composition: PURE_HELIUM, factor: factors[HELIUM], law: fusionLawOf(PROTOSTAR_REACTIONS[index(HELIUM)], params) },
        ];
        const scans: GasReading[][] = [];
        for (const gas of gases) scans.push(await scanGas(context, gas.composition, gas.factor, box, IGNITION_GAS_PARTICLES));

        // Each reading's rate against the twin of the law at the gas's own density, temperature and effective number of particles.
        let worstRate = 0;
        const rateTable = gases.map((gas, g) => scans[g].map(r => {
            const law = gas.law;
            const twin = fusionRate(law, r.density, r.temperature, Infinity);
            const twinCorrected = fusionRate(law, r.density, r.temperature, r.effectiveParticles);
            const comparable = r.rate > 1e-4 && twin > 1e-4 && twin < 50;
            if (comparable) worstRate = Math.max(worstRate, Math.abs(r.rate / twinCorrected - 1));
            return {
                gas: gas.composition.name, temperatureMK: significant(r.temperature * PROTOSTAR_T0_KELVIN / MEGA, 4), dispersionT0: significant(r.dispersion, 4),
                density: significant(r.density, 4), measuredRate: significant(r.rate, 4), lawRate: significant(twinCorrected, 4), judged: comparable,
            };
        }));

        const density = (g: number): number => scans[g].reduce((s, r) => s + r.density, 0) / scans[g].length;
        const points = (g: number): ScanPoint[] => scans[g].map(r => ({ temperature: r.temperature, rate: r.rate }));
        let worstIgnition = 0;
        const rows = IGNITION_GAS_RATES.map(rate => {
            const measured = [0, 1].map(g => interpolateIgnition(points(g), rate));
            const twin = gases.map((gas, g) => ignitionTemperature(gas.law, density(g), rate));
            measured.forEach((m, g) => { if (m !== null && Number.isFinite(twin[g])) worstIgnition = Math.max(worstIgnition, Math.abs(m / twin[g] - 1)); });
            const [h, he] = measured;
            const ratio = h !== null && he !== null ? he / h : null;
            return {
                ratePerSecond: rate,
                hydrogenMK: h === null ? null : significant(h * PROTOSTAR_T0_KELVIN / MEGA, 4),
                heliumMK: he === null ? null : significant(he * PROTOSTAR_T0_KELVIN / MEGA, 4),
                lawHydrogenMK: significant(twin[0] * PROTOSTAR_T0_KELVIN / MEGA, 4), lawHeliumMK: significant(twin[1] * PROTOSTAR_T0_KELVIN / MEGA, 4),
                ratioHeOverH: ratio === null ? null : significant(ratio, 4), lawRatioHeOverH: significant(twin[1] / twin[0], 4),
                kineticRatioHeOverH: ratio === null ? null : significant(kineticIgnitionRatio(ratio, gases[0].factor, gases[1].factor), 4),
            };
        });
        // A decade of lambda is a decade of the rate at a given density: how much the ignition temperature moves (A2: a logarithmic function of lambda only).
        const ignitionAt = (g: number, rate: number): number | null => interpolateIgnition(points(g), rate);
        const decadeShifts = IGNITION_GAS_DECADES.map(([low, high]) => {
            const shift = (g: number): number | null => {
                const [a, b] = [ignitionAt(g, low), ignitionAt(g, high)];
                return a === null || b === null ? null : significant(a / b, 4);
            };
            return { ratesPerSecond: [low, high], hydrogenTemperatureRatio: shift(0), heliumTemperatureRatio: shift(1) };
        });
        const reference = rows.find(r => r.ratePerSecond === IGNITION_REFERENCE_RATE);
        // The exponent d ln rate / d ln T the gas shows at its ignition at the reference rate (the law's local steepness).
        const exponents = [reference?.hydrogenMK, reference?.heliumMK].map((mk, g) =>
            typeof mk === 'number' ? localExponent(points(g), mk * MEGA / PROTOSTAR_T0_KELVIN) : null);
        const ladder = (rate: number, rho: number): number => ignitionRatio(PROTOSTAR_REACTIONS, params, rho, rate, index(HYDROGEN), index(HELIUM));
        const ok = worstRate <= IGNITION_GAS_TOLERANCE && worstIgnition <= IGNITION_GAS_TOLERANCE / 2
            && rows.every(r => r.ratioHeOverH !== null);
        return {
            status: ok ? 'pass' : 'fail',
            metrics: {
                particles: IGNITION_GAS_PARTICLES, densityRho0: [significant(density(0), 4), significant(density(1), 4)],
                tolerance: IGNITION_GAS_TOLERANCE, worstRateError: significant(worstRate, 3), worstIgnitionError: significant(worstIgnition, 3),
                laws: gases.map(g => ({ gas: g.composition.name, lambda: g.law.rate, power: significant(g.law.power, 4), barrier: significant(g.law.barrier, 4), barrierPower: significant(g.law.barrierPower, 4), densityExponent: g.law.densityExponent, referenceMK: significant(g.law.reference * PROTOSTAR_T0_KELVIN / MEGA, 4) })),
                factors: [significant(factors[HYDROGEN], DIGITS), significant(factors[HELIUM], DIGITS)],
                ignitionAtGasDensity: rows,
                ignitionShiftPerDecadeOfLambda: decadeShifts,
                localExponentAtReferenceRate: exponents.map(e => e === null ? null : significant(e, 3)),
                lawRatioAtLabReferencePoint: { ratePerSecond: IGNITION_REFERENCE_RATE, densityRho0: IGNITION_REFERENCE_DENSITY, ratio: significant(ladder(IGNITION_REFERENCE_RATE, IGNITION_REFERENCE_DENSITY), 4) },
                realRatio: significant(REAL_IGNITION_RATIO, 3),
                readings: rateTable.flat(),
            },
            details: rows.map(r => `${r.ratePerSecond}/s at ${density(0).toFixed(1)} rho0: H ${String(r.hydrogenMK)} MK, He ${String(r.heliumMK)} MK, He/H ${String(r.ratioHeOverH)} `
                + `(law ${String(r.lawRatioHeOverH)}, in dispersion ${String(r.kineticRatioHeOverH)})`).join('; ')
                + `; rates within ${(worstRate * 100).toFixed(1)} % of the laws, ignitions within ${(worstIgnition * 100).toFixed(1)} %`
                + `; at the lab's reference point (${IGNITION_REFERENCE_RATE}/s, ${IGNITION_REFERENCE_DENSITY} rho0) the laws give ${ladder(IGNITION_REFERENCE_RATE, IGNITION_REFERENCE_DENSITY).toFixed(2)}`,
        };
    },
};
