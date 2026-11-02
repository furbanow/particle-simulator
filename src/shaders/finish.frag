// Vignette and film grain, in linear HDR before tone mapping.
uniform sampler2D tDiffuse;
uniform float aspect;
uniform float time;
varying vec2 vUv;

const float VIGNETTE = 0.55;
const float GRAIN = 0.12;           // multiplicative: black stays black

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    vec2 c = (vUv - 0.5) * vec2(aspect, 1.0);
    col *= mix(1.0, smoothstep(1.1, 0.25, length(c)), VIGNETTE);
    col *= 1.0 + (hash(gl_FragCoord.xy + fract(time) * 100.0) - 0.5) * GRAIN;
    gl_FragColor = vec4(col, 1.0);
}
