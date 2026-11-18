import * as THREE from 'three';
import { MAX_SPECIES, NEBULA_DOWNSCALE } from '../config';
import { additiveBlending, clearTarget, clipSpaceCamera, createMipmappedHalfFloatTarget, type Uniform, type ViewUniforms } from '../gl/common';
import { withDefines } from '../gl/withDefines';
import type { SpeciesUniforms } from '../simulation/Simulation';
import nebulaVert from '../shaders/nebula.vert?raw';
import nebulaFrag from '../shaders/nebula.frag?raw';

/**
 * Low-resolution (color x mass, mass) splat of the particles, mipmapped: the post-processing
 * reads it for the colored gas and the gravitational lens.
 */
export class NebulaLayer {
    readonly target = createMipmappedHalfFloatTarget(1, 1);
    private readonly scene = new THREE.Scene();

    constructor(private readonly renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry,
                species: SpeciesUniforms, screenSize: Uniform<THREE.Vector2>,
                texturePosition: Uniform<THREE.Texture | null>, view: ViewUniforms) {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                texturePosition,
                screenSize,
                viewZoom: view.zoom,
                viewCenter: view.center,
                speciesSplatMass: species.splatMass,
                speciesColor: species.color,
            },
            vertexShader: withDefines(nebulaVert, { MAX_SPECIES }),
            fragmentShader: nebulaFrag,
            ...additiveBlending,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        this.scene.add(points);
    }

    /** Resizes the target to the canvas CSS size / NEBULA_DOWNSCALE; returns its size. */
    resize(width: number, height: number): THREE.Vector2 {
        const nw = Math.max(1, Math.ceil(width / NEBULA_DOWNSCALE));
        const nh = Math.max(1, Math.ceil(height / NEBULA_DOWNSCALE));
        this.target.setSize(nw, nh);
        clearTarget(this.renderer, this.target);
        return new THREE.Vector2(nw, nh);
    }

    render(): void {
        this.renderer.setRenderTarget(this.target);
        this.renderer.setClearAlpha(0);             // alpha holds mass: must start at 0
        this.renderer.render(this.scene, clipSpaceCamera); // three regenerates the mipmaps after rendering
        this.renderer.setClearAlpha(1);
        this.renderer.setRenderTarget(null);
    }
}
