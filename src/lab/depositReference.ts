// The cloud-in-cell deposit of protostar-deposit.vert / .frag computed on the CPU, in double
// precision, from the position texture read back: the reference the GPU grids are compared with.
// Pure (tested in tests/lab.test.ts): no GPU, no DOM.

import { MAX_SPECIES } from '../config';
import type { DepositInputs } from '../simulation/protostar/grids';

/** The composition deposit's channels: (m (1 + Z) / A, m of the hydrogen fuel, m^2, m of the helium fuel). */
export const COMPOSITION_CHANNELS = 4;

export interface DepositReference {
    /** The composition deposit, RGBA per cell, row by row from the bottom (the read-back's order). */
    composition: Float64Array;
    /** The mass channel of the moments deposit (sum of the weighted masses), one value per cell. */
    mass: Float64Array;
    /** The weighted number of particles of each cell (the sum of their cloud-in-cell weights: no channel of the deposit holds it any more). */
    occupancy: Float64Array;
    /**
     * Per cell, how many particles' clouds reach it, within `weightMargin` of the edge of their
     * footprint (so that a cell the GPU rounds into a cloud is counted too).
     */
    contributions: Uint32Array;
    /** Largest unweighted value of each composition channel over the particles (a weight of 1). */
    payloadMax: number[];
    /** Live particles whose cloud lands on the grid. */
    deposited: number;
}

/**
 * Deposits `count` particles, read from `texels` (RGBA per particle: x, y, type, w; a negative w is
 * a removed particle), the way the deposit shaders do: the particle's cloud is the 2x2 cells
 * around it with weights max(1 - |distance between cell centers|, 0) per axis, and a particle
 * whose block starts outside the grid is dropped (its point is clipped).
 * `weightMargin` widens the counted footprint (see DepositReference.contributions).
 */
export function referenceDeposit(texels: ArrayLike<number>, count: number, inputs: DepositInputs, weightMargin: number): DepositReference {
    const res = inputs.gridResolution;
    const composition = new Float64Array(res * res * COMPOSITION_CHANNELS);
    const mass = new Float64Array(res * res);
    const occupancy = new Float64Array(res * res);
    const contributions = new Uint32Array(res * res);
    const payloadMax = new Array<number>(COMPOSITION_CHANNELS).fill(0);
    let deposited = 0;
    for (let i = 0; i < count; i++) {
        const [x, y, z, w] = [texels[i * 4], texels[i * 4 + 1], texels[i * 4 + 2], texels[i * 4 + 3]];
        if (!(w >= 0)) continue;
        const k = Math.min(Math.max(Math.trunc(z + 0.5), 0), MAX_SPECIES - 1);
        const m = inputs.splatMass[k] * inputs.depositMassScale;
        const [fuelX, fuelY] = inputs.fuel[k];
        const payload = [m * inputs.inverseMolecularWeight[k], m * fuelX, m * m, m * fuelY];
        const px = x / inputs.gridCell;
        const py = y / inputs.gridCell;
        const cx = Math.floor(px - 0.5) + 1;
        const cy = Math.floor(py - 0.5) + 1;
        if (!(cx >= 0 && cx <= res && cy >= 0 && cy <= res)) continue;
        deposited++;
        payload.forEach((v, c) => { payloadMax[c] = Math.max(payloadMax[c], v); });
        // A 4x4 block around the particle covers the GPU's 2x2 one and the cells at its margin.
        for (let iy = cy - 2; iy <= cy + 1; iy++) {
            const wy = 1 - Math.abs(iy + 0.5 - py);
            if (iy < 0 || iy >= res || wy <= -weightMargin) continue;
            for (let ix = cx - 2; ix <= cx + 1; ix++) {
                const wx = 1 - Math.abs(ix + 0.5 - px);
                if (ix < 0 || ix >= res || wx <= -weightMargin) continue;
                const cell = iy * res + ix;
                contributions[cell]++;
                const weight = Math.max(wx, 0) * Math.max(wy, 0);
                if (weight === 0) continue;
                for (let c = 0; c < COMPOSITION_CHANNELS; c++) composition[cell * COMPOSITION_CHANNELS + c] += payload[c] * weight;
                mass[cell] += m * weight;
                occupancy[cell] += weight;
            }
        }
    }
    return { composition, mass, occupancy, contributions, payloadMax, deposited };
}

