// The noise of the temperature (proposal A3) and its two remedies, as pure functions. They are the
// TypeScript twins of protostar-gas.frag (effective number of particles, smoothing weight) and
// of logNoiseBias() in protostar-common.glsl: the tests check them against the exact expectation
// over the Gamma law, and the lab checks the shaders against the physics.
//
// The temperature of a neighborhood is the mean of |v - u|^2 over its particles. For independent
// Maxwellian particles in two dimensions each |v - u|^2 is exponentially distributed, so the
// estimate over N particles follows a Gamma law of shape N: mean T, relative noise 1 / sqrt(N).
// A rate that goes as T^alpha is convex in T, so its mean over that noise exceeds the rate at the
// true temperature by the factor
//
//     bias(N, alpha) = E[(T_est / T)^alpha] = Gamma(N + alpha) / (Gamma(N) N^alpha)
//                    = exp(alpha (alpha - 1) / 2N - alpha (alpha - 1) (2 alpha - 1) / 12N^2 + ...).
//
// For alpha = 40 and N = 400 that is 6.6.
//
// The temperature is the dispersion around the mean velocity of the same particles, which costs
// one degree of freedom: the estimate is a Gamma law of shape N - 1 and mean T (N - 1) / N. That
// is a factor (1 - 1/N)^alpha on the rate (-10 % for N = 400 and alpha = 40, -33 % for N = 100),
// which logNoiseBias() includes. N itself is an effective number of particles: that of the
// weights of the particles in the neighborhood (see effectiveParticles()).

import { PROTOSTAR_NOISE_EXACT_MARGIN, PROTOSTAR_NOISE_N_MIN, PROTOSTAR_NOISE_N_SHAPE, PROTOSTAR_NOISE_SHIFT_MAX } from '../../config';

/** Below this |x| (x = alpha / N, for instance), ln(1 + x) is summed as a series (a 32-bit log(1 + x) loses all its digits as x shrinks). */
const LOG1P_SERIES_LIMIT = 0.25;

/**
 * ln(1 + x) for x > -1 without the cancellation of log(1 + x): 2 atanh(x / (2 + x)), an odd series
 * in y = x / (2 + x), at most 1/7 for the |x| of the series branch. Same terms as the shader.
 */
export function log1p(x: number): number {
    if (Math.abs(x) >= LOG1P_SERIES_LIMIT) return Math.log(1 + x);
    const y = x / (2 + x);
    const y2 = y * y;
    return 2 * y * (1 + y2 * (1 / 3 + y2 * (1 / 5 + y2 * (1 / 7))));
}

/** The Stirling correction of ln Gamma(z): 1 / 12z - 1 / 360z^3 + 1 / 1260z^5. */
function stirling(z: number): number {
    const z2 = z * z;
    return (1 / 12 - (1 / 360 - 1 / (1260 * z2)) / z2) / z;
}

/**
 * ln [Gamma(n + alpha) / (Gamma(n) n^alpha)], the bias of a rate that goes as T^alpha when T is the
 * mean of `n` independent exponential numbers (a Gamma law of shape n and mean 1). With Stirling's
 * series for the two Gamma functions the terms in ln n cancel and what is left is
 *
 *     (n + alpha - 1/2) ln(1 + alpha / n) - alpha + S(n + alpha) - S(n),
 *
 * where S is the Stirling correction (three terms: the error is below 1e-3 at n = 1 and falls as
 * 1/n^7). Computed in logarithms: the bias itself overflows a float for small n and large alpha.
 * `n` must be at least 1 (PROTOSTAR_NOISE_N_MIN).
 */
export function logGammaRatio(n: number, alpha: number): number {
    return (n + alpha - 0.5) * log1p(alpha / n) - alpha + stirling(n + alpha) - stirling(n);
}

/**
 * ln of the bias that the noise of the temperature puts on a rate that goes as T^alpha, when T is
 * the dispersion around the mean estimated from `particles` (effective) particles: a Gamma law of
 * shape n = particles - 1 and mean T n / (n + 1), hence logGammaRatio(n, alpha) - alpha ln(1 + 1/n).
 * `n` is bounded below by PROTOSTAR_NOISE_N_MIN: a neighborhood of two particles or fewer carries no
 * information about T and gets the (huge) bias of two. A rate that does not grow with T has no
 * bias, nor has a temperature known exactly (infinitely many particles).
 */
export function logNoiseBias(particles: number, alpha: number): number {
    if (!(alpha > 0) || particles === Infinity) return 0;
    const n = Math.max(particles - 1, PROTOSTAR_NOISE_N_MIN);
    return logGammaRatio(n, alpha) - alpha * log1p(1 / n);
}

/** e^x - 1 - x, summed as a series for small |x| (a 32-bit exp(x) - 1 - x loses all its digits there). Same terms as the shader. */
export function expm1Minus(x: number): number {
    if (Math.abs(x) >= LOG1P_SERIES_LIMIT) return Math.exp(x) - 1 - x;
    return x * x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6))));
}

