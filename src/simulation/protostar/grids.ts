import * as THREE from 'three';
import {
    MAX_SPECIES, PROTOSTAR_COARSE_FACTOR, PROTOSTAR_COLLISION_ANGLE, PROTOSTAR_COLLISION_MIN_PARTICLES, PROTOSTAR_COLLISION_RATE, PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_GRID_RES, PROTOSTAR_NEAR_RADIUS, PROTOSTAR_NOISE_EXACT_MARGIN, PROTOSTAR_NOISE_N_MIN,
    PROTOSTAR_NOISE_N_SHAPE, PROTOSTAR_NOISE_N_SHAPE_TSC, PROTOSTAR_NOISE_SHIFT_MAX, PROTOSTAR_REFERENCE_INVERSE_MU, PROTOSTAR_STATS_REDUCE_RES, PROTOSTAR_TEMPERATURE_TAU,
} from '../../config';
import { additiveBlending, clipSpaceCamera, type Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { glslFloat, withDefines } from '../../gl/withDefines';
import { DRAWING_DEFINES, drawingGlsl, type DrawingUniforms } from '../drawing/DrawingField';
import commonGlsl from '../../shaders/protostar-common.glsl?raw';
import kernelGlsl from '../../shaders/deposit-kernel.glsl?raw';
import depositVert from '../../shaders/protostar-deposit.vert?raw';
import depositFrag from '../../shaders/protostar-deposit.frag?raw';
import gasFrag from '../../shaders/protostar-gas.frag?raw';
import heatFrag from '../../shaders/protostar-heat.frag?raw';
import coarseFrag from '../../shaders/grid-coarse.frag?raw';
import gravityFrag from '../../shaders/grid-gravity.frag?raw';
import potentialFrag from '../../shaders/protostar-potential.frag?raw';
import collisionVert from '../../shaders/protostar-collision.vert?raw';
import collisionFrag from '../../shaders/protostar-collision.frag?raw';
import { COLLISION_GRID_RES, COLLISION_SEED_SALT } from './collisions';
import reduceFrag from '../../shaders/protostar-reduce.frag?raw';
import { smoothingWeight } from './noiseBias';
import { REDUCTION_TEXEL, REDUCTION_TEXELS } from './reduction';

const COARSE_RES = PROTOSTAR_GRID_RES / PROTOSTAR_COARSE_FACTOR;
const REDUCE_BLOCK = PROTOSTAR_GRID_RES / PROTOSTAR_STATS_REDUCE_RES;

/**
 * Defines of every shader including protostar-common.glsl. GAS_THERMO is 0 here: the shaders that compute a fusion
 * rate (the power deposit, the position pass) set it to 1 and gasAt() then reads the temperature that feeds the rate.
 */
export const PROTOSTAR_DEFINES = {
    MAX_SPECIES, GRID_RES: PROTOSTAR_GRID_RES, FUSION_RATE_MAX: glslFloat(PROTOSTAR_FUSION_RATE_MAX),
    NOISE_N_MIN: glslFloat(PROTOSTAR_NOISE_N_MIN),
    NOISE_SHIFT_MAX: glslFloat(PROTOSTAR_NOISE_SHIFT_MAX), NOISE_EXACT_MARGIN: glslFloat(PROTOSTAR_NOISE_EXACT_MARGIN),
    INVERSE_MU_REF: glslFloat(PROTOSTAR_REFERENCE_INVERSE_MU), GAS_THERMO: 0, DEPOSIT_TSC: 0,
    COLLISION_RES: COLLISION_GRID_RES, COLLISION_MIN_PARTICLES: PROTOSTAR_COLLISION_MIN_PARTICLES,
    COLLISION_COS: glslFloat(Math.cos(PROTOSTAR_COLLISION_ANGLE)), COLLISION_SIN: glslFloat(Math.sin(PROTOSTAR_COLLISION_ANGLE)),
    COLLISION_SALT: `${COLLISION_SEED_SALT}u`,
    ...DRAWING_DEFINES,
} as const;

/** The stages of the reductions (REDUCE_STAGE of protostar-reduce.frag, POTENTIAL_STAGE of protostar-potential.frag). */
const STAGE = { first: 0, second: 1 } as const;
const reduceDefines = (stage: number, block: number) => withDefines(reduceFrag, {
    REDUCE_STAGE: stage, REDUCE_FIRST: STAGE.first, REDUCE_SECOND: STAGE.second, BLOCK: block,
    TEXEL_CORE: REDUCTION_TEXEL.core, TEXEL_EXTREMES: REDUCTION_TEXEL.extremes,
    TEXEL_ENERGY: REDUCTION_TEXEL.energy, TEXEL_MOMENTS: REDUCTION_TEXEL.moments,
});
const potentialDefines = (stage: number, block: number) => withDefines(potentialFrag, {
    POTENTIAL_STAGE: stage, POTENTIAL_FIRST: STAGE.first, POTENTIAL_SECOND: STAGE.second, BLOCK: block,
});

let halfFloatDepositForced = false;

/**
 * Dev-only (the lab page, src/lab): makes the grids created from now on deposit in half floats
 * even where EXT_float_blend is available, to test the path of the GPUs without it. Off by
 * default, the application never sets it.
 */
export function forceHalfFloatDeposit(forced: boolean): void {
    halfFloatDepositForced = forced;
}

/**
 * What a DepositPass adds up (the DEPOSIT_KIND of protostar-deposit.vert): the moments alone, the
 * fusion power, or the moments with the composition on a second attachment.
 */
const DEPOSIT_KIND = { moments: 0, power: 1, momentsAndComposition: 2 } as const;
type DepositKind = (typeof DEPOSIT_KIND)[keyof typeof DEPOSIT_KIND];
const DEPOSIT_KIND_DEFINES = {
    DEPOSIT_MOMENTS: DEPOSIT_KIND.moments, DEPOSIT_POWER: DEPOSIT_KIND.power,
    DEPOSIT_MOMENTS_AND_COMPOSITION: DEPOSIT_KIND.momentsAndComposition,
} as const;

/** Prepends the defines and the shared GLSL (deposit kernel, grid sampling and drawings, fusion rate, random numbers). */
export const withProtostarCommon = (source: string, defines: Record<string, string | number> = {}): string =>
    withDefines(`${kernelGlsl}\n${drawingGlsl}\n${commonGlsl}\n${source}`, { ...PROTOSTAR_DEFINES, ...defines });

/**
 * The uniforms of protostar-common.glsl (and of drawing.glsl, which it uses), shared by reference
 * by every material that includes it.
 */
export interface ProtostarCommonUniforms extends DrawingUniforms {
    gridForce: Uniform<THREE.Texture | null>;
    gridGas: Uniform<THREE.Texture | null>;
    gridHeat: Uniform<THREE.Texture | null>;
    gridThermo: Uniform<THREE.Texture | null>;
    gridFuel: Uniform<THREE.Texture | null>;
    gridCell: Uniform<number>;
    /** 1: forceAt() reads the gravity grid with the TSC weights, matched to the TSC deposit (no self-force); 0: bilinearly, matched to cloud-in-cell. */
    tscForce: Uniform<number>;
    fusionTRef: Uniform<number>;
    noiseCorrection: Uniform<number>;
    seed: Uniform<number>;
    reactionTo: Uniform<number[]>;
    reactionRate: Uniform<number[]>;
    reactionPower: Uniform<number[]>;
    reactionBarrier: Uniform<number[]>;
    reactionBarrierPower: Uniform<number[]>;
    reactionFuel: Uniform<number[]>;
    reactionReference: Uniform<number[]>;
    reactionDensityExponent: Uniform<number[]>;
    reactionEnergy: Uniform<number[]>;
    /** The collision deposit (C1): (n, sum v, sum |v|^2) per cell of the shifted collision grid, velocities in L/s. */
    gridCollision: Uniform<THREE.Texture | null>;
    /** 1 while the gas collides (the `collisions` flag): the particle passes then turn the velocities in their cells. */
    collisionsOn: Uniform<number>;
    /** The shift of the collision grid at this substep, px. */
    collisionShift: Uniform<THREE.Vector2>;
    collisionVelScale: Uniform<number>;
    collisionDensity: Uniform<number>;
    /** Collisions per s of a cell at rho0 and the dispersion T0 (PROTOSTAR_COLLISION_RATE; the lab changes it). */
    collisionRate: Uniform<number>;
}

export function createCommonUniforms(drawing: DrawingUniforms): ProtostarCommonUniforms {
    const perType = (fill: number): Uniform<number[]> => ({ value: new Array<number>(MAX_SPECIES).fill(fill) });
    return {
        ...drawing,
        gridForce: { value: null }, gridGas: { value: null }, gridHeat: { value: null }, gridThermo: { value: null }, gridFuel: { value: null },
        gridCell: { value: 1 }, tscForce: { value: 0 }, fusionTRef: { value: 1 }, noiseCorrection: { value: 1 }, seed: { value: 0 },
        reactionTo: perType(-1), reactionRate: perType(0),
        reactionPower: perType(0), reactionBarrier: perType(0), reactionBarrierPower: perType(1), reactionFuel: perType(-1),
        reactionReference: perType(1), reactionDensityExponent: perType(1),
        reactionEnergy: perType(0),
        gridCollision: { value: null }, collisionsOn: { value: 0 }, collisionShift: { value: new THREE.Vector2() },
        collisionVelScale: { value: 1 }, collisionDensity: { value: 1 }, collisionRate: { value: PROTOSTAR_COLLISION_RATE },
    };
}

/** The render targets of the grid passes (see ProtostarGrids), by pass name. */
export interface ProtostarGridTargets {
    /**
     * Two attachments, deposited together: `moments.texture` (attachment 0) holds (m, m v, m |v|^2),
     * `moments.textures[1]` (attachment 1) the composition (sum m (1 + Z) / A, sum m X, sum m^2, sum m Y), with X = 1 for a particle
     * of the fuel of the first reaction (hydrogen) and 0 for any other type, Y likewise for the second reaction (helium), with the
     * same cloud-in-cell weights. The gas pass reads its m / mu (the mean molecular weight, so the temperature), its m^2 (the
     * effective number of particles behind T) and its two fuel masses (the fractions X and Y of the rates of fusion). Only attachment 0
     * can be read back directly (see lab/readback.ts).
     */
    readonly moments: THREE.WebGLRenderTarget;
    /**
     * Three attachments: `gas.texture` (attachment 0) holds (rho / rho0, the velocity dispersion, mean v), `gas.textures[1]` the temperature
     * (the dispersion times mu / mu_H) averaged over time, the effective number of particles and the factor mu / mu_H: (T averaged, N,
     * mu / mu_H, 0), `gas.textures[2]` the mass fractions of the fuel (X, Y, 0, 0). Two targets take turns from one substep to the
     * next: this one is the latest drawn.
     */
    readonly gas: THREE.WebGLRenderTarget;
    readonly power: THREE.WebGLRenderTarget;
    readonly heat: THREE.WebGLRenderTarget;
    readonly coarse: THREE.WebGLRenderTarget;
    readonly gravity: THREE.WebGLRenderTarget;
    /** First stage of the reduction: four attachments (core, extremes, energy, moments), one block of cells per texel. */
    readonly reduce1: THREE.WebGLRenderTarget;
    /** The result of the reduction, REDUCTION_TEXELS x 1 texels: the layout is in reduction.ts. */
    readonly reduce2: THREE.WebGLRenderTarget;
    /** The potential energy of the grids as they were before the last stashPotential(): one texel, x. */
    readonly potential: THREE.WebGLRenderTarget;
    /** The collision deposit (C1, see ProtostarCommonUniforms.gridCollision), null before the collisions were first switched on. */
    readonly collision: THREE.WebGLRenderTarget | null;
}

/** What the deposit shader reads, as plain numbers (see ProtostarGrids.debugDepositInputs). */
export interface DepositInputs {
    gridResolution: number;
    /** px per cell. */
    gridCell: number;
    /** Deposit units per simulation mass unit. */
    depositMassScale: number;
    /** Mass of a particle of each type (a parcel: the same for every type), simulation mass units. */
    depositMass: number[];
    /** (1 + Z) / A of each type, per u. */
    inverseMolecularWeight: number[];
    /** Whether each type is the fuel of the first reaction (x) or of the second (y): (1, 0), (0, 1) or (0, 0). */
    fuel: [number, number][];
}

/** Physical scales the grid passes need, set before each substep. */
export interface GridScales {
    /** Deposit units per simulation mass unit (the mean particle mass is 1 deposit unit). */
    depositMassScale: number;
    /** Deposit units per px/s. */
    depositVelScale: number;
    /** rho / rho0 per deposited mass in a 3x3 neighborhood. */
    densityPerDeposit: number;
    /** G_eff x simulation mass of one deposit unit. */
    gravityPerDeposit: number;
    softening: number;
    /** rho / rho0 per particle in a cell of the collision grid. */
    collisionDensity: number;
    /** The shift of the collision grid at this substep, px (collisionShift() of collisions.ts). */
    collisionShift: readonly [number, number];
}

/**
 * An additive deposit of the particles into a render target, with the cloud-in-cell kernel or the TSC one (deposit-kernel.glsl):
 * one material per kernel, the TSC one built on first use.
 */
class DepositPass {
    private readonly materials: [THREE.ShaderMaterial | null, THREE.ShaderMaterial | null] = [null, null];
    private readonly points: THREE.Points;
    private readonly scene = new THREE.Scene();

    constructor(private readonly kind: DepositKind, private readonly uniforms: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry,
                readonly target: THREE.WebGLRenderTarget) {
        this.points = new THREE.Points(geometry, this.material(false));
        this.points.frustumCulled = false;
        this.scene.add(this.points);
    }

    /** Deposits with the TSC kernel (true) or the cloud-in-cell one (false) from the next render. */
    setTsc(tsc: boolean): void {
        this.points.material = this.material(tsc);
    }

    private material(tsc: boolean): THREE.ShaderMaterial {
        const index = tsc ? 1 : 0;
        const kernel = { DEPOSIT_TSC: tsc ? 1 : 0 };
        this.materials[index] ??= new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: withProtostarCommon(depositVert, {
                DEPOSIT_KIND: this.kind, ...DEPOSIT_KIND_DEFINES, ...kernel, GAS_THERMO: this.kind === DEPOSIT_KIND.power ? 1 : 0,
            }),
            fragmentShader: withDefines(`${kernelGlsl}\n${depositFrag}`, { DEPOSIT_KIND: this.kind, ...DEPOSIT_KIND_DEFINES, ...kernel }),
            ...additiveBlending,
        });
        return this.materials[index];
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, clipSpaceCamera);   // autoClear clears it first
    }

    dispose(): void {
        this.target.dispose();
        for (const material of this.materials) material?.dispose();
    }
}

