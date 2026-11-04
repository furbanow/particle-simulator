// Gas state of each cell from the moments of its 3x3 neighborhood: density, temperature (the
// velocity dispersion around the neighborhood's mean velocity, so bulk rotation and coherent
// infall are not heat) and mean velocity. Defines: GRID_RES.
uniform sampler2D gridMoments;          // (m, m vx, m vy, m |v|^2), deposit units
uniform float depositVelScale;
uniform float densityPerDeposit;        // rho / rho0 per deposited mass in a 3x3 neighborhood

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 s = vec4(0.0);
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 c = cell + ivec2(dx, dy);
            if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, ivec2(GRID_RES)))) continue;
            s += texelFetch(gridMoments, c, 0);
        }
    }
    if (s.x <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec2 mean = s.yz / s.x;
    float t = max(s.w / s.x - dot(mean, mean), 0.0);
    gl_FragColor = vec4(s.x * densityPerDeposit, t / (depositVelScale * depositVelScale), mean / depositVelScale);
}
