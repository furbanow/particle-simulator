// Particles heat toward warm white (HDR, so the bloom catches them) and stretch into an
// ellipse along their velocity: the streak covers the distance travelled during
// stretchAmount frames.
// Defines: MAX_SPECIES, HEAT_SPEED_MIN, HEAT_SPEED_MAX, MAX_STRETCH.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform vec2 screenSize;
uniform float pixelRatio;
uniform float speciesSize[MAX_SPECIES];
uniform vec3 speciesColor[MAX_SPECIES];
uniform float heatAmount;
uniform float stretchAmount;
uniform float frameDt;                  // simulated seconds per rendered frame
attribute vec2 reference;
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;

const vec3 HOT = vec3(1.0, 0.88, 0.72);

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    vec2 vel = texture2D(textureVelocity, reference).xy;
    int species = clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1);
    float size = speciesSize[species];
    float speed = length(vel);

    float heat = smoothstep(HEAT_SPEED_MIN, HEAT_SPEED_MAX, speed) * heatAmount;
    vColor = mix(speciesColor[species], HOT, clamp(heat, 0.0, 1.0) * 0.85) * (1.0 + 2.5 * heat);

    vStretch = clamp(1.0 + stretchAmount * speed * frameDt / size, 1.0, MAX_STRETCH);
    vDir = speed > 1e-3 ? vel / speed : vec2(1.0, 0.0);

    gl_Position = vec4(posData.xy / screenSize * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = size * vStretch * pixelRatio;
}
