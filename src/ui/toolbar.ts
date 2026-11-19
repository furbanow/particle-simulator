import {
    DELETE_CONFIRM_MS, DRAWING_ATTRACTOR_TINT, DRAWING_REPELLER_TINT, TOOLBAR_HOLD_MS, VORTEX_TINT,
} from '../config';
import {
    brushParam, DRAWING_KINDS, DRAWING_PARAM as P, DRAWING_PARAMS, drawingKey, type BrushOwner, type DrawingKind,
} from '../drawing';
import { t, type MessageKey } from '../i18n';
import {
    FORCE_TYPES, nextForce, nextShape, sameShape, SHAPE_STYLES, stepBrush, swapForce, type ForceType, type MaskTool,
    type MouseTool, type ShapeStyle, type ToolbarShortcut,
} from '../mouseTools';
import type { NumberParam, ParamDef } from '../simulation/algorithm';
import type { DrawingField } from '../simulation/drawing/DrawingField';
import { paramToSlider } from '../simulation/params';
import { screenToWorld, type ViewState } from '../view';
import { flash } from './dom';
import type { DrawingPanel } from './drawingPanel';
import { paramField, type ParamField, type ParamStore } from './paramPanel';
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
    /** The simulation area: its `data-tool` tells the CSS which tool is active (cursor). */
    container: HTMLElement;
    /** Where the mouse acts (the simulation canvas). */
    surface: HTMLElement;
    getView: () => ViewState;
    onViewChange: (listener: (view: ViewState) => void) => void;
}

// Icons: inner markup of a 24x24 SVG, stroked (`solid` parts filled).
const ICONS = {
    brush: '<path d="M18.4 3.6a2.1 2.1 0 0 1 3 3L12.6 15.4l-3-3z"/><path d="M9.2 13.2c-2.6 0-4.2 1.6-4.2 4 0 1.4-.8 2.4-2 3 4 .8 8.2-.6 8.2-4.6"/>',
    eraser: '<path d="M9 20h11"/><path d="M14.6 4.4l5 5a1.5 1.5 0 0 1 0 2.1L11 20H7.5l-3.1-3.1a1.5 1.5 0 0 1 0-2.1l8.1-10.4a1.5 1.5 0 0 1 2.1 0z"/><path d="M9.3 9.6l5.1 5.1"/>',
    ellipseFilled: '<ellipse class="solid" cx="12" cy="12" rx="8.5" ry="6.2"/>',
    ellipseHollow: '<ellipse cx="12" cy="12" rx="8.5" ry="6.2"/>',
    rectFilled: '<rect class="solid" x="3.5" y="6" width="17" height="12" rx="1.5"/>',
    rectHollow: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>',
    thickness: '<path d="M4 6h16" stroke-width="1"/><path d="M4 11.5h16" stroke-width="2.2"/><path d="M4 18h16" stroke-width="3.6"/>',
    attractor: '<circle class="solid" cx="12" cy="12" r="1.8"/><path d="M3 12h5M21 12h-5M12 3v5M12 21v-5M6 10l2 2-2 2M18 10l-2 2 2 2M10 6l2 2 2-2M10 18l2-2 2 2"/>',
    repeller: '<circle class="solid" cx="12" cy="12" r="1.8"/><path d="M4 12h4M16 12h4M12 4v4M12 16v4M6 10l-2 2 2 2M18 10l2 2-2 2M10 6l2-2 2 2M10 18l2 2 2-2"/>',
    vortex: '<path d="M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0"/>',
    size: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2"/>',
    flow: '<circle cx="12" cy="12" r="8.5"/><circle class="solid" cx="9" cy="9.5" r="1.2"/><circle class="solid" cx="14.5" cy="9" r="1.2"/><circle class="solid" cx="12" cy="13" r="1.2"/><circle class="solid" cx="8.5" cy="15" r="1.2"/><circle class="solid" cx="15.5" cy="14.5" r="1.2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    clear: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
} as const;
type Icon = keyof typeof ICONS;

