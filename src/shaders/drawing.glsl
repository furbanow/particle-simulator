// The static drawings (DrawingField) and the point force held under the mouse: their pull on a
// particle, shared by every algorithm's velocity shader. drawingForce* hold the field per unit gain of each kind (attractor, repeller) at the cell
// centers of a DRAWING_RES^2 grid of square cells over max(width, height), from the origin.
// Defines: DRAWING_RES.
uniform sampler2D drawingForceAttractor;
uniform sampler2D drawingForceRepeller;
uniform float drawingCell;              // cell size, px
uniform float drawingGainAttractor;     // px/s^2 per unit of the field; 0 without an attractor
uniform float drawingGainRepeller;      // same, negative: the repeller pushes
uniform vec2 drawingPoint;              // the point force: where it is, px
uniform float drawingPointRadial;       // its pull per unit of r / (r^2 + eps^2)^(3/2) (negative: pushes); 0 without one
uniform float drawingPointSwirl;        // same, across r: counterclockwise when positive; 0 without one
uniform float drawingPointSoftening2;   // eps^2, px^2

/** Field of `field` at x, interpolated bilinearly between cell centers. */
vec2 drawingField(sampler2D field, vec2 x) {
    vec2 p = x / drawingCell - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    ivec2 i0 = ivec2(i);
    ivec2 hi = ivec2(DRAWING_RES - 1);
    vec2 a00 = texelFetch(field, clamp(i0, ivec2(0), hi), 0).xy;
    vec2 a10 = texelFetch(field, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0).xy;
    vec2 a01 = texelFetch(field, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0).xy;
    vec2 a11 = texelFetch(field, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0).xy;
    return mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
}

/** Acceleration (px/s^2) the drawings give at x: the attractors' pull, the repellers' push and the point force. */
vec2 drawingAccel(vec2 x) {
    vec2 a = vec2(0.0);
    if (drawingGainAttractor != 0.0) a += drawingGainAttractor * drawingField(drawingForceAttractor, x);
    if (drawingGainRepeller != 0.0) a += drawingGainRepeller * drawingField(drawingForceRepeller, x);
    if (drawingPointRadial != 0.0 || drawingPointSwirl != 0.0) {
        vec2 r = drawingPoint - x;
        float s = inversesqrt(dot(r, r) + drawingPointSoftening2);
        a += (drawingPointRadial * r + drawingPointSwirl * vec2(r.y, -r.x)) * (s * s * s);
    }
    return a;
}
