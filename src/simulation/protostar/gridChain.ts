// One level of the protostar's grids (a "grid chain"): the passes that turn the particles into the fields the particle passes sample, from
// the deposits to the gravity. ProtostarGrids owns one, the main grid over the whole area; the reductions, the potential energy and the
// collisions of the gas are its own and read the chain's targets.
import * as THREE from 'three';
import { PROTOSTAR_COARSE_FACTOR, PROTOSTAR_NEAR_RADIUS } from '../../config';
import type { Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { withDefines } from '../../gl/withDefines';
import gasFrag from '../../shaders/protostar-gas.frag?raw';
import heatFrag from '../../shaders/protostar-heat.frag?raw';
import coarseFrag from '../../shaders/grid-coarse.frag?raw';
import gravityFrag from '../../shaders/grid-gravity.frag?raw';
import { DEPOSIT_KIND, DepositPass, PROTOSTAR_DEFINES, type ProtostarCommonUniforms } from './gridCommon';

/** The grid passes of a chain, in the order render() draws them. */
export const GRID_CHAIN_PASSES = ['moments', 'gas', 'power', 'heat', 'coarse', 'gravity'] as const;
export type GridChainPassName = (typeof GRID_CHAIN_PASSES)[number];

/** The uniforms of the scales a chain's grid passes read, shared by reference with the owner (which sets them every substep). */
export interface GridChainScales {
    depositVelScale: Uniform<number>;
    densityPerDeposit: Uniform<number>;
    gravityPerDeposit: Uniform<number>;
    softening2: Uniform<number>;
    temperatureWeight: Uniform<number>;
    molecularWeight: Uniform<number>;
    noiseShape: Uniform<number>;
    thicknessOn: Uniform<number>;
    thicknessPerDispersion: Uniform<number>;
    thicknessFloor: Uniform<number>;
    thicknessCeiling: Uniform<number>;
    thicknessReference: Uniform<number>;
}

/** What a chain is built from. */
export interface GridChainOptions {
    renderer: THREE.WebGLRenderer;
    /** The particles' geometry (one point per particle), drawn by the deposits. */
    geometry: THREE.BufferGeometry;
    /** The uniforms of the deposits' materials (the common ones and the particles' textures and scales). */
    depositUniforms: Record<string, THREE.IUniform>;
    /** The type of the deposits' targets: float32 where it blends, half float otherwise. */
    blendType: THREE.TextureDataType;
    /** Cells per side. */
    resolution: number;
    scales: GridChainScales;
    /**
     * The common uniforms the chain reads (gridCell) and publishes its fields to (gridGas, gridThermo, gridFuel, gridHeat, gridForce):
     * the particle passes sample those.
     */
    common: ProtostarCommonUniforms;
}

/**
 * The passes of one level, in the order render() draws them:
 *  1. moments: the deposit of (m, m v, m |v|^2) and, on a second attachment, the composition (m (1 + Z) / A, m X, m^2, m Y);
 *  2. gas: density, dispersion and mean velocity of each 3x3 neighborhood; the averaged temperature, the effective number of particles,
 *     the molecular weight's factor and the thickness's factor of the fusion law; the fuel fractions; the gravity's source (m, h^2);
 *     two targets in turn (the averaged temperature of the previous substep is read from the other);
 *  3. power: the deposit of the expected fusion power;
 *  4. heat: the fusion heating per unit mass of each 3x3 neighborhood and the molecular weight's factor;
 *  5. coarse + gravity: the softened gravity and its Plummer potential at the cell centers, on two levels.
 */
export class GridChain {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly common: ProtostarCommonUniforms;
    private readonly geometry: THREE.BufferGeometry;
    private readonly depositUniforms: Record<string, THREE.IUniform>;
    private readonly blendType: THREE.TextureDataType;
    private readonly resolution: number;
    private readonly coarseResolution: number;
    private readonly moments: DepositPass;
    /** What the passes sample as the moments: attachment 0 of `moments` (or, in the lab, of the pass without a composition). */
    readonly momentsTexture: Uniform<THREE.Texture | null>;
    private momentsAlone: DepositPass | null = null;
    private readonly power: DepositPass;
    private tscDeposit = false;
    private readonly gasPasses: readonly [GridPass, GridPass];
    private gasCurrent = 0;
    private readonly heat: GridPass;
    private readonly coarse: GridPass;
    private readonly gravity: GridPass;
    private gravityPlain: GridPass | null = null;
    /** The gravity pass of the drawings' kind (masses from the moments, the fixed softening), for the lab's parity of A11; built on first use. */
    private gravityFixed: GridPass | null = null;
    /** The source of the gravity, (m, h^2) of the gas pass's fourth attachment, shared by reference with the passes that read it. */
    readonly sourceTexture: Uniform<THREE.Texture | null>;
    private readonly gravityUniforms: Record<string, THREE.IUniform>;
    /** Dev-only (see ProtostarGrids.compositionEnabled). */
    compositionEnabled = true;
    /** Dev-only (see ProtostarGrids.potentialEnabled). */
    potentialEnabled = true;

    constructor(options: GridChainOptions) {
        const { renderer, geometry, depositUniforms, blendType, resolution: res, scales: u, common } = options;
        this.renderer = renderer;
        this.common = common;
        this.geometry = geometry;
        this.depositUniforms = depositUniforms;
        this.blendType = blendType;
        this.resolution = res;
        this.coarseResolution = res / PROTOSTAR_COARSE_FACTOR;
        // Both attachments blend the same way: they must have the same type (float32 or half float).
        this.moments = new DepositPass(DEPOSIT_KIND.momentsAndComposition, depositUniforms, geometry, gridTarget(res, blendType, 2));
        this.momentsTexture = { value: this.moments.target.texture };
        // Four attachments (gas; the averaged temperature, the effective number of particles, the molecular weight's factor and the
        // thickness's factor of the fusion law; the fuel fractions; the source of the gravity), two targets in turn.
        const gasTargets = [gridTarget(res, THREE.FloatType, 4), gridTarget(res, THREE.FloatType, 4)] as const;
        this.sourceTexture = { value: gasTargets[0].textures[3] };
        const gasPass = (current: number): GridPass => new GridPass(withDefines(gasFrag, PROTOSTAR_DEFINES), {
            gridMoments: this.momentsTexture, gridComposition: { value: this.moments.target.textures[1] },
            gridThermoPrevious: { value: gasTargets[1 - current].textures[1] },
            depositVelScale: u.depositVelScale, densityPerDeposit: u.densityPerDeposit, temperatureWeight: u.temperatureWeight,
            molecularWeight: u.molecularWeight, noiseShape: u.noiseShape,
            thicknessOn: u.thicknessOn, thicknessPerDispersion: u.thicknessPerDispersion, thicknessFloor: u.thicknessFloor,
            thicknessCeiling: u.thicknessCeiling, thicknessReference: u.thicknessReference, softening2: u.softening2,
        }, gasTargets[current]);
        this.gasPasses = [gasPass(0), gasPass(1)];
        common.gridGas.value = this.gasPasses[0].target.texture;
        common.gridThermo.value = this.gasPasses[0].target.textures[1];
        common.gridFuel.value = this.gasPasses[0].target.textures[2];
        this.power = new DepositPass(DEPOSIT_KIND.power, depositUniforms, geometry, gridTarget(res, blendType));
        this.heat = new GridPass(withDefines(heatFrag, PROTOSTAR_DEFINES), {
            gridMoments: this.momentsTexture,
            gridPower: { value: this.power.target.texture },
            gridThermo: common.gridThermo,                 // the factor mu / mu_H of the gas pass of the same substep
        }, gridTarget(res, THREE.FloatType));
        common.gridHeat.value = this.heat.target.texture;
        this.coarse = new GridPass(withDefines(coarseFrag, { COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, COARSE_THICKNESS: 1 }), {
            gridMoments: this.momentsTexture, gridCell: common.gridCell,
            gridSource: this.sourceTexture, thicknessOn: u.thicknessOn, softening2: u.softening2,
        }, gridTarget(this.coarseResolution, THREE.FloatType));
        this.gravityUniforms = {
            gridMoments: this.momentsTexture, gridSource: this.sourceTexture,
            gridCoarse: { value: this.coarse.target.texture },
            gridCell: common.gridCell, softening2: u.softening2, gravityPerDeposit: u.gravityPerDeposit,
        };
        this.gravity = this.gravityPass(true);
        common.gridForce.value = this.gravity.target.texture;
    }

    /** The composition (attachment 1 of the moments deposit). */
    get compositionTexture(): THREE.Texture {
        return this.moments.target.textures[1];
    }

    get powerTexture(): THREE.Texture {
        return this.power.target.texture;
    }

    /** The render targets of the passes (the gas pass's: the latest drawn). */
    get targets(): Record<GridChainPassName, THREE.WebGLRenderTarget> {
        return {
            moments: this.moments.target, gas: this.gasPasses[this.gasCurrent].target, power: this.power.target, heat: this.heat.target,
            coarse: this.coarse.target, gravity: this.gravity.target,
        };
    }

    /** The gas target of the previous substep (the other one of the pair). */
    get previousGasTarget(): THREE.WebGLRenderTarget {
        return this.gasPasses[1 - this.gasCurrent].target;
    }

    /** Deposits with the TSC kernel (true) or the cloud-in-cell one (false) from the next render. */
    setTsc(tsc: boolean): void {
        this.tscDeposit = tsc;
        for (const pass of [this.moments, this.power, this.momentsAlone]) pass?.setTsc(tsc);
    }

    /**
     * Draws the passes from the particles (the deposit uniforms hold their textures) and publishes the fields to the common uniforms.
     * The caller sets the clear alpha to 0 (the deposits use alpha) and the render target back.
     */
    render(): void {
        const { renderer } = this;
        const moments = this.compositionEnabled ? this.moments : this.momentsWithoutComposition();
        this.momentsTexture.value = moments.target.texture;
        moments.render(renderer);
        this.gasCurrent = 1 - this.gasCurrent;
        const gas = this.gasPasses[this.gasCurrent];
        gas.render(renderer);
        this.common.gridGas.value = gas.target.texture;
        this.common.gridThermo.value = gas.target.textures[1];
        this.common.gridFuel.value = gas.target.textures[2];
        this.sourceTexture.value = gas.target.textures[3];
        this.power.render(renderer);
        this.heat.render(renderer);
        this.coarse.render(renderer);
        const gravity = this.potentialEnabled ? this.gravity : this.gravityWithoutPotential();
        this.common.gridForce.value = gravity.target.texture;
        gravity.render(renderer);
    }

    /** Dev-only: renders the pass `name` again from the inputs of the last render(), into the target it wrote then; returns it. */
    debugRenderPass(name: GridChainPassName): THREE.WebGLRenderTarget {
        const pass = {
            moments: this.compositionEnabled ? this.moments : this.momentsWithoutComposition(),
            gas: this.gasPasses[this.gasCurrent],
            power: this.power,
            heat: this.heat,
            coarse: this.coarse,
            gravity: this.potentialEnabled ? this.gravity : this.gravityWithoutPotential(),
        }[name];
        pass.render(this.renderer);
        return pass.target;
    }

    /**
     * Dev-only (the lab's parity of A11): draws the gravity of the last render() with the pass of the drawings' kind (grid-gravity.frag
     * without GRAVITY_SOURCE: the masses of the moments, the fixed softening for every pair) into a target of its own, and returns it.
     */
    debugRenderFixedGravity(): THREE.WebGLRenderTarget {
        this.gravityFixed ??= new GridPass(withDefines(gravityFrag, {
            GRID_RES: this.resolution, COARSE_RES: this.coarseResolution, COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, NEAR_RADIUS: PROTOSTAR_NEAR_RADIUS,
            ...(this.potentialEnabled ? { GRAVITY_POTENTIAL: 1 } : {}),
        }), { ...this.gravityUniforms }, gridTarget(this.resolution, THREE.FloatType));
        this.gravityFixed.render(this.renderer);
        return this.gravityFixed.target;
    }

    /** The gravity pass: acceleration in x and y, and with `potential` the Plummer potential in z (grid-gravity.frag). */
    private gravityPass(potential: boolean): GridPass {
        return new GridPass(withDefines(gravityFrag, {
            GRID_RES: this.resolution, COARSE_RES: this.coarseResolution, COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, NEAR_RADIUS: PROTOSTAR_NEAR_RADIUS,
            GRAVITY_SOURCE: 1, ...(potential ? { GRAVITY_POTENTIAL: 1 } : {}),
        }), this.gravityUniforms, gridTarget(this.resolution, THREE.FloatType));
    }

    /** Dev-only (see potentialEnabled): the gravity pass as it was before the potential, built on first use. */
    private gravityWithoutPotential(): GridPass {
        this.gravityPlain ??= this.gravityPass(false);
        return this.gravityPlain;
    }

    /** Dev-only (see compositionEnabled): the moments pass as it was before the composition, built on first use. */
    private momentsWithoutComposition(): DepositPass {
        this.momentsAlone ??= new DepositPass(DEPOSIT_KIND.moments, this.depositUniforms, this.geometry,
            gridTarget(this.resolution, this.blendType));
        this.momentsAlone.setTsc(this.tscDeposit);
        return this.momentsAlone;
    }

    dispose(): void {
        for (const pass of [this.moments, this.power, ...this.gasPasses, this.heat, this.coarse, this.gravity]) pass.dispose();
        this.momentsAlone?.dispose();
        this.gravityPlain?.dispose();
        this.gravityFixed?.dispose();
    }
}
