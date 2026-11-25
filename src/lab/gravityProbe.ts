// Probes of the sticky dust's gravity on the GPU: the same density pyramid read two ways at given
// positions, by the reference (the per-particle multi-scale loop the dust used before its gravity was
// computed per texel, kept here as the yardstick) and by the field the model now sums
// (DustGravityField, one bilinear read). Also a synthetic density: a unit point mass.

import * as THREE from 'three';
import { clearTarget, createMipmappedHalfFloatTarget } from '../gl/common';
import { GridPass } from '../gl/gridPass';
import { DENSITY_RES, DENSITY_TOP_LEVEL, DUST_GRADIENT_CORNER_WEIGHT, LONG_RANGE } from '../config';
import { glslFloat, withDefines } from '../gl/withDefines';
import { readTarget } from './readback';
import latticeGlsl from '../shaders/dust-gravity-lattice.glsl?raw';

const PROBE_FRAGMENT = `
uniform sampler2D probePositions;       // xy: position (px); probe i is the texel (i mod width, i / width)
uniform sampler2D textureDensity;
uniform sampler2D textureGravity;
uniform vec2 domainOffset;
uniform float domainSize;
uniform int probeCount;
uniform int outputWidth;
uniform float probeSnap;                // 1: move the probe to the center of its density texel
uniform float probeExact;               // 1: read the density with exact float weights (the hardware filter rounds them to 8 bits)

// The bilinear read of the density's mip level, by the hardware or with exact weights.
float densityAt(vec2 uv, float lod) {
    if (probeExact < 0.5) return textureLod(textureDensity, uv, lod).r;
    int level = int(lod);
    ivec2 size = textureSize(textureDensity, level);
    vec2 p = uv * vec2(size) - 0.5;
    ivec2 i = ivec2(floor(p));
    vec2 f = p - vec2(i);
    ivec2 last = size - 1;
    float a = texelFetch(textureDensity, clamp(i, ivec2(0), last), level).r;
    float b = texelFetch(textureDensity, clamp(i + ivec2(1, 0), ivec2(0), last), level).r;
    float c = texelFetch(textureDensity, clamp(i + ivec2(0, 1), ivec2(0), last), level).r;
    float d = texelFetch(textureDensity, clamp(i + ivec2(1, 1), ivec2(0), last), level).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// The reference: the loop of velocity-sticky-dust.frag before the gravity was computed per texel. Level
// 0 is the plain central difference (the particle's own taps); the coarser levels use the stencil of
// the field's passes (dust-gradient.glsl) with the corner weight GRADIENT_CORNER_WEIGHT, read in the
// pyramid at the offset of one texel of the level, which is what the field's texel-by-texel gradient interpolates.
vec2 referenceGravity(vec2 duv) {
    vec2 gravity = vec2(0.0);
    const float w = GRADIENT_CORNER_WEIGHT;
    for (int i = 0; i <= TOP_LEVEL; i++) {
        float lod = float(i);
        float o = exp2(lod) / float(DENSITY_RES);
        float weight = exp2(lod * LONG_RANGE);
        float c = i == 0 ? 0.0 : w;
        float dpp = densityAt(duv + vec2(o, o), lod);
        float dmp = densityAt(duv + vec2(-o, o), lod);
        float dpm = densityAt(duv + vec2(o, -o), lod);
        float dmm = densityAt(duv + vec2(-o, -o), lod);
        float dp0 = densityAt(duv + vec2(o, 0.0), lod);
        float dm0 = densityAt(duv - vec2(o, 0.0), lod);
        float d0p = densityAt(duv + vec2(0.0, o), lod);
        float d0m = densityAt(duv - vec2(0.0, o), lod);
        gravity += weight * vec2(c * (dpp - dmp + dpm - dmm) + (1.0 - 2.0 * c) * (dp0 - dm0),
                                 c * (dpp - dpm + dmp - dmm) + (1.0 - 2.0 * c) * (d0p - d0m));
    }
    return gravity;
}

// What the velocity shader does now: level 0 from the four texels around the position, the rest in one read of the field.
vec2 fieldGravity(vec2 duv) {
    float t = 1.0 / float(DENSITY_RES);
    vec2 level0 = vec2(densityAt(duv + vec2(t, 0.0), 0.0) - densityAt(duv - vec2(t, 0.0), 0.0),
                       densityAt(duv + vec2(0.0, t), 0.0) - densityAt(duv - vec2(0.0, t), 0.0));
    return level0 + texture2D(textureGravity, gravityFieldUv(duv)).xy;
}

void main() {
    int i = int(gl_FragCoord.y) * outputWidth + int(gl_FragCoord.x);
    if (i >= probeCount) { gl_FragColor = vec4(0.0); return; }
    ivec2 size = textureSize(probePositions, 0);
    vec2 pos = texelFetch(probePositions, ivec2(i % size.x, i / size.x), 0).xy;
    vec2 duv = (pos + domainOffset) / domainSize;
    if (probeSnap > 0.5) duv = (floor(duv * float(DENSITY_RES)) + 0.5) / float(DENSITY_RES);
    gl_FragColor = vec4(referenceGravity(duv), fieldGravity(duv));
}
`;

