import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import nebulaLensFrag from '../shaders/nebula-lens.frag?raw';
import finishFrag from '../shaders/finish.frag?raw';

/** Gravitational lens + hue-preserving peak compression + colored nebula gas. */
export const createNebulaLensShader = () => ({
    uniforms: {
        tDiffuse: { value: null },
        tNebula: { value: null as THREE.Texture | null },
        nebulaTexel: { value: new THREE.Vector2(1, 1) },
        aspect: { value: 1 },
        time: { value: 0 },
        nebulaIntensity: { value: 1 },
        lensStrength: { value: 1 },
    },
    vertexShader: fullscreenVert,
    fragmentShader: nebulaLensFrag,
});

/** Vignette and film grain, in linear HDR before tone mapping. */
export const createFinishShader = () => ({
    uniforms: {
        tDiffuse: { value: null },
        aspect: { value: 1 },
        time: { value: 0 },
    },
    vertexShader: fullscreenVert,
    fragmentShader: finishFrag,
});
