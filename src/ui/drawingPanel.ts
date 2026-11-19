import {
    DRAWING_ATTRACTOR_TINT, DRAWING_PREVIEW_MS, DRAWING_REPELLER_TINT, DRAWING_TEXT_MAX, DRAWING_UPDATE_MS,
} from '../config';
import {
    brushNumber, cloneDrawing, DRAWING_KINDS, DRAWING_PARAM as P, DRAWING_PARAMS, drawingKey, drawingMode, drawingNumber,
    defaultDrawing, sanitizeDrawingSettings, type BrushOwner, type DrawingGroup, type DrawingKind, type DrawingSettings,
} from '../drawing';
import { hollowStroke, shapeRect } from '../drawingMask';
import { t } from '../i18n';
import type { MaskTool, ShapeStyle } from '../mouseTools';
import type { ParamDef, ParamValue } from '../simulation/algorithm';
import type { DrawingField } from '../simulation/drawing/DrawingField';
import { paramToSlider } from '../simulation/params';
import { canvasTransform, screenToCanvas, type ViewState } from '../view';
import { MaskCanvas, type MaskPoint } from './drawing/maskCanvas';
import { paramField, type ParamField, type ParamStore } from './paramPanel';
import { syncAllRanges, syncRange } from './sliders';

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
/** Settings of the mouse tools: a change does not change the masks. */
const TOOL_KEYS: ReadonlySet<string> = new Set([P.brushSize, P.brushFlow, P.shapeThickness]);

/** A brush or eraser stroke in progress. */
interface Stroke {
    readonly type: 'stroke';
    readonly pointerId: number;
    last: MaskPoint;
    readonly erase: boolean;
}

/** A shape being dragged: drawn when the button is released. */
interface ShapeDrag {
    readonly type: 'shape';
    readonly pointerId: number;
    readonly style: ShapeStyle;
    readonly start: MaskPoint;
    end: MaskPoint;
    /** Shift: a circle or a square. */
    constrain: boolean;
    /** Alt: from the center. */
    fromCenter: boolean;
    readonly erase: boolean;
}

/** The kind and the setting a prefixed key (`repeller.strength`) stands for. */
function splitKey(key: string): { kind: DrawingKind; name: string } | null {
    const kind = DRAWING_KINDS.find(k => key.startsWith(`${k}.`));
    return kind ? { kind, name: key.slice(kind.length + 1) } : null;
}

/**
 * The content of the panel's drawing tab, and the masks it edits. Each kind of drawing (attractor,
 * repeller) has its own mask and settings; the kind selector (also the toolbar's) chooses the one
 * shown and drawn on, both stay active. A mask is drawn with the mouse on the simulation while the
 * toolbar has a mask tool (brush, eraser, shape), imported from an image or written as a text. The
 * previews show while a mask changes and fade DRAWING_PREVIEW_MS after the last change, unless
 * pinned. Every new mask goes to the drawing field (at most every DRAWING_UPDATE_MS while drawing).
 */
