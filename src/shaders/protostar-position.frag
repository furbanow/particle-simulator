// GPGPU position step of the protostar algorithm (velocity Verlet drift, walls) and the fusions: a
// fusing particle becomes its reaction's type with probability reactionKeep, else it is removed
// (w = REMOVED_W). Provided by GPUComputationRenderer: resolution, texturePosition,
// textureVelocity, textureAccel. Defines: MAX_SPECIES, GRID_RES, REMOVED_W. The twin of the
// integration is leapfrog.ts.
uniform float dt;
uniform float dtPrev;                   // s, the previous substep's length (see protostar-velocity.frag)
uniform vec2 screenSize;
uniform float activeCount;

/** x reflected once about the walls 0 and size (the mirror image), held inside if it went further. Twin: mirror() in leapfrog.ts. */
float mirrored(float x, float size) {
    return clamp(x < 0.0 ? -x : (x > size ? 2.0 * size - x : x), 0.0, size);
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount || pos.w < 0.0) { gl_FragColor = pos; return; }

    // The same expression as the velocity pass (v(t) = v(t - dtPrev) + (a(t - dtPrev) + a(t)) dtPrev / 2, nothing owed on the first step: z = 1):
    // the two passes must agree on which particles leave the area.
    vec2 vel = texture2D(textureVelocity, uv).xy;
    vec4 accelState = texture2D(textureAccel, uv);
    vec2 a = forceAt(pos.xy);
    vec2 kicked = vel + (1.0 - accelState.z) * 0.5 * (accelState.xy + a) * dtPrev;
    vec2 next = pos.xy + kicked * dt + 0.5 * a * dt * dt;

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
    gl_FragColor = vec4(mirrored(next.x, screenSize.x), mirrored(next.y, screenSize.y), type, w);
}
