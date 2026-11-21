import * as THREE from 'three';
import {
    CLUSTER_CHECK_INTERVAL, COLLISION_SPEED_SLIDER, CONCENTRATION_RADIUS_SLIDER, CONTACT_RANGE, DENSITY_RES, DUST_GRAVITY_GAIN,
    EJECT_TIME, GLOBAL_DRAG, GLOW_AGITATION_RANGE, GRAVITY_SLIDER, GRAVITY_WINDOW_MARGIN, INV_REL_DENSITY_RANGE, K_PRESSURE,
    KINETIC_PRESSURE, MAX_SPECIES, MAX_SPEED, PRESSURE_CFL, REST_DENSITY, RESTITUTION, SHOCK_STRENGTH, STICK_RATE, STICKINESS_SLIDER,
    SUPERNOVA_COOLDOWN, SUPERNOVA_SPEED, SUPERNOVA_THRESHOLD_SLIDER,
} from '../../config';
import { glslFloat, withDefines } from '../../gl/withDefines';
import { clamp } from '../../util/math';
import type { ParamValue, ParamValues, ParticleType } from '../algorithm';
import { analyzeConcentration, type Concentration, type ConcentrationReading } from '../concentration';
import { DRAWING_DEFINES, drawingGlsl } from '../drawing/DrawingField';
import type { DensityField } from '../densityField';
import type { GpuModel, GpuModelContext } from '../gpuModel';
import { ShockWave } from '../shockWave';
import { STICKY_DUST_PARAM, STICKY_DUST_PROPERTY, STICKY_DUST_STAT, stickyDustDensity } from './declaration';
import { ejectaRadius, ejectScale } from './ejecta';
import { ConcentrationReduction } from './concentrationReduction';
import { DustGravityField } from './gravityField';
import { gravityWindow } from './gravityWindow';
import referenceGlsl from '../../shaders/density-reference.glsl?raw';
import latticeGlsl from '../../shaders/dust-gravity-lattice.glsl?raw';
import stickyDustFrag from '../../shaders/velocity-sticky-dust.frag?raw';

const P = STICKY_DUST_PARAM;

/**
 * GPU side of "sticky dust": multi-scale gravity, pressure (threshold and kinetic) and sticking in the velocity
 * pass, plus the supernovae. Every few frames the GPU searches the disk holding the most mass (ConcentrationReduction:
 * a few floats come back, not the positions); above the threshold (a share of the total mass) it goes supernova
 * (homologous ejection of the particles inside that disk, then a shock wave). A device that cannot blend float32 targets
 * reads the positions back instead and runs the CPU reference (analyzeConcentration): the same figures, the same ejection.
 */
