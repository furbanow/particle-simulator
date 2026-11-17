export interface ShortcutActions {
    restart(): void;
    togglePause(): void;
    /** Slows down (-1) or speeds up (+1) the animation. */
    changeSpeed(direction: -1 | 1): void;
    /** Moves the zoomed view one step to the right (dx 1) / left (-1) and up (dy 1) / down (-1). */
    move(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void;
    /** Zooms out (-1) or in (+1) around the center of the view. */
    zoom(direction: -1 | 1): void;
    togglePanel(): void;
}

const ARROWS: Record<string, readonly [-1 | 0 | 1, -1 | 0 | 1] | undefined> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

/** +/- zoom, the arrows move the zoomed view and PageUp/PageDown speed up/slow down the animation while the render area has the focus. R restarts, Space pauses/resumes, H hides/shows the panel (ignored while typing in a text field, in a modal or with modifiers). */
export function setupShortcuts(actions: ShortcutActions, renderSurface: HTMLElement): void {
    window.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const arrow = ARROWS[e.key];
        const zoom = e.key === '+' || e.key === '=' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0;
        const speed = e.key === 'PageUp' ? 1 : e.key === 'PageDown' ? -1 : 0;
        if (arrow || zoom || speed) {
            if (e.target !== renderSurface || document.querySelector('.modal:not([hidden])')) return;
            e.preventDefault();
            if (arrow) actions.move(arrow[0], arrow[1]);
            else if (zoom) actions.zoom(zoom > 0 ? 1 : -1);
            else actions.changeSpeed(speed > 0 ? 1 : -1);
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
