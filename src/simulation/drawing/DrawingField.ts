import * as THREE from 'three';
import {
    DRAWING_COARSE_FACTOR, DRAWING_GRAVITY_UNIT, DRAWING_GRID_RES, DRAWING_NEAR_RADIUS,
    DRAWING_SOFTENING_SLIDER, DRAWING_STRENGTH_SLIDER,
} from '../../config';
import type { DrawingKind } from '../../drawing';
import type { Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { withDefines } from '../../gl/withDefines';
import { maskMassGrid } from './massGrid';
import drawingGlslSource from '../../shaders/drawing.glsl?raw';
import coarseFrag from '../../shaders/grid-coarse.frag?raw';
import gravityFrag from '../../shaders/grid-gravity.frag?raw';

const RES = DRAWING_GRID_RES;
const COARSE_RES = RES / DRAWING_COARSE_FACTOR;

/** drawing.glsl: velocity shaders prepend it (with DRAWING_DEFINES) and call drawingAccel(pos). */
export const drawingGlsl = drawingGlslSource;
export const DRAWING_DEFINES = { DRAWING_RES: RES } as const;

/** The uniforms of drawing.glsl, shared by reference by every material that includes it. */
export interface DrawingUniforms {
    drawingForceAttractor: Uniform<THREE.Texture | null>;
    drawingForceRepeller: Uniform<THREE.Texture | null>;
    drawingGainAttractor: Uniform<number>;
    drawingGainRepeller: Uniform<number>;
    drawingCell: Uniform<number>;
}

/** The gravity of one kind of drawing: its mass grid, its two-level field and its settings. */
class KindField {
    private readonly massData = new Float32Array(RES * RES * 4);
    private readonly massTexture = new THREE.DataTexture(this.massData, RES, RES, THREE.RGBAFormat, THREE.FloatType);
    private readonly coarse: GridPass;
    private readonly gravity: GridPass;
    private readonly softening2 = { value: 1 };
    private readonly gravityPerDeposit = { value: 1 };
    strength: number = DRAWING_STRENGTH_SLIDER.default;
    softening: number = DRAWING_SOFTENING_SLIDER.default;       // % of L
    totalMass = 0;
    dirty = false;

    constructor(private readonly renderer: THREE.WebGLRenderer, gridCell: Uniform<number>) {
        this.massTexture.needsUpdate = true;
        this.coarse = new GridPass(withDefines(coarseFrag, { COARSE_FACTOR: DRAWING_COARSE_FACTOR }), {
            gridMoments: { value: this.massTexture }, gridCell,
        }, gridTarget(COARSE_RES, THREE.FloatType));
        this.gravity = new GridPass(withDefines(gravityFrag, {
            GRID_RES: RES, COARSE_RES, COARSE_FACTOR: DRAWING_COARSE_FACTOR, NEAR_RADIUS: DRAWING_NEAR_RADIUS,
        }), {
            gridMoments: { value: this.massTexture },
            gridCoarse: { value: this.coarse.target.texture },
            gridCell,
            softening2: this.softening2,
            gravityPerDeposit: this.gravityPerDeposit,
        }, gridTarget(RES, THREE.FloatType));
    }

    get force(): THREE.Texture {
        return this.gravity.target.texture;
    }

    setMass(rgba: ArrayLike<number>, width: number, height: number, cell: number): void {
        this.totalMass = maskMassGrid(rgba, width, height, RES, cell, this.massData).total;
        this.massTexture.needsUpdate = true;
        this.dirty = true;
    }

    /** Recomputes the field if the mask, the softening or the length scale changed. */
    prepare(length: number): void {
        if (!this.dirty) return;
        this.dirty = false;
        const eps = this.softening / 100 * length;
        this.softening2.value = eps * eps;
        this.coarse.render(this.renderer);
        this.gravity.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    dispose(): void {
        this.massTexture.dispose();
        this.coarse.dispose();
        this.gravity.dispose();
    }
}

/**
 * The static drawings: attractors and repellers, each drawn as an opacity mask. They neither move
 * nor feel anything, but pull the matter (attractor) or push it away (repeller) with a softened
 * gravity. The mask's mass is summed on a grid (massGrid.ts) and its field computed on the GPU, on
 * two levels, only when the mask or the softening change (prepare()). The velocity shaders read
 * both fields through drawing.glsl, scaled by each kind's strength. It outlives the pipelines: the
 * same drawings stay across restarts and algorithm changes.
 */
export class DrawingField {
    readonly uniforms: DrawingUniforms;
    private readonly cell: Uniform<number> = { value: 1 };
    private readonly kinds: Record<DrawingKind, KindField>;
    private length = 1;                                              // L = min(width, height), px

    constructor(renderer: THREE.WebGLRenderer) {
        this.kinds = { attractor: new KindField(renderer, this.cell), repeller: new KindField(renderer, this.cell) };
        this.uniforms = {
            drawingForceAttractor: { value: this.kinds.attractor.force },
            drawingForceRepeller: { value: this.kinds.repeller.force },
            drawingGainAttractor: { value: 0 },
            drawingGainRepeller: { value: 0 },
            drawingCell: this.cell,
        };
    }

    /** Whether a drawing acts on anything (some mass, a strength above 0). */
    get active(): boolean {
        return this.uniforms.drawingGainAttractor.value !== 0 || this.uniforms.drawingGainRepeller.value !== 0;
    }

    /** New mask of `kind`: RGBA bytes of a `width` x `height` canvas (the simulation area), alpha = density. */
    setMask(kind: DrawingKind, rgba: ArrayLike<number>, width: number, height: number): void {
        const cell = Math.max(width, height, 1) / RES;
        const length = Math.max(1, Math.min(width, height));
        if (cell !== this.cell.value || length !== this.length) {
            // The area changed: the other kind's grid is still in the old scale, its field is recomputed.
            this.cell.value = cell;
            this.length = length;
            for (const k of Object.values(this.kinds)) k.dirty = true;
        }
        this.kinds[kind].setMass(rgba, width, height, cell);
        this.updateGains();
    }

    /** Multiplies the force of `kind` (0: none); applies at once. */
    setStrength(kind: DrawingKind, strength: number): void {
        this.kinds[kind].strength = strength;
        this.updateGains();
    }

    /** Softening length of `kind` in % of min(width, height): smooths the force near and inside the mask. */
    setSoftening(kind: DrawingKind, percent: number): void {
        this.kinds[kind].softening = percent;
        this.kinds[kind].dirty = true;
    }

    /** Recomputes the fields that changed. Called before the simulation steps. */
    prepare(): void {
        for (const k of Object.values(this.kinds)) k.prepare(this.length);
    }

    dispose(): void {
        for (const k of Object.values(this.kinds)) k.dispose();
    }

    private updateGains(): void {
        const gain = (k: KindField): number => k.totalMass > 0 ? k.strength * DRAWING_GRAVITY_UNIT * this.length : 0;
        this.uniforms.drawingGainAttractor.value = gain(this.kinds.attractor);
        this.uniforms.drawingGainRepeller.value = -gain(this.kinds.repeller);   // pushes: the opposite direction
    }
}