/**
 * The collision deposit of the gas (C1): every particle adds (1, v, |v|^2) to the texel of its cell of the shifted collision grid
 * (COLLISION_GRID_RES cells per axis), one fragment per particle (protostar-collision.vert).
 */
class CollisionDeposit {
    private readonly material: THREE.ShaderMaterial;
    private readonly scene = new THREE.Scene();
    readonly target: THREE.WebGLRenderTarget;

    constructor(uniforms: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry, type: THREE.TextureDataType) {
        this.material = new THREE.ShaderMaterial({
            uniforms, vertexShader: withProtostarCommon(collisionVert), fragmentShader: collisionFrag, ...additiveBlending,
        });
        const points = new THREE.Points(geometry, this.material);
        points.frustumCulled = false;
        this.scene.add(points);
        this.target = gridTarget(COLLISION_GRID_RES, type);
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, clipSpaceCamera);   // autoClear clears it first
    }

    dispose(): void {
        this.target.dispose();
        this.material.dispose();
    }
}

/**
 * The grid passes of the protostar algorithm, rendered before every substep from the current
 * particle state (GRID_RES x GRID_RES square cells over max(width, height)):
 *  1. moments: cloud-in-cell deposit of (m, m v, m |v|^2) and, on a second attachment of the same
 *     pass, of the composition (m (1 + Z) / A, count, m^2), for the passes that need it (the gas pass: m^2);
 *  2. gas: density, velocity dispersion and mean velocity of each 3x3 neighborhood, on a second attachment the temperature
 *     (the dispersion times the mean molecular weight over that of hydrogen) averaged over time, the effective number of
 *     particles (the noise of T, see noiseBias.ts) and the molecular weight's factor, and on a third the mass fractions of the
 *     fuels (hydrogen, helium) that the rates of fusion read;
 *  3. power: deposit of the expected fusion power of the fusing particles;
 *  4. heat: fusion heating per unit mass of each 3x3 neighborhood, and the molecular weight's factor for the velocity pass;
 *  5. coarse + gravity: softened gravity and its Plummer potential at the cell centers, summed cell
 *     to cell on two levels (the force in x and y, the potential in z);
 *  6. with the collisions of the gas (C1), the collision deposit on the shifted grid (CollisionDeposit), of the velocities kicked to
 *     the instant of the positions with the force of step 5.
 * The particle passes sample gas, heat and gravity through the common uniforms. reduceStats()
 * reduces the grids to REDUCTION_TEXELS texels (max density, temperature there, fusions / s, the
 * densest cell, the extreme speeds and accelerations, the center of mass, the energies: see
 * reduction.ts).
 */
