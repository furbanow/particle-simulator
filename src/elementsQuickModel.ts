import type { ElementMetric } from './elementMetrics';

/** The properties the panel's simple editor offers as sliders, in display order. */
export const QUICK_METRIC_IDS = ['mass', 'size'] as const;

/** The metrics of `all` shown as sliders in the simple editor (those a schema doesn't declare are left out). */
export function quickMetrics(all: readonly ElementMetric[]): ElementMetric[] {
    return QUICK_METRIC_IDS.flatMap(id => all.filter(m => m.id === id));
}

/** Slider text of a metric: its value and its unit. */
export function quickValueText(metric: ElementMetric, text: string): string {
    return metric.unit ? `${text} ${metric.unit}` : text;
}

/** Elements listed by the simple editor: those selected for the next restart. */
export function quickRowCount(selected: number, available: number): number {
    return Math.max(0, Math.min(selected, available));
}
