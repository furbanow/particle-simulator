import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import {
    BASE_DT, CLUSTER_CHECK_INTERVAL, DONUT_INNER, DONUT_OUTER, INITIAL_SPEED, MOMENTUM_SCALE, TEX_SIZE, TOTAL_MASS,
} from '../config';
import { hexToVector, type Uniform } from '../gl/common';
import type { ParamValue, ParamValues, ParticleType } from './algorithm';
import { ClusterProbe } from './clusterProbe';
import { DensityField } from './densityField';
import type { GpuModel, GpuModelContext, GpuModelFactory, InitialState, SpeciesUniforms } from './gpuModel';
import positionFrag from '../shaders/position.frag?raw';

/** The objects shared with the render layers: they outlive the pipelines (one per algorithm). */
export interface SharedGpuState {
    geometry: THREE.BufferGeometry;
    screenSize: Uniform<THREE.Vector2>;
    speciesUniforms: SpeciesUniforms;
}

/** Initial state: a donut, uniform in area, with small random velocities. */
export function donut({ positions: p, velocities: v, count, typeCounts, width, height }: InitialState): void {
    const cx = width / 2, cy = height / 2;
    const m = Math.min(width, height);
    const rIn2 = (DONUT_INNER * m) ** 2;
    const rOut2 = (DONUT_OUTER * m) ** 2;
    // Types fill contiguous index blocks: positions are drawn independently and blending
    // is additive, so the index order has no visible effect.
    let type = 0, blockEnd = typeCounts[0];
    for (let i = 0; i < count; i++) {
        while (i >= blockEnd) blockEnd += typeCounts[++type];
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(rIn2 + Math.random() * (rOut2 - rIn2)); // uniform in area
        p[i * 4] = cx + Math.cos(a) * r;
        p[i * 4 + 1] = cy + Math.sin(a) * r;
        p[i * 4 + 2] = type;
        p[i * 4 + 3] = 1;
        v[i * 4] = (Math.random() * 2 - 1) * INITIAL_SPEED;
        v[i * 4 + 1] = (Math.random() * 2 - 1) * INITIAL_SPEED;
    }
}

/**
 * GPGPU run of one algorithm. Positions (x, y, type) and velocities live in float textures,
 * stepped by the GPU model's shaders; gravity comes from a mipmapped cloud-in-cell density field
 * rendered before every substep. Every few frames the model may have the positions read back.
 */
export class GpuPipeline {
    private readonly gpu: GPUComputationRenderer;
    private readonly velVar: Variable;
    private readonly posVar: Variable;
    private readonly extraVars: Variable[] = [];
    private readonly velUniforms: Record<string, THREE.IUniform>;
    private readonly posUniforms: Record<string, THREE.IUniform>;
    private readonly density: DensityField;
    private readonly probe: ClusterProbe;
    private readonly model: GpuModel;
    private activeCount = 0;
    private frameCounter = 0;
    private generation = 0;

    constructor(renderer: THREE.WebGLRenderer, private readonly shared: SharedGpuState,
                createModel: GpuModelFactory, params: ParamValues) {
        this.density = new DensityField(renderer, shared.geometry, shared.speciesUniforms.splatMass);
        this.probe = new ClusterProbe(renderer);
        const context: GpuModelContext = {
            renderer,
            geometry: shared.geometry,
            screenSize: shared.screenSize,
            speciesUniforms: shared.speciesUniforms,
            density: this.density,
            positionTexture: () => this.positionTexture,
            velocityTexture: () => this.velocityTexture,
            variableTexture: name => {
                const variable = this.extraVars.find(v => v.name === name);
                if (!variable) throw new Error(`Variable GPU inconnue : ${name}`);
                return this.gpu.getCurrentRenderTarget(variable).texture;
            },
            activeCount: () => this.activeCount,
        };
        const model = this.model = createModel(context);

        this.gpu = new GPUComputationRenderer(TEX_SIZE, TEX_SIZE, renderer);
        this.velVar = this.gpu.addVariable('textureVelocity', model.velocityShader, this.gpu.createTexture());
        this.posVar = this.gpu.addVariable('texturePosition', model.positionShader ?? positionFrag, this.gpu.createTexture());
        for (const v of model.variables ?? []) {
            const variable = this.gpu.addVariable(v.name, v.shader, this.gpu.createTexture());
            Object.assign(variable.material.uniforms, v.uniforms);
            this.extraVars.push(variable);
        }
        // The velocity pass has no declared dependencies: its shader declares its state samplers
        // itself and step() binds them. The other passes get them injected by GPUComputationRenderer.
        const state = [this.posVar, this.velVar, ...this.extraVars];
        this.gpu.setVariableDependencies(this.posVar, state);
        for (const variable of this.extraVars) this.gpu.setVariableDependencies(variable, state);

        this.velUniforms = this.velVar.material.uniforms;
        Object.assign(this.velUniforms, {
            texturePosition: { value: null },
            textureVelocity: { value: null },
            textureDensity: { value: this.density.target.texture },
            screenSize: shared.screenSize,
            domainOffset: this.density.domainOffset,
            domainSize: this.density.domainSize,
            densityRes: this.density.densityRes,
            maxLod: { value: Math.log2(this.density.densityRes.value) - 1 }, // the 1x1 level carries no gradient
            dt: { value: BASE_DT },
            activeCount: { value: 0 },
            momentumScale: { value: MOMENTUM_SCALE },
        }, model.velocityUniforms);
        for (const variable of this.extraVars) this.velUniforms[variable.name] = { value: null };
        this.posUniforms = this.posVar.material.uniforms;
        Object.assign(this.posUniforms, {
            dt: { value: BASE_DT },
            screenSize: shared.screenSize,
            activeCount: this.velUniforms.activeCount,
        }, model.positionUniforms);
        for (const variable of this.extraVars) {
            Object.assign(variable.material.uniforms, {
                dt: this.posUniforms.dt,
                screenSize: shared.screenSize,
                activeCount: this.velUniforms.activeCount,
            });
        }

        const gpuError = this.gpu.init();
        if (gpuError !== null) throw new Error(gpuError);

        for (const [key, value] of Object.entries(params)) model.setParam(key, value);
    }

