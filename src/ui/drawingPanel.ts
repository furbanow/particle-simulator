import {
    DRAWING_ATTRACTOR_TINT, DRAWING_PREVIEW_MS, DRAWING_REPELLER_TINT, DRAWING_TEXT_MAX, DRAWING_UPDATE_MS,
} from '../config';
import {
    cloneDrawing, DRAWING_KINDS, DRAWING_PARAM as P, DRAWING_PARAMS, drawingMode, drawingNumber, defaultDrawing,
    sanitizeDrawingSettings, type DrawingGroup, type DrawingKind, type DrawingSettings,
} from '../drawing';
import { t } from '../i18n';
import type { ParamDef, ParamValue } from '../simulation/algorithm';
import type { DrawingField } from '../simulation/drawing/DrawingField';
import { canvasTransform, screenToCanvas, type ViewState } from '../view';
import { MaskCanvas, type MaskPoint } from './drawing/maskCanvas';
import { paramField, type ParamField, type ParamStore } from './paramPanel';
import { syncAllRanges } from './sliders';

export interface DrawingPanelTargets {
    field: DrawingField;
    /** The simulation area: the mask previews are laid over it. */
    container: HTMLElement;
    /** Where the mouse draws (the simulation canvas). */
    surface: HTMLElement;
    /** The visual zoom now, and a subscription to its changes. */
    getView: () => ViewState;
    onViewChange: (listener: (view: ViewState) => void) => void;
}

const GROUP_ORDER: readonly DrawingGroup[] = ['gravity', 'source', 'draw', 'image', 'text'];
const GROUP_TITLES: Partial<Record<DrawingGroup, string>> = {
    gravity: t('drawing.group.gravity'),
    source: t('drawing.group.mask'),
};
const KIND_LABELS: Record<DrawingKind, string> = {
    attractor: t('drawing.kind.attractor'),
    repeller: t('drawing.kind.repeller'),
};
const CLEAR_KIND_LABELS: Record<DrawingKind, string> = {
    attractor: t('drawing.clear.attractor'),
    repeller: t('drawing.clear.repeller'),
};
const KIND_TINTS: Record<DrawingKind, readonly [number, number, number]> = {
    attractor: DRAWING_ATTRACTOR_TINT,
    repeller: DRAWING_REPELLER_TINT,
};
const KIND_KEY = 'kind';
const KIND_PARAM: ParamDef = {
    kind: 'choice', key: KIND_KEY, tab: 'drawing', label: t('drawing.param.kind.label'), default: 'attractor',
    options: DRAWING_KINDS.map(value => ({ value, label: KIND_LABELS[value] })),
    doc: t('drawing.param.kind.doc'),
};
const GRAVITY_KEYS: ReadonlySet<string> = new Set([P.strength, P.softening]);

interface Stroke {
    pointerId: number;
    last: MaskPoint;
    erase: boolean;
}

/** The kind and the setting a prefixed key (`repeller.strength`) stands for. */
function splitKey(key: string): { kind: DrawingKind; name: string } | null {
    const kind = DRAWING_KINDS.find(k => key.startsWith(`${k}.`));
    return kind ? { kind, name: key.slice(kind.length + 1) } : null;
}

/**
 * The content of the panel's drawing tab, and the masks it edits. Each kind of drawing (attractor,
 * repeller) has its own mask and settings; the kind selector chooses the one shown and drawn on,
 * both stay active. A mask is drawn with the mouse on the simulation while the tab is shown in draw
 * mode, imported from an image or written as a text. The previews show while a mask changes and
 * fade DRAWING_PREVIEW_MS after the last change. Every new mask goes to the drawing field (at most
 * every DRAWING_UPDATE_MS while drawing).
 */
export class DrawingPanel {
    readonly element = document.createElement('div');
    private settings = defaultDrawing();
    private kind: DrawingKind = 'attractor';
    private readonly masks: Record<DrawingKind, MaskCanvas>;
    private readonly store: ParamStore = {
        value: key => key === KIND_KEY ? this.kind : this.settings.params[key],
        set: (key, value) => key === KIND_KEY ? this.selectKind(value) : this.set(key, value),
    };
    private groups = new Map<DrawingGroup, HTMLElement>();
    private readonly fileNames: Record<DrawingKind, string> = { attractor: '', repeller: '' };
    private fileName = document.createElement('span');
    private tabOpen = false;
    private size = { width: 1, height: 1 };
    private stroke: Stroke | null = null;
    private readonly pendingRender = new Set<DrawingKind>();
    private readonly lastCommit: Record<DrawingKind, number> = { attractor: 0, repeller: 0 };
    private readonly commitTimers: Partial<Record<DrawingKind, number>> = {};
    private hideTimer: number | undefined;

