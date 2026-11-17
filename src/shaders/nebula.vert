// Nebula splat: each particle drops (color x mass, mass) into one texel of a low-res target.
// Defines: MAX_SPECIES.
uniform sampler2D texturePosition;
uniform vec2 screenSize;
uniform float viewZoom;
uniform vec2 viewCenter;
uniform float speciesSplatMass[MAX_SPECIES];
uniform vec3 speciesColor[MAX_SPECIES];
attribute vec2 reference;
varying vec4 vValue;

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    if (posData.w < 0.0) {                              // removed particle
        vValue = vec4(0.0);
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        return;
    }
    int species = clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1);
    float m = speciesSplatMass[species];
    vValue = vec4(speciesColor[species] * m, m);
    gl_Position = vec4((posData.xy - viewCenter) * viewZoom / screenSize * 2.0, 0.0, 1.0);
    gl_PointSize = 1.0;
}
