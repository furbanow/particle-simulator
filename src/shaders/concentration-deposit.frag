// Fragment of concentration-deposit.vert: writes the value the vertex computed (additive blending sums them).
varying vec4 vValue;

void main() {
    gl_FragColor = vValue;
}
