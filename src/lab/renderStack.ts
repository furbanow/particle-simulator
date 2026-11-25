import * as THREE from 'three';
import { BASE_DT } from '../config';
import type { ViewUniforms } from '../gl/common';
import { NebulaLayer } from '../render/nebulaLayer';
import { ParticleLayer } from '../render/particleLayer';
import { PostProcessing } from '../render/postprocessing';
import type { Simulation } from '../simulation/Simulation';

/**
 * The application's rendering layers around a Simulation (particles, nebula, post-processing), at
 * zoom 1, so that the performance probe can time a whole frame as the application's own GPU
 * benchmark does. Wired as in src/main.ts.
 */
export class RenderStack {
    private readonly particles: ParticleLayer;
    private readonly nebula: NebulaLayer;
    private readonly post: PostProcessing;

    constructor(renderer: THREE.WebGLRenderer, private readonly simulation: Simulation, width: number, height: number) {
        const view: ViewUniforms = { zoom: { value: 1 }, center: { value: new THREE.Vector2(width / 2, height / 2) } };
        this.particles = new ParticleLayer(simulation.geometry, simulation.speciesUniforms, simulation.screenSize,
            simulation.glowFromState, renderer.getPixelRatio(), view);
        this.nebula = new NebulaLayer(renderer, simulation.geometry, simulation.speciesUniforms, simulation.screenSize,
            this.particles.texturePosition, view);
        this.post = new PostProcessing(renderer, this.particles.scene, this.nebula.target.texture, width, height);
        this.post.resize(width, height, this.nebula.resize(width, height));
    }

    /** After a restart: the particle layer's brightness follows the count. */
    prepare(): void {
        this.particles.setParticleCount(this.simulation.activeCount);
    }

    /** One full frame, like main.ts's renderFrame. */
    frame(): void {
        const { simulation } = this;
        simulation.step();
        this.particles.update(simulation.positionTexture, simulation.velocityTexture, simulation.paused ? 0 : BASE_DT * simulation.timeScale);
        this.nebula.render();
        this.post.render(0);
        simulation.endFrame();
    }
}
