// Fits for the supernova's scenarios (docs/spikes/a9-coherent-supernova.md): the law of the shock front, R^2 = R0^2 + 2 K t, and
// the homologous speeds of the ejecta, v = H r. Pure (tested in tests/dustLab.test.ts).

import { fitLine, type LineFit } from './haffFit';

export interface FrontFit {
    /** R^2 against t: the slope is 2 K, the intercept R0^2 (plus the offset of the clock). */
    squared: LineFit;
    /** The exponent q for which R^q is the straightest line of time (the front goes as t^(1/q)): 2 for the law, 1 for a front at constant speed. */
    bestPower: number;
    /** RMS error (same unit as R) of the fit R^q = a + b t, for q = 2 (the law) and q = 1 (constant speed). */
    rmsSedov: number;
    rmsLinear: number;
    /** RMS error at the best power. */
    rmsBest: number;
}

/** Least-squares fit of R^q = a + b t, and its RMS error in R. */
function powerFit(series: readonly (readonly [number, number])[], q: number): { line: LineFit; rms: number } {
    const line = fitLine(series.map(([t, r]): [number, number] => [t, r ** q]));
    let sum = 0;
    for (const [t, r] of series) {
        const predicted = Math.max(line.intercept + line.slope * t, 0) ** (1 / q);
        sum += (r - predicted) ** 2;
    }
    return { line, rms: Math.sqrt(sum / series.length) };
}

/**
 * Fits the radius of a front against time. The series is (t, R) points; `powers` are the exponents tried for the free fit
 * (R^q linear in t): the best one is the law's exponent as the data see it.
 */
export function fitFront(series: readonly (readonly [number, number])[], powers: readonly number[]): FrontFit {
    const sedov = powerFit(series, 2);
    const linear = powerFit(series, 1);
    let best = { q: NaN, rms: Infinity };
    for (const q of powers) {
        const { rms } = powerFit(series, q);
        if (rms < best.rms) best = { q, rms };
    }
    return { squared: sedov.line, bestPower: best.q, rmsSedov: sedov.rms, rmsLinear: linear.rms, rmsBest: best.rms };
}

/** Exponents tried by fitFront by default: 0.5 to 4 in steps of 0.05. */
export const FRONT_POWERS: readonly number[] = Array.from({ length: 71 }, (_, i) => 0.5 + 0.05 * i);

/** Speed against distance: the slope is the expansion rate H of a homologous flow, and a flow v = H r has a zero intercept. */
export const fitHomology = (distances: ArrayLike<number>, speeds: ArrayLike<number>): LineFit =>
    fitLine(Array.from(distances, (r, i): [number, number] => [r, speeds[i]]));