export class ProtostarGrids {
    readonly common: ProtostarCommonUniforms;
    private readonly moments: DepositPass;
    /** What the passes sample as the moments: attachment 0 of `moments` (or, in the lab, of the pass without a composition). */
    private readonly momentsTexture: Uniform<THREE.Texture | null>;
    private momentsAlone: DepositPass | null = null;
    private readonly geometry: THREE.BufferGeometry;
    private readonly depositUniforms: Record<string, THREE.IUniform>;
    private readonly blendType: THREE.TextureDataType;
    private readonly power: DepositPass;
    private tscDeposit = false;
    /** The gas pass, drawn into one of two targets in turn: the averaged temperature of the previous substep is read from the other. */
    private readonly gasPasses: readonly [GridPass, GridPass];
    private gasCurrent = 0;
    private temperatureHistory = false;                // the averaged temperature of the last substep belongs to this run
    private readonly heat: GridPass;
    private readonly coarse: GridPass;
    private readonly gravity: GridPass;
    private gravityPlain: GridPass | null = null;
    private readonly gravityUniforms: Record<string, THREE.IUniform>;
    private readonly reduce1: GridPass;
    readonly reduce2: GridPass;
    private readonly potential1: GridPass;
    private readonly potential2: GridPass;
    /** The collision deposit, built when the collisions are first switched on. */
    private collisionDeposit: CollisionDeposit | null = null;
    /** The model's previous substep length (s), shared by reference with its particle passes: the collision deposit's kick. */
    private stepLength: Uniform<number> = { value: 0 };
    private readonly u = {
        texturePosition: { value: null as THREE.Texture | null },
        textureVelocity: { value: null as THREE.Texture | null },
        depositMassScale: { value: 1 },
        depositVelScale: { value: 1 },
        densityPerDeposit: { value: 1 },
        gravityPerDeposit: { value: 1 },
        softening2: { value: 1 },
        speciesDepositMass: { value: new Array<number>(MAX_SPECIES).fill(1) },
        speciesInverseMu: { value: new Array<number>(MAX_SPECIES).fill(0) },
        speciesFuel: { value: Array.from({ length: MAX_SPECIES }, () => new THREE.Vector2()) },
        /** The particles' acceleration of the previous substep (the model's textureAccel): the collision deposit's kick. */
        textureAccel: { value: null as THREE.Texture | null },
        temperatureWeight: { value: 1 },
        molecularWeight: { value: 1 },
        /** The noise shape of the deposit's kernel (PROTOSTAR_NOISE_N_SHAPE, or _TSC): the gas pass's effective number of particles. */
        noiseShape: { value: PROTOSTAR_NOISE_N_SHAPE },
    };
    /**
     * Dev-only (the lab's cost comparison): false makes the moments pass deposit the moments alone,
     * as it did before the composition existed (the composition grid then goes stale). True in the application.
     */
    compositionEnabled = true;
    /**
     * Dev-only (the lab's cost comparison): false draws the gravity grid without its potential channel, as the pass was before
     * the energy diagnostics (the reductions then read a potential of 0). True in the application.
     */
    potentialEnabled = true;
    /**
     * Time constant (s) of the average of the temperature that feeds the fusion rate (see smoothingWeight()); 0 or less is no
     * averaging. The application's constant by default; the lab changes it to measure what the average does.
     */
    temperatureTau = PROTOSTAR_TEMPERATURE_TAU;

