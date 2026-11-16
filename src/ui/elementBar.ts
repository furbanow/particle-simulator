import type { ElementConfig, ElementConfigStore, ElementSetup } from '../elementConfigs';
import { buildMetrics, type ElementMetric } from '../elementMetrics';
import { splitPopulation } from '../population';
import { populationWeights } from '../simulation/algorithm';
import type { AlgorithmId } from '../simulation/algorithms';
import type { Simulation } from '../simulation/Simulation';
import { ConfigPicker } from './configPicker';
import { byId } from './dom';
import { ElementChart } from './elementChart';
import { ElementEditor } from './elementEditor';
import { syncRange } from './sliders';

export interface ElementBarOptions {
    simulation: Simulation;
    store: ElementConfigStore;
    /** A live type property changed (e.g. color, mass, size): refresh the uniforms. */
    onSpeciesChange(): void;
    /** A config was loaded: restart the simulation with it. */
    onLoad(): void;
}

const PENDING_HINT = 'Appliqué au redémarrage';

interface ChartCard {
    chart: ElementChart;
    metric: ElementMetric;
}

/**
 * Advanced editor of the particle types of the selected algorithm, shown in a modal and built from
 * its particle type schema: saved configs (load, new, duplicate, rename, delete, save), type count,
 * one chart per property, all visible at once, and a compact editor of the selected type (color,
 * name, readouts). Live properties apply at once; the type count and the population on restart.
 * setAlgorithm() rebuilds it for another algorithm. The simple editor lives in the panel
 * (ElementsQuickPanel) and shares the same type objects.
 */
export class ElementBar {
    /** The types or the type count being edited changed, whatever the means. */
    onEdit: () => void = () => {};
    private readonly sim: Simulation;
    private readonly store: ElementConfigStore;
    private readonly onSpeciesChange: () => void;
    private readonly bar = byId('element-bar');
    private readonly title = byId('elementBarTitle');
    private readonly editorTitle = byId('elementEditorTitle');
    private readonly typeCountLabel = byId('typeCountLabel');
    private readonly typeCountSlider = byId<HTMLInputElement>('typeCountSlider');
    private readonly typeCountVal = byId('typeCountVal');
    private readonly hint = byId('elementsHint');
    private readonly chartGrid = byId('chartGrid');
    private readonly picker: ConfigPicker<ElementConfig, ElementSetup>;
    private charts: ChartCard[] = [];
    private editor!: ElementEditor;
    private selected = 0;
    /** Type count being edited, per algorithm already shown (the types themselves live in Simulation). */
    private readonly typeCounts = new Map<AlgorithmId, number>();

    constructor({ simulation, store, onSpeciesChange, onLoad }: ElementBarOptions) {
        this.sim = simulation;
        this.store = store;
        this.onSpeciesChange = onSpeciesChange;
        this.typeCountSlider.addEventListener('input', () => {
            this.typeCounts.set(this.sim.algorithmKey, this.selectedTypeCount());
            this.refresh();
        });
        this.picker = new ConfigPicker({
            root: this.bar,
            store,
            state: () => this.setup(),
            create: () => store.create(),
            onLoad: config => {
                this.apply(config);
                onLoad();
            },
        });
        this.setAlgorithm();
    }

    selectedTypeCount(): number {
        return parseInt(this.typeCountSlider.value, 10);
    }

    /** Sets the type count from outside (the panel's simple editor). */
    changeTypeCount(count: number): void {
        this.setTypeCount(count);
        this.refresh();
    }

    /** The types were edited from outside (the panel's simple editor): follow them. */
    speciesEdited(live: boolean): void {
        if (live) this.onSpeciesChange();
        this.editor.refresh(true);
        this.refresh();
    }

    /** Refreshes the pending state after a restart. */
    afterRestart(): void {
        this.refresh();
    }

    /**
     * Rebuilds the bar for the simulation's algorithm. The first time an algorithm is shown its
     * current config is loaded; afterwards its types are found as they were left.
     */
    setAlgorithm(): void {
        const schema = this.sim.algorithm.particleTypes;
        const species = this.sim.species;
        const liveChange = (live: boolean) => {
            if (live) this.onSpeciesChange();
            this.refresh();
        };
        this.store.use(this.sim.algorithmKey);
        const labels = schema.labels;
        this.title.textContent = labels.title;
        this.editorTitle.textContent = labels.item;
        this.typeCountLabel.textContent = labels.count;
        this.picker.newBtn.title = `Nouvelle configuration (${schema.builtinConfig.name.toLowerCase()})`;
        this.typeCountSlider.max = String(schema.defaults.length);

        this.buildCharts(buildMetrics(schema), liveChange);
        this.editor = new ElementEditor(byId('elementEditor'), schema, species, liveChange);

        const typeCount = this.typeCounts.get(this.sim.algorithmKey);
        if (typeCount === undefined) {
            this.apply(this.store.current);
        } else {
            this.setTypeCount(typeCount);
            this.picker.refreshList();
            this.refresh();
        }
        this.select(0);
    }

