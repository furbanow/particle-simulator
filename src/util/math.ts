import type { Range } from '../config';

export const clamp = (x: number, [lo, hi]: Range): number => Math.min(hi, Math.max(lo, x));

// Significant digits kept when rounding to a step, so 0.1 * 23 comes out as 2.3.
const STEP_PRECISION = 12;

/** Rounds `x` to a multiple of `step`, inside `range`. */
export const snap = (x: number, step: number, range: Range): number =>
    clamp(Number((Math.round(x / step) * step).toPrecision(STEP_PRECISION)), range);

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}
