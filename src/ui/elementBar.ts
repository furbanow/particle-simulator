import { DELETE_CONFIRM_MS, MAX_SPECIES } from '../config';
import type { ElementConfig, ElementConfigStore, ElementSetup } from '../elementConfigs';
import { ELEMENT_METRICS, METRIC_GROUPS, type ElementMetric } from '../elementMetrics';
import { populationShares, splitPopulation } from '../population';
import type { Simulation } from '../simulation/Simulation';
import { byId } from './dom';
import { ElementChart } from './elementChart';
import { ElementEditor } from './elementEditor';
import { rememberedOpen, rememberOpen } from './panelState';
import { syncRange } from './sliders';

export interface ElementBarOptions {
    simulation: Simulation;
    store: ElementConfigStore;
    /** A live species property changed (color, mass, size): refresh the uniforms. */
    onSpeciesChange(): void;
    /** A config was loaded: restart the simulation with it. */
    onLoad(): void;
}

const PENDING_HINT = 'Appliqué au redémarrage';
const UNSAVED_CONFIRM = 'Les modifications de la configuration courante ne sont pas enregistrées. Les abandonner ?';
const OPEN_KEY = 'elementBar';
const SAVE_TITLE = 'Enregistrer dans la configuration';
const READ_ONLY_SAVE_TITLE = 'La configuration par défaut ne peut pas être modifiée : dupliquez-la pour enregistrer vos changements';

/**
 * Top bar dedicated to the particle elements: saved configs (load, new, duplicate, rename,
 * delete, save), element count, a chart of one property at a time (population, atomic mass,
 * size, color) and the editor of the selected element. Colors, masses and sizes apply live;
 * the element count and the population on restart.
 */
export class ElementBar {
    private readonly sim: Simulation;
    private readonly store: ElementConfigStore;
    private readonly bar = byId('element-bar');
    private readonly typeCountSlider = byId<HTMLInputElement>('typeCountSlider');
    private readonly typeCountVal = byId('typeCountVal');
    private readonly hint = byId('elementsHint');
    private readonly configSelect = byId<HTMLSelectElement>('configSelect');
    private readonly configNameInput = byId<HTMLInputElement>('configNameInput');
    private readonly dirtyDot = byId('configDirty');
    private readonly saveBtn = byId<HTMLButtonElement>('saveConfigBtn');
    private readonly deleteBtn = byId<HTMLButtonElement>('deleteConfigBtn');
    private readonly renameBtn = byId<HTMLButtonElement>('renameConfigBtn');
    private readonly chart: ElementChart;
    private readonly editor: ElementEditor;
    private metric: ElementMetric = ELEMENT_METRICS[0];
    private selected = 0;
    private deleteTimer = 0;

    constructor({ simulation, store, onSpeciesChange, onLoad }: ElementBarOptions) {
        this.sim = simulation;
        this.store = store;
        const liveChange = (live: boolean) => {
            if (live) onSpeciesChange();
            this.refresh();
        };
        this.chart = new ElementChart(byId('elementChart'), [byId('populationBand'), byId('miniBand')],
            simulation.species, { onChange: m => liveChange(m.live), onSelect: k => this.select(k) });
        this.editor = new ElementEditor(byId('elementEditor'), simulation.species, k => this.shareOf(k), liveChange);

        this.typeCountSlider.max = String(MAX_SPECIES);
        this.typeCountSlider.addEventListener('input', () => this.refresh());
        this.setupConfigTools(onLoad);
        this.setupChartTabs(onSpeciesChange);
        this.setupCollapse();

        this.apply(store.current);
        this.select(0);
    }

    selectedTypeCount(): number {
        return parseInt(this.typeCountSlider.value, 10);
    }

    /** Refreshes the pending state after a restart. */
    afterRestart(): void {
        this.refresh();
    }

