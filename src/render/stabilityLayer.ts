import * as THREE from 'three';
import {
    PROTOSTAR_STABILITY_BETA_CRITICAL, PROTOSTAR_STABILITY_LOG_RANGE, PROTOSTAR_STABILITY_MIN_DENSITY, PROTOSTAR_STABILITY_OPACITY,
    PROTOSTAR_STABILITY_PARTIAL, PROTOSTAR_STABILITY_Q_CRITICAL,
} from '../config';
import { clipSpaceCamera, type Uniform, type ViewUniforms } from '../gl/common';
import { glslFloat, withDefines } from '../gl/withDefines';
import type { GridOverlay } from '../simulation/gpuModel';
import { STABILITY_MAP_MODES } from '../simulation/protostar/stability';
import overlayVert from '../shaders/stability-overlay.vert?raw';
import overlayFrag from '../shaders/stability-overlay.frag?raw';

const modeIndex = (mode: GridOverlay['mode']): number => STABILITY_MAP_MODES.indexOf(mode);

/**
 * The protostar's stability map (A12) drawn over the finished image (after the post-processing: neither bloomed nor tone mapped), with the
 * visual zoom. Translucent tints over the gas, nothing elsewhere.
 */
export class StabilityLayer {
    private readonly scene = new THREE.Scene();
    private readonly u = {
        map: { value: null as THREE.Texture | null },
        mode: { value: 0 },
        extent: { value: 1 },
    };

    constructor(screenSize: Uniform<THREE.Vector2>, view: ViewUniforms) {
        const material = new THREE.ShaderMaterial({
            uniforms: { ...this.u, screenSize, viewZoom: view.zoom, viewCenter: view.center },
            vertexShader: overlayVert,
            fragmentShader: withDefines(overlayFrag, {
                MODE_FRAGMENTATION: glslFloat(modeIndex('fragmentation')), MODE_TOOMRE: glslFloat(modeIndex('toomre')),
                Q_CRITICAL: glslFloat(PROTOSTAR_STABILITY_Q_CRITICAL), BETA_CRITICAL: glslFloat(PROTOSTAR_STABILITY_BETA_CRITICAL),
                MIN_DENSITY: glslFloat(PROTOSTAR_STABILITY_MIN_DENSITY), LOG_RANGE: glslFloat(PROTOSTAR_STABILITY_LOG_RANGE),
                OPACITY: glslFloat(PROTOSTAR_STABILITY_OPACITY), PARTIAL: glslFloat(PROTOSTAR_STABILITY_PARTIAL),
            }),
            blending: THREE.NormalBlending, transparent: true, depthTest: false, depthWrite: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        quad.frustumCulled = false;
        this.scene.add(quad);
    }

    /** Draws `overlay` onto the canvas as it is; nothing when null. */
    render(renderer: THREE.WebGLRenderer, overlay: GridOverlay | null): void {
        if (!overlay) return;
        this.u.map.value = overlay.texture;
        this.u.mode.value = modeIndex(overlay.mode);
        this.u.extent.value = overlay.extent;
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(null);
        renderer.render(this.scene, clipSpaceCamera);
        renderer.autoClear = autoClear;
    }
}
