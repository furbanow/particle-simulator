import * as THREE from 'three';
import { clipSpaceCamera } from './common';
import gridVert from '../shaders/grid.vert?raw';

/** An RGBA grid of `size` x `height` cells (square by default), read texel by texel (no filtering, no mipmaps). */
export function gridTarget(size: number, type: THREE.TextureDataType, count = 1, height = size): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(size, height, {
        count, type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        generateMipmaps: false, depthBuffer: false,
    });
}

/** A full-grid fragment pass into a render target. */
export class GridPass {
    readonly material: THREE.ShaderMaterial;
    private readonly scene = new THREE.Scene();

    constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, readonly target: THREE.WebGLRenderTarget) {
        this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: gridVert, fragmentShader, depthTest: false, depthWrite: false });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        quad.frustumCulled = false;
        this.scene.add(quad);
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, clipSpaceCamera);
    }

    dispose(): void {
        this.target.dispose();
        this.material.dispose();
        (this.scene.children[0] as THREE.Mesh).geometry.dispose();
    }
}

/**
 * A square grid of `size` x `size` cells of half floats (two, R and G, unless `format` is RGBAFormat), read with
 * bilinear filtering (half floats are filterable and renderable everywhere WebGL 2 runs the simulation; float32 ones are not).
 */
export function filteredGridTarget(size: number, format: THREE.PixelFormat = THREE.RGFormat): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType, format, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        generateMipmaps: false, depthBuffer: false,
    });
}
