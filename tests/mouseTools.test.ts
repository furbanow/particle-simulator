import { describe, expect, it } from 'vitest';
import { BRUSH_FLOW_KEY_STEP, DRAWING_BRUSH_FLOW_SLIDER, DRAWING_BRUSH_SIZE_SLIDER } from '../src/config';
import { brushParam } from '../src/drawing';
import {
    FORCE_TYPES, nextForce, nextShape, pointForceAccel, swapForce, pointForceGains, SHAPE_STYLES, stepBrush, toolbarShortcut, type PointForce,
} from '../src/mouseTools';
import type { NumberParam } from '../src/simulation/algorithm';

const STRENGTHS = { attractor: 2, repeller: 3 };
const LENGTH = 800;
const force = (over: Partial<PointForce> = {}): PointForce =>
    ({ x: 100, y: 200, type: 'attractor', reversed: false, diameter: 60, flow: 0.25, ...over });

describe('point force', () => {
    it('pulls for an attractor, pushes for a repeller, swirls for a vortex', () => {
        const pull = pointForceGains(force(), STRENGTHS, LENGTH);
        expect(pull.radial).toBeGreaterThan(0);
        expect(pull.swirl).toBe(0);
        const push = pointForceGains(force({ type: 'repeller' }), STRENGTHS, LENGTH);
        expect(push.radial).toBeLessThan(0);
        expect(push.swirl).toBe(0);
        // Each kind keeps its own strength.
        expect(-push.radial / pull.radial).toBeCloseTo(STRENGTHS.repeller / STRENGTHS.attractor);
        const swirl = pointForceGains(force({ type: 'vortex' }), STRENGTHS, LENGTH);
        expect(swirl.radial).toBe(0);
        expect(swirl.swirl).toBeGreaterThan(0);
    });

    it('is reversed by the right button', () => {
        for (const type of ['attractor', 'repeller', 'vortex'] as const) {
            const gains = pointForceGains(force({ type }), STRENGTHS, LENGTH);
            const reversed = pointForceGains(force({ type, reversed: true }), STRENGTHS, LENGTH);
            expect(reversed.radial + gains.radial).toBe(0);
            expect(reversed.swirl + gains.swirl).toBe(0);
            expect(Math.abs(gains.radial) + Math.abs(gains.swirl)).toBeGreaterThan(0);
        }
    });

    it('vanishes without a force, a density or a strength', () => {
        expect(pointForceGains(null, STRENGTHS, LENGTH)).toMatchObject({ radial: 0, swirl: 0 });
        expect(pointForceGains(force({ flow: 0 }), STRENGTHS, LENGTH).radial).toBe(0);
        expect(pointForceGains(force(), { attractor: 0, repeller: 3 }, LENGTH).radial).toBe(0);
    });

    it('is softened over the brush radius', () => {
        expect(pointForceGains(force({ diameter: 60 }), STRENGTHS, LENGTH).softening2).toBe(900);
    });

    it('peaks at the same acceleration whatever its size, and reaches farther when larger', () => {
        const peak = (diameter: number): number => {
            const gains = pointForceGains(force({ diameter }), STRENGTHS, LENGTH);
            return pointForceAccel(gains, diameter / 2 / Math.SQRT2).radial;
        };
        expect(peak(200)).toBeCloseTo(peak(20), 6);
        const far = (diameter: number): number => pointForceAccel(pointForceGains(force({ diameter }), STRENGTHS, LENGTH), 400).radial;
        expect(far(200)).toBeGreaterThan(far(20));
        // Twice the density, twice the pull.
        const half = pointForceGains(force({ flow: 0.25 }), STRENGTHS, LENGTH).radial;
        expect(pointForceGains(force({ flow: 0.5 }), STRENGTHS, LENGTH).radial).toBeCloseTo(2 * half);
    });
});

