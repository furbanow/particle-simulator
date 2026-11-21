// GPGPU velocity step of the "sticky dust" algorithm: multi-scale gravity, threshold pressure,
// viscosity toward the local flow, force of the static drawings (drawing.glsl, included before).
// Defines: MAX_SPECIES, DRAWING_RES, DENSITY_RES (dust-gravity-lattice.glsl, included before). Provided by GPUComputationRenderer: resolution.
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
uniform float viscosityRate;
uniform float globalDrag;
uniform float maxSpeed;
uniform float restitution;
uniform float momentumScale;
uniform float supernovaActive;
uniform vec2 supernovaCenter;
uniform float supernovaSpeed;
uniform float ejectTime;
uniform float shockActive;
uniform vec2 shockCenter;
uniform float shockInner;               // front radius at the previous step
uniform float shockOuter;               // front radius now
uniform float shockRef;                 // aggregate radius (kick reference distance)
uniform float shockStrength;
uniform float speciesInvRelDensity[MAX_SPECIES];  // mean density / species density
uniform float speciesEjectScale[MAX_SPECIES];     // sqrt(mean mass / species mass)

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

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
        float angle = length(d) > 0.001 ? atan(d.y, d.x) : hash(uv) * 6.2831853;
        angle += (hash(uv + 0.37) - 0.5) * 0.25;
        // Same kinetic energy for every species: light ones fly faster.
        float speed = supernovaSpeed * ejectScale * (0.8 + 0.4 * hash(uv + 1.71));
        gl_FragColor = vec4(cos(angle) * speed, sin(angle) * speed, ejectTime, 0.0);
        return;
    }

    // vel.z = remaining ejection time after a supernova
    float eject = max(vel.z - dt, 0.0);

    // Shock wave: when the front sweeps over a particle, its outward radial velocity is
    // raised to at least the local kick (1/r falloff). Faster ejecta are left untouched.
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

    float bound = 1.0 - clamp(eject / ejectTime, 0.0, 1.0);
    vec2 duv = (pos + domainOffset) / domainSize;

    // The four density texels around the particle: level 0's pull and the pressure both come from them.
    vec2 t = vec2(1.0 / densityRes);
    float dxp = textureLod(textureDensity, duv + vec2(t.x, 0.0), 0.0).r;
    float dxm = textureLod(textureDensity, duv - vec2(t.x, 0.0), 0.0).r;
    float dyp = textureLod(textureDensity, duv + vec2(0.0, t.y), 0.0).r;
    float dym = textureLod(textureDensity, duv - vec2(0.0, t.y), 0.0).r;

    // Multi-scale pull: each mip level is the density smoothed at twice the previous scale; summing the
    // gradients of the levels builds a pull with weights 2^(level * LONG_RANGE) (~ 1/r potential). Level 0 is
    // read here, from the taps above; the coarser levels were summed per texel by DustGravityField.
    vec2 gravity = vec2(dxp - dxm, dyp - dym) + textureLod(textureGravity, gravityFieldUv(duv), 0.0).xy;

    vec2 pressure = vec2(max(dxp - restDensity, 0.0) - max(dxm - restDensity, 0.0),
                         max(dyp - restDensity, 0.0) - max(dym - restDensity, 0.0));

    // Buoyancy: the pressure push is divided by the species' relative density, so species
    // denser than the mean sink to the core of clumps and lighter ones float to the rim.
    vec2 v = vel.xy + bound * (kGravity * gravity + drawingAccel(pos)
                               - kPressure * speciesInvRelDensity[species] * pressure) * dt;

    // "Sticking": in dense regions, velocity relaxes toward the local mean flow, so
    // clumps hold together while still moving as a whole.
    vec4 local = textureLod(textureDensity, duv, 0.0);
    if (local.r > 1e-4) {
        vec2 meanV = local.gb / (local.r * momentumScale);
        float k = bound * smoothstep(0.1 * restDensity, 0.6 * restDensity, local.r);
        v = mix(v, meanV, k * (1.0 - exp(-viscosityRate * dt)));
    }

    v *= exp(-globalDrag * dt);
    float s = length(v);
    if (s > maxSpeed) v *= maxSpeed / s;

    vec2 next = pos + v * dt;
    if ((next.x < 0.0 && v.x < 0.0) || (next.x > screenSize.x && v.x > 0.0)) v.x = -v.x * restitution;
    if ((next.y < 0.0 && v.y < 0.0) || (next.y > screenSize.y && v.y > 0.0)) v.y = -v.y * restitution;

    gl_FragColor = vec4(v, eject, 0.0);
}
