// Gas state of each cell from the moments of its 3x3 neighborhood: density, temperature (the
// velocity dispersion around the neighborhood's mean velocity, so bulk rotation and coherent
// infall are not heat) and mean velocity; and, on a second attachment, what the fusion rate
// needs: the temperature averaged over time, and the effective number of particles that the
// temperature is estimated from. Two targets take turns (the averaged temperature of the previous
// substep is read from the other one). Defines: GRID_RES, NOISE_N_SHAPE.
uniform sampler2D gridMoments;          // (m, m vx, m vy, m |v|^2), deposit units
uniform sampler2D gridComposition;      // (m / mu, count, m^2, 0): m^2 in z
uniform sampler2D gridThermoPrevious;   // the second attachment of the previous substep
uniform float depositVelScale;
uniform float densityPerDeposit;        // rho / rho0 per deposited mass in a 3x3 neighborhood
uniform float temperatureWeight;        // weight of the new temperature in the average: 1 - exp(-dt / tau), 1 without history

layout(location = 1) out highp vec4 outThermo;   // (T averaged over time px^2/s^2, effective particles, 0, 0)

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 s = vec4(0.0);
    float massSquared = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 c = cell + ivec2(dx, dy);
            if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, ivec2(GRID_RES)))) continue;
            s += texelFetch(gridMoments, c, 0);
            massSquared += texelFetch(gridComposition, c, 0).z;
        }
    }
    if (s.x <= 0.0) {
        gl_FragColor = vec4(0.0);
        outThermo = vec4(0.0);
        return;
    }
    vec2 mean = s.yz / s.x;
    float t = max(s.w / s.x - dot(mean, mean), 0.0) / (depositVelScale * depositVelScale);
    gl_FragColor = vec4(s.x * densityPerDeposit, t, mean / depositVelScale);

    // The average starts afresh where the cell held no gas at the previous substep (and at a restart: weight 1).
    float previous = texelFetch(gridThermoPrevious, cell, 0).x;
    float averaged = previous > 0.0 ? mix(previous, t, temperatureWeight) : t;
    // Effective sample size of a mass-weighted mean, (sum m)^2 / sum m^2, times the shape factor of the weights.
    float particles = massSquared > 0.0 ? NOISE_N_SHAPE * s.x * s.x / massSquared : 0.0;
    outThermo = vec4(averaged, particles, 0.0, 0.0);
}
