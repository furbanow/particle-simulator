import * as THREE from 'three';
import {
    MAX_SPECIES, PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_ENERGY_FIRST_FRAME, PROTOSTAR_FUSION_C2,
    PROTOSTAR_FUSION_T_REF, PROTOSTAR_GLOW_FUSION, PROTOSTAR_GLOW_HEATING_REF, PROTOSTAR_GLOW_MAX, PROTOSTAR_GLOW_T_RANGE,
    PROTOSTAR_GLOW_TEMPERATURE, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_GRID_RES, PROTOSTAR_HEATING_T_FLOOR, PROTOSTAR_JEANS_CELLS, PROTOSTAR_MAX_SPEED,
    PROTOSTAR_MAX_SUBSTEP_RATIO, PROTOSTAR_MAX_SUBSTEPS, PROTOSTAR_MIN_SUBSTEP_RATIO, PROTOSTAR_RATE_SMOOTHING, PROTOSTAR_RESTITUTION, PROTOSTAR_STATS_INTERVAL, PROTOSTAR_STEP_COURANT,
    PROTOSTAR_STEP_MAX_READINGS, PROTOSTAR_STEP_OMEGA, PROTOSTAR_STEP_READ_INTERVAL, PROTOSTAR_STEP_RELEASE, PROTOSTAR_THICKNESS_CEILING,
    PROTOSTAR_THICKNESS_FLOOR_CELLS, PROTOSTAR_THICKNESS_Q_FACTOR, PROTOSTAR_THICKNESS_REFERENCE, TOTAL_MASS,
} from '../../config';
import { glslFloat } from '../../gl/withDefines';
import type { ParamValue, ParamValues, ParticleType } from '../algorithm';
import type { GpuModel, GpuModelContext, GpuVariable, GridOverlay, InitialState } from '../gpuModel';
import type { Vec2 } from '../../util/math';
import { collisionShift } from './collisions';
import { jeansPerDensity } from './cooling';
import { EnergyBalance, type EnergyStats } from './energy';
import { PROTOSTAR_PARAM, PROTOSTAR_PROPERTY, PROTOSTAR_REACTIONS, PROTOSTAR_STAT } from './declaration';
import { inverseMolecularWeights } from './composition';
import { ProtostarGrids, withProtostarCommon, type GridScales, type ProtostarGridTargets } from './grids';
import { fillCloud, type CloudSummary } from './initialConditions';
import { reactionArrays } from './reactions';
import { isStabilityMapMode, type StabilityMapMode } from './stability';
import { StabilityPass } from './stabilityPass';
import { TypeCountReduction } from './typeReduction';
import { REDUCTION_FLOATS, REDUCTION_TEXELS, unpackReduction, type Reduction, type ReductionScales } from './reduction';
import { criticalStep, substepBounds, SubstepController } from './timeStep';
import { initialThickness, thicknessPerDispersion, type ThicknessBounds } from './thickness';
import velocityFrag from '../../shaders/protostar-velocity.frag?raw';
import positionFrag from '../../shaders/protostar-position.frag?raw';
import accelFrag from '../../shaders/protostar-accel.frag?raw';

const P = PROTOSTAR_PARAM;
const ACCEL = 'textureAccel';
const SEED_PERIOD = 1 << 24;                       // the substep seed stays an exact float
const REACTION_PARAMS: ReadonlySet<string> = new Set([
    P.feedback, ...PROTOSTAR_REACTIONS.map(r => r.rateParam),
]);

/** Physical scales of a run, from the area size at restart (L = min(width, height)). */
interface RunScales {
    length: number;        // L, px
    cloudRadius: number;   // px
    count: number;
}

const numberOr = (value: ParamValue | undefined, fallback: number): number => typeof value === 'number' ? value : fallback;

/** The scales of a reduction when no substep has drawn the grids yet: the sums are all zero then. */
const NO_SCALES: ReductionScales = { massPerDeposit: 1, depositVelScale: 1, gravityPerDeposit: 0, softening: 0 };

