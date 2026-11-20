import * as THREE from 'three';
import {
    MAX_SPECIES, PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_DRIFT_GAIN, PROTOSTAR_FUSION_C2, PROTOSTAR_FUSION_T_REF,
    PROTOSTAR_GLOW_FUSION, PROTOSTAR_GLOW_HEATING_REF, PROTOSTAR_GLOW_MAX, PROTOSTAR_GLOW_T_RANGE,
    PROTOSTAR_GLOW_TEMPERATURE, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, PROTOSTAR_MAX_SPEED,
    PROTOSTAR_RATE_SMOOTHING, PROTOSTAR_RESTITUTION, PROTOSTAR_STATS_INTERVAL, REMOVED_PARTICLE_W, TOTAL_MASS,
} from '../../config';
import { glslFloat } from '../../gl/withDefines';
import type { ParamValue, ParamValues, ParticleType } from '../algorithm';
import type { GpuModel, GpuModelContext, GpuVariable, InitialState } from '../gpuModel';
import { countTypes } from '../typeCounts';
import { centerOfMass, driftCorrection, type Vec2 } from './drift';
import { PROTOSTAR_PARAM, PROTOSTAR_PROPERTY, PROTOSTAR_REACTIONS, PROTOSTAR_STAT } from './declaration';
import { ProtostarGrids, withProtostarCommon, type ProtostarGridTargets } from './grids';
import { fillCloud } from './initialConditions';
import { reactionArrays } from './reactions';
import velocityFrag from '../../shaders/protostar-velocity.frag?raw';
import positionFrag from '../../shaders/protostar-position.frag?raw';
import accelFrag from '../../shaders/protostar-accel.frag?raw';

const P = PROTOSTAR_PARAM;
const ACCEL = 'textureAccel';
const SEED_PERIOD = 1 << 24;                       // the substep seed stays an exact float
const REACTION_PARAMS: ReadonlySet<string> = new Set([
    P.feedback, ...PROTOSTAR_REACTIONS.flatMap(r => [r.rateParam, r.exponentParam]),
]);

/** Physical scales of a run, from the area size at restart (L = min(width, height)). */
interface RunScales {
    length: number;        // L, px
    cloudRadius: number;   // px
    count: number;
}

const numberOr = (value: ParamValue | undefined, fallback: number): number => typeof value === 'number' ? value : fallback;

/**
 * GPU side of the protostar algorithm. Before every substep the grid passes (grids.ts) deposit
 * the particles and compute density, temperature, mean velocity, fusion heating and softened
 * gravity; the GPGPU pass then integrates with velocity Verlet (the previous acceleration is the
 * extra state variable `textureAccel`), cools, heats and fuses (types change in the position pass).
 * Every few frames the grids are reduced on the GPU to three numbers for the stats, and the
 * positions are read back to count the particles per type and measure the drift of the star.
 */
export class ProtostarModel implements GpuModel {
    readonly usesDensityField = false;
    readonly glow = 'state' as const;
    private readonly grids: ProtostarGrids;
    readonly velocityShader: string;
    readonly positionShader: string;
    readonly variables: readonly GpuVariable[];
    readonly velocityUniforms: Record<string, THREE.IUniform>;
    readonly positionUniforms: Record<string, THREE.IUniform>;
    private readonly own = {
        coolingRate: { value: 0 },
        opacityDensity: { value: 1 },
        maxSpeed: { value: 1 },
        restitution: { value: PROTOSTAR_RESTITUTION },
        driftKick: { value: new THREE.Vector2() },
    };

    private params: ParamValues = {};
    private types: readonly ParticleType[] = [];
    private scales: RunScales;
    private initialAccel: Float32Array | null = null;
    private substep = 0;
    private frame = 0;
    private generation = 0;
    private readingStats = false;
    private readonly statsBuffer = new Float32Array(4);
    private coreTemperature: number | null = null;
    private coreDensity: number | null = null;
    private fusionRate: number | null = null;
    private typeCounts: number[] | null = null;
    private lastCenter: Vec2 | null = null;
    private sinceLastCenter = 0;                       // s
    private pendingKick: Vec2 | null = null;

