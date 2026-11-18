import * as THREE from 'three';

/** Every shader writes clip-space positions directly: the camera is never used for projection. */
export const clipSpaceCamera = new THREE.Camera();

/** The visual zoom, shared by reference by every material that projects world positions. */
export interface ViewUniforms {
    zoom: Uniform<number>;
    center: Uniform<THREE.Vector2>;
}

/** Pure additive blending (ONE, ONE), no depth: used by every particle splat. */
export const additiveBlending = {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
} as const;

/** Half float: filterable (needed for mipmaps) and blendable in core WebGL2. */
export function createMipmappedHalfFloatTarget(width: number, height: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
        depthBuffer: false,
    });
}

/**
 * Writes level 0 of a freshly (re)allocated target. three.js calls generateMipmap while setting
 * the target up, before anything is drawn: on a texture never written, WebGL warns about lazy
 * initialization. Mipmaps are therefore disabled for this first bind and restored afterwards.
 */
export function clearTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const texture = target.texture;
    const generateMipmaps = texture.generateMipmaps;
    texture.generateMipmaps = false;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.setRenderTarget(previous);
    texture.generateMipmaps = generateMipmaps;
}

export function hexToVector(hex: string): THREE.Vector3 {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
}

/** A uniform whose object is shared by several materials, so one write updates them all. */
export type Uniform<T> = { value: T };
