import * as THREE from 'three';

/**
 * The WebGL 2 renderer of the simulation, or null when the browser has no WebGL 2 context or no
 * float render targets (EXT_color_buffer_float): the GPGPU state lives in float textures. Shared
 * by the application and by the dev-only lab page (src/lab); the caller decides what to do when
 * there is none (the application shows its apology, src/ui/unsupported.ts).
 */
export function createRenderer(): THREE.WebGLRenderer | null {
    try {
        const created = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        if (created.extensions.has('EXT_color_buffer_float')) return created;
        created.dispose();
    } catch { /* no WebGL 2 context */ }
    return null;
}
