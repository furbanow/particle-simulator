// The kernel's weights come from deposit-kernel.glsl (included before). Defines: DEPOSIT_TSC, DEPOSIT_KIND and the values of the kinds (see protostar-deposit.vert).
varying vec2 vCell;
varying vec4 vValue;
#if DEPOSIT_KIND == DEPOSIT_MOMENTS_AND_COMPOSITION
varying vec4 vValue2;
layout(location = 1) out highp vec4 outComposition;     // attachment 1 (attachment 0 is gl_FragColor)
#endif

void main() {
    float weight = depositWeight(gl_FragCoord.xy - vCell);
    gl_FragColor = vValue * weight;
#if DEPOSIT_KIND == DEPOSIT_MOMENTS_AND_COMPOSITION
    outComposition = vValue2 * weight;
#endif
}
