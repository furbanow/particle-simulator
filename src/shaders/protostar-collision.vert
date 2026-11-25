// Collision deposit of the protostar's gas (C1, the `collisions` flag): every particle adds (1, v, |v|^2) to the cell of the shifted
// collision grid that holds it (nearest grid point: one texel per particle, so a cell's sums are exactly those of its particles), with
// the velocities in L/s (collisionVelScale) to stay in the range of half floats. The velocity and the position passes read the cell's
// mean velocity and dispersion back (collisionAt() of protostar-common.glsl). Twin: collisionStep() in collisions.ts.
// v is the velocity at the instant of the positions, v(t) = v(t - dtPrev) + (a(t - dtPrev) + a(t)) dtPrev / 2: the velocity texture
// lags the positions by one substep (leapfrog.ts), and the collision turns the velocities of one instant. The same expression as the
// velocity pass, which is why the deposit is drawn after the gravity grid of the substep.
// Defines: COLLISION_RES. Included after protostar-common.glsl (collisionCellOf, forceAt).
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D textureAccel;        // (a(t - dtPrev), 1 on the first substep of a run: no half kick owed)
uniform float dtPrev;
attribute vec2 reference;
varying vec4 vValue;

void main() {
    vec2 p = texture2D(texturePosition, reference).xy;
    vec4 accelState = texture2D(textureAccel, reference);
    vec2 kick = (1.0 - accelState.z) * 0.5 * (accelState.xy + forceAt(p)) * dtPrev;
    vec2 v = (texture2D(textureVelocity, reference).xy + kick) * collisionVelScale;
    vValue = vec4(1.0, v, dot(v, v));
    vec2 c = vec2(collisionCellOf(p)) + 0.5;
    gl_PointSize = 1.0;
    gl_Position = vec4(c / float(COLLISION_RES) * 2.0 - 1.0, 0.0, 1.0);
}
