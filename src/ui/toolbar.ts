import { DELETE_CONFIRM_MS, DRAWING_ATTRACTOR_TINT, DRAWING_REPELLER_TINT, VORTEX_TINT } from '../config';
import {
    BRUSH_TIPS, brushParam, DRAWING_PARAM as P, DRAWING_PARAMS, drawingKey, type BrushOwner, type BrushTip, type DrawingKind,
} from '../drawing';
import { t, type MessageKey } from '../i18n';
import {
    DEFAULT_FORCE_MODE, DEFAULT_MOUSE_TOOL, FORCE_MODES, forceType, nextForceMode, nextShape, nextTip, otherKind, SHAPE_KINDS, SHAPE_STYLES, stepBrush,
    type ForceMode, type ForceType, type MaskTool, type MouseTool, type ShapeKind, type ShapeStyle, type ToolbarShortcut,
} from '../mouseTools';
import type { NumberParam, ParamDef } from '../simulation/algorithm';
import type { DrawingField } from '../simulation/drawing/DrawingField';
import { paramToSlider, sliderRange, sliderToParam } from '../simulation/params';
import { screenToWorld, type ViewState } from '../view';
import { flash } from './dom';
import type { DrawingPanel } from './drawingPanel';
import { setupSliders, syncRange } from './sliders';
import { setupTooltips } from './tooltip';

export interface ToolbarTargets {
    /** The (empty) toolbar element of the page. */
    root: HTMLElement;
    tooltip: HTMLElement;
    /** The drawings: their selected kind, brushes and masks. */
    drawing: DrawingPanel;
    /** Where the point force goes. */
    field: DrawingField;
    /** The simulation area: its `data-tool` tells the CSS which tool is active; the brush outline goes in it. */
    container: HTMLElement;
    /** Where the mouse acts (the simulation canvas). */
    surface: HTMLElement;
    getView: () => ViewState;
    onViewChange: (listener: (view: ViewState) => void) => void;
}

// Icons: inner markup of a 24x24 SVG, stroked (`solid` parts filled, `faint` ones half transparent).
const ICONS = {
    gravity: '<circle class="solid" cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="9" stroke-dasharray="2.2 2.6"/>',
    vortex: '<path d="M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0"/>',
    brush: '<path d="M18.4 3.6a2.1 2.1 0 0 1 3 3L12.6 15.4l-3-3z"/><path d="M9.2 13.2c-2.6 0-4.2 1.6-4.2 4 0 1.4-.8 2.4-2 3 4 .8 8.2-.6 8.2-4.6"/>',
    eraser: '<path d="M9 20h11"/><path d="M14.6 4.4l5 5a1.5 1.5 0 0 1 0 2.1L11 20H7.5l-3.1-3.1a1.5 1.5 0 0 1 0-2.1l8.1-10.4a1.5 1.5 0 0 1 2.1 0z"/><path d="M9.3 9.6l5.1 5.1"/>',
    shapes: '<rect x="3" y="3" width="10.5" height="10.5" rx="1.5"/><circle cx="15" cy="15" r="6"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.2"/>',
    rect: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>',
    ellipseFilled: '<ellipse class="solid" cx="12" cy="12" rx="8" ry="5.8"/>',
    ellipseOutline: '<ellipse cx="12" cy="12" rx="7.4" ry="5.2" stroke-width="3"/>',
    rectFilled: '<rect class="solid" x="4" y="6.5" width="16" height="11" rx="1.5"/>',
    rectOutline: '<rect x="4.8" y="7.3" width="14.4" height="9.4" rx="1" stroke-width="3"/>',
    soft: '<circle class="solid faint3" cx="12" cy="12" r="8.5" stroke="none"/><circle class="solid faint2" cx="12" cy="12" r="6" stroke="none"/><circle class="solid" cx="12" cy="12" r="3.4" stroke="none"/>',
    hard: '<circle class="solid" cx="12" cy="12" r="7.5" stroke="none"/>',
    spray: '<g class="solid" stroke="none"><circle cx="12" cy="12" r="1.3"/><circle cx="7.5" cy="9" r="1.1"/><circle cx="15.5" cy="7.5" r="1.1"/><circle cx="17" cy="13.5" r="1.2"/><circle cx="9" cy="16" r="1.2"/><circle cx="13.5" cy="17.5" r="1"/><circle cx="5.5" cy="13" r=".9"/><circle cx="11" cy="5.5" r=".9"/><circle cx="18.5" cy="10" r=".8"/></g>',
    size: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2"/>',
    flow: '<circle cx="12" cy="12" r="8.5"/><circle class="solid" cx="9" cy="9.5" r="1.2"/><circle class="solid" cx="14.5" cy="9" r="1.2"/><circle class="solid" cx="12" cy="13" r="1.2"/><circle class="solid" cx="8.5" cy="15" r="1.2"/><circle class="solid" cx="15.5" cy="14.5" r="1.2"/>',
    thickness: '<path d="M4 6h16" stroke-width="1"/><path d="M4 11.5h16" stroke-width="2.2"/><path d="M4 18h16" stroke-width="3.6"/>',
    ink: '<circle class="ink-back" cx="15.2" cy="8.8" r="6.3"/><circle class="ink-front" cx="9.3" cy="14.7" r="7"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    clear: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
} as const;
type Icon = keyof typeof ICONS;

