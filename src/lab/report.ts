import type { JsonValue, LabResults, ScenarioResult } from './types';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
    const created = document.createElement(tag);
    created.textContent = text;
    if (className) created.className = className;
    return created;
};

/** Compact one-line rendering of the scalar metrics of a result (the full JSON is below the table). */
export function summaryOf(metrics: Record<string, JsonValue>): string {
    return Object.entries(metrics)
        .filter(([, value]) => typeof value !== 'object' || value === null)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join('  ');
}

/** Appends a row to the results table. */
export function appendRow(table: HTMLTableSectionElement, result: ScenarioResult): void {
    const row = table.insertRow();
    row.className = `status-${result.status}`;
    row.insertCell().append(element('span', result.status.toUpperCase(), 'badge'));
    row.insertCell().textContent = result.id;
    row.insertCell().textContent = result.title;
    row.insertCell().textContent = `${result.durationMs} ms`;
    const cell = row.insertCell();
    cell.append(element('div', result.details.split('\n')[0]));
    const summary = summaryOf(result.metrics);
    if (summary) cell.append(element('div', summary, 'metrics'));
}

/** Shows the final JSON, the same object as window.__labResults. */
export function showJson(target: HTMLElement, results: LabResults): void {
    target.textContent = JSON.stringify(results, null, 2);
}
