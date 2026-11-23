// GPGPU velocity step of the protostar algorithm: the collision of the gas (C1, the `collisions` flag), velocity Verlet (the half kick of
// the previous step and the first of this one), then the radiative cooling, the Jeans floor, the fusion heating and the walls. Velocity:
// (vx, vy, 0, glow). The pass declares its own state samplers (bound by GpuPipeline); textureAccel
// holds each particle's acceleration of the previous step (z = 1 on the first step of a run: see
// below). The twin of the integration is leapfrog.ts, of the cooling and the Jeans floor cooling.ts, of the heating heating.ts, of the
// collisions collisions.ts.
// Defines: MAX_SPECIES, GRID_RES, GLOW_*.
// Provided: resolution.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D textureAccel;
uniform vec2 screenSize;
uniform float dt;
uniform float dtPrev;                   // s, the previous substep's length: the two half kicks of v(t) belong to that step (the time step may change)
uniform float activeCount;
uniform float radiation;                // c, 1/s: dT/dt = -c mu T^4 / (Sigma tau_eff), T in T0 and Sigma in rho0; 0: no cooling
uniform float opacityKappa;             // kappa, per rho0: the optical depth from the mid-plane to a face is kappa Sigma / 2
uniform float minTemperature;           // T0: the cooling stops at this temperature
uniform float jeansPerDensity;          // px^2/s^2: the Jeans floor of the dispersion is this times rho / rho0 (2 N_J dx G rho0); 0: no floor
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
    vec2 kick = (1.0 - accelState.z) * 0.5 * (accelState.xy + a) * dtPrev;

    // Collision of the gas (C1, twin collisions.ts): the state read here, x(t) and v(t - dtPrev), is the one after the drift of the
    // step that ended, and the collision deposit of this substep summed exactly these particles. The cell of the shifted grid turns
    // the velocities relative to its mean by +-the angle (with probability 1 - exp(-nu dtPrev): dtPrev is the time since the last
    // collision), which keeps its momentum and energy. The position pass turns the velocity the same way for the drift.
    bool collides = collisionsOn > 0.5;
    Collision cell = Collision(vec2(0.0), 0.0, 0.0);
    if (collides) cell = collisionAt(pos.xy, dtPrev);
    vec2 kicked = (collides ? collide(vel.xy, cell) : vel.xy) + kick;
    vec2 next = pos.xy + kicked * dt + 0.5 * a * dt * dt;
    vec2 v = kicked;
    // What the cooling, the Jeans floor and the heating scale the velocities about, and the dispersion they scale. Without the
    // collisions, the mean velocity and the dispersion of the 3x3 neighborhood. With them, those of the particle's collision cell
    // before the kicks (the kick is added back), which makes every scaling keep the cell's momentum exactly and change its energy
    // by exactly what the law says; the laws themselves still read the neighborhood's temperature.
    Gas gas = gasAt(pos.xy);
    vec2 center = collides ? cell.u + kick : gas.v;
    float dispersion = collides ? cell.t : gas.t;

    // Radiative cooling of a thin disc (A6, twin and derivation: cooling.ts): a column of surface density Sigma radiates through the
    // effective optical depth tau_eff = 3 tau / 8 + sqrt(3) / 4 + 1 / (4 tau), tau = kappa Sigma / 2, so that dT/dt = -c mu T^4 / (Sigma tau_eff),
    // integrated exactly over the step (unconditionally stable) down to the floor T_min. Only the disordered part of the motion (around
    // the local mean velocity) loses energy: its deviations are scaled by sqrt(T' / T); rotation and infall are kept. The radiation goes
    // as the temperature mu t (T0 units), the energy per unit mass as the dispersion t: that is what the heating below and the floor work on.
    if (gas.rho > 0.0 && radiation > 0.0 && opacityKappa > 0.0 && gas.t > 0.0) {
        float temperature = gas.mu * gas.t / fusionTRef;
        if (temperature > minTemperature) {
            // Sigma tau_eff, finite when Sigma goes to 0 (the optically thin limit).
            float column = 0.1875 * opacityKappa * gas.rho * gas.rho + 0.4330127 * gas.rho + 0.5 / opacityKappa;
            float x = 3.0 * radiation * gas.mu * temperature * temperature * temperature * dt / column;
            float ratio = max(pow(1.0 + x, -1.0 / 3.0), minTemperature / temperature);
            v = center + (v - center) * sqrt(ratio);
            dispersion *= ratio;
        }
    }

    // Jeans floor (A13, the `jeansFloor` flag): the Jeans length of the sheet, dispersion / (2 G Sigma), is kept at N_J cells or more by
    // raising the dispersion to t_J = 2 N_J dx G Sigma, by scaling as the heating does (a cold cell, with nothing to scale, by a kick).
    float jeans = jeansPerDensity * gas.rho;
    if (jeans > dispersion) {
        if (dispersion > heatingTFloor) {
            v = center + (v - center) * sqrt(jeans / dispersion);
        } else {
            float angle = 6.2831853 * random01(index, 3u);
            v += sqrt(jeans - dispersion) * vec2(cos(angle), sin(angle));
        }
        dispersion = jeans;
    }

    // Fusion feedback: the heating adds q dt of kinetic energy per unit mass, that is 2 q dt to
    // |v|^2 (twin and derivation: heating.ts). The deviations from the local mean velocity u are
    // scaled by sqrt(1 + 2 q dt / T), T being the dispersion |v - u|^2 of the neighborhood (of the collision cell with the collisions; left
    // after the cooling and the Jeans floor): the dispersion grows by exactly that
    // energy, the mean velocity (the momentum) does not move and no noise is added. A cell too
    // cold for that (T near 0: nothing to scale) gets the same energy as a kick in a random
    // direction. The speed limit also bounds the energy: q can be infinite on half-float grids,
    // where the deposit can saturate.
    float q = gas.heat * fusionTRef;
    if (q > 0.0) {
        float energy = min(2.0 * q * dt, maxSpeed * maxSpeed);
        if (dispersion > heatingTFloor) {
            v = center + (v - center) * sqrt(1.0 + energy / dispersion);
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
