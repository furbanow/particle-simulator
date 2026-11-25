import {
    appliesOnRestart, PANEL_TABS, tabsOf, type PanelTab, type PanelTabId, type ParamDef, type ParamValue,
} from '../simulation/algorithm';
import { t } from '../i18n';
import { paramToSlider, sliderRange, sliderToParam } from '../simulation/params';
import type { Simulation } from '../simulation/Simulation';
import { VISUAL_EFFECTS } from '../visualEffects';
import { rememberedTab, rememberTab } from './panelState';
import { syncAllRanges } from './sliders';

const PENDING_HINT = t('ui.pending');

/** Contents of each tab's 24 x 24 icon. */
const TAB_ICONS: Readonly<Record<PanelTabId, string>> = {
    // A starting flag.
    initial: '<path d="M5 21V4M5 4h13l-3 4 3 4H5"/>',
    // Two overlapping circles: elements (particle species).
    elements: '<circle cx="9" cy="10" r="5"/><circle cx="16" cy="15" r="4"/>',
    // An atom.
    physics: '<circle cx="12" cy="12" r="1.4"/><ellipse cx="12" cy="12" rx="10" ry="4"/>'
        + '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/>'
        + '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
    // A flame.
    fusion: '<path d="M12 3c.5 3 2.2 4.9 3.9 6.6C17.3 11 18 12.7 18 14.5a6 6 0 0 1-12 0c0-1.5.5-2.8 1.4-3.8.3 1.3 1.1 2.1 2.1 2.3-.5-3.5.3-7 2.5-10z"/>',
    // A burst.
    supernova: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
    // A toggle switch: the optional features.
    features: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.2"/>',
    // A pencil drawing a line.
    drawing: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/><path d="M3 21c2.5-1.5 4.5.8 7-.2"/>',
    // A sparkle.
    effects: '<path d="m12 3 1.9 5.6a2 2 0 0 0 1.3 1.3L21 12l-5.8 2.1a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.6a2 2 0 0 0-1.3-1.3L3 12l5.8-2.1a2 2 0 0 0 1.3-1.3z"/>',
};

/** Where the values of some parameters live. */
export interface ParamStore {
    value(key: string): ParamValue | undefined;
    set(key: string, value: ParamValue): void;
}

/** A parameter's control, as paramField() builds it. */
export interface ParamField {
    readonly param: ParamDef;
    /** The labelled field: name, value display, input. */
    readonly element: HTMLElement;
    /** Pushes the control's value into its store and paints its display. */
    update(): void;
    /** Greys the control out (a parameter it depends on makes it useless) or brings it back. */
    setDisabled(disabled: boolean): void;
}

interface Control {
    param: ParamDef;
    store: ParamStore;
    update(): void;
    setDisabled(disabled: boolean): void;
    pending?: HTMLElement;
}

/** What the panel shows besides the parameters. */
export interface ParamPanelOptions {
    /** Content appended to a tab, after its parameters; the tab shows even without parameters. */
    readonly extraContent?: Partial<Record<PanelTabId, HTMLElement>>;
    /** Called with the tab shown, whenever it changes (also when the panel is rebuilt). */
    onTabChange?(id: PanelTabId): void;
}

/**
 * The panel's tabs and their parameters, built from the declarations: the selected algorithm's
 * parameters and the shared visual effects. A tab shows when a parameter is declared in it. Each
 * parameter gets a slider (number), a checkbox (switch) or a select (choice), documented on hover;
 * the ones applied on restart show a hint, and a dot on their tab, while they differ from the
 * running simulation. setAlgorithm() rebuilds everything from the current values.
 */
export class ParamPanel {
    private controls: Control[] = [];
    private tabButtons = new Map<PanelTabId, HTMLButtonElement>();
    private tabPanels = new Map<PanelTabId, HTMLElement>();
    private selected: PanelTabId | null = null;

    constructor(private readonly tabBar: HTMLElement, private readonly content: HTMLElement,
                private readonly sim: Simulation, private readonly effects: ParamStore,
                private readonly options: ParamPanelOptions = {}) {
        this.tabBar.addEventListener('keydown', e => this.moveWithKeyboard(e));
        this.setAlgorithm();
    }

