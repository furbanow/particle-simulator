import { describe, expect, it } from 'vitest';
import {
    PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_GLOW_T_RANGE, PROTOSTAR_HE_IGNITION_KELVIN, PROTOSTAR_PP_LAW, PROTOSTAR_T0_KELVIN,
    PROTOSTAR_TRIPLE_ALPHA_LAW,
} from '../src/config';
import { defaultParams } from '../src/simulation/params';
import { PROTOSTAR, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES } from '../src/simulation/protostar/declaration';
import { fusionLawOf, ignitionRatio, ignitionTemperature } from '../src/simulation/protostar/ignition';
import { expm1Minus, logNoiseBias, logNoiseBiasCurved, logUnbiasedResonant } from '../src/simulation/protostar/noiseBias';
import {
    barrierTerm, fusionRate, lawAt, localExponent, reactionArrays, type FusionLaw,
} from '../src/simulation/protostar/reactions';

const PP = PROTOSTAR_REACTIONS[0];
const TRIPLE = PROTOSTAR_REACTIONS[1];
const T0 = PROTOSTAR_T0_KELVIN;
const params = { ...defaultParams(PROTOSTAR), fusionRate: 4e-3, heFusionRate: 1e-4 };
const hydrogen = fusionLawOf(PP, params);
const helium = fusionLawOf(TRIPLE, params);
/** The temperature of a law at `kelvin`, in T0. */
const at = (kelvin: number): number => kelvin / T0;