    /**
     * Dev-only (the lab): false makes the temperature the velocity dispersion, as it was before the mean molecular weight (A1);
     * the application always has it on. A restart gives it back.
     */
    get molecularWeightEnabled(): boolean {
        return this.u.molecularWeight.value > 0;
    }

    set molecularWeightEnabled(enabled: boolean) {
        this.u.molecularWeight.value = enabled ? 1 : 0;
    }

    constructor(private readonly renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry, drawing: DrawingUniforms) {
        this.common = createCommonUniforms(drawing);
        // Additive float32 blending needs EXT_float_blend (asking for it enables it); half floats otherwise.
        const blendType = !halfFloatDepositForced && renderer.extensions.has('EXT_float_blend')
            ? THREE.FloatType : THREE.HalfFloatType;
        const res = PROTOSTAR_GRID_RES;
        const { u, common } = this;
        const particleUniforms = { ...common, ...u };
        this.geometry = geometry;
        this.depositUniforms = particleUniforms;
        this.blendType = blendType;
        // Both attachments blend the same way: they must have the same type (float32 or half float).
        this.moments = new DepositPass(DEPOSIT_KIND.momentsAndComposition, particleUniforms, geometry, gridTarget(res, blendType, 2));
        this.momentsTexture = { value: this.moments.target.texture };
        // Three attachments (gas; the averaged temperature, the effective number of particles and the molecular weight's factor; the
        // fuel fractions), two targets in turn.
        const gasTargets = [gridTarget(res, THREE.FloatType, 3), gridTarget(res, THREE.FloatType, 3)] as const;
        const gasPass = (current: number): GridPass => new GridPass(withDefines(gasFrag, PROTOSTAR_DEFINES), {
            gridMoments: this.momentsTexture, gridComposition: { value: this.moments.target.textures[1] },
            gridThermoPrevious: { value: gasTargets[1 - current].textures[1] },
            depositVelScale: u.depositVelScale, densityPerDeposit: u.densityPerDeposit, temperatureWeight: u.temperatureWeight,
            molecularWeight: u.molecularWeight, noiseShape: u.noiseShape,
        }, gasTargets[current]);
        this.gasPasses = [gasPass(0), gasPass(1)];
        common.gridGas.value = this.gasPasses[0].target.texture;
        common.gridThermo.value = this.gasPasses[0].target.textures[1];
        common.gridFuel.value = this.gasPasses[0].target.textures[2];
        this.power = new DepositPass(DEPOSIT_KIND.power, particleUniforms, geometry, gridTarget(res, blendType));
        this.heat = new GridPass(withDefines(heatFrag, PROTOSTAR_DEFINES), {
            gridMoments: this.momentsTexture,
            gridPower: { value: this.power.target.texture },
            gridThermo: common.gridThermo,                 // the factor mu / mu_H of the gas pass of the same substep
        }, gridTarget(res, THREE.FloatType));
        common.gridHeat.value = this.heat.target.texture;
        this.coarse = new GridPass(withDefines(coarseFrag, { COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR }), {
            gridMoments: this.momentsTexture, gridCell: common.gridCell,
        }, gridTarget(COARSE_RES, THREE.FloatType));
        this.gravityUniforms = {
            gridMoments: this.momentsTexture,
            gridCoarse: { value: this.coarse.target.texture },
            gridCell: common.gridCell, softening2: u.softening2, gravityPerDeposit: u.gravityPerDeposit,
        };
        this.gravity = this.gravityPass(true);
        common.gridForce.value = this.gravity.target.texture;
        this.potential1 = new GridPass(potentialDefines(STAGE.first, REDUCE_BLOCK), {
            gridMoments: this.momentsTexture, gridForce: common.gridForce,
        }, gridTarget(PROTOSTAR_STATS_REDUCE_RES, THREE.FloatType));
        this.potential2 = new GridPass(potentialDefines(STAGE.second, PROTOSTAR_STATS_REDUCE_RES), {
            source: { value: this.potential1.target.texture },
        }, gridTarget(1, THREE.FloatType));
        this.reduce1 = new GridPass(reduceDefines(STAGE.first, REDUCE_BLOCK), {
            gridGas: common.gridGas, gridThermo: common.gridThermo, gridMoments: this.momentsTexture,
            gridComposition: { value: this.moments.target.textures[1] }, gridForce: common.gridForce,
            gridPower: { value: this.power.target.texture }, gridCell: common.gridCell, fusionTRef: common.fusionTRef,
        }, gridTarget(PROTOSTAR_STATS_REDUCE_RES, THREE.FloatType, REDUCTION_TEXELS));
        const stages = this.reduce1.target.textures;
        this.reduce2 = new GridPass(reduceDefines(STAGE.second, PROTOSTAR_STATS_REDUCE_RES), {
            stageCore: { value: stages[REDUCTION_TEXEL.core] }, stageExtremes: { value: stages[REDUCTION_TEXEL.extremes] },
            stageEnergy: { value: stages[REDUCTION_TEXEL.energy] }, stageMoments: { value: stages[REDUCTION_TEXEL.moments] },
            potentialBefore: { value: this.potential2.target.texture },
        }, gridTarget(REDUCTION_TEXELS, THREE.FloatType, 1, 1));
    }

