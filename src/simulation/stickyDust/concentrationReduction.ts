import * as THREE from 'three';
import {
    CONCENTRATION_BINS, CONCENTRATION_CELLS_PER_RADIUS, CONCENTRATION_REDUCE_BLOCK, CONCENTRATION_REPLICA_BUDGET,
    CONCENTRATION_REPLICA_COLUMNS, CONCENTRATION_REPLICAS, MAX_SPECIES,
} from '../../config';
import { additiveBlending, clipSpaceCamera } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { withDefines } from '../../gl/withDefines';
import {
    CONCENTRATION_RESULT_FLOATS, CONCENTRATION_RESULT_TEXELS, concentrationGrid, unpackConcentration,
    type ConcentrationGrid, type ConcentrationReading,
} from '../concentration';
import bestFrag from '../../shaders/concentration-best.frag?raw';
import depositFrag from '../../shaders/concentration-deposit.frag?raw';
import depositVert from '../../shaders/concentration-deposit.vert?raw';
import disksFrag from '../../shaders/concentration-disks.frag?raw';
import foldFrag from '../../shaders/concentration-fold.frag?raw';
import sumFrag from '../../shaders/concentration-sum.frag?raw';

const DEPOSIT = { cells: 0, center: 1, members: 2 } as const;
type DepositKind = (typeof DEPOSIT)[keyof typeof DEPOSIT];
const DEPOSIT_DEFINES = { DEPOSIT_CELLS: DEPOSIT.cells, DEPOSIT_CENTER: DEPOSIT.center, DEPOSIT_MEMBERS: DEPOSIT.members } as const;
const BEST = { blocks: 0, final: 1 } as const;
const SUM = { blocks: 0, center: 1, result: 2 } as const;

const BLOCK = CONCENTRATION_REDUCE_BLOCK;
const BINS = CONCENTRATION_BINS;
if (BINS % BLOCK !== 0) throw new Error('CONCENTRATION_BINS must be a multiple of CONCENTRATION_REDUCE_BLOCK');

/** One point per particle drawn into a float32 target with additive blending (the particles outside a disk are culled by the vertex shader). */
class DepositPass {
    private readonly material: THREE.ShaderMaterial;
    private readonly scene = new THREE.Scene();

    constructor(kind: DepositKind, uniforms: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry,
                private readonly target: THREE.WebGLRenderTarget) {
        this.material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: withDefines(depositVert, { DEPOSIT_KIND: kind, ...DEPOSIT_DEFINES, MAX_SPECIES, BINS }),
            fragmentShader: depositFrag,
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
        this.material.dispose();
    }
}

/**
 * How the copies of the coarse grid are laid out: as many (a power of two, at most CONCENTRATION_REPLICAS) as the budget of texels allows
 * for `cells` cells, in tiles of the grid's size, CONCENTRATION_REPLICA_COLUMNS to a row at most.
 */
export function replicaTiles(cells: number): { columns: number; rows: number } {
    let copies = 1;
    while (copies < CONCENTRATION_REPLICAS && cells * copies * 2 <= CONCENTRATION_REPLICA_BUDGET) copies *= 2;
    const columns = Math.min(copies, CONCENTRATION_REPLICA_COLUMNS);
    return { columns, rows: copies / columns };
}

/**
 * The search of the densest disk of the detection radius on the GPU, with the steps and the figures of `analyzeConcentration`
 * (simulation/concentration.ts, its CPU reference): the particles' masses are summed into the cells of a coarse grid (float32
 * blending: the density grid's half floats saturate), the mass of the disk of cells around each cell is summed, the densest
 * one wins (first in reading order on a tie), its center moves to the center of mass of the particles inside the radius (a point
 * pass over the particles, summed in bins then reduced), and a last point pass sums the mass and the second moment of the particles
 * inside the radius about that center. What is read back is two texels: the center, the mass inside, the total mass, the second
 * moment, the number of particles (see unpackConcentration), not the 48 MB of positions.
 *
 * The three point passes read the position texture once each (the culled vertices cost a fetch, not a fragment); the rest runs on
 * grids of a few thousand texels. The sums are float32: the masses of the species are of order 1 to 10, the offsets in the sums
 * are taken from the cell's center, so the relative error stays near 1e-6 up to the three million particles.
 */
