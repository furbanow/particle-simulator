// Shared by the protostar shaders: sampling of the grids at a particle, fusion rate, random numbers, collisions of the gas.
// Defines: MAX_SPECIES, GRID_RES, FUSION_RATE_MAX, NOISE_N_MIN, NOISE_SHIFT_MAX, GAS_THERMO (0 or 1: whether gasAt() reads the
// temperature that feeds the fusion rate; only the shaders that compute a rate need it) and GAS_HEAT (0 or 1: whether it reads the heating
// and the molecular weight's factor; the shaders that only compute a rate do not, which spares two samplers). Included after
// deposit-kernel.glsl (tscWeight) and drawing.glsl (drawingAccel).
//
// The nested grid (C2, nestedBox.ts): while nestedOn is 1, a particle inside [nestedLo, nestedHi] reads the force and the gas of the fine
// level (its own samplers, cells of nestedCell px from nestedOrigin) instead of the main grid's. The fine force grid holds the whole force
// there, a_fine(inside) + a_main(all) - a_main(inside) (protostar-nested-combine.frag).
uniform sampler2D gridForce;            // gravitational acceleration at the cell centers (px/s^2)
uniform float tscForce;                 // 1: forceAt() reads gridForce with the TSC weights (the tscDeposit switch)
uniform sampler2D gridGas;              // (rho / rho0, dispersion px^2/s^2, mean vx, mean vy) of the 3x3 neighborhood
uniform sampler2D gridHeat;             // (fusion heating per unit mass T0 per s, mu / mu_H, 0, 0) of the 3x3 neighborhood
uniform sampler2D gridThermo;           // (T averaged over time px^2/s^2, effective number of particles, mu / mu_H, h_ref / h) of the 3x3 neighborhood
uniform sampler2D gridFuel;             // (X, Y, 0, 0): the mass fractions of the fuel of the first two reactions (hydrogen, helium) in the 3x3 neighborhood
uniform float gridCell;                 // cell size, px
uniform vec2 gridOrigin;                // the grid's lower left corner, px: (0, 0) for the main grid (a nested grid, C2, is elsewhere)
uniform float nestedOn;                 // 1: the particles inside the nested box read the fine level (C2); 0: the main grid only
uniform float nestedCell;               // the fine cell, px
uniform vec2 nestedOrigin;              // the fine grid's lower left corner, px
uniform vec2 nestedLo;                  // where the particles read the fine level, px: the box less a margin (readRegion() in nestedBox.ts)
uniform vec2 nestedHi;
uniform sampler2D gridForceFine;        // the fine level's fields, laid out as the main ones
uniform sampler2D gridGasFine;
uniform sampler2D gridHeatFine;
uniform sampler2D gridThermoFine;
uniform sampler2D gridFuelFine;
uniform float fusionTRef;               // T0, px^2/s^2
uniform float noiseCorrection;          // 1: the fusion rate is divided by the bias that the noise of T causes; 0: it is not (lab)
uniform float seed;                     // changes every substep
uniform float reactionTo[MAX_SPECIES];  // rank the type fuses into, -1: none
uniform float reactionRate[MAX_SPECIES];
uniform float reactionPower[MAX_SPECIES];       // p: the power of T of the law's prefactor (2/3 proton-proton, 3 triple alpha)
uniform float reactionBarrier[MAX_SPECIES];     // G: the Gamow term b (T_ref / unit)^-q of the law at its reference temperature
uniform float reactionBarrierPower[MAX_SPECIES];    // q (1/3 proton-proton, 1 triple alpha)
uniform float reactionFuel[MAX_SPECIES];        // channel of gridFuel holding the mass fraction of the type (0: X, 1: Y), -1: none
uniform float reactionReference[MAX_SPECIES];   // temperature of the law, in T0
uniform float reactionDensityExponent[MAX_SPECIES];
uniform float reactionEnergy[MAX_SPECIES];

/** Whether x reads the fine level of the nested grid (C2). */
bool inNested(vec2 x) {
    return nestedOn > 0.5 && all(greaterThanEqual(x, nestedLo)) && all(lessThanEqual(x, nestedHi));
}