    /** Dev-only, read-only: the render targets of every pass, to read the grids back. */
    get targets(): ProtostarGridTargets {
        return {
            moments: this.moments.target, gas: this.gasPasses[this.gasCurrent].target, power: this.power.target, heat: this.heat.target,
            coarse: this.coarse.target, gravity: this.gravity.target, reduce1: this.reduce1.target, reduce2: this.reduce2.target,
            potential: this.potential2.target, collision: this.collisionDeposit?.target ?? null,
        };
    }

    /**
     * The mass of a particle of each type, simulation mass units, written in place (the array is shared by reference with the deposit
     * materials). The particles are parcels of constant mass (A4): the model gives every type the same, TOTAL_MASS / count.
     */
    setDepositMasses(masses: readonly number[]): void {
        const array = this.u.speciesDepositMass.value;
        for (let k = 0; k < array.length; k++) array[k] = masses[k] ?? 0;
    }

    /**
     * The factor (1 + Z) / A of each type, per u (see composition.ts), written in place: the array
     * is shared by reference with the deposit materials.
     */
    setInverseMolecularWeights(factors: readonly number[]): void {
        const array = this.u.speciesInverseMu.value;
        for (let k = 0; k < array.length; k++) array[k] = factors[k] ?? 0;
    }

    /**
     * The fuel channel of each type (reactionArrays().fuel: 0 for the fuel of the first reaction, 1 for that of the second, -1 for
     * a type that fuses in none), written in place: the array is shared by reference with the deposit materials.
     */
    setFuelChannels(channels: readonly number[]): void {
        this.u.speciesFuel.value.forEach((fuel, k) => fuel.set(channels[k] === 0 ? 1 : 0, channels[k] === 1 ? 1 : 0));
    }

