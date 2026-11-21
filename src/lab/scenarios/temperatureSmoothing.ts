// What the average of the temperature over time (proposal A3, lever 2) buys: the noise of T from
// cell to cell of a thermal gas that moves as a gas does (no gravity, no cooling, hydrogen that
// does not fuse), with the instantaneous temperature and with the exponential average of time
// constant tau, for several tau. The average removes noise only as fast as the particles of a
// neighborhood are replaced, so its gain is 1 + tau / tau_c with tau_c the time a neighborhood
// takes to renew its particles: measured here, as the ratio of the two relative variances across
// the interior cells once the average has settled, and as the autocorrelation of the temperature.

import { PROTOSTAR_GRID_RES } from '../../config';
import { smoothingWeight } from '../../simulation/protostar/noiseBias';
import {
    LAB_AREA, SMOOTHING_FRAMES, SMOOTHING_LAGS, SMOOTHING_MARGIN, SMOOTHING_PARTICLES, SMOOTHING_TAUS, SMOOTHING_TEMPERATURE,
    THERMAL_GAS_INTERIOR_CELLS, THERMAL_GAS_OVERRIDES,
} from '../config';
import { protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { significant } from '../numbers';
import { mulberry32 } from '../random';
import { readAttachment, readTarget } from '../readback';
import { fillThermalGas, LAB_CELL, thermalSigma, type Box } from '../thermalGas';
import type { JsonValue, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const SIGMA = thermalSigma(SMOOTHING_TEMPERATURE);
const SEED = 4242;

interface Series {
    /** The instantaneous temperature and the average, per frame, over the interior cells (row-major, the same cells every frame). */
    instant: Float64Array[];
    averaged: Float64Array[];
}

const mean = (values: ArrayLike<number>): number => {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
};
const relativeVariance = (values: ArrayLike<number>): number => {
    const m = mean(values);
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += (values[i] - m) ** 2;
    return sum / values.length / (m * m);
};

/** Autocorrelation of the cell-to-cell deviation of the temperature at `lag` frames, over the frames from `first`. */
function autocorrelation(frames: readonly Float64Array[], first: number, lag: number): number {
    let product = 0, square = 0;
    for (let f = first; f + lag < frames.length; f++) {
        const [a, b] = [frames[f], frames[f + lag]];
        const [ma, mb] = [mean(a), mean(b)];
        for (let i = 0; i < a.length; i++) {
            product += (a[i] - ma) * (b[i] - mb);
            square += (a[i] - ma) ** 2;
        }
    }
    return product / square;
}

async function run(context: Parameters<Scenario['run']>[0], tau: number, box: Box): Promise<Series> {
    const { renderer } = context;
    const model = protostarModel(context);
    model.debugInitialState = state => fillThermalGas(state, box, SIGMA, mulberry32(SEED));
    try {
        await restart(context, { count: SMOOTHING_PARTICLES, overrides: { ...THERMAL_GAS_OVERRIDES, feedback: 0, fusionRate: 0 }, timeScale: 1, seed: SEED });
    } finally {
        model.debugInitialState = null;
    }
    model.debugGrids.temperatureTau = tau;
    const targets = protostarGrids(context);
    const m = THERMAL_GAS_INTERIOR_CELLS + Math.ceil(SMOOTHING_MARGIN / LAB_CELL);
    const [x0, x1] = [Math.ceil(box.x0 / LAB_CELL) + m, Math.floor(box.x1 / LAB_CELL) - m];
    const [y0, y1] = [Math.ceil(box.y0 / LAB_CELL) + m, Math.floor(box.y1 / LAB_CELL) - m];
    const series: Series = { instant: [], averaged: [] };
    await runFrames(context, SMOOTHING_FRAMES, {
        async onFrame() {
            const gas = await readTarget(renderer, targets.gas);
            const thermo = await readAttachment(renderer, targets.gas, 1);
            const instant = new Float64Array((x1 - x0) * (y1 - y0));
            const averaged = new Float64Array(instant.length);
            let k = 0;
            for (let cy = y0; cy < y1; cy++) {
                for (let cx = x0; cx < x1; cx++) {
                    const cell = (cy * PROTOSTAR_GRID_RES + cx) * 4;
                    instant[k] = gas[cell + 1];
                    averaged[k++] = thermo[cell];
                }
            }
            series.instant.push(instant);
            series.averaged.push(averaged);
        },
    });
    return series;
}

export const temperatureSmoothing: Scenario = {
    id: 'protostar.temperature-smoothing',
    title: 'Smoothing of the temperature over time: noise of T from cell to cell of a thermal gas, instantaneous and averaged, for several time constants',
    tags: ['protostar', 'noise', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        if (context.software) return { status: 'skip', metrics: {}, details: `a software renderer (${context.rendererName}) would take hours to draw millions of particles` };
        await restart(context, { count: 1000 });
        const box: Box = { x0: SMOOTHING_MARGIN, y0: SMOOTHING_MARGIN, x1: LAB_AREA.width - SMOOTHING_MARGIN, y1: LAB_AREA.height - SMOOTHING_MARGIN };
        const dt = 1 / 60;
        const rows: Record<string, JsonValue>[] = [];
        let correlations: Record<string, JsonValue> = {};
        for (const tau of SMOOTHING_TAUS) {
            const series = await run(context, tau, box);
            // The average has settled after a few time constants; the readings before that are left out.
            const first = Math.max(2, Math.ceil(4 * tau / dt));
            const frames = series.instant.slice(first);
            const averaged = series.averaged.slice(first);
            const instantVariance = mean(frames.map(relativeVariance));
            const averagedVariance = mean(averaged.map(relativeVariance));
            const drift = mean(averaged.map(mean)) / mean(frames.map(mean)) - 1;
            rows.push({
                tauSeconds: tau, weightPerStep: significant(smoothingWeight(dt, tau), DIGITS), frames: frames.length,
                relativeVarianceInstant: significant(instantVariance, DIGITS), relativeVarianceAveraged: significant(averagedVariance, DIGITS),
                gain: significant(instantVariance / averagedVariance, DIGITS), meanDrift: significant(drift, 2),
            });
            if (tau === 0) {
                correlations = Object.fromEntries(SMOOTHING_LAGS.map(lag => [`lag${lag}Frames`, significant(autocorrelation(series.instant, 2, lag), 3)]));
            }
        }
        const finite = rows.every(r => Number.isFinite(r.gain as number));
        return {
            status: finite ? 'pass' : 'fail',
            metrics: {
                temperatureT0: SMOOTHING_TEMPERATURE, sigmaPxPerSecond: significant(SIGMA, DIGITS), particles: SMOOTHING_PARTICLES, stepSeconds: significant(dt, DIGITS),
                rows, autocorrelationOfInstantTemperature: correlations,
            },
            details: rows.map(r => `tau=${r.tauSeconds}s: gain ${r.gain} (variance ${r.relativeVarianceInstant} -> ${r.relativeVarianceAveraged})`).join('; '),
        };
    },
};
