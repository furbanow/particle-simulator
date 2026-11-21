import * as THREE from 'three';
import {
    MAX_SPECIES, PROTOSTAR_COARSE_FACTOR, PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_GRID_RES, PROTOSTAR_NEAR_RADIUS, PROTOSTAR_STATS_REDUCE_RES,
} from '../../config';
import { additiveBlending, clipSpaceCamera, type Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { glslFloat, withDefines } from '../../gl/withDefines';
import { DRAWING_DEFINES, drawingGlsl, type DrawingUniforms } from '../drawing/DrawingField';
import commonGlsl from '../../shaders/protostar-common.glsl?raw';
import depositVert from '../../shaders/protostar-deposit.vert?raw';
import depositFrag from '../../shaders/protostar-deposit.frag?raw';
import gasFrag from '../../shaders/protostar-gas.frag?raw';
import heatFrag from '../../shaders/protostar-heat.frag?raw';
import coarseFrag from '../../shaders/grid-coarse.frag?raw';
import gravityFrag from '../../shaders/grid-gravity.frag?raw';
import reduceFrag from '../../shaders/protostar-reduce.frag?raw';

const COARSE_RES = PROTOSTAR_GRID_RES / PROTOSTAR_COARSE_FACTOR;
const REDUCE_BLOCK = PROTOSTAR_GRID_RES / PROTOSTAR_STATS_REDUCE_RES;

/** Defines of every shader including protostar-common.glsl. */
export const PROTOSTAR_DEFINES = {
    MAX_SPECIES, GRID_RES: PROTOSTAR_GRID_RES, FUSION_RATE_MAX: glslFloat(PROTOSTAR_FUSION_RATE_MAX),
    ...DRAWING_DEFINES,
} as const;

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

/** Prepends the defines and the shared GLSL (grid sampling and drawings, fusion rate, random numbers). */
export const withProtostarCommon = (source: string, defines: Record<string, string | number> = {}): string =>
    withDefines(`${drawingGlsl}\n${commonGlsl}\n${source}`, { ...PROTOSTAR_DEFINES, ...defines });

/**
 * The uniforms of protostar-common.glsl (and of drawing.glsl, which it uses), shared by reference
 * by every material that includes it.
 */
export interface ProtostarCommonUniforms extends DrawingUniforms {
    gridForce: Uniform<THREE.Texture | null>;
    gridGas: Uniform<THREE.Texture | null>;
    gridHeat: Uniform<THREE.Texture | null>;
    gridCell: Uniform<number>;
    fusionTRef: Uniform<number>;
    seed: Uniform<number>;
    reactionTo: Uniform<number[]>;
    reactionKeep: Uniform<number[]>;
    reactionRate: Uniform<number[]>;
    reactionExponent: Uniform<number[]>;
    reactionReference: Uniform<number[]>;
    reactionDensityExponent: Uniform<number[]>;
    reactionEnergy: Uniform<number[]>;
}

export function createCommonUniforms(drawing: DrawingUniforms): ProtostarCommonUniforms {
    const perType = (fill: number): Uniform<number[]> => ({ value: new Array<number>(MAX_SPECIES).fill(fill) });
    return {
        ...drawing,
        gridForce: { value: null }, gridGas: { value: null }, gridHeat: { value: null },
        gridCell: { value: 1 }, fusionTRef: { value: 1 }, seed: { value: 0 },
        reactionTo: perType(-1), reactionKeep: perType(0), reactionRate: perType(0),
        reactionExponent: perType(0), reactionReference: perType(1), reactionDensityExponent: perType(1),
        reactionEnergy: perType(0),
    };
}

/** The render targets of the grid passes (see ProtostarGrids), by pass name. */
export interface ProtostarGridTargets {
    /**
     * Two attachments, deposited together: `moments.texture` (attachment 0) holds (m, m v, m |v|^2),
     * `moments.textures[1]` (attachment 1) the composition (sum m (1 + Z) / A, sum count, sum m^2, 0)
     * with the same cloud-in-cell weights. No pass reads the composition yet. Only attachment 0 can
     * be read back directly (see lab/readback.ts).
     */
    readonly moments: THREE.WebGLRenderTarget;
    readonly gas: THREE.WebGLRenderTarget;
    readonly power: THREE.WebGLRenderTarget;
    readonly heat: THREE.WebGLRenderTarget;
    readonly coarse: THREE.WebGLRenderTarget;
    readonly gravity: THREE.WebGLRenderTarget;
    /** First stage of the stats reduction. */
    readonly reduce1: THREE.WebGLRenderTarget;
    /** The single texel the stats are read from. */
    readonly reduce2: THREE.WebGLRenderTarget;
}

/** What the deposit shader reads, as plain numbers (see ProtostarGrids.debugDepositInputs). */
export interface DepositInputs {
    gridResolution: number;
    /** px per cell. */
    gridCell: number;
    /** Deposit units per simulation mass unit. */
    depositMassScale: number;
    /** Mass of a particle of each type, simulation mass units. */
    splatMass: number[];
    /** (1 + Z) / A of each type, per u. */
    inverseMolecularWeight: number[];
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
}

/** An additive cloud-in-cell deposit of the particles into a render target. */
class DepositPass {
    readonly material: THREE.ShaderMaterial;
    private readonly scene = new THREE.Scene();

    constructor(kind: DepositKind, uniforms: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry,
                readonly target: THREE.WebGLRenderTarget) {
        this.material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: withProtostarCommon(depositVert, {
                DEPOSIT_KIND: kind, ...DEPOSIT_KIND_DEFINES,
            }),
            fragmentShader: withDefines(depositFrag, { DEPOSIT_KIND: kind, ...DEPOSIT_KIND_DEFINES }),
            ...additiveBlending,
        });
        const points = new THREE.Points(geometry, this.material);
        points.frustumCulled = false;
        this.scene.add(points);
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
 *     pass, of the composition (m (1 + Z) / A, count, m^2), for the passes that need it (none yet);
 *  2. gas: density, temperature (velocity dispersion) and mean velocity of each 3x3 neighborhood;
 *  3. power: deposit of the expected fusion power of the fusing particles;
 *  4. heat: fusion heating per unit mass of each 3x3 neighborhood;
 *  5. coarse + gravity: softened gravity at the cell centers, summed cell to cell on two levels.
 * The particle passes sample gas, heat and gravity through the common uniforms. reduceStats()
 * reduces the gas and power grids to one texel (max density, temperature there, fusions / s).
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
    private readonly gas: GridPass;
    private readonly heat: GridPass;
    private readonly coarse: GridPass;
    private readonly gravity: GridPass;
    private readonly reduce1: GridPass;
    readonly reduce2: GridPass;
    private readonly u = {
        texturePosition: { value: null as THREE.Texture | null },
        textureVelocity: { value: null as THREE.Texture | null },
        depositMassScale: { value: 1 },
        depositVelScale: { value: 1 },
        densityPerDeposit: { value: 1 },
        gravityPerDeposit: { value: 1 },
        softening2: { value: 1 },
        speciesInverseMu: { value: new Array<number>(MAX_SPECIES).fill(0) },
    };
    /**
     * Dev-only (the lab's cost comparison): false makes the moments pass deposit the moments alone,
     * as it did before the composition existed (the composition grid then goes stale). True in the application.
     */
    compositionEnabled = true;

    constructor(private readonly renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry,
                private readonly splatMass: Uniform<number[]>, drawing: DrawingUniforms) {
        this.common = createCommonUniforms(drawing);
        // Additive float32 blending needs EXT_float_blend (asking for it enables it); half floats otherwise.
        const blendType = !halfFloatDepositForced && renderer.extensions.has('EXT_float_blend')
            ? THREE.FloatType : THREE.HalfFloatType;
        const res = PROTOSTAR_GRID_RES;
        const { u, common } = this;
        const particleUniforms = { ...common, ...u, speciesSplatMass: splatMass };
        this.geometry = geometry;
        this.depositUniforms = particleUniforms;
        this.blendType = blendType;
        // Both attachments blend the same way: they must have the same type (float32 or half float).
        this.moments = new DepositPass(DEPOSIT_KIND.momentsAndComposition, particleUniforms, geometry, gridTarget(res, blendType, 2));
        this.momentsTexture = { value: this.moments.target.texture };
        this.gas = new GridPass(withDefines(gasFrag, PROTOSTAR_DEFINES), {
            gridMoments: this.momentsTexture,
            depositVelScale: u.depositVelScale, densityPerDeposit: u.densityPerDeposit,
        }, gridTarget(res, THREE.FloatType));
        common.gridGas.value = this.gas.target.texture;
        this.power = new DepositPass(DEPOSIT_KIND.power, particleUniforms, geometry, gridTarget(res, blendType));
        this.heat = new GridPass(withDefines(heatFrag, PROTOSTAR_DEFINES), {
            gridMoments: this.momentsTexture,
            gridPower: { value: this.power.target.texture },
        }, gridTarget(res, THREE.FloatType));
        common.gridHeat.value = this.heat.target.texture;
        this.coarse = new GridPass(withDefines(coarseFrag, { COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR }), {
            gridMoments: this.momentsTexture, gridCell: common.gridCell,
        }, gridTarget(COARSE_RES, THREE.FloatType));
        this.gravity = new GridPass(withDefines(gravityFrag, {
            GRID_RES: res, COARSE_RES, COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, NEAR_RADIUS: PROTOSTAR_NEAR_RADIUS,
        }), {
            gridMoments: this.momentsTexture,
            gridCoarse: { value: this.coarse.target.texture },
            gridCell: common.gridCell, softening2: u.softening2, gravityPerDeposit: u.gravityPerDeposit,
        }, gridTarget(res, THREE.FloatType));
        common.gridForce.value = this.gravity.target.texture;
        this.reduce1 = new GridPass(withDefines(reduceFrag, { FIRST_STAGE: 1, BLOCK: REDUCE_BLOCK }), {
            source: { value: this.gas.target.texture }, gridPower: { value: this.power.target.texture },
            fusionTRef: common.fusionTRef,
        }, gridTarget(PROTOSTAR_STATS_REDUCE_RES, THREE.FloatType));
        this.reduce2 = new GridPass(withDefines(reduceFrag, { FIRST_STAGE: 0, BLOCK: PROTOSTAR_STATS_REDUCE_RES }), {
            source: { value: this.reduce1.target.texture }, gridPower: { value: null },
            fusionTRef: common.fusionTRef,
        }, gridTarget(1, THREE.FloatType));
    }

    /** Dev-only, read-only: the render targets of every pass, to read the grids back. */
    get targets(): ProtostarGridTargets {
        return {
            moments: this.moments.target, gas: this.gas.target, power: this.power.target, heat: this.heat.target,
            coarse: this.coarse.target, gravity: this.gravity.target, reduce1: this.reduce1.target, reduce2: this.reduce2.target,
        };
    }

    /**
     * The factor (1 + Z) / A of each type, per u (see composition.ts), written in place: the array
     * is shared by reference with the deposit materials.
     */
    setInverseMolecularWeights(factors: readonly number[]): void {
        const array = this.u.speciesInverseMu.value;
        for (let k = 0; k < array.length; k++) array[k] = factors[k] ?? 0;
    }

    /** Dev-only, read-only: the values the deposit shader runs with, to compute the deposit again on the CPU. */
    get debugDepositInputs(): DepositInputs {
        return {
            gridResolution: PROTOSTAR_GRID_RES,
            gridCell: this.common.gridCell.value,
            depositMassScale: this.u.depositMassScale.value,
            splatMass: [...this.splatMass.value],
            inverseMolecularWeight: [...this.u.speciesInverseMu.value],
        };
    }

    setScales(s: GridScales): void {
        const { u } = this;
        u.depositMassScale.value = s.depositMassScale;
        u.depositVelScale.value = s.depositVelScale;
        u.densityPerDeposit.value = s.densityPerDeposit;
        u.gravityPerDeposit.value = s.gravityPerDeposit;
        u.softening2.value = s.softening * s.softening;
    }

    /** Renders every grid from the particle state. */
    update(positions: THREE.Texture, velocities: THREE.Texture): void {
        const { renderer } = this;
        this.u.texturePosition.value = positions;
        this.u.textureVelocity.value = velocities;
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);                      // the deposits use alpha: start from 0
        const moments = this.compositionEnabled ? this.moments : this.momentsWithoutComposition();
        this.momentsTexture.value = moments.target.texture;
        moments.render(renderer);
        this.gas.render(renderer);
        this.power.render(renderer);
        this.heat.render(renderer);
        this.coarse.render(renderer);
        this.gravity.render(renderer);
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(null);
    }

    /** Dev-only (see compositionEnabled): the moments pass as it was before the composition, built on first use. */
    private momentsWithoutComposition(): DepositPass {
        this.momentsAlone ??= new DepositPass(DEPOSIT_KIND.moments, this.depositUniforms, this.geometry,
            gridTarget(PROTOSTAR_GRID_RES, this.blendType));
        return this.momentsAlone;
    }

    /** Reduces the stats into reduce2's single texel. */
    reduceStats(): void {
        this.reduce1.render(this.renderer);
        this.reduce2.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    dispose(): void {
        for (const pass of [this.moments, this.power, this.gas, this.heat, this.coarse, this.gravity, this.reduce1, this.reduce2]) {
            pass.dispose();
        }
        this.momentsAlone?.dispose();
    }
}
