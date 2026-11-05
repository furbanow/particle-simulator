import { PANEL_STATE_KEY, PANEL_TAB_KEY } from '../config';

// Open/closed state of the bars and the selected panel tab are remembered per browser (best
// effort: storage may be unavailable, e.g. in a private window).
const panelState: Record<string, boolean> = (() => {
    try { return JSON.parse(localStorage.getItem(PANEL_STATE_KEY) ?? 'null') || {}; } catch { return {}; }
})();

function savePanelState(): void {
    try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(panelState)); } catch { /* ignore */ }
}

/** Remembered open state of `key`, or `defaultOpen` the first time. */
export const rememberedOpen = (key: string, defaultOpen: boolean): boolean => panelState[key] ?? defaultOpen;

export function rememberOpen(key: string, open: boolean): void {
    panelState[key] = open;
    savePanelState();
}

export function rememberedTab(): string | null {
    try { return localStorage.getItem(PANEL_TAB_KEY); } catch { return null; }
}

export function rememberTab(id: string): void {
    try { localStorage.setItem(PANEL_TAB_KEY, id); } catch { /* ignore */ }
}
