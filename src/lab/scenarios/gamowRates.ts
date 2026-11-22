// Acceptance of the Gamow rates (proposal A2, docs/spikes/a2-gamow-rates.md), on thermal gases drawn directly (the model's debug
// initial state), gravity, cooling and feedback off, the grids drawn from the particles as they are:
//
//  - protostar.fuel-fractions: the mass fractions X (hydrogen) and Y (helium) that the gas pass computes from the third
//    attachment of the composition deposit, against a CPU deposit of the particles, in float32 and in half floats; a gas of
//    hydrogen, helium and carbon: the carbon is in neither.
//  - protostar.local-exponent: the exponent d ln rate / d ln T measured on pure gases, from two gases of the same particles
//    at the same places at 5 % below and 5 % above a temperature, against the theory of the laws (3.9 at 15 MK for hydrogen,
//    41 at 100 MK and 19 at 200 MK for helium), and the rate against the law at the gas's own temperature.

import * as THREE from 'three';
import { MAX_SPECIES, PROTOSTAR_GRID_RES, PROTOSTAR_T0_KELVIN } from '../../config';
import { molecularWeightFactors } from '../../simulation/protostar/composition';
import { PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../../simulation/protostar/declaration';
import { forceHalfFloatDeposit } from '../../simulation/protostar/grids';
import { fusionLawOf } from '../../simulation/protostar/ignition';
import { fusionRate, lawAt, localExponent } from '../../simulation/protostar/reactions';
import {
    GAMOW_EXPONENT_TOLERANCE, GAMOW_FUEL_MEAN_TOLERANCE, GAMOW_FUEL_TOLERANCE, GAMOW_FUEL_TOLERANCE_HALF_FLOAT, GAMOW_POINTS, GAMOW_STEP, GAMOW_TARGET_RATE,
    IGNITION_GAS_DENSITY, IGNITION_GAS_PARTICLES, IGNITION_GAS_SEED, MU_GAS_DENSITY, MU_GAS_PARTICLES, MU_GAS_SEED,
} from '../config';
import { referenceDeposit } from '../depositReference';
import { protostarGrids, protostarModel, rebuildPipeline, restart } from '../driver';
import { boxDensity, boxForDensity } from '../ignitionScan';
import { significant } from '../numbers';
import { readAttachment, readPositions } from '../readback';
import type { Composition, Gas } from './molecularWeight';
import { drawGas } from './molecularWeight';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 5;
const RES = PROTOSTAR_GRID_RES;
const MEGA = 1e6;
const COUNT_FOR_WARMUP = 1000;
const LAB_CLOUD_PARTICLES_SOFTWARE = 40_000;

// ---- The fuel fractions ----

/** Hydrogen, helium and carbon by number in the proportions 60 : 30 : 10, evenly (the weights of the restart are the same). */
const MIXED_GAS: Composition = {
    name: '60 % hydrogen, 30 % helium, 10 % carbon (by number)',
    weights: [60, 30, 10],
    typeOf: index => (index % 10) < 6 ? 0 : (index % 10) < 9 ? 1 : 2,
};

interface FuelReport {
    ok: boolean;
    metrics: Record<string, JsonValue>;
    details: string;
}

/** The gas of three types at the deposit path now in use: X and Y of every interior cell against the CPU deposit of its particles. */
async function checkFuelFractions(context: LabContext, tolerance: number): Promise<FuelReport> {
    const { renderer, simulation } = context;
    const count = context.software ? LAB_CLOUD_PARTICLES_SOFTWARE : MU_GAS_PARTICLES;
    const box = boxForDensity(context.software ? 1 : MU_GAS_DENSITY);
    const gas: Gas = await drawGas(context, MIXED_GAS, box, count, 1, MU_GAS_SEED);
    const targets = protostarGrids(context);
    const model = protostarModel(context);
    const fuel = await readAttachment(renderer, targets.gas, 2);
    const positions = await readPositions(renderer, simulation.debugPipeline.debugPositionTarget, count);
    const reference = referenceDeposit(positions, count, model.debugGrids.debugDepositInputs, 0);
    const { cells } = gas.reading;
    let worstX = 0, worstY = 0, worstSum = 0, n = 0;
    let [sumX, sumY] = [0, 0];
    for (let cy = cells.y0; cy < cells.y1; cy++) {
        for (let cx = cells.x0; cx < cells.x1; cx++) {
            let mass = 0, hydrogen = 0, helium = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const cell = (cy + dy) * RES + cx + dx;
                    mass += reference.mass[cell];
                    hydrogen += reference.composition[cell * 4 + 1];
                    helium += reference.composition[cell * 4 + 3];
                }
            }
            const k = (cy * RES + cx) * 4;
            worstX = Math.max(worstX, Math.abs(fuel[k] - hydrogen / mass) / (hydrogen / mass));
            worstY = Math.max(worstY, Math.abs(fuel[k + 1] - helium / mass) / (helium / mass));
            // hydrogen, helium and the carbon that is left are the whole mass: X + Y + (1 - X - Y) with the carbon's own share from the moments
            worstSum = Math.max(worstSum, Math.abs(fuel[k] + fuel[k + 1] + (mass - hydrogen - helium) / mass - 1));
            sumX += fuel[k];
            sumY += fuel[k + 1];
            n++;
        }
    }
    const inputs = model.debugGrids.debugDepositInputs;
    const massShare = (k: number): number => MIXED_GAS.weights[k] * inputs.depositMass[k]
        / MIXED_GAS.weights.reduce((s, w, j) => s + w * inputs.depositMass[j], 0);
    const [expectedX, expectedY] = [massShare(0), massShare(1)];
    // The means over the cells against the mass shares of the whole gas are statistical (the cells draw their particles at random).
    // On the half-float path the cells' own error (judged to `tolerance`) shifts the means too.
    const meanTolerance = Math.max(GAMOW_FUEL_MEAN_TOLERANCE, tolerance);
    const ok = worstX <= tolerance && worstY <= tolerance && Math.abs(sumX / n / expectedX - 1) <= meanTolerance
        && Math.abs(sumY / n / expectedY - 1) <= meanTolerance;
    return {
        ok,
        metrics: {
            particles: count, densityRho0: context.software ? 1 : MU_GAS_DENSITY, tolerance,
            depositPath: targets.moments.textures[1].type === THREE.FloatType ? 'float32' : 'halfFloat',
            meanX: significant(sumX / n, DIGITS), expectedX: significant(expectedX, DIGITS),
            meanY: significant(sumY / n, DIGITS), expectedY: significant(expectedY, DIGITS),
            hydrogenFractionMaxRelativeError: significant(worstX, 3), heliumFractionMaxRelativeError: significant(worstY, 3),
            carbonInNeither: significant(worstSum, 3),
        },
        details: `X ${(sumX / n).toFixed(4)} (expected ${expectedX.toFixed(4)}), Y ${(sumY / n).toFixed(4)} (expected ${expectedY.toFixed(4)}); `
            + `cell by cell within ${worstX.toExponential(1)} (X) and ${worstY.toExponential(1)} (Y) of the CPU deposit`,
    };
}