    setAlgorithm(): void {
        const simulationStore: ParamStore = {
            value: key => this.sim.params[key],
            set: (key, value) => this.sim.setParam(key, value),
        };
        const entries = [
            ...this.sim.paramDefs.map(param => ({ param, store: simulationStore })),
            ...VISUAL_EFFECTS.map(param => ({ param, store: this.effects })),
        ];
        const extra = this.options.extraContent ?? {};
        const withParams = new Set(tabsOf(entries.map(e => e.param)).map(t => t.id));
        const tabs = PANEL_TABS.filter(tab => withParams.has(tab.id) || extra[tab.id]);
        this.controls = [];
        this.tabButtons = new Map(tabs.map(tab => [tab.id, this.buildTabButton(tab)]));
        this.tabPanels = new Map(tabs.map(tab => {
            const fields = withSectionTitles(entries.filter(e => e.param.tab === tab.id)
                .map(e => ({ section: e.param.section, element: this.buildControl(e.param, e.store) })));
            const more = extra[tab.id];
            return [tab.id, buildTabPanel(tab, more ? [...fields, more] : fields)];
        }));
        this.tabBar.replaceChildren(...this.tabButtons.values());
        this.content.replaceChildren(...this.tabPanels.values());
        syncAllRanges(this.content);

        // The remembered tab survives an algorithm without it: coming back shows it again.
        const remembered = rememberedTab();
        this.select((tabs.find(t => t.id === remembered) ?? tabs[0]).id);
        for (const control of this.controls) control.update();
    }

    /** Refreshes the pending hints after a restart. */
    afterRestart(): void {
        this.refreshPending();
    }

    private select(id: PanelTabId): void {
        this.selected = id;
        for (const [tab, button] of this.tabButtons) {
            button.setAttribute('aria-selected', String(tab === id));
            button.tabIndex = tab === id ? 0 : -1;
        }
        for (const [tab, panel] of this.tabPanels) panel.hidden = tab !== id;
        this.content.scrollTop = 0;
        this.options.onTabChange?.(id);
    }

    private choose(id: PanelTabId): void {
        this.select(id);
        rememberTab(id);
    }

    /** Arrow keys, Home and End move between the tabs (only the selected one is in the tab order). */
    private moveWithKeyboard(e: KeyboardEvent): void {
        const ids = [...this.tabButtons.keys()];
        const index = this.selected ? ids.indexOf(this.selected) : 0;
        const targets: Record<string, number> = {
            ArrowRight: (index + 1) % ids.length,
            ArrowLeft: (index - 1 + ids.length) % ids.length,
            Home: 0,
            End: ids.length - 1,
        };
        const target = targets[e.key];
        if (target === undefined) return;
        e.preventDefault();
        this.choose(ids[target]);
        this.tabButtons.get(ids[target])?.focus();
    }

    /** Greys out the controls that have no effect with the current value of the parameter they depend on. */
    private refreshDisabled(): void {
        for (const { param, store, setDisabled } of this.controls) {
            const dependency = param.disabledWhen;
            if (dependency) setDisabled(store.value(dependency.param) === dependency.equals);
        }
    }

    /** After a change of a value: the restart hints and the dependent controls. */
    private refresh(): void {
        this.refreshPending();
        this.refreshDisabled();
    }

    private refreshPending(): void {
        const isPending = ({ param, pending }: Control) => pending !== undefined && this.sim.isPending(param.key);
        for (const control of this.controls) {
            if (control.pending) control.pending.textContent = isPending(control) ? PENDING_HINT : '';
        }
        for (const [tab, button] of this.tabButtons) {
            button.classList.toggle('pending', this.controls.some(c => c.param.tab === tab && isPending(c)));
        }
    }

