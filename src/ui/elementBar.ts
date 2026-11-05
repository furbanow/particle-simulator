import type { ElementConfig, ElementConfigStore, ElementSetup } from '../elementConfigs';
import { buildMetrics, metricGroups, type ElementMetric } from '../elementMetrics';
import { splitPopulation } from '../population';
import { populationWeights } from '../simulation/algorithm';
import type { AlgorithmId } from '../simulation/algorithms';
import type { Simulation } from '../simulation/Simulation';
import { ConfigPicker } from './configPicker';
import { byId } from './dom';
import { ElementChart } from './elementChart';
import { ElementEditor } from './elementEditor';
import { rememberedOpen, rememberOpen } from './panelState';
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
const OPEN_KEY = 'elementBar';

/**
 * Top bar dedicated to the particle types of the selected algorithm, built from its particle type
 * schema: saved configs (load, new, duplicate, rename, delete, save), type count, a chart of one
 * property at a time and a compact editor of the selected type (color, name, readouts). Live
 * properties apply at once; the type count and the population on restart. setAlgorithm() rebuilds
 * it for another algorithm.
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
    private readonly toggleBtn = byId<HTMLButtonElement>('toggleElementBarBtn');
    private readonly chartCard = byId('chartCard');
    private readonly chartTabs = byId('chartTabs');
    private readonly chartChannels = byId('chartChannels');
    private readonly resetBtn = byId<HTMLButtonElement>('chartResetBtn');
    private readonly resetLabel = byId('chartResetLabel');
    private readonly randomBtn = byId<HTMLButtonElement>('chartRandomBtn');
    private readonly picker: ConfigPicker<ElementConfig, ElementSetup>;
    private chart!: ElementChart;
    private editor!: ElementEditor;
    private metric!: ElementMetric;
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
        this.setupChartTools();
        this.setupCollapse();
        this.setAlgorithm();
    }

    selectedTypeCount(): number {
        return parseInt(this.typeCountSlider.value, 10);
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
        this.updateToggleLabel();

        const metrics = buildMetrics(schema);
        this.metric = metrics[0];
        this.chart = new ElementChart(byId('elementChart'), [byId('populationBand'), byId('miniBand')],
            schema, species, this.metric, { onChange: m => liveChange(m.live), onSelect: k => this.select(k) });
        this.editor = new ElementEditor(byId('elementEditor'), schema, species, liveChange);
        this.buildChartTabs(metrics);

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
        this.chart.select(k);
        this.editor.show(k);
    }

    private refresh(): void {
        const selected = this.selectedTypeCount();
        const active = this.sim.activeTypeCount;
        this.typeCountVal.textContent = String(selected);
        this.chart.showCounts(selected, active);
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

    // ---- Chart tabs and tools ----

    /** Default / Random act on the property shown. */
    private setupChartTools(): void {
        const visible = () => Math.max(this.selectedTypeCount(), this.sim.activeTypeCount);
        const changed = (live: boolean) => {
            if (live) this.onSpeciesChange();
            this.editor.refresh(true);
            this.refresh();
        };
        this.resetBtn.addEventListener('click', () => {
            this.sim.species.forEach((s, k) => this.metric.reset(s, k));
            changed(this.metric.live);
        });
        this.randomBtn.addEventListener('click', () => {
            this.metric.randomize(this.sim.species, visible());
            changed(this.metric.live);
        });
    }

    /**
     * One tab per property; a property with several channels (color) also gets a channel
     * switch, which remembers the last channel.
     */
    private buildChartTabs(metrics: readonly ElementMetric[]): void {
        const groups = metricGroups(metrics);
        const channels = this.chartChannels;
        const lastChannel = new Map<string, ElementMetric>();
        this.chartTabs.replaceChildren();
        channels.replaceChildren();

        const tabButton = (parent: HTMLElement, html: string, onClick: () => void): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chart-tab';
            btn.setAttribute('role', 'tab');
            btn.innerHTML = html;
            btn.addEventListener('click', onClick);
            parent.appendChild(btn);
            return btn;
        };
        const groupTabs = groups.map(g => tabButton(this.chartTabs,
            g.unit ? `${g.label}<span class="unit">${g.unit}</span>` : g.label,
            () => show(lastChannel.get(g.label) ?? g.metrics[0])));
        const channelTabs = groups.flatMap(g => g.metrics.length > 1 ? g.metrics : [])
            .map(m => ({ metric: m, btn: tabButton(channels, m.label, () => show(m)) }));

        const show = (metric: ElementMetric) => {
            this.metric = metric;
            lastChannel.set(metric.group, metric);
            groups.forEach((g, i) => groupTabs[i].setAttribute('aria-selected', String(g.label === metric.group)));
            for (const { metric: m, btn } of channelTabs) {
                btn.hidden = m.group !== metric.group;
                btn.setAttribute('aria-selected', String(m === metric));
            }
            channels.hidden = channelTabs.every(({ btn }) => btn.hidden);
            this.chartCard.dataset.metric = metric.id;
            this.chartCard.classList.toggle('population', metric.population);
            this.chartCard.classList.toggle('gradient', metric.track !== undefined);
            this.resetLabel.textContent = metric.resetLabel;
            this.resetBtn.title = metric.resetTitle;
            this.randomBtn.title = metric.randomTitle;
            this.chart.setMetric(metric);
        };
        show(this.metric);
    }

    // ---- Collapse ----

    private updateToggleLabel(): void {
        const open = this.bar.classList.contains('open');
        const what = this.sim.algorithm.particleTypes.labels.title.toLowerCase();
        const label = `${open ? 'Replier' : 'Déplier'} la barre des ${what}`;
        this.toggleBtn.title = label;
        this.toggleBtn.setAttribute('aria-label', label);
        this.toggleBtn.setAttribute('aria-expanded', String(open));
    }

    private setupCollapse(): void {
        const setOpen = (open: boolean) => {
            this.bar.classList.toggle('open', open);
            this.updateToggleLabel();
        };
        setOpen(rememberedOpen(OPEN_KEY, true));
        this.toggleBtn.addEventListener('click', () => {
            const open = !this.bar.classList.contains('open');
            setOpen(open);
            rememberOpen(OPEN_KEY, open);
        });
    }
}
