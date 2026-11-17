import { DARK_MATTER_PREVIEW_MS, DARK_MATTER_TEXT_MAX, DARK_MATTER_UPDATE_MS } from '../config';
import {
    cloneDarkMatter, DARK_MATTER_PARAM as P, DARK_MATTER_PARAMS, darkMatterMode, darkMatterNumber, defaultDarkMatter,
    sanitizeDarkMatterSettings, type DarkMatterGroup, type DarkMatterSettings,
} from '../darkMatter';
import { t } from '../i18n';
import type { ParamValue } from '../simulation/algorithm';
import type { DarkMatterField } from '../simulation/darkMatter/DarkMatterField';
import { canvasTransform, screenToCanvas, type ViewState } from '../view';
import { MaskCanvas, type MaskPoint } from './darkMatter/maskCanvas';
import { paramField, type ParamField, type ParamStore } from './paramPanel';
import { syncAllRanges } from './sliders';

export interface DarkMatterPanelTargets {
    field: DarkMatterField;
    /** The simulation area: the mask preview is laid over it. */
    container: HTMLElement;
    /** Where the mouse draws (the simulation canvas). */
    surface: HTMLElement;
    /** The visual zoom now, and a subscription to its changes. */
    getView: () => ViewState;
    onViewChange: (listener: (view: ViewState) => void) => void;
}

const GROUP_ORDER: readonly DarkMatterGroup[] = ['gravity', 'source', 'draw', 'image', 'text'];
const GROUP_TITLES: Partial<Record<DarkMatterGroup, string>> = {
    gravity: t('darkMatter.group.gravity'),
    source: t('darkMatter.group.mask'),
};
const GRAVITY_KEYS: ReadonlySet<string> = new Set([P.strength, P.softening]);

interface Stroke {
    pointerId: number;
    last: MaskPoint;
    erase: boolean;
}

/**
 * The content of the panel's dark matter tab, and the mask it edits: gravity settings, the source of
 * the mask and the settings of that source. The mask is drawn with the mouse on the simulation
 * while the tab is shown in draw mode, imported from an image or written as a text. Its preview
 * shows while it changes and fades DARK_MATTER_PREVIEW_MS after the last change. Every new mask goes
 * to the dark matter field (at most every DARK_MATTER_UPDATE_MS while drawing).
 */
export class DarkMatterPanel {
    readonly element = document.createElement('div');
    private settings = defaultDarkMatter();
    private readonly mask: MaskCanvas;
    private readonly store: ParamStore = {
        value: key => this.settings.params[key],
        set: (key, value) => this.set(key, value),
    };
    private groups = new Map<DarkMatterGroup, HTMLElement>();
    private fileName = document.createElement('span');
    private tabOpen = false;
    private size = { width: 1, height: 1 };
    private stroke: Stroke | null = null;
    private renderQueued = false;
    private lastCommit = 0;
    private commitTimer: number | undefined;
    private hideTimer: number | undefined;

    constructor(private readonly targets: DarkMatterPanelTargets) {
        this.element.className = 'dark-matter';
        this.mask = new MaskCanvas(() => this.renderSoon());
        targets.container.appendChild(this.mask.canvas);
        this.mask.canvas.style.transformOrigin = '0 0';
        targets.onViewChange(() => this.applyView());
        this.listenToPointer(targets.surface);
        this.build();
    }

    /** The settings, as saved in simulation configs. */
    values(): DarkMatterSettings {
        return cloneDarkMatter(this.settings);
    }

    /** Applies saved settings (the drawing and the image stay: they are not saved). */
    apply(settings: DarkMatterSettings): void {
        this.settings = sanitizeDarkMatterSettings(settings);
        this.build();
    }

    /** Follows the simulation area (CSS px). */
    resize(width: number, height: number): void {
        this.mask.resize(width, height);
        this.size = { width, height };
        this.applyView();
        this.render();
    }

