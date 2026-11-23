// The work of the adaptive thickness (A11, thickness.ts): the softening of a pair of cells changes with their thicknesses, so the
// potential energy changes at fixed positions, dU = (G / 4) sum_i m_i S_i d(h_i^2) with S_i = sum_j m_j / (r_ij^2 + eps_ij^2)^(3/2) (the
// fourth channel of the gravity grid, times G), which no force does: K + U - W stays constant, W the sum of those changes over the run.
// Two stages: WORK_FIRST sums BLOCK x BLOCK cells of (m, h^2 now) against the previous substep's h^2 per texel; WORK_SECOND sums BLOCK x
// BLOCK texels of the first stage and adds them to the accumulator of the previous substep (one texel, x). Run with the flag on only (and
// in the substep that turns it off).
// Defines: WORK_STAGE, WORK_FIRST, WORK_SECOND, BLOCK.
#if WORK_STAGE == WORK_FIRST
uniform sampler2D gridForce;            // S_i G (px/s^2 per px) in w
uniform sampler2D gridSource;           // (m, h^2) of this substep
uniform sampler2D gridSourcePrevious;   // (m, h^2) of the previous substep
#else
uniform sampler2D source;               // first stage, x
uniform sampler2D accumulator;          // W of the previous substep, x
#endif

void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    float sum = 0.0;
    for (int j = 0; j < BLOCK; j++) {
        for (int i = 0; i < BLOCK; i++) {
            ivec2 c = origin + ivec2(i, j);
#if WORK_STAGE == WORK_FIRST
            vec2 now = texelFetch(gridSource, c, 0).xy;
            float before = texelFetch(gridSourcePrevious, c, 0).y;
            sum += 0.25 * now.x * texelFetch(gridForce, c, 0).w * (now.y - before);
#else
            sum += texelFetch(source, c, 0).x;
#endif
        }
    }
#if WORK_STAGE == WORK_FIRST
    gl_FragColor = vec4(sum, 0.0, 0.0, 0.0);
#else
    gl_FragColor = vec4(texelFetch(accumulator, ivec2(0), 0).x + sum, 0.0, 0.0, 0.0);
#endif
}