/** The four cells around x (cell centers) of a grid of `cell` px from `origin`, and their bilinear weights. */
void gridCorners(vec2 x, float cell, vec2 origin, out ivec2 c[4], out float w[4]) {
    vec2 p = (x - origin) / cell - 0.5;
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

/**
 * Acceleration at x: the gravity grid interpolated with the weights of the deposit (bilinear for cloud-in-cell, the 3x3 TSC weights
 * of deposit-kernel.glsl for TSC), plus the static drawings' force. The same weights for the deposit and the read, with a force
 * between cells that is odd in their offset, make a particle's force on itself vanish (Hockney & Eastwood); TSC deposited and read
 * bilinearly gives a particle up to 2 % of the pull it exerts at 1.5 cells on itself (lab: protostar.tsc.aliasing).
 */
vec2 forceFrom(sampler2D field, vec2 x, float cell, vec2 origin) {
    vec2 a = vec2(0.0);
    if (tscForce > 0.5) {
        vec2 p = (x - origin) / cell;
        ivec2 first = ivec2(floor(p)) - 1;
        ivec2 hi = ivec2(GRID_RES - 1);
        for (int dy = 0; dy < 3; dy++) {
            for (int dx = 0; dx < 3; dx++) {
                ivec2 c = first + ivec2(dx, dy);
                a += tscWeight(vec2(c) + 0.5 - p) * texelFetch(field, clamp(c, ivec2(0), hi), 0).xy;
            }
        }
    } else {
        ivec2 c[4]; float w[4];
        gridCorners(x, cell, origin, c, w);
        for (int k = 0; k < 4; k++) a += w[k] * texelFetch(field, c[k], 0).xy;
    }
    return a;
}

/** The force at x of the level that x reads (the main grid, or the fine one of the nested box), plus the drawings'. */
vec2 forceAt(vec2 x) {
    vec2 a = inNested(x) ? forceFrom(gridForceFine, x, nestedCell, nestedOrigin) : forceFrom(gridForce, x, gridCell, gridOrigin);
    return a + drawingAccel(x);
}

/**
 * Two temperatures (A1). The dispersion t = <|v - u|^2> is the kinetic energy of the disordered motion (energy per unit
 * mass t / 2): the heating and the cooling work on it, and anything that bookkeeps energy must. The temperature, as a
 * thermometer would read it, is T = mu * t with mu = mu_mean / mu_H (1 for hydrogen, 2.65 for helium) and T0 the temperature
 * of a hydrogen gas of dispersion T0: the fusion rate (tRate), the glow and the stats read that one.
 */
struct Gas {
    float rho;      // rho / rho0
    float t;        // velocity dispersion, px^2/s^2: the heating uses this one
    vec2 v;         // mean velocity, px/s
    float heat;     // fusion heating per unit mass, T0 per s
    float mu;       // mu_mean / mu_H: the temperature is mu * t (the glow reads it)
    float tRate;    // the temperature mu * t averaged over time, px^2/s^2: the fusion rate uses this one (GAS_THERMO)
    float particles;    // effective number of particles behind the temperature (GAS_THERMO)
    vec2 fuel;      // mass fractions (X, Y) of the fuel of the first two reactions: hydrogen and helium (GAS_THERMO)
    float thin;     // h_ref / h: the volume density of the fusion law over the surface density (A11; exactly 1 with the fixed softening) (GAS_THERMO)
    float cellRatio;    // the cell of the level read over the main grid's: 1, or 1 / NESTED_RATIO in the nested box (the Jeans floor's length)
};

/** Gas state at x of one level (its samplers, cells of `cell` px from `origin`): density interpolated bilinearly, the other fields with mass weights. */
Gas gasFrom(sampler2D gasGrid, sampler2D heatGrid, sampler2D thermoGrid, sampler2D fuelGrid, vec2 x, float cell, vec2 origin) {
    ivec2 c[4]; float w[4];
    gridCorners(x, cell, origin, c, w);
    Gas g = Gas(0.0, 0.0, vec2(0.0), 0.0, 0.0, 0.0, 0.0, vec2(0.0), 0.0, cell / gridCell);
    for (int k = 0; k < 4; k++) {
        vec4 s = texelFetch(gasGrid, c[k], 0);
        float m = w[k] * s.x;
        g.rho += m;
        g.t += m * s.y;
        g.v += m * s.zw;
#if GAS_HEAT
        vec4 heat = texelFetch(heatGrid, c[k], 0);
        g.heat += m * heat.x;
        g.mu += m * heat.y;
#endif
#if GAS_THERMO
        vec4 thermo = texelFetch(thermoGrid, c[k], 0);
        g.tRate += m * thermo.x;
        g.particles += m * thermo.y;
        g.thin += m * thermo.w;
        g.fuel += m * texelFetch(fuelGrid, c[k], 0).xy;
#endif
    }
    if (g.rho > 0.0) {
        g.t /= g.rho;
        g.v /= g.rho;
        g.heat /= g.rho;
        g.mu /= g.rho;
        g.tRate /= g.rho;
        g.particles /= g.rho;
        g.fuel /= g.rho;
        g.thin /= g.rho;
    }
    return g;
}

/** Gas state at x, from the level x reads (the main grid, or the fine one of the nested box). */
Gas gasAt(vec2 x) {
    if (inNested(x)) return gasFrom(gridGasFine, gridHeatFine, gridThermoFine, gridFuelFine, x, nestedCell, nestedOrigin);
    return gasFrom(gridGas, gridHeat, gridThermo, gridFuel, x, gridCell, gridOrigin);
}

/** ln(1 + x) for x > -1 without the cancellation of log(1 + x) when |x| is small (twin: log1p() in noiseBias.ts). */
float log1pSeries(float x) {
    if (abs(x) >= 0.25) return log(1.0 + x);
    float y = x / (2.0 + x);
    float y2 = y * y;
    return 2.0 * y * (1.0 + y2 * (1.0 / 3.0 + y2 * (1.0 / 5.0 + y2 * (1.0 / 7.0))));
}

/** e^x - 1 - x without the cancellation for small |x| (twin: expm1Minus() in noiseBias.ts). */
float expm1Minus(float x) {
    if (abs(x) >= 0.25) return exp(x) - 1.0 - x;
    return x * x / 2.0 * (1.0 + x / 3.0 * (1.0 + x / 4.0 * (1.0 + x / 5.0 * (1.0 + x / 6.0))));
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
 * The same bias for a rate with Gamow's temperature law, whose local exponent `alpha` varies with T (g: the barrier term at this
 * temperature, q its power): the power law's bias plus the curvature of ln r, by Laplace's method with one Newton step.
 * Twin: logNoiseBiasCurved() in noiseBias.ts, which derives it and gives the accuracy (0.2 % of the bias for N >= 100).
 */
float logNoiseBiasCurved(float particles, float alpha, float g, float q) {
    float plain = logNoiseBias(particles, alpha);
    if (alpha <= 0.0 || g <= 0.0) return plain;
    float n = max(particles - 1.0, NOISE_N_MIN);
    float power = q * g - alpha;
    float peak = n + alpha;
    float u0 = log1pSeries((alpha - 1.0) / (n + 1.0));
    float e0 = exp(-q * u0);
    float shift = clamp(g * q * (e0 - 1.0) / (peak + g * q * q * e0), -NOISE_SHIFT_MAX, NOISE_SHIFT_MAX);
    float e1 = e0 * exp(-q * shift);
    float grown = exp(shift);
    return plain - n * expm1Minus(shift) - alpha * (grown - 1.0) - power * shift - g * (e1 - 1.0 + q * u0)
         - 0.5 * log(grown + g * q * q * e1 / peak);
}

/** The Stirling correction of ln Gamma(z) (twin: stirling() in noiseBias.ts). */
float stirlingCorrection(float z) {
    float z2 = z * z;
    return (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * z2)) / z2) / z;
}

