import { describe, expect, it } from 'vitest';
import { PROTOSTAR_NOISE_N_MIN, PROTOSTAR_NOISE_N_SHAPE } from '../src/config';
import {
    effectiveParticles, log1p, logGammaRatio, logNoiseBias, noiseBias, smoothingWeight,
} from '../src/simulation/protostar/noiseBias';

/**
 * E[(G / n)^alpha] for G of Gamma law of shape n (mean n), by numerical integration of the density t^(n - 1) e^-t over a wide
 * window around its mode in log space (Simpson's rule): no Gamma function is used, so it is independent of Stirling's series.
 * The integrals of t^(n + alpha - 1) e^-t and t^(n - 1) e^-t are taken separately and divided.
 */
function expectationByIntegration(n: number, alpha: number): number {
    const logIntegral = (shape: number): number => {
        const mode = Math.max(shape - 1, 1e-3);
        const width = Math.sqrt(shape) * 14 + 40;
        const [low, high] = [Math.max(1e-12, mode - width), mode + width];
        const steps = 200000;
        const h = (high - low) / steps;
        const f = (t: number): number => (shape - 1) * Math.log(t) - t;
        const peak = Math.max(f(Math.max(mode, low)), f(low), f(high));
        let sum = 0;
        for (let i = 0; i <= steps; i++) {
            const weight = i === 0 || i === steps ? 1 : i % 2 === 1 ? 4 : 2;
            sum += weight * Math.exp(f(low + i * h) - peak);
        }
        return peak + Math.log(sum * h / 3);
    };
    // E[(G / n)^alpha] = integral t^(n + alpha - 1) e^-t / integral t^(n - 1) e^-t / n^alpha
    return Math.exp(logIntegral(n + alpha) - logIntegral(n) - alpha * Math.log(n));
}

/** For a whole alpha, Gamma(n + alpha) / Gamma(n) = n (n + 1) ... (n + alpha - 1): an exact product, in logarithms. */
const logRatioByProduct = (n: number, alpha: number): number => {
    let sum = 0;
    for (let k = 0; k < alpha; k++) sum += Math.log(1 + k / n);
    return sum;
};

describe('log1p', () => {
    it('agrees with Math.log1p over the whole range, to a relative 1e-8 (the series stops at 3e-9 at its limit, far below a float32), and does not lose its digits for small x', () => {
        for (const x of [0, 1e-12, 1e-9, 1e-6, 1e-3, 0.01, 0.1, 0.2499, 0.25, 0.3, 1, 10, 1e6]) {
            expect(log1p(x)).toBeCloseTo(Math.log1p(x), 8);
            if (x > 0) expect(Math.abs(log1p(x) / Math.log1p(x) - 1)).toBeLessThan(1e-8);
        }
    });
});

describe('the bias of a rate that goes as T^alpha when T is estimated from N particles', () => {
    it('is Gamma(N + alpha) / (Gamma(N) N^alpha): 6.6 for N = 400 and alpha = 40, as the plan says', () => {
        expect(Math.exp(logGammaRatio(400, 40))).toBeCloseTo(6.613, 2);
        expect(Math.exp(logGammaRatio(400, 40))).toBeCloseTo(Math.exp(logRatioByProduct(400, 40)), 6);
    });

    it('matches the exact product for a whole alpha, from N = 2 to 1e7 (the logarithm within 1e-5 plus 1e-6 relative; 2e-3 at N = 1, where Stirling is least exact)', () => {
        for (const alpha of [1, 2, 4, 10, 16, 40, 45]) {
            for (const n of [1, 2, 5, 10, 33, 100, 400, 1600, 6400, 1e5, 1e7]) {
                const exact = logRatioByProduct(n, alpha);
                const tolerance = n < 2 ? 2e-3 : 1e-5 + 1e-6 * Math.abs(exact);
                expect(Math.abs(logGammaRatio(n, alpha) - exact)).toBeLessThan(tolerance);
            }
        }
    });

    it('matches the expectation over the Gamma law computed by numerical integration, also for a fractional alpha', () => {
        for (const [n, alpha] of [[5, 2.8], [30, 16.5], [100, 4], [100, 40], [400, 40], [400, 2.8], [1600, 40], [6400, 45]] as const) {
            const integral = Math.log(expectationByIntegration(n, alpha));
            expect(Math.abs(logGammaRatio(n, alpha) - integral)).toBeLessThan(1e-5 + 1e-6 * Math.abs(integral));
        }
    });

    it('falls to the large-N expansion alpha (alpha - 1) / 2N and grows with alpha and with 1 / N', () => {
        expect(logGammaRatio(1e6, 40)).toBeCloseTo(40 * 39 / 2e6, 6);
        expect(logGammaRatio(400, 40)).toBeGreaterThan(logGammaRatio(800, 40));
        expect(logGammaRatio(400, 40)).toBeGreaterThan(logGammaRatio(400, 16));
    });

    it('takes the degree of freedom of the mean into account: the estimate has shape N - 1 and mean T (N - 1) / N', () => {
        for (const [particles, alpha] of [[401, 40], [101, 4], [11, 16], [2001, 45]] as const) {
            const n = particles - 1;
            // E[(G / (n + 1))^alpha] = Gamma(n + alpha) / (Gamma(n) (n + 1)^alpha) = prod (n + k) / (n + 1)^alpha, exactly, for a whole alpha
            const exact = logRatioByProduct(n, alpha) - alpha * Math.log(1 + 1 / n);
            expect(Math.abs(logNoiseBias(particles, alpha) - exact)).toBeLessThan(1e-6);
        }
        // against the integral of the Gamma law of shape N - 1 scaled to the mean (N - 1) / N
        for (const [particles, alpha] of [[401, 40], [101, 4]] as const) {
            const n = particles - 1;
            const expected = Math.log(expectationByIntegration(n, alpha)) - alpha * Math.log(1 + 1 / n);
            expect(Math.abs(logNoiseBias(particles, alpha) - expected)).toBeLessThan(1e-5);
        }
    });

    it('is below 1 for a gentle exponent (the dispersion about the sample mean is low by 1 / N) and above 1 for a steep one', () => {
        expect(noiseBias(100, 1)).toBeCloseTo(1 - 1 / 100, 3);
        expect(noiseBias(400, 40)).toBeGreaterThan(5);
        expect(noiseBias(400, 2.8)).toBeLessThan(1);
    });

    it('has no bias without noise or without a dependence on T, and is huge, not infinite or NaN, for a neighborhood without particles', () => {
        expect(logNoiseBias(Infinity, 40)).toBe(0);
        expect(logNoiseBias(400, 0)).toBe(0);
        expect(logNoiseBias(400, -3)).toBe(0);
        for (const particles of [0, 0.3, 1, 2, PROTOSTAR_NOISE_N_MIN + 1]) {
            const value = logNoiseBias(particles, 40);
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThan(50);
            expect(logNoiseBias(particles, 40)).toBe(logNoiseBias(2, 40));      // bounded below
        }
    });
});

