import { describe, expect, it } from 'vitest';
import { agrees, CLOUD_KINDS, compareConcentration, syntheticCloud } from '../src/lab/concentrationParity';
import { mulberry32 } from '../src/lab/random';
import { analyzeConcentration, type Concentration } from '../src/simulation/concentration';

const answer = (over: Partial<Concentration> = {}): Concentration => ({ fraction: 0.4, members: 100, centerX: 300, centerY: 200, spread: 20, ...over });

describe('compareConcentration', () => {
    it('is zero for the same answer', () => {
        expect(compareConcentration(answer(), answer())).toEqual({ centerPx: 0, sharePoints: 0, spreadPx: 0, membersRelative: 0 });
    });

    it('measures the gap of the centers in px, the shares in points, the rms radii in px and the members relative to the reference (GPU minus CPU)', () => {
        const a = compareConcentration(answer({ centerX: 303, centerY: 196, fraction: 0.39, spread: 21, members: 90 }), answer());

        expect(a.centerPx).toBeCloseTo(5, 12);
        expect(a.sharePoints).toBeCloseTo(-1, 12);
        expect(a.spreadPx).toBeCloseTo(1, 12);
        expect(a.membersRelative).toBeCloseTo(-0.1, 12);
    });

    it('does not divide by zero members', () => {
        expect(compareConcentration(answer({ members: 0 }), answer({ members: 0 })).membersRelative).toBe(0);
        expect(compareConcentration(answer({ members: 3 }), answer({ members: 0 })).membersRelative).toBe(Infinity);
    });
});

describe('agrees', () => {
    it('accepts a center within the cell and a share within the points, on either side', () => {
        const near = compareConcentration(answer({ centerX: 310, fraction: 0.41 }), answer());

        expect(agrees(near, 16.25, 2)).toBe(true);
        expect(agrees(compareConcentration(answer({ fraction: 0.37 }), answer()), 16.25, 2)).toBe(false);
        expect(agrees(compareConcentration(answer({ centerY: 230 }), answer()), 16.25, 2)).toBe(false);
    });
});

describe('syntheticCloud', () => {
    const count = 20000;
    const species = Uint8Array.from({ length: count }, (_, i) => i % 3);

    it.each(CLOUD_KINDS)('%s: one texel per particle, on the area, with the species it was given', kind => {
        const cloud = syntheticCloud(kind, count, species, mulberry32(1), 1024, 768);

        expect(cloud.length).toBe(count * 4);
        for (let i = 0; i < count; i++) {
            expect(cloud[i * 4]).toBeGreaterThanOrEqual(0);
            expect(cloud[i * 4]).toBeLessThanOrEqual(1024);
            expect(cloud[i * 4 + 1]).toBeGreaterThanOrEqual(0);
            expect(cloud[i * 4 + 1]).toBeLessThanOrEqual(768);
            expect(cloud[i * 4 + 2]).toBe(species[i]);
            expect(cloud[i * 4 + 3]).toBe(1);
        }
    });

    it('is the same for the same seed', () => {
        const a = syntheticCloud('blob', count, species, mulberry32(5), 1024, 768);
        const b = syntheticCloud('blob', count, species, mulberry32(5), 1024, 768);

        expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('puts the clumps where the kinds say, which the analysis then finds', () => {
        const masses = [1, 4, 7];
        const find = (kind: (typeof CLOUD_KINDS)[number]): Concentration =>
            analyzeConcentration(syntheticCloud(kind, count, species, mulberry32(2), 1024, 768), count, 65, 1024, 768, masses);

        expect(Math.hypot(find('blob').centerX - 300, find('blob').centerY - 250)).toBeLessThan(10);
        expect(find('compact').fraction).toBeGreaterThan(0.85);
        expect(find('corner').centerX).toBeLessThan(40);
        expect(find('far-edge').centerX).toBeGreaterThan(1024 - 40);
        expect(find('uniform').fraction).toBeLessThan(0.05);
    });

    it('makes the twin clumps of the same mass, to within one particle', () => {
        const masses = [1, 4, 7];
        const cloud = syntheticCloud('twin-blobs', count, species, mulberry32(3), 1024, 768);
        const twins = Math.floor(count * 0.3);
        let a = 0, b = 0;
        for (let i = 0; i < 2 * twins; i++) {
            if (i % 2 === 0) a += masses[cloud[i * 4 + 2]]; else b += masses[cloud[i * 4 + 2]];
        }

        expect(Math.abs(a - b)).toBeLessThanOrEqual(7);
        expect(cloud[1 * 4] - cloud[0 * 4]).toBeGreaterThan(300);                       // the copy is elsewhere
    });
});
