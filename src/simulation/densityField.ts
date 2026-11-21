import * as THREE from 'three';
import { DENSITY_DOMAIN_SCALE, DENSITY_RES, ENERGY_SCALE, MAX_SPECIES, MOMENTUM_SCALE, REFERENCE_LEVEL } from '../config';
import { additiveBlending, clearTarget, clipSpaceCamera, createMipmappedHalfFloatTarget, type Uniform } from '../gl/common';
import { filteredGridTarget, GridPass } from '../gl/gridPass';
import { withDefines } from '../gl/withDefines';
import referenceGlsl from '../shaders/density-reference.glsl?raw';
import referenceFrag from '../shaders/density-reference.frag?raw';
import splatVert from '../shaders/splat.vert?raw';
import splatFrag from '../shaders/splat.frag?raw';

/** Texels a side of the reference velocity's grid. */
export const REFERENCE_RES = DENSITY_RES >> REFERENCE_LEVEL;

/**
 * Mipmapped density field: mass in R, scaled momentum in G/B, agitation energy in A (m |v - v_ref|^2 x
 * ENERGY_SCALE about a reference velocity, see density-reference.glsl). Particles are splatted with a
 * cloud-in-cell kernel into a square power-of-two grid twice the screen size, shifted randomly
 * every step so the coarse mip levels don't bias the pull toward fixed texel centers.
 */
export class DensityField {
    readonly target = createMipmappedHalfFloatTarget(DENSITY_RES, DENSITY_RES);

    /** Shared with the velocity shader. */
    readonly domainOffset: Uniform<THREE.Vector2> = { value: new THREE.Vector2() };
    readonly domainSize: Uniform<number> = { value: 1 };
    readonly densityRes: Uniform<number> = { value: DENSITY_RES };
    /**
     * The reference velocity of the deposit, made from the previous substep's deposit and the domain offset
     * that deposit was made with: shared with the velocity shader, which reads it the way the splat did.
     */
    readonly referenceTexture: Uniform<THREE.Texture>;
    readonly referenceOffset: Uniform<THREE.Vector2> = { value: new THREE.Vector2() };
    /** Dev-only (the lab's comparison): false deposits the energy about a zero reference, as a plain E = m |v|^2. */
    referenceEnabled = true;

    private readonly material: THREE.ShaderMaterial;
    private readonly scene = new THREE.Scene();
    private readonly reference: GridPass;
    /** Domain offset of the deposit the target holds. */
    private readonly depositOffset = new THREE.Vector2();

    constructor(private readonly renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry,
                splatMass: Uniform<number[]>) {
        this.reference = new GridPass(referenceFrag, {
            textureDensity: { value: this.target.texture }, level: { value: REFERENCE_LEVEL },
        }, filteredGridTarget(REFERENCE_RES, THREE.RGBAFormat));
        this.referenceTexture = { value: this.reference.target.texture };
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                texturePosition: { value: null },
                textureVelocity: { value: null },
                textureReference: this.referenceTexture,
                referenceOffset: this.referenceOffset,
                domainOffset: this.domainOffset,
                domainSize: this.domainSize,
                densityRes: this.densityRes,
                speciesSplatMass: splatMass,
                momentumScale: { value: MOMENTUM_SCALE },
                energyScale: { value: ENERGY_SCALE },
            },
            vertexShader: withDefines(`${referenceGlsl}\n${splatVert}`, { MAX_SPECIES }),
            fragmentShader: splatFrag,
            ...additiveBlending,
        });
        const points = new THREE.Points(geometry, this.material);
        points.frustumCulled = false;
        this.scene.add(points);
        clearTarget(renderer, this.target);
        clearTarget(renderer, this.reference.target);
    }

    /** Dev-only, read-only: the render target of the reference velocity, for the lab page (src/lab). Not used by the app. */
    get debugReferenceTarget(): THREE.WebGLRenderTarget {
        return this.reference.target;
    }

    resize(width: number, height: number): void {
        this.domainSize.value = DENSITY_DOMAIN_SCALE * Math.max(width, height);
    }

    shiftGrid(): void {
        const range = this.domainSize.value / 2;
        this.domainOffset.value.set(Math.random() * range, Math.random() * range);
    }

    /**
     * Deposits the particles. The reference velocity is first made from the deposit the target still holds (the
     * previous substep's, with its own domain offset), so the velocity pass, which runs right after, reads the
     * same reference as the splat did.
     */
    render(positions: THREE.Texture, velocities: THREE.Texture): void {
        this.updateReference();
        this.material.uniforms.texturePosition.value = positions;
        this.material.uniforms.textureVelocity.value = velocities;
        this.renderer.setRenderTarget(this.target);
        // The alpha channel holds a sum: it starts from 0, whatever the renderer clears to.
        const clearAlpha = this.renderer.getClearAlpha();
        this.renderer.setClearAlpha(0);
        this.renderer.render(this.scene, clipSpaceCamera); // three regenerates the mipmaps after rendering
        this.renderer.setClearAlpha(clearAlpha);
        this.renderer.setRenderTarget(null);
        this.depositOffset.copy(this.domainOffset.value);
    }

    private updateReference(): void {
        this.referenceOffset.value.copy(this.depositOffset);
        if (this.referenceEnabled) {
            this.reference.render(this.renderer);
        } else {
            this.renderer.setRenderTarget(this.reference.target);
            const clearAlpha = this.renderer.getClearAlpha();
            this.renderer.setClearAlpha(0);
            this.renderer.clear();
            this.renderer.setClearAlpha(clearAlpha);
        }
        this.renderer.setRenderTarget(null);
    }

    /** Frees the GPU resources (the geometry is shared, it stays). */
    dispose(): void {
        this.target.dispose();
        this.reference.dispose();
        this.material.dispose();
    }
}