type Tool = Exclude<MouseTool, 'none'>;

const KIND_LABELS: Record<DrawingKind, MessageKey> = {
    attractor: 'drawing.kind.attractor',
    repeller: 'drawing.kind.repeller',
};
const MODE_TEXT: Record<ForceMode, { label: MessageKey; doc: MessageKey }> = {
    gravity: { label: 'toolbar.mode.gravity', doc: 'toolbar.mode.gravity.doc' },
    vortex: { label: 'toolbar.mode.vortex', doc: 'toolbar.mode.vortex.doc' },
};
const TIP_TEXT: Record<BrushTip, { label: MessageKey; doc: MessageKey }> = {
    soft: { label: 'drawing.option.tip.soft', doc: 'toolbar.tip.soft.doc' },
    hard: { label: 'drawing.option.tip.hard', doc: 'toolbar.tip.hard.doc' },
    spray: { label: 'drawing.option.tip.spray', doc: 'toolbar.tip.spray.doc' },
};
const SHAPE_TEXT: Record<ShapeKind, { label: MessageKey; doc: MessageKey }> = {
    ellipse: { label: 'toolbar.shape.ellipse', doc: 'toolbar.shape.ellipse.doc' },
    rect: { label: 'toolbar.shape.rect', doc: 'toolbar.shape.rect.doc' },
};
const TINTS: Record<ForceType, readonly [number, number, number]> = {
    attractor: DRAWING_ATTRACTOR_TINT,
    repeller: DRAWING_REPELLER_TINT,
    vortex: VORTEX_TINT,
};
const tint = (type: ForceType): string => `rgb(${TINTS[type].join(', ')})`;

/** The settings of the tools, as sliders of the options bar. */
type Setting = 'size' | 'flow' | 'thickness';

/** A control of the options bar, following the settings. */
interface OptionControl {
    sync(): void;
}

/** A choice of a segmented control of the options bar. */
interface Choice {
    readonly icon: Icon;
    readonly label: string;
    readonly doc: string;
    selected(): boolean;
    choose(): void;
}

/** The point force being held: the pointer and the button. */
interface Held {
    readonly pointerId: number;
    readonly reversed: boolean;
    clientX: number;
    clientY: number;
}

function numberParam(param: ParamDef): NumberParam {
    if (param.kind !== 'number') throw new Error(`${param.key} is not a number`);
    return param;
}

const svg = (icon: Icon): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;

function iconButton(icon: Icon, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn';
    b.innerHTML = svg(icon);
    b.dataset.icon = icon;
    b.dataset.tooltipPlacement = 'below';
    b.addEventListener('click', onClick);
    return b;
}

