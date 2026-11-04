// GPGPU position step of the protostar algorithm (velocity Verlet drift) and the fusions: a
// fusing particle becomes its reaction's type with probability reactionKeep, else it is removed
// (w = REMOVED_W). Provided by GPUComputationRenderer: resolution, texturePosition,
// textureVelocity, textureAccel. Defines: MAX_SPECIES, GRID_RES, REMOVED_W.
uniform float dt;
uniform vec2 screenSize;
uniform float activeCount;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount || pos.w < 0.0) { gl_FragColor = pos; return; }

    vec2 v = texture2D(textureVelocity, uv).xy;
    vec2 aPrev = texture2D(textureAccel, uv).xy;
    vec2 a = forceAt(pos.xy);
    vec2 next = pos.xy + (v + 0.5 * (aPrev + a) * dt) * dt + 0.5 * a * dt * dt;

    float type = pos.z;
    float w = pos.w;
    int k = clamp(int(type + 0.5), 0, MAX_SPECIES - 1);
    if (reactionTo[k] >= 0.0) {
        float p = 1.0 - exp(-fusionRateOf(k, gasAt(pos.xy)) * dt);
        if (random01(index, 0u) < p) {
            if (random01(index, 1u) < reactionKeep[k]) type = reactionTo[k];
            else w = REMOVED_W;
        }
    }
    gl_FragColor = vec4(clamp(next, vec2(0.0), screenSize), type, w);
}
