// The collision deposit's one texel per particle (protostar-collision.vert): its sums (1, v, |v|^2), added by the blending.
varying vec4 vValue;

void main() {
    gl_FragColor = vValue;
}