    /** The state being edited, in the shape stored in configs. */
    private setup(): ElementSetup {
        return { typeCount: this.selectedTypeCount(), species: this.sim.species };
    }

    private setTypeCount(count: number): void {
        this.typeCountSlider.value = String(count);
        syncRange(this.typeCountSlider);
        this.typeCounts.set(this.sim.algorithmKey, this.selectedTypeCount());
    }

    /**
     * Shows `setup`, part of a whole simulation config: the store's config identical to it becomes
     * current if there is one, else the bar stays on its config and shows the difference.
     * The caller restarts the simulation.
     */
    loadSetup(setup: ElementSetup): void {
        this.store.selectMatching(setup);
        this.apply(setup);
    }

    /** Copies a setup into the shared type objects (in place: materials and UI hold references). */
    private apply(setup: ElementSetup): void {
        setup.species.forEach((s, k) => {
            const target = this.sim.species[k];
            Object.assign(target, s, { values: target.values });
            Object.assign(target.values, s.values);
        });
        this.setTypeCount(setup.typeCount);
        this.editor.refresh(true);
        this.picker.refreshList();
        this.refresh();
    }

    private select(k: number): void {
        this.selected = k;
        for (const { chart } of this.charts) chart.select(k);
        this.editor.show(k);
    }

    private refresh(): void {
        const selected = this.selectedTypeCount();
        const active = this.sim.activeTypeCount;
        this.typeCountVal.textContent = String(selected);
        for (const { chart } of this.charts) chart.showCounts(selected, active);
        // Keep the editor on a visible type.
        const shown = Math.max(selected, active);
        if (this.selected >= shown) this.select(shown - 1);
        else this.editor.refresh();

        const weights = populationWeights(this.sim.algorithm.particleTypes, this.sim.species);
        const counts = splitPopulation(this.sim.activeCount, weights, selected);
        const pending = selected !== active || counts.some((n, k) => n !== this.sim.speciesCounts[k]);
        this.hint.textContent = pending ? PENDING_HINT : '';

        this.picker.refresh();
        this.onEdit();
    }

    // ---- Charts ----

    /**
     * One card per property (the three color channels are three cards), all shown at once. The
     * first card of a property holds its Default / Random tools; the population one also shows the
     * stacked shares.
     */
    private buildCharts(metrics: readonly ElementMetric[], liveChange: (live: boolean) => void): void {
        const schema = this.sim.algorithm.particleTypes;
        const species = this.sim.species;
        const visible = () => Math.max(this.selectedTypeCount(), this.sim.activeTypeCount);
        const changed = (live: boolean) => {
            if (live) this.onSpeciesChange();
            this.editor.refresh(true);
            this.refresh();
        };
        this.chartGrid.replaceChildren();
        this.charts = metrics.map((metric, i) => {
            const first = metrics.findIndex(m => m.group === metric.group) === i;
            const card = document.createElement('section');
            card.className = 'ebar-card ebar-chart';
            card.classList.toggle('gradient', metric.track !== undefined);
            card.dataset.metric = metric.id;
            card.innerHTML = `
                <div class="ebar-card-head">
                    <h3 class="chart-title"></h3>
                    <div class="ebar-tools"></div>
                </div>
                <div class="element-chart"></div>`;
            const title = card.querySelector<HTMLElement>('.chart-title')!;
            title.textContent = metric.label;
            if (metric.unit) {
                const unit = document.createElement('span');
                unit.className = 'unit';
                unit.textContent = metric.unit;
                title.appendChild(unit);
            }
            if (first) {
                const tools = card.querySelector<HTMLElement>('.ebar-tools')!;
                const reset = document.createElement('button');
                reset.type = 'button';
                reset.className = 'btn';
                reset.title = metric.resetTitle;
                reset.textContent = metric.resetLabel;
                reset.addEventListener('click', () => {
                    species.forEach((s, k) => metric.reset(s, k));
                    changed(metric.live);
                });
                const random = document.createElement('button');
                random.type = 'button';
                random.className = 'btn';
                random.title = metric.randomTitle;
                random.textContent = 'Aléatoire';
                random.addEventListener('click', () => {
                    metric.randomize(species, visible());
                    changed(metric.live);
                });
                tools.append(reset, random);
            }
            const bands: HTMLElement[] = [];
            if (metric.population) {
                const band = document.createElement('div');
                band.className = 'pop-band';
                band.setAttribute('aria-hidden', 'true');
                card.appendChild(band);
                bands.push(band);
            }
            this.chartGrid.appendChild(card);
            const chart = new ElementChart(card.querySelector<HTMLElement>('.element-chart')!, bands, schema, species,
                metric, { onChange: m => liveChange(m.live), onSelect: k => this.select(k) });
            return { chart, metric };
        });
    }
}