    constructor(private readonly targets: DrawingPanelTargets) {
        this.element.className = 'drawing';
        this.masks = {
            attractor: new MaskCanvas('attractor', () => this.renderSoon('attractor')),
            repeller: new MaskCanvas('repeller', () => this.renderSoon('repeller')),
        };
        for (const mask of Object.values(this.masks)) {
            targets.container.appendChild(mask.canvas);
            mask.canvas.style.transformOrigin = '0 0';
        }
        targets.onViewChange(() => this.applyView());
        this.listenToPointer(targets.surface);
        this.build();
    }

    /** The settings, as saved in simulation configs. */
    values(): DrawingSettings {
        return cloneDrawing(this.settings);
    }

    /** Applies saved settings (the drawings and the images stay: they are not saved). */
    apply(settings: DrawingSettings): void {
        this.settings = sanitizeDrawingSettings(settings);
        this.build();
    }

    /** Follows the simulation area (CSS px). */
    resize(width: number, height: number): void {
        this.size = { width, height };
        for (const kind of DRAWING_KINDS) {
            this.masks[kind].resize(width, height);
            this.render(kind);
        }
        this.applyView();
    }

    /** Lays the previews over the zoomed view. */
    private applyView(): void {
        const { width, height } = this.size;
        const transform = canvasTransform(this.targets.getView(), width, height);
        for (const mask of Object.values(this.masks)) mask.canvas.style.transform = transform;
    }

    /** Whether the drawing tab is shown: the mouse draws only then (in draw mode). */
    setTabOpen(open: boolean): void {
        this.tabOpen = open;
        this.updateDrawing();
    }

    // ---- Settings ----

    private selectKind(value: ParamValue): void {
        // The selector's update() sends its current value back here: only a real change rebuilds.
        if ((value !== 'attractor' && value !== 'repeller') || value === this.kind) return;
        this.kind = value;
        this.build();
        this.reveal();
    }

    private set(key: string, value: ParamValue): void {
        this.settings.params[key] = value;
        const target = splitKey(key);
        if (!target) return;
        const { kind, name } = target;
        const { field } = this.targets;
        if (name === P.strength) field.setStrength(kind, drawingNumber(this.settings, kind, P.strength));
        else if (name === P.softening) field.setSoftening(kind, drawingNumber(this.settings, kind, P.softening));
        else if (name === P.mode) {
            this.showMode();
            this.updateDrawing();
            this.renderSoon(kind);
        } else if (name !== P.brushSize && name !== P.brushFlow) {
            this.renderSoon(kind);
        }
    }

    /** Rebuilds the tab from the settings and the selected kind; every value reaches the field. */
    private build(): void {
        const kind = this.kind;
        const fields: ParamField[] = [];
        this.groups = new Map(GROUP_ORDER.map(group => {
            const section = document.createElement('div');
            section.className = 'dw-group';
            const title = GROUP_TITLES[group];
            if (title) {
                const h = document.createElement('h3');
                h.className = 'dw-subtitle';
                h.textContent = title;
                section.appendChild(h);
            }
            for (const param of DRAWING_PARAMS[kind].filter(p => p.group === group)) {
                // A change shows the masks, but a change of the gravity only matters to the particles.
                const field = paramField(param, this.store, GRAVITY_KEYS.has(splitKey(param.key)?.name ?? '') ? undefined : () => this.reveal());
                fields.push(field);
                section.appendChild(field.element);
            }
            return [group, section];
        }));
        this.groups.get('draw')?.prepend(this.drawTools());
        this.groups.get('image')?.prepend(this.imageTools());
        this.groups.get('text')?.prepend(this.textField());
        this.element.dataset.kind = kind;
        this.element.replaceChildren(this.toolbar(), ...this.groups.values());
        syncAllRanges(this.element);
        for (const field of fields) field.update();     // paints the values
        // Both kinds act whichever is shown: their gravity and masks reach the field.
        for (const k of DRAWING_KINDS) {
            this.targets.field.setStrength(k, drawingNumber(this.settings, k, P.strength));
            this.targets.field.setSoftening(k, drawingNumber(this.settings, k, P.softening));
            this.renderSoon(k);
        }
        this.showMode();
        this.updateDrawing();
    }

    /** The clear buttons and the kind selector, above the settings of the selected kind. */
    private toolbar(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'dw-group dw-toolbar';
        const clear = document.createElement('div');
        clear.className = 'dw-clear';
        clear.append(
            button(t('drawing.clear.all'), () => this.clear(DRAWING_KINDS)),
            button(CLEAR_KIND_LABELS[this.kind], () => this.clear([this.kind])),
        );
        const select = paramField(KIND_PARAM, this.store);
        select.update();
        const [r, g, b] = KIND_TINTS[this.kind];
        select.element.style.setProperty('--dw-tint', `rgb(${r}, ${g}, ${b})`);
        select.element.classList.add('dw-kind');
        section.append(clear, select.element);
        return section;
    }

