// Numeric helpers of the lab: reductions of the grids read back from the GPU (RGBA, row by row)
// and of time series. Pure (tested in tests/lab.test.ts).

/** Sum of channel `channel` (0..3) of an RGBA array, in double precision. */
export function sumChannel(rgba: ArrayLike<number>, channel: number): number {
    let sum = 0;
    for (let i = channel; i < rgba.length; i += 4) sum += rgba[i];
    return sum;
}

/** Channel `channel` (0..3) of an RGBA array as an array of its own. */
export function extractChannel(rgba: ArrayLike<number>, channel: number): Float64Array {
    const out = new Float64Array(Math.floor(rgba.length / 4));
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + channel];
    return out;
}

/** Largest value of channel `channel` of an RGBA array (-Infinity when empty). */
export function maxChannel(rgba: ArrayLike<number>, channel: number): number {
    let max = -Infinity;
    for (let i = channel; i < rgba.length; i += 4) if (rgba[i] > max) max = rgba[i];
    return max;
}

/** Largest absolute value of channel `channel` of an RGBA array (0 when empty). */
export function maxAbsChannel(rgba: ArrayLike<number>, channel: number): number {
    let max = 0;
    for (let i = channel; i < rgba.length; i += 4) if (Math.abs(rgba[i]) > max) max = Math.abs(rgba[i]);
    return max;
}

/** Largest absolute difference between two arrays of the same length (Infinity if the lengths differ). */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
    if (a.length !== b.length) return Infinity;
    let max = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > max || Number.isNaN(d)) max = d;
    }
    return max;
}

/** |a - b| / |b|, or |a| when b is 0. */
export const relativeDiff = (a: number, b: number): number => Math.abs(a - b) / (b === 0 ? 1 : Math.abs(b));

export const mean = (values: readonly number[]): number =>
    values.length === 0 ? NaN : values.reduce((s, v) => s + v, 0) / values.length;

/** The value at fraction `q` (0..1) of the sorted values, linearly interpolated. NaN when empty. */
export function quantile(values: readonly number[], q: number): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const position = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** At most `points` evenly spaced elements of `series`, always including the first and the last. */
export function decimate<T>(series: readonly T[], points: number): T[] {
    if (series.length <= points || points < 2) return [...series];
    return Array.from({ length: points }, (_, i) => series[Math.round(i * (series.length - 1) / (points - 1))]);
}

/** `value` rounded to `digits` significant digits (non-finite values are returned as they are). */
export const significant = (value: number, digits: number): number =>
    Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(digits)) : value;

/**
 * The orders in which to measure `items` in each of `rounds` rounds of an alternating comparison:
 * the permutations of `items` in turn (2 items: ab, ba, ab...; 3 items: six orders), so that a
 * steady drift of the machine does not favor one item. Pure.
 */
export function alternatingOrders<T>(items: readonly T[], rounds: number): T[][] {
    const permutations = (rest: readonly T[]): T[][] => rest.length <= 1 ? [[...rest]]
        : rest.flatMap((item, i) => permutations([...rest.slice(0, i), ...rest.slice(i + 1)]).map(tail => [item, ...tail]));
    const all = permutations(items);
    // A step of 5 through the listing (coprime with 2 and with 6) visits every order once per cycle.
    return Array.from({ length: rounds }, (_, r) => [...all[(r * 5) % all.length]]);
}
