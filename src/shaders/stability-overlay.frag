// Colours of the stability map (A12; the map is (Q, beta, rho / rho0, kappa^2) per cell, protostar-stability.frag). Cells lighter than
// MIN_DENSITY are left out. Fragmentation: red where Q < Q_CRITICAL and beta < BETA_CRITICAL (the disc fragments), orange where only Q is
// below its threshold, blue where only beta is. Toomre and cooling: the value against its threshold, red below and blue above, the tint
// growing over LOG_RANGE decades. Each cell's colour is decided on its own values, then the colours of the four nearest cells are blended
// bilinearly (not the values: a Q interpolated across an empty cell, or across the threshold, would draw what no cell holds).
// Defines: MODE_FRAGMENTATION, MODE_TOOMRE, Q_CRITICAL, BETA_CRITICAL, MIN_DENSITY, LOG_RANGE, OPACITY, PARTIAL.
uniform sampler2D map;
uniform float mode;
varying vec2 vUv;

const vec3 UNSTABLE = vec3(1.0, 0.16, 0.1);
const vec3 GRAVITY_ONLY = vec3(1.0, 0.62, 0.12);
const vec3 STABLE = vec3(0.25, 0.55, 1.0);

/** The tint of one cell, premultiplied (rgb * alpha, alpha). */
vec4 tint(vec4 cell) {
    if (cell.z < MIN_DENSITY) return vec4(0.0);
    if (mode == MODE_FRAGMENTATION) {
        bool gravity = cell.x < Q_CRITICAL;
        bool cooling = cell.y < BETA_CRITICAL;
        if (gravity && cooling) return vec4(UNSTABLE * OPACITY, OPACITY);
        if (gravity) return vec4(GRAVITY_ONLY, 1.0) * (OPACITY * PARTIAL);
        if (cooling) return vec4(STABLE, 1.0) * (OPACITY * PARTIAL);
        return vec4(0.0);
    }
    float ratio = mode == MODE_TOOMRE ? cell.x / Q_CRITICAL : cell.y / BETA_CRITICAL;
    float x = clamp(log(max(ratio, 1e-30)) / (log(10.0) * LOG_RANGE), -1.0, 1.0);
    return x < 0.0 ? vec4(UNSTABLE, 1.0) * (-x * OPACITY) : vec4(STABLE, 1.0) * (x * OPACITY);
}

void main() {
    ivec2 size = textureSize(map, 0);
    vec2 p = vUv * vec2(size) - 0.5;
    vec2 f = fract(p);
    ivec2 i0 = ivec2(floor(p));
    ivec2 hi = size - 1;
    vec4 a = tint(texelFetch(map, clamp(i0, ivec2(0), hi), 0));
    vec4 b = tint(texelFetch(map, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0));
    vec4 c = tint(texelFetch(map, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0));
    vec4 d = tint(texelFetch(map, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0));
    vec4 color = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    if (color.a <= 0.0) discard;
    gl_FragColor = vec4(color.rgb / color.a, color.a);
}
