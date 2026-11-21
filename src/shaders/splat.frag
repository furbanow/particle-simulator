uniform float momentumScale;
varying vec2 vCell;
varying vec2 vVel;
varying float vMass;
varying float vEnergy;

void main() {
    vec2 w = max(1.0 - abs(gl_FragCoord.xy - vCell), 0.0);
    float m = vMass * w.x * w.y;
    gl_FragColor = vec4(m, m * vVel * momentumScale, m * vEnergy);
}
