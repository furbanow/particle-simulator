export interface ShortcutActions {
    restart(): void;
    togglePause(): void;
    /** Slows down (-1) or speeds up (+1) the animation. */
    changeSpeed(direction: -1 | 1): void;
    /** Zooms out (-1) or in (+1) around the center of the view. */
    zoom(direction: -1 | 1): void;
    togglePanel(): void;
}

/** Up/Down arrows zoom in/out and Left/Right arrows slow down/speed up the animation while the render area has the focus. R restarts, Space pauses/resumes, H hides/shows the panel (ignored while typing in a text field, in a modal or with modifiers). */
export function setupShortcuts(actions: ShortcutActions, renderSurface: HTMLElement): void {
    window.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (e.target !== renderSurface || document.querySelector('.modal:not([hidden])')) return;
            e.preventDefault();
            actions.zoom(e.key === 'ArrowUp' ? 1 : -1);
            return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (e.target !== renderSurface || document.querySelector('.modal:not([hidden])')) return;
            e.preventDefault();
            actions.changeSpeed(e.key === 'ArrowRight' ? 1 : -1);
            return;
        }
        if (e.repeat) return;
        if ((e.target as Element).closest?.('input:not([type=range]), textarea')) return;
        if (document.querySelector('.modal:not([hidden])')) return;
        if (e.key === ' ') {
            if ((e.target as Element).closest?.('select')) return;
            e.preventDefault();             // no page scroll, no click on a focused button
            actions.togglePause();
            return;
        }
        const key = e.key.toLowerCase();
        if (key === 'r') actions.restart();
        else if (key === 'h') actions.togglePanel();
    });
}
