// GPGPU position step of the protostar algorithm (velocity Verlet drift, walls) and the fusions: a particle is a parcel of
// constant mass, and a fusing parcel changes its type (A4), keeping its mass and its velocity (the momentum is conserved
// exactly; the mass defect leaves as energy through the heating, see protostar-deposit.vert). Provided by
// GPUComputationRenderer: resolution, texturePosition, textureVelocity, textureAccel. Defines: MAX_SPECIES, GRID_RES. The twin of
// the integration is leapfrog.ts, that of the fusion reactions.ts (fusionProbability).
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
    if (index >= activeCount) { gl_FragColor = pos; return; }

    // The same expression as the velocity pass (v(t) = v(t - dtPrev) + (a(t - dtPrev) + a(t)) dtPrev / 2, nothing owed on the first step: z = 1):
    // the two passes must agree on which particles leave the area.
    vec2 vel = texture2D(textureVelocity, uv).xy;
    vec4 accelState = texture2D(textureAccel, uv);
    vec2 a = forceAt(pos.xy);
    vec2 kick = (1.0 - accelState.z) * 0.5 * (accelState.xy + a) * dtPrev;
    vec2 kicked = vel + kick;
    // The collision of the gas (C1), as the velocity pass turns v(t).
    if (collisionsOn > 0.5) kicked = collide(kicked, collisionAt(pos.xy, dtPrev));
    vec2 next = pos.xy + kicked * dt + 0.5 * a * dt * dt;

    // The whole parcel fuses with probability 1 - exp(-rate dt), the share of the fuel that fuses in a step: the expected mass that
    // changes type per step is p m, and the power the heating deposits is m rate energy (protostar-deposit.vert): the same in expectation.
    float type = pos.z;
    int k = clamp(int(type + 0.5), 0, MAX_SPECIES - 1);
    if (reactionTo[k] >= 0.0) {
        float p = 1.0 - exp(-fusionRateOf(k, gasAt(pos.xy)) * dt);
        if (random01(index, 0u) < p) type = reactionTo[k];
    }
    gl_FragColor = vec4(mirrored(next.x, screenSize.x), mirrored(next.y, screenSize.y), type, pos.w);
}