describe('Gamow rates: the laws of the reactions', () => {
    it('are the professor\'s: pp goes as T6^(-2/3) exp(-33.8 T6^(-1/3)), triple alpha as T8^(-3) exp(-44 / T8)', () => {
        expect(PROTOSTAR_PP_LAW).toEqual({ power: 2 / 3, barrier: 33.8, barrierPower: 1 / 3, unitKelvin: 1e6 });
        expect(PROTOSTAR_TRIPLE_ALPHA_LAW).toEqual({ power: 3, barrier: 44, barrierPower: 1, unitKelvin: 1e8 });
        const pp = (t6: number): number => t6 ** (-2 / 3) * Math.exp(-33.8 * t6 ** (-1 / 3));
        const triple = (t8: number): number => t8 ** -3 * Math.exp(-44 / t8);
        // The law of the table, normalised at the reference temperature, against the literal formulas normalised the same way.
        for (const t6 of [4, 8, 15, 22, 40, 100]) {
            const ratio = Math.exp(lawAt(hydrogen, at(t6 * 1e6)).logLaw);
            expect(Math.abs(ratio / (pp(t6) / pp(15)) - 1)).toBeLessThan(1e-12);
        }
        for (const t8 of [0.4, 0.7, 1, 1.5, 2, 3]) {
            const ratio = Math.exp(lawAt(helium, at(t8 * 1e8)).logLaw);
            expect(Math.abs(ratio / (triple(t8) / triple(1)) - 1)).toBeLessThan(1e-12);
        }
    });

    it('have the local exponents the real reactions have: 3.9 at 15 MK for pp, 41 at 100 MK and 19 at 200 MK for the triple alpha', () => {
        expect(localExponent(PP.law, 15e6)).toBeCloseTo(33.8 / 3 * 15 ** (-1 / 3) - 2 / 3, 12);
        expect(localExponent(PP.law, 15e6)).toBeCloseTo(3.9, 1);
        expect(localExponent(TRIPLE.law, 100e6)).toBeCloseTo(41, 10);
        expect(localExponent(TRIPLE.law, 200e6)).toBeCloseTo(19, 10);
        // and falls with the temperature: the hotter, the less the barrier matters
        expect(localExponent(PP.law, 30e6)).toBeLessThan(localExponent(PP.law, 15e6));
        expect(localExponent(PP.law, 8e6)).toBeGreaterThan(localExponent(PP.law, 15e6));
    });

    it('the exponent of a law at a temperature is the logarithmic slope of its rate (finite difference)', () => {
        for (const [law, kelvins] of [[hydrogen, [6e6, 10e6, 15e6, 30e6, 60e6]], [helium, [50e6, 80e6, 100e6, 200e6, 400e6]]] as const) {
            for (const kelvin of kelvins) {
                const t = at(kelvin);
                const h = 1e-5;
                const slope = (lawAt(law, t * (1 + h)).logLaw - lawAt(law, t * (1 - h)).logLaw) / (Math.log(1 + h) - Math.log(1 - h));
                expect(lawAt(law, t).exponent).toBeCloseTo(slope, 5);
            }
        }
    });

    it('are normalised at the reference temperature: the rate is lambda (rho X)^n there', () => {
        expect(lawAt(hydrogen, 1).logLaw).toBeCloseTo(0, 14);
        expect(lawAt(helium, helium.reference).logLaw).toBeCloseTo(0, 14);
        expect(fusionRate(hydrogen, 1, 1)).toBeCloseTo(hydrogen.rate, 12);
        expect(fusionRate(hydrogen, 10, 1)).toBeCloseTo(10 * hydrogen.rate, 10);
        expect(fusionRate(helium, 1, helium.reference)).toBeCloseTo(helium.rate, 14);
        expect(fusionRate(helium, 10, helium.reference)).toBeCloseTo(100 * helium.rate, 10);
        // the barrier term at the reference is b (T_ref / unit)^-q
        expect(barrierTerm(PP.law, 15e6)).toBeCloseTo(33.8 / Math.cbrt(15), 12);
        expect(barrierTerm(TRIPLE.law, 100e6)).toBeCloseTo(44, 12);
    });

    it('the rate is proportional to the mass fraction of the fuel (pp) or to its square (triple alpha), and nil without fuel', () => {
        expect(fusionRate(hydrogen, 30, 1, Infinity, 0.5) / fusionRate(hydrogen, 30, 1)).toBeCloseTo(0.5, 12);
        expect(fusionRate(helium, 30, helium.reference, Infinity, 0.5) / fusionRate(helium, 30, helium.reference)).toBeCloseTo(0.25, 12);
        expect(fusionRate(hydrogen, 30, 1, Infinity, 0)).toBe(0);
        expect(fusionRate(helium, 30, helium.reference, Infinity, 0)).toBe(0);
    });

    it('is capped, finite and nil far below its barrier', () => {
        expect(fusionRate(helium, 1e4, 1e6)).toBe(PROTOSTAR_FUSION_RATE_MAX);
        expect(fusionRate(hydrogen, 0, 1e30)).toBe(0);
        expect(fusionRate(hydrogen, 100, 0)).toBe(0);
        expect(fusionRate({ ...hydrogen, rate: 0 }, 100, 1e30)).toBe(0);
        // 0.01 of the reference temperature: exp(-44 * 99) underflows to 0, not to NaN
        expect(fusionRate(helium, 100, helium.reference * 0.01)).toBe(0);
        expect(fusionRate(hydrogen, 100, 1e-6)).toBe(0);
    });

    it('a flat law (the lab) is lambda (rho X)^n at any temperature', () => {
        const flat: FusionLaw = { ...hydrogen, power: 0, barrier: 0 };
        for (const t of [0.01, 1, 100]) expect(fusionRate(flat, 20, t, 400)).toBeCloseTo(hydrogen.rate * 20, 12);
    });
});