    /**
     * Deposits the particles with the TSC kernel (3x3 cells, quadratic weights) instead of the cloud-in-cell one (2x2, bilinear):
     * the moments, the composition and the fusion power alike (the `tscDeposit` switch, C4); the particles then read the gravity with
     * the same weights, as a mismatched read gives each particle a force on itself.
     */
    setTscDeposit(tsc: boolean): void {
        this.tscDeposit = tsc;
        this.common.tscForce.value = tsc ? 1 : 0;
        this.u.noiseShape.value = tsc ? PROTOSTAR_NOISE_N_SHAPE_TSC : PROTOSTAR_NOISE_N_SHAPE;
        for (const pass of [this.moments, this.power, this.momentsAlone]) pass?.setTsc(tsc);
    }

    /**
     * Switches the collisions of the gas (C1) on or off: on, update() draws the collision deposit and the particle passes turn the
     * velocities; off, neither runs (the deposit is skipped and the passes take one uniform branch).
     */
    setCollisions(on: boolean): void {
        if (on && !this.collisionDeposit) {
            this.collisionDeposit = new CollisionDeposit({ ...this.depositUniforms, dtPrev: this.stepLength }, this.geometry, this.blendType);
            this.common.gridCollision.value = this.collisionDeposit.target.texture;
        }
        this.common.collisionsOn.value = on ? 1 : 0;
    }

