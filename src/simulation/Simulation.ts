import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import {
    BASE_DT, CLUSTER_CHECK_INTERVAL, DONUT_INNER, DONUT_OUTER, EJECT_SCALE_RANGE, EJECT_TIME,
    GLOBAL_DRAG, INITIAL_SPEED, INV_REL_DENSITY_RANGE, K_GRAVITY, K_PRESSURE, LONG_RANGE, MAX_PARTICLES,
    MAX_SPECIES, MAX_SPEED, MOMENTUM_SCALE, REST_DENSITY, RESTITUTION, SHOCK_STRENGTH, SUPERNOVA_COOLDOWN,
    SUPERNOVA_SPEED, TEX_SIZE, TOTAL_MASS, VISCOSITY_RATE,
} from '../config';
import { hexToVector, type Uniform } from '../gl/common';
import { withDefines } from '../gl/withDefines';
import { splitPopulation } from '../population';
import { createSpecies, speciesDensity, type Species } from '../species';
import { clamp } from '../util/math';
import { ClusterProbe } from './clusterProbe';
import { analyzeConcentration } from './concentration';
import { DensityField } from './densityField';
import { ShockWave, type ShockUniforms } from './shockWave';
import velocityFrag from '../shaders/velocity.frag?raw';
import positionFrag from '../shaders/position.frag?raw';

/** Per-species uniforms shared by the simulation, particle and nebula materials. */
export interface SpeciesUniforms {
    splatMass: Uniform<number[]>;
    size: Uniform<number[]>;
    color: Uniform<THREE.Vector3[]>;
}

export interface SimulationEvents {
    /** A supernova went off; `count` is the total since the last reset. */
    onSupernova?: (count: number) => void;
    /** A concentration check finished; `fraction` of the particles inside the densest disk. */
    onConcentration?: (fraction: number) => void;
}

/**
 * Multi-species GPGPU gravity simulation. Positions (x, y, species) and velocities (vx, vy,
 * remaining ejection time) live in float textures; gravity comes from a mipmapped cloud-in-cell
 * density field, plus pressure and relative-velocity viscosity. Every few frames positions are
 * read back to find the densest disk; above the threshold it goes supernova.
 */
export class Simulation {
    readonly species: Species[] = createSpecies();
    readonly speciesCounts = new Array<number>(MAX_SPECIES).fill(0);
    readonly speciesUniforms: SpeciesUniforms = {
        splatMass: { value: new Array<number>(MAX_SPECIES).fill(1) },
        size: { value: this.species.map(s => s.size) },
        color: { value: this.species.map(() => new THREE.Vector3()) },
    };
    /** One vertex per texture slot; `reference` is the texel UV of the particle. */
    readonly geometry = createReferenceGeometry();
    readonly screenSize: Uniform<THREE.Vector2> = { value: new THREE.Vector2() };

    // ---- Live parameters ----
    timeScale = 1;
    supernovaThreshold = 0.6;               // fraction of the particles
    concentrationRadius = 80;               // px

    // ---- State ----
    activeCount = 0;
    activeTypeCount = 0;
    supernovaCount = 0;
    private width = 1;
    private height = 1;
    private frameCounter = 0;
    private cooldown = 0;
    private supernovaPending = false;
    private generation = 0;

    private readonly gpu: GPUComputationRenderer;
    private readonly velVar: Variable;
    private readonly posVar: Variable;
    private readonly velUniforms: Record<string, THREE.IUniform>;
    private readonly posUniforms: Record<string, THREE.IUniform>;
    private readonly density: DensityField;
    private readonly shock: ShockWave;
    private readonly probe: ClusterProbe;
    private readonly supernovaMask = new Uint8Array(MAX_PARTICLES);
    private readonly supernovaTexture: THREE.DataTexture;

    constructor(renderer: THREE.WebGLRenderer, private readonly events: SimulationEvents = {}) {
        this.density = new DensityField(renderer, this.geometry, this.speciesUniforms.splatMass);
        this.probe = new ClusterProbe(renderer);

        this.gpu = new GPUComputationRenderer(TEX_SIZE, TEX_SIZE, renderer);
        this.velVar = this.gpu.addVariable('textureVelocity', withDefines(velocityFrag, { MAX_SPECIES }), this.gpu.createTexture());
        this.posVar = this.gpu.addVariable('texturePosition', positionFrag, this.gpu.createTexture());
        this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
        this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);

