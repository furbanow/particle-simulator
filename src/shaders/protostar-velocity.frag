// GPGPU velocity step of the protostar algorithm (velocity Verlet: the half kick of the previous step
// and the first of this one), then the local cooling, the fusion heating and the walls. Velocity:
// (vx, vy, 0, glow). The pass declares its own state samplers (bound by GpuPipeline); textureAccel
// holds each particle's acceleration of the previous step (z = 1 on the first step of a run: see
// below). The twin of the integration is leapfrog.ts. Defines: MAX_SPECIES, GRID_RES, GLOW_*.
// Provided: resolution.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D textureAccel;
uniform vec2 screenSize;
uniform float dt;
uniform float dtPrev;                   // s, the previous substep's length: the two half kicks of v(t) belong to that step (the time step may change)
uniform float activeCount;
uniform float coolingRate;              // 1/s
uniform float opacityDensity;           // rho / rho0 above which the gas traps its heat
uniform float maxSpeed;                 // px/s
uniform float heatingTFloor;            // px^2/s^2: below this dispersion a cell is heated by a random kick, not by scaling
uniform float restitution;

/**
 * The share of the step, from 0 to 1, at which a particle that goes from x (inside the area) to next reaches a wall of the axis
 * [0, size]; -1 when next is inside. Twin: wallHit() in leapfrog.ts. The position pass mirrors the same particles.
 */
float wallHit(float x, float next, float size) {
    if (next < 0.0) return clamp(x / (x - next), 0.0, 1.0);
    if (next > size) return clamp((size - x) / (next - x), 0.0, 1.0);
    return -1.0;
}

/**
 * The velocity stored for an axis that bounced (twin: bounceVelocity() in leapfrog.ts): the particle reaches the wall with
 * v + a hit dt, leaves it with restitution times that reversed, and is pulled by a for the rest of the step; the next step adds its two
 * half kicks (a and the next a, taken equal, over this step's dt: its dtPrev) to what is stored here.
 */
float bounced(float v, float a, float hit) {
    return -restitution * (v + a * hit * dt) - a * hit * dt;
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 vel = texture2D(textureVelocity, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount) { gl_FragColor = vel; return; }
    vec4 pos = texture2D(texturePosition, uv);

    // Velocity Verlet: v(t) = v(t - dtPrev) + (a(t - dtPrev) + a(t)) dtPrev / 2, the second half kick of the last
    // step and the first of this one (both over the last step's length: the step may have changed since);
    // the position pass moves the particle to x + v(t) dt + a(t) dt^2 / 2
    // from the same inputs (the same expression: both must see the same `next`). On the first step of a
    // run the velocity stored is v(t) itself and nothing is owed (textureAccel.z = 1).
    vec4 accelState = texture2D(textureAccel, uv);
    vec2 a = forceAt(pos.xy);
    vec2 kicked = vel.xy + (1.0 - accelState.z) * 0.5 * (accelState.xy + a) * dtPrev;
    vec2 next = pos.xy + kicked * dt + 0.5 * a * dt * dt;
    vec2 v = kicked;

    // Radiative cooling: only the disordered part of the motion (around the local mean
    // velocity) is damped; rotation and infall are kept. Dense gas is opaque: it radiates
    // less and keeps the heat of its compression. The cooling and the heating below work on
    // the kinetic dispersion gas.t, the energy of the disordered motion, not on the temperature
    // (which has the molecular weight in it): the energy bookkeeping does not depend on what the gas is made of.
    Gas gas = gasAt(pos.xy);
    float cooling = coolingRate / (1.0 + gas.rho / opacityDensity);
    float damping = exp(-cooling * dt);
    if (gas.rho > 0.0) v = gas.v + (v - gas.v) * damping;

    // Fusion feedback: the heating adds q dt of kinetic energy per unit mass, that is 2 q dt to
    // |v|^2 (twin and derivation: heating.ts). The deviations from the local mean velocity u are
    // scaled by sqrt(1 + 2 q dt / T), T being the dispersion |v - u|^2 of the neighborhood (left
    // after the cooling, which scaled it by damping^2): the dispersion grows by exactly that
    // energy, the mean velocity (the momentum) does not move and no noise is added. A cell too
    // cold for that (T near 0: nothing to scale) gets the same energy as a kick in a random
    // direction. The speed limit also bounds the energy: q can be infinite on half-float grids,
    // where the deposit can saturate.
    float q = gas.heat * fusionTRef;
    if (q > 0.0) {
        float energy = min(2.0 * q * dt, maxSpeed * maxSpeed);
        float dispersion = gas.t * damping * damping;
        if (dispersion > heatingTFloor) {
            v = gas.v + (v - gas.v) * sqrt(1.0 + energy / dispersion);
        } else {
            float angle = 6.2831853 * random01(index, 2u);
            v += sqrt(energy) * vec2(cos(angle), sin(angle));
        }
    }

    float s = length(v);
    if (s > maxSpeed) v *= maxSpeed / s;

    // Walls: a particle whose step ends outside the area bounces (the position pass mirrors it).
    float hitX = wallHit(pos.x, next.x, screenSize.x);
    float hitY = wallHit(pos.y, next.y, screenSize.y);
    if (hitX >= 0.0) v.x = bounced(v.x, a.x, hitX);
    if (hitY >= 0.0) v.y = bounced(v.y, a.y, hitY);

    // Glow read by the particle layer: hot gas shines, fusing gas flares. Hot is the temperature
    // (the dispersion times mu / mu_H: a helium gas shines at a lower dispersion than a hydrogen one).
    float glow = GLOW_TEMPERATURE * smoothstep(GLOW_T_MIN, GLOW_T_MAX, gas.mu * gas.t / fusionTRef)
               + GLOW_FUSION * smoothstep(0.0, GLOW_HEATING_REF, gas.heat);
    gl_FragColor = vec4(v, 0.0, min(glow, GLOW_MAX));
}
