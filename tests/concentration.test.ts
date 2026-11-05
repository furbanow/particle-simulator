import { describe, expect, it } from 'vitest';
import { ejectaImmunity, findConcentrations, type ConcentrationSearch } from '../src/simulation/concentration';

type Point = [number, number];

/** Packs (x, y) pairs into the RGBA layout read back from the position texture. */
function texels(points: Point[]): Float32Array {
    const data = new Float32Array(points.length * 4);
    points.forEach(([x, y], i) => { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 3] = 1; });
    return data;
}

const cluster = (count: number, x: number, y: number, spread = 10): Point[] =>
    Array.from({ length: count }, (_, i) => [x + Math.cos(i) * spread, y + Math.sin(i) * spread]);

function search(points: Point[], overrides: Partial<ConcentrationSearch> = {}) {
    const mask = new Uint8Array(points.length);
    const result = findConcentrations(texels(points), points.length, {
        radius: 40, width: 800, height: 600, threshold: 0.5, maxZones: 16,
        immuneUntil: new Float32Array(points.length), now: 0,
        ...overrides,
    }, mask);
    return { ...result, mask };
}

describe('findConcentrations', () => {
    it('finds the cluster, its centroid and flags its members', () => {
        const scattered: Point[] = Array.from({ length: 20 }, (_, i) => [30 + i * 35, 550]);
        const { zones, maxFraction, mask } = search([...cluster(80, 300, 200), ...scattered]);

        expect(maxFraction).toBeCloseTo(0.8);
        expect(zones).toHaveLength(1);
        expect(zones[0].members).toBe(80);
        expect(zones[0].fraction).toBeCloseTo(0.8);
        expect(zones[0].centerX).toBeCloseTo(300, 0);
        expect(zones[0].centerY).toBeCloseTo(200, 0);
        expect([...mask.subarray(0, 80)].every(v => v === 1)).toBe(true);
        expect([...mask.subarray(80)].every(v => v === 0)).toBe(true);
    });

    it('explodes every cluster above the threshold, densest first, each with its own mask index', () => {
        const points = [...cluster(30, 100, 100), ...cluster(50, 400, 300), ...cluster(20, 700, 500)];

        const { zones, mask } = search(points, { threshold: 0.2 });

        expect(zones.map(z => z.members)).toEqual([50, 30, 20]);
        expect(zones[0].centerX).toBeCloseTo(400, 0);
        expect(zones[1].centerX).toBeCloseTo(100, 0);
        expect(zones[2].centerX).toBeCloseTo(700, -1);
        expect(mask[0]).toBe(2);
        expect(mask[30]).toBe(1);
        expect(mask[80]).toBe(3);
    });

    it('stops at the first disk below the threshold', () => {
        const { zones, maxFraction, mask } = search([...cluster(70, 100, 100), ...cluster(30, 600, 400)], { threshold: 0.5 });

        expect(zones.map(z => z.members)).toEqual([70]);
        expect(maxFraction).toBeCloseTo(0.7);
        expect(mask[70]).toBe(0);
    });

    it('reports the densest fraction without any zone when nothing reaches the threshold', () => {
        const { zones, maxFraction, mask } = search([...cluster(60, 100, 100), ...cluster(40, 600, 400)], { threshold: 0.8 });

        expect(zones).toEqual([]);
        expect(maxFraction).toBeCloseTo(0.6);
        expect(mask.every(v => v === 0)).toBe(true);
    });

    it('lets disks overlap but never gives a particle to two of them', () => {
        const points = [...cluster(50, 300, 200, 2), ...cluster(50, 340, 200, 2)];

        const { zones, mask } = search(points, { radius: 25, threshold: 0.3 });

        expect(zones.map(z => z.members)).toEqual([50, 50]);
        expect(Math.abs(zones[0].centerX - zones[1].centerX)).toBeLessThan(2 * 25);
        expect(new Set(mask.subarray(0, 50)).size).toBe(1);
        expect(new Set(mask.subarray(50)).size).toBe(1);
        expect(mask[0]).not.toBe(mask[50]);
    });

    it('caps the number of zones', () => {
        const points = [...cluster(30, 100, 100), ...cluster(30, 400, 300), ...cluster(30, 700, 500)];

        const { zones, mask } = search(points, { threshold: 0.1, maxZones: 2 });

        expect(zones).toHaveLength(2);
        expect(Math.max(...mask)).toBe(2);
    });

    it('finds no zone at a cap of 0 but still measures the densest disk', () => {
        const { zones, maxFraction, mask } = search(cluster(80, 300, 200), { maxZones: 0 });

        expect(zones).toEqual([]);
        expect(maxFraction).toBeCloseTo(1);
        expect(mask.every(v => v === 0)).toBe(true);
    });

    it('does not count the particles still immune, and counts them again once it has passed', () => {
        const points = [...cluster(60, 100, 100), ...cluster(40, 600, 400)];
        const immuneUntil = new Float32Array(points.length);
        immuneUntil.fill(5, 0, 60);

        const during = search(points, { threshold: 0.3, immuneUntil, now: 1 });
        expect(during.maxFraction).toBeCloseTo(0.4);
        expect(during.zones.map(z => z.members)).toEqual([40]);
        expect(during.zones[0].centerX).toBeCloseTo(600, 0);
        expect([...during.mask.subarray(0, 60)].every(v => v === 0)).toBe(true);

        const after = search(points, { threshold: 0.3, immuneUntil, now: 5 });
        expect(after.zones.map(z => z.members)).toEqual([60, 40]);
    });

    it('still measures the fraction against all the particles when some are immune', () => {
        const points = cluster(100, 300, 200);
        const immuneUntil = new Float32Array(points.length);
        immuneUntil.fill(5, 0, 50);

        const { maxFraction } = search(points, { immuneUntil, now: 0 });

        expect(maxFraction).toBeCloseTo(0.5);
    });

    it('reports a low fraction for a uniform spread', () => {
        const points: Point[] = [];
        for (let x = 5; x < 800; x += 20) for (let y = 5; y < 600; y += 20) points.push([x, y]);

        const { zones, maxFraction } = search(points);

        expect(maxFraction).toBeLessThan(0.05);
        expect(zones).toEqual([]);
    });

    it('returns an empty result without particles', () => {
        const { zones, maxFraction } = search([]);

        expect(zones).toEqual([]);
        expect(maxFraction).toBe(0);
    });
});

describe('ejectaImmunity', () => {
    it('lasts the crossing time of the disk at the ejection speed', () => {
        expect(ejectaImmunity(400, 200, 0.6)).toBe(2);
    });

    it('lasts at least the time during which the ejecta ignore gravity', () => {
        expect(ejectaImmunity(10, 200, 0.6)).toBe(0.6);
    });

    it('falls back on that time without any ejection speed', () => {
        expect(ejectaImmunity(100, 0, 0.6)).toBe(0.6);
    });
});
