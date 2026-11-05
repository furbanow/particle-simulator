import type * as THREE from 'three';
import type { PostProcessing } from '../render/postprocessing';
import type { ParticleLayer } from '../render/particleLayer';
import { algorithmList, isAlgorithmId, type AlgorithmId } from '../simulation/algorithms';
import type { Simulation } from '../simulation/Simulation';
import type { ControlSpec } from '../simulationConfigs';
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

/** The controls as main.ts drives them when a simulation config is saved or loaded. */
export interface SharedControls {
    /** Value of each shared slider, by name. */
    values(): Record<string, number>;
    /** Moves the sliders to `values`, applying them like a user would. */
    apply(values: Readonly<Record<string, number>>): void;
    /** Shows the simulation's algorithm in the picker. */
    showAlgorithm(): void;
}

// Sliders shared by every algorithm (`#{name}Slider`), saved in simulation configs.
const SHARED_SLIDERS = ['speed', 'bloomStrength', 'bloomRadius', 'bloomThreshold', 'exposure', 'nebula', 'lens',
    'heat', 'stretch'] as const;

const sharedSlider = (name: string): HTMLInputElement => byId<HTMLInputElement>(`${name}Slider`);

/** The shared sliders as the markup declares them. */
export const sharedControlSpecs = (): ControlSpec[] => SHARED_SLIDERS.map(key => {
    const slider = sharedSlider(key);
    return {
        key,
        default: parseFloat(slider.defaultValue),
        range: [parseFloat(slider.min), parseFloat(slider.max)],
    };
});

/**
 * Wires the controls every algorithm shares: the algorithm picker, the simulation speed and the
 * visual effects (all live). The algorithm's own parameters are built by ParamPanel, its
 * particle types by the element bar.
 */
export function setupControls({ simulation: sim, particles, post, renderer, onAlgorithmChange }: ControlTargets): SharedControls {
    const algorithmSelect = byId<HTMLSelectElement>('algorithmSelect');
    const algorithmDescription = byId('algorithmDescription');
    const speedSlider = byId<HTMLInputElement>('speedSlider');
    const speedVal = byId('speedVal');
    const speedDock = byId('speedDock');

    // ---- Algorithm ----
    for (const { id, label } of algorithmList()) algorithmSelect.add(new Option(label, id));
    const showAlgorithm = () => {
        algorithmSelect.value = sim.algorithmKey;
        algorithmDescription.textContent = sim.algorithm.description;
    };
    algorithmSelect.addEventListener('change', () => {
        const id = algorithmSelect.value;
        if (!isAlgorithmId(id) || id === sim.algorithmKey) return;
        onAlgorithmChange(id);
        showAlgorithm();
    });
    showAlgorithm();

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

    return {
        values: () => Object.fromEntries(SHARED_SLIDERS.map(name => [name, parseFloat(sharedSlider(name).value)])),
        apply: values => {
            for (const name of SHARED_SLIDERS) {
                const slider = sharedSlider(name);
                slider.value = String(values[name]);
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        },
        showAlgorithm,
    };
}
