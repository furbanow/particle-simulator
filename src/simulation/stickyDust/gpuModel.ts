import * as THREE from 'three';
import {
    CONCENTRATION_RADIUS_SLIDER, EJECT_SCALE_RANGE, EJECT_TIME, GLOBAL_DRAG, INV_REL_DENSITY_RANGE, K_GRAVITY, K_PRESSURE, LONG_RANGE,
    MAX_PARTICLES, MAX_SHOCK_WAVES, MAX_SPECIES, MAX_SPEED, MAX_SUPERNOVAE, REST_DENSITY, RESTITUTION, SHOCK_STRENGTH,
    SUPERNOVA_MAX_COUNT_SLIDER, SUPERNOVA_SPEED, SUPERNOVA_THRESHOLD_SLIDER, TEX_SIZE, VISCOSITY_RATE,
} from '../../config';
import { withDefines } from '../../gl/withDefines';
import { clamp } from '../../util/math';
import type { ParamValue, ParticleType } from '../algorithm';
import { ejectaImmunity, findConcentrations, type Concentration } from '../concentration';
import type { GpuModel, GpuModelContext } from '../gpuModel';
import { ShockWaves } from '../shockWave';
import { STICKY_DUST_PARAM, STICKY_DUST_PROPERTY, STICKY_DUST_STAT, stickyDustDensity } from './declaration';
import stickyDustFrag from '../../shaders/velocity-sticky-dust.frag?raw';

const P = STICKY_DUST_PARAM;

/**
 * GPU side of "sticky dust": multi-scale gravity, threshold pressure and viscosity in the velocity
 * pass, plus the supernovae. Every few frames the positions are read back to find the densest
 * disks; each one above the threshold goes supernova (ejection, then a shock wave). Ejected particles
 * are not counted until they have left the disk, so an aggregate does not explode twice in a row.
 */
export class StickyDustModel implements GpuModel {
    readonly velocityShader = withDefines(stickyDustFrag, { MAX_SPECIES, MAX_SUPERNOVAE, MAX_SHOCK_WAVES });
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
        supernovaCenters: { value: Array.from({ length: MAX_SUPERNOVAE }, () => new THREE.Vector2()) },
        supernovaSpeed: { value: SUPERNOVA_SPEED },
        ejectTime: { value: EJECT_TIME },
        shockCount: { value: 0 },
        shockFronts: { value: Array.from({ length: MAX_SHOCK_WAVES }, () => new THREE.Vector4()) },
        shockRefs: { value: new Array<number>(MAX_SHOCK_WAVES).fill(1) },
        shockStrength: { value: SHOCK_STRENGTH },
        speciesInvRelDensity: { value: new Array<number>(MAX_SPECIES).fill(1) },
        speciesEjectScale: { value: new Array<number>(MAX_SPECIES).fill(1) },
    };

    // Overwritten by setParam with the panel values when the model is created.
    private supernovaThreshold = SUPERNOVA_THRESHOLD_SLIDER.default / 100; // fraction of the particles
    private concentrationRadius = CONCENTRATION_RADIUS_SLIDER.default;     // px
    private supernovaMaxCount = SUPERNOVA_MAX_COUNT_SLIDER.default;
    private supernovaCount = 0;
    private concentration: number | null = null;
    private time = 0;                                                       // simulated s
    private pendingZones: Concentration[] = [];
    /** Per particle: the simulated time until which it is not counted by the detection. */
    private readonly immuneUntil = new Float32Array(MAX_PARTICLES);
    private readonly supernovaMask = new Uint8Array(MAX_PARTICLES);
    private readonly supernovaTexture = new THREE.DataTexture(this.supernovaMask, TEX_SIZE, TEX_SIZE,
        THREE.RedFormat, THREE.UnsignedByteType);
    private readonly shocks = new ShockWaves(this.velocityUniforms);

    constructor(private readonly context: GpuModelContext) {
        this.supernovaTexture.needsUpdate = true;
        this.velocityUniforms.textureSupernova.value = this.supernovaTexture;
    }

    typeMass(t: ParticleType): number {
        return t.values[STICKY_DUST_PROPERTY.mass];
    }

    typeSize(t: ParticleType): number {
        return t.values[STICKY_DUST_PROPERTY.size];
    }

    setParam(key: string, value: ParamValue): void {
        if (typeof value !== 'number') return;
        switch (key) {
            case P.gravity: this.velocityUniforms.kGravity.value = value; break;
            case P.supernovaThreshold: this.supernovaThreshold = value / 100; break;
            case P.concentrationRadius: this.concentrationRadius = value; break;
            case P.supernovaMaxCount: this.supernovaMaxCount = value; break;
            // Ejection power, 0..100 % of SUPERNOVA_SPEED.
            case P.supernovaPower: this.velocityUniforms.supernovaSpeed.value = SUPERNOVA_SPEED * value / 100; break;
        }
    }

    reset(): void {
        this.time = 0;
        this.immuneUntil.fill(0);
        this.supernovaCount = 0;
        this.concentration = null;
        this.pendingZones = [];
        this.velocityUniforms.supernovaActive.value = 0;
        this.shocks.stop();
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
        this.time += dt;
        if (this.pendingZones.length > 0) this.velocityUniforms.supernovaActive.value = 1;
        this.shocks.advance(dt);
    }

    afterSubstep(): void {
        const u = this.velocityUniforms;
        if (u.supernovaActive.value !== 1) return;
        u.supernovaActive.value = 0;
        const size = this.context.screenSize.value;
        for (const zone of this.pendingZones) {
            this.shocks.start(zone.centerX, zone.centerY, this.concentrationRadius, size.x, size.y);
        }
        const immuneUntil = this.time + ejectaImmunity(this.concentrationRadius, u.supernovaSpeed.value, u.ejectTime.value);
        const count = this.context.activeCount();
        for (let i = 0; i < count; i++) {
            if (this.supernovaMask[i] !== 0) this.immuneUntil[i] = immuneUntil;
        }
        this.supernovaCount += this.pendingZones.length;
        this.pendingZones = [];
    }

    wantsReadback(): boolean {
        return this.pendingZones.length === 0;
    }

    onReadback(positions: Float32Array, count: number): void {
        const size = this.context.screenSize.value;
        const result = findConcentrations(positions, count, {
            radius: this.concentrationRadius,
            width: size.x,
            height: size.y,
            threshold: this.supernovaThreshold,
            maxZones: this.supernovaMaxCount,
            immuneUntil: this.immuneUntil,
            now: this.time,
        }, this.supernovaMask);
        this.concentration = result.maxFraction;
        if (result.zones.length === 0) return;

        this.supernovaTexture.needsUpdate = true;
        result.zones.forEach((zone, k) => {
            this.velocityUniforms.supernovaCenters.value[k].set(zone.centerX, zone.centerY);
        });
        this.pendingZones = result.zones;
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
