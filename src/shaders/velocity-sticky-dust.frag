// GPGPU velocity step of the "sticky dust" algorithm: multi-scale gravity, threshold pressure,
// viscosity toward the local flow. Defines: MAX_SPECIES. Provided by GPUComputationRenderer: resolution.
// The state samplers are bound by GpuPipeline (the velocity pass declares no dependencies).
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D textureDensity;
uniform sampler2D textureSupernova;
uniform vec2 screenSize;
uniform vec2 domainOffset;
uniform float domainSize;
uniform float densityRes;
uniform float maxLod;
uniform float dt;
uniform float activeCount;
uniform float kGravity;
uniform float longRange;
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

float pressureAt(vec2 uv) { return max(textureLod(textureDensity, uv, 0.0).r - restDensity, 0.0); }

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

    // Each mip level is the density smoothed at twice the previous scale; summing their
    // central differences builds a multi-scale pull (equal weights ~ 1/r potential).
    vec2 gravity = vec2(0.0);
    for (int i = 0; i < 16; i++) {
        float lod = float(i);
        if (lod > maxLod) break;
        float o = exp2(lod) / densityRes;
        float w = exp2(lod * longRange);
        gravity.x += w * (textureLod(textureDensity, duv + vec2(o, 0.0), lod).r
                        - textureLod(textureDensity, duv - vec2(o, 0.0), lod).r);
        gravity.y += w * (textureLod(textureDensity, duv + vec2(0.0, o), lod).r
                        - textureLod(textureDensity, duv - vec2(0.0, o), lod).r);
    }

    vec2 t = vec2(1.0 / densityRes);
    vec2 pressure = vec2(
        pressureAt(duv + vec2(t.x, 0.0)) - pressureAt(duv - vec2(t.x, 0.0)),
        pressureAt(duv + vec2(0.0, t.y)) - pressureAt(duv - vec2(0.0, t.y)));

    // Buoyancy: the pressure push is divided by the species' relative density, so species
    // denser than the mean sink to the core of clumps and lighter ones float to the rim.
    vec2 v = vel.xy + bound * (kGravity * gravity
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
