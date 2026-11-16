import { describe, expect, it } from 'vitest';
import { quickMetrics, quickRowCount, quickValueText } from '../src/elementsQuickModel';
import { buildMetrics } from '../src/elementMetrics';
import { PROTOSTAR } from '../src/simulation/protostar/declaration';
import { STICKY_DUST } from '../src/simulation/stickyDust/declaration';

describe('simple element editor', () => {
    it('offers atomic mass then size, for every algorithm', () => {
        for (const algorithm of [STICKY_DUST, PROTOSTAR]) {
            expect(quickMetrics(buildMetrics(algorithm.particleTypes)).map(m => m.id)).toEqual(['mass', 'size']);
        }
    });

    it('shows the unit after the value', () => {
        const [mass] = quickMetrics(buildMetrics(STICKY_DUST.particleTypes));
        expect(quickValueText(mass, '12.0')).toBe(`12.0 ${mass.unit}`);
    });

    it('lists the selected elements, within the available ones', () => {
        expect(quickRowCount(3, 10)).toBe(3);
        expect(quickRowCount(12, 10)).toBe(10);
        expect(quickRowCount(-1, 10)).toBe(0);
    });
});
