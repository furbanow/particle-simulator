// The kernel of the particle deposits (protostar-deposit.*, splat.*), drawn as point sprites with additive blending: each particle
// covers a few texels around its position p (in texels: texel i spans [i, i + 1), its center is i + 0.5) and adds its value
// times the weight of each texel. Defines: DEPOSIT_TSC.
//  0  cloud-in-cell (CIC): the 2x2 nearest texels, bilinear weights, a sprite of 2 texels centered on the nearest texel corner;
//  1  triangular-shaped cloud (TSC): the 3x3 texels around the one that holds p, quadratic weights (Hockney & Eastwood), a sprite
//     of 3 texels centered on that texel's center. Smoother (its transform falls as k^-6 instead of k^-4: less aliasing of the
//     sub-texel position, less grid noise), 2.25 times the fragments.
// The weights of every texel a particle covers sum to 1 in both. Twin: src/simulation/depositKernel.ts.

/** TSC weight of a texel whose center is d texels from the particle (both axes): also the protostar's matched force read. */
float tscWeight(vec2 d) {
    vec2 a = abs(d);
    vec2 far = 1.5 - a;
    vec2 w = mix(0.75 - a * a, 0.5 * far * far, step(0.5, a)) * step(a, vec2(1.5));
    return w.x * w.y;
}

#if DEPOSIT_TSC
const float DEPOSIT_POINT_SIZE = 3.0;
vec2 depositCenter(vec2 p) { return floor(p) + 0.5; }
float depositWeight(vec2 d) { return tscWeight(d); }
#else
const float DEPOSIT_POINT_SIZE = 2.0;
vec2 depositCenter(vec2 p) { return floor(p - 0.5) + 1.0; }
float depositWeight(vec2 d) {
    vec2 w = max(1.0 - abs(d), 0.0);
    return w.x * w.y;
}
#endif
