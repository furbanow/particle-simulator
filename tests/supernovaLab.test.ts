import { describe, expect, it } from 'vitest';
import { FRONT_POWERS, fitFront, fitHomology } from '../src/lab/blastFit';
import { mulberry32 } from '../src/lab/random';
import { frontRadiusAt } from '../src/simulation/shockWave';

const times = Array.from({ length: 60 }, (_, i) => 0.1 + 0.13 * i);

describe('fitFront', () => {
    it('finds the law R^2 = R0^2 + 2 K t: exponent 1/2, slope 2 K, and prefers it to a constant speed', () => {
        const series = times.map((t): [number, number] => [t, frontRadiusAt(65, 294, t)]);
        const fit = fitFront(series, FRONT_POWERS);
        expect(fit.bestPower).toBeCloseTo(2, 9);
        expect(fit.squared.slope).toBeCloseTo(2 * 65 * 294, 6);
        expect(fit.squared.intercept).toBeCloseTo(65 * 65, 6);
        expect(fit.rmsSedov).toBeLessThan(1e-9);
        expect(fit.rmsLinear).toBeGreaterThan(10);
    });

    it('finds a front at constant speed (the old law) too: power 1', () => {
        const series = times.map((t): [number, number] => [t, 65 + 294 * t]);
        const fit = fitFront(series, FRONT_POWERS);
        expect(fit.bestPower).toBeCloseTo(1, 9);
        expect(fit.rmsLinear).toBeLessThan(1e-9);
        expect(fit.rmsSedov).toBeGreaterThan(5);
    });

    it('keeps its exponent when the radii are noisy by a couple of pixels', () => {
        const random = mulberry32(5);
        const series = times.map((t): [number, number] => [t, frontRadiusAt(65, 294, t) + 2 * (random() - 0.5)]);
        const fit = fitFront(series, FRONT_POWERS);
        expect(fit.bestPower).toBeGreaterThan(1.8);
        expect(fit.bestPower).toBeLessThan(2.2);
        expect(fit.rmsSedov).toBeLessThan(1.5);
    });
});

describe('fitHomology', () => {
    it('is a line through the origin for v = H r, with the rate as slope', () => {
        const r = Array.from({ length: 100 }, (_, i) => 0.6 * i);
        const fit = fitHomology(r, r.map(d => 4.5 * d));
        expect(fit.slope).toBeCloseTo(4.5, 12);
        expect(fit.intercept).toBeCloseTo(0, 9);
        expect(fit.r2).toBeCloseTo(1, 12);
    });

    it('does not take a constant speed for a homologous flow', () => {
        const r = Array.from({ length: 100 }, (_, i) => 0.6 * i);
        const fit = fitHomology(r, r.map(() => 300));
        expect(fit.slope).toBeCloseTo(0, 9);
        expect(fit.intercept).toBeCloseTo(300, 9);
    });
});
