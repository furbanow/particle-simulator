import * as THREE from 'three';
import { PROTOSTAR_GRID_RES, PROTOSTAR_STABILITY_CAP } from '../../config';
import type { Uniform } from '../../gl/common';
import { GridPass, gridTarget } from '../../gl/gridPass';
import { glslFloat, withDefines } from '../../gl/withDefines';
import stabilityFrag from '../../shaders/protostar-stability.frag?raw';
import { STELLAR_TOOMRE } from './toomre';

/** The uniforms of the cooling the map shares by reference with the velocity pass (the sliders). */
export interface StabilityCoolingUniforms {
    radiation: Uniform<number>;
    opacityKappa: Uniform<number>;
    minTemperature: Uniform<number>;
    coolingLaw: Uniform<number>;
    damping: Uniform<number>;
    dampingOpacity: Uniform<number>;
}

/** The grids the map reads, shared by reference with the protostar's other passes (the gas pass swaps its targets every substep). */
export interface StabilityGridUniforms {
    gridGas: Uniform<THREE.Texture | null>;
    gridThermo: Uniform<THREE.Texture | null>;
    gridCell: Uniform<number>;
    fusionTRef: Uniform<number>;
}

/**
 * The stability map of the gas grid (A12): one GRID_RES x GRID_RES pass writing (Q, beta, rho / rho0, kappa^2) per cell
 * (protostar-stability.frag; the derivation and the twin are in stability.ts). Drawn on demand, when the map is shown.
 */
export class StabilityPass {
    private readonly pass: GridPass;
    private readonly u = {
        centerOfMass: { value: new THREE.Vector2() },
        gravityDensity: { value: 0 },
        toomreFactor: { value: 1 },
    };

    constructor(grids: StabilityGridUniforms, cooling: StabilityCoolingUniforms) {
        this.pass = new GridPass(withDefines(stabilityFrag, {
            GRID_RES: PROTOSTAR_GRID_RES, STELLAR_TOOMRE: glslFloat(STELLAR_TOOMRE), STABILITY_CAP: glslFloat(PROTOSTAR_STABILITY_CAP),
        }), { ...grids, ...cooling, ...this.u }, gridTarget(PROTOSTAR_GRID_RES, THREE.FloatType));
    }

    get target(): THREE.WebGLRenderTarget {
        return this.pass.target;
    }

    /** Draws the map about `center` (px) for G_eff rho0 = `gravityDensity` (px/s^2), Q times `toomreFactor` (the thickness's, A11). */
    render(renderer: THREE.WebGLRenderer, center: { x: number; y: number }, gravityDensity: number, toomreFactor = 1): void {
        this.u.centerOfMass.value.set(center.x, center.y);
        this.u.gravityDensity.value = gravityDensity;
        this.u.toomreFactor.value = toomreFactor;
        this.pass.render(renderer);
        renderer.setRenderTarget(null);
    }

    dispose(): void {
        this.pass.dispose();
    }
}
