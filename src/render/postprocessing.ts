import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clipSpaceCamera } from '../gl/common';
import { createFinishShader, createNebulaLensShader } from './passes';

/**
 * HDR half-float pipeline: RenderPass -> NebulaLens -> UnrealBloom -> Finish -> Output
 * (the OutputPass applies the renderer's tone mapping and sRGB encoding).
 */
export class PostProcessing {
    readonly bloom: UnrealBloomPass;
    private readonly composer: EffectComposer;
    private readonly nebulaLens: ShaderPass;
    private readonly finish: ShaderPass;

    constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, nebula: THREE.Texture,
                width: number, height: number) {
        this.composer = new EffectComposer(renderer);
        this.composer.addPass(new RenderPass(scene, clipSpaceCamera));
        this.nebulaLens = new ShaderPass(createNebulaLensShader());
        this.nebulaLens.uniforms.tNebula.value = nebula;
        this.composer.addPass(this.nebulaLens);
        this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 1, 0.6, 0.2);
        this.composer.addPass(this.bloom);
        this.finish = new ShaderPass(createFinishShader());
        this.composer.addPass(this.finish);
        this.composer.addPass(new OutputPass());
    }

    set nebulaIntensity(v: number) { this.nebulaLens.uniforms.nebulaIntensity.value = v; }
    set lensStrength(v: number) { this.nebulaLens.uniforms.lensStrength.value = v; }

    resize(width: number, height: number, nebulaSize: THREE.Vector2): void {
        const aspect = width / Math.max(height, 1);
        this.nebulaLens.uniforms.nebulaTexel.value.set(1 / nebulaSize.x, 1 / nebulaSize.y);
        this.nebulaLens.uniforms.aspect.value = aspect;
        this.finish.uniforms.aspect.value = aspect;
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(width, height);
    }

    render(timeSeconds: number): void {
        this.nebulaLens.uniforms.time.value = timeSeconds;
        this.finish.uniforms.time.value = timeSeconds;
        this.composer.render();
    }
}
