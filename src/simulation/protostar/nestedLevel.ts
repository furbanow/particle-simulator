// The fine level of the nested grid (C2, the `nestedGrid` flag; nestedBox.ts says where the box goes and how the levels join): a second grid
// chain of the same resolution, NESTED_RATIO times finer, over the box; the passes that join it to the main grid; its reductions.
import * as THREE from 'three';
import {
    PROTOSTAR_COARSE_FACTOR, PROTOSTAR_GRID_RES, PROTOSTAR_NEAR_RADIUS, PROTOSTAR_NESTED_MARGIN_CELLS, PROTOSTAR_NESTED_RATIO,
    PROTOSTAR_STATS_REDUCE_RES,
} from '../../config';
import type { Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { withDefines } from '../../gl/withDefines';
import coarseFrag from '../../shaders/grid-coarse.frag?raw';
import gravityFrag from '../../shaders/grid-gravity.frag?raw';
import gatherFrag from '../../shaders/protostar-nested-gather.frag?raw';
import combineFrag from '../../shaders/protostar-nested-combine.frag?raw';
import { GridChain, type GridChainScales } from './gridChain';
import type { ProtostarCommonUniforms } from './gridCommon';
import { boxCells, readRegion } from './nestedBox';

/** What the fine level is built from: the main grid's. */
export interface NestedLevelOptions {
    renderer: THREE.WebGLRenderer;
    geometry: THREE.BufferGeometry;
    /** The main deposits' uniforms (the common ones and the particles' textures and scales). */
    depositUniforms: Record<string, THREE.IUniform>;
    blendType: THREE.TextureDataType;
    /** The main grid's scales; the fine level shares them but for its density, its softening and the weight of its temperature's average. */
    scales: GridChainScales;
    /** The main common uniforms: the fine level publishes its fields to their nested*, grid*Fine members. */
    common: ProtostarCommonUniforms;
    /** The main chain's source of the gravity (h^2 of the main cells, for a_main(inside)). */
    mainSource: Uniform<THREE.Texture | null>;
}

/** The scales of the fine level that differ from the main grid's (set every substep). */
export interface NestedScales {
    /** rho / rho0 per deposited mass in a 3 x 3 neighborhood of fine cells. */
    densityPerDeposit: number;
    /** The fine level's softening, px. */
    softening: number;
}

/**
 * The fine level, in the order the owner draws it within a substep (ProtostarGrids.update()):
 *  1. renderGas(): the fine moments (only the mass inside the box lands on its grid) and the fine gas, published to grid*Fine;
 *  2. renderRest(): the fine power, heat and gravity (a_fine(inside), the fine softening), after the main grid's own power;
 *  3. join(): the mass inside gathered on the main cells, the main grid's coarse and gravity passes of it (a_main(inside), only over the
 *     box and one cell around it), and the combined force a_fine(inside) + a_main(all) - a_main(inside) at the fine cells, published to
 *     gridForceFine (the particles inside read it).
 * reduce() and stashPotential() run the main grid's reductions over the fine level (NESTED_LEVEL), for the three nested texels.
 */
export class NestedLevel {
    readonly chain: GridChain;
    /** The fine level's own common uniforms (its cell and origin; nestedOn 0: its deposits read its own gas as the "main" one). */
    private readonly fineCommon: ProtostarCommonUniforms;
    private readonly own = {
        densityPerDeposit: { value: 1 },
        softening2: { value: 1 },
        temperatureWeight: { value: 1 },
        nestedBox: { value: new THREE.Vector2() },
        gravityRegion: { value: new THREE.Vector4() },
    };
    private readonly gather: GridPass;
    private readonly insideCoarse: GridPass;
    private readonly insideGravity: GridPass;
    private readonly combine: GridPass;
    readonly reduce1: GridPass;
    private readonly potential1: GridPass;
    readonly potential2: GridPass;

    /** `shaders`: the first stage of the reduction and both of the potential, compiled with NESTED_LEVEL (grids.ts builds them). */
    constructor(private readonly options: NestedLevelOptions, shaders: { reduce: string; potential1: string; potential2: string }) {
        const { renderer, geometry, depositUniforms, blendType, scales: u, common, mainSource } = options;
        const res = PROTOSTAR_GRID_RES;
        // The fine chain publishes its gas, thermo, fuel and heat straight to the main common's fine members (the particle passes hold
        // those very objects), its raw gravity to a uniform of its own (the particles read the combined force).
        const fineGravity: Uniform<THREE.Texture | null> = { value: null };
        this.fineCommon = {
            ...common,
            gridCell: common.nestedCell, gridOrigin: common.nestedOrigin, nestedOn: { value: 0 },
            gridGas: common.gridGasFine, gridThermo: common.gridThermoFine, gridFuel: common.gridFuelFine, gridHeat: common.gridHeatFine,
            gridForce: fineGravity,
        };
        const fineScales: GridChainScales = {
            ...u, densityPerDeposit: this.own.densityPerDeposit, softening2: this.own.softening2, temperatureWeight: this.own.temperatureWeight,
        };
        const fineCommon = this.fineCommon;
        this.chain = new GridChain({
            renderer, geometry, blendType, resolution: res, scales: fineScales, common: fineCommon,
            depositUniforms: {
                ...depositUniforms, gridCell: fineCommon.gridCell, gridOrigin: fineCommon.gridOrigin, nestedOn: fineCommon.nestedOn,
                gridGas: fineCommon.gridGas, gridThermo: fineCommon.gridThermo, gridFuel: fineCommon.gridFuel, gridHeat: fineCommon.gridHeat,
                gridForce: fineGravity,
            },
        });
        const coarseRes = res / PROTOSTAR_COARSE_FACTOR;
        this.gather = new GridPass(withDefines(gatherFrag, { GRID_RES: res, NESTED_RATIO: PROTOSTAR_NESTED_RATIO }), {
            gridMomentsFine: this.chain.momentsTexture, gridSourceMain: mainSource, nestedBox: this.own.nestedBox,
        }, gridTarget(res, THREE.FloatType));
        const inside = { value: this.gather.target.texture };
        this.insideCoarse = new GridPass(withDefines(coarseFrag, { COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, COARSE_THICKNESS: 1 }), {
            gridMoments: inside, gridCell: common.gridCell, gridSource: inside, thicknessOn: u.thicknessOn, softening2: u.softening2,
        }, gridTarget(coarseRes, THREE.FloatType));
        this.insideGravity = new GridPass(withDefines(gravityFrag, {
            GRID_RES: res, COARSE_RES: coarseRes, COARSE_FACTOR: PROTOSTAR_COARSE_FACTOR, NEAR_RADIUS: PROTOSTAR_NEAR_RADIUS,
            GRAVITY_SOURCE: 1, GRAVITY_POTENTIAL: 1, GRAVITY_REGION: 1,
        }), {
            gridMoments: inside, gridSource: inside, gridCoarse: { value: this.insideCoarse.target.texture },
            gridCell: common.gridCell, softening2: u.softening2, gravityPerDeposit: u.gravityPerDeposit, gravityRegion: this.own.gravityRegion,
        }, gridTarget(res, THREE.FloatType));
        this.combine = new GridPass(withDefines(combineFrag, { GRID_RES: res }), {
            gridGravityFine: fineGravity, gridForce: common.gridForce, gridGravityInside: { value: this.insideGravity.target.texture },
            gridCell: common.gridCell, nestedCell: common.nestedCell, nestedOrigin: common.nestedOrigin,
        }, gridTarget(res, THREE.FloatType));
        common.gridForceFine.value = this.combine.target.texture;
        const combined = { value: this.combine.target.texture };
        const reduceUniforms = {
            gridGas: fineCommon.gridGas, gridThermo: fineCommon.gridThermo, gridMoments: this.chain.momentsTexture,
            gridComposition: { value: this.chain.compositionTexture }, gridForce: combined, gridPower: { value: this.chain.powerTexture },
            gridCell: fineCommon.gridCell, gridOrigin: fineCommon.gridOrigin, fusionTRef: common.fusionTRef,
            gridSource: this.chain.sourceTexture, gravityPerDeposit: u.gravityPerDeposit, mainSoftening2: u.softening2,
        };
        this.reduce1 = new GridPass(shaders.reduce, reduceUniforms,
            gridTarget(PROTOSTAR_STATS_REDUCE_RES, THREE.FloatType, 4));
        this.potential1 = new GridPass(shaders.potential1, {
            gridMoments: this.chain.momentsTexture, gridForce: combined, gridComposition: { value: this.chain.compositionTexture },
            gridSource: this.chain.sourceTexture, gravityPerDeposit: u.gravityPerDeposit, mainSoftening2: u.softening2,
        }, gridTarget(PROTOSTAR_STATS_REDUCE_RES, THREE.FloatType));
        this.potential2 = new GridPass(shaders.potential2, { source: { value: this.potential1.target.texture } },
            gridTarget(1, THREE.FloatType));
    }

    /** Puts the box at `origin` (its lower left main cell) on a grid of `mainCell` px cells: the fine cell, the origin and the read region. */
    place(origin: { x: number; y: number }, mainCell: number): void {
        const { common } = this.options;
        const fineCell = mainCell / PROTOSTAR_NESTED_RATIO;
        common.nestedCell.value = fineCell;
        common.nestedOrigin.value.set(origin.x * mainCell, origin.y * mainCell);
        const region = readRegion({ x: origin.x * mainCell, y: origin.y * mainCell }, fineCell, PROTOSTAR_GRID_RES, PROTOSTAR_NESTED_MARGIN_CELLS);
        common.nestedLo.value.set(region.lo.x, region.lo.y);
        common.nestedHi.value.set(region.hi.x, region.hi.y);
        this.own.nestedBox.value.set(origin.x, origin.y);
        const size = boxCells({ gridRes: PROTOSTAR_GRID_RES, ratio: PROTOSTAR_NESTED_RATIO });
        // a_main(inside) is read bilinearly at the fine centers: the box's main cells and one around them.
        this.own.gravityRegion.value.set(origin.x - 1, origin.y - 1, origin.x + size, origin.y + size);
    }

    setScales(s: NestedScales): void {
        this.own.densityPerDeposit.value = s.densityPerDeposit;
        this.own.softening2.value = s.softening * s.softening;
    }

    /** The weight of the new temperature in the fine level's average: 1 after the box was placed or moved (its history is elsewhere). */
    setTemperatureWeight(weight: number): void {
        this.own.temperatureWeight.value = weight;
    }

    setTsc(tsc: boolean): void {
        this.chain.setTsc(tsc);
    }

    renderGas(): void {
        this.chain.renderGas();
    }

    renderRest(): void {
        this.chain.renderRest();
    }

    join(): void {
        const { renderer } = this.options;
        this.gather.render(renderer);
        this.insideCoarse.render(renderer);
        this.insideGravity.render(renderer);
        this.combine.render(renderer);
    }

    /** Dev-only (the lab): the targets of the joining passes (the gathered mass, a_main(inside), the combined force). */
    get joinTargets(): { gather: THREE.WebGLRenderTarget; insideGravity: THREE.WebGLRenderTarget; combine: THREE.WebGLRenderTarget } {
        return { gather: this.gather.target, insideGravity: this.insideGravity.target, combine: this.combine.target };
    }

    /** Dev-only (the lab's cost of the passes): renders the joining pass `name` again; returns its target. */
    debugRenderJoin(name: 'gather' | 'insideCoarse' | 'insideGravity' | 'combine'): THREE.WebGLRenderTarget {
        const pass = { gather: this.gather, insideCoarse: this.insideCoarse, insideGravity: this.insideGravity, combine: this.combine }[name];
        pass.render(this.options.renderer);
        return pass.target;
    }

    reduce(): void {
        this.reduce1.render(this.options.renderer);
    }

    stashPotential(): void {
        this.potential1.render(this.options.renderer);
        this.potential2.render(this.options.renderer);
    }

    dispose(): void {
        this.chain.dispose();
        for (const pass of [this.gather, this.insideCoarse, this.insideGravity, this.combine, this.reduce1, this.potential1, this.potential2]) {
            pass.dispose();
        }
    }
}
