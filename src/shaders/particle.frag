uniform float alpha;
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;

void main() {
    vec2 p = gl_PointCoord - 0.5;
    p.y = -p.y;                          // gl_PointCoord y points down, simulation y up
    // Ellipse with semi-axes 0.5 along the velocity and 0.5 / stretch across it.
    vec2 q = vec2(dot(p, vDir), dot(p, vec2(-vDir.y, vDir.x)) * vStretch);
    float d = length(q);
    if (d > 0.5) discard;
    // Streaks spread their light over a longer area: dim them (not fully, so they still read).
    float a = alpha * (1.0 - smoothstep(0.2, 0.5, d)) * pow(vStretch, -0.7);
    gl_FragColor = vec4(vColor * a, 1.0);
}
