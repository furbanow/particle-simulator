import { RANDOM_WEIGHT_RANGE } from './config';
import { formatNumber, t } from './i18n';

/**
 * Population share of each of the first `typeCount` species (weights beyond are ignored).
 * When every weight is zero the split falls back to uniform.
 */
export function populationShares(weights: readonly number[], typeCount: number): number[] {
    const used = weights.slice(0, typeCount).map(w => Math.max(0, w));
    const sum = used.reduce((a, b) => a + b, 0);
    return sum > 0 ? used.map(w => w / sum) : used.map(() => 1 / used.length);
}

/**
 * Integer particle counts per species, summing exactly to `total` (largest remainder method).
 * The result has one entry per weight; species at or beyond `typeCount` get zero.
 */
export function splitPopulation(total: number, weights: readonly number[], typeCount: number): number[] {
    const counts = new Array<number>(weights.length).fill(0);
    const shares = populationShares(weights, typeCount);
    const exact = shares.map(s => s * total);
    let assigned = 0;
    exact.forEach((x, k) => { counts[k] = Math.floor(x); assigned += counts[k]; });
    const byRemainder = exact.map((x, k) => ({ k, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
    for (let i = 0; i < total - assigned; i++) counts[byRemainder[i % byRemainder.length].k]++;
    return counts;
}

/** "12 %", one decimal below 10 % so small shares don't read as 0. */
export function formatShare(share: number): string {
    const pct = share * 100;
    return t('format.percent', { value: formatNumber(pct, pct > 0 && pct < 10 ? 1 : 0) });
}

/** Smallest share written as a number by formatTraceShare(): 0.1 %. */
const TRACE_SHARE = 0.001;

/**
 * formatShare(), except that a share too small for it to show (under 0.1 %) reads "<0.1%" and only an empty one reads "0%", so that
 * a trace of an element does not look like none. "<" is a sign, not a word: no translated text is assembled.
 */
export function formatTraceShare(share: number): string {
    if (share > 0 && share < TRACE_SHARE) return t('format.percent', { value: `<${formatNumber(TRACE_SHARE * 100, 1)}` });
    return formatShare(share);
}

/** Random weights in RANDOM_WEIGHT_RANGE (never zero, so every visible species stays populated). */
export function randomPopulationWeights(count: number, random: () => number = Math.random): number[] {
    const [lo, hi] = RANDOM_WEIGHT_RANGE;
    return Array.from({ length: count }, () => lo + random() * (hi - lo));
}