describe('Gamow rates: the ignition temperature', () => {
    it('is a logarithmic function of lambda only: a decade of lambda divides it by 10^(1 / alpha), alpha the local exponent (1.8 for pp at 15 MK, 1.06 for the triple alpha at 100 MK)', () => {
        for (const [reaction, name] of [[PP, 'pp'], [TRIPLE, 'triple alpha']] as const) {
            const lambdas = [1e-5, 1e-4, 1e-3, 1e-2];
            const temperatures = lambdas.map(lambda => ignitionTemperature(fusionLawOf(reaction, { fusionRate: lambda, heFusionRate: lambda }), 30, 0.1));
            for (let i = 0; i + 1 < lambdas.length; i++) {
                const shift = temperatures[i] / temperatures[i + 1];
                // The exponent in the middle of the decade (geometric mean of the two temperatures): the shift is 10^(1 / alpha) to the curvature of the law.
                const alpha = localExponent(reaction.law, Math.sqrt(temperatures[i] * temperatures[i + 1]) * T0);
                expect(shift, `${name} ${lambdas[i]}`).toBeGreaterThan(1);
                expect(Math.log(shift) / Math.log(10 ** (1 / alpha)), `${name} ${lambdas[i]}`).toBeCloseTo(1, 1);
            }
        }
        // at the temperatures of the reactions: 80 % per decade for pp, 6 % for the triple alpha
        expect(10 ** (1 / localExponent(PP.law, 15e6))).toBeCloseTo(1.8, 1);
        expect(10 ** (1 / localExponent(TRIPLE.law, 100e6))).toBeCloseTo(1.06, 2);
    });

    it('is the inverse of the rate (the twin of the shader), with the fuel and the density in it', () => {
        for (const law of [hydrogen, helium]) {
            for (const density of [1, 10, 100, 1e3]) {
                for (const fuel of [1, 0.4]) {
                    for (const rate of [1e-3, 0.1, 1, 50]) {
                        const t = ignitionTemperature(law, density, rate, fuel);
                        if (!Number.isFinite(t)) continue;       // a rate above the (very hot) maximum of the law
                        expect(fusionRate(law, density, t, Infinity, fuel)).toBeCloseTo(rate, 6 - Math.ceil(Math.log10(Math.max(rate, 1))));
                    }
                }
            }
        }
    });

    it('puts hydrogen at 15 MK and helium at 100 MK, the real ratio of 6.7, where the two laws have the same rate there: it is a matter of lambda', () => {
        // lambda_He chosen so that a pure helium gas at 100 MK and the density rho burns as fast as a hydrogen one at 15 MK.
        const rho = 50;
        const [h, he] = [fusionLawOf(PP, { fusionRate: 1e-3 }), fusionLawOf(TRIPLE, { heFusionRate: 1e-3 / rho })];
        expect(fusionRate(h, rho, 1)).toBeCloseTo(fusionRate(he, rho, he.reference), 12);
        expect(ignitionTemperature(h, rho, 1e-3 * rho) * T0 / 1e6).toBeCloseTo(15, 8);
        expect(ignitionTemperature(he, rho, 1e-3 * rho) * T0 / 1e6).toBeCloseTo(100, 8);
        expect(ignitionTemperature(he, rho, 1e-3 * rho) / ignitionTemperature(h, rho, 1e-3 * rho)).toBeCloseTo(100 / 15, 8);
    });

    it('is infinite when no finite temperature gives the rate', () => {
        expect(ignitionTemperature(hydrogen, 0, 0.1)).toBe(Infinity);
        expect(ignitionTemperature(hydrogen, 100, 0)).toBe(Infinity);
        expect(ignitionTemperature(hydrogen, 100, PROTOSTAR_FUSION_RATE_MAX)).toBe(Infinity);
        expect(ignitionTemperature({ ...hydrogen, rate: 0 }, 100, 0.1)).toBe(Infinity);
        expect(ignitionTemperature(hydrogen, 100, 0.1, 0)).toBe(Infinity);
        expect(ignitionTemperature({ ...hydrogen, power: 0, barrier: 0 }, 100, 0.1)).toBe(Infinity);   // a flat law
    });
});

/**
 * The exact expectation over the Gamma law of the estimate, by Simpson's rule on the density of ln G: E[f(T G / (n + 1))] / f(T)
 * for G ~ Gamma(n) (shape n = N - 1, as the model of the noise of T says), for a rate law f given by its logarithm.
 */
function exactBias(logRatio: (u: number) => number, n: number): number {
    const logDensity = (w: number): number => n * w - Math.exp(w);        // density of w = ln G, up to a constant
    const [low, high] = [Math.log(n) - 14 / Math.sqrt(n) - 0.5, Math.log(n) + 14 / Math.sqrt(n) + 1.5];
    const steps = 40000;
    const h = (high - low) / steps;
    const integrand = (w: number, withLaw: boolean): number => Math.exp(logDensity(w) - logDensity(Math.log(n)) + (withLaw ? logRatio(w - Math.log(n + 1)) : 0));
    let [numerator, denominator] = [0, 0];
    for (let i = 0; i <= steps; i++) {
        const weight = i === 0 || i === steps ? 1 : i % 2 === 1 ? 4 : 2;
        numerator += weight * integrand(low + i * h, true);
        denominator += weight * integrand(low + i * h, false);
    }
    return numerator / denominator;
}

