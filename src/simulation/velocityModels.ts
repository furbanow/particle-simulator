import type * as THREE from 'three';
import { GLOBAL_DRAG, K_PRESSURE, MAX_SPECIES, REST_DENSITY, VISCOSITY_RATE } from '../config';
import { withDefines } from '../gl/withDefines';
import type { AlgorithmId } from './algorithms';
import stickyDustFrag from '../shaders/velocity-sticky-dust.frag?raw';

/**
 * GPU side of an algorithm: the velocity-pass shader and the uniforms only it reads. The common
 * uniforms (time step, gravity field, supernova, shock wave, species, walls) belong to Simulation.
 * Every model's uniforms are merged into the one shared velocity uniform object, so their names
 * must not clash between models.
 */
export interface VelocityModel {
    /** Fragment shader, defines already injected. */
    shader: string;
    uniforms: Record<string, THREE.IUniform>;
}

export function createVelocityModels(): Record<AlgorithmId, VelocityModel> {
    return {
        stickyDust: {
            shader: withDefines(stickyDustFrag, { MAX_SPECIES }),
            uniforms: {
                kPressure: { value: K_PRESSURE },
                restDensity: { value: REST_DENSITY },
                viscosityRate: { value: VISCOSITY_RATE },
                globalDrag: { value: GLOBAL_DRAG },
            },
        },
    };
}
