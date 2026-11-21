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

import { PROTOSTAR_NOISE_N_MIN, PROTOSTAR_NOISE_N_SHAPE } from '../../config';

/** Below this x = alpha / N, ln(1 + x) is summed as a series (a 32-bit log(1 + x) loses all its digits as x shrinks). */
const LOG1P_SERIES_LIMIT = 0.25;

/**
 * ln(1 + x) for x >= 0 without the cancellation of log(1 + x): 2 atanh(x / (2 + x)), an odd series
 * in y = x / (2 + x), at most 1/9 for the x of the series branch. Same terms as the shader.
 */
export function log1p(x: number): number {
    if (x >= LOG1P_SERIES_LIMIT) return Math.log(1 + x);
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