const shapeId = (s: ShapeStyle) => `${s.shape}${s.filled ? 'Filled' : 'Hollow'}` as const;
const SHAPE_LABELS: Record<ReturnType<typeof shapeId>, MessageKey> = {
    ellipseFilled: 'toolbar.shape.ellipseFilled',
    ellipseHollow: 'toolbar.shape.ellipseHollow',
    rectFilled: 'toolbar.shape.rectFilled',
    rectHollow: 'toolbar.shape.rectHollow',
};
const FORCE_LABELS: Record<ForceType, MessageKey> = {
    attractor: 'toolbar.force.attractor',
    repeller: 'toolbar.force.repeller',
    vortex: 'toolbar.force.vortex',
};
const BRUSH_LABELS: Record<DrawingKind, MessageKey> = {
    attractor: 'toolbar.brush.attractor',
    repeller: 'toolbar.brush.repeller',
};
const KIND_LABELS: Record<DrawingKind, MessageKey> = {
    attractor: 'drawing.kind.attractor',
    repeller: 'drawing.kind.repeller',
};
const TINTS: Record<ForceType, readonly [number, number, number]> = {
    attractor: DRAWING_ATTRACTOR_TINT,
    repeller: DRAWING_REPELLER_TINT,
    vortex: VORTEX_TINT,
};
const tint = (type: ForceType): string => `rgb(${TINTS[type].join(', ')})`;

/** The tools that unfold their variants when pressed long. */
type Flyout = 'force' | 'brush' | 'shape';

/** A variant of a tool, in its flyout. */
interface Variant {
    readonly icon: Icon;
    readonly label: string;
    readonly tint?: ForceType;
    selected(): boolean;
    choose(): void;
}

/** The settings edited in a popover under their button. */
type Setting = 'size' | 'flow' | 'thickness';

interface Popover {
    readonly setting: Setting;
    readonly key: string;
    readonly param: NumberParam;
    readonly field: ParamField;
    readonly input: HTMLInputElement;
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

/** Names the button (screen readers) and documents it (tooltip). */
function describe(b: HTMLElement, label: string, doc: string): void {
    b.setAttribute('aria-label', label);
    b.dataset.tooltip = doc;
}

const press = (b: HTMLButtonElement, pressed: boolean): void => b.setAttribute('aria-pressed', String(pressed));

function group(label: MessageKey, ...buttons: HTMLElement[]): HTMLElement {
    const g = document.createElement('div');
    g.className = 'tb-group';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', t(label));
    g.append(...buttons);
    return g;
}

/**
 * The toolbar over the simulation: what the mouse does (the point force, the brush, the eraser, a
 * shape; clicking the active tool again drops it), the brush (size, density) and shape thickness
 * in popovers, and actions on the drawings. A long press (or a right click, or the down arrow) on
 * the point force, the brush or the shapes unfolds their variants: attraction, repulsion or vortex;
 * the attractor or repeller brush (the drawing tab's selected kind, which the eraser and the shapes
 * draw too); the four shapes. It holds the point force while its button is pressed; the mask tools
 * are DrawingPanel's. See setupShortcuts for its keys.
 */
export class MouseToolbar {
    private tool: MouseTool = 'none';
    private shape: ShapeStyle = SHAPE_STYLES[0];
    private force: ForceType = 'attractor';
    private held: Held | null = null;
    private popover: Popover | null = null;
    private readonly popoverElement = document.createElement('div');
    private readonly flyoutElement = document.createElement('div');
    private flyout: Flyout | null = null;
    private holdTimer: number | undefined;
    /** A long press opened the flyout: the click that ends it does not pick the tool. */
    private swallowClick = false;
    private readonly toolButtons: Record<Exclude<MouseTool, 'none'>, HTMLButtonElement>;
    private readonly settingButtons: Record<Setting, HTMLButtonElement>;
    private readonly eyeButton: HTMLButtonElement;
    private readonly clearButton: HTMLButtonElement;
    private pinned = false;
    private clearTimer: number | undefined;
    /** The popover's controls write the drawings' settings through the tab, which follows. */
    private readonly popoverStore: ParamStore;

