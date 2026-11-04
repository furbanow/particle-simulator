// Fusion heating per unit mass of each cell's 3x3 neighborhood: the expected fusion power
// deposited there, shared by the mass there. Defines: GRID_RES.
uniform sampler2D gridMoments;          // mass in x
uniform sampler2D gridPower;            // fusion power in x (deposit mass x T0 per s)

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
    gl_FragColor = vec4(m > 0.0 ? power / m : 0.0, 0.0, 0.0, 0.0);
}
