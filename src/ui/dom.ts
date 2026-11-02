/** Typed `getElementById` that fails loudly when the markup and the code disagree. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Élément #${id} introuvable`);
    return el as T;
}

/** Replays the element's `.flash` CSS animation. */
export function flash(el: HTMLElement): void {
    el.classList.remove('flash');
    void el.offsetWidth;                    // restart the animation
    el.classList.add('flash');
}

/** Shows a fatal error over the canvas and stops the caller. */
export function fail(message: string): never {
    byId('error').textContent = message;
    throw new Error(message);
}

export const formatInt = (n: number): string => n.toLocaleString('fr-FR');