/** Shows `icon` on the button (only when it changes). */
function setIcon(b: HTMLElement, icon: Icon): void {
    if (b.dataset.icon === icon) return;
    b.dataset.icon = icon;
    b.innerHTML = svg(icon);
}

/** Names the element (screen readers) and documents it (tooltip). */
function describe(el: HTMLElement, label: string, doc: string): void {
    el.setAttribute('aria-label', label);
    el.dataset.tooltip = doc;
}

const press = (b: HTMLButtonElement, pressed: boolean): void => b.setAttribute('aria-pressed', String(pressed));

function group(label: MessageKey, ...children: HTMLElement[]): HTMLElement {
    const g = document.createElement('div');
    g.className = 'tb-group';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', t(label));
    g.append(...children);
    return g;
}

function separator(): HTMLElement {
    const s = document.createElement('div');
    s.className = 'tb-sep';
    s.setAttribute('aria-hidden', 'true');
    return s;
}

/**
 * The toolbar over the simulation, laid out as in a paint program. Its bar holds, from left to
 * right: the ink (attractor or repeller: what the brush, the shapes and the point force's gravity
 * do, the eraser erasing that kind; X swaps it), the tools (point force, brush, eraser, shapes;
 * clicking the active one drops it) and the drawings (always shown, clear all). Under it, the
 * options bar shows the settings of the active tool only, next to each other: the force mode or the
 * brush tip or the shape and its fill, then sliders for the size, the density and the thickness.
 * The brush tools and the point force show their outline under the pointer. It holds the point force
 * while its button is pressed; the mask tools are DrawingPanel's. See setupShortcuts for its keys.
 */
export class MouseToolbar {
    private tool: MouseTool = DEFAULT_MOUSE_TOOL;
    private shape: ShapeStyle = SHAPE_STYLES[0];
    private forceMode: ForceMode = DEFAULT_FORCE_MODE;
    private held: Held | null = null;
    private readonly inkButton: HTMLButtonElement;
    private readonly toolButtons: Record<Tool, HTMLButtonElement>;
    private readonly eyeButton: HTMLButtonElement;
    private readonly clearButton: HTMLButtonElement;
    private readonly options = document.createElement('div');
    /** What the options bar was built for (rebuilt when it changes). */
    private optionsLayout = '';
    private optionControls: OptionControl[] = [];
    /** The brush outline under the pointer, and where the pointer is over the simulation. */
    private readonly cursor = document.createElement('div');
    private pointer: { clientX: number; clientY: number } | null = null;
    private pinned = false;
    private clearTimer: number | undefined;

    constructor(private readonly targets: ToolbarTargets) {
        const { root, container } = targets;
        this.inkButton = iconButton('ink', () => this.swap());
        this.inkButton.classList.add('tb-ink');
        this.toolButtons = {
            force: iconButton('gravity', () => this.toggleTool('force')),
            brush: iconButton('brush', () => this.toggleTool('brush')),
            eraser: iconButton('eraser', () => this.toggleTool('eraser')),
            shape: iconButton('shapes', () => this.toggleTool('shape')),
        };
        for (const b of Object.values(this.toolButtons)) b.classList.add('tb-tool');
        this.eyeButton = iconButton('eye', () => this.togglePinned());
        describe(this.eyeButton, t('toolbar.showDrawings'), t('toolbar.showDrawings.doc'));
        press(this.eyeButton, false);
        this.clearButton = iconButton('clear', () => this.clearAll());
        this.clearButton.classList.add('tb-danger');
        describe(this.clearButton, t('toolbar.clearAll'), t('toolbar.clearAll.doc'));

        const bar = document.createElement('div');
        bar.className = 'tb-bar';
        const { force, brush, eraser, shape } = this.toolButtons;
        bar.append(
            this.inkButton,
            separator(),
            group('toolbar.group.tools', force, brush, eraser, shape),
            separator(),
            group('toolbar.group.drawings', this.eyeButton, this.clearButton),
        );
        this.options.className = 'tb-options';
        this.options.setAttribute('role', 'group');
        this.options.hidden = true;
        root.append(bar, this.options);

        this.cursor.className = 'tb-cursor';
        this.cursor.hidden = true;
        this.cursor.setAttribute('aria-hidden', 'true');
        container.appendChild(this.cursor);

        setupTooltips(root, targets.tooltip);
        setupSliders(this.options);
        this.listenToPointer(targets.surface);
        targets.onViewChange(() => this.applyForce());
        this.refresh();
    }