    constructor(private readonly targets: ToolbarTargets) {
        const { root, drawing } = targets;
        this.popoverStore = { value: key => drawing.store.value(key), set: (key, value) => drawing.setParam(key, value) };

        this.toolButtons = {
            force: this.flyoutButton('force', this.force, () => this.toggleTool('force')),
            brush: this.flyoutButton('brush', 'brush', () => this.toggleTool('brush')),
            eraser: iconButton('eraser', () => this.toggleTool('eraser')),
            shape: this.flyoutButton('shape', shapeId(this.shape), () => this.toggleTool('shape')),
        };
        for (const b of Object.values(this.toolButtons)) b.classList.add('tb-tool');
        const settingButton = (setting: Setting): HTMLButtonElement => {
            const b = iconButton(setting, () => this.togglePopover(setting));
            b.setAttribute('aria-haspopup', 'dialog');
            b.addEventListener('wheel', e => {
                e.preventDefault();
                if (e.deltaY !== 0) this.step(setting, e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
            return b;
        };
        this.settingButtons = { size: settingButton('size'), flow: settingButton('flow'), thickness: settingButton('thickness') };
        this.eyeButton = iconButton('eye', () => this.togglePinned());
        describe(this.eyeButton, t('toolbar.showDrawings'), t('toolbar.showDrawings.doc'));
        this.clearButton = iconButton('clear', () => this.clearAll());
        this.clearButton.classList.add('tb-danger');
        describe(this.clearButton, t('toolbar.clearAll'), t('toolbar.clearAll.doc'));

        this.popoverElement.className = 'tb-popover';
        this.popoverElement.hidden = true;
        this.popoverElement.setAttribute('role', 'dialog');
        this.flyoutElement.className = 'tb-flyout';
        this.flyoutElement.hidden = true;
        this.flyoutElement.setAttribute('role', 'menu');
        const { force, brush, eraser, shape } = this.toolButtons;
        root.append(
            group('toolbar.group.force', force),
            group('toolbar.group.draw', brush, eraser, shape),
            group('toolbar.group.brush', this.settingButtons.size, this.settingButtons.flow, this.settingButtons.thickness),
            group('toolbar.group.actions', this.eyeButton, this.clearButton),
            this.popoverElement,
            this.flyoutElement,
        );
        setupTooltips(root, targets.tooltip);
        setupSliders(this.popoverElement);
        window.addEventListener('pointerdown', e => {
            const target = e.target instanceof Node ? e.target : null;
            if (this.popover && !(target && root.contains(target))) this.closePopover();
            if (this.flyout && !(target && this.flyoutElement.contains(target))) this.closeFlyout();
        });
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (this.popover) this.closePopover();
            if (this.flyout) this.closeFlyout();
        });
        this.listenToPointer(targets.surface);
        targets.onViewChange(() => this.applyForce());
        this.refresh();
    }

    /** Follows the drawings' settings and selected kind (call it when they change). */
    refresh(): void {
        const { drawing, container } = this.targets;
        const kind = drawing.selectedKind;
        const { force, brush, eraser, shape } = this.toolButtons;
        for (const [tool, b] of Object.entries(this.toolButtons)) press(b, this.tool === tool);
        setIcon(force, this.force);
        setIcon(shape, shapeId(this.shape));
        force.style.setProperty('--tb-tint', tint(this.force));
        for (const b of [brush, eraser, shape]) b.style.setProperty('--tb-tint', tint(kind));
        const forceName = t(FORCE_LABELS[this.force]);
        describe(force, forceName, t('toolbar.tool.force.doc', { name: forceName }));
        const brushName = t(BRUSH_LABELS[kind]);
        describe(brush, brushName, t('toolbar.tool.brush.doc', { name: brushName }));
        describe(eraser, t('toolbar.tool.eraser'), t('toolbar.tool.eraser.doc', { kind: t(KIND_LABELS[kind]) }));
        const shapeName = t(SHAPE_LABELS[shapeId(this.shape)]);
        describe(shape, shapeName, t(this.shape.shape === 'ellipse' ? 'toolbar.shape.ellipse.doc' : 'toolbar.shape.rect.doc',
            { name: shapeName, kind: t(KIND_LABELS[kind]) }));

        this.settingButtons.thickness.disabled = this.tool === 'shape' && this.shape.filled;
        for (const setting of ['size', 'flow', 'thickness'] as const) {
            const param = this.settingParam(setting);
            const value = drawing.store.value(param.key);
            const text = param.format(typeof value === 'number' ? value : param.default);
            describe(this.settingButtons[setting], param.label, t(`toolbar.${setting}.doc`, { value: text }));
        }
        container.dataset.tool = this.tool;
        if (this.flyout) this.renderFlyout(this.flyout);
        this.syncPopover();
        this.applyForce();
    }

    /** Applies a key of the toolbar (setupShortcuts). */
    shortcut(s: ToolbarShortcut): void {
        switch (s.action) {
            case 'tool':
                if (s.tool === 'force' && this.tool === 'force') this.chooseForce(nextForce(this.force));
                else this.selectTool(s.tool);
                break;
            case 'shape': this.selectTool('shape', this.tool === 'shape' ? nextShape(this.shape) : this.shape); break;
            case 'swap': this.swap(); break;
            case 'brush': this.step(s.key, s.direction); break;
        }
        flash(this.targets.root);
    }

    // ---- Selection ----

    /** The brush in use: the point force's type, or the selected kind of drawing. */
    private get owner(): BrushOwner {
        return this.tool === 'force' ? this.force : this.targets.drawing.selectedKind;
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
    private toggleTool(tool: Exclude<MouseTool, 'none'>): void {
        if (this.swallowClick) {
            this.swallowClick = false;
            return;
        }
        this.selectTool(this.tool === tool ? 'none' : tool);
    }

    private selectTool(tool: MouseTool, shape?: ShapeStyle): void {
        this.release();
        this.tool = tool;
        if (shape) this.shape = shape;
        this.targets.drawing.setMaskTool(this.maskTool());
        this.refresh();
    }

    private chooseForce(type: ForceType): void {
        this.force = type;
        this.selectTool('force');
    }

    private chooseBrush(kind: DrawingKind): void {
        this.targets.drawing.setKind(kind);
        this.selectTool('brush');
    }

    /** X: the opposite force type with the point force, else the other kind of drawing. */
    private swap(): void {
        if (this.tool === 'force') {
            this.chooseForce(swapForce(this.force));
            return;
        }
        this.targets.drawing.setKind(this.targets.drawing.selectedKind === 'attractor' ? 'repeller' : 'attractor');
        this.refresh();
    }

    // ---- Flyouts (variants of a tool) ----

    /** A tool button that unfolds its variants on a long press, a right click or the down arrow. */
    private flyoutButton(flyout: Flyout, icon: Icon, onClick: () => void): HTMLButtonElement {
        const b = iconButton(icon, onClick);
        b.classList.add('tb-has-flyout');
        b.setAttribute('aria-haspopup', 'menu');
        b.addEventListener('pointerdown', e => {
            this.swallowClick = false;
            window.clearTimeout(this.holdTimer);
            if (e.button !== 0) return;
            this.holdTimer = window.setTimeout(() => {
                this.swallowClick = true;
                this.openFlyout(flyout);
            }, TOOLBAR_HOLD_MS);
        });
        const cancel = (): void => window.clearTimeout(this.holdTimer);
        b.addEventListener('pointerup', cancel);
        b.addEventListener('pointerleave', cancel);
        b.addEventListener('contextmenu', e => {
            e.preventDefault();
            this.openFlyout(flyout);
        });
        b.addEventListener('keydown', e => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            this.openFlyout(flyout);
            this.flyoutElement.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
        });
        return b;
    }

    private variants(flyout: Flyout): Variant[] {
        switch (flyout) {
            case 'force':
                return FORCE_TYPES.map(type => ({
                    icon: type, label: t(FORCE_LABELS[type]), tint: type,
                    selected: () => this.force === type, choose: () => this.chooseForce(type),
                }));
            case 'brush':
                return DRAWING_KINDS.map(kind => ({
                    icon: 'brush', label: t(BRUSH_LABELS[kind]), tint: kind,
                    selected: () => this.targets.drawing.selectedKind === kind, choose: () => this.chooseBrush(kind),
                }));
            case 'shape':
                return SHAPE_STYLES.map(style => ({
                    icon: shapeId(style), label: t(SHAPE_LABELS[shapeId(style)]),
                    selected: () => sameShape(this.shape, style), choose: () => this.selectTool('shape', style),
                }));
        }
    }

    private openFlyout(flyout: Flyout): void {
        window.clearTimeout(this.holdTimer);
        this.closePopover();
        this.flyout = flyout;
        this.renderFlyout(flyout);
        const anchor = this.toolButtons[flyout];
        this.flyoutElement.style.left = `${anchor.offsetLeft + anchor.offsetWidth / 2}px`;
        this.flyoutElement.hidden = false;
        this.targets.root.classList.add('popover-open');
        anchor.setAttribute('aria-expanded', 'true');
    }

    private renderFlyout(flyout: Flyout): void {
        const items = this.variants(flyout).map(variant => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'tb-flyout-item';
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', String(variant.selected()));
            item.innerHTML = svg(variant.icon);
            const label = document.createElement('span');
            label.textContent = variant.label;
            item.appendChild(label);
            if (variant.tint) item.style.setProperty('--tb-tint', tint(variant.tint));
            const choose = (): void => {
                if (this.flyout === null) return;
                this.closeFlyout();
                variant.choose();
            };
            // Released over an item after a long press, or clicked once unfolded.
            item.addEventListener('pointerup', choose);
            item.addEventListener('click', choose);
            item.addEventListener('keydown', e => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                e.preventDefault();
                const next = e.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
                if (next instanceof HTMLElement) next.focus();
            });
            return item;
        });
        this.flyoutElement.replaceChildren(...items);
    }

