// Coarse gravity grid: mass and center of mass (px) of COARSE_FACTOR x COARSE_FACTOR fine cells.
// Defines: COARSE_FACTOR.
uniform sampler2D gridMoments;          // mass in x
uniform float gridCell;

void main() {
    ivec2 coarse = ivec2(gl_FragCoord.xy);
    float m = 0.0;
    vec2 mx = vec2(0.0);
    for (int j = 0; j < COARSE_FACTOR; j++) {
        for (int i = 0; i < COARSE_FACTOR; i++) {
            ivec2 c = coarse * COARSE_FACTOR + ivec2(i, j);
            float mi = texelFetch(gridMoments, c, 0).x;
            m += mi;
            mx += mi * (vec2(c) + 0.5);
        }
    }
    vec2 center = m > 0.0 ? mx / m : (vec2(coarse) + 0.5) * float(COARSE_FACTOR);
    gl_FragColor = vec4(m, center * gridCell, 0.0);
}