    /** Lays the preview over the zoomed view. */
    private applyView(): void {
        const { width, height } = this.size;
        this.mask.canvas.style.transform = canvasTransform(this.targets.getView(), width, height);
    }

    /** Whether the dark matter tab is shown: the mouse draws only then (in draw mode). */
    setTabOpen(open: boolean): void {
        this.tabOpen = open;
        this.updateDrawing();
    }

    // ---- Settings ----

    private set(key: string, value: ParamValue): void {
        this.settings.params[key] = value;
        const { field } = this.targets;
        if (key === P.strength) field.setStrength(darkMatterNumber(this.settings, P.strength));
        else if (key === P.softening) field.setSoftening(darkMatterNumber(this.settings, P.softening));
        else if (key === P.mode) {
            this.showMode();
            this.updateDrawing();
            this.renderSoon();
        } else if (key !== P.brushSize && key !== P.brushFlow) {
            this.renderSoon();
        }
    }

    /** Rebuilds the tab from the settings; every value reaches the field. */
    private build(): void {
        const fields: ParamField[] = [];
        this.groups = new Map(GROUP_ORDER.map(group => {
            const section = document.createElement('div');
            section.className = 'dm-group';
            const title = GROUP_TITLES[group];
            if (title) {
                const h = document.createElement('h3');
                h.className = 'dm-subtitle';
                h.textContent = title;
                section.appendChild(h);
            }
            for (const param of DARK_MATTER_PARAMS.filter(p => p.group === group)) {
                // A change shows the mask, but a change of the gravity only matters to the particles.
                const field = paramField(param, this.store, GRAVITY_KEYS.has(param.key) ? undefined : () => this.reveal());
                fields.push(field);
                section.appendChild(field.element);
            }
            return [group, section];
        }));
        this.groups.get('draw')?.prepend(this.drawTools());
        this.groups.get('image')?.prepend(this.imageTools());
        this.groups.get('text')?.prepend(this.textField());
        this.element.replaceChildren(...this.groups.values());
        syncAllRanges(this.element);
        for (const field of fields) field.update();     // paints the values, sends them to the field
        this.showMode();
        this.updateDrawing();
    }

    private showMode(): void {
        const mode = darkMatterMode(this.settings);
        for (const [group, section] of this.groups) {
            if (group === 'draw' || group === 'image' || group === 'text') section.hidden = group !== mode;
        }
    }

    private drawTools(): HTMLElement {
        const hint = document.createElement('p');
        hint.className = 'hint dm-hint';
        hint.textContent = t('darkMatter.draw.hint');
        const clear = button(t('darkMatter.draw.clear'), () => {
            this.mask.clearDrawing();
            this.render();
            this.reveal();
        });
        const tools = document.createElement('div');
        tools.className = 'dm-tools';
        tools.append(hint, clear);
        return tools;
    }

