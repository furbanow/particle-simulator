import type * as THREE from 'three';
import { formatNumber, t } from '../i18n';
import type { PostProcessing } from '../render/postprocessing';
import type { ParticleLayer } from '../render/particleLayer';
import { algorithmList, isAlgorithmId, type AlgorithmId } from '../simulation/algorithms';
import type { Simulation } from '../simulation/Simulation';
import type { ControlSpec } from '../simulationConfigs';
import { VISUAL_EFFECTS, type VisualEffectKey } from '../visualEffects';
import { byId } from './dom';
import type { ParamStore } from './paramPanel';

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
    /** Applies `values` (ParamPanel.setAlgorithm() then shows the effects' ones on their sliders). */
    apply(values: Readonly<Record<string, number>>): void;
    /** Shows the simulation's algorithm in the picker. */
    showAlgorithm(): void;
    /** The visual effects' values, edited by ParamPanel: setting one applies it to the rendering. */
    effects: ParamStore;
}

const SPEED_KEY = 'speed';

/** The controls shared by every algorithm, saved in simulation configs: the speed and the effects. */
export const sharedControlSpecs = (): ControlSpec[] => {
    const speed = byId<HTMLInputElement>('speedSlider');
    return [
        { key: SPEED_KEY, default: parseFloat(speed.defaultValue), range: [parseFloat(speed.min), parseFloat(speed.max)] },
        ...VISUAL_EFFECTS.map(({ key, default: value, min, max }): ControlSpec => ({ key, default: value, range: [min, max] })),
    ];
};

/**
 * Wires the controls every algorithm shares: the algorithm picker, the simulation speed and the
 * visual effects (all live; ParamPanel builds their sliders and gives them their first values).
 * The algorithm's own parameters are built by ParamPanel, its particle types by the element bar.
 */
export function setupControls({ simulation: sim, particles, post, renderer, onAlgorithmChange }: ControlTargets): SharedControls {
    const algorithmSelect = byId<HTMLSelectElement>('algorithmSelect');
    const algorithmPicker = byId('algorithmPicker');
    const speedSlider = byId<HTMLInputElement>('speedSlider');
    const speedVal = byId('speedVal');
    const speedDock = byId('speedDock');

    // ---- Algorithm ----
    for (const { id, label } of algorithmList()) algorithmSelect.add(new Option(label, id));
    const showAlgorithm = () => {
        algorithmSelect.value = sim.algorithmKey;
        algorithmPicker.dataset.tooltip = sim.algorithm.description;
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
        speedVal.textContent = sim.timeScale > 0 ? `${formatNumber(sim.timeScale, 2, 1)}×` : t('ui.speed.pause');
        // Position of the slider in 0..1, read by the gauge needle.
        const min = parseFloat(speedSlider.min);
        const max = parseFloat(speedSlider.max);
        speedDock.style.setProperty('--p', String((sim.timeScale - min) / (max - min)));
    };
    speedSlider.addEventListener('input', paintSpeed);
    paintSpeed();

    // ---- Visual effects ----
    const applyEffect: Record<string, (v: number) => void> = {
        exposure: v => { renderer.toneMappingExposure = v; },
        bloomStrength: v => { post.bloom.strength = v; post.bloom.enabled = v > 0; },
        bloomRadius: v => { post.bloom.radius = v; },
        bloomThreshold: v => { post.bloom.threshold = v; },
        nebula: v => { post.nebulaIntensity = v; },
        lens: v => { post.lensStrength = v; },
        heat: v => { particles.heatAmount = v; },
        stretch: v => { particles.stretchAmount = v; },
    } satisfies Record<VisualEffectKey, (v: number) => void>;
    const effectValues: Record<string, number> = Object.fromEntries(VISUAL_EFFECTS.map(e => [e.key, e.default]));
    const effects: ParamStore = {
        value: key => effectValues[key],
        set: (key, value) => {
            if (typeof value !== 'number') return;
            effectValues[key] = value;
            applyEffect[key](value);
        },
    };

    return {
        values: () => ({ [SPEED_KEY]: parseFloat(speedSlider.value), ...effectValues }),
        apply: values => {
            speedSlider.value = String(values[SPEED_KEY]);
            speedSlider.dispatchEvent(new Event('input', { bubbles: true }));
            for (const { key } of VISUAL_EFFECTS) effects.set(key, values[key]);
        },
        showAlgorithm,
        effects,
    };
}
