// Reduction of the protostar grids for the stats, in two stages: (max rho / rho0, T / T0 of the
// densest cell: the core, total expected fusions per s). FIRST_STAGE reads BLOCK x BLOCK cells of
// the grids, the second stage BLOCK x BLOCK texels of the first one. Defines: FIRST_STAGE, BLOCK.
uniform sampler2D source;               // gas grid (first stage) or first stage
uniform sampler2D gridPower;            // fusions per s in y (first stage)
uniform float fusionTRef;

void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    vec3 r = vec3(0.0);
    for (int j = 0; j < BLOCK; j++) {
        for (int i = 0; i < BLOCK; i++) {
            ivec2 c = origin + ivec2(i, j);
            vec4 s = texelFetch(source, c, 0);
#if FIRST_STAGE
            float rate = texelFetch(gridPower, c, 0).y;
            vec2 densest = s.x > r.x ? vec2(s.x, s.y / fusionTRef) : r.xy;
#else
            float rate = s.z;
            vec2 densest = s.x > r.x ? s.xy : r.xy;
#endif
            r = vec3(densest, r.z + rate);
        }
    }
    gl_FragColor = vec4(r, 1.0);
}