    private imageTools(): HTMLElement {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.value = '';                       // the same file can be picked again
            if (file) this.importImage(file);
        });
        const pick = button(t('darkMatter.image.import'), () => input.click());
        if (!this.fileName.textContent) this.fileName.textContent = t('darkMatter.image.none');
        this.fileName.className = 'dm-file-name';
        const row = document.createElement('div');
        row.className = 'dm-file-row';
        row.dataset.tooltip = t('darkMatter.image.tooltip');
        row.append(pick, this.fileName, input);
        return row;
    }

    private importImage(file: File): void {
        createImageBitmap(file).then(image => {
            this.mask.setImage(image);
            this.fileName.textContent = file.name;
            this.fileName.title = file.name;
            this.render();
            this.reveal();
        }, () => {
            this.fileName.textContent = t('darkMatter.image.error');
        });
    }

    private textField(): HTMLElement {
        const field = document.createElement('label');
        field.className = 'field';
        field.dataset.tooltip = t('darkMatter.text.tooltip');
        const row = document.createElement('span');
        row.className = 'field-row';
        row.textContent = t('darkMatter.text.label');
        const area = document.createElement('textarea');
        area.className = 'dm-textarea';
        area.rows = 3;
        area.maxLength = DARK_MATTER_TEXT_MAX;
        area.spellcheck = false;
        area.value = this.settings.text;
        area.addEventListener('input', () => {
            this.settings.text = area.value;
            this.renderSoon();
            this.reveal();
        });
        field.append(row, area);
        return field;
    }

    // ---- Mask ----

    private renderSoon(): void {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            this.render();
        });
    }

    private render(): void {
        this.mask.render(this.settings);
        this.commit();
    }

    /** Sends the mask to the dark matter field. */
    private commit(): void {
        window.clearTimeout(this.commitTimer);
        this.commitTimer = undefined;
        this.lastCommit = performance.now();
        const { width, height } = this.mask;
        if (width === 0 || height === 0) return;
        this.targets.field.setMask(this.mask.pixels(), width, height);
    }

    /** commit(), at most every DARK_MATTER_UPDATE_MS (the last change is always sent). */
    private commitSoon(): void {
        if (this.commitTimer !== undefined) return;
        const wait = DARK_MATTER_UPDATE_MS - (performance.now() - this.lastCommit);
        if (wait <= 0) this.commit();
        else this.commitTimer = window.setTimeout(() => this.commit(), wait);
    }

    /** Shows the mask, and hides it DARK_MATTER_PREVIEW_MS after the last call. */
    private reveal(): void {
        this.mask.canvas.classList.add('visible');
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => this.mask.canvas.classList.remove('visible'), DARK_MATTER_PREVIEW_MS);
    }

    // ---- Drawing with the mouse ----

    private get drawing(): boolean {
        return this.tabOpen && darkMatterMode(this.settings) === 'draw';
    }

    private updateDrawing(): void {
        this.targets.container.classList.toggle('dark-matter-drawing', this.drawing);
        if (!this.drawing) this.stroke = null;
    }

    private listenToPointer(surface: HTMLElement): void {
        surface.addEventListener('contextmenu', e => { if (this.drawing) e.preventDefault(); });
        surface.addEventListener('pointerdown', e => {
            if (!this.drawing || this.stroke || (e.button !== 0 && e.button !== 2)) return;
            e.preventDefault();
            surface.setPointerCapture(e.pointerId);
            this.stroke = { pointerId: e.pointerId, last: this.pointOf(e, surface), erase: e.button === 2 || e.shiftKey };
            this.paint(null, this.stroke.last);
        });
        surface.addEventListener('pointermove', e => {
            const stroke = this.stroke;
            if (!stroke || e.pointerId !== stroke.pointerId) return;
            // Coalesced events keep fast strokes smooth.
            for (const event of e.getCoalescedEvents?.() ?? [e]) {
                const point = this.pointOf(event, surface);
                this.paint(stroke.last, point);
                stroke.last = point;
            }
        });
        const end = (e: PointerEvent) => {
            if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
            this.stroke = null;
            this.commit();
        };
        surface.addEventListener('pointerup', end);
        surface.addEventListener('pointercancel', end);
    }

    /** The event's position in the canvas coordinates of the world (the zoom undone). */
    private pointOf(e: PointerEvent, surface: HTMLElement): MaskPoint {
        const box = surface.getBoundingClientRect();
        const { width, height } = this.size;
        return screenToCanvas(this.targets.getView(), { x: e.clientX - box.left, y: e.clientY - box.top }, width, height);
    }

    private paint(from: MaskPoint | null, to: MaskPoint): void {
        if (!this.stroke) return;
        const s = this.settings;
        this.mask.stroke(from, to, darkMatterNumber(s, P.brushSize) / this.targets.getView().zoom, darkMatterNumber(s, P.brushFlow) / 100, this.stroke.erase);
        this.mask.render(s);
        this.commitSoon();
        this.reveal();
    }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
}
