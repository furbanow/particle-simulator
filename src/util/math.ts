import type { Range } from '../config';

export const clamp = (x: number, [lo, hi]: Range): number => Math.min(hi, Math.max(lo, x));

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}