    /** Population share of species k at the next restart (null when it won't be used). */
    private shareOf(k: number): number | null {
        const count = this.selectedTypeCount();
        return k < count ? populationShares(this.sim.species.map(s => s.weight), count)[k] : null;
    }

    /** The state being edited, in the shape stored in configs. */
    private setup(): ElementSetup {
        return { typeCount: this.selectedTypeCount(), species: this.sim.species };
    }

    /** Copies a config into the shared species objects (in place: materials and UI hold references). */
    private apply(config: ElementConfig): void {
        config.species.forEach((s, k) => Object.assign(this.sim.species[k], s));
        this.typeCountSlider.value = String(config.typeCount);
        syncRange(this.typeCountSlider);
        this.editor.refresh(true);
        this.refreshConfigList();
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
        // Keep the editor on a visible element.
        const shown = Math.max(selected, active);
        if (this.selected >= shown) this.select(shown - 1);
        else this.editor.refresh();

        const counts = splitPopulation(this.sim.activeCount, this.sim.species.map(s => s.weight), selected);
        const pending = selected !== active || counts.some((n, k) => n !== this.sim.speciesCounts[k]);
        this.hint.textContent = pending ? PENDING_HINT : '';

        const dirty = this.store.isDirty(this.setup());
        const editable = this.store.canEdit(this.store.current.id);
        this.dirtyDot.hidden = !dirty;
        this.saveBtn.disabled = !dirty || !editable;
        this.saveBtn.title = editable ? SAVE_TITLE : READ_ONLY_SAVE_TITLE;
    }

    // ---- Configs ----

    private refreshConfigList(): void {
        const current = this.store.current;
        this.configSelect.replaceChildren(...this.store.list().map(c => new Option(c.name, c.id, false, c.id === current.id)));
        this.deleteBtn.disabled = !this.store.canRemove(current.id);
        this.deleteBtn.title = this.deleteBtn.disabled ? 'La configuration par défaut ne peut pas être supprimée'
            : 'Supprimer la configuration';
        this.renameBtn.disabled = !this.store.canEdit(current.id);
        this.renameBtn.title = this.renameBtn.disabled ? 'La configuration par défaut ne peut pas être renommée'
            : 'Renommer la configuration';
    }

    /** Asks before throwing away unsaved edits. */
    private confirmDiscard(): boolean {
        return !this.store.isDirty(this.setup()) || window.confirm(UNSAVED_CONFIRM);
    }

    private setupConfigTools(onLoad: () => void): void {
        const load = (config: ElementConfig) => {
            this.apply(config);
            onLoad();
        };

        this.configSelect.addEventListener('change', () => {
            const id = this.configSelect.value;
            if (!this.confirmDiscard()) {
                this.configSelect.value = this.store.current.id;
                return;
            }
            load(this.store.select(id));
        });
        byId('newConfigBtn').addEventListener('click', () => {
            if (this.confirmDiscard()) load(this.store.create());
        });
        byId('duplicateConfigBtn').addEventListener('click', () => {
            this.store.duplicate(this.setup());          // same state: nothing to reload
            this.refreshConfigList();
            this.refresh();
        });
        this.saveBtn.addEventListener('click', () => {
            if (this.store.save(this.setup())) this.refresh();
        });

        // Delete: a first click arms the button, a second one within DELETE_CONFIRM_MS deletes.
        const disarm = () => {
            window.clearTimeout(this.deleteTimer);
            this.deleteBtn.classList.remove('confirm');
            this.refreshConfigList();
        };
        this.deleteBtn.addEventListener('click', () => {
            if (!this.deleteBtn.classList.contains('confirm')) {
                this.deleteBtn.classList.add('confirm');
                this.deleteBtn.title = 'Cliquer à nouveau pour supprimer';
                this.deleteTimer = window.setTimeout(disarm, DELETE_CONFIRM_MS);
                return;
            }
            disarm();
            load(this.store.remove(this.store.current.id));
        });
        this.deleteBtn.addEventListener('blur', disarm);

        // Rename in place: the select is swapped for a text field (Enter / blur commit, Escape cancels).
        const input = this.configNameInput;
        const endRename = (commit: boolean) => {
            if (input.hidden) return;
            if (commit) this.store.rename(this.store.current.id, input.value);
            input.hidden = true;
            this.configSelect.hidden = false;
            this.refreshConfigList();
        };
        this.renameBtn.addEventListener('click', () => {
            input.value = this.store.current.name;
            this.configSelect.hidden = true;
            input.hidden = false;
            input.focus();
            input.select();
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') endRename(true);
            else if (e.key === 'Escape') endRename(false);
        });
        input.addEventListener('blur', () => endRename(true));
    }