export class ConcentrationReduction {
    /** Whether the device can blend float32 targets (EXT_float_blend), which the mass sums need. */
    static supported(renderer: THREE.WebGLRenderer): boolean {
        const extensions = renderer.extensions as THREE.WebGLExtensions | undefined;
        return typeof extensions?.has === 'function' && extensions.has('EXT_float_blend');
    }

    private readonly uniforms = {
        texturePosition: { value: null as THREE.Texture | null },
        speciesMass: { value: [] as number[] },
        gridCells: { value: new THREE.Vector2(1, 1) },
        replicaTiles: { value: new THREE.Vector2(1, 1) },
        cellSize: { value: 1 },
        radius: { value: 1 },
        reachSquared: { value: 0 },
    };
    private readonly replicas = gridTarget(1, THREE.FloatType);
    private readonly cells = gridTarget(1, THREE.FloatType);
    private readonly disks = gridTarget(1, THREE.FloatType);
    private readonly blocks = gridTarget(1, THREE.FloatType);
    private readonly best = gridTarget(1, THREE.FloatType);
    private readonly bins = gridTarget(BINS, THREE.FloatType);
    private readonly sums = gridTarget(BINS / BLOCK, THREE.FloatType);
    private readonly center = gridTarget(1, THREE.FloatType);
    private readonly result = gridTarget(CONCENTRATION_RESULT_TEXELS, THREE.FloatType, 1, 1);
    private readonly depositCells: DepositPass;
    private readonly foldPass: GridPass;
    private readonly depositCenter: DepositPass;
    private readonly depositMembers: DepositPass;
    private readonly disksPass: GridPass;
    private readonly blocksPass: GridPass;
    private readonly bestPass: GridPass;
    private readonly sumsPass: GridPass;
    private readonly centerPass: GridPass;
    private readonly resultPass: GridPass;
    private grid: ConcentrationGrid | null = null;