export class StickyDustModel implements GpuModel {
    readonly velocityShader = withDefines(`${drawingGlsl}\n${latticeGlsl}\n${referenceGlsl}\n${stickyDustFrag}`, {
        MAX_SPECIES, DENSITY_RES, ...DRAWING_DEFINES,
        CONTACT_LO: glslFloat(CONTACT_RANGE[0]), CONTACT_HI: glslFloat(CONTACT_RANGE[1]), PRESSURE_CFL: glslFloat(PRESSURE_CFL),
        GLOW_LO: glslFloat(GLOW_AGITATION_RANGE[0]), GLOW_HI: glslFloat(GLOW_AGITATION_RANGE[1]),
    });
    /** The particle layer glows with the agitation the velocity pass writes in w, not with the speed. */
    readonly glow = 'state';
    readonly velocityUniforms = {
        kGravity: { value: GRAVITY_SLIDER.default * DUST_GRAVITY_GAIN },
        kPressure: { value: K_PRESSURE },
        restDensity: { value: REST_DENSITY },
        stickRate: { value: STICK_RATE * STICKINESS_SLIDER.default / 100 },
        collisionSpeed: { value: COLLISION_SPEED_SLIDER.default },
        kineticPressure: { value: KINETIC_PRESSURE },
        globalDrag: { value: GLOBAL_DRAG },
        maxSpeed: { value: MAX_SPEED },
        restitution: { value: RESTITUTION },
        textureGravity: { value: null as THREE.Texture | null },
        supernovaActive: { value: 0 },
        supernovaCenter: { value: new THREE.Vector2() },
        supernovaRadius: { value: CONCENTRATION_RADIUS_SLIDER.default },
        ejectaRadius: { value: CONCENTRATION_RADIUS_SLIDER.default },
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
    private supernovaThreshold = SUPERNOVA_THRESHOLD_SLIDER.default / 100; // share of the total mass
    private concentrationRadius = CONCENTRATION_RADIUS_SLIDER.default;     // px
    private supernovaCount = 0;
    private concentration: number | null = null;
    private cooldown = 0;
    private supernovaPending = false;
    /** Mass of each species (u), by species index: what the concentration weighs the particles by (shared with the GPU reduction). */
    private readonly speciesMass = new Array<number>(MAX_SPECIES).fill(1);
    /** Total mass (u) of the particles, from the species' masses and counts: the denominator of the share, exact where the GPU's float32 sums are not. */
    private totalMass = 0;
    /** The GPU search of the densest disk; null on a device that cannot blend float32 targets (the CPU analyses a read-back then). */
    private readonly reduction: ConcentrationReduction | null;
    private cpuForced = false;
    private measuring = false;
    private frame = 0;
    /** Counts the restarts: a measurement that comes back after one belongs to the cloud before it, and is dropped. */
    private generation = 0;
    private readonly shock = new ShockWave(this.velocityUniforms);
    private gravity: DustGravityField;

    constructor(private readonly context: GpuModelContext) {
        Object.assign(this.velocityUniforms, context.drawing.uniforms);   // by reference
        this.gravity = new DustGravityField(context.renderer, context.density.target.texture);
        this.velocityUniforms.textureGravity.value = this.gravity.target.texture;
        this.reduction = ConcentrationReduction.supported(context.renderer)
            ? new ConcentrationReduction(context.renderer, context.geometry, this.speciesMass) : null;
    }

    /** Dev-only: the per-texel gravity field, for the lab page (src/lab). Not used by the app. */
    get debugGravity(): DustGravityField {
        return this.gravity;
    }

    /**
     * Dev-only: builds the gravity field again with another stencil of the coarse levels' gradient (0 is the central
     * difference of the original loop), for the lab's comparison of whole runs. Not used by the app.
     */
    debugUseCornerWeight(cornerWeight: number): void {
        this.gravity.dispose();
        this.gravity = new DustGravityField(this.context.renderer, this.context.density.target.texture, cornerWeight);
        this.velocityUniforms.textureGravity.value = this.gravity.target.texture;
    }

    /** Dev-only: the density field the gravity is computed from, for the lab page. Not used by the app. */
    get debugDensity(): DensityField {
        return this.context.density;
    }

    /**
     * Dev-only: measures the concentration now, on the GPU or (when `onGpu` is false, or the device has no float32 blending) on the CPU
     * from a read-back of the positions, without arming a supernova: the lab compares the two. Not used by the app.
     */
    async debugMeasure(onGpu: boolean, positions: Float32Array | null = null): Promise<Concentration> {
        const { context } = this;
        const size = context.screenSize.value;
        if (onGpu) {
            if (!this.reduction) throw new Error('No GPU reduction: the device cannot blend float32 targets');
            return this.reduction.measure(context.positionTexture(), this.concentrationRadius, size.x, size.y, this.totalMass);
        }
        if (!positions) throw new Error('debugMeasure on the CPU needs the positions read back');
        return analyzeConcentration(positions, context.activeCount(), this.concentrationRadius, size.x, size.y, this.speciesMass);
    }

    /** Dev-only: makes the model analyse a read-back of the positions on the CPU, as a device without float32 blending does. */
    debugForceCpu(forced: boolean): void {
        this.cpuForced = forced;
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
            case P.gravity: this.velocityUniforms.kGravity.value = value * DUST_GRAVITY_GAIN; break;
            case P.stickiness: this.velocityUniforms.stickRate.value = STICK_RATE * value / 100; break;
            case P.collisionSpeed: this.velocityUniforms.collisionSpeed.value = value; break;
            case P.supernovaThreshold: this.supernovaThreshold = value / 100; break;
            case P.concentrationRadius: this.concentrationRadius = value; break;
            // Ejection power, 0..100 % of SUPERNOVA_SPEED.
            case P.supernovaPower: this.velocityUniforms.supernovaSpeed.value = SUPERNOVA_SPEED * value / 100; break;
        }
    }