export const fuelFractions: Scenario = {
    id: 'protostar.fuel-fractions',
    title: 'Protostar: the mass fractions X (hydrogen) and Y (helium) of the gas pass against a CPU deposit, a gas of hydrogen, helium and carbon, float32 and half float',
    tags: ['protostar', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        await restart(context, { count: COUNT_FOR_WARMUP });
        const full = await checkFuelFractions(context, context.floatBlend ? GAMOW_FUEL_TOLERANCE : GAMOW_FUEL_TOLERANCE_HALF_FLOAT);
        forceHalfFloatDeposit(true);
        let half: FuelReport;
        try {
            rebuildPipeline(context);
            await restart(context, { count: COUNT_FOR_WARMUP });
            half = await checkFuelFractions(context, GAMOW_FUEL_TOLERANCE_HALF_FLOAT);
        } finally {
            forceHalfFloatDeposit(false);
            rebuildPipeline(context);
        }
        return {
            status: full.ok && half.ok ? 'pass' : 'fail',
            metrics: { float32Path: full.metrics, halfFloatPath: half.metrics },
            details: `${full.details}. Half-float path: ${half.details}`,
        };
    },
};

// ---- The local exponent ----

interface ExponentPoint {
    gas: string;
    kelvin: number;
    /** The exponent of the law at the nominal temperature (3.9, 41...). */
    nominal: number;
    /** The exponent of the law between the two gases' own temperatures: what the finite difference must give. */
    theory: number;
    /** The exponent measured on the two gases: d ln (mean rate) / d ln (their temperatures). */
    measured: number;
    error: number;
    /** The mean rate of each gas over the law's rate at its own density and temperature (the correction of the noise included on both). */
    rateOverLaw: [number, number];
    rate: number;
}

