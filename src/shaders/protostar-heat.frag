// Fusion heating per unit mass of each cell's 3x3 neighborhood: the expected fusion power
// deposited there, shared by the mass there. Its second channel carries the temperature's factor
// mu / mu_H of the gas pass (A1) to the velocity pass, which samples this grid already: T = factor x
// the dispersion (the glow reads T, the heating the dispersion). Defines: GRID_RES.
uniform sampler2D gridMoments;          // mass in x
uniform sampler2D gridPower;            // fusion power in x (deposit mass x T0 per s)
uniform sampler2D gridThermo;           // the gas pass's second attachment: mu / mu_H in z

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    float m = 0.0, power = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 c = cell + ivec2(dx, dy);
            if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, ivec2(GRID_RES)))) continue;
            m += texelFetch(gridMoments, c, 0).x;
            power += texelFetch(gridPower, c, 0).x;
        }
    }
    gl_FragColor = vec4(m > 0.0 ? power / m : 0.0, texelFetch(gridThermo, cell, 0).z, 0.0, 0.0);
}