/**
 * How much error a deposit path may make: each contribution to a cell suffers `roundings`
 * roundings of relative size `roundoff` (the product with the weight, the rounded output, the
 * addition into the accumulated sum, which is at most the cell's value), and its weight is off by
 * up to `weightError` (the GPU computes it from a position divided in single precision, up to 128
 * cells from the origin), which moves the value by `weightError` times the largest payload.
 */
export interface DepositTolerance {
    roundoff: number;
    roundings: number;
    weightError: number;
}

export interface ChannelComparison {
    channel: number;
    /** Largest |gpu - reference| / tolerance over the cells: the deposit holds when it is at most 1. */
    maxExcess: number;
    /** Largest |gpu - reference| / reference over the cells where the reference is positive. */
    maxRelativeError: number;
    cellsOverTolerance: number;
    sumGpu: number;
    sumReference: number;
}

/** Compares a read-back RGBA grid with the reference, channel by channel, against the tolerance model. */
export function compareDeposit(gpu: ArrayLike<number>, reference: DepositReference, tolerance: DepositTolerance): ChannelComparison[] {
    const cells = reference.contributions.length;
    return Array.from({ length: COMPOSITION_CHANNELS }, (_, channel): ChannelComparison => {
        const result: ChannelComparison = { channel, maxExcess: 0, maxRelativeError: 0, cellsOverTolerance: 0, sumGpu: 0, sumReference: 0 };
        for (let cell = 0; cell < cells; cell++) {
            const g = gpu[cell * COMPOSITION_CHANNELS + channel];
            const r = reference.composition[cell * COMPOSITION_CHANNELS + channel];
            const allowed = reference.contributions[cell]
                * (tolerance.roundings * tolerance.roundoff * Math.abs(r) + tolerance.weightError * reference.payloadMax[channel]);
            const error = Math.abs(g - r);
            const excess = error === 0 ? 0 : error / allowed;
            result.sumGpu += g;
            result.sumReference += r;
            if (Number.isNaN(excess)) { result.maxExcess = NaN; continue; }
            if (excess > result.maxExcess) result.maxExcess = excess;
            if (excess > 1) result.cellsOverTolerance++;
            if (r > 0) result.maxRelativeError = Math.max(result.maxRelativeError, error / r);
        }
        return result;
    });
}

/**
 * Largest relative error of a per-cell ratio `numerator / denominator` (for instance m / mu over m, the
 * mean 1 / mu), with the sums taken over the (2 radius + 1)^2 cells around each cell (radius 1: the 3x3
 * neighborhoods the gas pass uses; 0: the cell alone). Only cells whose reference denominator is at
 * least `minDenominator` count: where almost nothing was deposited the weights' own error dominates a ratio.
 * Grids are one channel each, `resolution` x `resolution`.
 */
export function ratioError(gpuNumerator: ArrayLike<number>, gpuDenominator: ArrayLike<number>,
                           referenceNumerator: ArrayLike<number>, referenceDenominator: ArrayLike<number>,
                           resolution: number, radius: number, minDenominator: number): number {
    const sum = (grid: ArrayLike<number>, x: number, y: number): number => {
        let total = 0;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const cx = x + dx;
                const cy = y + dy;
                if (cx >= 0 && cx < resolution && cy >= 0 && cy < resolution) total += grid[cy * resolution + cx];
            }
        }
        return total;
    };
    let worst = 0;
    for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
            const denominator = sum(referenceDenominator, x, y);
            if (denominator < minDenominator) continue;
            const expected = sum(referenceNumerator, x, y) / denominator;
            const actual = sum(gpuNumerator, x, y) / sum(gpuDenominator, x, y);
            const error = Math.abs(actual - expected) / Math.abs(expected);
            if (Number.isNaN(error)) return NaN;
            worst = Math.max(worst, error);
        }
    }
    return worst;
}
