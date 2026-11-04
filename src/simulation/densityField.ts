import * as THREE from 'three';
import { DENSITY_DOMAIN_SCALE, DENSITY_RES, MAX_SPECIES, MOMENTUM_SCALE } from '../config';
import { additiveBlending, clipSpaceCamera, createMipmappedHalfFloatTarget, type Uniform } from '../gl/common';
import { withDefines } from '../gl/withDefines';
import splatVert from '../shaders/splat.vert?raw';
import splatFrag from '../shaders/splat.frag?raw';

/**
 * Mipmapped density field: mass in R, scaled momentum in G/B. Particles are splatted with a
 * cloud-in-cell kernel into a square power-of-two grid twice the screen size, shifted randomly
 * every step so the coarse mip levels don't bias the pull toward fixed texel centers.
 */
export class DensityField {
    readonly target = createMipmappedHalfFloatTarget(DENSITY_RES, DENSITY_RES);

    /** Shared with the velocity shader. */
    readonly domainOffset: Uniform<THREE.Vector2> = { value: new THREE.Vector2() };
    readonly domainSize: Uniform<number> = { value: 1 };
    readonly densityRes: Uniform<number> = { value: DENSITY_RES };

    private readonly material: THREE.ShaderMaterial;
    private readonly scene = new THREE.Scene();

    constructor(private readonly renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry,
                splatMass: Uniform<number[]>) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                texturePosition: { value: null },
                textureVelocity: { value: null },
                domainOffset: this.domainOffset,
                domainSize: this.domainSize,
                densityRes: this.densityRes,
                speciesSplatMass: splatMass,
                momentumScale: { value: MOMENTUM_SCALE },
            },
            vertexShader: withDefines(splatVert, { MAX_SPECIES }),
            fragmentShader: splatFrag,
            ...additiveBlending,
        });
        const points = new THREE.Points(geometry, this.material);
        points.frustumCulled = false;
        this.scene.add(points);
    }

    resize(width: number, height: number): void {
        this.domainSize.value = DENSITY_DOMAIN_SCALE * Math.max(width, height);
    }

    shiftGrid(): void {
        const range = this.domainSize.value / 2;
        this.domainOffset.value.set(Math.random() * range, Math.random() * range);
    }

    render(positions: THREE.Texture, velocities: THREE.Texture): void {
        this.material.uniforms.texturePosition.value = positions;
        this.material.uniforms.textureVelocity.value = velocities;
        this.renderer.setRenderTarget(this.target);
        this.renderer.render(this.scene, clipSpaceCamera); // three regenerates the mipmaps after rendering
        this.renderer.setRenderTarget(null);
    }

    /** Frees the GPU resources (the geometry is shared, it stays). */
    dispose(): void {
        this.target.dispose();
        this.material.dispose();
    }
}
