// Cloud-in-cell deposit of the particles on the protostar grid: each particle covers the 2x2
// nearest cells with bilinear weights. DEPOSIT_MOMENTS: (m, m vx, m vy, m |v|^2). Otherwise
// (fusion power): (m * expected fusions per s * energy per unit mass, expected fusions per s).
// Defines: MAX_SPECIES, GRID_RES, DEPOSIT_MOMENTS. Masses in units of the mean particle mass.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float speciesSplatMass[MAX_SPECIES];
uniform float depositMassScale;
uniform float depositVelScale;
attribute vec2 reference;
varying vec2 vCell;
varying vec4 vValue;

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    vCell = vec2(0.0);
    vValue = vec4(0.0);
    gl_PointSize = 2.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);             // outside the clip volume: dropped
    if (posData.w < 0.0) return;                        // removed particle
    int k = clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1);
    float m = speciesSplatMass[k] * depositMassScale;
#if DEPOSIT_MOMENTS
    vec2 v = texture2D(textureVelocity, reference).xy * depositVelScale;
    vValue = vec4(m, m * v, m * dot(v, v));
#else
    float rate = fusionRateOf(k, gasAt(posData.xy));
    if (rate <= 0.0) return;
    vValue = vec4(m * rate * reactionEnergy[k], rate, 0.0, 0.0);
#endif
    vec2 p = posData.xy / gridCell;
    vCell = p;
    vec2 c = floor(p - 0.5) + 1.0;
    gl_Position = vec4(c / float(GRID_RES) * 2.0 - 1.0, 0.0, 1.0);
}
