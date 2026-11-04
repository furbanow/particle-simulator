import type * as THREE from 'three';
import type { Uniform } from '../gl/common';
import type { ParamValue, ParamValues, ParticleType } from './algorithm';
import type { DensityField } from './densityField';

/** Per-type uniforms shared by the simulation, particle and nebula materials. */
export interface SpeciesUniforms {
    splatMass: Uniform<number[]>;
    size: Uniform<number[]>;
    color: Uniform<THREE.Vector3[]>;
}

/**
 * What the GPGPU pipeline (GpuPipeline) lends to a GPU model. The state lives in float textures
 * of TEX_SIZE x TEX_SIZE texels, one per particle: positions (x, y, type rank, w) and velocities
 * (vx, vy, z, w; z and w are the model's own, but see GpuModel.glow). The particle and nebula
 * layers draw them as they are. A particle whose position w is negative (REMOVED_PARTICLE_W) has
 * been removed: it is not drawn, deposits no mass and is not counted; live particles have w = 1.
 */
export interface GpuModelContext {
    readonly renderer: THREE.WebGLRenderer;
    readonly geometry: THREE.BufferGeometry;
    /** Simulation area in CSS px (its width and height). */
    readonly screenSize: Uniform<THREE.Vector2>;
    readonly speciesUniforms: SpeciesUniforms;
    /** Mipmapped mass/momentum grid, rendered before every substep. */
    readonly density: DensityField;
    positionTexture(): THREE.Texture;
    velocityTexture(): THREE.Texture;
    /** Current texture of one of the model's extra state variables. */
    variableTexture(name: string): THREE.Texture;
    /** Particles of the running simulation. */
    activeCount(): number;
}

/** Initial state of the particles, written into the position and velocity texture data (RGBA). */
export interface InitialState {
    positions: Float32Array;
    velocities: Float32Array;
    count: number;
    /** Particles per type: types fill contiguous index blocks, in rank order. */
    typeCounts: readonly number[];
    width: number;
    height: number;
    params: ParamValues;
}

/**
 * An extra per-particle state texture (e.g. temperature), computed by its own shader in the same
 * GPGPU pass as positions and velocities. Its shader gets every state sampler injected (by name);
 * the velocity shader declares `uniform sampler2D <name>;` itself and the pipeline binds it.
 */
export interface GpuVariable {
    readonly name: string;
    readonly shader: string;
    readonly uniforms?: Record<string, THREE.IUniform>;
    /** Fills the initial RGBA data on restart (zeros otherwise). */
    init?(data: Float32Array, state: InitialState): void;
}

/**
 * GPU side of an algorithm, run by the GPGPU pipeline. The pipeline owns the state textures, the
 * density field, the time step and substeps, the per-type mass/size/color uniforms and the periodic
 * read-back of the positions; the model brings its shaders, its uniforms and the hooks below.
 *
 * Common uniforms given to the velocity shader (it declares the ones it uses): texturePosition,
 * textureVelocity, textureDensity, screenSize, domainOffset, domainSize, densityRes, maxLod, dt,
 * activeCount, momentumScale. The position shader gets dt, screenSize and activeCount.
 */
export interface GpuModel {
    /** Velocity pass (defines already injected). It declares its own state samplers. */
    readonly velocityShader: string;
    /** Position pass; the default one integrates x += v dt and keeps the type rank (z). */
    readonly positionShader?: string;
    /** Merged into the velocity uniforms by reference: names must not clash with the common ones. */
    readonly velocityUniforms: Record<string, THREE.IUniform>;
    readonly positionUniforms?: Record<string, THREE.IUniform>;
    readonly variables?: readonly GpuVariable[];
    /**
     * Whether the model reads the pipeline's density field (textureDensity); when false the
     * pipeline does not render it. True when omitted.
     */
    readonly usesDensityField?: boolean;
    /**
     * Where the particle layer takes each particle's glow (whitening and brightening) from:
     * 'speed' (default) heats particles with their speed; 'state' reads the model's own glow,
     * 0..2, from the velocity w channel (e.g. the local temperature).
     */
    readonly glow?: 'speed' | 'state';

    /** Mass of a type in the gravity field (only ratios matter: the total stays TOTAL_MASS). */
    typeMass(type: ParticleType): number;
    /** Rendered diameter of a type, in CSS px. */
    typeSize(type: ParticleType): number;

    /** A parameter changed: live ones while they change, all of them when the model is created. */
    setParam(key: string, value: ParamValue): void;
    /** Initial positions and velocities; the pipeline's donut when omitted. */
    initialize?(state: InitialState): void;
    /** The simulation restarted with these parameter values (state textures already filled). */
    reset(params: ParamValues): void;
    /** Per-type uniforms of the model, after the types or the split changed. */
    updateSpecies(types: readonly ParticleType[], typeCounts: readonly number[]): void;
    /** Before each substep's density splat and GPGPU pass: extra passes go here. */
    beforeSubstep?(dt: number): void;
    afterSubstep?(): void;
    endFrame?(): void;
    /** Asked every CLUSTER_CHECK_INTERVAL frames: whether to read the positions back. */
    wantsReadback?(): boolean;
    /** Positions read back (RGBA per particle), for CPU analysis; dropped after a restart. */
    onReadback?(positions: Float32Array, count: number): void;

    /** Live value of a declared stat, null when not known yet. */
    stat(key: string): number | null;
    /** Live particle count per type, when types change during the simulation (else null). */
    liveTypeCounts?(): readonly number[] | null;

    dispose(): void;
}

export type GpuModelFactory = (context: GpuModelContext) => GpuModel;
