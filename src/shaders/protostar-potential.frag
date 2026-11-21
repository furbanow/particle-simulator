// Potential energy of the grids as they are, 1/2 sum m phi (deposit units x px^2/s^2), in two
// stages: POTENTIAL_FIRST sums BLOCK x BLOCK cells of the moments and gravity grids per texel,
// POTENTIAL_SECOND sums BLOCK x BLOCK texels of the first stage into one. The model runs it just
// before the grids are drawn again, so that it holds the energy of the previous substep, whose
// positions go with the velocities the next deposit sees (see reduction.ts).
// Defines: POTENTIAL_STAGE, POTENTIAL_FIRST, POTENTIAL_SECOND, BLOCK.
#if POTENTIAL_STAGE == POTENTIAL_FIRST
uniform sampler2D gridMoments;          // mass in x
uniform sampler2D gridForce;            // potential in z
#else
uniform sampler2D source;               // first stage, x
#endif

void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    float sum = 0.0;
    for (int j = 0; j < BLOCK; j++) {
        for (int i = 0; i < BLOCK; i++) {
            ivec2 c = origin + ivec2(i, j);
#if POTENTIAL_STAGE == POTENTIAL_FIRST
            sum += 0.5 * texelFetch(gridMoments, c, 0).x * texelFetch(gridForce, c, 0).z;
#else
            sum += texelFetch(source, c, 0).x;
#endif
        }
    }
    gl_FragColor = vec4(sum, 0.0, 0.0, 0.0);
}
