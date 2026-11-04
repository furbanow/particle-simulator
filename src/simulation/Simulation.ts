import * as THREE from 'three';
import { BASE_DT, MAX_PARTICLES, MAX_SPECIES, TEX_SIZE } from '../config';
import type { Uniform } from '../gl/common';
import { splitPopulation } from '../population';
import {
    cloneType, PARTICLE_COUNT_PARAM, populationWeights, type AlgorithmDeclaration, type ParamValue,
    type ParamValues, type ParticleType,
} from './algorithm';
import { ALGORITHMS, DEFAULT_ALGORITHM, type AlgorithmId } from './algorithms';
import { GpuPipeline } from './GpuPipeline';
import { GPU_MODELS } from './gpuModels';
import { defaultParams, findParam, validParamValue } from './params';
import type { SpeciesUniforms } from './gpuModel';

export type { SpeciesUniforms } from './gpuModel';

/** What the simulation keeps per algorithm, so switching back finds the edits again. */
interface AlgorithmState {
    species: ParticleType[];
    params: ParamValues;
}

/**
 * The simulation as the UI and the render layers see it, whatever the algorithm: the shared
 * geometry and uniforms, the particle types (`species`) and parameter values of the selected
 * algorithm, and the GPGPU pipeline running it (recreated when the algorithm changes). The
 * declaration of the algorithm (algorithms.ts) drives the UI; its GPU model (gpuModels.ts) the physics.
 */
export class Simulation {
    readonly speciesUniforms: SpeciesUniforms = {
        splatMass: { value: new Array<number>(MAX_SPECIES).fill(1) },
        size: { value: new Array<number>(MAX_SPECIES).fill(1) },
        color: { value: Array.from({ length: MAX_SPECIES }, () => new THREE.Vector3()) },
    };
    /** One vertex per texture slot; `reference` is the texel UV of the particle. */
    readonly geometry = createReferenceGeometry();
    readonly screenSize: Uniform<THREE.Vector2> = { value: new THREE.Vector2() };
    /** Shared with the particle layer: set by the pipeline from its model (GpuModel.glow). */
    readonly glowFromState: Uniform<number> = { value: 0 };
    /** Particles per type at the last restart (the population split). */
    readonly speciesCounts = new Array<number>(MAX_SPECIES).fill(0);

    // ---- Live parameters ----
    timeScale = 1;

    // ---- State ----
    activeCount = 0;
    activeTypeCount = 0;
    private algorithmId: AlgorithmId = DEFAULT_ALGORITHM;
    private readonly states = new Map<AlgorithmId, AlgorithmState>();
    /** Parameter values at the last restart. */
    private appliedParams: ParamValues = {};
    private pipeline: GpuPipeline;
    private width = 1;
    private height = 1;

    constructor(private readonly renderer: THREE.WebGLRenderer, algorithm: AlgorithmId = DEFAULT_ALGORITHM) {
        this.algorithmId = algorithm;
        this.pipeline = this.createPipeline();
    }

    get algorithm(): AlgorithmDeclaration {
        return ALGORITHMS[this.algorithmId];
    }

    get algorithmKey(): AlgorithmId {
        return this.algorithmId;
    }

    /** Particle types of the selected algorithm, shared by reference with the UI (edited in place). */
    get species(): ParticleType[] {
        return this.state.species;
    }

    get params(): Readonly<ParamValues> {
        return this.state.params;
    }

    get positionTexture(): THREE.Texture {
        return this.pipeline.positionTexture;
    }

    get velocityTexture(): THREE.Texture {
        return this.pipeline.velocityTexture;
    }

    /**
     * Switches to another algorithm: its own types and parameter values (as last left), a new
     * pipeline. Nothing runs until reset().
     */
    useAlgorithm(id: AlgorithmId): void {
        if (id === this.algorithmId) return;
        this.pipeline.dispose();
        this.algorithmId = id;
        this.appliedParams = {};
        this.activeCount = 0;
        this.activeTypeCount = 0;
        this.speciesCounts.fill(0);
        this.geometry.setDrawRange(0, 0);
        this.pipeline = this.createPipeline();
        this.pipeline.resize(this.width, this.height);
    }

    /** Sets a parameter of the selected algorithm; live ones reach the GPU model at once. */
    setParam(key: string, value: ParamValue): void {
        const param = findParam(this.algorithm, key);
        if (!param) return;
        const valid = validParamValue(param, value);
        this.state.params[key] = valid;
        if (param.apply === 'live') this.pipeline.setParam(key, valid);
    }

    /** Whether a restart-applied parameter differs from its value in the running simulation. */
    isPending(key: string): boolean {
        return this.state.params[key] !== this.appliedParams[key];
    }

    /** Live value of a stat the algorithm declares (null while unknown). */
    stat(key: string): number | null {
        return this.pipeline.stat(key);
    }

    /** Particles per type now: the GPU model's count when types change, else the restart split. */
    liveTypeCounts(): readonly number[] {
        return this.pipeline.liveTypeCounts() ?? this.speciesCounts;
    }

    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.screenSize.value.set(width, height);
        this.pipeline.resize(width, height);
    }

    /**
     * Restarts with the particle count parameter, split between the first `typeCount` types pro
     * rata of their population weights.
     */
    reset(typeCount: number): void {
        const params = { ...this.state.params };
        const count = Math.min(MAX_PARTICLES, Math.max(0, Math.round(Number(params[PARTICLE_COUNT_PARAM]) || 0)));
        this.appliedParams = params;
        this.activeCount = count;
        this.activeTypeCount = typeCount;
        const counts = splitPopulation(count, populationWeights(this.algorithm.particleTypes, this.species), typeCount);
        this.speciesCounts.fill(0);
        counts.forEach((n, k) => { this.speciesCounts[k] = n; });
        this.pipeline.reset(count, this.speciesCounts, params);
        this.geometry.setDrawRange(0, count);
        this.updateSpeciesUniforms();
    }

    /** Derives every per-type uniform from the type settings and the particle split. */
    updateSpeciesUniforms(): void {
        this.pipeline.updateSpecies(this.species, this.speciesCounts);
    }

    /** Advances one rendered frame (substeps keep large time scales stable). Frozen at time scale 0. */
    step(): void {
        if (this.timeScale <= 0) return;
        const steps = Math.max(1, Math.ceil(this.timeScale - 1e-6));
        this.pipeline.step(BASE_DT * this.timeScale / steps, steps);
    }

    /** Frame bookkeeping after rendering (periodic read-back of the positions). */
    endFrame(): void {
        this.pipeline.endFrame();
    }

    private get state(): AlgorithmState {
        let state = this.states.get(this.algorithmId);
        if (!state) {
            const algorithm = this.algorithm;
            state = { species: algorithm.particleTypes.defaults.map(cloneType), params: defaultParams(algorithm) };
            this.states.set(this.algorithmId, state);
        }
        return state;
    }

    private createPipeline(): GpuPipeline {
        return new GpuPipeline(this.renderer, this, GPU_MODELS[this.algorithmId], this.state.params);
    }
}

function createReferenceGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const references = new Float32Array(MAX_PARTICLES * 2);
    for (let i = 0; i < MAX_PARTICLES; i++) {
        references[i * 2] = ((i % TEX_SIZE) + 0.5) / TEX_SIZE;
        references[i * 2 + 1] = (Math.floor(i / TEX_SIZE) + 0.5) / TEX_SIZE;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geometry.setAttribute('reference', new THREE.BufferAttribute(references, 2));
    return geometry;
}