/** The result of a probe: the reference's gravity in R, G and the field's in B, A, one texel per probe. */
export interface ProbeResult {
    rgba: Float32Array;
    count: number;
}

export interface ProbeInput {
    /** Positions (px) of the probes, texel by texel from the bottom left; only R and G are read. */
    positions: THREE.Texture;
    count: number;
    density: THREE.Texture;
    field: THREE.Texture;
    domainOffset: THREE.Vector2;
    domainSize: number;
    /** Reads at the center of the density texel that holds each position: no re-interpolation, the rounding alone. */
    snap?: boolean;
    /** Reads the density with exact bilinear weights (the field itself is still read by the hardware, as the particles do). */
    exact?: boolean;
}

/** Evaluates both gravities at the same positions, in a target of `outputWidth` x ceil(count / outputWidth). */
export class GravityProbe {
    private readonly uniforms = {
        probePositions: { value: null as THREE.Texture | null },
        textureDensity: { value: null as THREE.Texture | null },
        textureGravity: { value: null as THREE.Texture | null },
        domainOffset: { value: new THREE.Vector2() },
        domainSize: { value: 1 },
        probeCount: { value: 0 },
        outputWidth: { value: 0 },
        probeSnap: { value: 0 },
        probeExact: { value: 0 },
    };
    private readonly pass: GridPass;
    private readonly target: THREE.WebGLRenderTarget;

    /** `cornerWeight`: the stencil of the coarse levels' gradient, the one the field under test was built with. */
    constructor(private readonly renderer: THREE.WebGLRenderer, private readonly capacity: number,
                cornerWeight = DUST_GRADIENT_CORNER_WEIGHT, outputWidth = 1024) {
        this.target = new THREE.WebGLRenderTarget(outputWidth, Math.ceil(capacity / outputWidth), {
            type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
            generateMipmaps: false, depthBuffer: false,
        });
        const source = withDefines(`${latticeGlsl}\n${PROBE_FRAGMENT}`, {
            DENSITY_RES, TOP_LEVEL: DENSITY_TOP_LEVEL, LONG_RANGE: glslFloat(LONG_RANGE), GRADIENT_CORNER_WEIGHT: glslFloat(cornerWeight),
        });
        this.pass = new GridPass(source, this.uniforms, this.target);
        this.uniforms.outputWidth.value = outputWidth;
    }

    async run(input: ProbeInput): Promise<ProbeResult> {
        if (input.count > this.capacity) throw new Error(`the probe holds ${this.capacity} points, ${input.count} asked`);
        const u = this.uniforms;
        u.probePositions.value = input.positions;
        u.textureDensity.value = input.density;
        u.textureGravity.value = input.field;
        u.domainOffset.value.copy(input.domainOffset);
        u.domainSize.value = input.domainSize;
        u.probeCount.value = input.count;
        u.probeSnap.value = input.snap ? 1 : 0;
        u.probeExact.value = input.exact ? 1 : 0;
        this.pass.render(this.renderer);
        this.renderer.setRenderTarget(null);
        return { rgba: await readTarget(this.renderer, this.target), count: input.count };
    }

    dispose(): void {
        this.pass.dispose();
    }
}

const POINT_MASS_FRAGMENT = `
uniform vec2 massPosition;              // in density texels, from the bottom left
uniform float massValue;
void main() {
    vec2 w = max(1.0 - abs(gl_FragCoord.xy - massPosition), 0.0);       // cloud-in-cell, as splat.frag
    gl_FragColor = vec4(massValue * w.x * w.y, 0.0, 0.0, 1.0);
}
`;

/** A density pyramid holding a single point mass, deposited as a particle is (cloud-in-cell), for the point-mass tests. */
export class PointMassDensity {
    readonly target = createMipmappedHalfFloatTarget(DENSITY_RES, DENSITY_RES);
    private readonly uniforms = { massPosition: { value: new THREE.Vector2() }, massValue: { value: 1 } };
    private readonly pass: GridPass;

    constructor(private readonly renderer: THREE.WebGLRenderer) {
        clearTarget(renderer, this.target);
        this.pass = new GridPass(POINT_MASS_FRAGMENT, this.uniforms, this.target);
    }

    /** Puts a mass `mass` at (x, y), in density texels, and rebuilds the mip levels. */
    place(x: number, y: number, mass: number): void {
        this.uniforms.massPosition.value.set(x, y);
        this.uniforms.massValue.value = mass;
        this.pass.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    dispose(): void {
        this.pass.dispose();
    }
}