/**
 * The same bias for a rate whose temperature dependence is not a power law but Gamow's, ln r = const - p ln T - b T^-q (A2).
 * Its local exponent alpha = d ln r / d ln T = q g - p (g = b T^-q, the barrier term at this temperature) varies with T, and
 * the noise of the estimate is large enough, at the exponents of the real reactions (41 for the triple alpha), to feel it:
 * a power law of the local exponent over-corrects the rate by 20 % at N = 400 and by 50 % at N = 200 particles. Let
 * u = ln (T_estimated / T) and phi(u) = ln [r(T e^u) / r(T)] = -p u - g (e^(-q u) - 1); the mean of exp(phi) over the Gamma law
 * of the estimate is computed by Laplace's method around the saddle point of the power law (u0, where it is
 * ln (T_est / T) = ln[(n + alpha) / (n + 1)]), with one Newton step toward the saddle point of the whole integrand:
 *
 *     ln bias = logNoiseBias(N, alpha) + [n (D - e^D + 1) - alpha (e^D - 1) - p D - g (e^(-q u1) - 1 + q u0)
 *               - (1/2) ln (e^D + g q^2 e^(-q u1) / (n + alpha))],     D = g q (e^(-q u0) - 1) / (n + alpha + g q^2 e^(-q u0)),
 *
 * u1 = u0 + D, accurate to 0.2 % of the bias (the one step) for N >= 100 against the exact integral (tests/gamowRates.test.ts),
 * and equal to the power law's bias when g = 0. The terms are the difference of two Laplace approximations written out so
 * that nothing large cancels (n is up to 10^5). `barrier` is g, `barrierPower` q; p follows from alpha = q g - p.
 */
export function logNoiseBiasCurved(particles: number, alpha: number, barrier: number, barrierPower: number): number {
    const plain = logNoiseBias(particles, alpha);
    if (!(alpha > 0) || particles === Infinity || !(barrier > 0)) return plain;
    const n = Math.max(particles - 1, PROTOSTAR_NOISE_N_MIN);
    const q = barrierPower;
    const power = q * barrier - alpha;
    const peak = n + alpha;
    const u0 = log1p((alpha - 1) / (n + 1));
    const e0 = Math.exp(-q * u0);
    const shift = Math.min(Math.max(barrier * q * (e0 - 1) / (peak + barrier * q * q * e0), -PROTOSTAR_NOISE_SHIFT_MAX), PROTOSTAR_NOISE_SHIFT_MAX);
    const e1 = e0 * Math.exp(-q * shift);
    const grown = Math.exp(shift);
    return plain - n * expm1Minus(shift) - alpha * (grown - 1) - power * shift - barrier * (e1 - 1 + q * u0)
        - 0.5 * Math.log(grown + barrier * q * q * e1 / peak);
}

/**
 * ln of the unbiased estimate of f(T) / f(T_ref), f(T) = T^-p exp(-b / T), a resonant law (q = 1, the triple alpha), from the
 * temperature estimate of `particles` (effective) particles. Dividing a rate by its bias evaluates the bias at the estimate and
 * not at the true temperature, and with the exponent of 41 of the triple alpha that leaves 16 % at N = 600 and a factor of 3.5 at
 * N = 150 (the lab measures it): the rate is not corrected by a factor, it is replaced by its exact unbiased estimate. With
 * S = N tau (tau = T_est / T_ref, S a Gamma variable of shape n = N - 1 and scale T / T_ref, whatever T is) and theta = T_ref / T,
 * the estimate of theta^p exp(-G theta), G = b / T_ref the barrier term at the reference, whose expectation over S is exactly
 * that (Laplace transform: it is the uniformly minimum variance unbiased one) is
 *
 *     Gamma(n) / Gamma(n - p) (S - G)^(n - p - 1) / S^(n - 1)      for S > G, nil below,
 *
 * and ln f(T) / f(T_ref) = G + ln of that. Written with Stirling's series for the ratio of the Gamma functions and with log1p, so that
 * nothing large cancels (n is up to 10^5):
 *
 *     G + p ln(n / S) - (n - p - 1/2) ln(1 - p / n) - p + St(n) - St(n - p) + (n - p - 1) ln(1 - G / S).
 *
 * Returns null where it does not apply: n must exceed p by more than PROTOSTAR_NOISE_EXACT_MARGIN (a neighborhood of a few
 * particles carries no information on T anyway); -Infinity when S <= G (a cell too cold to have any rate). Twin: logUnbiasedResonant()
 * in protostar-common.glsl.
 */
export function logUnbiasedResonant(particles: number, tau: number, power: number, barrier: number): number | null {
    const n = particles - 1;
    if (!(n > power + PROTOSTAR_NOISE_EXACT_MARGIN) || !(tau > 0)) return null;
    const sum = particles * tau;
    if (!(sum > barrier)) return -Infinity;
    return barrier + power * Math.log(n / sum) - (n - power - 0.5) * log1p(-power / n) - power + stirling(n) - stirling(n - power)
        + (n - power - 1) * log1p(-barrier / sum);
}

/** The bias itself. */
export const noiseBias = (particles: number, alpha: number): number => Math.exp(logNoiseBias(particles, alpha));

/**
 * Effective number of independent particles behind the temperature of a neighborhood whose
 * cloud-in-cell sums are `mass` (sum w m) and `massSquared` (sum w m^2): the effective sample size
 * of a mass-weighted mean, (sum m)^2 / sum m^2, times PROTOSTAR_NOISE_N_SHAPE for the cloud-in-cell
 * weights. A cell without mass has no particles.
 */
export function effectiveParticles(mass: number, massSquared: number): number {
    return massSquared > 0 ? PROTOSTAR_NOISE_N_SHAPE * mass * mass / massSquared : 0;
}

/**
 * Weight of the newest reading in the exponential average of the temperature over a step of `dt`
 * seconds: 1 - exp(-dt / tau). Per second, not per step: the number of substeps per frame and
 * their duration change with the simulation speed. A time constant of 0 (or less) is no smoothing.
 */
export function smoothingWeight(dt: number, tau: number): number {
    return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}