    /** Removes everything drawn, imported and written for these kinds. */
    private clear(kinds: readonly DrawingKind[]): void {
        for (const kind of kinds) {
            this.masks[kind].clearDrawing();
            this.masks[kind].setImage(null);
            this.fileNames[kind] = '';
            this.settings.texts[kind] = '';
        }
        this.build();
        this.reveal();
    }

    private showMode(): void {
        const mode = drawingMode(this.settings, this.kind);
        for (const [group, section] of this.groups) {
            if (group === 'draw' || group === 'image' || group === 'text') section.hidden = group !== mode;
        }
    }

    private drawTools(): HTMLElement {
        const hint = document.createElement('p');
        hint.className = 'hint dw-hint';
        hint.textContent = t('drawing.draw.hint');
        const tools = document.createElement('div');
        tools.className = 'dw-tools';
        tools.append(hint);
        return tools;
    }

    private imageTools(): HTMLElement {
        const kind = this.kind;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.value = '';                       // the same file can be picked again
            if (file) this.importImage(kind, file);
        });
        const pick = button(t('drawing.image.import'), () => input.click());
        this.fileName = document.createElement('span');
        this.fileName.textContent = this.fileNames[kind] || t('drawing.image.none');
        this.fileName.className = 'dw-file-name';
        const row = document.createElement('div');
        row.className = 'dw-file-row';
        row.dataset.tooltip = t('drawing.image.tooltip');
        row.append(pick, this.fileName, input);
        return row;
    }

    private importImage(kind: DrawingKind, file: File): void {
        createImageBitmap(file).then(image => {
            this.masks[kind].setImage(image);
            this.fileNames[kind] = file.name;
            if (kind === this.kind) {
                this.fileName.textContent = file.name;
                this.fileName.title = file.name;
            }
            this.render(kind);
            this.reveal();
        }, () => {
            if (kind === this.kind) this.fileName.textContent = t('drawing.image.error');
        });
    }

    private textField(): HTMLElement {
        const kind = this.kind;
        const field = document.createElement('label');
        field.className = 'field';
        field.dataset.tooltip = t('drawing.text.tooltip');
        const row = document.createElement('span');
        row.className = 'field-row';
        row.textContent = t('drawing.text.label');
        const area = document.createElement('textarea');
        area.className = 'dw-textarea';
        area.rows = 3;
        area.maxLength = DRAWING_TEXT_MAX;
        area.spellcheck = false;
        area.value = this.settings.texts[kind];
        area.addEventListener('input', () => {
            this.settings.texts[kind] = area.value;
            this.renderSoon(kind);
            this.reveal();
        });
        field.append(row, area);
        return field;
    }

    // ---- Masks ----

    private renderSoon(kind: DrawingKind): void {
        if (this.pendingRender.size === 0) {
            requestAnimationFrame(() => {
                const kinds = [...this.pendingRender];
                this.pendingRender.clear();
                for (const k of kinds) this.render(k);
            });
        }
        this.pendingRender.add(kind);
    }

    private render(kind: DrawingKind): void {
        this.masks[kind].render(this.settings);
        this.commit(kind);
    }

    /** Sends the mask of `kind` to the drawing field. */
    private commit(kind: DrawingKind): void {
        window.clearTimeout(this.commitTimers[kind]);
        this.commitTimers[kind] = undefined;
        this.lastCommit[kind] = performance.now();
        const { width, height } = this.masks[kind];
        if (width === 0 || height === 0) return;
        this.targets.field.setMask(kind, this.masks[kind].pixels(), width, height);
    }

    /** commit(), at most every DRAWING_UPDATE_MS (the last change is always sent). */
    private commitSoon(kind: DrawingKind): void {
        if (this.commitTimers[kind] !== undefined) return;
        const wait = DRAWING_UPDATE_MS - (performance.now() - this.lastCommit[kind]);
        if (wait <= 0) this.commit(kind);
        else this.commitTimers[kind] = window.setTimeout(() => this.commit(kind), wait);
    }

    /** Shows the masks, and hides them DRAWING_PREVIEW_MS after the last call. */
    private reveal(): void {
        for (const mask of Object.values(this.masks)) mask.canvas.classList.add('visible');
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => {
            for (const mask of Object.values(this.masks)) mask.canvas.classList.remove('visible');
        }, DRAWING_PREVIEW_MS);
    }

    // ---- Drawing with the mouse ----

    private get drawing(): boolean {
        return this.tabOpen && drawingMode(this.settings, this.kind) === 'draw';
    }

    private updateDrawing(): void {
        this.targets.container.classList.toggle('drawing-active', this.drawing);
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
            this.commit(this.kind);
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
        const kind = this.kind;
        const mask = this.masks[kind];
        mask.stroke(from, to, drawingNumber(s, kind, P.brushSize) / this.targets.getView().zoom, drawingNumber(s, kind, P.brushFlow) / 100, this.stroke.erase);
        mask.render(s);
        this.commitSoon(kind);
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