describe('toolbar shortcuts', () => {
    it('pick the tools, the next shape and swap the force', () => {
        expect(toolbarShortcut('v', 'KeyV', false)).toEqual({ action: 'tool', tool: 'none' });
        expect(toolbarShortcut('F', 'KeyF', true)).toEqual({ action: 'tool', tool: 'force' });
        expect(toolbarShortcut('b', 'KeyB', false)).toEqual({ action: 'tool', tool: 'brush' });
        expect(toolbarShortcut('e', 'KeyE', false)).toEqual({ action: 'tool', tool: 'eraser' });
        expect(toolbarShortcut('u', 'KeyU', false)).toEqual({ action: 'shape' });
        expect(toolbarShortcut('x', 'KeyX', false)).toEqual({ action: 'swap' });
        expect(toolbarShortcut('r', 'KeyR', false)).toBeNull();
        expect(toolbarShortcut(' ', 'Space', false)).toBeNull();
    });

    it('read the brackets by their position, whatever the layout', () => {
        // AZERTY: the key right of P gives '^' and the next one '$'.
        expect(toolbarShortcut('^', 'BracketLeft', false)).toEqual({ action: 'brush', key: 'size', direction: -1 });
        expect(toolbarShortcut('$', 'BracketRight', false)).toEqual({ action: 'brush', key: 'size', direction: 1 });
        expect(toolbarShortcut('{', 'BracketLeft', true)).toEqual({ action: 'brush', key: 'flow', direction: -1 });
        expect(toolbarShortcut('}', 'BracketRight', true)).toEqual({ action: 'brush', key: 'flow', direction: 1 });
    });

    it('go through every force type with F, swap attraction and repulsion with X', () => {
        expect(FORCE_TYPES.map(nextForce)).toEqual(['repeller', 'vortex', 'attractor']);
        expect(swapForce('attractor')).toBe('repeller');
        expect(swapForce('repeller')).toBe('attractor');
        expect(swapForce('vortex')).toBe('attractor');
    });

    it('go through every shape, then back to the first', () => {
        let style = SHAPE_STYLES[0];
        const seen = [style];
        for (let i = 1; i < SHAPE_STYLES.length; i++) seen.push(style = nextShape(style));
        expect(seen).toEqual(SHAPE_STYLES);
        expect(nextShape(style)).toEqual(SHAPE_STYLES[0]);
    });
});

describe('brush steps', () => {
    const size = brushParam('attractor', 'brushSize') as NumberParam;
    const flow = brushParam('vortex', 'brushFlow') as NumberParam;

    it('grow and shrink the size by a factor, at least one step, within the slider', () => {
        expect(stepBrush(size, 100, 'size', 1)).toBe(115);
        expect(stepBrush(size, 115, 'size', -1)).toBe(100);
        expect(stepBrush(size, DRAWING_BRUSH_SIZE_SLIDER.min, 'size', 1)).toBe(DRAWING_BRUSH_SIZE_SLIDER.min + 1);
        expect(stepBrush(size, DRAWING_BRUSH_SIZE_SLIDER.min, 'size', -1)).toBe(DRAWING_BRUSH_SIZE_SLIDER.min);
        expect(stepBrush(size, DRAWING_BRUSH_SIZE_SLIDER.max, 'size', 1)).toBe(DRAWING_BRUSH_SIZE_SLIDER.max);
    });

    it('change the density by a fixed step, within the slider', () => {
        expect(stepBrush(flow, 50, 'flow', 1)).toBe(50 + BRUSH_FLOW_KEY_STEP);
        expect(stepBrush(flow, 50, 'flow', -1)).toBe(50 - BRUSH_FLOW_KEY_STEP);
        expect(stepBrush(flow, DRAWING_BRUSH_FLOW_SLIDER.min, 'flow', -1)).toBe(DRAWING_BRUSH_FLOW_SLIDER.min);
        expect(stepBrush(flow, DRAWING_BRUSH_FLOW_SLIDER.max, 'flow', 1)).toBe(DRAWING_BRUSH_FLOW_SLIDER.max);
    });
});