export class DrawingPanel {
    readonly element = document.createElement('div');
    private settings = defaultDrawing();
    private kind: DrawingKind = 'attractor';
    private readonly masks: Record<DrawingKind, MaskCanvas>;
    /** The settings and the selected kind, as the controls read and set them. */
    readonly store: ParamStore = {
        value: key => key === KIND_KEY ? this.kind : this.settings.params[key],
        set: (key, value) => key === KIND_KEY ? this.selectKind(value) : this.set(key, value),
    };
    private groups = new Map<DrawingGroup, HTMLElement>();
    /** The controls of the tab, by setting key (the selected kind's). */
    private fields = new Map<string, ParamField>();
    private readonly fileNames: Record<DrawingKind, string> = { attractor: '', repeller: '' };
    private fileName = document.createElement('span');
    private maskTool: MaskTool | null = null;
    private size = { width: 1, height: 1 };
    private gesture: Stroke | ShapeDrag | null = null;
    /** The dragged shape's outline, laid over the zoomed view as the masks are. */
    private readonly shapeLayer = document.createElement('div');
    private readonly shapePreview = document.createElement('div');
    private pinned = false;
    private readonly listeners: Array<() => void> = [];
    private notifyQueued = false;
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
        this.shapeLayer.className = 'shape-layer';
        this.shapePreview.className = 'shape-preview';
        this.shapePreview.hidden = true;
        this.shapeLayer.appendChild(this.shapePreview);
        targets.container.appendChild(this.shapeLayer);
        targets.onViewChange(() => this.applyView());
        this.listenToPointer(targets.surface);
        this.build();
    }

    /** The settings, as saved in simulation configs. */
    values(): DrawingSettings {
        return cloneDrawing(this.settings);
    }

    /** The kind of drawing edited and drawn on. */
    get selectedKind(): DrawingKind {
        return this.kind;
    }

    setKind(kind: DrawingKind): void {
        this.selectKind(kind);
    }

    /** The brush of `owner`: its diameter (screen px) and density (%). */
    brush(owner: BrushOwner): { size: number; flow: number } {
        return { size: brushNumber(this.settings, owner, P.brushSize), flow: brushNumber(this.settings, owner, P.brushFlow) };
    }

    /** Calls `listener` after the settings or the selected kind change (once per batch of changes). */
    onChange(listener: () => void): void {
        this.listeners.push(listener);
    }

    /** Sets a setting from outside the tab (the toolbar): the tab's control follows. */
    setParam(key: string, value: ParamValue): void {
        const field = this.fields.get(key);
        const input = field?.element.querySelector('input');
        if (field && input && field.param.kind === 'number' && typeof value === 'number') {
            input.value = String(paramToSlider(field.param, value));
            syncRange(input);
            field.update();                         // stores the value and paints it
        } else {
            this.set(key, value);
        }
    }

    /**
     * What the mouse does on the simulation: draws, erases or drags shapes on the selected kind's
     * mask (which then shows its drawing), or nothing here (null).
     */
    setMaskTool(tool: MaskTool | null): void {
        this.endGesture(false);
        this.maskTool = tool;
        if (tool) this.useDrawSource();
    }

    /** Removes everything drawn, imported and written, of both kinds. */
    clearAll(): void {
        this.clear(DRAWING_KINDS);
    }

    /** Keeps the masks shown (true), or lets them fade after each change as usual. */
    setMasksPinned(pinned: boolean): void {
        this.pinned = pinned;
        if (pinned) this.reveal();
        else for (const mask of Object.values(this.masks)) mask.canvas.classList.remove('visible');
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
        Object.assign(this.shapeLayer.style, { width: `${width}px`, height: `${height}px`, transform });
    }

    // ---- Settings ----

    private notify(): void {
        if (this.notifyQueued) return;
        this.notifyQueued = true;
        queueMicrotask(() => {
            this.notifyQueued = false;
            for (const listener of this.listeners) listener();
        });
    }

    private selectKind(value: ParamValue): void {
        // The selector's update() sends its current value back here: only a real change rebuilds.
        if ((value !== 'attractor' && value !== 'repeller') || value === this.kind) return;
        this.endGesture(false);
        this.kind = value;
        // A mask tool draws on the selected kind's drawing: it is shown.
        if (this.maskTool) this.settings.params[drawingKey(value, P.mode)] = 'draw';
        this.build();
        this.reveal();
    }

    /** Shows the drawing of the selected kind (its image or text stays, for later). */
    private useDrawSource(): void {
        if (drawingMode(this.settings, this.kind) === 'draw') return;
        this.settings.params[drawingKey(this.kind, P.mode)] = 'draw';
        this.build();
        this.reveal();
    }

    private set(key: string, value: ParamValue): void {
        this.settings.params[key] = value;
        this.notify();
        const target = splitKey(key);
        if (!target) return;
        const { kind, name } = target;
        const { field } = this.targets;
        if (name === P.strength) field.setStrength(kind, drawingNumber(this.settings, kind, P.strength));
        else if (name === P.softening) field.setSoftening(kind, drawingNumber(this.settings, kind, P.softening));
        else if (name === P.mode) {
            this.showMode();
            this.renderSoon(kind);
        } else if (!TOOL_KEYS.has(name)) {
            this.renderSoon(kind);
        }
    }

    /** Rebuilds the tab from the settings and the selected kind; every value reaches the field. */
    private build(): void {
        const kind = this.kind;
        const fields: ParamField[] = [];
        this.fields = new Map();
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
                this.fields.set(param.key, field);
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
        this.notify();
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
            if (this.pinned) return;
            for (const mask of Object.values(this.masks)) mask.canvas.classList.remove('visible');
        }, DRAWING_PREVIEW_MS);
    }

    // ---- Drawing with the mouse ----

    private listenToPointer(surface: HTMLElement): void {
        surface.addEventListener('contextmenu', e => { if (this.maskTool) e.preventDefault(); });
        surface.addEventListener('pointerdown', e => {
            const tool = this.maskTool;
            if (!tool || this.gesture || (e.button !== 0 && e.button !== 2)) return;
            e.preventDefault();
            surface.setPointerCapture(e.pointerId);
            this.useDrawSource();
            const point = this.pointOf(e, surface);
            if (tool.tool === 'shape') {
                this.gesture = {
                    type: 'shape', pointerId: e.pointerId, style: tool.style, start: point, end: point,
                    constrain: e.shiftKey, fromCenter: e.altKey, erase: e.button === 2,
                };
                this.showShape();
                return;
            }
            const erase = tool.tool === 'eraser' || e.button === 2 || e.shiftKey;
            this.gesture = { type: 'stroke', pointerId: e.pointerId, last: point, erase };
            this.paint(null, point);
        });
        surface.addEventListener('pointermove', e => {
            const gesture = this.gesture;
            if (!gesture || e.pointerId !== gesture.pointerId) return;
            if (gesture.type === 'shape') {
                gesture.end = this.pointOf(e, surface);
                gesture.constrain = e.shiftKey;
                gesture.fromCenter = e.altKey;
                this.showShape();
                return;
            }
            // Coalesced events keep fast strokes smooth.
            for (const event of e.getCoalescedEvents?.() ?? [e]) {
                const point = this.pointOf(event, surface);
                this.paint(gesture.last, point);
                gesture.last = point;
            }
        });
        surface.addEventListener('pointerup', e => { if (e.pointerId === this.gesture?.pointerId) this.endGesture(true); });
        surface.addEventListener('pointercancel', e => { if (e.pointerId === this.gesture?.pointerId) this.endGesture(false); });
        // Escape drops the shape being dragged.
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || this.gesture?.type !== 'shape') return;
            e.preventDefault();
            this.endGesture(false);
        });
    }

    /** Ends the stroke (sent to the field) or the shape drag (drawn if `draw`, else dropped). */
    private endGesture(draw: boolean): void {
        const gesture = this.gesture;
        if (!gesture) return;
        this.gesture = null;
        if (gesture.type === 'stroke') {
            this.commit(this.kind);
            return;
        }
        this.shapePreview.hidden = true;
        if (!draw) return;
        const kind = this.kind;
        const mask = this.masks[kind];
        const rect = shapeRect(gesture.start, gesture.end, gesture.constrain, gesture.fromCenter);
        mask.shape(rect, gesture.style, this.shapeThickness(), drawingNumber(this.settings, kind, P.brushFlow) / 100, gesture.erase);
        mask.render(this.settings);
        this.commit(kind);
        this.reveal();
    }

    /** The outline thickness of the hollow shapes, in canvas px (the setting is in screen px). */
    private shapeThickness(): number {
        return drawingNumber(this.settings, this.kind, P.shapeThickness) / this.targets.getView().zoom;
    }

    /** Lays the outline of the dragged shape over the simulation. */
    private showShape(): void {
        const gesture = this.gesture;
        if (gesture?.type !== 'shape') return;
        const rect = shapeRect(gesture.start, gesture.end, gesture.constrain, gesture.fromCenter);
        const thickness = this.shapeThickness();
        const filled = gesture.style.filled || !hollowStroke(rect, thickness);
        const [r, g, b] = KIND_TINTS[this.kind];
        const preview = this.shapePreview;
        preview.hidden = false;
        preview.classList.toggle('ellipse', gesture.style.shape === 'ellipse');
        preview.classList.toggle('filled', filled);
        preview.classList.toggle('erase', gesture.erase);
        Object.assign(preview.style, {
            left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
            borderWidth: filled ? '' : `${thickness}px`,
        });
        preview.style.setProperty('--dw-tint', `rgb(${r}, ${g}, ${b})`);
    }

    /** The event's position in the canvas coordinates of the world (the zoom undone). */
    private pointOf(e: PointerEvent, surface: HTMLElement): MaskPoint {
        const box = surface.getBoundingClientRect();
        const { width, height } = this.size;
        return screenToCanvas(this.targets.getView(), { x: e.clientX - box.left, y: e.clientY - box.top }, width, height);
    }

    private paint(from: MaskPoint | null, to: MaskPoint): void {
        if (this.gesture?.type !== 'stroke') return;
        const s = this.settings;
        const kind = this.kind;
        const mask = this.masks[kind];
        mask.stroke(from, to, drawingNumber(s, kind, P.brushSize) / this.targets.getView().zoom, drawingNumber(s, kind, P.brushFlow) / 100, this.gesture.erase);
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
