import type * as THREE from 'three';
import type { PostProcessing } from '../render/postprocessing';
import type { ParticleLayer } from '../render/particleLayer';
import type { Simulation } from '../simulation/Simulation';
import { byId, formatInt } from './dom';
import { bindSlider, fixed2, percent } from './sliders';
import type { SpeciesPanel } from './speciesCards';
import type { Stats } from './stats';

export interface ControlTargets {
    simulation: Simulation;
    particles: ParticleLayer;
    post: PostProcessing;
    renderer: THREE.WebGLRenderer;
    speciesPanel: SpeciesPanel;
    stats: Stats;
}

const PENDING_HINT = 'Appliqué au redémarrage';

/**
 * Wires the panel sliders to the simulation and the renderer. Particle and species counts only
 * apply on restart (a hint says so); everything else is live.
 */
export function setupControls({ simulation: sim, particles, post, renderer, speciesPanel, stats }: ControlTargets) {
    const countSlider = byId<HTMLInputElement>('countSlider');
    const countVal = byId('countVal');
    const countHint = byId('countHint');
    const typeCountSlider = byId<HTMLInputElement>('typeCountSlider');
    const typeCountVal = byId('typeCountVal');
    const typeCountHint = byId('typeCountHint');
    const speedSlider = byId<HTMLInputElement>('speedSlider');
    const speedVal = byId('speedVal');
    const thresholdSlider = byId<HTMLInputElement>('thresholdSlider');
    const thresholdVal = byId('thresholdVal');
    const radiusSlider = byId<HTMLInputElement>('radiusSlider');
    const radiusVal = byId('radiusVal');
    const powerSlider = byId<HTMLInputElement>('powerSlider');
    const powerVal = byId('powerVal');

    const selectedCount = () => parseInt(countSlider.value, 10);
    const selectedTypeCount = () => parseInt(typeCountSlider.value, 10);

    function updateCountHint(): void {
        countHint.textContent = selectedCount() !== sim.activeCount ? PENDING_HINT : '';
    }

    function updateTypeCountUI(): void {
        const selected = selectedTypeCount();
        typeCountVal.textContent = String(selected);
        typeCountHint.textContent = selected !== sim.activeTypeCount ? PENDING_HINT : '';
        speciesPanel.showCounts(selected, sim.activeTypeCount);
    }

    // ---- Particles ----
    countSlider.addEventListener('input', () => {
        countVal.textContent = formatInt(selectedCount());
        updateCountHint();
    });
    typeCountSlider.addEventListener('input', updateTypeCountUI);
    byId('randomColorsBtn').addEventListener('click', () => speciesPanel.randomizeColors());
    byId('randomMassesBtn').addEventListener('click', () => speciesPanel.randomizeMasses());

    // ---- Dynamics ----
    speedSlider.addEventListener('input', () => {
        sim.timeScale = parseFloat(speedSlider.value);
        speedVal.textContent = `${sim.timeScale.toFixed(1)}×`;
    });

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
        selectedTypeCount,
        /** Refreshes the pending hints after a restart. */
        afterRestart(): void {
            updateCountHint();
            updateTypeCountUI();
        },
    };
}