    get positionTexture(): THREE.Texture {
        return this.gpu.getCurrentRenderTarget(this.posVar).texture;
    }

    get velocityTexture(): THREE.Texture {
        return this.gpu.getCurrentRenderTarget(this.velVar).texture;
    }

    setParam(key: string, value: ParamValue): void {
        this.model.setParam(key, value);
    }

    stat(key: string): number | null {
        return this.model.stat(key);
    }

    liveTypeCounts(): readonly number[] | null {
        return this.model.liveTypeCounts?.() ?? null;
    }

    resize(width: number, height: number): void {
        this.density.resize(width, height);
    }

    /** Restarts with `count` particles, `typeCounts[k]` of type k, in the model's initial state. */
    reset(count: number, typeCounts: readonly number[], params: ParamValues): void {
        this.activeCount = count;
        this.generation++;
        this.frameCounter = 0;

        const posTex = this.gpu.createTexture();
        const velTex = this.gpu.createTexture();
        // GPUComputationRenderer textures are RGBA float data.
        const size = this.shared.screenSize.value;
        const state: InitialState = {
            positions: posTex.image.data as unknown as Float32Array,
            velocities: velTex.image.data as unknown as Float32Array,
            count, typeCounts, width: size.x, height: size.y, params,
        };
        (this.model.initialize ?? donut)(state);
        const textures = [posTex, velTex];
        for (const rt of this.posVar.renderTargets) this.gpu.renderTexture(posTex, rt);
        for (const rt of this.velVar.renderTargets) this.gpu.renderTexture(velTex, rt);
        this.model.variables?.forEach((v, i) => {
            const tex = this.gpu.createTexture();
            v.init?.(tex.image.data as unknown as Float32Array, state);
            for (const rt of this.extraVars[i].renderTargets) this.gpu.renderTexture(tex, rt);
            textures.push(tex);
        });
        for (const tex of textures) tex.dispose();

        this.velUniforms.activeCount.value = count;
        this.model.reset(params);
    }

    /** Derives the per-type uniforms from the types and the particle split. */
    updateSpecies(types: readonly ParticleType[], typeCounts: readonly number[]): void {
        const { model } = this;
        let totalMass = 0;
        types.forEach((t, k) => { totalMass += typeCounts[k] * model.typeMass(t); });
        if (totalMass <= 0) return;
        const massUnit = TOTAL_MASS / totalMass;              // total field mass stays TOTAL_MASS
        const su = this.shared.speciesUniforms;
        types.forEach((t, k) => {
            su.splatMass.value[k] = model.typeMass(t) * massUnit;
            su.size.value[k] = model.typeSize(t);
            su.color.value[k].copy(hexToVector(t.color));
        });
        model.updateSpecies(types, typeCounts);
    }

    /** Advances `steps` substeps of `dt`. */
    step(dt: number, steps: number): void {
        const { model } = this;
        this.velUniforms.dt.value = dt;
        this.posUniforms.dt.value = dt;
        for (let s = 0; s < steps; s++) {
            model.beforeSubstep?.(dt);
            this.density.shiftGrid();
            this.density.render(this.positionTexture, this.velocityTexture);
            this.velUniforms.texturePosition.value = this.positionTexture;
            this.velUniforms.textureVelocity.value = this.velocityTexture;
            for (const variable of this.extraVars) {
                this.velUniforms[variable.name].value = this.gpu.getCurrentRenderTarget(variable).texture;
            }
            this.gpu.compute();
            model.afterSubstep?.();
        }
    }

    /** Frame bookkeeping after rendering, and the periodic read-back the model asks for. */
    endFrame(): void {
        this.frameCounter++;
        this.model.endFrame?.();
        if (this.frameCounter % CLUSTER_CHECK_INTERVAL !== 0) return;
        const { model } = this;
        if (!model.onReadback || this.probe.busy || !(model.wantsReadback?.() ?? true)) return;
        const gen = this.generation;
        const count = this.activeCount;
        this.probe.read(this.gpu.getCurrentRenderTarget(this.posVar), count,
            () => gen === this.generation, positions => model.onReadback?.(positions, count));
    }

    dispose(): void {
        this.generation++;                              // drops a read-back still in flight
        this.model.dispose();
        for (const variable of [this.velVar, this.posVar, ...this.extraVars]) variable.material.dispose();
        this.gpu.dispose();
        this.density.dispose();
    }
}
