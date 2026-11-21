import { describe, expect, it } from 'vitest';
import { analyzeConcentration } from '../src/simulation/concentration';

/** Packs (x, y, species) triples into the RGBA layout read back from the position texture (species 0 when omitted). */
function texels(points: ([number, number] | [number, number, number])[]): Float32Array {
    const data = new Float32Array(points.length * 4);
    points.forEach(([x, y, species], i) => { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = species ?? 0; data[i * 4 + 3] = 1; });
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

describe('analyzeConcentration, weighted by the mass of the species', () => {
    // Species 0 weighs 1, species 1 weighs 10.
    const masses = [1, 10];

    /** 80 light particles around (200, 200), 30 heavy ones around (600, 400), 40 light ones spread over the bottom. */
    function scene(): { points: [number, number, number][]; mask: Uint8Array } {
        const light: [number, number, number][] = Array.from({ length: 80 }, (_, i) => [200 + Math.cos(i) * 10, 200 + Math.sin(i) * 10, 0]);
        const heavy: [number, number, number][] = Array.from({ length: 30 }, (_, i) => [600 + Math.cos(i) * 10, 400 + Math.sin(i) * 10, 1]);
        const spread: [number, number, number][] = Array.from({ length: 40 }, (_, i) => [20 + i * 19, 560, 0]);
        const points = [...light, ...heavy, ...spread];
        return { points, mask: new Uint8Array(points.length) };
    }

    it('picks the disk holding the most mass, not the most particles', () => {
        const { points, mask } = scene();

        const byCount = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask);
        expect(byCount.centerX).toBeCloseTo(200, 0);
        expect(byCount.members).toBe(80);

        const byMass = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask, masses);
        expect(byMass.centerX).toBeCloseTo(600, 0);
        expect(byMass.centerY).toBeCloseTo(400, 0);
        expect(byMass.members).toBe(30);
        expect([...mask.subarray(80, 110)].every(v => v === 255)).toBe(true);
        expect([...mask.subarray(0, 80)].every(v => v === 0)).toBe(true);
    });

    it('gives the share of the total mass: 300 of 300 + 80 + 40 units', () => {
        const { points, mask } = scene();

        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask, masses);

        expect(r.fraction).toBeCloseTo(300 / 420, 12);
    });

    it('is the share of the particles when every species weighs the same', () => {
        const { points, mask } = scene();

        const byCount = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask);
        const equal = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask, [3, 3]);

        expect(equal.fraction).toBeCloseTo(byCount.fraction, 12);
        expect(byCount.fraction).toBeCloseTo(80 / 150, 12);
    });

    it('centers the disk on the center of mass: the heavy side pulls it', () => {
        // A light and a heavy particle 20 px apart: the center of mass is 18.2 px from the light one.
        const points: [number, number, number][] = [[300, 300, 0], [320, 300, 1]];
        const mask = new Uint8Array(2);

        const r = analyzeConcentration(texels(points), 2, 40, 800, 600, mask, masses);

        expect(r.centerX).toBeCloseTo((300 + 10 * 320) / 11, 9);
        expect(r.fraction).toBe(1);
    });

    it('lets the heavy species make a small crowd enough: a mass threshold is reached with a fraction of the particles', () => {
        const { points, mask } = scene();
        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, mask, masses);

        expect(r.members / points.length).toBeLessThan(0.25);
        expect(r.fraction).toBeGreaterThan(0.7);
    });

    it('does not count what has no mass, and treats an unknown species as massless', () => {
        const points: [number, number, number][] = [[100, 100, 0], [100, 100, 5], [700, 500, 0]];
        const mask = new Uint8Array(3);

        const r = analyzeConcentration(texels(points), 3, 40, 800, 600, mask, masses);

        expect(r.fraction).toBeCloseTo(0.5, 12);          // 1 of the 2 units of mass there is
    });
});

describe('analyzeConcentration, size of the cluster', () => {
    it('is the rms distance of the members to their center: 20 px for a ring of radius 20', () => {
        const ring: [number, number][] = Array.from({ length: 60 }, (_, i) => [300 + 20 * Math.cos(i * Math.PI / 30), 200 + 20 * Math.sin(i * Math.PI / 30)]);
        const r = analyzeConcentration(texels(ring), ring.length, 40, 800, 600, new Uint8Array(ring.length));

        expect(r.spread).toBeCloseTo(20, 4);
    });

    it('weighs the members by their mass: a heavy particle at the center pulls the rms distance down', () => {
        // One heavy particle (10) at the center and four light ones (1) at 20 px: sum m r^2 / sum m = 4 * 400 / 14.
        const points: [number, number, number][] = [[300, 300, 1], [320, 300, 0], [280, 300, 0], [300, 320, 0], [300, 280, 0]];
        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, new Uint8Array(points.length), [1, 10]);

        expect(r.centerX).toBeCloseTo(300, 9);
        expect(r.spread).toBeCloseTo(Math.sqrt(1600 / 14), 9);
    });

    it('is zero for a single particle and for an empty cloud', () => {
        expect(analyzeConcentration(texels([[100, 100]]), 1, 40, 800, 600, new Uint8Array(1)).spread).toBe(0);
        expect(analyzeConcentration(new Float32Array(0), 0, 40, 800, 600, new Uint8Array(0)).spread).toBe(0);
    });
});
