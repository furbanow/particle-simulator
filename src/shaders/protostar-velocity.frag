// GPGPU velocity step of the protostar algorithm (velocity Verlet, second half kick), then the
// local cooling and the fusion heating. Velocity: (vx, vy, 0, glow). The pass declares its own
// state samplers (bound by GpuPipeline); textureAccel holds each particle's acceleration of the
// previous step. Defines: MAX_SPECIES, GRID_RES, GLOW_*. Provided: resolution.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D textureAccel;
uniform vec2 screenSize;
uniform float dt;
uniform float activeCount;
uniform float coolingRate;              // 1/s
uniform float opacityDensity;           // rho / rho0 above which the gas traps its heat
uniform float maxSpeed;                 // px/s
uniform float heatingTFloor;            // px^2/s^2: below this dispersion a cell is heated by a random kick, not by scaling
uniform float restitution;
uniform vec2 driftKick;                 // px/s, velocity taken off every particle (statistical drift)

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 vel = texture2D(textureVelocity, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount) { gl_FragColor = vel; return; }
    vec4 pos = texture2D(texturePosition, uv);
    if (pos.w < 0.0) { gl_FragColor = vec4(0.0); return; }

    // Velocity Verlet: v(t) = v(t - dt) + (a(t - dt) + a(t)) dt / 2; the position pass moves the
    // particle by v(t) dt + a(t) dt^2 / 2 from the same inputs.
    vec2 aPrev = texture2D(textureAccel, uv).xy;
    vec2 a = forceAt(pos.xy);
    vec2 v = vel.xy + 0.5 * (aPrev + a) * dt - driftKick;
    vec2 next = pos.xy + v * dt + 0.5 * a * dt * dt;

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
    if ((next.x < 0.0 && v.x < 0.0) || (next.x > screenSize.x && v.x > 0.0)) v.x = -v.x * restitution;
    if ((next.y < 0.0 && v.y < 0.0) || (next.y > screenSize.y && v.y > 0.0)) v.y = -v.y * restitution;

    // Glow read by the particle layer: hot gas shines, fusing gas flares. Hot is the temperature
    // (the dispersion times mu / mu_H: a helium gas shines at a lower dispersion than a hydrogen one).
    float glow = GLOW_TEMPERATURE * smoothstep(GLOW_T_MIN, GLOW_T_MAX, gas.mu * gas.t / fusionTRef)
               + GLOW_FUSION * smoothstep(0.0, GLOW_HEATING_REF, gas.heat);
    gl_FragColor = vec4(v, 0.0, min(glow, GLOW_MAX));
}
