import * as THREE from 'three';
import './styles/main.css';
import { BASE_DT, FRAME_MS } from './config';
import { NebulaLayer } from './render/nebulaLayer';
import { ParticleLayer } from './render/particleLayer';
import { PostProcessing } from './render/postprocessing';
import { ALGORITHMS, DEFAULT_ALGORITHM, isAlgorithmId, type AlgorithmId } from './simulation/algorithms';
import { Simulation } from './simulation/Simulation';
import { ElementConfigStore } from './elementConfigs';
import { SimulationConfigStore, type SimulationConfig, type SimulationSetup } from './simulationConfigs';
import { ConfigPicker } from './ui/configPicker';
import { setupControls, sharedControlSpecs } from './ui/controls';
import { byId, fail, flash } from './ui/dom';
import { ElementBar } from './ui/elementBar';
import { ParamPanel } from './ui/paramPanel';
import { setupShortcuts } from './ui/shortcuts';
import { setupSliders, syncAllRanges, titleResettableRanges } from './ui/sliders';
import { Stats } from './ui/stats';
import { setupTooltips } from './ui/tooltip';

const container = byId('sim-container');
const uiPanel = byId('ui-panel');
const elementBarEl = byId('element-bar');
const startBtn = byId('startBtn');

// ---- Renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
if (!renderer.extensions.has('EXT_color_buffer_float')) {
    fail('WebGL2 EXT_color_buffer_float non supporté : impossible de rendre dans des textures flottantes.');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NeutralToneMapping; // applied by the OutputPass; keeps hues in bright cores
container.appendChild(renderer.domElement);

let width = container.clientWidth;
let height = container.clientHeight;
renderer.setSize(width, height);

// ---- Saved configs ----
let localStore: Storage | null = null;
try { localStore = window.localStorage; } catch { /* storage blocked: configs live in memory only */ }
const simulationConfigs = new SimulationConfigStore(localStore, sharedControlSpecs());

// ---- Simulation & rendering ----
function failWith(err: unknown): never {
    fail(err instanceof Error ? err.message : String(err));
}
let simulation: Simulation;
try {
    const { algorithm } = simulationConfigs.current;
    simulation = new Simulation(renderer, isAlgorithmId(algorithm) ? algorithm : DEFAULT_ALGORITHM);
} catch (err) {
    failWith(err);
}
const particles = new ParticleLayer(simulation.geometry, simulation.speciesUniforms, simulation.screenSize,
    simulation.glowFromState, renderer.getPixelRatio());
const nebula = new NebulaLayer(renderer, simulation.geometry, simulation.speciesUniforms, simulation.screenSize,
    particles.texturePosition);
const post = new PostProcessing(renderer, particles.scene, nebula.target.texture, width, height);

function resize(): void {
    width = container.clientWidth;
    height = container.clientHeight;
    renderer.setSize(width, height);
    simulation.resize(width, height);
    post.resize(width, height, nebula.resize(width, height));
}

// ---- Panel ----
// The tabs and their parameters (the algorithm's and the visual effects) are built from their
// declarations, and rebuilt when another algorithm is picked; so are the stats.
setupSliders(uiPanel);
setupTooltips(uiPanel, byId('tooltip'));

const controls = setupControls({ simulation, particles, post, renderer, onAlgorithmChange: switchAlgorithm });
const params = new ParamPanel(byId('panelTabs'), byId('panelTabContent'), simulation, controls.effects);
const stats = new Stats(simulation);

// ---- Element bar (saved element configs, population, element editor) ----
const elementBar = new ElementBar({
    simulation,
    store: new ElementConfigStore(localStore),
    onSpeciesChange: () => { if (simulation.activeCount > 0) simulation.updateSpeciesUniforms(); },
    onLoad: () => restart(),
});
setupSliders(elementBarEl);

function restart(): void {
    simulation.reset(elementBar.selectedTypeCount());
    particles.setParticleCount(simulation.activeCount);
    stats.reset();
    params.afterRestart();
    elementBar.afterRestart();
}

/** Rebuilds every algorithm-driven part of the UI from the new algorithm's declaration, then restarts. */
function switchAlgorithm(id: AlgorithmId): void {
    try {
        simulation.useAlgorithm(id);
    } catch (err) {
        failWith(err);
    }
    params.setAlgorithm();
    stats.setAlgorithm();
    elementBar.setAlgorithm();
    restart();
}

// ---- Simulation configs (the whole setup: algorithm, parameters, elements, shared sliders) ----
const simulationSetup = (): SimulationSetup => ({
    algorithm: simulation.algorithmKey,
    params: { ...simulation.params },
    typeCount: elementBar.selectedTypeCount(),
    species: simulation.species,
    controls: controls.values(),
});

/** Brings the whole simulation and its UI to `setup`, with a single restart. */
function applySimulationSetup(setup: SimulationSetup): void {
    if (!isAlgorithmId(setup.algorithm)) return;
    const algorithmChanged = setup.algorithm !== simulation.algorithmKey;
    try {
        simulation.useAlgorithm(setup.algorithm);
    } catch (err) {
        failWith(err);
    }
    for (const [key, value] of Object.entries(setup.params)) simulation.setParam(key, value);
    controls.apply(setup.controls);
    params.setAlgorithm();                 // shows the values just set
    if (algorithmChanged) {
        stats.setAlgorithm();
        elementBar.setAlgorithm();
    }
    elementBar.loadSetup(setup);
    controls.showAlgorithm();
    restart();
}

const simulationPicker = new ConfigPicker<SimulationConfig, SimulationSetup>({
    root: byId('simulationConfig'),
    store: simulationConfigs,
    state: simulationSetup,
    create: () => simulationConfigs.create(simulation.algorithmKey),
    onLoad: applySimulationSetup,
    groupOf: config => isAlgorithmId(config.algorithm) ? ALGORITHMS[config.algorithm].label : config.algorithm,
});
const refreshSimulationPicker = () => simulationPicker.refresh();
uiPanel.addEventListener('input', refreshSimulationPicker);
uiPanel.addEventListener('change', refreshSimulationPicker);
elementBar.onEdit = refreshSimulationPicker;

function togglePanel(): void {
    document.body.classList.toggle('panel-hidden');
    resize();
}

startBtn.addEventListener('click', restart);
byId('hidePanelBtn').addEventListener('click', togglePanel);
byId('showPanelBtn').addEventListener('click', togglePanel);
setupShortcuts({ restart: () => { restart(); flash(startBtn); }, togglePanel });
window.addEventListener('resize', resize);
// The canvas fills the whole area behind the element bar, which floats above it: folding or
// unfolding the bar never resizes the simulation. Only the error overlay follows the bar's height.
function syncTopbarHeight(): void {
    document.documentElement.style.setProperty('--topbar-h', `${elementBarEl.offsetHeight}px`);
}
syncTopbarHeight();
new ResizeObserver(syncTopbarHeight).observe(elementBarEl);
syncAllRanges(uiPanel);
syncAllRanges(elementBarEl);
titleResettableRanges(elementBarEl);

// ---- Frame loop (60 FPS cap) ----
let lastFrame = performance.now();
// Clock of the background (nebula, grain): it stops while the simulation is paused (speed 0).
let visualTime = 0;
let lastVisualNow = lastFrame;

function loop(now: number): void {
    requestAnimationFrame(loop);
    if (now - lastFrame < FRAME_MS - 1) return; // 1 ms tolerance for rAF jitter
    lastFrame += FRAME_MS;
    if (now - lastFrame > FRAME_MS) lastFrame = now;

    simulation.step();
    particles.update(simulation.positionTexture, simulation.velocityTexture, BASE_DT * simulation.timeScale);
    nebula.render();
    if (simulation.timeScale > 0) visualTime += (now - lastVisualNow) / 1000;
    lastVisualNow = now;
    post.render(visualTime);
    simulation.endFrame();

    stats.update();
    stats.tick(now);
}

resize();
// A built-in config is not applied: the element bar stays on its own current config.
if (simulationConfigs.canEdit(simulationConfigs.current.id)) applySimulationSetup(simulationConfigs.current);
else restart();
simulationPicker.refreshList();
simulationPicker.refresh();
requestAnimationFrame(loop);
