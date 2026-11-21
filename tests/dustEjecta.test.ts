import { describe, expect, it } from 'vitest';
import { EJECT_SCALE_RANGE, EJECTA_RADIUS_FLOOR, MAX_SPEED, SHOCK_STRENGTH } from '../src/config';
import { fitLine } from '../src/lab/haffFit';
import { mulberry32 } from '../src/lab/random';
import { frontConstant, frontRadiusAt, frontSpeed } from '../src/simulation/shockWave';
import { ejectaRadius, ejectionSpeed, ejectScale, shockKick } from '../src/simulation/stickyDust/ejecta';

const ZONE = 65;
const TOP = 294;
const RADIUS = 40;

describe('ejectionSpeed', () => {
    it('is proportional to the distance to the centre (homologous): the ejection speed at the radius of the cluster', () => {
        const distances = Array.from({ length: 50 }, (_, i) => 1.3 * (i + 1));
        const fit = fitLine(distances.map((r): [number, number] => [r, ejectionSpeed(r, RADIUS, TOP, 1)]));
        expect(fit.r2).toBeCloseTo(1, 12);
        expect(fit.intercept).toBeCloseTo(0, 9);
        expect(fit.slope).toBeCloseTo(TOP / RADIUS, 9);
        expect(ejectionSpeed(0, RADIUS, TOP, 1)).toBe(0);
        expect(ejectionSpeed(RADIUS, RADIUS, TOP, 1)).toBeCloseTo(TOP, 12);
    });

    it('does not exceed the maximum speed, as the velocity pass bounds it', () => {
        expect(ejectionSpeed(ZONE, 5, TOP, 2)).toBe(MAX_SPEED);
        expect(ejectionSpeed(ZONE, 5, TOP, 2, 10000)).toBeCloseTo(TOP * 2 * ZONE / 5, 9);
        expect(ejectionSpeed(1, RADIUS, TOP, 1)).toBeLessThan(MAX_SPEED);
    });

    it('is zero without a radius', () => {
        expect(ejectionSpeed(10, 0, TOP, 1)).toBe(0);
        expect(ejectionSpeed(10, NaN, TOP, 1)).toBe(0);
    });

    it('gives the ejecta an rms speed equal to the ejection speed whatever the size of the cluster (down to the floor of the radius)', () => {
        const random = mulberry32(11);
        for (const size of [60, 20, 5]) {
            // A uniform disc of the given radius: its rms distance is size / sqrt(2).
            const distances = Array.from({ length: 20000 }, () => size * Math.sqrt(random()));
            const spread = Math.sqrt(distances.reduce((sum, r) => sum + r * r, 0) / distances.length);
            const radius = ejectaRadius(spread, ZONE);
            const rms = Math.sqrt(distances.reduce((sum, r) => sum + ejectionSpeed(r, radius, TOP, 1) ** 2, 0) / distances.length);
            const floored = spread < EJECTA_RADIUS_FLOOR * ZONE;
            expect(rms).toBeCloseTo(floored ? TOP * spread / (EJECTA_RADIUS_FLOOR * ZONE) : TOP, 6);
        }
    });

    it('scales by the species factor, so the slope of v against r is each species\' own', () => {
        const mean = 4;
        const slopes = [1, 4, 7, 16].map(m => ejectionSpeed(ZONE / 2, ZONE, TOP, ejectScale(m, mean)) / (ZONE / 2));
        for (let i = 1; i < slopes.length; i++) expect(slopes[i]).toBeLessThan(slopes[i - 1]);
        expect(slopes[1] / slopes[0]).toBeCloseTo(0.5, 12);          // m x 4: speed / 2
    });
});

describe('ejectaRadius', () => {
    it('is the rms distance of the cluster, bounded below by a fraction of the detection zone', () => {
        expect(ejectaRadius(30, ZONE)).toBe(30);
        expect(ejectaRadius(0, ZONE)).toBeCloseTo(EJECTA_RADIUS_FLOOR * ZONE, 12);
        expect(ejectaRadius(1, ZONE)).toBeCloseTo(EJECTA_RADIUS_FLOOR * ZONE, 12);
        expect(ejectaRadius(ZONE, ZONE)).toBe(ZONE);
    });
});

describe('ejectScale', () => {
    it('decreases with the mass of the species: heavy elements are slower', () => {
        const masses = [0.5, 1.008, 4.0026, 6.94, 12.011, 20.18];
        const scales = masses.map(m => ejectScale(m, 4));
        for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThan(scales[i - 1]);
    });

    it('gives every species the same kinetic energy at the same distance, inside its bounds', () => {
        const mean = 4;
        const energy = (m: number): number => m * ejectScale(m, mean) ** 2;
        expect(energy(1.008)).toBeCloseTo(energy(4.0026), 12);
        expect(energy(6.94)).toBeCloseTo(energy(12.011), 12);
        expect(ejectScale(1e-6, mean)).toBe(EJECT_SCALE_RANGE[1]);
        expect(ejectScale(1e6, mean)).toBe(EJECT_SCALE_RANGE[0]);
    });
});

describe('shockKick', () => {
    it('follows the front\'s own speed: strength x K / R x the species factor', () => {
        const k = frontConstant(TOP, ZONE);
        for (const t of [0, 0.5, 4, 20]) {
            const r = frontRadiusAt(ZONE, TOP, t);
            expect(shockKick(r, ZONE, TOP, SHOCK_STRENGTH, 1)).toBeCloseTo(SHOCK_STRENGTH * frontSpeed(r, k), 9);
            expect(shockKick(r, ZONE, TOP, SHOCK_STRENGTH, 2)).toBeCloseTo(2 * SHOCK_STRENGTH * frontSpeed(r, k), 9);
        }
    });

    it('falls as 1 / r', () => {
        expect(shockKick(4 * ZONE, ZONE, TOP, 1, 1)).toBeCloseTo(shockKick(ZONE, ZONE, TOP, 1, 1) / 4, 12);
    });
});
