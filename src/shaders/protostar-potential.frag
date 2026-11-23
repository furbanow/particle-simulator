// Potential energy of the grids as they are, 1/2 sum m phi (deposit units x px^2/s^2), in two
// stages: POTENTIAL_FIRST sums BLOCK x BLOCK cells of the moments and gravity grids per texel,
// POTENTIAL_SECOND sums BLOCK x BLOCK texels of the first stage into one. The model runs it just
// before the grids are drawn again, so that it holds the energy of the previous substep, whose
// positions go with the velocities the next deposit sees (see reduction.ts). The self-interaction of the particles, -G m^2 / h per
// particle with h the softening of its cell (A11: the cell's thickness), is taken off cell by cell, as in protostar-reduce.frag.
// Defines: POTENTIAL_STAGE, POTENTIAL_FIRST, POTENTIAL_SECOND, BLOCK.
#if POTENTIAL_STAGE == POTENTIAL_FIRST
uniform sampler2D gridMoments;          // mass in x
uniform sampler2D gridForce;            // potential in z
uniform sampler2D gridComposition;      // m^2 in z
uniform sampler2D gridSource;           // h^2 in y
uniform float gravityPerDeposit;
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
            float h2 = texelFetch(gridSource, c, 0).y;
            float self = h2 > 0.0 ? 0.5 * gravityPerDeposit * texelFetch(gridComposition, c, 0).z * inversesqrt(h2) : 0.0;
            sum += 0.5 * texelFetch(gridMoments, c, 0).x * texelFetch(gridForce, c, 0).z + self;
#else
            sum += texelFetch(source, c, 0).x;
#endif
        }
    }
    gl_FragColor = vec4(sum, 0.0, 0.0, 0.0);
}