    reset(params: ParamValues): void {
        Object.assign(this.params, params);
        this.generation++;
        this.frame = 0;
        this.measuring = false;
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
        this.totalMass = totalMass;
        const meanDensity = massDensity / totalMass;          // mass-weighted
        const meanMass = totalMass / this.context.activeCount();
        const u = this.velocityUniforms;
        types.forEach((t, k) => {
            u.speciesInvRelDensity.value[k] = clamp(meanDensity / stickyDustDensity(t), INV_REL_DENSITY_RANGE);
            u.speciesEjectScale.value[k] = ejectScale(this.typeMass(t), meanMass);
            this.speciesMass[k] = this.typeMass(t);
        });
    }

    beforeSubstep(dt: number): void {
        if (this.supernovaPending) this.velocityUniforms.supernovaActive.value = 1;
        this.shock.advance(dt);
    }

    /** The density pyramid is ready: sums the gravity of its levels on the grid the velocity pass reads. */
    afterDensity(): void {
        const { density, screenSize } = this.context;
        const offset = density.domainOffset.value;
        this.gravity.render(gravityWindow(offset.x, offset.y, density.domainSize.value, screenSize.value.x, screenSize.value.y,
            DENSITY_RES, GRAVITY_WINDOW_MARGIN));
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
        this.frame++;
        if (this.frame % CLUSTER_CHECK_INTERVAL === 0 && this.reductionOnGpu() && !this.measuring && this.ready()) this.measure();
    }

    /** Whether a supernova can be looked for: not within the cooldown, not while one is about to fire. */
    private ready(): boolean {
        return this.cooldown <= 0 && !this.supernovaPending;
    }

    private reductionOnGpu(): boolean {
        return this.reduction !== null && !this.cpuForced;
    }

    /** Searches the densest disk on the GPU; the few floats come back a frame or two later and are taken as the read-back's analysis was. */
    private measure(): void {
        const { reduction, generation, concentrationRadius: radius } = this;
        if (!reduction) return;
        const size = this.context.screenSize.value;
        this.measuring = true;
        let reading: Promise<ConcentrationReading>;
        try {
            reading = reduction.measure(this.context.positionTexture(), radius, size.x, size.y, this.totalMass);
        } catch (err) {
            reading = Promise.reject(err);
        }
        reading
            .then(result => { if (generation === this.generation) this.takeConcentration(result, radius); })
            .catch(err => console.error(err))
            .finally(() => { if (generation === this.generation) this.measuring = false; });
    }

    /** The CPU path (no float32 blending): the pipeline reads the positions back when this asks. */
    wantsReadback(): boolean {
        return !this.reductionOnGpu() && this.ready();
    }

    onReadback(positions: Float32Array, count: number): void {
        const size = this.context.screenSize.value;
        const radius = this.concentrationRadius;
        this.takeConcentration(analyzeConcentration(positions, count, radius, size.x, size.y, this.speciesMass), radius);
    }

    /**
     * The densest disk of `radius` px is known (either way): updates the meter and, when it holds the threshold's share of the mass,
     * arms the supernova that ejects the particles inside that disk at the next substep.
     */
    takeConcentration(result: Concentration, radius: number): void {
        this.concentration = result.fraction;
        if (result.members === 0 || result.fraction < this.supernovaThreshold || !this.ready()) return;

        const u = this.velocityUniforms;
        u.supernovaCenter.value.set(result.centerX, result.centerY);
        u.supernovaRadius.value = radius;
        u.ejectaRadius.value = ejectaRadius(result.spread, radius);
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
        this.generation++;
        this.gravity.dispose();
        this.reduction?.dispose();
    }
}
