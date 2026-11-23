// Colours of the stability map (A12; the map is (Q, beta, rho / rho0, kappa^2) per cell, protostar-stability.frag). Cells lighter than
// MIN_DENSITY are left out. Fragmentation: red where Q < Q_CRITICAL and beta < BETA_CRITICAL (the disc fragments), orange where only Q is
// below its threshold, blue where only beta is. Toomre and cooling: the value against its threshold, red below and blue above, the tint
// growing over LOG_RANGE decades.
// Defines: MODE_FRAGMENTATION, MODE_TOOMRE, Q_CRITICAL, BETA_CRITICAL, MIN_DENSITY, LOG_RANGE, OPACITY, PARTIAL.
uniform sampler2D map;
uniform float mode;
varying vec2 vUv;

const vec3 UNSTABLE = vec3(1.0, 0.16, 0.1);
const vec3 GRAVITY_ONLY = vec3(1.0, 0.62, 0.12);
const vec3 STABLE = vec3(0.25, 0.55, 1.0);

void main() {
    vec4 cell = texture2D(map, vUv);
    if (cell.z < MIN_DENSITY) discard;
    if (mode == MODE_FRAGMENTATION) {
        bool gravity = cell.x < Q_CRITICAL;
        bool cooling = cell.y < BETA_CRITICAL;
        if (gravity && cooling) gl_FragColor = vec4(UNSTABLE, OPACITY);
        else if (gravity) gl_FragColor = vec4(GRAVITY_ONLY, OPACITY * PARTIAL);
        else if (cooling) gl_FragColor = vec4(STABLE, OPACITY * PARTIAL);
        else discard;
        return;
    }
    float ratio = mode == MODE_TOOMRE ? cell.x / Q_CRITICAL : cell.y / BETA_CRITICAL;
    float x = clamp(log(max(ratio, 1e-30)) / (log(10.0) * LOG_RANGE), -1.0, 1.0);
    gl_FragColor = x < 0.0 ? vec4(UNSTABLE, -x * OPACITY) : vec4(STABLE, x * OPACITY);
}
