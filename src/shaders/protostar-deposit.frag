varying vec2 vCell;
varying vec4 vValue;

void main() {
    vec2 w = max(1.0 - abs(gl_FragCoord.xy - vCell), 0.0);
    gl_FragColor = vValue * (w.x * w.y);
}
