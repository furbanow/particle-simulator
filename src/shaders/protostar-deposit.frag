// Defines: DEPOSIT_KIND and the values of the kinds (see protostar-deposit.vert).
varying vec2 vCell;
varying vec4 vValue;
#if DEPOSIT_KIND == DEPOSIT_MOMENTS_AND_COMPOSITION
varying vec4 vValue2;
layout(location = 1) out highp vec4 outComposition;     // attachment 1 (attachment 0 is gl_FragColor)
#endif

void main() {
    vec2 w = max(1.0 - abs(gl_FragCoord.xy - vCell), 0.0);
    float weight = w.x * w.y;
    gl_FragColor = vValue * weight;
#if DEPOSIT_KIND == DEPOSIT_MOMENTS_AND_COMPOSITION
    outComposition = vValue2 * weight;
#endif
}
