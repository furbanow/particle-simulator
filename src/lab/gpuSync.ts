import * as THREE from 'three';
import { GridPass, gridTarget } from '../gl/gridPass';
import { readTarget } from './readback';

const COPY_FRAGMENT = `
uniform sampler2D source;
void main() { gl_FragColor = texelFetch(source, ivec2(0), 0); }
`;

/**
 * A synchronization point for the timing loops and the long runs: copies one texel of a state
 * texture into a 1x1 target and reads it back. The texel depends on the whole chain of passes that
 * produced the texture, so when the read resolves the GPU has finished the frames submitted so
 * far (a plain read of an unrelated target would not wait for them).
 */
export class GpuSync {
    private readonly pass: GridPass;
    private readonly source: { value: THREE.Texture | null } = { value: null };

    constructor(private readonly renderer: THREE.WebGLRenderer) {
        this.pass = new GridPass(COPY_FRAGMENT, { source: this.source }, gridTarget(1, THREE.FloatType));
    }

    /** Resolves once the GPU has produced `texture` (the position texture of the simulation). */
    async wait(texture: THREE.Texture): Promise<void> {
        this.source.value = texture;
        this.pass.render(this.renderer);
        this.renderer.setRenderTarget(null);
        await readTarget(this.renderer, this.pass.target);
    }

    dispose(): void {
        this.pass.dispose();
    }
}
