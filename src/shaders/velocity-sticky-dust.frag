// GPGPU velocity step of the "sticky dust" algorithm: multi-scale gravity, pressure (threshold and kinetic), grains
// sticking toward the local flow, force of the static drawings (drawing.glsl, included before).
// Defines: MAX_SPECIES, DRAWING_RES, DENSITY_RES (dust-gravity-lattice.glsl, included before), CONTACT_LO, CONTACT_HI,
// PRESSURE_CFL, GLOW_LO, GLOW_HI. density-reference.glsl is included before as well. Provided by GPUComputationRenderer: resolution.
// The TypeScript twins are stickyDust/granular.ts (the granular formulas) and stickyDust/ejecta.ts (the supernova's ejection and kick).
// The state samplers are bound by GpuPipeline (the velocity pass declares no dependencies).
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D textureDensity;
uniform sampler2D textureSupernova;
uniform sampler2D textureGravity;       // gravity of the coarse levels per density texel (DustGravityField)
uniform vec2 screenSize;
uniform vec2 domainOffset;
uniform float domainSize;
uniform float densityRes;
uniform float dt;
uniform float activeCount;
uniform float kGravity;
uniform float kPressure;
uniform float restDensity;
uniform float energyScale;
uniform float stickRate;                // Haff: sticking frequency / (rho sqrt(T)), 1/s
uniform float collisionSpeed;           // relative speed above which grains bounce instead of sticking, px/s
uniform float kineticPressure;          // 1 for the pressure rho T / 2 of an ideal gas, 0 for none
uniform float globalDrag;
uniform float maxSpeed;
uniform float restitution;
uniform float momentumScale;
uniform float supernovaActive;
uniform vec2 supernovaCenter;
uniform float ejectaRadius;             // rms distance of the ejecta to the centre: they move at supernovaSpeed (rms) at this distance
uniform float supernovaSpeed;
uniform float ejectTime;
uniform float shockActive;
uniform vec2 shockCenter;
uniform float shockInner;               // front radius at the previous step
uniform float shockOuter;               // front radius now
uniform float shockRef;                 // aggregate radius (kick reference distance)
uniform float shockStrength;
uniform float speciesInvRelDensity[MAX_SPECIES];  // mean density / species density
uniform float speciesEjectScale[MAX_SPECIES];     // sqrt(mean mass / species mass): heavy elements are ejected slower

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// rho T of a density texel d (mass, scaled momentum, scaled energy about the reference r): T = <|v|^2> - |u|^2,
// the agitation (px^2/s^2), the energy of the motion about the mean flow. The reference keeps the two terms close
// to each other so that the half floats of the grid do not cancel them away.
float peculiarEnergy(vec4 d, vec2 r) {
    if (d.r < 1e-4) return 0.0;
    vec2 rel = d.gb / momentumScale - d.r * r;          // sum m (v - r)
    return max(d.a / energyScale - dot(rel, rel) / d.r, 0.0);
}

