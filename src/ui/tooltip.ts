import { TOOLTIP_DELAY_MS, TOOLTIP_GAP } from '../config';
import { clamp } from '../util/math';

/** Elements can ask for their tooltip below them; by default, it sits beside `root`, level with them. */
const placeBelow = (el: HTMLElement): boolean => el.dataset.tooltipPlacement === 'below';

function place(tooltip: HTMLElement, el: HTMLElement, root: HTMLElement): void {
    const anchor = el.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = tooltip;
    const left = placeBelow(el) ? anchor.left + (anchor.width - w) / 2 : root.getBoundingClientRect().right + TOOLTIP_GAP;
    const top = placeBelow(el) ? anchor.bottom + TOOLTIP_GAP : anchor.top;
    tooltip.style.left = `${clamp(left, [TOOLTIP_GAP, window.innerWidth - w - TOOLTIP_GAP])}px`;
    tooltip.style.top = `${clamp(top, [TOOLTIP_GAP, window.innerHeight - h - TOOLTIP_GAP])}px`;
}

/**
 * Shows the text of `data-tooltip` while the pointer rests on an element of `root` that has one,
 * or while the keyboard focus is in it. Moving from one to the next is immediate; pressing a
 * slider hides the tooltip until the pointer is released, so it doesn't distract from the value.
 */
export function setupTooltips(root: HTMLElement, tooltip: HTMLElement): void {
    let target: HTMLElement | null = null;
    let timer = 0;
    let pressed = false;

    const hide = () => {
        window.clearTimeout(timer);
        target = null;
        tooltip.classList.remove('visible');
    };
    const show = (el: HTMLElement) => {
        target = el;
        tooltip.textContent = el.dataset.tooltip ?? '';
        place(tooltip, el, root);
        tooltip.classList.add('visible');
    };
    const documented = (node: EventTarget | null): HTMLElement | null =>
        node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;

    root.addEventListener('pointerover', e => {
        if (pressed || e.pointerType === 'touch') return;
        const el = documented(e.target);
        if (el === target) return;
        const alreadyShowing = tooltip.classList.contains('visible');
        hide();
        if (!el) return;
        target = el;
        if (alreadyShowing) show(el);
        else timer = window.setTimeout(() => show(el), TOOLTIP_DELAY_MS);
    });
    root.addEventListener('pointerleave', hide);
    root.addEventListener('pointerdown', () => {
        pressed = true;
        hide();
    });
    window.addEventListener('pointerup', () => { pressed = false; });
    root.addEventListener('focusin', e => {
        const el = documented(e.target);
        if (el && (e.target as Element).matches(':focus-visible')) show(el);
    });
    root.addEventListener('focusout', hide);
    root.addEventListener('scroll', hide, true);
}