    constructor(private readonly context: GpuModelContext) {
        this.grids = new ProtostarGrids(context.renderer, context.geometry, context.speciesUniforms.splatMass,
            context.drawing.uniforms);
        const common = this.grids.common;
        const [tMin, tMax] = PROTOSTAR_GLOW_T_RANGE;
        this.velocityShader = withProtostarCommon(velocityFrag, {
            GLOW_T_MIN: glslFloat(tMin), GLOW_T_MAX: glslFloat(tMax),
            GLOW_TEMPERATURE: glslFloat(PROTOSTAR_GLOW_TEMPERATURE), GLOW_FUSION: glslFloat(PROTOSTAR_GLOW_FUSION),
            GLOW_HEATING_REF: glslFloat(PROTOSTAR_GLOW_HEATING_REF), GLOW_MAX: glslFloat(PROTOSTAR_GLOW_MAX),
        });
        this.positionShader = withProtostarCommon(positionFrag, { REMOVED_W: glslFloat(REMOVED_PARTICLE_W) });
        this.velocityUniforms = { ...common, ...this.own };
        this.positionUniforms = { ...common };
        this.variables = [{
            name: ACCEL,
            shader: withProtostarCommon(accelFrag),
            uniforms: { ...common },
            init: data => { if (this.initialAccel) data.set(this.initialAccel.subarray(0, data.length)); },
        }];
        const size = context.screenSize.value;
        this.scales = { length: Math.max(1, Math.min(size.x, size.y)), cloudRadius: 1, count: 1 };
    }

    /** Dev-only, read-only: the render targets of the grid passes, for the lab page (src/lab). */
    get debugGridTargets(): ProtostarGridTargets {
        return this.grids.targets;
    }

    /** Dev-only, read-only: the values the model holds, whatever their kind. */
    get debugParams(): Readonly<ParamValues> {
        return this.params;
    }

    typeMass(t: ParticleType): number {
        return t.values[PROTOSTAR_PROPERTY.mass];
    }

    typeSize(t: ParticleType): number {
        return t.values[PROTOSTAR_PROPERTY.size];
    }

    setParam(key: string, value: ParamValue): void {
        this.params[key] = value;
        if (key === P.cooling && typeof value === 'number') this.own.coolingRate.value = value;
        if (key === P.opacity && typeof value === 'number') this.own.opacityDensity.value = value;
        if (REACTION_PARAMS.has(key)) this.updateReactions();
    }

    /** G_eff (px^3 / (mass s^2)) for a run of length scale L. */
    private gravity(length: number): number {
        return numberOr(this.params[P.gravity], 0) * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS;
    }

    private softening(length: number): number {
        return numberOr(this.params[P.softening], 0) / 100 * length;
    }

    initialize(state: InitialState): void {
        const length = Math.max(1, Math.min(state.width, state.height));
        const radius = PROTOSTAR_CLOUD_RADIUS * length;
        this.initialAccel = fillCloud(state, {
            radius, gravity: this.gravity(length), totalMass: TOTAL_MASS, softening: this.softening(length),
            rotation: numberOr(state.params[P.rotation], 0), agitation: numberOr(state.params[P.agitation], 0),
        });
    }

    reset(params: ParamValues): void {
        const size = this.context.screenSize.value;
        const length = Math.max(1, Math.min(size.x, size.y));
        this.scales = { length, cloudRadius: PROTOSTAR_CLOUD_RADIUS * length, count: Math.max(1, this.context.activeCount()) };
        this.params = { ...this.params, ...params };
        this.initialAccel = null;
        this.generation++;
        this.frame = 0;
        this.coreTemperature = null;
        this.coreDensity = null;
        this.fusionRate = null;
        this.typeCounts = null;
        this.lastCenter = null;
        this.pendingKick = null;
        this.own.maxSpeed.value = PROTOSTAR_MAX_SPEED * length;
        this.grids.common.fusionTRef.value = PROTOSTAR_FUSION_T_REF * length * length;
    }

    updateSpecies(types: readonly ParticleType[]): void {
        this.types = types;
        this.updateReactions();
    }

