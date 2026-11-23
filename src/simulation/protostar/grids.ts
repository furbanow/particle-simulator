import * as THREE from 'three';
import {
    MAX_SPECIES, PROTOSTAR_COLLISION_RATE, PROTOSTAR_GRID_RES, PROTOSTAR_NOISE_N_SHAPE, PROTOSTAR_NOISE_N_SHAPE_TSC, PROTOSTAR_STATS_REDUCE_RES,
    PROTOSTAR_TEMPERATURE_TAU,
} from '../../config';
import { additiveBlending, clipSpaceCamera, type Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { glslFloat, withDefines } from '../../gl/withDefines';
import type { DrawingUniforms } from '../drawing/DrawingField';
import potentialFrag from '../../shaders/protostar-potential.frag?raw';
import collisionVert from '../../shaders/protostar-collision.vert?raw';
import collisionFrag from '../../shaders/protostar-collision.frag?raw';
import { COLLISION_GRID_RES } from './collisions';
import reduceFrag from '../../shaders/protostar-reduce.frag?raw';
import { GridChain, type GridChainPassName, type GridChainScales } from './gridChain';
import { createCommonUniforms, withProtostarCommon, type ProtostarCommonUniforms } from './gridCommon';
import { smoothingWeight } from './noiseBias';
import { REDUCTION_NO_THICKNESS, REDUCTION_TEXEL, REDUCTION_TEXELS } from './reduction';

export { PROTOSTAR_DEFINES, createCommonUniforms, withProtostarCommon, type ProtostarCommonUniforms } from './gridCommon';

const REDUCE_BLOCK = PROTOSTAR_GRID_RES / PROTOSTAR_STATS_REDUCE_RES;

const STAGE = { first: 0, second: 1 } as const;
const reduceDefines = (stage: number, block: number) => withDefines(reduceFrag, {
    REDUCE_STAGE: stage, REDUCE_FIRST: STAGE.first, REDUCE_SECOND: STAGE.second, BLOCK: block,
    TEXEL_CORE: REDUCTION_TEXEL.core, TEXEL_EXTREMES: REDUCTION_TEXEL.extremes,
    TEXEL_ENERGY: REDUCTION_TEXEL.energy, TEXEL_MOMENTS: REDUCTION_TEXEL.moments, NO_THICKNESS: glslFloat(REDUCTION_NO_THICKNESS),
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
     * mu / mu_H, h_ref / h), `gas.textures[2]` the mass fractions of the fuel (X, Y, 0, 0), `gas.textures[3]` the source of the
     * gravity (m of the cell, h^2, 0, 0): h the thickness of the layer with the adaptive thickness (A11), the fixed softening otherwise.
     * Two targets take turns from one substep to the next: this one is the latest drawn.
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

/** The grid passes of one substep, in the order update() draws them (the collision deposit only with the collisions on). */
export const PROTOSTAR_GRID_PASSES = ['moments', 'gas', 'power', 'heat', 'coarse', 'gravity', 'collision'] as const;
export type ProtostarGridPassName = (typeof PROTOSTAR_GRID_PASSES)[number];

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
    /** The adaptive thickness (A11): on or off, and what the gas pass computes h with. */
    thickness: ThicknessScales;
    /** rho / rho0 per particle in a cell of the collision grid. */
    collisionDensity: number;
    /** The shift of the collision grid at this substep, px (collisionShift() of collisions.ts). */
    collisionShift: readonly [number, number];
}

/** What the gas pass computes the thickness of the layer with (A11, thickness.ts). */
export interface ThicknessScales {
    on: boolean;
    /** 1 / (2 pi G rho0): px per (px^2/s^2) per rho0 (thicknessPerDispersion()). */
    perDispersion: number;
    /** The bounds of h, px. */
    floor: number;
    ceiling: number;
    /** h_ref of the fusion law's volume density, px. */
    reference: number;
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
 *     to cell on two levels (the force in x and y, the potential in z), from the source the gas pass wrote (the masses and the
 *     softening of every cell: the fixed one, or the thickness of the layer with A11);
 *  6. with the collisions of the gas (C1), the collision deposit on the shifted grid (CollisionDeposit), of the velocities kicked to
 *     the instant of the positions with the force of step 5.
 * The particle passes sample gas, heat and gravity through the common uniforms. reduceStats()
 * reduces the grids to REDUCTION_TEXELS texels (max density, temperature there, fusions / s, the
 * densest cell, the extreme speeds and accelerations, the center of mass, the energies: see
 * reduction.ts).
 */
export class ProtostarGrids {
    readonly common: ProtostarCommonUniforms;
    /** The main grid chain: the deposits, the gas, the heating and the gravity over the whole area (gridChain.ts). */
    private readonly chain: GridChain;
    private readonly geometry: THREE.BufferGeometry;
    private readonly depositUniforms: Record<string, THREE.IUniform>;
    private readonly blendType: THREE.TextureDataType;
    private temperatureHistory = false;                // the averaged temperature of the last substep belongs to this run
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
        thicknessOn: { value: 0 },
        thicknessPerDispersion: { value: 1 },
        thicknessFloor: { value: 1 },
        thicknessCeiling: { value: 1 },
        thicknessReference: { value: 1 },
    };
    /**
     * Time constant (s) of the average of the temperature that feeds the fusion rate (see smoothingWeight()); 0 or less is no
     * averaging. The application's constant by default; the lab changes it to measure what the average does.
     */
    temperatureTau = PROTOSTAR_TEMPERATURE_TAU;

    /**
     * Dev-only (the lab's cost comparison): false makes the moments pass deposit the moments alone,
     * as it did before the composition existed (the composition grid then goes stale). True in the application.
     */
    get compositionEnabled(): boolean {
        return this.chain.compositionEnabled;
    }

    set compositionEnabled(enabled: boolean) {
        this.chain.compositionEnabled = enabled;
    }

    /**
     * Dev-only (the lab's cost comparison): false draws the gravity grid without its potential channel, as the pass was before
     * the energy diagnostics (the reductions then read a potential of 0). True in the application.
     */
    get potentialEnabled(): boolean {
        return this.chain.potentialEnabled;
    }

    set potentialEnabled(enabled: boolean) {
        this.chain.potentialEnabled = enabled;
    }

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
        const { u, common } = this;
        const particleUniforms = { ...common, ...u };
        this.geometry = geometry;
        this.depositUniforms = particleUniforms;
        this.blendType = blendType;
        this.chain = new GridChain({
            renderer, geometry, depositUniforms: particleUniforms, blendType, resolution: PROTOSTAR_GRID_RES, scales: u, common,
        });
        const { chain } = this;
        this.potential1 = new GridPass(potentialDefines(STAGE.first, REDUCE_BLOCK), {
            gridMoments: chain.momentsTexture, gridForce: common.gridForce,
            gridComposition: { value: chain.compositionTexture }, gridSource: chain.sourceTexture, gravityPerDeposit: u.gravityPerDeposit,
        }, gridTarget(PROTOSTAR_STATS_REDUCE_RES, THREE.FloatType));
        this.potential2 = new GridPass(potentialDefines(STAGE.second, PROTOSTAR_STATS_REDUCE_RES), {
            source: { value: this.potential1.target.texture },
        }, gridTarget(1, THREE.FloatType));
        this.reduce1 = new GridPass(reduceDefines(STAGE.first, REDUCE_BLOCK), {
            gridGas: common.gridGas, gridThermo: common.gridThermo, gridMoments: chain.momentsTexture,
            gridComposition: { value: chain.compositionTexture }, gridForce: common.gridForce,
            gridPower: { value: chain.powerTexture }, gridCell: common.gridCell, fusionTRef: common.fusionTRef,
            gridSource: chain.sourceTexture, gravityPerDeposit: u.gravityPerDeposit,
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
            ...this.chain.targets, reduce1: this.reduce1.target, reduce2: this.reduce2.target,
            potential: this.potential2.target, collision: this.collisionDeposit?.target ?? null,
        };
    }

    /**
     * Dev-only (the spike of C2): a second grid chain of the same resolution whose cells are `ratio` times finer, its lower left corner at
     * `origin` (px), reading the same particles and scales (its fields are not to scale: only its cost and its deposit are meaningful).
     * It publishes its fields to uniforms of its own. The caller disposes it.
     */
    debugBuildNestedChain(ratio: number, origin: THREE.Vector2): GridChain {
        const fine = { gridCell: { value: this.common.gridCell.value / ratio }, gridOrigin: { value: origin.clone() } };
        const common: ProtostarCommonUniforms = {
            ...this.common, ...fine,
            gridGas: { value: null }, gridThermo: { value: null }, gridFuel: { value: null }, gridHeat: { value: null }, gridForce: { value: null },
        };
        const scales: GridChainScales = this.u;
        return new GridChain({
            renderer: this.renderer, geometry: this.geometry, depositUniforms: { ...this.depositUniforms, ...fine },
            blendType: this.blendType, resolution: PROTOSTAR_GRID_RES, scales, common,
        });
    }

    /** Dev-only: what the grids were built with (the particles' geometry), so that the lab can build others alike. */
    get debugGeometry(): THREE.BufferGeometry {
        return this.geometry;
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
        this.common.tscForce.value = tsc ? 1 : 0;
        this.u.noiseShape.value = tsc ? PROTOSTAR_NOISE_N_SHAPE_TSC : PROTOSTAR_NOISE_N_SHAPE;
        this.chain.setTsc(tsc);
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
        u.thicknessOn.value = s.thickness.on ? 1 : 0;
        u.thicknessPerDispersion.value = s.thickness.perDispersion;
        u.thicknessFloor.value = s.thickness.floor;
        u.thicknessCeiling.value = s.thickness.ceiling;
        u.thicknessReference.value = s.thickness.reference;
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
        this.chain.render();
        // After the gravity: the collision deposit kicks every velocity to the instant of the positions with this substep's force.
        if (this.common.collisionsOn.value > 0) this.collisionDeposit?.render(renderer);
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(null);
    }

    /**
     * Dev-only (the lab's cost of the passes): renders the grid pass `name` again from the inputs of the last update(), into the target
     * it wrote then (the same result: every pass reads only the particles and the grids before it). Returns that target. The collision
     * deposit needs the collisions on. Not used by the app.
     */
    debugRenderPass(name: ProtostarGridPassName): THREE.WebGLRenderTarget {
        const { renderer } = this;
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);
        let target: THREE.WebGLRenderTarget;
        if (name === 'collision') {
            if (!this.collisionDeposit) throw new Error(`The grid pass ${name} is not built`);
            this.collisionDeposit.render(renderer);
            target = this.collisionDeposit.target;
        } else {
            target = this.chain.debugRenderPass(name satisfies GridChainPassName);
        }
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(null);
        return target;
    }

    /**
     * Dev-only (the lab's parity of A11): draws the gravity of the last update() with the pass of the drawings' kind (grid-gravity.frag
     * without GRAVITY_SOURCE: the masses of the moments, the fixed softening for every pair) into a target of its own, and returns it.
     * With the adaptive thickness off it must equal the gravity grid to the bit.
     */
    debugRenderFixedGravity(): THREE.WebGLRenderTarget {
        const target = this.chain.debugRenderFixedGravity();
        this.renderer.setRenderTarget(null);
        return target;
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
        this.chain.dispose();
        for (const pass of [this.reduce1, this.reduce2, this.potential1, this.potential2]) pass.dispose();
        this.collisionDeposit?.dispose();
    }
}