        this.supernovaTexture = new THREE.DataTexture(this.supernovaMask, TEX_SIZE, TEX_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
        this.supernovaTexture.needsUpdate = true;

        this.velUniforms = this.velVar.material.uniforms;
        Object.assign(this.velUniforms, {
            textureDensity: { value: this.density.target.texture },
            textureSupernova: { value: this.supernovaTexture },
            screenSize: this.screenSize,
            domainOffset: this.density.domainOffset,
            domainSize: this.density.domainSize,
            densityRes: this.density.densityRes,
            maxLod: { value: Math.log2(this.density.densityRes.value) - 1 }, // the 1x1 level carries no gradient
            dt: { value: BASE_DT },
            activeCount: { value: 0 },
            kGravity: { value: K_GRAVITY },
            longRange: { value: LONG_RANGE },
            kPressure: { value: K_PRESSURE },
            restDensity: { value: REST_DENSITY },
            viscosityRate: { value: VISCOSITY_RATE },
            globalDrag: { value: GLOBAL_DRAG },
            maxSpeed: { value: MAX_SPEED },
            restitution: { value: RESTITUTION },
            momentumScale: { value: MOMENTUM_SCALE },
            supernovaActive: { value: 0 },
            supernovaCenter: { value: new THREE.Vector2() },
            supernovaSpeed: { value: SUPERNOVA_SPEED },
            ejectTime: { value: EJECT_TIME },
            shockActive: { value: 0 },
            shockCenter: { value: new THREE.Vector2() },
            shockInner: { value: 0 },
            shockOuter: { value: 0 },
            shockRef: { value: 1 },
            shockStrength: { value: SHOCK_STRENGTH },
            speciesInvRelDensity: { value: new Array<number>(MAX_SPECIES).fill(1) },
            speciesEjectScale: { value: new Array<number>(MAX_SPECIES).fill(1) },
        });
        this.posUniforms = this.posVar.material.uniforms;
        Object.assign(this.posUniforms, {
            dt: { value: BASE_DT },
            screenSize: this.screenSize,
            activeCount: this.velUniforms.activeCount,
        });

        const gpuError = this.gpu.init();
        if (gpuError !== null) throw new Error(gpuError);

        this.shock = new ShockWave(this.velUniforms as unknown as ShockUniforms);
    }

    get positionTexture(): THREE.Texture {
        return this.gpu.getCurrentRenderTarget(this.posVar).texture;
    }

    get velocityTexture(): THREE.Texture {
        return this.gpu.getCurrentRenderTarget(this.velVar).texture;
    }

    /** Gravitational constant (K_GRAVITY by default), applied live by the velocity pass. */
    get gravity(): number {
        return this.velUniforms.kGravity.value;
    }

    set gravity(value: number) {
        this.velUniforms.kGravity.value = value;
    }

