// Reductions of the sticky dust's gravity probes (pure, tested in tests/lab.test.ts): the error of
// one field against a reference at the same points, and the anisotropy of a point mass's pull.

import { quantile } from './numbers';

export interface VectorErrorStats {
    /** Vectors compared. */
    count: number;
    /** Those whose reference is at least `floor` long: the relative error is judged on them only. */
    significant: number;
    /** floorFraction x the RMS length of the references. */
    floor: number;
    rmsReference: number;
    /** Relative error |test - reference| / |reference| over the significant vectors. */
    median: number;
    p95: number;
    p99: number;
    max: number;
    /** Fraction of the significant vectors whose relative error exceeds `limit`. */
    fractionOver: number;
    /** |test - reference| in units of the RMS reference, over all vectors (no division by a small length). */
    absoluteP99: number;
    absoluteMax: number;
    /** sqrt(sum |test - reference|^2 / sum |reference|^2). */
    relativeL2: number;
}

/**
 * Compares two fields sampled at the same points, packed as RGBA (reference in R, G; test in B,
 * A), `count` points. Where the reference is nearly zero (the pulls cancel) a relative error
 * means little, hence the floor and the absolute figures next to it.
 */
export function vectorError(rgba: ArrayLike<number>, count: number, floorFraction: number, limit: number): VectorErrorStats {
    const length: number[] = [];
    const difference: number[] = [];
    let sumReference = 0;
    let sumDifference = 0;
    for (let i = 0; i < count; i++) {
        const rx = rgba[i * 4], ry = rgba[i * 4 + 1];
        const dx = rgba[i * 4 + 2] - rx, dy = rgba[i * 4 + 3] - ry;
        length.push(Math.hypot(rx, ry));
        difference.push(Math.hypot(dx, dy));
        sumReference += rx * rx + ry * ry;
        sumDifference += dx * dx + dy * dy;
    }
    const rmsReference = Math.sqrt(sumReference / Math.max(1, count));
    const floor = floorFraction * rmsReference;
    const relative: number[] = [];
    for (let i = 0; i < count; i++) if (length[i] >= floor && length[i] > 0) relative.push(difference[i] / length[i]);
    const absolute = difference.map(d => d / (rmsReference || 1));
    return {
        count,
        significant: relative.length,
        floor,
        rmsReference,
        median: quantile(relative, 0.5),
        p95: quantile(relative, 0.95),
        p99: quantile(relative, 0.99),
        max: relative.length === 0 ? NaN : relative.reduce((m, v) => Math.max(m, v), 0),
        fractionOver: relative.length === 0 ? NaN : relative.filter(v => v > limit).length / relative.length,
        absoluteP99: quantile(absolute, 0.99),
        absoluteMax: absolute.reduce((m, v) => Math.max(m, v), 0),
        relativeL2: sumReference > 0 ? Math.sqrt(sumDifference / sumReference) : NaN,
    };
}

/** The components of the pull (gx, gy) at `angle` around a mass: toward the mass (positive when attracted), and across. */
export function radialTangential(gx: number, gy: number, angle: number): { radial: number; tangential: number } {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { radial: -(gx * c + gy * s), tangential: -gx * s + gy * c };
}

export interface RingStats {
    /** Mean of the pull toward the mass over the angles. */
    mean: number;
    /** (max - min) / (max + min) of the pull toward the mass: the deviation from the mean, as a fraction, at its worst angle. Includes the noise. */
    anisotropy: number;
    /**
     * The same figure on the smooth part of the angular profile only: its mean plus its harmonics of the given
     * orders (a square kernel has 4, 8, 12, 16), the rest being noise. NaN when no orders are given.
     */
    smoothAnisotropy: number;
    /** Standard deviation of the pull toward the mass over its mean. */
    relativeStd: number;
    /** The largest pull across the direction to the mass, over the mean pull toward it (how far the pull points off the mass). */
    tangential: number;
}

/**
 * (max - min) / (max + min) of the mean of `samples` (taken at angles (k + 0.5) / n of the turn) plus its
 * harmonics of the given orders, rebuilt at the sampling angles: what is left of the angular profile once
 * the noise at the other orders is removed. 0 for a constant profile, NaN when no orders are given.
 */
export function harmonicAnisotropy(samples: ArrayLike<number>, orders: readonly number[]): number {
    const n = samples.length;
    if (orders.length === 0 || n === 0) return NaN;
    let mean = 0;
    for (let k = 0; k < n; k++) mean += samples[k];
    mean /= n;
    const angle = (k: number): number => (k + 0.5) / n * 2 * Math.PI;
    const terms = orders.map(order => {
        let cos = 0, sin = 0;
        for (let k = 0; k < n; k++) {
            cos += samples[k] * Math.cos(order * angle(k));
            sin += samples[k] * Math.sin(order * angle(k));
        }
        return { order, cos: 2 * cos / n, sin: 2 * sin / n };
    });
    let min = Infinity, max = -Infinity;
    for (let k = 0; k < n; k++) {
        let value = mean;
        for (const { order, cos, sin } of terms) value += cos * Math.cos(order * angle(k)) + sin * Math.sin(order * angle(k));
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    return max + min === 0 ? NaN : (max - min) / (max + min);
}

/** How much a pull depends on the angle, from its components around a ring centered on the mass. `orders`: see harmonicAnisotropy. */
export function ringStats(radial: ArrayLike<number>, tangential: ArrayLike<number>, orders: readonly number[] = []): RingStats {
    const n = radial.length;
    let sum = 0, min = Infinity, max = -Infinity, off = 0;
    for (let i = 0; i < n; i++) {
        sum += radial[i];
        min = Math.min(min, radial[i]);
        max = Math.max(max, radial[i]);
        off = Math.max(off, Math.abs(tangential[i]));
    }
    const mean = sum / n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (radial[i] - mean) ** 2;
    return {
        mean,
        anisotropy: max + min === 0 ? NaN : (max - min) / (max + min),
        smoothAnisotropy: harmonicAnisotropy(radial, orders),
        relativeStd: mean === 0 ? NaN : Math.sqrt(variance / n) / Math.abs(mean),
        tangential: mean === 0 ? NaN : off / Math.abs(mean),
    };
}