    /** Follows the drawings' settings and selected kind (call it when they change). */
    refresh(): void {
        const { drawing, container, root } = this.targets;
        const kind = drawing.selectedKind;
        const kindName = t(KIND_LABELS[kind]);

        // The ink: the selected kind in front, the other one behind.
        this.inkButton.style.setProperty('--ink-front', tint(kind));
        this.inkButton.style.setProperty('--ink-back', tint(otherKind(kind)));
        this.inkButton.classList.toggle('tb-muted', this.tool === 'force' && this.forceMode === 'vortex');
        describe(this.inkButton, t('toolbar.ink', { kind: kindName }), t('toolbar.ink.doc', { kind: kindName }));

        const { force, brush, eraser, shape } = this.toolButtons;
        for (const [tool, b] of Object.entries(this.toolButtons)) press(b, this.tool === tool);
        setIcon(force, this.forceMode === 'vortex' ? 'vortex' : 'gravity');
        force.style.setProperty('--tb-tint', tint(forceType(this.forceMode, kind)));
        for (const b of [brush, eraser, shape]) b.style.setProperty('--tb-tint', tint(kind));
        describe(force, t('toolbar.tool.force'), t('toolbar.tool.force.doc'));
        describe(brush, t('toolbar.tool.brush'), t('toolbar.tool.brush.doc', { kind: kindName }));
        describe(eraser, t('toolbar.tool.eraser'), t('toolbar.tool.eraser.doc', { kind: kindName }));
        describe(shape, t('toolbar.tool.shape'), t('toolbar.tool.shape.doc', { kind: kindName }));

        container.dataset.tool = this.tool;
        root.dataset.tool = this.tool;
        const toolTint = tint(this.tool === 'force' ? forceType(this.forceMode, kind) : kind);
        root.style.setProperty('--tb-tint', toolTint);
        this.cursor.style.setProperty('--tb-tint', toolTint);
        this.renderOptions();
        this.showCursor();
        this.applyForce();
    }

    /** Applies a key of the toolbar (setupShortcuts). */
    shortcut(s: ToolbarShortcut): void {
        switch (s.action) {
            case 'tool':
                if (s.tool === 'force' && this.tool === 'force') this.chooseForceMode(nextForceMode(this.forceMode));
                else if (s.tool === 'brush' && this.tool === 'brush') this.chooseTip(nextTip(this.tip));
                else this.selectTool(s.tool);
                break;
            case 'shape': this.selectTool('shape', this.tool === 'shape' ? nextShape(this.shape) : this.shape); break;
            case 'swap': this.swap(); break;
            case 'brush':
                // With a hollow shape, [ and ] set its outline (the brush does not draw shapes).
                this.step(s.key === 'size' && this.tool === 'shape' && !this.shape.filled ? 'thickness' : s.key, s.direction);
                break;
        }
        flash(this.targets.root);
    }

    // ---- Selection ----

    /** The brush in use: the vortex's with the vortex, else the selected kind's. */
    private get owner(): BrushOwner {
        return this.tool === 'force' && this.forceMode === 'vortex' ? 'vortex' : this.targets.drawing.selectedKind;
    }

    /** The brush tip of the selected kind. */
    private get tip(): BrushTip {
        const key = drawingKey(this.targets.drawing.selectedKind, P.brushTip);
        const value = this.targets.drawing.store.value(key);
        return BRUSH_TIPS.find(tip => tip === value) ?? 'soft';
    }

    private maskTool(): MaskTool | null {
        switch (this.tool) {
            case 'brush':
            case 'eraser': return { tool: this.tool };
            case 'shape': return { tool: 'shape', style: this.shape };
            default: return null;
        }
    }