/**
 * ln of the unbiased estimate of f(T) / f(T_ref) for a resonant law T^-p exp(-b / T) (q = 1), from the temperature estimate tau = T / T_ref
 * of `particles` (effective) particles, for particles - 1 > p + NOISE_EXACT_MARGIN (G: the barrier term at T_ref). A very negative number
 * where the cell is too cold (S <= G). Twin: logUnbiasedResonant() in noiseBias.ts, which derives it.
 */
float logUnbiasedResonant(float particles, float tau, float p, float G) {
    float n = particles - 1.0;
    float s = particles * tau;
    if (s <= G) return -1e30;
    return G + p * log(n / s) - (n - p - 0.5) * log1pSeries(-p / n) - p + stirlingCorrection(n) - stirlingCorrection(n - p)
         + (n - p - 1.0) * log1pSeries(-G / s);
}

/**
 * Expected fusions per second of one particle of type `k` (A2): lambda * (rho X)^n * f(T) / f(T_ref), capped, with X the mass
 * fraction of the type (the fuel) in the neighborhood, f Gamow's law T^-p exp(-b T^-q) of the reaction, and T the temperature (the
 * dispersion times mu / mu_H) averaged over time, corrected for the noise of T: replaced by its exact unbiased estimate for a resonant law
 * (logUnbiasedResonant), divided by the bias that the noise causes (logNoiseBiasCurved, at the local exponent q g - p of the law) for the others. Computed from logarithms: the law's exponential underflows far below T_ref. rho is the density of
 * the grid, the surface density, times h_ref / h: the volume density Sigma / (2 h) of the layer in the units where the fixed softening's
 * is Sigma (A11; the factor is exactly 1 with the flag off). Needs GAS_THERMO. Twin: fusionRate() in reactions.ts, of the density
 * Sigma lawDensityFactor() (thickness.ts).
 */
