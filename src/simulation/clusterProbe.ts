import type * as THREE from 'three';
import { MAX_PARTICLES, TEX_SIZE } from '../config';

/**
 * Reads the particle positions back from the GPU (asynchronously when the renderer supports it)
 * and hands them to a callback. A result is dropped when the simulation was restarted meanwhile.
 */
export class ClusterProbe {
    private readonly buffer = new Float32Array(MAX_PARTICLES * 4);
    private pending = false;

    constructor(private readonly renderer: THREE.WebGLRenderer) {}

    get busy(): boolean {
        return this.pending;
    }

    read(target: THREE.WebGLRenderTarget, activeCount: number, isCurrent: () => boolean,
         onPositions: (positions: Float32Array) => void): void {
        if (this.pending) return;
        const rows = Math.ceil(activeCount / TEX_SIZE);
        const view = this.buffer.subarray(0, rows * TEX_SIZE * 4);
        if (this.renderer.readRenderTargetPixelsAsync) {
            this.pending = true;
            this.renderer.readRenderTargetPixelsAsync(target, 0, 0, TEX_SIZE, rows, view)
                .then(() => { if (isCurrent()) onPositions(view); })
                .catch(err => console.error(err))
                .finally(() => { this.pending = false; });
        } else {
            this.renderer.readRenderTargetPixels(target, 0, 0, TEX_SIZE, rows, view);
            onPositions(view);
        }
    }
}