// Kinetic pressure P = rho T / 2 of a density texel (two degrees of freedom) for grains in contact; its agitation is
// capped, as the sound speed cannot cross more than PRESSURE_CFL texels in a step.
float gasPressure(vec4 d, vec2 r, float maxAgitation) {
    float contact = smoothstep(CONTACT_LO * restDensity, CONTACT_HI * restDensity, d.r);
    return 0.5 * contact * min(peculiarEnergy(d, r), d.r * maxAgitation);
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 vel = texture2D(textureVelocity, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount) { gl_FragColor = vel; return; }
    vec4 posData = texture2D(texturePosition, uv);
    vec2 pos = posData.xy;
    int species = clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1);
    float ejectScale = speciesEjectScale[species];

    if (supernovaActive > 0.5 && texture2D(textureSupernova, uv).r > 0.5) {
        vec2 d = pos - supernovaCenter;
        float r = length(d);
        float angle = r > 0.001 ? atan(d.y, d.x) : hash(uv) * 6.2831853;
        angle += (hash(uv + 0.37) - 0.5) * 0.25;
        // Homologous expansion, v = H r: the speed grows with the distance to the centre (supernovaSpeed at the rms distance
        // of the ejecta, so their rms speed is supernovaSpeed), the layers keep their order, and each species is scaled by
        // sqrt(mean mass / mass), the same kinetic energy for all: heavy elements, which sit in the core, move slower than
        // the light ones.
        float speed = min(supernovaSpeed * ejectScale * r / ejectaRadius, maxSpeed);
        gl_FragColor = vec4(cos(angle) * speed, sin(angle) * speed, ejectTime, 0.0);
        return;
    }

    // vel.z = remaining ejection time after a supernova. While it runs the ejecta are in free flight: only the contact
    // physics, the pressure and the sticking, waits for it (see `contact` below). Gravity does not.
    float eject = max(vel.z - dt, 0.0);

    // Shock wave: when the front sweeps over a particle, its outward radial velocity is
    // raised to at least the local kick, the front's own speed (K / R, so 1/r falloff) times the strength of the wave.
    // Faster ejecta are left untouched.
    if (shockActive > 0.5) {
        vec2 d = pos - shockCenter;
        float r = length(d);
        if (r > shockInner && r <= shockOuter) {
            vec2 n = d / r;
            float rel = shockStrength * shockRef / r;   // kick / ejection speed
            float kick = supernovaSpeed * rel * ejectScale;
            float vr = dot(vel.xy, n);
            if (vr < kick) {
                vel.xy += (kick - vr) * n;
                eject = max(eject, ejectTime * clamp(rel, 0.0, 1.0));
            }
        }
    }

    // 0 just after an ejection or a kick, back to 1 when the timer has run out: the share of the contact physics (pressure,
    // sticking) the particle feels. Gravity and the drawings' pull ignore it: what falls does not depend on what it is
    // doing (equivalence principle), so ejecta that do not escape come back, and the pull of an attractor applies as ever.
    float contact = 1.0 - clamp(eject / ejectTime, 0.0, 1.0);
    vec2 duv = (pos + domainOffset) / domainSize;

    // The reference of the deposit, then the four density texels around the particle (their moments, not only the
    // mass): level 0's pull, the threshold pressure and the kinetic pressure all come from them.
    vec2 ref = referenceVelocity(pos, domainSize, momentumScale);
    vec2 t = vec2(1.0 / densityRes);
    vec4 dxp = textureLod(textureDensity, duv + vec2(t.x, 0.0), 0.0);
    vec4 dxm = textureLod(textureDensity, duv - vec2(t.x, 0.0), 0.0);
    vec4 dyp = textureLod(textureDensity, duv + vec2(0.0, t.y), 0.0);
    vec4 dym = textureLod(textureDensity, duv - vec2(0.0, t.y), 0.0);
    vec4 local = textureLod(textureDensity, duv, 0.0);

    // Multi-scale pull: each mip level is the density smoothed at twice the previous scale; summing the
    // gradients of the levels builds a pull with weights 2^(level * LONG_RANGE) (~ 1/r potential). Level 0 is
    // read here, from the taps above; the coarser levels were summed per texel by DustGravityField.
    vec2 gravity = vec2(dxp.r - dxm.r, dyp.r - dym.r) + textureLod(textureGravity, gravityFieldUv(duv), 0.0).xy;

    // Threshold pressure: grains packed beyond the rest density push back.
    vec2 pressure = vec2(max(dxp.r - restDensity, 0.0) - max(dxm.r - restDensity, 0.0),
                         max(dyp.r - restDensity, 0.0) - max(dym.r - restDensity, 0.0));

    // Kinetic pressure: agitated grains resist compression, a = -grad(P) / rho, the gradient over the two texels of
    // size h (px) between the taps. Only where the grains are in contact.
    float texel = domainSize / densityRes;
    float maxAgitation = 2.0 * pow(PRESSURE_CFL * texel / dt, 2.0);
    vec2 gasGradient = vec2(gasPressure(dxp, ref, maxAgitation) - gasPressure(dxm, ref, maxAgitation),
                            gasPressure(dyp, ref, maxAgitation) - gasPressure(dym, ref, maxAgitation));
    vec2 gas = -kineticPressure * gasGradient / (2.0 * texel * max(local.r, 1.0));

    // Buoyancy: the pressure push is divided by the species' relative density, so species
    // denser than the mean sink to the core of clumps and lighter ones float to the rim.
    vec2 v = vel.xy + (kGravity * gravity + drawingAccel(pos)
                       + contact * speciesInvRelDensity[species] * (gas - kPressure * pressure)) * dt;

    // Sticking (Haff): grains collide at a frequency proportional to rho sqrt(T) and stick, so their velocity relaxes
    // toward the local mean flow at that rate and the agitation T falls as 1 / (1 + t / t0)^2. Grains that meet
    // faster than the collision speed bounce instead: the sticking fades out between half of it and all of it, which
    // keeps fast ejecta from sticking to the flow they leave; the slow ones are kept free by the ejection timer.
    float agitation = 0.0;
    if (local.r > 1e-4) {
        vec2 meanV = local.gb / (local.r * momentumScale);
        agitation = peculiarEnergy(local, ref) / local.r;
        float frequency = stickRate * local.r * sqrt(agitation);
        float sticks = 1.0 - smoothstep(0.5 * collisionSpeed, collisionSpeed, length(v - meanV));
        v = mix(v, meanV, contact * sticks * (1.0 - exp(-frequency * dt)));
    }

    v *= exp(-globalDrag * dt);
    float s = length(v);
    if (s > maxSpeed) v *= maxSpeed / s;

    vec2 next = pos + v * dt;
    if ((next.x < 0.0 && v.x < 0.0) || (next.x > screenSize.x && v.x > 0.0)) v.x = -v.x * restitution;
    if ((next.y < 0.0 && v.y < 0.0) || (next.y > screenSize.y && v.y > 0.0)) v.y = -v.y * restitution;

    // w: the glow of the particle layer, from the agitation of the grains around it, not from its speed.
    gl_FragColor = vec4(v, eject, smoothstep(GLOW_LO, GLOW_HI, sqrt(agitation)));
}
