import { cleanName } from '../elementConfigs';
import { METRIC_GROUPS, type ElementMetric, type MetricGroup } from '../elementMetrics';
import { speciesDensity, type Species } from '../species';
import { syncRange } from './sliders';

const SYMBOL_MAX_LENGTH = 3;

/** Sets an input's value only when it differs, so the caret doesn't jump while typing. */
function setValue(input: HTMLInputElement, value: string): void {
    if (input.value !== value) input.value = value;
}

interface MetricField {
    metric: ElementMetric;
    input: HTMLInputElement;
    out: HTMLElement;
}

/**
 * Detail editor of one species: color, name and symbol, then one slider per property, the same
 * properties as the chart (population, atomic mass, size, and the color as hue / saturation /
 * lightness rows). Each input only writes its own field into the shared `Species` object, so
 * the exact default values survive until the user moves that slider. Double-click on a slider
 * restores the element of the periodic table at that rank.
 */
export class ElementEditor {
    private index = 0;
    private readonly colorInput: HTMLInputElement;
    private readonly nameInput: HTMLInputElement;
    private readonly symbolInput: HTMLInputElement;
    private readonly colorOut: HTMLElement[] = [];
    private readonly density: HTMLElement;
    private readonly fields: MetricField[] = [];

    /**
     * `share(k)` is the population share of species k (null when it is not selected);
     * `onChange(live)` follows every edit, `live` when the running simulation must be updated.
     */
    constructor(private readonly container: HTMLElement, private readonly species: readonly Species[],
                private readonly share: (index: number) => number | null,
                private readonly onChange: (live: boolean) => void) {
        container.insertAdjacentHTML('beforeend', `
            <div class="editor-head">
                <input type="color" title="Couleur">
                <input type="text" class="editor-name" title="Nom" aria-label="Nom" spellcheck="false">
                <input type="text" class="editor-symbol" maxlength="${SYMBOL_MAX_LENGTH}" title="Symbole" aria-label="Symbole" spellcheck="false">
            </div>`);
        this.colorInput = container.querySelector<HTMLInputElement>('input[type=color]')!;
        this.nameInput = container.querySelector<HTMLInputElement>('.editor-name')!;
        this.symbolInput = container.querySelector<HTMLInputElement>('.editor-symbol')!;
        for (const group of METRIC_GROUPS) {
            if (group.metrics.length === 1) this.buildField(group.metrics[0]);
            else this.buildGroup(group);
        }
        container.insertAdjacentHTML('beforeend', '<div class="editor-readout">Densité <span></span></div>');
        this.density = container.querySelector<HTMLElement>('.editor-readout span')!;

        this.colorInput.addEventListener('input', () => {
            this.current.color = this.colorInput.value;
            onChange(true);
        });
        // Names: an empty field is allowed while typing, and reverts to the previous name on commit.
        this.nameInput.addEventListener('input', () => {
            this.current.name = cleanName(this.nameInput.value) || this.current.name;
            onChange(false);
        });
        this.symbolInput.addEventListener('input', () => {
            this.current.symbol = cleanName(this.symbolInput.value, SYMBOL_MAX_LENGTH) || this.current.symbol;
            onChange(false);
        });
        for (const field of [this.nameInput, this.symbolInput]) {
            field.addEventListener('change', () => this.refresh(true));
            field.addEventListener('keydown', e => { if (e.key === 'Enter') field.blur(); });
        }
        this.refresh(true);
    }

    private get current(): Species {
        return this.species[this.index];
    }

    show(index: number): void {
        this.index = index;
        this.refresh(true);
    }

    /**
     * Re-reads the species. Fields being edited are left alone unless `force` is set: text
     * fields keep the caret, sliders keep their own position (value -> position isn't exact
     * after rounding, e.g. atomic masses).
     */
    refresh(force = false): void {
        const s = this.current;
        const editing = (input: HTMLInputElement) => !force && document.activeElement === input;
        this.container.style.setProperty('--card-color', s.color);
        setValue(this.colorInput, s.color);
        if (!editing(this.nameInput)) setValue(this.nameInput, s.name);
        if (!editing(this.symbolInput)) setValue(this.symbolInput, s.symbol);
        for (const out of this.colorOut) out.textContent = s.color;
        const share = this.share(this.index);
        for (const { metric, input, out } of this.fields) {
            if (!editing(input)) setValue(input, String(metric.position(s)));
            out.textContent = metric.format(s, share) + (metric.unit ? ` ${metric.unit}` : '');
            if (metric.track) input.style.setProperty('--track-gradient', metric.track(s, 'to right'));
            syncRange(input);
        }
        this.density.textContent = `ρ ${speciesDensity(s).toFixed(2)}`;
    }

    private rangeHtml(metric: ElementMetric): string {
        return `<input type="range" min="0" max="1" step="${metric.step}"${metric.track ? ' class="gradient"' : ''}>`;
    }

    /** One property: a label, its value and a full-width slider. */
    private buildField(metric: ElementMetric): void {
        const label = document.createElement('label');
        label.className = 'field';
        label.innerHTML = `
            <span class="field-row">${metric.label} <span class="value-display"></span></span>
            ${this.rangeHtml(metric)}`;
        this.container.appendChild(label);
        this.wire(metric, label.querySelector('input')!, label.querySelector<HTMLElement>('.value-display')!);
    }

    /** Several channels of one property (color): the property value, then a compact row per channel. */
    private buildGroup(group: MetricGroup): void {
        const el = document.createElement('div');
        el.className = 'field';
        el.innerHTML = `
            <span class="field-row">${group.label} <span class="value-display"></span></span>
            <div class="channel-grid">${group.metrics.map(m => `
                <label><span class="channel-name">${m.label}</span>${this.rangeHtml(m)}<span class="channel-value"></span></label>`).join('')}
            </div>`;
        this.container.appendChild(el);
        this.colorOut.push(el.querySelector<HTMLElement>('.value-display')!);
        const rows = el.querySelectorAll('label');
        group.metrics.forEach((m, i) =>
            this.wire(m, rows[i].querySelector('input')!, rows[i].querySelector<HTMLElement>('.channel-value')!));
    }

    private wire(metric: ElementMetric, input: HTMLInputElement, out: HTMLElement): void {
        const changed = (didChange: boolean) => {
            if (didChange) this.onChange(metric.live);
            this.refresh();
        };
        input.addEventListener('input', () => changed(metric.set(this.current, parseFloat(input.value))));
        // Handled here (and not by the generic slider double-click) to restore the exact value.
        input.addEventListener('dblclick', e => {
            e.stopPropagation();
            changed(metric.reset(this.current, this.index));
            this.refresh(true);
        });
        this.fields.push({ metric, input, out });
    }
}