    /** The uniform holding the previous substep's length that the particle passes read (dtPrev), shared by the collision deposit. */
    shareStepLength(dtPrev: Uniform<number>): void {
        this.stepLength = dtPrev;
    }

    /** Dev-only, read-only: the values the deposit shader runs with, to compute the deposit again on the CPU. */
    get debugDepositInputs(): DepositInputs {
        return {
            gridResolution: PROTOSTAR_GRID_RES,
            gridCell: this.common.gridCell.value,
            depositMassScale: this.u.depositMassScale.value,
            depositMass: [...this.u.speciesDepositMass.value],
            inverseMolecularWeight: [...this.u.speciesInverseMu.value],
            fuel: this.u.speciesFuel.value.map(fuel => [fuel.x, fuel.y]),
        };
    }

    setScales(s: GridScales): void {
        const { u } = this;
        u.depositMassScale.value = s.depositMassScale;
        u.depositVelScale.value = s.depositVelScale;
        u.densityPerDeposit.value = s.densityPerDeposit;
        u.gravityPerDeposit.value = s.gravityPerDeposit;
        u.softening2.value = s.softening * s.softening;
        const { common } = this;
        common.collisionVelScale.value = s.depositVelScale;
        common.collisionDensity.value = s.collisionDensity;
        common.collisionShift.value.set(s.collisionShift[0], s.collisionShift[1]);
    }

