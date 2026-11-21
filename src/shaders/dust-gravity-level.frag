// One coarse level (1 and up) of the sticky dust's gravity: its gradient at its own resolution,
// weighted like the level is in the pull (2^(level * LONG_RANGE), equal weights ~ 1/r potential).
// The gradient code is dust-gradient.glsl, included before. Defines: DENSITY_RES, LONG_RANGE, GRADIENT_CORNER_WEIGHT.
// The grid has one texel more than the level on every side (an apron): there the gradient is that of the
// level continued by repeating its edge texels, as the clamp-to-edge of a texture read does, so that a read
// between the edge and the first texel center is the same as the old loop's.
uniform int level;

void main() {
    ivec2 texel = ivec2(gl_FragCoord.xy) - 1;
    gl_FragColor = vec4(exp2(float(level) * LONG_RANGE) * levelGradient(texel, level), 0.0, 0.0);
}