describe('Gamow rates: the noise correction at the local exponent and the curvature of the law', () => {
    /** ln f(T e^u) - ln f(T), the law of `reaction` at `kelvin`. */
    const phi = (law: FusionLaw, kelvin: number) => (u: number): number => {
        const t = at(kelvin);
        return lawAt(law, t * Math.exp(u)).logLaw - lawAt(law, t).logLaw;
    };

    it('is accurate to 1 % of the mean rate against the exact expectation, for the proton-proton chain and the triple alpha, from N = 100 particles', () => {
        for (const [law, kelvin] of [[hydrogen, 15e6], [hydrogen, 8e6], [helium, 100e6], [helium, 120e6], [helium, 80e6]] as const) {
            const point = lawAt(law, at(kelvin));
            for (const particles of [100, 200, 400, 1600, 6400]) {
                const exact = exactBias(phi(law, kelvin), particles - 1);
                const corrected = Math.exp(logNoiseBiasCurved(particles, point.exponent, point.barrier, law.barrierPower));
                expect(Math.abs(corrected / exact - 1), `${law === hydrogen ? 'H' : 'He'} ${kelvin / 1e6} MK N=${particles}`).toBeLessThan(0.01);
            }
        }
    });

    it('is what the power law of the local exponent is not: that one is off by 20 % at N = 400 for the triple alpha at 100 MK', () => {
        const point = lawAt(helium, 1e8 / T0);
        const exact = exactBias(phi(helium, 100e6), 399);
        const plain = Math.exp(logNoiseBias(400, point.exponent));
        expect(plain / exact).toBeGreaterThan(1.15);
        expect(Math.exp(logNoiseBiasCurved(400, point.exponent, point.barrier, helium.barrierPower)) / exact).toBeCloseTo(1, 2);
    });

    it('tends to the power law of the local exponent when the barrier is small against it or N is large', () => {
        expect(logNoiseBiasCurved(400, 4, 0, 1)).toBe(logNoiseBias(400, 4));
        const point = lawAt(helium, 1e8 / T0);
        expect(logNoiseBiasCurved(1e9, point.exponent, point.barrier, 1)).toBeCloseTo(logNoiseBias(1e9, point.exponent), 6);
        expect(logNoiseBiasCurved(Infinity, point.exponent, point.barrier, 1)).toBe(0);
        expect(logNoiseBiasCurved(400, -1, 3, 1)).toBe(0);
    });

    it('stays finite everywhere the law is used: very cold gas, a few particles, no particles, a huge exponent', () => {
        for (const kelvin of [1e5, 1e6, 15e6, 100e6, 1e9, 1e10]) {
            for (const law of [hydrogen, helium]) {
                const point = lawAt(law, at(kelvin));
                for (const particles of [0, 1, 2, 3, 10, 100, 1e5, 1e7]) {
                    const bias = logNoiseBiasCurved(particles, point.exponent, point.barrier, law.barrierPower);
                    expect(Number.isFinite(bias), `${kelvin} K, ${particles}`).toBe(true);
                }
                expect(Number.isNaN(fusionRate(law, 100, at(kelvin), 3))).toBe(false);
            }
        }
    });

    it('is applied to the rate of a non-resonant law: the corrected rate is the rate divided by the bias of the curved law', () => {
        for (const particles of [200, 800, 3200]) {
            const noisy = fusionRate(hydrogen, 30, hydrogen.reference, particles);
            const point = lawAt(hydrogen, hydrogen.reference);
            expect(noisy).toBeCloseTo(fusionRate(hydrogen, 30, hydrogen.reference) / Math.exp(logNoiseBiasCurved(particles, point.exponent, point.barrier, hydrogen.barrierPower)), 12);
        }
    });
});

