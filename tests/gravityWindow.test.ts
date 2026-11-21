import { describe, expect, it } from 'vitest';
import { DENSITY_RES, DENSITY_TOP_LEVEL } from '../src/config';
import { gravityWindow, levelRect } from '../src/simulation/stickyDust/gravityWindow';

describe('gravityWindow', () => {
    it('covers the screen in the shifted grid, plus the margin', () => {
        // A 1000 x 600 screen in a field of 2000 px (512 texels).
        const w = gravityWindow(500, 250, 2000, 1000, 600, DENSITY_RES, 2);
        expect(w).toEqual({
            x0: Math.floor(500 / 2000 * 512) - 2, y0: Math.floor(250 / 2000 * 512) - 2,
            x1: Math.floor(1500 / 2000 * 512) + 1 + 2, y1: Math.floor(850 / 2000 * 512) + 1 + 2,
        });
    });

    it('stays inside the field for any shift of the grid', () => {
        // The shift runs from 0 to half the field; the screen is at most half of it.
        for (const offset of [0, 1000, 999.9]) {
            const w = gravityWindow(offset, offset, 2000, 1000, 1000, DENSITY_RES, 2);
            expect(w.x0).toBeGreaterThanOrEqual(0);
            expect(w.x1).toBeLessThanOrEqual(DENSITY_RES);       // the corners of the texels: 0..res
            expect(w.x1).toBeGreaterThan(w.x0);
        }
        expect(gravityWindow(0, 0, 2000, 1000, 1000, DENSITY_RES, 2).x0).toBe(0);
    });

    it('lets each level keep the texels its corners read bilinearly, apron included', () => {
        const rect = { x0: 100, y0: 37, x1: 230, y1: 160 };
        for (let level = 1; level <= DENSITY_TOP_LEVEL; level++) {
            const r = levelRect(rect, level, DENSITY_RES);
            const count = DENSITY_RES >> level;
            expect(r.x0).toBeGreaterThanOrEqual(0);
            expect(r.x1).toBeLessThanOrEqual(count + 1);
            // The corner x of the rect sits at x / 2^level - 0.5 in texels of the level: it reads the two texels around it.
            for (const x of [rect.x0, rect.x1]) {
                const low = Math.floor(x / 2 ** level - 0.5);
                expect(low + 1).toBeGreaterThanOrEqual(r.x0);          // + 1: the apron shifts the index
                expect(low + 2).toBeLessThanOrEqual(r.x1);
            }
        }
    });

    it('reaches the apron when the rect touches the edge of the field', () => {
        const whole = { x0: 0, y0: 0, x1: DENSITY_RES, y1: DENSITY_RES };
        for (let level = 1; level <= DENSITY_TOP_LEVEL; level++) {
            const count = DENSITY_RES >> level;
            expect(levelRect(whole, level, DENSITY_RES)).toEqual({ x0: 0, y0: 0, x1: count + 1, y1: count + 1 });
        }
    });
});