float fusionRateOf(int k, Gas g) {
    if (reactionTo[k] < 0.0 || reactionRate[k] <= 0.0 || g.rho <= 0.0 || g.tRate <= 0.0) return 0.0;
    float fuel = reactionFuel[k] < 0.5 ? g.fuel.x : g.fuel.y;
    if (fuel <= 0.0) return 0.0;
    float logTau = log(g.tRate / (fusionTRef * reactionReference[k]));
    float q = reactionBarrierPower[k];
    float power = exp(-q * logTau);                         // (T / T_ref)^-q
    float barrier = reactionBarrier[k] * power;             // the Gamow term at this temperature
    float alpha = q * barrier - reactionPower[k];           // d ln r / d ln T
    float logLaw = -reactionPower[k] * logTau - reactionBarrier[k] * (power - 1.0);
    if (noiseCorrection > 0.0) {
        // A resonant law has an exact unbiased estimate; the others divide their rate by the bias that the noise of T causes.
        if (q == 1.0 && g.particles - 1.0 > reactionPower[k] + NOISE_EXACT_MARGIN) {
            logLaw = logUnbiasedResonant(g.particles, exp(logTau), reactionPower[k], reactionBarrier[k]);
        } else {
            logLaw -= logNoiseBiasCurved(g.particles, alpha, barrier, q);
        }
    }
    float logRate = log(reactionRate[k]) + reactionDensityExponent[k] * log(g.rho * g.thin * fuel) + logLaw;
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

// ---- Collisions of the gas (C1, the `collisions` flag; twin: collisions.ts) ----
// Defines: COLLISION_RES (GRID_RES + 1), COLLISION_MIN_PARTICLES, COLLISION_COS and COLLISION_SIN (the rotation's angle), COLLISION_SALT.
uniform sampler2D gridCollision;        // (n, sum vx, sum vy, sum |v|^2) of the particles of each cell of the shifted grid, velocities in L/s
uniform float collisionsOn;             // 1: the gas collides; 0: it does not (the collision grid is then stale)
uniform vec2 collisionShift;            // px: the shift of the collision grid at this substep, in [0, gridCell)^2
uniform float collisionVelScale;        // L/s per px/s: the deposit's velocity unit
uniform float collisionDensity;         // rho / rho0 per particle in a cell
uniform float collisionRate;            // collisions per s of a cell at rho0 and the dispersion T0: nu = rate rho sqrt(t)

/** The cell of the shifted collision grid that holds x. Twin: collisionCell(). */
ivec2 collisionCellOf(vec2 x) {
    return clamp(ivec2(floor((x + collisionShift) / gridCell)), ivec2(0), ivec2(COLLISION_RES - 1));
}

/** Uniform random number in [0, 1) of a cell for `stream`, new every substep, the same in every pass. Twin: cellRandom(). */
float collisionRandom(ivec2 cell, uint stream) {
    uint index = uint(cell.y * COLLISION_RES + cell.x);
    return float(pcgHash(index * 4u + stream + pcgHash(uint(seed) ^ COLLISION_SALT))) / 4294967296.0;
}

/** What the cell of a particle does at this substep: its mean velocity (px/s), its dispersion (px^2/s^2), the rotation's sign (0: none). */
struct Collision {
    vec2 u;
    float t;
    float sign;
};

/**
 * The collision of the cell that holds x after a step of `dt` seconds (twin: cellCollision()): it collides with probability
 * 1 - exp(-nu dt), nu = rate rho sqrt(t), if it holds COLLISION_MIN_PARTICLES or more.
 */
Collision collisionAt(vec2 x, float dt) {
    ivec2 cell = collisionCellOf(x);
    vec4 s = texelFetch(gridCollision, cell, 0);
    Collision c = Collision(vec2(0.0), 0.0, 0.0);
    if (s.x <= 0.0) return c;
    vec2 mean = s.yz / s.x;
    c.u = mean / collisionVelScale;
    c.t = max(s.w / s.x - dot(mean, mean), 0.0) / (collisionVelScale * collisionVelScale);
    if (s.x < float(COLLISION_MIN_PARTICLES) - 0.5) return c;
    float p = 1.0 - exp(-collisionRate * s.x * collisionDensity * sqrt(c.t / fusionTRef) * dt);
    if (collisionRandom(cell, 0u) < p) c.sign = collisionRandom(cell, 1u) < 0.5 ? -1.0 : 1.0;
    return c;
}

/** v turned about the cell's mean by +-the angle: the cell's momentum and kinetic energy are kept (twin: collide()). */
vec2 collide(vec2 v, Collision c) {
    if (c.sign == 0.0) return v;
    vec2 w = v - c.u;
    float s = c.sign * COLLISION_SIN;
    return c.u + vec2(COLLISION_COS * w.x - s * w.y, s * w.x + COLLISION_COS * w.y);
}
