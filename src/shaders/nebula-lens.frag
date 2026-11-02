// Bends the particle image toward clumps (gradient of the nebula mass channel), with a slight
// RGB split where the bending is strong, then adds the blurred colored gas behind it.
uniform sampler2D tDiffuse;
uniform sampler2D tNebula;
uniform vec2 nebulaTexel;
uniform float aspect;
uniform float time;
uniform float nebulaIntensity;
uniform float lensStrength;
varying vec2 vUv;

// Mass per nebula texel is ~0.5 for a uniform spread and ~5-10 inside clumps: the floor
// keeps the uniform spread dark so only aggregates glow.
const float NEB_FLOOR = 0.5;
const float NEB_K = 0.18;           // mass -> glow saturation
const float NEB_GAIN = 0.3;
const float NEB_SATURATION = 1.7;   // mixed species average toward grey: push hue back
const float LENS_SCALE = 0.005;     // in screen-height units
const float LENS_SOFT = 0.4;
const float PARTICLE_PEAK = 1.2;    // asymptotic max of the particle layer

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}

float lensMass(vec2 uv) {
    return textureLod(tNebula, uv, 3.0).a + 0.5 * textureLod(tNebula, uv, 4.5).a;
}

void main() {
    vec2 uv = vUv;

    // ---- Lens ----
    vec3 col;
    if (lensStrength > 0.0) {
        vec2 e = nebulaTexel * 8.0;
        vec2 g = vec2(lensMass(uv + vec2(e.x, 0.0)) - lensMass(uv - vec2(e.x, 0.0)),
                      lensMass(uv + vec2(0.0, e.y)) - lensMass(uv - vec2(0.0, e.y)));
        vec2 off = lensStrength * LENS_SCALE * g / (1.0 + LENS_SOFT * length(g));
        off.x /= aspect;
        col = vec3(texture2D(tDiffuse, uv + off * 1.15).r,
                   texture2D(tDiffuse, uv + off).g,
                   texture2D(tDiffuse, uv + off * 0.85).b);
    } else {
        col = texture2D(tDiffuse, uv).rgb;
    }

    // Thousands of additive particles pile up in clump cores: compress the peak channel
    // (hue-preserving, linear for faint pixels) so cores keep their species color
    // instead of clipping to a flat white disc.
    float peak = max(max(col.r, col.g), col.b);
    col *= PARTICLE_PEAK * (1.0 - exp(-peak / PARTICLE_PEAK)) / max(peak, 1e-4);

    // ---- Nebula ----
    if (nebulaIntensity > 0.0) {
        vec4 neb = textureLod(tNebula, uv, 1.0) * 0.10
                 + textureLod(tNebula, uv, 2.0) * 0.20
                 + textureLod(tNebula, uv, 3.0) * 0.30
                 + textureLod(tNebula, uv, 4.0) * 0.25
                 + textureLod(tNebula, uv, 5.0) * 0.15;
        vec3 hue = neb.rgb / max(neb.a, 1e-4);   // mass-weighted mean species color
        float lum = dot(hue, vec3(0.2126, 0.7152, 0.0722));
        hue = max(mix(vec3(lum), hue, NEB_SATURATION), 0.0);
        float glow = 1.0 - exp(-NEB_K * max(neb.a - NEB_FLOOR, 0.0));
        glow *= glow;

        // Slowly drifting, domain-warped fbm gives the gas its wisps.
        vec2 p = vec2(uv.x * aspect, uv.y) * 3.0;
        vec2 warp = vec2(fbm(p + time * 0.03), fbm(p + 5.2 - time * 0.025));
        float n = fbm(p + 1.8 * warp + time * 0.015);
        float wisps = mix(1.0, 0.25 + 1.5 * n, 0.85);

        col += hue * glow * wisps * NEB_GAIN * nebulaIntensity;
    }

    gl_FragColor = vec4(col, 1.0);
}
