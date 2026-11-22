import { describe, expect, it } from 'vitest';
import { momentumChange, totalMomentum, typeChanges } from '../src/lab/conservation';

const texels = (rows: number[][]): Float32Array => Float32Array.from(rows.flat());

describe('total momentum', () => {
    const positions = texels([[0, 0, 0, 1], [0, 0, 1, 1], [0, 0, 1, -1], [0, 0, 0, 1]]);
    const velocities = texels([[3, 0, 0, 0], [0, 4, 0, 0], [100, 100, 0, 0], [-3, 0, 0, 0]]);
    const massOf = (type: number): number => [1, 2][type];

    it('weighs each live particle by its type and leaves out the removed ones and those beyond count', () => {
        const sums = totalMomentum(positions, velocities, 3, massOf);
        expect(sums).toEqual({ live: 2, mass: 3, px: 3, py: 8, absolute: 3 + 8, doubleKinetic: 9 + 2 * 16 });
        expect(totalMomentum(positions, velocities, 4, massOf).px).toBe(0);
    });

    it('is judged against the thermal momentum M sigma and against the sum of m |v|', () => {
        const start = totalMomentum(positions, velocities, 4, massOf);
        const sigma = Math.sqrt((9 + 32 + 9) / (2 * 4));
        const moved = { ...start, px: start.px + 0.5, py: start.py - 1.2 };
        const change = momentumChange(start, moved);
        expect(change.absolute).toBeCloseTo(1.3, 12);
        expect(change.relativeThermal).toBeCloseTo(1.3 / (4 * sigma), 12);
        expect(change.relativeAbsolute).toBeCloseTo(1.3 / (3 + 8 + 3), 12);
        expect(momentumChange(start, start).relativeThermal).toBe(0);
        expect(momentumChange(totalMomentum(positions, velocities, 0, massOf), start).relativeThermal).toBeNaN();
    });
});

describe('type changes', () => {
    it('counts the particles that changed type, from and to, and those that vanished', () => {
        const before = texels([[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 1, 1], [0, 0, 2, 1], [0, 0, 1, 1]]);
        const after = texels([[0, 0, 1, 1], [0, 0, 0, 1], [0, 0, 2, 1], [0, 0, 2, 1], [0, 0, 1, -1]]);
        const { moved, lost } = typeChanges(before, after, 5, 3);
        expect(moved).toEqual([[0, 1, 0], [0, 0, 1], [0, 0, 0]]);
        expect(lost).toBe(1);
    });
});