describe('Gamow rates: the exact unbiased estimate of the resonant law (triple alpha)', () => {
    // A rate constant small enough for the cap never to bind over the noise of T.
    const law = fusionLawOf(TRIPLE, { heFusionRate: 1e-12 });

    it('has the true rate for mean: over the Gamma law of the estimate, at every N from 20 and every temperature, to 0.1 %', () => {
        for (const kelvin of [70e6, 100e6, 130e6]) {
            const truth = Math.log(fusionRate(law, 1, at(kelvin)));
            for (const particles of [20, 50, 100, 200, 400, 1600, 6400]) {
                const mean = exactBias(u => Math.log(fusionRate(law, 1, at(kelvin) * Math.exp(u), particles)) - truth, particles - 1);
                expect(Math.abs(mean - 1), `${kelvin / 1e6} MK N=${particles}`).toBeLessThan(1e-3);
            }
        }
    });

    it('is what dividing the rate by the bias of the curved law is not: that one, evaluated at the estimate, is 16 % high at N = 600', () => {
        // The old way: rate(T_est) / bias(T_est), the bias taken at the local exponent of the estimate.
        const kelvin = 100e6;
        const truth = Math.log(fusionRate(law, 1, at(kelvin)));
        const plugIn = (u: number): number => {
            const temperature = at(kelvin) * Math.exp(u);
            const point = lawAt(law, temperature);
            return Math.log(fusionRate(law, 1, temperature)) - logNoiseBiasCurved(600, point.exponent, point.barrier, 1) - truth;
        };
        expect(exactBias(plugIn, 599)).toBeGreaterThan(1.1);
    });

    it('is exactly the law when the temperature is known exactly (infinitely many particles), and tends to it as N grows', () => {
        const point = lawAt(law, 0.8 * law.reference);
        expect(fusionRate(law, 1, 0.8 * law.reference, Infinity)).toBeCloseTo(Math.exp(Math.log(law.rate) + point.logLaw), 20);
        const large = fusionRate(law, 1, 0.8 * law.reference, 1e7);
        expect(large / fusionRate(law, 1, 0.8 * law.reference)).toBeCloseTo(1, 3);
    });

    it('is nil in a cell too cold for the barrier (S <= G), finite and positive above, and falls back to the curved bias for a few particles', () => {
        expect(logUnbiasedResonant(600, 0.05, 3, 44)).toBe(-Infinity);           // S = 30 < 44
        expect(Number.isFinite(logUnbiasedResonant(600, 0.5, 3, 44)!)).toBe(true);
        expect(logUnbiasedResonant(5, 1, 3, 44)).toBeNull();                      // n = 4 <= p + margin
        expect(logUnbiasedResonant(0, 1, 3, 44)).toBeNull();
        expect(Number.isFinite(fusionRate(law, 1, law.reference, 5))).toBe(true);
        expect(fusionRate(law, 1, law.reference, 0)).toBeGreaterThanOrEqual(0);
    });
});

describe('expm1Minus', () => {
    it('is exp(x) - 1 - x, without losing its digits for small x', () => {
        for (const x of [-3, -0.5, -0.2499, -0.1, -1e-3, -1e-6, 0, 1e-9, 1e-6, 1e-3, 0.1, 0.2499, 0.25, 0.5, 2]) {
            const exact = Math.expm1(x) - x;
            expect(Math.abs(expm1Minus(x) - exact)).toBeLessThanOrEqual(1e-6 * Math.abs(exact) + 1e-18);
        }
    });
});

