// The weights of the kernel come from deposit-kernel.glsl (included before).
uniform float momentumScale;
varying vec2 vCell;
varying vec2 vVel;
varying float vMass;
varying float vEnergy;

void main() {
    float m = vMass * depositWeight(gl_FragCoord.xy - vCell);
    gl_FragColor = vec4(m, m * vVel * momentumScale, m * vEnergy);
}
