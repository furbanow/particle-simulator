import { describe, expect, it } from 'vitest';
import { CONCENTRATION_CELLS_PER_RADIUS, CONCENTRATION_MIN_CELL } from '../src/config';
import {
    analyzeConcentration, CONCENTRATION_RESULT_FLOATS, concentrationGrid, unpackConcentration,
} from '../src/simulation/concentration';

/** Packs (x, y, species) triples into the RGBA layout read back from the position texture (species 0 when omitted). */
function texels(points: ([number, number] | [number, number, number])[]): Float32Array {
    const data = new Float32Array(points.length * 4);
    points.forEach(([x, y, species], i) => { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = species ?? 0; data[i * 4 + 3] = 1; });
    return data;
}

describe('analyzeConcentration', () => {
    it('finds the cluster, its centroid and counts its members', () => {
        const cluster: [number, number][] = Array.from({ length: 80 }, (_, i) =>
            [300 + Math.cos(i) * 10, 200 + Math.sin(i) * 10]);
        const scattered: [number, number][] = Array.from({ length: 20 }, (_, i) => [30 + i * 35, 550]);
        const points = [...cluster, ...scattered];

        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600);

        expect(r.members).toBe(80);
        expect(r.fraction).toBeCloseTo(0.8);
        expect(r.centerX).toBeCloseTo(300, 0);
        expect(r.centerY).toBeCloseTo(200, 0);
    });

    it('reports a low fraction for a uniform spread', () => {
        const points: [number, number][] = [];
        for (let x = 5; x < 800; x += 20) for (let y = 5; y < 600; y += 20) points.push([x, y]);

        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600);

        expect(r.fraction).toBeLessThan(0.05);
    });

    it('returns an empty result without particles', () => {
        const r = analyzeConcentration(new Float32Array(0), 0, 40, 800, 600);

        expect(r.members).toBe(0);
        expect(r.fraction).toBe(0);
    });
});

describe('analyzeConcentration, weighted by the mass of the species', () => {
    // Species 0 weighs 1, species 1 weighs 10.
    const masses = [1, 10];

    /** 80 light particles around (200, 200), 30 heavy ones around (600, 400), 40 light ones spread over the bottom. */
    function scene(): { points: [number, number, number][] } {
        const light: [number, number, number][] = Array.from({ length: 80 }, (_, i) => [200 + Math.cos(i) * 10, 200 + Math.sin(i) * 10, 0]);
        const heavy: [number, number, number][] = Array.from({ length: 30 }, (_, i) => [600 + Math.cos(i) * 10, 400 + Math.sin(i) * 10, 1]);
        const spread: [number, number, number][] = Array.from({ length: 40 }, (_, i) => [20 + i * 19, 560, 0]);
        const points = [...light, ...heavy, ...spread];
        return { points };
    }

    it('picks the disk holding the most mass, not the most particles', () => {
        const { points } = scene();

        const byCount = analyzeConcentration(texels(points), points.length, 40, 800, 600);
        expect(byCount.centerX).toBeCloseTo(200, 0);
        expect(byCount.members).toBe(80);

        const byMass = analyzeConcentration(texels(points), points.length, 40, 800, 600, masses);
        expect(byMass.centerX).toBeCloseTo(600, 0);
        expect(byMass.centerY).toBeCloseTo(400, 0);
        expect(byMass.members).toBe(30);
    });

    it('gives the share of the total mass: 300 of 300 + 80 + 40 units', () => {
        const { points } = scene();

        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, masses);

        expect(r.fraction).toBeCloseTo(300 / 420, 12);
    });

    it('is the share of the particles when every species weighs the same', () => {
        const { points } = scene();

        const byCount = analyzeConcentration(texels(points), points.length, 40, 800, 600);
        const equal = analyzeConcentration(texels(points), points.length, 40, 800, 600, [3, 3]);

        expect(equal.fraction).toBeCloseTo(byCount.fraction, 12);
        expect(byCount.fraction).toBeCloseTo(80 / 150, 12);
    });

    it('centers the disk on the center of mass: the heavy side pulls it', () => {
        // A light and a heavy particle 20 px apart: the center of mass is 18.2 px from the light one.
        const points: [number, number, number][] = [[300, 300, 0], [320, 300, 1]];

        const r = analyzeConcentration(texels(points), 2, 40, 800, 600, masses);

        expect(r.centerX).toBeCloseTo((300 + 10 * 320) / 11, 9);
        expect(r.fraction).toBe(1);
    });

    it('lets the heavy species make a small crowd enough: a mass threshold is reached with a fraction of the particles', () => {
        const { points } = scene();
        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, masses);

        expect(r.members / points.length).toBeLessThan(0.25);
        expect(r.fraction).toBeGreaterThan(0.7);
    });

    it('does not count what has no mass, and treats an unknown species as massless', () => {
        const points: [number, number, number][] = [[100, 100, 0], [100, 100, 5], [700, 500, 0]];

        const r = analyzeConcentration(texels(points), 3, 40, 800, 600, masses);

        expect(r.fraction).toBeCloseTo(0.5, 12);          // 1 of the 2 units of mass there is
    });
});

