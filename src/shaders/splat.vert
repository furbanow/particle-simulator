// Cloud-in-cell splat: each particle covers the 2x2 nearest density texels with bilinear weights.
// Defines: MAX_SPECIES.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform vec2 domainOffset;
uniform float domainSize;
uniform float densityRes;
uniform float speciesSplatMass[MAX_SPECIES];
attribute vec2 reference;
varying vec2 vCell;
varying vec2 vVel;
varying float vMass;

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    if (posData.w < 0.0) {                              // removed particle
        vCell = vec2(0.0); vVel = vec2(0.0); vMass = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        return;
    }
    vMass = speciesSplatMass[clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1)];
    vec2 p = (posData.xy + domainOffset) / domainSize * densityRes;
    vCell = p;
    vVel = texture2D(textureVelocity, reference).xy;
    vec2 c = floor(p - 0.5) + 1.0;
    gl_Position = vec4(c / densityRes * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 2.0;
}
