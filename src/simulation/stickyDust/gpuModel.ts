import * as THREE from 'three';
import {
    CONCENTRATION_RADIUS_SLIDER, EJECT_SCALE_RANGE, EJECT_TIME, GLOBAL_DRAG, INV_REL_DENSITY_RANGE, K_GRAVITY, K_PRESSURE, LONG_RANGE,
    MAX_PARTICLES, MAX_SPECIES, MAX_SPEED, REST_DENSITY, RESTITUTION, SHOCK_STRENGTH, SUPERNOVA_COOLDOWN,
    SUPERNOVA_SPEED, SUPERNOVA_THRESHOLD_SLIDER, TEX_SIZE, VISCOSITY_RATE,
} from '../../config';
import { withDefines } from '../../gl/withDefines';
import { clamp } from '../../util/math';
import type { ParamValue, ParamValues, ParticleType } from '../algorithm';
import { analyzeConcentration } from '../concentration';
import { DRAWING_DEFINES, drawingGlsl } from '../drawing/DrawingField';
import type { GpuModel, GpuModelContext } from '../gpuModel';
import { ShockWave } from '../shockWave';
import { STICKY_DUST_PARAM, STICKY_DUST_PROPERTY, STICKY_DUST_STAT, stickyDustDensity } from './declaration';
import stickyDustFrag from '../../shaders/velocity-sticky-dust.frag?raw';

const P = STICKY_DUST_PARAM;

/**
 * GPU side of "sticky dust": multi-scale gravity, threshold pressure and viscosity in the velocity
 * pass, plus the supernovae. Every few frames the positions are read back to find the densest
 * disk; above the threshold it goes supernova (ejection, then a shock wave).
 */
export class StickyDustModel implements GpuModel {
    readonly velocityShader = withDefines(`${drawingGlsl}\n${stickyDustFrag}`, { MAX_SPECIES, ...DRAWING_DEFINES });
    readonly velocityUniforms = {
        kGravity: { value: K_GRAVITY },
        longRange: { value: LONG_RANGE },
        kPressure: { value: K_PRESSURE },
        restDensity: { value: REST_DENSITY },
        viscosityRate: { value: VISCOSITY_RATE },
        globalDrag: { value: GLOBAL_DRAG },
        maxSpeed: { value: MAX_SPEED },
        restitution: { value: RESTITUTION },
        textureSupernova: { value: null as THREE.DataTexture | null },
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
    };

    /** Every value the model was given, by key: the booleans and choices (features) are read from here. */
    private readonly params: ParamValues = {};
    // Overwritten by setParam with the panel values when the model is created.
    private supernovaThreshold = SUPERNOVA_THRESHOLD_SLIDER.default / 100; // fraction of the particles
    private concentrationRadius = CONCENTRATION_RADIUS_SLIDER.default;     // px
    private supernovaCount = 0;
    private concentration: number | null = null;
    private cooldown = 0;
    private supernovaPending = false;
    private readonly supernovaMask = new Uint8Array(MAX_PARTICLES);
    private readonly supernovaTexture = new THREE.DataTexture(this.supernovaMask, TEX_SIZE, TEX_SIZE,
        THREE.RedFormat, THREE.UnsignedByteType);
    private readonly shock = new ShockWave(this.velocityUniforms);

    constructor(private readonly context: GpuModelContext) {
        Object.assign(this.velocityUniforms, context.drawing.uniforms);   // by reference
        this.supernovaTexture.needsUpdate = true;
        this.velocityUniforms.textureSupernova.value = this.supernovaTexture;
    }

    /** Dev-only, read-only: the values the model holds, whatever their kind. */
    get debugParams(): Readonly<ParamValues> {
        return this.params;
    }

    typeMass(t: ParticleType): number {
        return t.values[STICKY_DUST_PROPERTY.mass];
    }

    typeSize(t: ParticleType): number {
        return t.values[STICKY_DUST_PROPERTY.size];
    }

    setParam(key: string, value: ParamValue): void {
        this.params[key] = value;
        if (typeof value !== 'number') return;
        switch (key) {
            case P.gravity: this.velocityUniforms.kGravity.value = value; break;
            case P.supernovaThreshold: this.supernovaThreshold = value / 100; break;
            case P.concentrationRadius: this.concentrationRadius = value; break;
            // Ejection power, 0..100 % of SUPERNOVA_SPEED.
            case P.supernovaPower: this.velocityUniforms.supernovaSpeed.value = SUPERNOVA_SPEED * value / 100; break;
        }
    }

    reset(params: ParamValues): void {
        Object.assign(this.params, params);
        this.cooldown = 0;
        this.supernovaCount = 0;
        this.concentration = null;
        this.supernovaPending = false;
        this.velocityUniforms.supernovaActive.value = 0;
        this.shock.stop();
    }

    updateSpecies(types: readonly ParticleType[], typeCounts: readonly number[]): void {
        let totalMass = 0, massDensity = 0;
        types.forEach((t, k) => {
            const m = typeCounts[k] * this.typeMass(t);
            totalMass += m;
            massDensity += m * stickyDustDensity(t);
        });
        if (totalMass <= 0) return;
        const meanDensity = massDensity / totalMass;          // mass-weighted
        const meanMass = totalMass / this.context.activeCount();
        const u = this.velocityUniforms;
        types.forEach((t, k) => {
            u.speciesInvRelDensity.value[k] = clamp(meanDensity / stickyDustDensity(t), INV_REL_DENSITY_RANGE);
            u.speciesEjectScale.value[k] = clamp(Math.sqrt(meanMass / this.typeMass(t)), EJECT_SCALE_RANGE);
        });
    }

    beforeSubstep(dt: number): void {
        if (this.supernovaPending) this.velocityUniforms.supernovaActive.value = 1;
        this.shock.advance(dt);
    }

    afterSubstep(): void {
        const u = this.velocityUniforms;
        if (u.supernovaActive.value !== 1) return;
        u.supernovaActive.value = 0;
        const size = this.context.screenSize.value;
        this.shock.start(this.concentrationRadius, size.x, size.y);
        this.supernovaPending = false;
        this.cooldown = SUPERNOVA_COOLDOWN;
        this.supernovaCount++;
    }

    endFrame(): void {
        if (this.cooldown > 0) this.cooldown--;
    }

    wantsReadback(): boolean {
        return this.cooldown <= 0 && !this.supernovaPending;
    }

    onReadback(positions: Float32Array, count: number): void {
        const size = this.context.screenSize.value;
        const result = analyzeConcentration(positions, count, this.concentrationRadius, size.x, size.y, this.supernovaMask);
        this.concentration = result.fraction;
        if (result.members === 0 || result.fraction < this.supernovaThreshold) return;

        this.supernovaTexture.needsUpdate = true;
        this.velocityUniforms.supernovaCenter.value.set(result.centerX, result.centerY);
        this.supernovaPending = true;
    }

    stat(key: string): number | null {
        switch (key) {
            case STICKY_DUST_STAT.supernovae: return this.supernovaCount;
            case STICKY_DUST_STAT.concentration: return this.concentration;
            default: return null;
        }
    }

    dispose(): void {
        this.supernovaTexture.dispose();
    }
}
