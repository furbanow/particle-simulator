export interface ShortcutActions {
    restart(): void;
    togglePanel(): void;
}

/** R restarts, H hides/shows the panel (ignored while typing in a text field or with modifiers). */
export function setupShortcuts(actions: ShortcutActions): void {
    window.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        if ((e.target as Element).closest?.('input:not([type=range]), textarea')) return;
        const key = e.key.toLowerCase();
        if (key === 'r') actions.restart();
        else if (key === 'h') actions.togglePanel();
    });
}
