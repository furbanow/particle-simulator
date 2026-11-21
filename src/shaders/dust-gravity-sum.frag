// The sticky dust's gravity of the coarse levels (1 and up) per corner of a density texel: the levels'
// gradients (dust-gravity-level.frag), each read bilinearly from its own grid at the corner and summed.
// A level's grid is bilinear between the centers of its texels, which are corners of level 0's texels
// (a level-L texel is 2^L wide, L >= 1): the sum is bilinear between the corners, so a particle's one
// bilinear read of it (gravityFieldUv) gives the sum of the levels' own reads at its position, exactly.
// Defines: DENSITY_RES. TypeScript prepends the declarations of the levels' samplers and the macro
// COARSE_GRADIENTS(uv), their sum.
void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5) / float(DENSITY_RES);
    gl_FragColor = vec4(COARSE_GRADIENTS(uv), 0.0, 0.0);
}
