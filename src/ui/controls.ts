import type * as THREE from 'three';
import type { PostProcessing } from '../render/postprocessing';
import type { ParticleLayer } from '../render/particleLayer';
import type { Simulation } from '../simulation/Simulation';
import { byId, formatInt } from './dom';
import { bindSlider, fixed2, percent } from './sliders';
import type { Stats } from './stats';

export interface ControlTargets {
    simulation: Simulation;
    particles: ParticleLayer;
    post: PostProcessing;
    renderer: THREE.WebGLRenderer;
    stats: Stats;
}

const PENDING_HINT = 'Appliqué au redémarrage';

/**
 * Wires the panel sliders to the simulation and the renderer. The particle count only applies on
 * restart (a hint says so); everything else is live. Elements are handled by the element bar.
 */
export function setupControls({ simulation: sim, particles, post, renderer, stats }: ControlTargets) {
    const countSlider = byId<HTMLInputElement>('countSlider');
    const countVal = byId('countVal');
    const countHint = byId('countHint');
    const speedSlider = byId<HTMLInputElement>('speedSlider');
    const speedVal = byId('speedVal');
    const speedDock = byId('speedDock');
    const thresholdSlider = byId<HTMLInputElement>('thresholdSlider');
    const thresholdVal = byId('thresholdVal');
    const radiusSlider = byId<HTMLInputElement>('radiusSlider');
    const radiusVal = byId('radiusVal');
    const powerSlider = byId<HTMLInputElement>('powerSlider');
    const powerVal = byId('powerVal');

    const selectedCount = () => parseInt(countSlider.value, 10);

    function updateCountHint(): void {
        countHint.textContent = selectedCount() !== sim.activeCount ? PENDING_HINT : '';
    }

    // ---- Particles ----
    countSlider.addEventListener('input', () => {
        countVal.textContent = formatInt(selectedCount());
        updateCountHint();
    });

    // ---- Dynamics ----
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
    bindSlider('gravity', v => `G = ${v.toFixed(1)}`, v => { sim.gravity = v; });

    // ---- Supernova ----
    thresholdSlider.addEventListener('input', () => {
        const value = parseInt(thresholdSlider.value, 10);
        sim.supernovaThreshold = value / 100;
        thresholdVal.textContent = `${value} %`;
        stats.threshold(value);
    });
    radiusSlider.addEventListener('input', () => {
        sim.concentrationRadius = parseInt(radiusSlider.value, 10);
        radiusVal.textContent = `${sim.concentrationRadius} px`;
    });
    powerSlider.addEventListener('input', () => {
        const power = parseInt(powerSlider.value, 10);
        sim.supernovaPower = power;
        powerVal.textContent = `${power} %`;
    });

    // ---- Visual effects (all live) ----
    bindSlider('bloomStrength', fixed2, v => { post.bloom.strength = v; post.bloom.enabled = v > 0; });
    bindSlider('bloomRadius', fixed2, v => { post.bloom.radius = v; });
    bindSlider('bloomThreshold', fixed2, v => { post.bloom.threshold = v; });
    bindSlider('exposure', fixed2, v => { renderer.toneMappingExposure = v; });
    bindSlider('nebula', percent, v => { post.nebulaIntensity = v; });
    bindSlider('lens', percent, v => { post.lensStrength = v; });
    bindSlider('heat', percent, v => { particles.heatAmount = v; });
    bindSlider('stretch', v => `${v.toFixed(1)}×`, v => { particles.stretchAmount = v; });

    // Initial values: push every slider into the simulation and its display.
    for (const slider of [countSlider, speedSlider, thresholdSlider, radiusSlider, powerSlider]) {
        slider.dispatchEvent(new Event('input'));
    }

    return {
        selectedCount,
        /** Refreshes the pending hint after a restart. */
        afterRestart: updateCountHint,
    };
}
