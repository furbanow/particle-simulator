import * as THREE from 'three';
import { BASE_DT, HEAT_SPEED_RANGE, MAX_SPECIES, MAX_STRETCH, PARTICLE_GAIN } from '../config';
import { additiveBlending, type Uniform, type ViewUniforms } from '../gl/common';
import { glslFloat, withDefines } from '../gl/withDefines';
import type { SpeciesUniforms } from '../simulation/Simulation';
import particleVert from '../shaders/particle.vert?raw';
import particleFrag from '../shaders/particle.frag?raw';

/** The visible particles: additive HDR ellipses, heated (by their speed or the model's glow) and stretched by their speed. */
export class ParticleLayer {
    readonly scene = new THREE.Scene();
    readonly material: THREE.ShaderMaterial;

    /** `glowFromState`: 1 when the glow comes from the model's state (velocity w), see GpuModel.glow. */
    constructor(geometry: THREE.BufferGeometry, species: SpeciesUniforms,
                screenSize: Uniform<THREE.Vector2>, glowFromState: Uniform<number>, pixelRatio: number, view: ViewUniforms) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                texturePosition: { value: null },
                textureVelocity: { value: null },
                screenSize,
                viewZoom: view.zoom,
                viewCenter: view.center,
                pixelRatio: { value: pixelRatio },
                speciesSize: species.size,
                speciesColor: species.color,
                alpha: { value: 1 },
                heatAmount: { value: 1 },
                stretchAmount: { value: 1 },
                frameDt: { value: BASE_DT },
                glowFromState,
            },
            vertexShader: withDefines(particleVert, {
                MAX_SPECIES,
                HEAT_SPEED_MIN: glslFloat(HEAT_SPEED_RANGE[0]),
                HEAT_SPEED_MAX: glslFloat(HEAT_SPEED_RANGE[1]),
                MAX_STRETCH: glslFloat(MAX_STRETCH),
            }),
            fragmentShader: particleFrag,
            ...additiveBlending,
        });
        const points = new THREE.Points(geometry, this.material);
        points.frustumCulled = false;
        this.scene.add(points);
    }

    /** Shared with the nebula layer. */
    get texturePosition(): Uniform<THREE.Texture | null> {
        return this.material.uniforms.texturePosition;
    }

    set heatAmount(v: number) { this.material.uniforms.heatAmount.value = v; }
    set stretchAmount(v: number) { this.material.uniforms.stretchAmount.value = v; }

    /** Fewer particles are drawn brighter so the overall image keeps its weight. */
    setParticleCount(count: number): void {
        this.material.uniforms.alpha.value = PARTICLE_GAIN * Math.min(1, Math.max(0.6, 0.6 * Math.sqrt(20000 / count)));
    }

    update(positions: THREE.Texture, velocities: THREE.Texture, frameDt: number): void {
        this.material.uniforms.texturePosition.value = positions;
        this.material.uniforms.textureVelocity.value = velocities;
        this.material.uniforms.frameDt.value = frameDt;
    }
}
