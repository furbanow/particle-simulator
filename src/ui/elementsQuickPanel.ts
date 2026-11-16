import { quickMetrics, quickRowCount, quickValueText } from '../elementsQuickModel';
import { buildMetrics, type ElementMetric } from '../elementMetrics';
import type { Simulation } from '../simulation/Simulation';
import { syncRange } from './sliders';

/** What the simple editor needs from the advanced one, which owns the type count and the config picker. */
export interface ElementsQuickHost {
    selectedTypeCount(): number;
    changeTypeCount(count: number): void;
    /** A type was edited here: apply it (live properties) and refresh the other views. */
    speciesEdited(live: boolean): void;
}

interface SliderRow {
    metric: ElementMetric;
    input: HTMLInputElement;
    out: HTMLElement;
}

interface Row {
    el: HTMLElement;
    color: HTMLInputElement;
    name: HTMLElement;
    sliders: SliderRow[];
}

const PENDING_HINT = 'Appliqué au redémarrage';

/**
 * The Elements tab of the panel: the number of elements, then for each of them its color, atomic
 * mass and size. The finer editing (population, hue / saturation / lightness, configs) is in the
 * advanced modal, opened by a button. Edits write straight into the shared `ParticleType` objects.
 */
export class ElementsQuickPanel {
    readonly element = document.createElement('div');
    private readonly countLabel = document.createElement('span');
    private readonly countVal = document.createElement('span');
    private readonly countSlider = document.createElement('input');
    private readonly hint = document.createElement('div');
    private readonly list = document.createElement('div');
    private rows: Row[] = [];

    constructor(private readonly sim: Simulation, private readonly host: ElementsQuickHost, onAdvanced: () => void) {
        this.countVal.className = 'value-display';
        const field = document.createElement('label');
        field.className = 'field';
        const head = document.createElement('span');
        head.className = 'field-row';
        head.append(this.countLabel, this.countVal);
        this.countSlider.type = 'range';
        this.countSlider.min = '1';
        this.countSlider.step = '1';
        this.countSlider.addEventListener('input', () => this.host.changeTypeCount(parseInt(this.countSlider.value, 10)));
        // Double-click is the panel's "default value" shortcut: not meaningful for a count.
        this.countSlider.addEventListener('dblclick', e => e.stopPropagation());
        this.hint.className = 'hint pending';
        field.append(head, this.countSlider, this.hint);

        const advanced = document.createElement('button');
        advanced.type = 'button';
        advanced.className = 'btn eq-advanced';
        advanced.textContent = 'Avancé…';
        advanced.title = 'Répartition, teinte, saturation, luminosité, configurations';
        advanced.addEventListener('click', onAdvanced);

        this.list.className = 'eq-list';
        this.element.append(field, advanced, this.list);
        this.setAlgorithm();
    }

    /** Rebuilds the rows for the simulation's algorithm. */
    setAlgorithm(): void {
        const schema = this.sim.algorithm.particleTypes;
        this.countLabel.textContent = schema.labels.count;
        this.countSlider.max = String(schema.defaults.length);
        const metrics = quickMetrics(buildMetrics(schema));
        this.rows = this.sim.species.map((_, k) => this.buildRow(k, metrics));
        this.list.replaceChildren(...this.rows.map(r => r.el));
        this.refresh();
    }

    /** Re-reads the type count and the types. */
    refresh(): void {
        const selected = this.host.selectedTypeCount();
        this.countSlider.value = String(selected);
        syncRange(this.countSlider);
        this.countVal.textContent = String(selected);
        this.hint.textContent = selected !== this.sim.activeTypeCount ? PENDING_HINT : '';
        const shown = quickRowCount(selected, this.rows.length);
        this.rows.forEach((row, k) => {
            row.el.hidden = k >= shown;
            const t = this.sim.species[k];
            row.el.style.setProperty('--card-color', t.color);
            if (row.color.value !== t.color) row.color.value = t.color;
            row.name.textContent = `${t.symbol} · ${t.name}`;
            for (const { metric, input, out } of row.sliders) {
                const position = String(metric.position(t));
                if (document.activeElement !== input && input.value !== position) input.value = position;
                syncRange(input);
                out.textContent = quickValueText(metric, metric.format(t, null));
            }
        });
    }

    private buildRow(k: number, metrics: readonly ElementMetric[]): Row {
        const el = document.createElement('section');
        el.className = 'eq-row';
        const head = document.createElement('div');
        head.className = 'eq-head';
        const color = document.createElement('input');
        color.type = 'color';
        color.title = 'Couleur';
        color.setAttribute('aria-label', 'Couleur');
        color.addEventListener('input', () => {
            this.sim.species[k].color = color.value;
            this.host.speciesEdited(true);
        });
        const name = document.createElement('span');
        name.className = 'eq-name';
        head.append(color, name);
        el.appendChild(head);

        const sliders = metrics.map(metric => {
            const field = document.createElement('label');
            field.className = 'field';
            const row = document.createElement('span');
            row.className = 'field-row';
            const label = document.createElement('span');
            label.textContent = metric.label;
            const out = document.createElement('span');
            out.className = 'value-display';
            row.append(label, out);
            const input = document.createElement('input');
            input.type = 'range';
            input.min = '0';
            input.max = '1';
            input.step = 'any';
            input.title = 'Double-clic : valeur par défaut';
            input.addEventListener('input', () => {
                if (metric.set(this.sim.species[k], parseFloat(input.value))) this.host.speciesEdited(metric.live);
                else this.refresh();
            });
            input.addEventListener('dblclick', e => {
                e.stopPropagation();
                if (metric.reset(this.sim.species[k], k)) this.host.speciesEdited(metric.live);
                else this.refresh();
            });
            field.append(row, input);
            el.appendChild(field);
            return { metric, input, out };
        });
        return { el, color, name, sliders };
    }
}
