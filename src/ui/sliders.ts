import { byId } from './dom';

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

export function syncAllRanges(panel: HTMLElement): void {
    panel.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(r => {
        r.title = 'Double-clic : valeur par défaut';
        syncRange(r);
    });
}

/** Binds `#{name}Slider` to `#{name}Val` (formatted) and applies the value live. */
export function bindSlider(name: string, format: (v: number) => string, apply: (v: number) => void): void {
    const slider = byId<HTMLInputElement>(`${name}Slider`);
    const out = byId(`${name}Val`);
    const update = () => {
        const v = parseFloat(slider.value);
        out.textContent = format(v);
        apply(v);
    };
    slider.addEventListener('input', update);
    update();
}

export const fixed2 = (v: number): string => v.toFixed(2);
export const percent = (v: number): string => `${Math.round(v * 100)} %`;