    private closeFlyout(): void {
        if (!this.flyout) return;
        const anchor = this.toolButtons[this.flyout];
        anchor.setAttribute('aria-expanded', 'false');
        this.flyout = null;
        this.flyoutElement.hidden = true;
        this.flyoutElement.replaceChildren();
        if (!this.popover) this.targets.root.classList.remove('popover-open');
        if (this.flyoutElement.contains(document.activeElement)) anchor.focus();
    }

    // ---- Settings (popovers, wheel, keys) ----

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

    private togglePopover(setting: Setting): void {
        if (this.popover?.setting === setting) this.closePopover();
        else this.openPopover(setting);
    }

    private openPopover(setting: Setting): void {
        this.closeFlyout();
        const param = this.settingParam(setting);
        const field = paramField(param, this.popoverStore);
        field.element.dataset.tooltipPlacement = 'below';
        const input = field.element.querySelector('input');
        if (!input) throw new Error('A number field has a slider');
        this.popoverElement.replaceChildren(field.element);
        syncRange(input);
        field.update();                         // paints the value
        const anchor = this.settingButtons[setting];
        this.popoverElement.style.left = `${anchor.offsetLeft + anchor.offsetWidth / 2}px`;
        this.popoverElement.hidden = false;
        this.targets.root.classList.add('popover-open');
        for (const [s, b] of Object.entries(this.settingButtons)) b.setAttribute('aria-expanded', String(s === setting));
        this.popover = { setting, key: param.key, param, field, input };
    }