    private buildTabButton(tab: PanelTab): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'panel-tab';
        button.id = tabButtonId(tab.id);
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-label', tab.label);
        button.setAttribute('aria-controls', tabPanelId(tab.id));
        button.dataset.tooltip = tab.label;
        button.dataset.tooltipPlacement = 'below';
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[tab.id]}</svg>`;
        button.addEventListener('click', () => this.choose(tab.id));
        return button;
    }

    private buildControl(param: ParamDef, store: ParamStore): HTMLElement {
        let pending: HTMLElement | undefined;
        const field = paramField(param, store, () => this.refresh());
        if (appliesOnRestart(param)) {
            pending = document.createElement('div');
            pending.className = 'hint pending';
            field.element.appendChild(pending);
        }
        this.controls.push({
            param, pending, store, setDisabled: field.setDisabled,
            update: () => { field.update(); this.refresh(); },
        });
        return field.element;
    }
}

/**
 * The control of a parameter: a slider (number), a checkbox (switch) or a select (choice), showing
 * the store's value (its default when missing) and documented on hover. Every change of the input
 * goes to the store, then `onChange` is called. The display is painted by update().
 */
export function paramField(param: ParamDef, store: ParamStore, onChange: () => void = () => {}): ParamField {
    const field = document.createElement('label');
    field.className = 'field';
    field.dataset.tooltip = param.doc;
    const row = document.createElement('span');
    row.className = 'field-row';
    row.append(param.label);
    field.appendChild(row);

    const value = store.value(param.key);
    let input: HTMLInputElement | HTMLSelectElement;
    let update: () => void;
    switch (param.kind) {
        case 'number': {
            const slider = input = document.createElement('input');
            slider.type = 'range';
            const range = sliderRange(param);
            slider.min = String(range.min);
            slider.max = String(range.max);
            slider.step = String(range.step);
            // The default value is the value attribute: double-click goes back to it.
            slider.defaultValue = String(paramToSlider(param, param.default));
            slider.value = String(paramToSlider(param, typeof value === 'number' ? value : param.default));
            const out = document.createElement('span');
            out.className = 'value-display';
            row.appendChild(out);
            field.appendChild(slider);
            update = () => {
                const v = sliderToParam(param, parseFloat(slider.value));
                store.set(param.key, v);
                out.textContent = param.format(v);
            };
            break;
        }
        case 'boolean': {
            const box = input = document.createElement('input');
            box.type = 'checkbox';
            box.defaultChecked = param.default;
            box.checked = typeof value === 'boolean' ? value : param.default;
            row.appendChild(box);
            update = () => store.set(param.key, box.checked);
            break;
        }
        case 'choice': {
            const select = input = document.createElement('select');
            select.className = 'param-select';
            for (const o of param.options) select.add(new Option(o.label, o.value, o.value === param.default));
            select.value = typeof value === 'string' ? value : param.default;
            row.appendChild(select);
            update = () => store.set(param.key, select.value);
            break;
        }
    }
    input.setAttribute('aria-description', param.doc);
    input.addEventListener(param.kind === 'number' ? 'input' : 'change', () => { update(); onChange(); });
    const setDisabled = (disabled: boolean): void => {
        input.disabled = disabled;
        field.classList.toggle('disabled', disabled);
    };
    return { param, element: field, update, setDisabled };
}

const tabButtonId = (id: PanelTabId): string => `panelTab_${id}`;
const tabPanelId = (id: PanelTabId): string => `panelTabPanel_${id}`;

/** The fields of a tab, with the title of a section before the first field of each run sharing it. */
function withSectionTitles(fields: readonly { section: string | undefined; element: HTMLElement }[]): HTMLElement[] {
    const elements: HTMLElement[] = [];
    let previous: string | undefined;
    for (const { section, element } of fields) {
        if (section && section !== previous) {
            const title = document.createElement('h3');
            title.className = 'param-section';
            title.textContent = section;
            elements.push(title);
        }
        previous = section;
        elements.push(element);
    }
    return elements;
}

function buildTabPanel(tab: PanelTab, fields: readonly HTMLElement[]): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'tab-panel';
    panel.id = tabPanelId(tab.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabButtonId(tab.id));
    const title = document.createElement('h2');
    title.className = 'tab-title';
    title.textContent = tab.label;
    panel.append(title, ...fields);
    return panel;
}