    private updateReactions(): void {
        if (this.types.length === 0) return;
        const arrays = reactionArrays(PROTOSTAR_REACTIONS, this.types, this.params, PROTOSTAR_PROPERTY.mass,
            PROTOSTAR_FUSION_C2, numberOr(this.params[P.feedback], 0), MAX_SPECIES);
        const c = this.grids.common;
        // In place: the arrays are shared by reference with every material.
        for (let k = 0; k < MAX_SPECIES; k++) {
            c.reactionTo.value[k] = arrays.to[k];
            c.reactionKeep.value[k] = arrays.keep[k];
            c.reactionRate.value[k] = arrays.rate[k];
            c.reactionExponent.value[k] = arrays.exponent[k];
            c.reactionReference.value[k] = arrays.reference[k];
            c.reactionDensityExponent.value[k] = arrays.densityExponent[k];
            c.reactionEnergy.value[k] = arrays.energy[k];
        }
    }

    beforeSubstep(dt: number): void {
        const { context, grids } = this;
        // The kick lasts one substep.
        this.own.driftKick.value.set(this.pendingKick?.x ?? 0, this.pendingKick?.y ?? 0);
        this.pendingKick = null;
        this.sinceLastCenter += dt;
        const { length, cloudRadius, count } = this.scales;
        const size = context.screenSize.value;
        const cell = Math.max(size.x, size.y, 1) / PROTOSTAR_GRID_RES;
        const meanMass = TOTAL_MASS / count;
        const rho0 = TOTAL_MASS / (Math.PI * cloudRadius * cloudRadius);
        const neighborhood = 9 * cell * cell;
        const depositMassScale = 1 / meanMass;
        grids.common.gridCell.value = cell;
        grids.common.seed.value = this.substep = (this.substep + 1) % SEED_PERIOD;
        grids.setScales({
            depositMassScale,
            depositVelScale: 1 / length,
            densityPerDeposit: meanMass / (neighborhood * rho0),
            gravityPerDeposit: this.gravity(length) * meanMass,
            softening: this.softening(length),
        });
        grids.update(context.positionTexture(), context.velocityTexture());
    }

    endFrame(): void {
        this.frame++;
        if (this.frame % PROTOSTAR_STATS_INTERVAL !== 0 || this.readingStats) return;
        const { renderer } = this.context;
        if (!renderer.readRenderTargetPixelsAsync) return;
        this.grids.reduceStats();
        const gen = this.generation;
        this.readingStats = true;
        renderer.readRenderTargetPixelsAsync(this.grids.reduce2.target, 0, 0, 1, 1, this.statsBuffer)
            .then(() => {
                if (gen !== this.generation) return;
                const [density, temperature, rate] = this.statsBuffer;
                this.coreDensity = density;
                this.coreTemperature = temperature;
                this.fusionRate = this.fusionRate === null ? rate
                    : this.fusionRate + PROTOSTAR_RATE_SMOOTHING * (rate - this.fusionRate);
            })
            .catch(err => console.error(err))
            .finally(() => { this.readingStats = false; });
    }

    onReadback(positions: Float32Array, count: number): void {
        this.typeCounts = countTypes(positions, count, Math.max(1, this.types.length));
        const center = centerOfMass(positions, count, this.types.map(t => this.typeMass(t)));
        // The drawings move the star for real: no correction then, it would hold the star in place.
        if (center && this.lastCenter && !this.context.drawing.active) {
            this.pendingKick = driftCorrection(this.lastCenter, center, this.sinceLastCenter, PROTOSTAR_DRIFT_GAIN);
        }
        this.lastCenter = center;
        this.sinceLastCenter = 0;
    }

    stat(key: string): number | null {
        switch (key) {
            case PROTOSTAR_STAT.coreTemperature: return this.coreTemperature;
            case PROTOSTAR_STAT.coreDensity: return this.coreDensity;
            case PROTOSTAR_STAT.fusionRate: return this.fusionRate;
            default: return null;
        }
    }

    liveTypeCounts(): readonly number[] | null {
        return this.typeCounts;
    }

    dispose(): void {
        this.generation++;
        this.grids.dispose();
    }
}