    private closePopover(): void {
        if (!this.popover) return;
        this.popover = null;
        this.popoverElement.hidden = true;
        this.popoverElement.replaceChildren();
        if (!this.flyout) this.targets.root.classList.remove('popover-open');
        for (const b of Object.values(this.settingButtons)) b.setAttribute('aria-expanded', 'false');
    }

    /** The open popover follows the setting: another brush's (rebuilt), or a value changed elsewhere. */
    private syncPopover(): void {
        const popover = this.popover;
        if (!popover) return;
        if (this.settingParam(popover.setting).key !== popover.key) {
            this.openPopover(popover.setting);
            return;
        }
        const value = this.targets.drawing.store.value(popover.key);
        if (typeof value !== 'number') return;
        const position = String(paramToSlider(popover.param, value));
        if (popover.input.value === position) return;
        popover.input.value = position;
        syncRange(popover.input);
        popover.field.update();
    }

    // ---- Actions ----

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

    // ---- The point force ----

    private listenToPointer(surface: HTMLElement): void {
        surface.addEventListener('contextmenu', e => { if (this.tool === 'force') e.preventDefault(); });
        surface.addEventListener('pointerdown', e => {
            if (this.tool !== 'force' || this.held || (e.button !== 0 && e.button !== 2)) return;
            e.preventDefault();
            surface.setPointerCapture(e.pointerId);
            this.held = { pointerId: e.pointerId, reversed: e.button === 2 || e.shiftKey, clientX: e.clientX, clientY: e.clientY };
            this.applyForce();
        });
        surface.addEventListener('pointermove', e => {
            if (!this.held || e.pointerId !== this.held.pointerId) return;
            this.held.clientX = e.clientX;
            this.held.clientY = e.clientY;
            this.applyForce();
        });
        const end = (e: PointerEvent): void => { if (e.pointerId === this.held?.pointerId) this.release(); };
        surface.addEventListener('pointerup', end);
        surface.addEventListener('pointercancel', end);
        surface.addEventListener('lostpointercapture', end);
        window.addEventListener('blur', () => this.release());
    }

    /** Puts the held force under the pointer, with the current type and brush. */
    private applyForce(): void {
        const held = this.held;
        if (!held) return;
        const { surface, getView, drawing, field } = this.targets;
        const box = surface.getBoundingClientRect();
        const view = getView();
        const world = screenToWorld(view, { x: held.clientX - box.left, y: held.clientY - box.top }, box.width, box.height);
        const brush = drawing.brush(this.force);
        field.setPointForce({
            x: world.x, y: world.y, type: this.force, reversed: held.reversed,
            diameter: brush.size / view.zoom, flow: brush.flow / 100,
        });
    }

    private release(): void {
        if (!this.held) return;
        this.held = null;
        this.targets.field.setPointForce(null);
    }
}