describe('analyzeConcentration, size of the cluster', () => {
    it('is the rms distance of the members to their center: 20 px for a ring of radius 20', () => {
        const ring: [number, number][] = Array.from({ length: 60 }, (_, i) => [300 + 20 * Math.cos(i * Math.PI / 30), 200 + 20 * Math.sin(i * Math.PI / 30)]);
        const r = analyzeConcentration(texels(ring), ring.length, 40, 800, 600);

        expect(r.spread).toBeCloseTo(20, 4);
    });

    it('weighs the members by their mass: a heavy particle at the center pulls the rms distance down', () => {
        // One heavy particle (10) at the center and four light ones (1) at 20 px: sum m r^2 / sum m = 4 * 400 / 14.
        const points: [number, number, number][] = [[300, 300, 1], [320, 300, 0], [280, 300, 0], [300, 320, 0], [300, 280, 0]];
        const r = analyzeConcentration(texels(points), points.length, 40, 800, 600, [1, 10]);

        expect(r.centerX).toBeCloseTo(300, 9);
        expect(r.spread).toBeCloseTo(Math.sqrt(1600 / 14), 9);
    });

    it('is zero for a single particle and for an empty cloud', () => {
        expect(analyzeConcentration(texels([[100, 100]]), 1, 40, 800, 600).spread).toBe(0);
        expect(analyzeConcentration(new Float32Array(0), 0, 40, 800, 600).spread).toBe(0);
    });
});

describe('concentrationGrid', () => {
    it('has cells of a quarter of the radius, over the screen', () => {
        const grid = concentrationGrid(65, 1024, 768);

        expect(grid.cellSize).toBe(65 / CONCENTRATION_CELLS_PER_RADIUS);
        expect(grid.columns).toBe(Math.ceil(1024 / 16.25));
        expect(grid.rows).toBe(Math.ceil(768 / 16.25));
    });

    it('takes the cells whose centers are inside the radius: dx^2 + dy^2 <= 16 for a quarter of the radius', () => {
        for (const radius of [10, 65, 100, 123, 400]) expect(concentrationGrid(radius, 800, 600).reachSquared).toBe(CONCENTRATION_CELLS_PER_RADIUS ** 2);
    });

    it('never has a cell smaller than the minimum, and then a smaller reach', () => {
        const grid = concentrationGrid(6, 800, 600);

        expect(grid.cellSize).toBe(CONCENTRATION_MIN_CELL);
        expect(grid.reachSquared).toBe(9);                        // the radius is 3 cells of 2 px
    });
});

describe('unpackConcentration', () => {
    // The two texels the GPU leaves: (center x, center y, mass inside, total mass), (m |d|^2, particles, mass of the densest cells, 0).
    it('gives the figures of the CPU analysis: share, members, center, rms radius', () => {
        const texels = new Float32Array([310, 205, 30, 120, 30 * 400, 12, 28, 0]);

        const r = unpackConcentration(texels);

        expect(texels.length).toBe(CONCENTRATION_RESULT_FLOATS);
        expect(r).toMatchObject({ fraction: 0.25, members: 12, centerX: 310, centerY: 205, totalMass: 120, memberMass: 30, coarseMass: 28 });
        expect(r.spread).toBeCloseTo(20, 12);
    });

    it('takes the total mass the caller knows over the sum the GPU made of its cells', () => {
        // The cells hold float32 sums of up to millions of units, which round: the species' masses times their counts are exact.
        const texels = new Float32Array([310, 205, 30, 119.5, 30 * 400, 12, 28, 0]);

        expect(unpackConcentration(texels, 120).fraction).toBe(0.25);
        expect(unpackConcentration(texels).fraction).toBeCloseTo(30 / 119.5, 12);
        expect(unpackConcentration(texels, 0).fraction).toBeCloseTo(30 / 119.5, 12);          // no known total: the GPU's
    });

    it('reports nothing for an empty cloud', () => {
        const r = unpackConcentration(new Float32Array(CONCENTRATION_RESULT_FLOATS));

        expect(r.fraction).toBe(0);
        expect(r.members).toBe(0);
        expect(r.spread).toBe(0);
    });

    it('does not let the rounding of the sums put the share above one or the spread under zero', () => {
        const r = unpackConcentration(new Float32Array([1, 1, 1000.0001, 1000, -1e-9, 5, 1000, 0]));

        expect(r.fraction).toBe(1);
        expect(r.spread).toBe(0);
    });
});

describe('analyzeConcentration, the grid and the exact disk', () => {
    it('agrees with a brute-force search of the disk centers on a random cloud, to within a cell', () => {
        // The coarse search is an approximation of the densest disk, the refinement then makes it exact for the members it finds:
        // the disk it returns holds at least as much mass as the disk centered on its own center of mass says (same radius).
        let seed = 7;
        const random = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
        const points: [number, number, number][] = Array.from({ length: 4000 }, () => [random() * 800, random() * 600, random() < 0.5 ? 0 : 1]);
        for (let i = 0; i < 1500; i++) points.push([420 + (random() - 0.5) * 60, 310 + (random() - 0.5) * 60, 1]);
        const masses = [1, 4];

        const r = analyzeConcentration(texels(points), points.length, 50, 800, 600, masses);
        let inside = 0, total = 0;
        for (const [x, y, k] of points) {
            total += masses[k];
            if ((x - r.centerX) ** 2 + (y - r.centerY) ** 2 <= 2500) inside += masses[k];
        }

        expect(inside / total).toBeCloseTo(r.fraction, 12);
        expect(Math.hypot(r.centerX - 420, r.centerY - 310)).toBeLessThan(50 / CONCENTRATION_CELLS_PER_RADIUS * 2);
    });
});
