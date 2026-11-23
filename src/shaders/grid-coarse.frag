// Coarse gravity grid: mass and center of mass (px) of COARSE_FACTOR x COARSE_FACTOR fine cells.
// Defines: COARSE_FACTOR. Optional: COARSE_THICKNESS (the protostar's): w is the softening^2 of the monopole, the mass-weighted mean
// of the h^2 of the source grid with the adaptive thickness on (A11, twin meanThickness2()), the fixed eps^2 otherwise.
uniform sampler2D gridMoments;          // mass in x
uniform float gridCell;
#ifdef COARSE_THICKNESS
uniform sampler2D gridSource;           // (m, h^2, 0, 0) of the gas pass
uniform float thicknessOn;
uniform float softening2;
#endif

void main() {
    ivec2 coarse = ivec2(gl_FragCoord.xy);
    float m = 0.0;
    vec2 mx = vec2(0.0);
#ifdef COARSE_THICKNESS
    float mh = 0.0;
#endif
    for (int j = 0; j < COARSE_FACTOR; j++) {
        for (int i = 0; i < COARSE_FACTOR; i++) {
            ivec2 c = coarse * COARSE_FACTOR + ivec2(i, j);
            float mi = texelFetch(gridMoments, c, 0).x;
            m += mi;
            mx += mi * (vec2(c) + 0.5);
#ifdef COARSE_THICKNESS
            mh += mi * texelFetch(gridSource, c, 0).y;
#endif
        }
    }
    vec2 center = m > 0.0 ? mx / m : (vec2(coarse) + 0.5) * float(COARSE_FACTOR);
#ifdef COARSE_THICKNESS
    float e2 = thicknessOn > 0.5 && m > 0.0 ? mh / m : softening2;
    gl_FragColor = vec4(m, center * gridCell, e2);
#else
    gl_FragColor = vec4(m, center * gridCell, 0.0);
#endif
}
