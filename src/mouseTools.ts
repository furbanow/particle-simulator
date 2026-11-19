// What the mouse does on the simulation, as the toolbar sets it: the tools, the shapes, the types of
// point force, the keyboard shortcuts and the gains of the point force. Pure (tested); ui/toolbar.ts
// builds the toolbar, ui/drawingPanel.ts draws the masks.

import {
    BRUSH_FLOW_KEY_STEP, BRUSH_SIZE_KEY_FACTOR, DRAWING_GRAVITY_UNIT, DRAWING_POINT_MASS, DRAWING_VORTEX_STRENGTH,
} from './config';
import type { DrawingKind } from './drawing';
import type { NumberParam } from './simulation/algorithm';
import { panelParamValue } from './simulation/params';

/**
 * The tool of the mouse: none (a click does nothing), the point force (held under the pointer),
 * the brush and the eraser (the selected kind's drawn mask), a shape (dragged on the mask).
 */
export type MouseTool = 'none' | 'force' | 'brush' | 'eraser' | 'shape';

export type ShapeKind = 'ellipse' | 'rect';

/** A shape tool: its outline, filled or hollow. */
export interface ShapeStyle {
    readonly shape: ShapeKind;
    readonly filled: boolean;
}

/** The shape tools, in toolbar order (U goes through them). */
export const SHAPE_STYLES: readonly ShapeStyle[] = [
    { shape: 'ellipse', filled: true },
    { shape: 'ellipse', filled: false },
    { shape: 'rect', filled: true },
    { shape: 'rect', filled: false },
];

export const sameShape = (a: ShapeStyle, b: ShapeStyle): boolean => a.shape === b.shape && a.filled === b.filled;

/** The shape after `style` in SHAPE_STYLES, back to the first after the last. */
export function nextShape(style: ShapeStyle): ShapeStyle {
    const i = SHAPE_STYLES.findIndex(s => sameShape(s, style));
    return SHAPE_STYLES[(i + 1) % SHAPE_STYLES.length];
}

/** What a tool editing the drawn mask does (the brush, the eraser, a shape). */
export type MaskTool =
    | { readonly tool: 'brush' | 'eraser' }
    | { readonly tool: 'shape'; readonly style: ShapeStyle };

/** The type of the point force: the pull of an attractor, the push of a repeller, or a swirl. */
export type ForceType = DrawingKind | 'vortex';

/** The types of point force, in toolbar order (F, pressed again, goes through them). */
export const FORCE_TYPES: readonly ForceType[] = ['attractor', 'repeller', 'vortex'];

/** The force type after `type` in FORCE_TYPES, back to the first after the last. */
export const nextForce = (type: ForceType): ForceType => FORCE_TYPES[(FORCE_TYPES.indexOf(type) + 1) % FORCE_TYPES.length];

/** The opposite of a force type (X): attraction and repulsion swap, the vortex gives attraction. */
export const swapForce = (type: ForceType): ForceType => type === 'attractor' ? 'repeller' : 'attractor';

/** The point force held under the mouse. */
export interface PointForce {
    /** World position (px of the simulation area, y up). */
    readonly x: number;
    readonly y: number;
    readonly type: ForceType;
    /** The opposite force (right button): pushes instead of pulling, swirls clockwise. */
    readonly reversed: boolean;
    /** The brush diameter, world px: twice the softening length. */
    readonly diameter: number;
    /** The brush density, 0..1. */
    readonly flow: number;
}

/** The uniforms of the point force in drawing.glsl. */
export interface PointForceGains {
    /** Pull (px^3/s^2 per unit of r / (r^2 + eps^2)^(3/2)); negative: pushes. */
    readonly radial: number;
    /** Same, tangential: counterclockwise when positive. */
    readonly swirl: number;
    /** eps^2, px^2. */
    readonly softening2: number;
}

export const NO_POINT_FORCE: PointForceGains = { radial: 0, swirl: 0, softening2: 1 };

/**
 * The gains of the point force: a softened point mass M = DRAWING_POINT_MASS * flow * pi * eps^2 (eps
 * the brush radius) pulling as a drawing of that mass would (the kind's strength, length L), or
 * swirling with DRAWING_VORTEX_STRENGTH. Its peak acceleration depends on the density only.
 */
export function pointForceGains(force: PointForce | null, strengths: Readonly<Record<DrawingKind, number>>, length: number): PointForceGains {
    if (!force) return NO_POINT_FORCE;
    const eps = Math.max(force.diameter / 2, 0.5);
    const mass = DRAWING_POINT_MASS * Math.max(0, force.flow) * Math.PI * eps * eps;
    const sign = force.reversed ? -1 : 1;
    const gain = (strength: number): number => sign * strength * DRAWING_GRAVITY_UNIT * length * mass;
    return {
        radial: force.type === 'attractor' ? gain(strengths.attractor)
            : force.type === 'repeller' ? -gain(strengths.repeller) : 0,
        swirl: force.type === 'vortex' ? gain(DRAWING_VORTEX_STRENGTH) : 0,
        softening2: eps * eps,
    };
}

/** Acceleration (px/s^2, along r for radial, across it for swirl) at `distance` px from the point, as drawing.glsl computes it. */
export function pointForceAccel(gains: PointForceGains, distance: number): { radial: number; swirl: number } {
    const s = 1 / Math.sqrt(distance * distance + gains.softening2);
    const k = distance * s * s * s;
    return { radial: gains.radial * k, swirl: gains.swirl * k };
}

/** A key of the toolbar. */
export type ToolbarShortcut =
    | { readonly action: 'tool'; readonly tool: Exclude<MouseTool, 'shape'> }
    | { readonly action: 'shape' }
    | { readonly action: 'swap' }
    | { readonly action: 'brush'; readonly key: 'size' | 'flow'; readonly direction: -1 | 1 };

const TOOL_KEYS: Readonly<Record<string, Exclude<MouseTool, 'shape'>>> = { v: 'none', f: 'force', b: 'brush', e: 'eraser' };

/**
 * The toolbar's shortcut of a key: V drops the tool, F, B, E pick a tool (F again: the next force
 * type), U a shape (again: the next one), X swaps attraction and repulsion, [ and ] shrink and grow the brush (with Shift: its density). The brackets are read by
 * their position (`code`), so they work on every keyboard layout.
 */
export function toolbarShortcut(key: string, code: string, shift: boolean): ToolbarShortcut | null {
    if (code === 'BracketLeft' || code === 'BracketRight') {
        return { action: 'brush', key: shift ? 'flow' : 'size', direction: code === 'BracketLeft' ? -1 : 1 };
    }
    const k = key.toLowerCase();
    const tool = TOOL_KEYS[k];
    if (tool) return { action: 'tool', tool };
    if (k === 'u') return { action: 'shape' };
    if (k === 'x') return { action: 'swap' };
    return null;
}

/**
 * The brush setting one step up or down, as the panel holds it: the size by BRUSH_SIZE_KEY_FACTOR
 * (at least one slider step), the density (%) by BRUSH_FLOW_KEY_STEP, within the slider.
 */
export function stepBrush(param: NumberParam, value: number, key: 'size' | 'flow', direction: -1 | 1): number {
    const next = key === 'size'
        ? direction > 0 ? Math.max(value * BRUSH_SIZE_KEY_FACTOR, value + param.step) : Math.min(value / BRUSH_SIZE_KEY_FACTOR, value - param.step)
        : value + direction * BRUSH_FLOW_KEY_STEP;
    return panelParamValue(param, next) as number;
}
