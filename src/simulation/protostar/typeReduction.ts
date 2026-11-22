// The number of particles of each type, counted on the GPU (A4). The particles are parcels of constant mass that change type when they
// fuse, so the share of each type is the mass share of each element: the stats show it. Two passes over the position texture
// (protostar-types.frag) and one read of MAX_SPECIES texels, replacing the periodic read of the whole position texture (up to 48 MB) and
// its loop over the particles on the CPU.

import * as THREE from 'three';
import { MAX_SPECIES, PROTOSTAR_TYPES_BLOCK, TEX_SIZE } from '../../config';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { withDefines } from '../../gl/withDefines';
import typesFrag from '../../shaders/protostar-types.frag?raw';

const STAGE = { first: 0, second: 1 } as const;
const ATTACHMENTS = 3;                                  // four types per attachment
const STAGE_SIZE = Math.ceil(TEX_SIZE / PROTOSTAR_TYPES_BLOCK);

if (MAX_SPECIES > 4 * ATTACHMENTS) throw new Error('protostar-types.frag counts at most 12 types');

export class TypeCountReduction {
    private readonly first: GridPass;
    private readonly second: GridPass;
    private readonly uniforms = { texturePosition: { value: null as THREE.Texture | null }, activeCount: { value: 0 } };

    constructor(private readonly renderer: THREE.WebGLRenderer) {
        const defines = {
            TYPES_FIRST: STAGE.first, TYPES_SECOND: STAGE.second, BLOCK: PROTOSTAR_TYPES_BLOCK, MAX_SPECIES, TEX_SIZE, STAGE_SIZE,
        };
        this.first = new GridPass(withDefines(typesFrag, { ...defines, TYPES_STAGE: STAGE.first }), this.uniforms,
            gridTarget(STAGE_SIZE, THREE.FloatType, ATTACHMENTS));
        const counts = this.first.target.textures;
        this.second = new GridPass(withDefines(typesFrag, { ...defines, TYPES_STAGE: STAGE.second }), {
            stageCounts0: { value: counts[0] }, stageCounts1: { value: counts[1] }, stageCounts2: { value: counts[2] },
        }, gridTarget(MAX_SPECIES, THREE.FloatType, 1, 1));
    }

    /** Counts the first `count` particles of `positions` (the position texture). The result is the texels of `target`. */
    render(positions: THREE.Texture, count: number): void {
        this.uniforms.texturePosition.value = positions;
        this.uniforms.activeCount.value = count;
        this.first.render(this.renderer);
        this.second.render(this.renderer);
    }

    /** The render target holding the counts, one texel per type, x. */
    get target(): THREE.WebGLRenderTarget {
        return this.second.target;
    }

    /** Reads the counts of the last render(): one per type, in rank order. */
    async read(): Promise<number[]> {
        const texels = new Float32Array(MAX_SPECIES * 4);
        await this.renderer.readRenderTargetPixelsAsync(this.second.target, 0, 0, MAX_SPECIES, 1, texels);
        return Array.from({ length: MAX_SPECIES }, (_, k) => texels[k * 4]);
    }

    dispose(): void {
        this.first.dispose();
        this.second.dispose();
    }
}