    /** A click on a tool: picks it, or drops it if it is the active one. */
    private toggleTool(tool: Tool): void {
        this.selectTool(this.tool === tool ? 'none' : tool);
    }

    private selectTool(tool: MouseTool, shape?: ShapeStyle): void {
        this.release();
        this.tool = tool;
        if (shape) this.shape = shape;
        this.targets.drawing.setMaskTool(this.maskTool());
        this.refresh();
    }

    private chooseForceMode(mode: ForceMode): void {
        this.forceMode = mode;
        this.selectTool('force');
    }

    /** The brush tip of the selected kind (the tab follows). */
    private chooseTip(tip: BrushTip): void {
        this.targets.drawing.setParam(drawingKey(this.targets.drawing.selectedKind, P.brushTip), tip);
    }

    /** X, or a click on the ink: the other kind of drawing. */
    private swap(): void {
        this.targets.drawing.setKind(otherKind(this.targets.drawing.selectedKind));
        this.refresh();
    }

    // ---- Options bar (the active tool's settings) ----

    private renderOptions(): void {
        const layout = `${this.tool}|${this.owner}|${this.shape.filled}`;
        if (layout !== this.optionsLayout) {
            this.optionsLayout = layout;
            this.buildOptions();
        }
        for (const control of this.optionControls) control.sync();
    }

    private buildOptions(): void {
        this.optionControls = [];
        const parts = this.optionParts();
        this.options.hidden = parts.length === 0;
        this.options.setAttribute('aria-label', t('toolbar.options'));
        const children: HTMLElement[] = [];
        parts.forEach((part, i) => {
            if (i > 0) children.push(separator());
            children.push(part);
        });
        this.options.replaceChildren(...children);
    }

    /** The controls of the active tool, in the order they show. */
    private optionParts(): HTMLElement[] {
        const tips = (): HTMLElement => this.segmented('toolbar.group.tip', BRUSH_TIPS.map(tip => ({
            icon: tip, label: t(TIP_TEXT[tip].label), doc: t(TIP_TEXT[tip].doc),
            selected: () => this.tip === tip, choose: () => this.chooseTip(tip),
        })));
        switch (this.tool) {
            case 'none':
                return [];
            case 'force':
                return [
                    this.segmented('toolbar.group.mode', FORCE_MODES.map(mode => ({
                        icon: mode === 'vortex' ? 'vortex' : 'gravity', label: t(MODE_TEXT[mode].label), doc: t(MODE_TEXT[mode].doc),
                        selected: () => this.forceMode === mode, choose: () => this.chooseForceMode(mode),
                    }))),
                    this.slider('size', 'toolbar.forceSize.doc'),
                    this.slider('flow', 'toolbar.forceFlow.doc'),
                ];
            case 'brush':
                return [tips(), this.slider('size', 'toolbar.size.doc'), this.slider('flow', 'toolbar.flow.doc')];
            case 'eraser':
                return [tips(), this.slider('size', 'toolbar.size.doc'), this.slider('flow', 'toolbar.eraserFlow.doc')];
            case 'shape': {
                const outline = (filled: boolean): Icon => `${this.shape.shape}${filled ? 'Filled' : 'Outline'}`;
                const fills = [true, false].map((filled): Choice => ({
                    icon: outline(filled),
                    label: t(filled ? 'toolbar.fill.filled' : 'toolbar.fill.outline'),
                    doc: t(filled ? 'toolbar.fill.filled.doc' : 'toolbar.fill.outline.doc'),
                    selected: () => this.shape.filled === filled,
                    choose: () => this.selectTool('shape', { shape: this.shape.shape, filled }),
                }));
                const fillGroup = this.segmented('toolbar.group.fill', fills);
                const parts = [
                    this.segmented('toolbar.group.shape', SHAPE_KINDS.map(kind => ({
                        icon: kind, label: t(SHAPE_TEXT[kind].label), doc: t(SHAPE_TEXT[kind].doc),
                        selected: () => this.shape.shape === kind,
                        choose: () => this.selectTool('shape', { shape: kind, filled: this.shape.filled }),
                    }))),
                    fillGroup,
                ];
                // The fill icons wear the shape chosen.
                this.optionControls.push({
                    sync: () => fillGroup.querySelectorAll<HTMLElement>('.tb-btn').forEach((b, i) => setIcon(b, outline(i === 0))),
                });
                if (!this.shape.filled) parts.push(this.slider('thickness', 'toolbar.thickness.doc'));
                parts.push(this.slider('flow', 'toolbar.shapeFlow.doc'));
                return parts;
            }
        }
    }

