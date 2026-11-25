// GPGPU state variable of the protostar algorithm: each particle's gravitational acceleration at
// its current position, kept for the next velocity Verlet step. Provided by GPUComputationRenderer:
// resolution, texturePosition, textureVelocity, textureAccel. Defines: MAX_SPECIES, GRID_RES.
uniform float activeCount;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount) { gl_FragColor = vec4(0.0); return; }
    gl_FragColor = vec4(forceAt(pos.xy), 0.0, 0.0);
}