export const localExponentGas: Scenario = {
    id: 'protostar.local-exponent',
    title: 'Protostar: the temperature exponent d ln rate / d ln T measured on pure gases against the Gamow laws (3.9 at 15 MK for hydrogen, 41 at 100 MK for helium)',
    tags: ['protostar', 'slow'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: `a software renderer (${context.rendererName}) would take hours to draw millions of particles` };
        await restart(context, { count: COUNT_FOR_WARMUP });
        const factors = molecularWeightFactors(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);
        const box = boxForDensity(IGNITION_GAS_DENSITY);
        const density = boxDensity(box);
        const points: ExponentPoint[] = [];
        for (const point of GAMOW_POINTS) {
            const reaction = PROTOSTAR_REACTIONS[point.reaction];
            const type = reaction.from;
            const composition: Composition = { name: PROTOSTAR_TYPES[type].symbol, weights: PROTOSTAR_TYPES.map((_, k) => k === type ? 1 : 0), typeOf: () => type };
            // The rate constant that gives GAMOW_TARGET_RATE at the point, at the gas's density: the rates are far from the cap and from zero.
            const unit = fusionLawOf(reaction, { [reaction.rateParam]: 1 });
            const lambda = GAMOW_TARGET_RATE / (density ** reaction.densityExponent * Math.exp(lawAt(unit, point.kelvin / PROTOSTAR_T0_KELVIN).logLaw));
            const law = fusionLawOf(reaction, { [reaction.rateParam]: lambda });
            const readings = [];
            for (const sign of [-1, 1]) {
                const kelvin = point.kelvin * (1 + sign * GAMOW_STEP);
                const gas = await drawGas(context, composition, box, IGNITION_GAS_PARTICLES, kelvin / PROTOSTAR_T0_KELVIN / factors[type], IGNITION_GAS_SEED,
                    { [reaction.rateParam]: lambda });
                readings.push(gas.reading);
            }
            const [low, high] = readings;
            const measured = Math.log(high.rate / low.rate) / Math.log(high.temperature / low.temperature);
            const theory = (lawAt(law, high.temperature).logLaw - lawAt(law, low.temperature).logLaw) / Math.log(high.temperature / low.temperature);
            points.push({
                gas: `${composition.name} at ${point.kelvin / MEGA} MK`, kelvin: point.kelvin, nominal: localExponent(reaction.law, point.kelvin), theory, measured,
                error: measured / theory - 1,
                rateOverLaw: [low.rate / fusionRate(law, low.density, low.temperature), high.rate / fusionRate(law, high.density, high.temperature)],
                rate: (low.rate + high.rate) / 2,
            });
        }
        const worst = Math.max(...points.map(p => Math.abs(p.error)));
        return {
            status: worst <= GAMOW_EXPONENT_TOLERANCE ? 'pass' : 'fail',
            metrics: {
                particles: IGNITION_GAS_PARTICLES, densityRho0: significant(density, 4), step: GAMOW_STEP, tolerance: GAMOW_EXPONENT_TOLERANCE,
                worstError: significant(worst, 3),
                points: points.map(p => ({
                    gas: p.gas, exponentOfTheLawAtThePoint: significant(p.nominal, 4), exponentBetweenTheGases: significant(p.theory, 4), exponentMeasured: significant(p.measured, 4),
                    error: significant(p.error, 3), meanRate: significant(p.rate, 3),
                    rateOverLawAtItsOwnTemperature: p.rateOverLaw.map(r => significant(r, 4)),
                })),
            },
            details: points.map(p => `${p.gas}: measured ${p.measured.toFixed(3)} against ${p.theory.toFixed(3)} (law ${p.nominal.toFixed(3)} at the point), ${(p.error * 100).toFixed(2)} %`).join('; '),
        };
    },
};
