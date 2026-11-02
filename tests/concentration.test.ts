import { describe, expect, it } from 'vitest';
import { analyzeConcentration } from '../src/simulation/concentration';

/** Packs (x, y) pairs into the RGBA layout read back from the position texture. */
function texels(points: [number, number][]): Float32Array {
    const data = new Float32Array(points.length * 4);
    points.forEach(([x, y], i) => { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 3] = 1; });
    return data;
}

describe('analyzeConcentration', () => {
    it('finds the cluster, its centroid and flags its members', () => {
        const cluster: [number, number][] = Array.from({ length: 80 }, (_, i) =>
            [300 + Math.cos(i) * 10, 200 + Math.sin(i) * 10]);
        const scattered: [number, number][] = Array.from({ length: 20 }, (_, i) => [30 + i * 35, 550]);
        const points = [...cluster, ...scattered];
        const mask = new Uint8Array(points.length);

        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask);

        expect(r.members).toBe(80);
        expect(r.fraction).toBeCloseTo(0.8);
        expect(r.centerX).toBeCloseTo(300, 0);
        expect(r.centerY).toBeCloseTo(200, 0);
        expect([...mask.subarray(0, 80)].every(v => v === 255)).toBe(true);
        expect([...mask.subarray(80)].every(v => v === 0)).toBe(true);
    });

    it('reports a low fraction for a uniform spread', () => {
        const points: [number, number][] = [];
        for (let x = 5; x < 800; x += 20) for (let y = 5; y < 600; y += 20) points.push([x, y]);
        const mask = new Uint8Array(points.length);

        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask);

        expect(r.fraction).toBeLessThan(0.05);
    });

    it('returns an empty result without particles', () => {
        const r = analyzeConcentration(new Float32Array(0), 0, 40, 800, 600, new Uint8Array(0));

        expect(r.members).toBe(0);
        expect(r.fraction).toBe(0);
    });
});
