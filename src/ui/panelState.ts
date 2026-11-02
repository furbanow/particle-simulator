import { PANEL_STATE_KEY } from '../config';

// Open/closed state of sections and effect groups is remembered per browser (best effort:
// storage may be unavailable, e.g. in a private window).
const panelState: Record<string, boolean> = (() => {
    try { return JSON.parse(localStorage.getItem(PANEL_STATE_KEY) ?? 'null') || {}; } catch { return {}; }
})();

function savePanelState(): void {
    try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(panelState)); } catch { /* ignore */ }
}

/** Clicking the head toggles `.open` on the element, except when the click lands on an input in the head. */
export function makeCollapsible(el: HTMLElement, head: HTMLElement, onToggle?: (open: boolean) => void): void {
    head.addEventListener('click', e => {
        if ((e.target as Element).closest('input')) return;
        el.classList.toggle('open');
        onToggle?.(el.classList.contains('open'));
    });
}

function setupPersistentCollapsible(el: HTMLElement, head: HTMLElement, key: string, defaultOpen: boolean): void {
    el.classList.toggle('open', panelState[key] ?? defaultOpen);
    makeCollapsible(el, head, open => { panelState[key] = open; savePanelState(); });
}

/** Sections (`.section[data-key]`) and effect groups (`.effect-card`) of the panel. */
export function setupPanelCollapsibles(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('.section').forEach(sec =>
        setupPersistentCollapsible(sec, sec.querySelector<HTMLElement>('.section-head')!, sec.dataset.key!,
            sec.hasAttribute('data-default-open')));
    root.querySelectorAll<HTMLElement>('.effect-card').forEach(card =>
        setupPersistentCollapsible(card, card.querySelector<HTMLElement>('.card-head')!,
            `fx.${card.querySelector('.card-name')!.textContent}`, false));
}
