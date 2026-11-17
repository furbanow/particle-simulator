import * as THREE from 'three';
import './styles/main.css';
import { browserClock, runBenchmark } from './benchmark/runner';
import { BASE_DT, MAX_PARTICLES } from './config';
import { DisplaySettingsStore, frameMs } from './displaySettings';
import { applyStaticTranslations, getLanguage } from './i18n';
import { NebulaLayer } from './render/nebulaLayer';
import { ParticleLayer } from './render/particleLayer';
import { PostProcessing } from './render/postprocessing';
import { defaultTypeCount, PARTICLE_COUNT_PARAM } from './simulation/algorithm';
import {
    ALGORITHMS, BENCHMARK_ALGORITHM, DEFAULT_ALGORITHM, isAlgorithmId, type AlgorithmId,
} from './simulation/algorithms';
import { findParam } from './simulation/params';
import { Simulation } from './simulation/Simulation';
import { ElementConfigStore } from './elementConfigs';
import { SimulationConfigStore, type SimulationConfig, type SimulationSetup } from './simulationConfigs';
import { BenchmarkDialog } from './ui/benchmarkDialog';
import { ConfigPicker } from './ui/configPicker';
import { DarkMatterPanel } from './ui/darkMatterPanel';
import { setupControls, sharedControlSpecs } from './ui/controls';
import { byId, fail, flash } from './ui/dom';
import { showUnsupported } from './ui/unsupported';
import { ElementBar } from './ui/elementBar';
import { DisplaySettingsPanel } from './ui/displaySettingsPanel';
import { ElementsQuickPanel } from './ui/elementsQuickPanel';
import { Modal } from './ui/modal';
import { ParamPanel } from './ui/paramPanel';
import { setupShortcuts } from './ui/shortcuts';
import { setupSliders, syncAllRanges, titleResettableRanges } from './ui/sliders';
import { Stats } from './ui/stats';
import { setupTooltips } from './ui/tooltip';

// The static texts of the page, in the language fixed at load (changing it reloads the page).
document.documentElement.lang = getLanguage();
applyStaticTranslations(document);

const container = byId('sim-container');
const uiPanel = byId('ui-panel');
const startBtn = byId('startBtn');

// ---- Renderer ----
function createRenderer(): THREE.WebGLRenderer {
    try {
        const created = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        if (created.extensions.has('EXT_color_buffer_float')) return created;
        created.dispose();
    } catch { /* no WebGL 2 context: falls through to the apology */ }
    return showUnsupported();
}
const renderer = createRenderer();
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
    darkMatter.resize(width, height);
    post.resize(width, height, nebula.resize(width, height));
}

// ---- Display settings (FPS cap, particle cap, visibility of the help, the stats and the author) ----
const displaySettings = new DisplaySettingsStore(localStore);
// The particle cap bounds the count sliders: set before the panel is built. Null until the GPU benchmark has run.
simulation.setParticleCap(displaySettings.values.particleCap ?? MAX_PARTICLES);
/** While the GPU benchmark runs, the frame loop and the restarts wait. */
let benchmarking = false;

// ---- Panel ----
// The tabs and their parameters (the algorithm's and the visual effects) are built from their
// declarations, and rebuilt when another algorithm is picked; so are the stats.
setupSliders(uiPanel);
setupTooltips(uiPanel, byId('tooltip'));

const controls = setupControls({ simulation, particles, post, renderer, onAlgorithmChange: switchAlgorithm });
// ---- Elements: the advanced editor (modal: saved configs, population, charts) and the panel's simple one ----
const elementBar = new ElementBar({
    simulation,
    store: new ElementConfigStore(localStore),
    onSpeciesChange: () => { if (simulation.activeCount > 0) simulation.updateSpeciesUniforms(); },
    onLoad: () => restart(),
});
setupSliders(byId('element-bar'));
const elementsModal = new Modal(byId('elements-modal'));
const elementsQuick = new ElementsQuickPanel(simulation, elementBar, () => elementsModal.open());

// The static dark matter: its tab is built once and kept when the panel is rebuilt for another algorithm.
const darkMatter = new DarkMatterPanel({ field: simulation.darkMatter, container, surface: renderer.domElement });
const params = new ParamPanel(byId('panelTabs'), byId('panelTabContent'), simulation, controls.effects, {
    extraContent: { elements: elementsQuick.element, darkMatter: darkMatter.element },
    onTabChange: id => darkMatter.setTabOpen(id === 'darkMatter'),
});
const stats = new Stats(simulation);

const settingsModal = new Modal(byId('settings-modal'));
new DisplaySettingsPanel(displaySettings, () => settingsModal.open(), () => void benchmarkGpu());

function restart(): void {
    if (benchmarking) return;               // the benchmark restarts the simulation when it ends
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
    elementsQuick.setAlgorithm();
    elementBar.setAlgorithm();
    restart();
}

