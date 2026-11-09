// Shared by the protostar shaders: sampling of the grids at a particle, fusion rate, random numbers.
// Defines: MAX_SPECIES, GRID_RES, FUSION_RATE_MAX. Included after dark-matter.glsl (darkMatterAccel).
uniform sampler2D gridForce;            // gravitational acceleration at the cell centers (px/s^2)
uniform sampler2D gridGas;              // (rho / rho0, T px^2/s^2, mean vx, mean vy) of the 3x3 neighborhood
uniform sampler2D gridHeat;             // fusion heating per unit mass of the 3x3 neighborhood, T0 per s
uniform float gridCell;                 // cell size, px
uniform float fusionTRef;               // T0, px^2/s^2
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

/** Acceleration at x: bilinear interpolation of the gravity grid, plus the static dark matter's pull. */
vec2 forceAt(vec2 x) {
    ivec2 c[4]; float w[4];
    gridCorners(x, c, w);
    vec2 a = vec2(0.0);
    for (int k = 0; k < 4; k++) a += w[k] * texelFetch(gridForce, c[k], 0).xy;
    return a + darkMatterAccel(x);
}

struct Gas {
    float rho;      // rho / rho0
    float t;        // velocity dispersion, px^2/s^2
    vec2 v;         // mean velocity, px/s
    float heat;     // fusion heating per unit mass, T0 per s
};

/** Gas state at x: density interpolated bilinearly, the other fields with mass weights. */
Gas gasAt(vec2 x) {
    ivec2 c[4]; float w[4];
    gridCorners(x, c, w);
    Gas g = Gas(0.0, 0.0, vec2(0.0), 0.0);
    for (int k = 0; k < 4; k++) {
        vec4 s = texelFetch(gridGas, c[k], 0);
        float m = w[k] * s.x;
        g.rho += m;
        g.t += m * s.y;
        g.v += m * s.zw;
        g.heat += m * texelFetch(gridHeat, c[k], 0).x;
    }
    if (g.rho > 0.0) {
        g.t /= g.rho;
        g.v /= g.rho;
        g.heat /= g.rho;
    }
    return g;
}

/**
 * Expected fusions per second of one particle of type `k`: lambda * rho^n * (T / T_ref)^alpha,
 * capped. Computed from logarithms: the powers alone would overflow (T^40).
 */
float fusionRateOf(int k, Gas g) {
    if (reactionTo[k] < 0.0 || reactionRate[k] <= 0.0 || g.rho <= 0.0 || g.t <= 0.0) return 0.0;
    float logRate = log(reactionRate[k]) + reactionDensityExponent[k] * log(g.rho)
                  + reactionExponent[k] * log(g.t / (fusionTRef * reactionReference[k]));
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