/** The same formula as the shader runs it, with every operation rounded to a 32-bit float. */
function logNoiseBias32(particles: number, alpha: number): number {
    const f = Math.fround;
    const log1pSeries = (x: number): number => {
        if (x >= 0.25) return f(Math.log(f(1 + x)));
        const y = f(x / f(2 + x));
        const y2 = f(y * y);
        return f(2 * f(y * f(1 + f(y2 * f(1 / 3 + f(y2 * f(1 / 5 + f(y2 * f(1 / 7)))))))));
    };
    const stirling = (z: number): number => {
        const z2 = f(z * z);
        return f(f(1 / 12 - f(f(1 / 360 - f(1 / f(1260 * z2))) / z2)) / z);
    };
    const gammaRatio = (n: number): number => {
        const z = f(n + alpha);
        return f(f(f(f(z - 0.5) * log1pSeries(f(alpha / n))) - alpha) + f(stirling(z) - stirling(n)));
    };
    const n = Math.max(f(particles - 1), PROTOSTAR_NOISE_N_MIN);
    return f(gammaRatio(n) - f(alpha * log1pSeries(f(1 / n))));
}

describe('the formula the shader evaluates in 32-bit floats', () => {
    it('stays within 1e-4 of the double-precision logarithm of the bias (absolute) from N = 2 to 1e7 and alpha from 1 to 45', () => {
        let worst = 0;
        for (const alpha of [1, 2.8, 4, 16, 40, 45]) {
            for (const particles of [2, 3, 10, 50, 150, 600, 2400, 9600, 1e5, 1e6, 1e7]) {
                worst = Math.max(worst, Math.abs(logNoiseBias32(particles, alpha) - logNoiseBias(particles, alpha)));
            }
        }
        expect(worst).toBeLessThan(1e-4);
    });
});

describe('effective number of particles', () => {
    it('is the shape factor times the number of particles when they all have the same mass', () => {
        expect(effectiveParticles(100, 100)).toBeCloseTo(PROTOSTAR_NOISE_N_SHAPE * 100, 9);
        expect(effectiveParticles(250 * 4, 250 * 16)).toBeCloseTo(PROTOSTAR_NOISE_N_SHAPE * 250, 9);
    });

    it('is lower when a few heavy particles carry the mass: (sum m)^2 / sum m^2', () => {
        // 100 particles of mass 1 and 25 of mass 4: sum m = 200, sum m^2 = 100 + 400 = 500
        expect(effectiveParticles(200, 500)).toBeCloseTo(PROTOSTAR_NOISE_N_SHAPE * 80, 9);
        expect(effectiveParticles(200, 500)).toBeLessThan(PROTOSTAR_NOISE_N_SHAPE * 125);
    });

    it('is zero without mass', () => {
        expect(effectiveParticles(0, 0)).toBe(0);
    });
});

describe('weight of the average of the temperature', () => {
    it('is 1 - exp(-dt / tau), and 1 without averaging', () => {
        expect(smoothingWeight(0.1, 0.1)).toBeCloseTo(1 - Math.exp(-1), 12);
        expect(smoothingWeight(0.01, 0.2)).toBeCloseTo(1 - Math.exp(-0.05), 12);
        expect(smoothingWeight(1 / 60, 0)).toBe(1);
        expect(smoothingWeight(0, 0.1)).toBe(0);
    });

    it('is per second, not per step: two half steps average as much as one step', () => {
        for (const [dt, tau] of [[1 / 60, 0.1], [0.03, 0.05], [0.2, 1]] as const) {
            const half = smoothingWeight(dt / 2, tau);
            expect(1 - (1 - half) ** 2).toBeCloseTo(smoothingWeight(dt, tau), 12);
        }
    });

    it('relaxes a step in the temperature with the time constant, whatever the step', () => {
        const tau = 0.1;
        for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
            let average = 0;
            for (let t = 0; t < 1 - 1e-9; t += dt) average += smoothingWeight(dt, tau) * (1 - average);
            expect(average).toBeCloseTo(1 - Math.exp(-1 / tau), 9);
        }
    });
});
