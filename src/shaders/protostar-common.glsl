// Shared by the protostar shaders: sampling of the grids at a particle, fusion rate, random numbers.
// Defines: MAX_SPECIES, GRID_RES, FUSION_RATE_MAX, NOISE_N_MIN, and GAS_THERMO (0 or 1: whether gasAt() reads the
// temperature that feeds the fusion rate; only the shaders that compute a rate need it). Included after drawing.glsl (drawingAccel).
uniform sampler2D gridForce;            // gravitational acceleration at the cell centers (px/s^2)
uniform sampler2D gridGas;              // (rho / rho0, T px^2/s^2, mean vx, mean vy) of the 3x3 neighborhood
uniform sampler2D gridHeat;             // fusion heating per unit mass of the 3x3 neighborhood, T0 per s
uniform sampler2D gridThermo;           // (T averaged over time px^2/s^2, effective number of particles, 0, 0) of the 3x3 neighborhood
uniform float gridCell;                 // cell size, px
uniform float fusionTRef;               // T0, px^2/s^2
uniform float noiseCorrection;          // 1: the fusion rate is divided by the bias that the noise of T causes; 0: it is not (lab)
uniform float seed;                     // changes every substep
uniform float reactionTo[MAX_SPECIES];  // rank the type fuses into, -1: none
uniform float reactionKeep[MAX_SPECIES];
uniform float reactionRate[MAX_SPECIES];
uniform float reactionExponent[MAX_SPECIES];
uniform float reactionReference[MAX_SPECIES];   // temperature of the law, in T0
uniform float reactionDensityExponent[MAX_SPECIES];
uniform float reactionEnergy[MAX_SPECIES];

/** The four cells around x (cell centers) and their bilinear weights. */
void gridCorners(vec2 x, out ivec2 c[4], out float w[4]) {
    vec2 p = x / gridCell - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    ivec2 i0 = ivec2(i);
    ivec2 hi = ivec2(GRID_RES - 1);
    c[0] = clamp(i0, ivec2(0), hi);
    c[1] = clamp(i0 + ivec2(1, 0), ivec2(0), hi);
    c[2] = clamp(i0 + ivec2(0, 1), ivec2(0), hi);
    c[3] = clamp(i0 + ivec2(1, 1), ivec2(0), hi);
    w[0] = (1.0 - f.x) * (1.0 - f.y);
    w[1] = f.x * (1.0 - f.y);
    w[2] = (1.0 - f.x) * f.y;
    w[3] = f.x * f.y;
}

/** Acceleration at x: bilinear interpolation of the gravity grid, plus the static drawings' force. */
vec2 forceAt(vec2 x) {
    ivec2 c[4]; float w[4];
    gridCorners(x, c, w);
    vec2 a = vec2(0.0);
    for (int k = 0; k < 4; k++) a += w[k] * texelFetch(gridForce, c[k], 0).xy;
    return a + drawingAccel(x);
}

struct Gas {
    float rho;      // rho / rho0
    float t;        // velocity dispersion, px^2/s^2: the heating and the glow use this one
    vec2 v;         // mean velocity, px/s
    float heat;     // fusion heating per unit mass, T0 per s
    float tRate;    // the dispersion averaged over time, px^2/s^2: the fusion rate uses this one (GAS_THERMO)
    float particles;    // effective number of particles behind the temperature (GAS_THERMO)
};

/** Gas state at x: density interpolated bilinearly, the other fields with mass weights. */
Gas gasAt(vec2 x) {
    ivec2 c[4]; float w[4];
    gridCorners(x, c, w);
    Gas g = Gas(0.0, 0.0, vec2(0.0), 0.0, 0.0, 0.0);
    for (int k = 0; k < 4; k++) {
        vec4 s = texelFetch(gridGas, c[k], 0);
        float m = w[k] * s.x;
        g.rho += m;
        g.t += m * s.y;
        g.v += m * s.zw;
        g.heat += m * texelFetch(gridHeat, c[k], 0).x;
#if GAS_THERMO
        vec4 thermo = texelFetch(gridThermo, c[k], 0);
        g.tRate += m * thermo.x;
        g.particles += m * thermo.y;
#endif
    }
    if (g.rho > 0.0) {
        g.t /= g.rho;
        g.v /= g.rho;
        g.heat /= g.rho;
        g.tRate /= g.rho;
        g.particles /= g.rho;
    }
    return g;
}

/** ln(1 + x) for x >= 0 without the cancellation of log(1 + x) when x is small (twin: log1p() in noiseBias.ts). */
float log1pSeries(float x) {
    if (x >= 0.25) return log(1.0 + x);
    float y = x / (2.0 + x);
    float y2 = y * y;
    return 2.0 * y * (1.0 + y2 * (1.0 / 3.0 + y2 * (1.0 / 5.0 + y2 * (1.0 / 7.0))));
}

/**
 * ln [Gamma(n + alpha) / (Gamma(n) n^alpha)], by Stirling's series (twin: logGammaRatio() in noiseBias.ts, which explains it).
 */
float logGammaRatio(float n, float alpha) {
    float z = n + alpha;
    float stirlingZ = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * z * z)) / (z * z)) / z;
    float stirlingN = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * n * n)) / (n * n)) / n;
    return (z - 0.5) * log1pSeries(alpha / n) - alpha + stirlingZ - stirlingN;
}

/**
 * ln of the bias that the noise of the temperature puts on a rate that goes as T^alpha, when T is the dispersion
 * around the mean estimated from `particles` (effective) particles: logGammaRatio(particles - 1, alpha) - alpha ln(1 + 1 / (particles - 1)).
 * Twin: logNoiseBias() in noiseBias.ts, tested against the exact expectation over the Gamma law.
 */
float logNoiseBias(float particles, float alpha) {
    if (alpha <= 0.0) return 0.0;
    float n = max(particles - 1.0, NOISE_N_MIN);
    return logGammaRatio(n, alpha) - alpha * log1pSeries(1.0 / n);
}

/**
 * Expected fusions per second of one particle of type `k`: lambda * rho^n * (T / T_ref)^alpha,
 * capped, with T the temperature averaged over time and the rate divided by the bias that the noise
 * of T causes (logNoiseBias). Computed from logarithms: the powers alone would overflow (T^40).
 * Needs GAS_THERMO. Twin: fusionRate() in reactions.ts.
 */
float fusionRateOf(int k, Gas g) {
    if (reactionTo[k] < 0.0 || reactionRate[k] <= 0.0 || g.rho <= 0.0 || g.tRate <= 0.0) return 0.0;
    float alpha = reactionExponent[k];
    float logRate = log(reactionRate[k]) + reactionDensityExponent[k] * log(g.rho)
                  + alpha * log(g.tRate / (fusionTRef * reactionReference[k]))
                  - noiseCorrection * logNoiseBias(g.particles, alpha);
    return exp(min(logRate, log(FUSION_RATE_MAX)));
}

uint pcgHash(uint v) {
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

/** Uniform random number in [0, 1), one stream per use, new every substep. */
float random01(float index, uint stream) {
    uint h = pcgHash(uint(index) * 4u + stream + pcgHash(uint(seed)));
    return float(h) / 4294967296.0;
}
