import { describe, expect, it } from 'vitest';
import { harmonicAnisotropy, radialTangential, ringStats, vectorError } from '../src/lab/gravityStats';

describe('lab: sticky dust gravity statistics', () => {
    it('measures the error of a field against its reference', () => {
        // Three points: exact, 1 % off, and a reference that nearly cancels (not judged by its relative error).
        const rgba = [
            1, 0, 1, 0,
            0, 2, 0, 2.02,
            0.001, 0, 0.002, 0,
        ];
        const stats = vectorError(rgba, 3, 0.1, 0.005);
        expect(stats.count).toBe(3);
        expect(stats.significant).toBe(2);
        expect(stats.max).toBeCloseTo(0.01, 10);
        expect(stats.fractionOver).toBeCloseTo(0.5, 10);
        expect(stats.absoluteMax).toBeLessThan(0.02);
        expect(stats.relativeL2).toBeLessThan(0.02);
    });

    it('splits a pull into its parts along and across the direction to the mass', () => {
        // At angle 0 the mass is to the left: a pull toward -x is toward the mass.
        expect(radialTangential(-3, 0, 0).radial).toBeCloseTo(3, 12);
        expect(radialTangential(0, 2, 0).tangential).toBeCloseTo(2, 12);
        const a = Math.PI / 3;
        const r = radialTangential(-Math.cos(a), -Math.sin(a), a);
        expect(r.radial).toBeCloseTo(1, 12);
        expect(r.tangential).toBeCloseTo(0, 12);
    });

    it('reads the anisotropy of a ring as the deviation from the mean at the worst angle', () => {
        const angles = Array.from({ length: 360 }, (_, i) => i * Math.PI / 180);
        const radial = angles.map(a => 10 * (1 + 0.04 * Math.cos(4 * a)));
        const stats = ringStats(radial, angles.map(() => 0.1));
        expect(stats.mean).toBeCloseTo(10, 10);
        expect(stats.anisotropy).toBeCloseTo(0.04, 3);
        expect(stats.relativeStd).toBeCloseTo(0.04 / Math.SQRT2, 3);
        expect(stats.tangential).toBeCloseTo(0.01, 10);
        expect(ringStats([2, 2, 2], [0, 0, 0]).anisotropy).toBe(0);
    });

    it('reads the anisotropy from the harmonics of a square kernel only, whatever the noise at the other orders', () => {
        const n = 720;
        const angle = (k: number): number => (k + 0.5) / n * 2 * Math.PI;
        const square = Array.from({ length: n }, (_, k) => 10 * (1 + 0.03 * Math.cos(4 * angle(k)) + 0.01 * Math.cos(8 * angle(k) + 1)));
        const noisy = square.map((v, k) => v + 0.4 * Math.sin(3 * angle(k)) + 0.3 * Math.cos(7 * angle(k)) + 0.2 * Math.sin(37 * angle(k)));
        const clean = harmonicAnisotropy(square, [4, 8, 12, 16]);
        expect(harmonicAnisotropy(noisy, [4, 8, 12, 16])).toBeCloseTo(clean, 10);
        // The raw figure picks the noise up.
        expect(ringStats(noisy, noisy.map(() => 0)).anisotropy).toBeGreaterThan(2 * clean);
        expect(ringStats(noisy, noisy.map(() => 0), [4, 8, 12, 16]).smoothAnisotropy).toBeCloseTo(clean, 10);
        expect(clean).toBeGreaterThan(0.03);
        expect(clean).toBeLessThan(0.05);
        expect(harmonicAnisotropy([2, 2, 2, 2], [4])).toBe(0);
        expect(harmonicAnisotropy([1, 2, 3], [])).toBeNaN();
    });
});