    // ---- Chart tabs and tools ----

    /**
     * One tab per property; a property with several channels (color) also gets a channel
     * switch, which remembers the last channel. Default / Random act on the property shown.
     */
    private setupChartTabs(onSpeciesChange: () => void): void {
        const card = byId('chartCard');
        const channels = byId('chartChannels');
        const resetBtn = byId<HTMLButtonElement>('chartResetBtn');
        const resetLabel = byId('chartResetLabel');
        const randomBtn = byId<HTMLButtonElement>('chartRandomBtn');
        const species = this.sim.species;
        const visible = () => Math.max(this.selectedTypeCount(), this.sim.activeTypeCount);
        const changed = (live: boolean) => {
            if (live) onSpeciesChange();
            this.editor.refresh(true);
            this.refresh();
        };
        const lastChannel = new Map<string, ElementMetric>();

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
        const groupTabs = METRIC_GROUPS.map(g => tabButton(byId('chartTabs'),
            g.unit ? `${g.label}<span class="unit">${g.unit}</span>` : g.label,
            () => show(lastChannel.get(g.label) ?? g.metrics[0])));
        const channelTabs = METRIC_GROUPS.flatMap(g => g.metrics.length > 1 ? g.metrics : [])
            .map(m => ({ metric: m, btn: tabButton(channels, m.label, () => show(m)) }));

        const show = (metric: ElementMetric) => {
            this.metric = metric;
            lastChannel.set(metric.group, metric);
            METRIC_GROUPS.forEach((g, i) => groupTabs[i].setAttribute('aria-selected', String(g.label === metric.group)));
            for (const { metric: m, btn } of channelTabs) {
                btn.hidden = m.group !== metric.group;
                btn.setAttribute('aria-selected', String(m === metric));
            }
            channels.hidden = channelTabs.every(({ btn }) => btn.hidden);
            card.dataset.metric = metric.id;
            card.classList.toggle('gradient', metric.track !== undefined);
            resetLabel.textContent = metric.resetLabel;
            resetBtn.title = metric.resetTitle;
            randomBtn.title = metric.randomTitle;
            this.chart.setMetric(metric);
        };
        show(this.metric);

        resetBtn.addEventListener('click', () => {
            species.forEach((s, k) => this.metric.reset(s, k));
            changed(this.metric.live);
        });
        randomBtn.addEventListener('click', () => {
            this.metric.randomize(species, visible());
            changed(this.metric.live);
        });
    }

    // ---- Collapse ----

    private setupCollapse(): void {
        const toggle = byId<HTMLButtonElement>('toggleElementBarBtn');
        const setOpen = (open: boolean) => {
            this.bar.classList.toggle('open', open);
            const label = open ? 'Replier la barre des éléments' : 'Déplier la barre des éléments';
            toggle.title = label;
            toggle.setAttribute('aria-label', label);
            toggle.setAttribute('aria-expanded', String(open));
        };
        setOpen(rememberedOpen(OPEN_KEY, true));
        toggle.addEventListener('click', () => {
            const open = !this.bar.classList.contains('open');
            setOpen(open);
            rememberOpen(OPEN_KEY, open);
        });
    }
}