    /** Exclusive choices, as a row of icons. */
    private segmented(label: MessageKey, choices: readonly Choice[]): HTMLElement {
        const g = document.createElement('div');
        g.className = 'tb-seg';
        g.setAttribute('role', 'radiogroup');
        g.setAttribute('aria-label', t(label));
        const buttons = choices.map(choice => {
            const b = iconButton(choice.icon, () => {
                choice.choose();
                this.refresh();
            });
            b.setAttribute('role', 'radio');
            describe(b, choice.label, choice.doc);
            return b;
        });
        g.append(...buttons);
        this.optionControls.push({
            sync: () => buttons.forEach((b, i) => {
                const selected = choices[i].selected();
                b.setAttribute('aria-checked', String(selected));
                b.tabIndex = selected ? 0 : -1;
            }),
        });
        g.addEventListener('keydown', e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const i = buttons.findIndex(b => b === document.activeElement);
            const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
            next.click();
            next.focus();
        });
        return g;
    }

    /** A setting of the active tool, as a compact slider with its value; the wheel steps it. */
    private slider(setting: Setting, doc: MessageKey): HTMLElement {
        const param = this.settingParam(setting);
        const { drawing } = this.targets;
        const field = document.createElement('label');
        field.className = 'tb-slider';
        field.dataset.tooltipPlacement = 'below';
        describe(field, param.label, t(doc));
        field.insertAdjacentHTML('afterbegin', svg(setting));
        const input = document.createElement('input');
        input.type = 'range';
        const range = sliderRange(param);
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        input.defaultValue = String(paramToSlider(param, param.default));   // double-click goes back to it
        input.setAttribute('aria-label', param.label);
        const out = document.createElement('output');
        field.append(input, out);
        const current = (): number => {
            const v = drawing.store.value(param.key);
            return typeof v === 'number' ? v : param.default;
        };
        input.addEventListener('input', () => drawing.setParam(param.key, sliderToParam(param, parseFloat(input.value))));
        field.addEventListener('wheel', e => {
            e.preventDefault();
            if (e.deltaY !== 0) this.step(setting, e.deltaY < 0 ? 1 : -1);
        }, { passive: false });
        this.optionControls.push({
            sync: () => {
                const value = current();
                const position = String(paramToSlider(param, value));
                if (input.value !== position) input.value = position;
                syncRange(input);
                out.textContent = param.format(value);
            },
        });
        return field;
    }

    private settingParam(setting: Setting): NumberParam {
        if (setting === 'thickness') {
            const kind = this.targets.drawing.selectedKind;
            const key = drawingKey(kind, P.shapeThickness);
            return numberParam(DRAWING_PARAMS[kind].find(p => p.key === key)!);
        }
        return numberParam(brushParam(this.owner, setting === 'size' ? P.brushSize : P.brushFlow));
    }

    /** One step up or down of a setting (a size or a thickness by a factor, a density by a step). */
    private step(setting: Setting, direction: -1 | 1): void {
        const param = this.settingParam(setting);
        const value = this.targets.drawing.store.value(param.key);
        const current = typeof value === 'number' ? value : param.default;
        this.targets.drawing.setParam(param.key, stepBrush(param, current, setting === 'flow' ? 'flow' : 'size', direction));
    }

    // ---- Drawings ----

    private togglePinned(): void {
        this.pinned = !this.pinned;
        press(this.eyeButton, this.pinned);
        this.targets.drawing.setMasksPinned(this.pinned);
    }

    /** A first click arms the button, a second one within DELETE_CONFIRM_MS clears the drawings. */
    private clearAll(): void {
        const b = this.clearButton;
        if (!b.classList.contains('confirm')) {
            b.classList.add('confirm');
            describe(b, t('toolbar.clearAll'), t('toolbar.clearAll.confirm'));
            this.clearTimer = window.setTimeout(() => this.disarmClear(), DELETE_CONFIRM_MS);
            return;
        }
        this.disarmClear();
        this.targets.drawing.clearAll();
    }

    private disarmClear(): void {
        window.clearTimeout(this.clearTimer);
        this.clearButton.classList.remove('confirm');
        describe(this.clearButton, t('toolbar.clearAll'), t('toolbar.clearAll.doc'));
    }

    // ---- The pointer: brush outline and point force ----

    private listenToPointer(surface: HTMLElement): void {
        surface.addEventListener('pointermove', e => {
            this.pointer = { clientX: e.clientX, clientY: e.clientY };
            this.showCursor();
            if (!this.held || e.pointerId !== this.held.pointerId) return;
            this.held.clientX = e.clientX;
            this.held.clientY = e.clientY;
            this.applyForce();
        });
        surface.addEventListener('pointerleave', () => {
            if (this.held) return;
            this.pointer = null;
            this.showCursor();
        });
        surface.addEventListener('contextmenu', e => { if (this.tool === 'force') e.preventDefault(); });
        surface.addEventListener('pointerdown', e => {
            if (this.tool !== 'force' || this.held || (e.button !== 0 && e.button !== 2)) return;
            e.preventDefault();
            surface.setPointerCapture(e.pointerId);
            this.held = { pointerId: e.pointerId, reversed: e.button === 2 || e.shiftKey, clientX: e.clientX, clientY: e.clientY };
            this.applyForce();
            this.showCursor();
        });
        const end = (e: PointerEvent): void => { if (e.pointerId === this.held?.pointerId) this.release(); };
        surface.addEventListener('pointerup', end);
        surface.addEventListener('pointercancel', end);
        surface.addEventListener('lostpointercapture', end);
        window.addEventListener('blur', () => this.release());
    }

    /** The outline of the brush (or of the point force) under the pointer, at its size on screen. */
    private showCursor(): void {
        const { cursor, pointer } = this;
        const tool = this.tool;
        if (!pointer || (tool !== 'force' && tool !== 'brush' && tool !== 'eraser')) {
            cursor.hidden = true;
            return;
        }
        const box = this.targets.container.getBoundingClientRect();
        const size = this.targets.drawing.brush(this.owner).size;
        cursor.hidden = false;
        cursor.classList.toggle('erase', tool === 'eraser');
        cursor.classList.toggle('spray', tool !== 'force' && this.tip === 'spray');
        cursor.classList.toggle('held', this.held !== null);
        cursor.style.width = cursor.style.height = `${size}px`;
        cursor.style.transform = `translate(${pointer.clientX - box.left - size / 2}px, ${pointer.clientY - box.top - size / 2}px)`;
    }

    /** Puts the held force under the pointer, with the current type and brush. */
    private applyForce(): void {
        const held = this.held;
        if (!held) return;
        const { surface, getView, drawing, field } = this.targets;
        const box = surface.getBoundingClientRect();
        const view = getView();
        const world = screenToWorld(view, { x: held.clientX - box.left, y: held.clientY - box.top }, box.width, box.height);
        const brush = drawing.brush(this.owner);
        field.setPointForce({
            x: world.x, y: world.y, type: forceType(this.forceMode, drawing.selectedKind), reversed: held.reversed,
            diameter: brush.size / view.zoom, flow: brush.flow / 100,
        });
    }

    private release(): void {
        if (!this.held) return;
        this.held = null;
        this.targets.field.setPointForce(null);
        this.showCursor();
    }
}
