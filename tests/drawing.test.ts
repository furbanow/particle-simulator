import { describe, expect, it } from 'vitest';
import { DRAWING_BRUSH_SIZE_SLIDER, DRAWING_SHAPE_THICKNESS_SLIDER, DRAWING_STRENGTH_SLIDER, DRAWING_TEXT_MAX } from '../src/config';
import {
    ALL_DRAWING_PARAMS, brushNumber, DRAWING_KINDS, VORTEX_PARAMS, DRAWING_PARAM, DRAWING_PARAMS, drawingFont, drawingKey, drawingMode,
    drawingNumber, drawingTip, DEFAULT_DRAWING_TEXTS, defaultDrawing, sanitizeDrawingSettings,
} from '../src/drawing';
import { panelParamValue } from '../src/simulation/params';

describe('drawing settings', () => {
    it('declare each key once per kind, in the drawing tab, documented', () => {
        for (const kind of DRAWING_KINDS) {
            expect(DRAWING_PARAMS[kind].map(p => p.key)).toEqual(Object.values(DRAWING_PARAM).map(k => drawingKey(kind, k)));
        }
        const keys = ALL_DRAWING_PARAMS.map(p => p.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const param of ALL_DRAWING_PARAMS) {
            expect(param.tab).toBe('drawing');
            expect(param.doc.length).toBeGreaterThan(param.label.length);
        }
    });

    // Otherwise a config would read as modified as soon as the panel has shown it.
    it('have defaults that the panel gives back unchanged', () => {
        for (const param of ALL_DRAWING_PARAMS) expect(panelParamValue(param, param.default)).toBe(param.default);
    });

    it('default every missing or invalid setting', () => {
        const defaults = defaultDrawing();
        expect(defaults.texts).toEqual(DEFAULT_DRAWING_TEXTS);
        for (const kind of DRAWING_KINDS) expect(drawingMode(defaults, kind)).toBe('draw');
        const junk = [null, 42, 'x', { params: 3 }, { params: { 'attractor.strength': 'fort', 'attractor.mode': 'laser' }, texts: 5 }];
        for (const raw of junk) expect(sanitizeDrawingSettings(raw)).toEqual(defaults);
    });

    it('keep valid settings per kind, clamp numbers and cut the text', () => {
        const settings = sanitizeDrawingSettings({
            params: { 'repeller.mode': 'text', 'repeller.strength': 1000, 'repeller.bold': false, 'repeller.fontFamily': 'serif' },
            texts: { repeller: 'x'.repeat(DRAWING_TEXT_MAX + 10) },
        });
        expect(drawingMode(settings, 'repeller')).toBe('text');
        expect(drawingMode(settings, 'attractor')).toBe('draw');
        expect(drawingNumber(settings, 'repeller', 'strength')).toBe(DRAWING_STRENGTH_SLIDER.max);
        expect(drawingNumber(settings, 'attractor', 'strength')).toBe(DRAWING_STRENGTH_SLIDER.default);
        expect(settings.texts.repeller).toHaveLength(DRAWING_TEXT_MAX);
        expect(settings.texts.attractor).toBe(DEFAULT_DRAWING_TEXTS.attractor);
        expect(drawingFont(settings, 'repeller')).toMatch(/^400 \d+px Georgia/);
    });

    it('read the settings saved before drawings had kinds as the attractor\'s', () => {
        const settings = sanitizeDrawingSettings({ params: { strength: 5, mode: 'text', fontFamily: 'mono' }, text: 'Old' });
        expect(drawingNumber(settings, 'attractor', 'strength')).toBe(5);
        expect(drawingMode(settings, 'attractor')).toBe('text');
        expect(settings.texts.attractor).toBe('Old');
        expect(drawingNumber(settings, 'repeller', 'strength')).toBe(DRAWING_STRENGTH_SLIDER.default);
        expect(settings.texts.repeller).toBe(DEFAULT_DRAWING_TEXTS.repeller);
    });

    it('build the CSS font of the text', () => {
        const settings = sanitizeDrawingSettings({
            params: { 'attractor.italic': true, 'attractor.bold': true, 'attractor.fontSize': 100, 'attractor.fontFamily': 'inter' },
        });
        expect(drawingFont(settings, 'attractor')).toBe('italic 700 100px \'Inter\', sans-serif');
    });

    it('give the vortex a brush of its own, saved with the drawings', () => {
        expect(VORTEX_PARAMS.map(p => p.key)).toEqual(['vortex.brushSize', 'vortex.brushFlow']);
        for (const param of VORTEX_PARAMS) expect(ALL_DRAWING_PARAMS).toContain(param);
        const defaults = defaultDrawing();
        expect(brushNumber(defaults, 'vortex', 'brushSize')).toBe(DRAWING_BRUSH_SIZE_SLIDER.default);
        const settings = sanitizeDrawingSettings({ params: { 'vortex.brushSize': 90, 'vortex.brushFlow': 'dense' } });
        expect(brushNumber(settings, 'vortex', 'brushSize')).toBe(90);
        expect(brushNumber(settings, 'vortex', 'brushFlow')).toBe(brushNumber(defaults, 'vortex', 'brushFlow'));
        expect(brushNumber(settings, 'attractor', 'brushSize')).toBe(DRAWING_BRUSH_SIZE_SLIDER.default);
    });

    it('keep the shape thickness of each kind, within its slider', () => {
        const settings = sanitizeDrawingSettings({ params: { 'attractor.shapeThickness': 7, 'repeller.shapeThickness': 1e6 } });
        expect(drawingNumber(settings, 'attractor', DRAWING_PARAM.shapeThickness)).toBe(7);
        expect(drawingNumber(settings, 'repeller', DRAWING_PARAM.shapeThickness)).toBe(DRAWING_SHAPE_THICKNESS_SLIDER.max);
        expect(drawingNumber(defaultDrawing(), 'attractor', DRAWING_PARAM.shapeThickness)).toBe(DRAWING_SHAPE_THICKNESS_SLIDER.default);
    });

    it('keep the brush tip of each kind, soft by default', () => {
        const settings = sanitizeDrawingSettings({ params: { 'attractor.brushTip': 'spray', 'repeller.brushTip': 'felt' } });
        expect(drawingTip(settings, 'attractor')).toBe('spray');
        expect(drawingTip(settings, 'repeller')).toBe('soft');
        expect(drawingTip(defaultDrawing(), 'attractor')).toBe('soft');
    });
});
