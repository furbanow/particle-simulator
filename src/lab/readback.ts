import * as THREE from 'three';

/**
 * Reads a whole render target back as RGBA floats, row by row from the bottom (the order of
 * gl_FragCoord), whatever its type (float or half float; the half floats are decoded).
 *
 * Limits to keep in mind:
 *  - only the first color attachment of a target can be read (readRenderTargetPixels has no
 *    attachment index): a multi-attachment pass needs a copy pass into a single-attachment target;
 *  - the grids of the protostar are overwritten at every substep, so a scenario steps the
 *    simulation and reads right after, before stepping again;
 *  - the read-back waits for the GPU, which makes it a synchronization point (the timing probes
 *    take care not to read inside their timed loops).
 */
export async function readTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): Promise<Float32Array> {
    const { width, height } = target;
    const type = target.texture.type;
    if (type === THREE.FloatType) {
        const out = new Float32Array(width * height * 4);
        await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, out);
        return out;
    }
    if (type === THREE.HalfFloatType) {
        const raw = new Uint16Array(width * height * 4);
        await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, raw);
        return Float32Array.from(raw, THREE.DataUtils.fromHalfFloat);
    }
    throw new Error(`readTarget: unsupported texture type ${type}`);
}

/** The same read-back, synchronous (for comparing the two paths). */
export function readTargetSync(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): Float32Array {
    const { width, height } = target;
    if (target.texture.type !== THREE.FloatType) throw new Error('readTargetSync: float targets only');
    const out = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, out);
    return out;
}