describe('Gamow rates: the reaction table\'s arrays', () => {
    const arrays = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES, params, 'mass', 2000, 1, 10);

    it('hold the law of each fusing type, and nothing for the others', () => {
        expect([arrays.power[0], arrays.power[1]]).toEqual([2 / 3, 3]);
        expect(arrays.barrier[0]).toBeCloseTo(33.8 / Math.cbrt(15), 12);
        expect(arrays.barrier[1]).toBeCloseTo(44, 12);
        expect([arrays.barrierPower[0], arrays.barrierPower[1]]).toEqual([1 / 3, 1]);
        expect(arrays.barrier.slice(2).every(b => b === 0)).toBe(true);
        expect(arrays.rate.slice(2).every(r => r === 0)).toBe(true);
    });

    it('give the fuel channel of the types that fuse: hydrogen in X (0), helium in Y (1), the rest in neither', () => {
        expect(arrays.fuel).toEqual([0, 1, -1, -1, -1, -1, -1, -1, -1, -1]);
    });

    it('a custom element (a fourth type) is the fuel of nothing and has no rate', () => {
        const custom = { name: 'Lithium', symbol: 'Li', color: '#fff', values: { weight: 1, mass: 6.94, size: 2 } };
        const withCustom = reactionArrays(PROTOSTAR_REACTIONS, [...PROTOSTAR_TYPES, custom], params, 'mass', 2000, 1, 10);
        expect(withCustom.fuel).toEqual(arrays.fuel);
        expect(withCustom.to[3]).toBe(-1);
        expect(withCustom.rate[3]).toBe(0);
    });

    it('a flat law has no power and no barrier', () => {
        const flat = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES, params, 'mass', 2000, 1, 10, true);
        expect(flat.power.every(p => p === 0)).toBe(true);
        expect(flat.barrier.every(b => b === 0)).toBe(true);
        expect(flat.rate).toEqual(arrays.rate);
    });
});

describe('Gamow rates: the calibration of the defaults (docs/spikes/a2-gamow-rates.md)', () => {
    const defaults = defaultParams(PROTOSTAR);
    const [h, he] = [fusionLawOf(PP, defaults), fusionLawOf(TRIPLE, defaults)];
    const ratioAt = (density: number, rate: number): number => ignitionRatio(PROTOSTAR_REACTIONS, defaults, density, rate, 0, 1);

    it('are the values the default cloud was calibrated with', () => {
        expect(defaults).toMatchObject({ gravity: 9, radiation: 10, kappa: 20, minTemperature: 0.05, fusionRate: 2e-3, heFusionRate: 2.5e-4, feedback: 0.3 });
    });

    it('ignite a pure helium gas of 20 rho0 at 0.1 fusions per second per particle at 100 MK, its real ignition, and hydrogen at 19 MK', () => {
        // lambda_He rho^2 = 2.5e-4 * 400 = 0.1 at the reference temperature of the law; lambda_0 rho = 2e-3 * 20 = 0.04 there. lambda_0 was 4e-3
        // (hydrogen at 15.9 MK, a ratio of 6.3) until the thin-disc cooling (P4), which halved it to keep the first collapse's burn where it was.
        expect(ignitionTemperature(he, 20, 0.1) * T0 / 1e6).toBeCloseTo(100, 8);
        expect(ignitionTemperature(h, 20, 0.1) * T0 / 1e6).toBeGreaterThan(18.5);
        expect(ignitionTemperature(h, 20, 0.1) * T0 / 1e6).toBeLessThan(20);
        expect(ratioAt(20, 0.1)).toBeGreaterThan(5);
        expect(ratioAt(20, 0.1)).toBeLessThan(100 / 15);
    });

    it('keep the ratio of the ignition temperatures within 10 % of the real 6.7 at the density and rate of the star\'s core, and between 3 and 12 wherever a star goes', () => {
        // The ratio depends on the point: the two laws differ in steepness and in density exponent (1 and 2). With lambda_0 = 2e-3 it runs from
        // 3.3 (20 rho0, 0.5 per second) to 9.4 (100 rho0, 0.03 per second); it was 4.1 to 10.9 with 4e-3.
        expect(ratioAt(40, 0.1)).toBeGreaterThan(6.0);
        expect(ratioAt(40, 0.1)).toBeLessThan(8.5);
        for (const density of [20, 40, 100]) {
            for (const rate of [0.03, 0.1, 0.5]) {
                expect(ratioAt(density, rate)).toBeGreaterThan(3);
                expect(ratioAt(density, rate)).toBeLessThan(12);
            }
        }
    });

    it('have a glow range that reaches the carbon ash: above the helium ignition, which nothing burns after', () => {
        expect(PROTOSTAR_GLOW_T_RANGE[0]).toBe(1);
        expect(PROTOSTAR_GLOW_T_RANGE[1] * T0).toBeGreaterThanOrEqual(1.4 * PROTOSTAR_HE_IGNITION_KELVIN);
    });
});
