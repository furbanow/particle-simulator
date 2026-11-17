// Particles heat toward warm white (HDR, so the bloom catches them) and stretch into an
// ellipse along their velocity: the streak covers the distance travelled during
// stretchAmount frames. The heat comes from the speed, or from the model's glow (velocity w)
// when glowFromState is 1. Removed particles (negative position w) are not drawn.
// Defines: MAX_SPECIES, HEAT_SPEED_MIN, HEAT_SPEED_MAX, MAX_STRETCH.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform vec2 screenSize;
uniform float viewZoom;                 // visual zoom around viewCenter (world px)
uniform vec2 viewCenter;
uniform float pixelRatio;
uniform float speciesSize[MAX_SPECIES];
uniform vec3 speciesColor[MAX_SPECIES];
uniform float heatAmount;
uniform float stretchAmount;
uniform float frameDt;                  // simulated seconds per rendered frame
uniform float glowFromState;
attribute vec2 reference;
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;

const vec3 HOT = vec3(1.0, 0.88, 0.72);

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    if (posData.w < 0.0) {
        vColor = vec3(0.0); vDir = vec2(1.0, 0.0); vStretch = 1.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);         // outside the clip volume: dropped
        gl_PointSize = 0.0;
        return;
    }
    vec4 velData = texture2D(textureVelocity, reference);
    vec2 vel = velData.xy;
    int species = clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1);
    float size = speciesSize[species];
    float speed = length(vel);

    float heat = (glowFromState > 0.5 ? velData.w : smoothstep(HEAT_SPEED_MIN, HEAT_SPEED_MAX, speed)) * heatAmount;
    vColor = mix(speciesColor[species], HOT, clamp(heat, 0.0, 1.0) * 0.85) * (1.0 + 2.5 * heat);

    vStretch = clamp(1.0 + stretchAmount * speed * frameDt / size, 1.0, MAX_STRETCH);
    vDir = speed > 1e-3 ? vel / speed : vec2(1.0, 0.0);

    gl_Position = vec4((posData.xy - viewCenter) * viewZoom / screenSize * 2.0, 0.0, 1.0);
    gl_PointSize = size * vStretch * pixelRatio * viewZoom;
}
