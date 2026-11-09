// Static dark matter (DarkMatterField): its pull on a particle, shared by every algorithm's velocity
// shader. darkMatterForce holds the field per unit gain at the cell centers of a DARK_MATTER_RES^2
// grid of square cells over max(width, height), from the origin. Defines: DARK_MATTER_RES.
uniform sampler2D darkMatterForce;
uniform float darkMatterCell;           // cell size, px
uniform float darkMatterGain;           // px/s^2 per unit of the field; 0 without dark matter

/** Acceleration (px/s^2) the dark matter gives at x, interpolated bilinearly between cell centers. */
vec2 darkMatterAccel(vec2 x) {
    if (darkMatterGain == 0.0) return vec2(0.0);
    vec2 p = x / darkMatterCell - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    ivec2 i0 = ivec2(i);
    ivec2 hi = ivec2(DARK_MATTER_RES - 1);
    vec2 a00 = texelFetch(darkMatterForce, clamp(i0, ivec2(0), hi), 0).xy;
    vec2 a10 = texelFetch(darkMatterForce, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0).xy;
    vec2 a01 = texelFetch(darkMatterForce, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0).xy;
    vec2 a11 = texelFetch(darkMatterForce, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0).xy;
    return darkMatterGain * mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
}