    /**
     * A new run starts: its first temperature is not averaged with the one of the run before, and the dev-only switches of the lab
     * (the time constant of the average, the correction of the noise of T, the molecular weight, the collision rate) are back at the application's values.
     */
    startRun(): void {
        this.temperatureHistory = false;
        this.temperatureTau = PROTOSTAR_TEMPERATURE_TAU;
        this.common.noiseCorrection.value = 1;
        this.common.collisionRate.value = PROTOSTAR_COLLISION_RATE;
        this.molecularWeightEnabled = true;
    }

    /**
     * Renders every grid from the particle state, `dt` seconds after the previous ones; `accelerations` (the previous substep's, for the
     * collision deposit's kick) only matters with the collisions on.
     */
    update(positions: THREE.Texture, velocities: THREE.Texture, dt: number, accelerations: THREE.Texture | null = null): void {
        const { renderer } = this;
        this.u.temperatureWeight.value = this.temperatureHistory ? smoothingWeight(dt, this.temperatureTau) : 1;
        this.temperatureHistory = true;
        this.u.texturePosition.value = positions;
        this.u.textureVelocity.value = velocities;
        this.u.textureAccel.value = accelerations;
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);                      // the deposits use alpha: start from 0
        const moments = this.compositionEnabled ? this.moments : this.momentsWithoutComposition();
        this.momentsTexture.value = moments.target.texture;
        moments.render(renderer);
        this.gasCurrent = 1 - this.gasCurrent;
        const gas = this.gasPasses[this.gasCurrent];
        gas.render(renderer);
        this.common.gridGas.value = gas.target.texture;
        this.common.gridThermo.value = gas.target.textures[1];
        this.common.gridFuel.value = gas.target.textures[2];
        this.power.render(renderer);
        this.heat.render(renderer);
        this.coarse.render(renderer);
        const gravity = this.potentialEnabled ? this.gravity : this.gravityWithoutPotential();
        this.common.gridForce.value = gravity.target.texture;
        gravity.render(renderer);
        // After the gravity: the collision deposit kicks every velocity to the instant of the positions with this substep's force.
        if (this.common.collisionsOn.value > 0) this.collisionDeposit?.render(renderer);
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(null);
    }

    /** The gravity pass: acceleration in x and y, and with `potential` the Plummer potential in z (grid-gravity.frag). */
    private gravityPass(potential: boolean): GridPass {
        return new GridPass(withDefines(gravityFrag, {
            GRID_RES: PROTOSTAR_GRID_RES, COARSE_RES, COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, NEAR_RADIUS: PROTOSTAR_NEAR_RADIUS,
            ...(potential ? { GRAVITY_POTENTIAL: 1 } : {}),
        }), this.gravityUniforms, gridTarget(PROTOSTAR_GRID_RES, THREE.FloatType));
    }

    /** Dev-only (see potentialEnabled): the gravity pass as it was before the potential, built on first use. */
    private gravityWithoutPotential(): GridPass {
        this.gravityPlain ??= this.gravityPass(false);
        return this.gravityPlain;
    }

    /** Dev-only (see compositionEnabled): the moments pass as it was before the composition, built on first use. */
    private momentsWithoutComposition(): DepositPass {
        this.momentsAlone ??= new DepositPass(DEPOSIT_KIND.moments, this.depositUniforms, this.geometry,
            gridTarget(PROTOSTAR_GRID_RES, this.blendType));
        this.momentsAlone.setTsc(this.tscDeposit);
        return this.momentsAlone;
    }

    /**
     * Reduces the grids as they are into reduce2's REDUCTION_TEXELS texels (layout and meaning in
     * reduction.ts), in two passes. It reads the grids of the last update() and, for the energy,
     * the potential that stashPotential() kept.
     */
    reduceStats(): void {
        this.reduce1.render(this.renderer);
        this.reduce2.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    /**
     * Keeps the potential energy of the grids as they are, in two passes, for reduceStats(). Called
     * right before update() draws them again: the velocities the next deposit reads belong to
     * those grids' positions, not to the next ones (velocity Verlet: the velocity texture is one
     * substep behind the positions), so the energy of one state needs the potential of the grids
     * before and the kinetic energy of the grids after.
     */
    stashPotential(): void {
        this.potential1.render(this.renderer);
        this.potential2.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    dispose(): void {
        for (const pass of [this.moments, this.power, ...this.gasPasses, this.heat, this.coarse, this.gravity, this.reduce1, this.reduce2,
                            this.potential1, this.potential2]) {
            pass.dispose();
        }
        this.momentsAlone?.dispose();
        this.gravityPlain?.dispose();
        this.collisionDeposit?.dispose();
    }
}