// ---- Simulation configs (the whole setup: algorithm, parameters, elements, shared sliders, dark matter) ----
const simulationSetup = (): SimulationSetup => ({
    algorithm: simulation.algorithmKey,
    params: { ...simulation.params },
    typeCount: elementBar.selectedTypeCount(),
    species: simulation.species,
    controls: controls.values(),
    darkMatter: darkMatter.values(),
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
    darkMatter.apply(setup.darkMatter);
    params.setAlgorithm();                 // shows the values just set
    if (algorithmChanged) {
        stats.setAlgorithm();
        elementsQuick.setAlgorithm();
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
elementBar.onEdit = () => {
    refreshSimulationPicker();
    elementsQuick.refresh();
};

/** Bounds the particle count sliders (the counts above it come down to it, applied on restart). */
function applyParticleCap(cap: number | null): void {
    const value = cap ?? MAX_PARTICLES;
    if (value === simulation.particleCap) return;
    simulation.setParticleCap(value);
    params.setAlgorithm();
    refreshSimulationPicker();
}
displaySettings.onChange(values => applyParticleCap(values.particleCap));

// ---- GPU benchmark (first visit, or from the settings) ----
// Times full frames of the benchmark algorithm at its default parameters and speed; the frame loop waits
// meanwhile. The found cap replaces the user's, then the user's simulation restarts.
const benchmarkDialog = new BenchmarkDialog();

async function benchmarkGpu(): Promise<void> {
    if (benchmarking) return;
    benchmarking = true;
    // The settings dialog, if the benchmark was run from it, would be timed too (its blurred backdrop).
    const fromSettings = settingsModal.isOpen;
    settingsModal.close();
    benchmarkDialog.show();
    // Two animation frames: the dialog is painted before the GPU gets busy.
    await browserClock.nextFrame();
    await browserClock.nextFrame();
    const algorithm = ALGORITHMS[BENCHMARK_ALGORITHM];
    const countParam = findParam(algorithm, PARTICLE_COUNT_PARAM);
    if (countParam?.kind !== 'number') throw new Error(`${BENCHMARK_ALGORITHM} has no particle count parameter`);
    // At the default speed: its substeps are part of the load.
    const speed = parseFloat(byId<HTMLInputElement>('speedSlider').defaultValue);
    const restore = simulation.borrowAlgorithm(BENCHMARK_ALGORITHM, speed);
    let cap: number | null = null;
    try {
        cap = await runBenchmark({
            range: [countParam.min, countParam.max],
            prepare: count => {
                simulation.setParam(PARTICLE_COUNT_PARAM, count);
                simulation.reset(defaultTypeCount(algorithm.particleTypes));
                particles.setParticleCount(count);
            },
            frame: renderFrame,
        }, browserClock, fraction => benchmarkDialog.progress(fraction));
    } finally {
        restore();
        if (cap !== null) displaySettings.update({ particleCap: cap, benchmarkCap: cap });
        benchmarking = false;
        benchmarkDialog.hide();
        restart();
        if (fromSettings) settingsModal.open();
    }
}

function togglePanel(): void {
    document.body.classList.toggle('panel-hidden');
    resize();
}

startBtn.addEventListener('click', restart);
byId('hidePanelBtn').addEventListener('click', togglePanel);
byId('showPanelBtn').addEventListener('click', togglePanel);
setupShortcuts({ restart: () => { restart(); flash(startBtn); }, togglePanel });
window.addEventListener('resize', resize);
syncAllRanges(uiPanel);
syncAllRanges(byId('element-bar'));
titleResettableRanges(byId('element-bar'));

// ---- Frame loop (FPS cap from the display settings) ----
let lastFrame = performance.now();
// Clock of the background (nebula, grain): it stops while the simulation is paused (speed 0).
let visualTime = 0;
let lastVisualNow = lastFrame;

/** One frame: simulation step, then rendering. */
function renderFrame(): void {
    simulation.step();
    particles.update(simulation.positionTexture, simulation.velocityTexture, BASE_DT * simulation.timeScale);
    nebula.render();
    post.render(visualTime);
    simulation.endFrame();
}

function loop(now: number): void {
    requestAnimationFrame(loop);
    if (benchmarking) {
        lastVisualNow = now;                // the background clock does not jump over the benchmark
        return;
    }
    const frame = frameMs(displaySettings.values.fpsLimit);
    if (now - lastFrame < frame - 1) return; // 1 ms tolerance for rAF jitter
    lastFrame += frame;
    if (now - lastFrame > frame) lastFrame = now;

    if (simulation.timeScale > 0) visualTime += (now - lastVisualNow) / 1000;
    lastVisualNow = now;
    renderFrame();

    stats.update();
    stats.tick(now);
}

resize();
// The first GPU benchmark starts right away (its first animation frames are ahead): the restart of
// the setup below then waits for its end, so the simulation is not set up twice.
const firstBenchmark = displaySettings.values.particleCap === null ? benchmarkGpu() : null;
// A built-in config is not applied: the element editor stays on its own current config.
if (simulationConfigs.canEdit(simulationConfigs.current.id)) applySimulationSetup(simulationConfigs.current);
else restart();
simulationPicker.refreshList();
simulationPicker.refresh();
requestAnimationFrame(loop);
firstBenchmark?.catch(err => console.error(err));
