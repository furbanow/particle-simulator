// Gradient of one level of the density pyramid (mass in R) at that level's own resolution: the
// difference between the texels on either side of a texel, one texel away, averaged over the three
// rows (columns) of its 3 x 3 neighbourhood with the weights w, 1 - 2w, w (w = GRADIENT_CORNER_WEIGHT:
// 0 is the plain central difference, 3/16 the isotropic stencil of Scharr). Beyond the field the edge
// texel repeats, as the clamp-to-edge of a texture read does. Defines: DENSITY_RES, GRADIENT_CORNER_WEIGHT.
uniform sampler2D textureDensity;

float densityAt(ivec2 texel, int level, ivec2 last) {
    return texelFetch(textureDensity, clamp(texel, ivec2(0), last), level).r;
}

vec2 levelGradient(ivec2 texel, int level) {
    ivec2 last = ivec2((DENSITY_RES >> level) - 1);
    float dpp = densityAt(texel + ivec2(1, 1), level, last);
    float dmp = densityAt(texel + ivec2(-1, 1), level, last);
    float dpm = densityAt(texel + ivec2(1, -1), level, last);
    float dmm = densityAt(texel + ivec2(-1, -1), level, last);
    float dp0 = densityAt(texel + ivec2(1, 0), level, last);
    float dm0 = densityAt(texel + ivec2(-1, 0), level, last);
    float d0p = densityAt(texel + ivec2(0, 1), level, last);
    float d0m = densityAt(texel + ivec2(0, -1), level, last);
    const float w = GRADIENT_CORNER_WEIGHT;
    return vec2(w * (dpp - dmp + dpm - dmm) + (1.0 - 2.0 * w) * (dp0 - dm0),
                w * (dpp - dpm + dmp - dmm) + (1.0 - 2.0 * w) * (d0p - d0m));
}