/** What the adaptive step saw and decided in a frame (the lab records it). */
export interface StepInfo {
    steps: number;
    /** The criterion's longest substep, s; null before the first reading. */
    dtCritical: number | null;
    maxSpeed: number | null;
    maxAcceleration: number | null;
    /** Frames between the reading's frame and this one. */
    age: number | null;
}

/** The energy of the cloud as the diagnostics see it, in simulation units (mass x px^2/s^2). */
export interface ProtostarEnergy extends EnergyStats {
    kinetic: number;
    /** Gravitational (Plummer) potential energy of the positions that go with `kinetic`, the self-interaction of the particles removed. */
    potential: number;
}

/**
 * GPU side of the protostar algorithm. Before every substep the grid passes (grids.ts) deposit
 * the particles and compute density, temperature, mean velocity, fusion heating and softened
 * gravity; the GPGPU pass then integrates with velocity Verlet (the previous acceleration is the
 * extra state variable `textureAccel`), cools, heats and fuses. A particle is a parcel of constant mass (A4): a
 * fusing parcel changes its type in the position pass and nothing else (its mass and velocity stay: the momentum is conserved
 * exactly, and no particle is removed). Every few frames the grids are reduced on the GPU (reduction.ts) to the numbers of the stats
 * and of the diagnostics (energy, extreme speeds and accelerations, center of mass...), and the particles of each type are counted
 * on the GPU (typeReduction.ts); both are read back asynchronously, a few texels each.
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
        radiation: { value: 0 },
        opacityKappa: { value: 1 },
        minTemperature: { value: 0 },
        jeansPerDensity: { value: 0 },
        maxSpeed: { value: 1 },
        heatingTFloor: { value: 0 },
        restitution: { value: PROTOSTAR_RESTITUTION },
    };
    /** The previous substep's length (s), read by the velocity and the position passes for the two half kicks of the step that ended. */
    private readonly dtPrev = { value: 0 };

    private params: ParamValues = {};
    private types: readonly ParticleType[] = [];
    private scales: RunScales;
    private substep = 0;
    private frame = 0;
    private generation = 0;
    private readingStats = false;
    private pendingReading: Promise<void> | null = null;
    private readingSequence = 0;                       // numbers the reductions as they are read...
    private readingApplied = 0;                        // ...so that a late one never replaces a newer one
    private latestReduction: Reduction | null = null;
    private latestReductionFrame = 0;                  // the frame whose end the latest reduction describes
    private readingsInFlight = 0;
    private diagnostics = true;
    private adaptiveStep = false;
    private jeansFloor = false;
    private adaptiveThickness = false;
    private stabilityMode: StabilityMapMode = 'off';
    private stability: StabilityPass | null = null;    // built when the map is first shown
    private stabilityStale = true;                     // the grids changed since the map was drawn
    private gravityDensity = 0;                        // G_eff rho0 of the last substep, px/s^2
    private readonly stepController = new SubstepController(PROTOSTAR_STEP_RELEASE);
    private lastDt = 0;                                // the length of the previous substep of this run, 0 before the first
    private stepInfo: StepInfo | null = null;
    private readonly energyBalance = new EnergyBalance();
    private currentEnergy: ProtostarEnergy | null = null;
    private reductionScales: ReductionScales | null = null;     // those of the last substep's grids
    private gridScales: GridScales | null = null;               // the scales the last substep's grids were drawn with
    private gridsDrawn = false;                        // the grids hold this run's state (not a previous run's)
    private stashedFrame = -1;                         // the frame in which the potential of the previous grids was kept
    private coreTemperature: number | null = null;
    private coreDensity: number | null = null;
    private fusionRate: number | null = null;
    private typeCounts: number[] | null = null;
    private readonly typeReduction: TypeCountReduction;
    private readingTypes = false;
    private initialCloud: CloudSummary | null = null;
    /**
     * Dev-only (the lab): fills the initial positions and velocities instead of the cloud (see fillCloud); for gases of known temperature. Null in the application.
     */
    debugInitialState: ((state: InitialState) => void) | null = null;
    private flatRates = false;

    /**
     * Dev-only (the lab): true makes every rate law independent of the temperature, lambda (rho X)^n, for gases whose heating must be
     * known whatever their temperature. A restart gives it back its value, false.
     */
    get debugFlatRates(): boolean {
        return this.flatRates;
    }

    set debugFlatRates(flat: boolean) {
        this.flatRates = flat;
        this.updateReactions();
    }

    /** Dev-only (the lab): a number of substeps per frame that replaces the fixed and the adaptive counts (a reference run at a smaller step); null in the application. */
    debugSubsteps: number | null = null;

    /** Dev-only (the lab): other constants of the adaptive step (omega, courant, the bounds' ratios to the fixed count, frames between reads), to tune them; null in the application. */
    debugCriterion: { omega?: number; courant?: number; minRatio?: number; ratio?: number; readInterval?: number } | null = null;

    /** Dev-only, read-only: what the initial cloud of the latest restart was made of (its disc's table, the energies it set); null with a debug initial state. */
    get debugInitialCloud(): CloudSummary | null {
        return this.initialCloud;
    }

    constructor(private readonly context: GpuModelContext) {
        this.grids = new ProtostarGrids(context.renderer, context.geometry, context.drawing.uniforms);
        this.typeReduction = new TypeCountReduction(context.renderer);
        const common = this.grids.common;
        const [tMin, tMax] = PROTOSTAR_GLOW_T_RANGE;
        this.velocityShader = withProtostarCommon(velocityFrag, {
            GLOW_T_MIN: glslFloat(tMin), GLOW_T_MAX: glslFloat(tMax),
            GLOW_TEMPERATURE: glslFloat(PROTOSTAR_GLOW_TEMPERATURE), GLOW_FUSION: glslFloat(PROTOSTAR_GLOW_FUSION),
            GLOW_HEATING_REF: glslFloat(PROTOSTAR_GLOW_HEATING_REF), GLOW_MAX: glslFloat(PROTOSTAR_GLOW_MAX),
        });
        this.positionShader = withProtostarCommon(positionFrag, { GAS_THERMO: 1 });
        this.grids.shareStepLength(this.dtPrev);
        this.velocityUniforms = { ...common, ...this.own, dtPrev: this.dtPrev };
        this.positionUniforms = { ...common, dtPrev: this.dtPrev };
        this.variables = [{
            name: ACCEL,
            shader: withProtostarCommon(accelFrag),
            uniforms: { ...common },
            // z = 1 marks the first step of a run: the velocity stored is then v(t) itself and no half kick is owed (the
            // acceleration pass writes 0 there from the next step on).
            init: (data, state) => { for (let i = 0; i < state.count; i++) data[i * 4 + 2] = 1; },
        }];
        const size = context.screenSize.value;
        this.scales = { length: Math.max(1, Math.min(size.x, size.y)), cloudRadius: 1, count: 1 };
    }

    /** Dev-only, read-only: the render targets of the grid passes, for the lab page (src/lab). */
    get debugGridTargets(): ProtostarGridTargets {
        return this.grids.targets;
    }

    /** Dev-only: the grid passes themselves (their deposit inputs, the switch of the second deposit), for the lab page. */
    get debugGrids(): ProtostarGrids {
        return this.grids;
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
        if (key === P.radiation && typeof value === 'number') this.own.radiation.value = value;
        if (key === P.kappa && typeof value === 'number') this.own.opacityKappa.value = value;
        if (key === P.minTemperature && typeof value === 'number') this.own.minTemperature.value = value;
        if (key === P.jeansFloor) this.jeansFloor = value === true;
        if (key === P.adaptiveThickness) this.adaptiveThickness = value === true;
        if (key === P.tscDeposit) this.grids.setTscDeposit(value === true);
        if (key === P.collisions) this.grids.setCollisions(value === true);
        if (key === P.diagnostics) this.setDiagnostics(value === true);
        if (key === P.adaptiveTimeStep) this.setAdaptiveStep(value === true);
        if (key === P.stabilityMap) {
            this.stabilityMode = isStabilityMapMode(value) ? value : 'off';
            this.stabilityStale = true;
        }
        if (REACTION_PARAMS.has(key)) this.updateReactions();
    }

    private setDiagnostics(on: boolean): void {
        if (on === this.diagnostics) return;
        this.diagnostics = on;
        this.clearEnergy();
    }

    private setAdaptiveStep(on: boolean): void {
        if (on === this.adaptiveStep) return;
        this.adaptiveStep = on;
        this.stepController.reset();
        this.stepInfo = null;
    }

    /** The energy readings start again: a restart, or the diagnostics switched on or off. */
    private clearEnergy(): void {
        this.energyBalance.reset();
        this.currentEnergy = null;
        this.stashedFrame = -1;
    }

    /** G_eff (px^3 / (mass s^2)) for a run of length scale L. */
    private gravity(length: number): number {
        return numberOr(this.params[P.gravity], 0) * PROTOSTAR_GRAVITY_UNIT * length ** 3 / TOTAL_MASS;
    }

    private softening(length: number): number {
        return numberOr(this.params[P.softening], 0) / 100 * length;
    }

    /** The bounds of the adaptive thickness (A11), px: a cell, and a share of the initial cloud radius. */
    private thicknessBounds(cell: number, cloudRadius: number): ThicknessBounds {
        return { floor: PROTOSTAR_THICKNESS_FLOOR_CELLS * cell, ceiling: PROTOSTAR_THICKNESS_CEILING * cloudRadius };
    }

    initialize(state: InitialState): void {
        this.initialCloud = null;
        if (this.debugInitialState) {
            this.debugInitialState(state);
            return;
        }
        const length = Math.max(1, Math.min(state.width, state.height));
        const radius = PROTOSTAR_CLOUD_RADIUS * length;
        const profile = state.params[P.profile] === 'maclaurin' ? 'maclaurin' : 'uniform';
        const virial = numberOr(state.params[P.alphaVir], 0), rotation = numberOr(state.params[P.betaRot], 0);
        const gravity = this.gravity(length);
        // With the adaptive thickness the disc's table is softened by the thickness the cloud will have (A11): alpha_vir and
        // beta_rot stay the energies of the gravity the cloud feels.
        const softening = state.params[P.adaptiveThickness] === true
            ? initialThickness({
                radius, gravity, totalMass: TOTAL_MASS, profile, virial, rotation, softening: this.softening(length),
                bounds: this.thicknessBounds(Math.max(state.width, state.height, 1) / PROTOSTAR_GRID_RES, radius),
            })
            : this.softening(length);
        this.initialCloud = fillCloud(state, {
            radius, gravity, totalMass: TOTAL_MASS, softening, profile, virial, rotation,
            turbulence: state.params[P.turbulence] === 'correlated' ? 'correlated' : 'white',
        });
    }

    reset(params: ParamValues): void {
        const size = this.context.screenSize.value;
        const length = Math.max(1, Math.min(size.x, size.y));
        this.scales = { length, cloudRadius: PROTOSTAR_CLOUD_RADIUS * length, count: Math.max(1, this.context.activeCount()) };
        this.params = { ...this.params, ...params };
        this.flatRates = false;
        this.updateReactions();
        this.generation++;
        this.readingsInFlight = 0;
        this.frame = 0;
        this.substep = 0;                              // a restart replays the same random stream (the lab relies on it)
        this.coreTemperature = null;
        this.coreDensity = null;
        this.fusionRate = null;
        this.latestReduction = null;
        this.latestReductionFrame = 0;
        this.reductionScales = null;
        this.gridScales = null;
        this.gridsDrawn = false;
        this.lastDt = 0;                               // the first substep of the run owes no half kick (z = 1), whatever dtPrev holds
        this.stepController.reset();
        this.stepInfo = null;
        this.clearEnergy();
        this.stabilityStale = true;
        this.typeCounts = null;
        this.own.maxSpeed.value = PROTOSTAR_MAX_SPEED * length;
        this.grids.common.fusionTRef.value = PROTOSTAR_FUSION_T_REF * length * length;
        this.own.heatingTFloor.value = PROTOSTAR_HEATING_T_FLOOR * PROTOSTAR_FUSION_T_REF * length * length;
        this.grids.startRun();
    }

    updateSpecies(types: readonly ParticleType[], typeCounts: readonly number[]): void {
        this.types = types;
        // The particles are parcels of constant mass: every type has the same, whatever its atomic mass (which only feeds 1 / mu and the
        // energy of a fusion). The layers that weigh the particles by mass (the nebula) see the same mass, so the cloud does not brighten
        // as its parcels turn into heavier atoms. Mass per particle: the cloud's total over the particles of the run.
        const parcel = TOTAL_MASS / Math.max(1, typeCounts.reduce((sum, n) => sum + n, 0));
        const masses = new Array<number>(MAX_SPECIES).fill(parcel);
        this.grids.setDepositMasses(masses);
        masses.forEach((m, k) => { this.context.speciesUniforms.splatMass.value[k] = m; });
        this.grids.setInverseMolecularWeights(inverseMolecularWeights(types, PROTOSTAR_PROPERTY.mass, MAX_SPECIES));
        this.updateReactions();
    }

    private updateReactions(): void {
        if (this.types.length === 0) return;
        const arrays = reactionArrays(PROTOSTAR_REACTIONS, this.types, this.params, PROTOSTAR_PROPERTY.mass,
            PROTOSTAR_FUSION_C2, numberOr(this.params[P.feedback], 0), MAX_SPECIES, this.flatRates);
        const c = this.grids.common;
        // In place: the arrays are shared by reference with every material.
        for (let k = 0; k < MAX_SPECIES; k++) {
            c.reactionTo.value[k] = arrays.to[k];
            c.reactionRate.value[k] = arrays.rate[k];
            c.reactionPower.value[k] = arrays.power[k];
            c.reactionBarrier.value[k] = arrays.barrier[k];
            c.reactionBarrierPower.value[k] = arrays.barrierPower[k];
            c.reactionFuel.value[k] = arrays.fuel[k];
            c.reactionReference.value[k] = arrays.reference[k];
            c.reactionDensityExponent.value[k] = arrays.densityExponent[k];
            c.reactionEnergy.value[k] = arrays.energy[k];
        }
        this.grids.setFuelChannels(arrays.fuel);
    }

    /**
     * How many substeps the next frame of `frameTime` seconds runs (the pipeline gives them all frameTime / count seconds). The count
     * the speed slider alone gives (`fixedSteps`) unless the adaptive step is on (the flag) and a reduction has been read: then the
     * criterion of timeStep.ts on its maxima. The static drawings' and the point force's pull are not in those maxima: while one acts,
     * the count is at least the fixed one.
     */
    substepCount(frameTime: number, fixedSteps: number): number {
        if (this.debugSubsteps !== null) return Math.max(1, Math.round(this.debugSubsteps));
        if (!this.adaptiveStep) return fixedSteps;
        const reading = this.latestReduction;
        const size = this.context.screenSize.value;
        const tuned = this.debugCriterion;
        // The length of the criterion: the fixed softening, or the thinnest layer of the latest reduction (A11).
        const softening = this.adaptiveThickness ? reading?.minSoftening ?? 0 : this.softening(this.scales.length);
        const criterion = {
            cell: Math.max(size.x, size.y, 1) / PROTOSTAR_GRID_RES, softening,
            courant: tuned?.courant ?? PROTOSTAR_STEP_COURANT, omega: tuned?.omega ?? PROTOSTAR_STEP_OMEGA,
        };
        const dtCritical = reading ? criticalStep(reading.maxSpeed, reading.maxAcceleration, criterion) : null;
        const bounds = substepBounds(fixedSteps, tuned?.minRatio ?? PROTOSTAR_MIN_SUBSTEP_RATIO, tuned?.ratio ?? PROTOSTAR_MAX_SUBSTEP_RATIO,
            PROTOSTAR_MAX_SUBSTEPS);
        let steps = this.stepController.next(frameTime, dtCritical, fixedSteps, bounds);
        if (this.context.drawing.active) steps = Math.max(steps, fixedSteps);
        this.stepInfo = {
            steps, dtCritical, maxSpeed: reading?.maxSpeed ?? null, maxAcceleration: reading?.maxAcceleration ?? null,
            age: reading ? this.frame - this.latestReductionFrame : null,
        };
        return steps;
    }

    beforeSubstep(dt: number): void {
        const { context, grids } = this;
        // The previous substep's length, for the two half kicks that belong to it. A call with no time (the lab draws the grids that way)
        // is not a substep: it leaves the lengths alone. The first substep of a run owes no half kick, so its dtPrev is not used.
        if (dt > 0) {
            this.dtPrev.value = this.lastDt > 0 ? this.lastDt : dt;
            this.lastDt = dt;
        }
        const { length, cloudRadius, count } = this.scales;
        const size = context.screenSize.value;
        const cell = Math.max(size.x, size.y, 1) / PROTOSTAR_GRID_RES;
        const meanMass = TOTAL_MASS / count;
        const rho0 = TOTAL_MASS / (Math.PI * cloudRadius * cloudRadius);
        const neighborhood = 9 * cell * cell;
        const depositMassScale = 1 / meanMass;
        grids.common.gridCell.value = cell;
        // The Jeans floor of the dispersion per rho0 (cooling.ts): set every substep, as the cell and G are.
        this.own.jeansPerDensity.value = this.jeansFloor
            ? jeansPerDensity(PROTOSTAR_JEANS_CELLS, cell, this.gravity(length), rho0) : 0;
        grids.common.seed.value = this.substep = (this.substep + 1) % SEED_PERIOD;
        const scales: GridScales = {
            depositMassScale,
            depositVelScale: 1 / length,
            densityPerDeposit: meanMass / (neighborhood * rho0),
            gravityPerDeposit: this.gravity(length) * meanMass,
            softening: this.softening(length),
            thickness: {
                on: this.adaptiveThickness, perDispersion: thicknessPerDispersion(this.gravity(length), rho0),
                ...this.thicknessBounds(cell, cloudRadius), reference: PROTOSTAR_THICKNESS_REFERENCE * length,
            },
            // The collision grid (C1): one particle's mass over a cell's area in rho0, and the substep's random shift.
            collisionDensity: meanMass / (cell * cell * rho0),
            collisionShift: collisionShift(this.substep, cell),
        };
        // The energy of the frame about to end needs the potential of the grids this substep is going to overwrite.
        if (this.diagnostics && this.gridsDrawn && this.readingDue(this.frame + 1)) {
            grids.stashPotential();
            this.stashedFrame = this.frame;
        }
        grids.setScales(scales);
        this.gridScales = scales;
        grids.update(context.positionTexture(), context.velocityTexture(), dt, context.variableTexture(ACCEL));
        this.gridsDrawn = true;
        this.stabilityStale = true;
        this.gravityDensity = this.gravity(length) * rho0;
        this.reductionScales = {
            massPerDeposit: meanMass, depositVelScale: scales.depositVelScale,
            gravityPerDeposit: scales.gravityPerDeposit, softening: scales.softening,
        };
    }

    /** Whether the reduction is read at the end of frame number `frame` (1 for the first): the stats' frames, and the first one for the energy. */
    private readingDue(frame: number): boolean {
        return frame % PROTOSTAR_STATS_INTERVAL === 0 || frame === PROTOSTAR_ENERGY_FIRST_FRAME;
    }

    endFrame(): void {
        this.frame++;
        const statsDue = this.frame % PROTOSTAR_STATS_INTERVAL === 0;
        // The adaptive step reads the maxima more often than the stats do, as long as the reads in flight do not pile up.
        const stepDue = this.adaptiveStep && this.frame % (this.debugCriterion?.readInterval ?? PROTOSTAR_STEP_READ_INTERVAL) === 0
            && this.readingsInFlight < PROTOSTAR_STEP_MAX_READINGS;
        // The stats' frames wait for the previous stats' reading to be over (as they always did); the
        // first frame's reading, for the energy, is on its own and does not hold the stats back.
        if (statsDue ? this.readingStats : !((this.diagnostics && this.readingDue(this.frame)) || stepDue)) return;
        const { renderer } = this.context;
        if (!renderer.readRenderTargetPixelsAsync) return;
        if (statsDue) this.readTypeCounts();
        this.grids.reduceStats();
        const gen = this.generation;
        const sequence = ++this.readingSequence;
        const frame = this.frame;
        const scales = this.gridsDrawn ? this.reductionScales : null;
        // The potential kept in this frame's substeps goes with the kinetic energy the reduction sums now.
        const synchronized = this.diagnostics && this.stashedFrame === this.frame - 1;
        const buffer = new Float32Array(REDUCTION_FLOATS);           // the read is issued now: a later one can overlap it
        if (statsDue) this.readingStats = true;
        this.readingsInFlight++;
        this.pendingReading = renderer.readRenderTargetPixelsAsync(this.grids.reduce2.target, 0, 0, REDUCTION_TEXELS, 1, buffer)
            .then(() => {
                if (gen !== this.generation || sequence < this.readingApplied) return;
                this.readingApplied = sequence;
                this.latestReductionFrame = frame;
                this.takeReading(buffer, statsDue, scales, synchronized);
            })
            .catch(err => console.error(err))
            .finally(() => {
                if (statsDue) this.readingStats = false;
                if (gen === this.generation) this.readingsInFlight--;
            });
    }

    /** The reduction has been read back: updates the stats (on their frames) and the energy diagnostics. */
    private takeReading(texels: Float32Array, statsDue: boolean, scales: ReductionScales | null, synchronized: boolean): void {
        const reduction = unpackReduction(texels, scales ?? NO_SCALES, synchronized);
        this.latestReduction = reduction;
        if (statsDue) {
            this.coreDensity = reduction.peakDensity;
            this.coreTemperature = reduction.peakTemperature;
            this.fusionRate = this.fusionRate === null ? reduction.fusionRate
                : this.fusionRate + PROTOSTAR_RATE_SMOOTHING * (reduction.fusionRate - this.fusionRate);
        }
        const { kinetic, potential } = reduction.energy;
        if (!this.diagnostics || !scales || potential === null) return;
        const stats = this.energyBalance.record(kinetic, potential);
        if (!stats) return;
        this.currentEnergy = { ...stats, kinetic, potential };
    }

    /** Counts the particles of each type on the GPU and reads the counts back (a few texels), on the stats' frames. */
    private readTypeCounts(): void {
        if (this.readingTypes) return;
        const { context, typeReduction } = this;
        this.readingTypes = true;
        const gen = this.generation;
        typeReduction.render(context.positionTexture(), context.activeCount());
        typeReduction.read()
            .then(counts => { if (gen === this.generation) this.typeCounts = counts.slice(0, Math.max(1, this.types.length)); })
            .catch(err => console.error(err))
            .finally(() => { this.readingTypes = false; });
    }

    stat(key: string): number | null {
        switch (key) {
            case PROTOSTAR_STAT.coreTemperature: return this.coreTemperature;
            case PROTOSTAR_STAT.coreDensity: return this.coreDensity;
            case PROTOSTAR_STAT.fusionRate: return this.fusionRate;
            case PROTOSTAR_STAT.energyDrift: return this.energy?.drift ?? null;
            case PROTOSTAR_STAT.virialRatio: return this.energy?.virial ?? null;
            default: return null;
        }
    }

    // ---- The reduction of the grids, for the phases that consume it (reduction.ts says what each number is) ----

    /** The latest reduction of the grids, with everything below; read every PROTOSTAR_STATS_INTERVAL frames, null before the first. */
    get reduction(): Reduction | null {
        return this.latestReduction;
    }

    /** Proxy of the fastest particles' speed, px/s: the largest |mean velocity| + sqrt(T) over the cells with mass. */
    get maxSpeed(): number | null {
        return this.latestReduction?.maxSpeed ?? null;
    }

    /** The largest gravitational acceleration of the grid over the cells with mass, px/s^2. */
    get maxAcceleration(): number | null {
        return this.latestReduction?.maxAcceleration ?? null;
    }

    /** Center of the densest cell, px. */
    get peakPosition(): Vec2 | null {
        return this.latestReduction?.peak ?? null;
    }

    /** Center of mass of the deposited particles, px. */
    get centerOfMass(): Vec2 | null {
        return this.latestReduction?.centerOfMass ?? null;
    }

    /**
     * Kinetic and potential energy (simulation units: mass x px^2/s^2), their drift since the first
     * reading of the run and the virial ratio. Null while unknown and when the diagnostics are off.
     */
    get energy(): ProtostarEnergy | null {
        return this.diagnostics ? this.currentEnergy : null;
    }

    /** Dev-only, read-only: what the adaptive step decided in the latest frame (null with the flag off); for the lab page. */
    get debugStepInfo(): StepInfo | null {
        return this.stepInfo;
    }

    /** Dev-only: the reading in flight (resolves once it is in `reduction`), for the lab page. */
    get debugReading(): Promise<void> | null {
        return this.pendingReading;
    }

    /** Dev-only, read-only: the scales the last grids were drawn with (to draw other grids alike, the lab's parity of the grid chain). */
    get debugGridScales(): GridScales | null {
        return this.gridScales;
    }

    /** Dev-only: the particle textures the grids are drawn from (positions, velocities, the previous accelerations). */
    debugGridInputs(): { positions: THREE.Texture; velocities: THREE.Texture; accelerations: THREE.Texture } {
        const { context } = this;
        return { positions: context.positionTexture(), velocities: context.velocityTexture(), accelerations: context.variableTexture(ACCEL) };
    }

    /** Dev-only, read-only: the scales that turn the sums of the last grids into simulation units, for the lab page. */
    get debugReductionScales(): ReductionScales | null {
        return this.reductionScales;
    }

    /** Dev-only: queues the GPU count of the particles of each type without reading it back, to time the passes (the lab's cost scenario). */
    debugRenderTypeCount(): void {
        this.typeReduction.render(this.context.positionTexture(), this.context.activeCount());
    }

    /** Dev-only: counts the particles of each type on the GPU right now and reads the counts back (one per type slot), for the lab page. */
    debugCountTypes(): Promise<number[]> {
        this.typeReduction.render(this.context.positionTexture(), this.context.activeCount());
        return this.typeReduction.read();
    }

    liveTypeCounts(): readonly number[] | null {
        return this.typeCounts;
    }

    /**
     * The stability map (A12), drawn from the latest grids when they changed since the last call, about the center of mass of the latest
     * reduction (the middle of the area before the first one); null while the map is off or before the first substep of the run.
     */
    overlay(): GridOverlay | null {
        if (this.stabilityMode === 'off' || !this.gridsDrawn) return null;
        const { grids } = this;
        const common = grids.common;
        this.stability ??= new StabilityPass(
            { gridGas: common.gridGas, gridThermo: common.gridThermo, gridCell: common.gridCell, fusionTRef: common.fusionTRef },
            { radiation: this.own.radiation, opacityKappa: this.own.opacityKappa, minTemperature: this.own.minTemperature },
        );
        if (this.stabilityStale) {
            const size = this.context.screenSize.value;
            this.stability.render(this.context.renderer, this.centerOfMass ?? { x: size.x / 2, y: size.y / 2 }, this.gravityDensity,
                this.adaptiveThickness ? PROTOSTAR_THICKNESS_Q_FACTOR : 1);
            this.stabilityStale = false;
        }
        return { texture: this.stability.target.texture, extent: common.gridCell.value * PROTOSTAR_GRID_RES, mode: this.stabilityMode };
    }

    /** Dev-only, read-only: the stability map's target (Q, beta, rho / rho0, kappa^2 per cell), null before the map was first shown; for the lab page. */
    get debugStabilityTarget(): THREE.WebGLRenderTarget | null {
        return this.stability?.target ?? null;
    }

    dispose(): void {
        this.generation++;
        this.typeReduction.dispose();
        this.stability?.dispose();
        this.grids.dispose();
    }
}
