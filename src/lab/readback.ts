import * as THREE from 'three';
import { TEX_SIZE } from '../config';
import { GridPass, gridTarget } from '../gl/gridPass';

/**
 * Reads a whole render target back as RGBA floats, row by row from the bottom (the order of
 * gl_FragCoord), whatever its type (float or half float; the half floats are decoded).
 *
 * Limits to keep in mind:
 *  - only the first color attachment of a target can be read (readRenderTargetPixels has no
 *    attachment index): readAttachment() reads the others through a copy pass;
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

/**
 * Reads the first `count` particles of the position render target (x, y, type, w per texel, in
 * particle order: the rows of the texture from the bottom), as a float array of whole rows.
 */
export async function readPositions(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, count: number): Promise<Float32Array> {
    const rows = Math.max(1, Math.ceil(count / TEX_SIZE));
    const out = new Float32Array(rows * TEX_SIZE * 4);
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, TEX_SIZE, rows, out);
    return out;
}

const COPY_ATTACHMENT = `
uniform sampler2D source;
void main() { gl_FragColor = texelFetch(source, ivec2(gl_FragCoord.xy), 0); }
`;

/**
 * Reads attachment `index` of a multi-attachment target, as readTarget() does: the attachment is
 * copied by a pass into a single-attachment target of the same size and type (float or half float).
 */
export async function readAttachment(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, index: number): Promise<Float32Array> {
    if (index === 0) return readTarget(renderer, target);
    const texture = target.textures[index];
    if (!texture) throw new Error(`readAttachment: the target has ${target.textures.length} attachments, not ${index + 1}`);
    const pass = new GridPass(COPY_ATTACHMENT, { source: { value: texture } }, gridTarget(target.width, texture.type));
    try {
        pass.render(renderer);
        renderer.setRenderTarget(null);
        return await readTarget(renderer, pass.target);
    } finally {
        pass.dispose();
    }
}
