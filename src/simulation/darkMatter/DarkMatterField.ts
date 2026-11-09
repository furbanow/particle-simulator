import * as THREE from 'three';
import {
    DARK_MATTER_COARSE_FACTOR, DARK_MATTER_GRAVITY_UNIT, DARK_MATTER_GRID_RES, DARK_MATTER_NEAR_RADIUS,
    DARK_MATTER_SOFTENING_SLIDER, DARK_MATTER_STRENGTH_SLIDER,
} from '../../config';
import type { Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { withDefines } from '../../gl/withDefines';
import { maskMassGrid } from './massGrid';
import darkMatterGlslSource from '../../shaders/dark-matter.glsl?raw';
import coarseFrag from '../../shaders/grid-coarse.frag?raw';
import gravityFrag from '../../shaders/grid-gravity.frag?raw';

const RES = DARK_MATTER_GRID_RES;
const COARSE_RES = RES / DARK_MATTER_COARSE_FACTOR;

/** dark-matter.glsl: velocity shaders prepend it (with DARK_MATTER_DEFINES) and call darkMatterAccel(pos). */
export const darkMatterGlsl = darkMatterGlslSource;
export const DARK_MATTER_DEFINES = { DARK_MATTER_RES: RES } as const;

/** The uniforms of dark-matter.glsl, shared by reference by every material that includes it. */
export interface DarkMatterUniforms {
    darkMatterForce: Uniform<THREE.Texture | null>;
    darkMatterCell: Uniform<number>;
    darkMatterGain: Uniform<number>;
}

/**
 * Static dark matter, drawn as an opacity mask: it neither moves nor feels anything, but pulls the
 * matter with a softened gravity. The mask's mass is summed on a grid (massGrid.ts) and its field
 * computed on the GPU, on two levels, only when the mask or the softening change (prepare()). The
 * velocity shaders read it through dark-matter.glsl, scaled by the strength. It outlives the
 * pipelines: the same dark matter stays across restarts and algorithm changes.
 */
export class DarkMatterField {
    readonly uniforms: DarkMatterUniforms;
    private readonly massData = new Float32Array(RES * RES * 4);
    private readonly massTexture = new THREE.DataTexture(this.massData, RES, RES, THREE.RGBAFormat, THREE.FloatType);
    private readonly coarse: GridPass;
    private readonly gravity: GridPass;
    private readonly gravityUniforms = {
        gridCell: { value: 1 },
        softening2: { value: 1 },
        gravityPerDeposit: { value: 1 },
    };
    private strength = DARK_MATTER_STRENGTH_SLIDER.default;
    private softening = DARK_MATTER_SOFTENING_SLIDER.default;       // % of L
    private length = 1;                                              // L = min(width, height), px
    private totalMass = 0;
    private dirty = false;

    constructor(private readonly renderer: THREE.WebGLRenderer) {
        this.massTexture.needsUpdate = true;
        this.coarse = new GridPass(withDefines(coarseFrag, { COARSE_FACTOR: DARK_MATTER_COARSE_FACTOR }), {
            gridMoments: { value: this.massTexture }, gridCell: this.gravityUniforms.gridCell,
        }, gridTarget(COARSE_RES, THREE.FloatType));
        this.gravity = new GridPass(withDefines(gravityFrag, {
            GRID_RES: RES, COARSE_RES, COARSE_FACTOR: DARK_MATTER_COARSE_FACTOR, NEAR_RADIUS: DARK_MATTER_NEAR_RADIUS,
        }), {
            gridMoments: { value: this.massTexture },
            gridCoarse: { value: this.coarse.target.texture },
            ...this.gravityUniforms,
        }, gridTarget(RES, THREE.FloatType));
        this.uniforms = {
            darkMatterForce: { value: this.gravity.target.texture },
            darkMatterCell: this.gravityUniforms.gridCell,
            darkMatterGain: { value: 0 },
        };
    }

    /** Whether the dark matter pulls anything (some mass, a strength above 0). */
    get active(): boolean {
        return this.uniforms.darkMatterGain.value !== 0;
    }

    /** New mask: RGBA bytes of a `width` x `height` canvas (the simulation area), alpha = density. */
    setMask(rgba: ArrayLike<number>, width: number, height: number): void {
        const cell = Math.max(width, height, 1) / RES;
        this.totalMass = maskMassGrid(rgba, width, height, RES, cell, this.massData).total;
        this.massTexture.needsUpdate = true;
        this.gravityUniforms.gridCell.value = cell;
        this.length = Math.max(1, Math.min(width, height));
        this.dirty = true;
        this.updateGain();
    }

    /** Multiplies the pull (0: none); applies at once. */
    setStrength(strength: number): void {
        this.strength = strength;
        this.updateGain();
    }

    /** Softening length in % of min(width, height): smooths the pull near and inside the mask. */
    setSoftening(percent: number): void {
        this.softening = percent;
        this.dirty = true;
    }

    /** Recomputes the field if the mask or the softening changed. Called before the simulation steps. */
    prepare(): void {
        if (!this.dirty) return;
        this.dirty = false;
        const eps = this.softening / 100 * this.length;
        this.gravityUniforms.softening2.value = eps * eps;
        this.coarse.render(this.renderer);
        this.gravity.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    dispose(): void {
        this.massTexture.dispose();
        this.coarse.dispose();
        this.gravity.dispose();
    }

    private updateGain(): void {
        this.uniforms.darkMatterGain.value = this.totalMass > 0
            ? this.strength * DARK_MATTER_GRAVITY_UNIT * this.length
            : 0;
    }
}
