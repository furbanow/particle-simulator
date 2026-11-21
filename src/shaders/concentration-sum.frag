// Last passes of the GPU search: the sums of the bins the points pass filled.
//   SUM_BLOCKS  BLOCK x BLOCK bins per output texel (all four channels added);
//   SUM_CENTER  the blocks added into one texel, the center of mass of the particles inside the disk of the densest cells:
//               (x, y, mass inside, number of particles inside) from (m, m dx, m dy, 1) about the center of those cells;
//   SUM_RESULT  the blocks added, and the two texels the CPU reads (the layout is in simulation/concentration.ts):
//               (center x, center y, mass inside the disk about it, total mass), (m |d|^2, particles, mass of the densest disk of cells, 0).
// Defines: SUM_STAGE, SUM_BLOCKS, SUM_CENTER, SUM_RESULT, BLOCK.
uniform sampler2D source;
#if SUM_STAGE == SUM_BLOCKS

void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    vec4 sum = vec4(0.0);
    for (int j = 0; j < BLOCK; j++) {
        for (int i = 0; i < BLOCK; i++) sum += texelFetch(source, origin + ivec2(i, j), 0);
    }
    gl_FragColor = sum;
}
#else
uniform sampler2D stageBest;               // (x, y of the densest disk of cells, its mass, total mass)

vec4 total() {
    ivec2 size = textureSize(source, 0);
    vec4 sum = vec4(0.0);
    for (int j = 0; j < size.y; j++) {
        for (int i = 0; i < size.x; i++) sum += texelFetch(source, ivec2(i, j), 0);
    }
    return sum;
}

#if SUM_STAGE == SUM_CENTER
void main() {
    vec4 best = texelFetch(stageBest, ivec2(0), 0);
    vec4 s = total();
    // The disk has no mass when the grid has none (or the species' masses are all 0): the center stays where it was.
    vec2 center = s.x > 0.0 ? best.xy + s.yz / s.x : best.xy;
    gl_FragColor = vec4(center, s.x, s.w);
}
#else
uniform sampler2D stageCenter;             // (x, y, ...) of the refined center

void main() {
    vec4 best = texelFetch(stageBest, ivec2(0), 0);
    vec4 center = texelFetch(stageCenter, ivec2(0), 0);
    vec4 s = total();                      // (m, m |d|^2, particles, 0)
    if (int(gl_FragCoord.x) == 0) gl_FragColor = vec4(center.xy, s.x, best.w);
    else gl_FragColor = vec4(s.y, s.z, best.z, 0.0);
}
#endif
#endif