    /** Supernova ejection power, 0..100 % of SUPERNOVA_SPEED. */
    set supernovaPower(percent: number) {
        this.velUniforms.supernovaSpeed.value = SUPERNOVA_SPEED * percent / 100;
    }

    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.screenSize.value.set(width, height);
        this.density.resize(width, height);
    }

    /**
     * Restarts with `count` particles in a donut, split between the first `typeCount` species
     * pro rata of their population weights.
     */
    reset(count: number, typeCount: number): void {
        this.activeCount = count;
        this.activeTypeCount = typeCount;
        const counts = splitPopulation(count, this.species.map(s => s.weight), typeCount);
        counts.forEach((n, k) => { this.speciesCounts[k] = n; });
        this.generation++;
        this.frameCounter = 0;
        this.cooldown = 0;
        this.supernovaCount = 0;
        this.supernovaPending = false;
        this.velUniforms.supernovaActive.value = 0;
        this.shock.stop();

        const posTex = this.gpu.createTexture();
        const velTex = this.gpu.createTexture();
        // GPUComputationRenderer textures are RGBA float data.
        const p = posTex.image.data as unknown as Float32Array;
        const v = velTex.image.data as unknown as Float32Array;
        const cx = this.width / 2, cy = this.height / 2;
        const m = Math.min(this.width, this.height);
        const rIn2 = (DONUT_INNER * m) ** 2;
        const rOut2 = (DONUT_OUTER * m) ** 2;
        // Species fill contiguous index blocks: positions are drawn independently and blending
        // is additive, so the index order has no visible effect.
        let species = 0, blockEnd = counts[0];
        for (let i = 0; i < count; i++) {
            while (i >= blockEnd) blockEnd += counts[++species];
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(rIn2 + Math.random() * (rOut2 - rIn2)); // uniform in area
            p[i * 4] = cx + Math.cos(a) * r;
            p[i * 4 + 1] = cy + Math.sin(a) * r;
            p[i * 4 + 2] = species;
            p[i * 4 + 3] = 1;
            v[i * 4] = (Math.random() * 2 - 1) * INITIAL_SPEED;
            v[i * 4 + 1] = (Math.random() * 2 - 1) * INITIAL_SPEED;
        }
        for (const rt of this.posVar.renderTargets) this.gpu.renderTexture(posTex, rt);
        for (const rt of this.velVar.renderTargets) this.gpu.renderTexture(velTex, rt);
        posTex.dispose();
        velTex.dispose();

        this.geometry.setDrawRange(0, count);
        this.velUniforms.activeCount.value = count;
        this.updateSpeciesUniforms();
    }

    /** Derives every per-species uniform from the species settings and the particle split. */
    updateSpeciesUniforms(): void {
        let totalMass = 0, massDensity = 0;
        for (let k = 0; k < MAX_SPECIES; k++) {
            const m = this.speciesCounts[k] * this.species[k].mass;
            totalMass += m;
            massDensity += m * speciesDensity(this.species[k]);
        }
        if (totalMass <= 0) return;
        const massUnit = TOTAL_MASS / totalMass;              // total field mass stays TOTAL_MASS
        const meanDensity = massDensity / totalMass;          // mass-weighted
        const meanMass = totalMass / this.activeCount;
        const su = this.speciesUniforms;
        for (let k = 0; k < MAX_SPECIES; k++) {
            const s = this.species[k];
            su.splatMass.value[k] = s.mass * massUnit;
            this.velUniforms.speciesInvRelDensity.value[k] = clamp(meanDensity / speciesDensity(s), INV_REL_DENSITY_RANGE);
            this.velUniforms.speciesEjectScale.value[k] = clamp(Math.sqrt(meanMass / s.mass), EJECT_SCALE_RANGE);
            su.size.value[k] = s.size;
            su.color.value[k].copy(hexToVector(s.color));
        }
    }

    /** Advances one rendered frame (substeps keep large time scales stable). Frozen at time scale 0. */
    step(): void {
        if (this.timeScale <= 0) return;
        const steps = Math.max(1, Math.ceil(this.timeScale - 1e-6));
        const dt = BASE_DT * this.timeScale / steps;
        this.velUniforms.dt.value = dt;
        this.posUniforms.dt.value = dt;
        for (let s = 0; s < steps; s++) {
            if (s === 0 && this.supernovaPending) this.velUniforms.supernovaActive.value = 1;
            this.shock.advance(dt);
            this.density.shiftGrid();
            this.density.render(this.positionTexture, this.velocityTexture);
            this.gpu.compute();
            if (this.velUniforms.supernovaActive.value === 1) {
                this.velUniforms.supernovaActive.value = 0;
                this.shock.start(this.concentrationRadius, this.width, this.height);
                this.supernovaPending = false;
                this.cooldown = SUPERNOVA_COOLDOWN;
                this.supernovaCount++;
                this.events.onSupernova?.(this.supernovaCount);
            }
        }
    }

    /** Frame bookkeeping after rendering: supernova cooldown and periodic concentration check. */
    endFrame(): void {
        this.frameCounter++;
        if (this.cooldown > 0) this.cooldown--;
        if (this.frameCounter % CLUSTER_CHECK_INTERVAL === 0) this.scheduleClusterCheck();
    }

    private scheduleClusterCheck(): void {
        if (this.probe.busy || this.cooldown > 0 || this.supernovaPending) return;
        const gen = this.generation;
        this.probe.read(this.gpu.getCurrentRenderTarget(this.posVar), this.activeCount,
            () => gen === this.generation, positions => this.checkConcentration(positions));
    }

    private checkConcentration(positions: Float32Array): void {
        const result = analyzeConcentration(positions, this.activeCount, this.concentrationRadius,
            this.width, this.height, this.supernovaMask);
        this.events.onConcentration?.(result.fraction);
        if (result.members === 0 || result.fraction < this.supernovaThreshold) return;

        this.supernovaTexture.needsUpdate = true;
        this.velUniforms.supernovaCenter.value.set(result.centerX, result.centerY);
        this.supernovaPending = true;
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
