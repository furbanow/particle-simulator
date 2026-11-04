import type * as THREE from 'three';
import type { PostProcessing } from '../render/postprocessing';
import type { ParticleLayer } from '../render/particleLayer';
import { algorithmList, isAlgorithmId, type AlgorithmId } from '../simulation/algorithms';
import type { Simulation } from '../simulation/Simulation';
import { byId } from './dom';
import { bindSlider, fixed2, percent } from './sliders';

export interface ControlTargets {
    simulation: Simulation;
    particles: ParticleLayer;
    post: PostProcessing;
    renderer: THREE.WebGLRenderer;
    /** Another algorithm was picked: the UI is rebuilt for it and the simulation restarts. */
    onAlgorithmChange(id: AlgorithmId): void;
}

/**
 * Wires the controls every algorithm shares: the algorithm picker, the simulation speed and the
 * visual effects (all live). The algorithm's own parameters are built by ParamPanel, its
 * particle types by the element bar.
 */
export function setupControls({ simulation: sim, particles, post, renderer, onAlgorithmChange }: ControlTargets): void {
    const algorithmSelect = byId<HTMLSelectElement>('algorithmSelect');
    const algorithmDescription = byId('algorithmDescription');
    const speedSlider = byId<HTMLInputElement>('speedSlider');
    const speedVal = byId('speedVal');
    const speedDock = byId('speedDock');

    // ---- Algorithm ----
    for (const { id, label } of algorithmList()) algorithmSelect.add(new Option(label, id));
    algorithmSelect.value = sim.algorithmKey;
    const paintAlgorithm = () => { algorithmDescription.textContent = sim.algorithm.description; };
    algorithmSelect.addEventListener('change', () => {
        const id = algorithmSelect.value;
        if (!isAlgorithmId(id) || id === sim.algorithmKey) return;
        onAlgorithmChange(id);
        paintAlgorithm();
    });
    paintAlgorithm();

    // ---- Simulation speed ----
    const paintSpeed = () => {
        sim.timeScale = parseFloat(speedSlider.value);
        speedVal.textContent = sim.timeScale > 0 ? `${sim.timeScale.toFixed(1)}×` : 'Pause';
        // Position of the slider in 0..1, read by the gauge needle.
        const min = parseFloat(speedSlider.min);
        const max = parseFloat(speedSlider.max);
        speedDock.style.setProperty('--p', String((sim.timeScale - min) / (max - min)));
    };
    speedSlider.addEventListener('input', paintSpeed);
    paintSpeed();

    // ---- Visual effects (all live) ----
    bindSlider('bloomStrength', fixed2, v => { post.bloom.strength = v; post.bloom.enabled = v > 0; });
    bindSlider('bloomRadius', fixed2, v => { post.bloom.radius = v; });
    bindSlider('bloomThreshold', fixed2, v => { post.bloom.threshold = v; });
    bindSlider('exposure', fixed2, v => { renderer.toneMappingExposure = v; });
    bindSlider('nebula', percent, v => { post.nebulaIntensity = v; });
    bindSlider('lens', percent, v => { post.lensStrength = v; });
    bindSlider('heat', percent, v => { particles.heatAmount = v; });
    bindSlider('stretch', v => `${v.toFixed(1)}×`, v => { particles.stretchAmount = v; });
}
