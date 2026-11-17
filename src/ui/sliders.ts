import { t } from '../i18n';
/** --p (0..1) drives the filled part of the WebKit track (Firefox uses ::-moz-range-progress). */
export function syncRange(input: HTMLInputElement): void {
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    input.style.setProperty('--p', String(max > min ? (parseFloat(input.value) - min) / (max - min) : 0));
}

/** Filled tracks follow every slider of the panel; double-click resets a slider to its default. */
export function setupSliders(panel: HTMLElement): void {
    panel.addEventListener('input', e => {
        const target = e.target as HTMLInputElement;
        if (target.type === 'range') syncRange(target);
    });
    panel.addEventListener('dblclick', e => {
        const range = (e.target as Element).closest<HTMLInputElement>('input[type=range]');
        if (!range) return;
        range.value = range.defaultValue;
        range.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

export function syncAllRanges(root: HTMLElement): void {
    root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(syncRange);
}

/** Says on hover that double-click resets the sliders of `root` (the panel's show their documentation instead). */
export function titleResettableRanges(root: HTMLElement): void {
    root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(r => { r.title = t('ui.doubleClickDefault'); });
}
