import { CHART_KEY_STEP } from '../config';
import { ELEMENT_METRICS, type ElementMetric } from '../elementMetrics';
import { formatShare, populationShares } from '../population';
import type { Species } from '../species';

export interface ElementChartEvents {
    /** The user changed a value of `metric` (drag, keyboard, double-click). */
    onChange(metric: ElementMetric): void;
    /** A column was clicked or focused. */
    onSelect(index: number): void;
}

interface Column {
    el: HTMLElement;
    value: HTMLElement;
    track: HTMLElement;
    fill: HTMLElement;
    label: HTMLButtonElement;
}

/**
 * Equalizer-like bar chart of one species property at a time (population, atomic mass, size,
 * hue, saturation, lightness): one column per species, dragged vertically, with its value above it. The stacked bands
 * always show the population shares. Edits write straight into the shared `Species` objects.
 */
export class ElementChart {
    private readonly columns: Column[];
    private metric: ElementMetric = ELEMENT_METRICS[0];
    private selectedCount = 1;
    private activeCount = 0;

    constructor(container: HTMLElement, private readonly bands: readonly HTMLElement[],
                private readonly species: readonly Species[], private readonly events: ElementChartEvents) {
        this.columns = species.map((_, k) => this.buildColumn(container, k));
    }

    setMetric(metric: ElementMetric): void {
        this.metric = metric;
        this.refresh();
    }

    /** Species shown: selected for the next restart or still running; the others are dimmed when pending. */
    showCounts(selected: number, active: number): void {
        this.selectedCount = selected;
        this.activeCount = active;
        this.refresh();
    }

    select(index: number): void {
        this.columns.forEach((c, k) => c.el.classList.toggle('selected', k === index));
    }

    /** Re-reads the values, colors and symbols. */
    refresh(): void {
        const m = this.metric;
        const shares = populationShares(this.species.map(s => s.weight), this.selectedCount);
        const shown = Math.max(this.selectedCount, this.activeCount);
        const unit = m.unit ? ` ${m.unit}` : '';
        this.columns.forEach((c, k) => {
            const s = this.species[k];
            const text = m.format(s, k < this.selectedCount ? shares[k] : null);
            c.el.hidden = k >= shown;
            c.el.classList.toggle('pending', (k < this.selectedCount) !== (k < this.activeCount));
            c.el.style.setProperty('--col-color', s.color);
            c.value.textContent = text;
            c.fill.style.height = `${m.position(s) * 100}%`;
            c.track.style.background = m.track ? m.track(s, 'to top') : '';
            c.track.title = `Glisser : ${m.label.toLowerCase()} · double-clic : valeur par défaut`;
            c.track.setAttribute('aria-label', `${m.label} : ${s.name}`);
            c.track.setAttribute('aria-valuenow', String(Math.round(m.position(s) * 100)));
            c.track.setAttribute('aria-valuetext', text + unit);
            c.label.textContent = s.symbol;
            c.label.title = s.name;
        });
        for (const band of this.bands) this.renderBand(band, shares);
    }

    private renderBand(band: HTMLElement, shares: number[]): void {
        while (band.children.length < shares.length) band.appendChild(document.createElement('span'));
        while (band.children.length > shares.length) band.lastElementChild!.remove();
        shares.forEach((share, k) => {
            const seg = band.children[k] as HTMLElement;
            seg.style.flexGrow = String(share);
            seg.style.background = this.species[k].color;
            seg.title = `${this.species[k].name} : ${formatShare(share)}`;
        });
    }

    private change(k: number, apply: (m: ElementMetric, s: Species) => boolean): void {
        if (apply(this.metric, this.species[k])) this.events.onChange(this.metric);
    }

    private buildColumn(container: HTMLElement, k: number): Column {
        const el = document.createElement('div');
        el.className = 'chart-col';
        el.innerHTML = `
            <span class="chart-value"></span>
            <div class="chart-track" role="slider" tabindex="0" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100">
                <div class="chart-fill"><span class="chart-handle"></span></div>
            </div>
            <button class="chart-label" type="button"></button>`;
        const column: Column = {
            el,
            value: el.querySelector<HTMLElement>('.chart-value')!,
            track: el.querySelector<HTMLElement>('.chart-track')!,
            fill: el.querySelector<HTMLElement>('.chart-fill')!,
            label: el.querySelector<HTMLButtonElement>('.chart-label')!,
        };
        const { track } = column;

        const positionAt = (clientY: number): number => {
            const rect = track.getBoundingClientRect();
            return 1 - (clientY - rect.top) / rect.height;
        };
        track.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            track.focus();
            track.setPointerCapture(e.pointerId);
            el.classList.add('dragging');
            this.events.onSelect(k);
            this.change(k, (m, s) => m.set(s, positionAt(e.clientY)));
        });
        track.addEventListener('pointermove', e => {
            if (track.hasPointerCapture(e.pointerId)) this.change(k, (m, s) => m.set(s, positionAt(e.clientY)));
        });
        const endDrag = () => el.classList.remove('dragging');
        track.addEventListener('pointerup', endDrag);
        track.addEventListener('pointercancel', endDrag);
        track.addEventListener('dblclick', () => this.change(k, (m, s) => m.reset(s, k)));
        track.addEventListener('keydown', e => {
            const delta = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? CHART_KEY_STEP
                : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -CHART_KEY_STEP
                : null;
            const target = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : null;
            if (delta === null && target === null) return;
            e.preventDefault();
            this.change(k, (m, s) => m.set(s, target ?? m.position(s) + delta!));
        });
        track.addEventListener('focus', () => this.events.onSelect(k));
        column.label.addEventListener('click', () => this.events.onSelect(k));
        container.appendChild(el);
        return column;
    }
}
