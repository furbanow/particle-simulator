// The stability map of the gas (A12): Toomre's Q and beta = t_cool Omega of every cell, from the gas pass (density, dispersion, mean
// velocity) and the molecular weight's factor. The derivation and the TypeScript twin are in protostar/stability.ts:
//   Omega = (dx u_y - dy u_x) / r^2 about the center of mass, zeta = d u_y / dx - d u_x / dy (central differences, one-sided next to an
//   empty cell), kappa^2 = 2 Omega zeta, Q = sqrt(t / 2) kappa / (3.36 G Sigma), beta = |Omega| / |d ln T / dt| of the thin-disc cooling.
// Writes (Q, beta, rho / rho0, kappa^2); an unbounded value (no gas, no cooling) is STABILITY_CAP.
// Defines: GRID_RES, STELLAR_TOOMRE, STABILITY_CAP.
uniform sampler2D gridGas;              // (rho / rho0, dispersion px^2/s^2, mean vx, mean vy)
uniform sampler2D gridThermo;           // (T averaged, effective particles, mu / mu_H, 0)
uniform float gridCell;                 // px
uniform vec2 centerOfMass;              // px
uniform float gravityDensity;           // G_eff rho0, px/s^2: G Sigma = gravityDensity * rho
uniform float fusionTRef;               // T0, px^2/s^2
uniform float radiation;                // c, 1/s
uniform float opacityKappa;             // kappa, per rho0
uniform float minTemperature;           // T_min, T0

bool hasGas(ivec2 c) {
    if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, ivec2(GRID_RES)))) return false;
    return texelFetch(gridGas, c, 0).x > 0.0;
}

/** d(mean velocity)/d(axis) at `cell`: the two components (x: d ux, y: d uy). */
vec2 derivative(ivec2 cell, ivec2 axis, vec2 here) {
    bool hiOk = hasGas(cell + axis);
    bool loOk = hasGas(cell - axis);
    if (!hiOk && !loOk) return vec2(0.0);
    vec2 hi = hiOk ? texelFetch(gridGas, cell + axis, 0).zw : here;
    vec2 lo = loOk ? texelFetch(gridGas, cell - axis, 0).zw : here;
    return (hi - lo) / ((hiOk && loOk ? 2.0 : 1.0) * gridCell);
}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 gas = texelFetch(gridGas, cell, 0);
    float rho = gas.x;
    if (!(rho > 0.0)) {
        gl_FragColor = vec4(STABILITY_CAP, STABILITY_CAP, 0.0, 0.0);
        return;
    }
    float t = gas.y;
    vec2 u = gas.zw;
    vec2 d = (vec2(cell) + 0.5) * gridCell - centerOfMass;
    float omega = (d.x * u.y - d.y * u.x) / max(dot(d, d), gridCell * gridCell);
    float vorticity = derivative(cell, ivec2(1, 0), u).y - derivative(cell, ivec2(0, 1), u).x;
    float kappa2 = 2.0 * omega * vorticity;

    float gravity = STELLAR_TOOMRE * gravityDensity * rho;
    float q = gravity > 0.0 ? min(sqrt(max(t, 0.0) * 0.5) * sqrt(max(kappa2, 0.0)) / gravity, STABILITY_CAP) : STABILITY_CAP;

    // The rate of the cooling of protostar-velocity.frag (cooling.ts: coolingLogRate), at the cell's temperature.
    float mu = texelFetch(gridThermo, cell, 0).z;
    float temperature = mu * t / fusionTRef;
    float beta = STABILITY_CAP;
    if (temperature > minTemperature && radiation > 0.0 && opacityKappa > 0.0) {
        float column = 0.1875 * opacityKappa * rho * rho + 0.4330127 * rho + 0.5 / opacityKappa;
        float rate = radiation * mu * temperature * temperature * temperature / column;
        if (rate > 0.0) beta = min(abs(omega) / rate, STABILITY_CAP);
    }
    gl_FragColor = vec4(q, beta, rho, kappa2);
}
