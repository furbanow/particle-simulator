// Where a position sits in the sticky dust's gravity field (DustGravityField): the field is sampled at
// the corners of the density texels, DENSITY_RES + 1 per side, so that the bilinear read of its texture
// reproduces the sum of the levels' own bilinear reads. `duv` is the position in the density grid's uv.
// Defines: DENSITY_RES.
vec2 gravityFieldUv(vec2 duv) {
    return (duv * float(DENSITY_RES) + 0.5) / float(DENSITY_RES + 1);
}