    /** `speciesMass` is shared by reference: the model rewrites it in place when the species change. */
    constructor(private readonly renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry, speciesMass: number[]) {
        const u = this.uniforms;
        u.speciesMass.value = speciesMass;
        const own = (extra: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> => ({ ...u, ...extra });
        this.depositCells = new DepositPass(DEPOSIT.cells, own({}), geometry, this.replicas);
        this.foldPass = new GridPass(foldFrag, { replicas: { value: this.replicas.texture }, replicaTiles: u.replicaTiles }, this.cells);
        this.depositCenter = new DepositPass(DEPOSIT.center, own({ stageCenter: { value: this.best.texture } }), geometry, this.bins);
        this.depositMembers = new DepositPass(DEPOSIT.members, own({ stageCenter: { value: this.center.texture } }), geometry, this.bins);
        this.disksPass = new GridPass(withDefines(disksFrag, { REACH: CONCENTRATION_CELLS_PER_RADIUS }),
            { cells: { value: this.cells.texture }, reachSquared: u.reachSquared }, this.disks);
        this.blocksPass = new GridPass(withDefines(bestFrag, { BEST_STAGE: BEST.blocks, BEST_BLOCKS: BEST.blocks, BEST_FINAL: BEST.final, BLOCK }),
            { disks: { value: this.disks.texture }, cells: { value: this.cells.texture } }, this.blocks);
        this.bestPass = new GridPass(withDefines(bestFrag, { BEST_STAGE: BEST.final, BEST_BLOCKS: BEST.blocks, BEST_FINAL: BEST.final, BLOCK }),
            { disks: { value: this.disks.texture }, blocks: { value: this.blocks.texture }, cellSize: u.cellSize }, this.best);
        const sumDefines = (stage: number): Record<string, number> => ({
            SUM_STAGE: stage, SUM_BLOCKS: SUM.blocks, SUM_CENTER: SUM.center, SUM_RESULT: SUM.result, BLOCK,
        });
        this.sumsPass = new GridPass(withDefines(sumFrag, sumDefines(SUM.blocks)), { source: { value: this.bins.texture } }, this.sums);
        this.centerPass = new GridPass(withDefines(sumFrag, sumDefines(SUM.center)),
            { source: { value: this.sums.texture }, stageBest: { value: this.best.texture } }, this.center);
        this.resultPass = new GridPass(withDefines(sumFrag, sumDefines(SUM.result)),
            { source: { value: this.sums.texture }, stageBest: { value: this.best.texture }, stageCenter: { value: this.center.texture } },
            this.result);
    }

    /** Dev-only, read-only: the grid of the last measure, for the lab. Not used by the app. */
    get debugGrid(): ConcentrationGrid | null {
        return this.grid;
    }

    /** The coarse grids have the size of the screen over the cell size: they follow the radius and the resize, when a measure asks. */
    private fit(grid: ConcentrationGrid): void {
        const tiles = replicaTiles(grid.columns * grid.rows);
        this.uniforms.replicaTiles.value.set(tiles.columns, tiles.rows);
        this.replicas.setSize(grid.columns * tiles.columns, grid.rows * tiles.rows);
        if (this.grid && this.grid.columns === grid.columns && this.grid.rows === grid.rows) return;
        for (const target of [this.cells, this.disks]) target.setSize(grid.columns, grid.rows);
        this.blocks.setSize(Math.ceil(grid.columns / BLOCK), Math.ceil(grid.rows / BLOCK));
    }

    /**
     * Searches the densest disk of `radius` px among the particles of the position texture and resolves with the figures read back
     * (a few floats, asynchronously when the renderer can). The passes are queued now: the texture holds what it holds at this call.
     * `totalMass`, when the caller knows it, is the denominator of the share (see unpackConcentration).
     */
    measure(positions: THREE.Texture, radius: number, width: number, height: number, totalMass?: number): Promise<ConcentrationReading> {
        const { renderer, uniforms: u } = this;
        const grid = concentrationGrid(radius, width, height);
        this.fit(grid);
        this.grid = grid;
        u.texturePosition.value = positions;
        u.gridCells.value.set(grid.columns, grid.rows);
        u.cellSize.value = grid.cellSize;
        u.radius.value = radius;
        u.reachSquared.value = grid.reachSquared;

        const previousTarget = renderer.getRenderTarget();
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);                       // the sums start from 0 in every channel
        this.depositCells.render(renderer);
        this.foldPass.render(renderer);
        this.disksPass.render(renderer);
        this.blocksPass.render(renderer);
        this.bestPass.render(renderer);
        this.depositCenter.render(renderer);
        this.sumsPass.render(renderer);
        this.centerPass.render(renderer);
        this.depositMembers.render(renderer);
        this.sumsPass.render(renderer);
        this.resultPass.render(renderer);
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(previousTarget);

        const buffer = new Float32Array(CONCENTRATION_RESULT_FLOATS);
        if (renderer.readRenderTargetPixelsAsync) {
            return renderer.readRenderTargetPixelsAsync(this.result, 0, 0, CONCENTRATION_RESULT_TEXELS, 1, buffer)
                .then(() => unpackConcentration(buffer, totalMass));
        }
        renderer.readRenderTargetPixels(this.result, 0, 0, CONCENTRATION_RESULT_TEXELS, 1, buffer);
        return Promise.resolve(unpackConcentration(buffer, totalMass));
    }

    dispose(): void {
        for (const pass of [this.depositCells, this.depositCenter, this.depositMembers]) pass.dispose();
        for (const pass of [this.foldPass, this.disksPass, this.blocksPass, this.bestPass, this.sumsPass, this.centerPass, this.resultPass]) pass.dispose();
        for (const target of [this.replicas, this.bins]) target.dispose();
    }
}
