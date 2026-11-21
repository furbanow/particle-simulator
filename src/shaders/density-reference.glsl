// The reference velocity of the density deposit (DensityField): the mean flow, in a coarse grid, of the previous
// substep's deposit. The deposit stores the agitation energy about it (m |v - v_ref|^2), which keeps the energy
// near the size of the agitation and not of the speed: the grid is in half floats, and the agitation
// E/rho - |u|^2 would otherwise be the difference of two large numbers. Both the splat and the velocity pass read it
// the same way, so they agree on it.
uniform sampler2D textureReference;     // (mass, scaled momentum) of the previous deposit, a coarse level, filtered
uniform vec2 referenceOffset;           // the domain offset that deposit was made with

/** Mean velocity at the world position `pos`; mass and momentum are interpolated first, then divided. */
vec2 referenceVelocity(vec2 pos, float domainSize, float momentumScale) {
    vec3 c = textureLod(textureReference, (pos + referenceOffset) / domainSize, 0.0).rgb;
    return c.x > 1e-4 ? c.yz / (c.x * momentumScale) : vec2(0.0);
}
