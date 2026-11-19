import { describe, expect, it } from 'vitest';
import { containRect, densityFromPixel, hollowStroke, shapeRect, wrapText } from '../src/drawingMask';

const measure = (s: string): number => s.length;   // one unit per character

describe('drawing mask', () => {
    it('fits an image inside the area, centered, keeping its aspect ratio', () => {
        expect(containRect(200, 100, 400, 400)).toEqual({ x: 0, y: 100, width: 400, height: 200 });
        expect(containRect(100, 200, 400, 200)).toEqual({ x: 150, y: 0, width: 100, height: 200 });
        expect(containRect(0, 10, 400, 200).width).toBe(0);
    });

    it('wraps a text at its line breaks, then between words', () => {
        expect(wrapText('un deux trois', 7, measure)).toEqual(['un deux', 'trois']);
        expect(wrapText('a\n\nb', 10, measure)).toEqual(['a', '', 'b']);
        expect(wrapText('un  deux', 20, measure)).toEqual(['un deux']);
        expect(wrapText('', 10, measure)).toEqual(['']);
    });

    it('cuts a word wider than a line between characters', () => {
        expect(wrapText('abcdefgh ij', 3, measure)).toEqual(['abc', 'def', 'gh', 'ij']);
    });

    it('makes bright opaque pixels dense, dark or transparent ones empty', () => {
        expect(densityFromPixel(255, 255, 255, 255, false)).toBeCloseTo(1);
        expect(densityFromPixel(0, 0, 0, 255, false)).toBe(0);
        expect(densityFromPixel(255, 255, 255, 0, false)).toBe(0);
        expect(densityFromPixel(0, 0, 0, 255, true)).toBeCloseTo(1);
        expect(densityFromPixel(0, 0, 0, 0, true)).toBe(0);
        expect(densityFromPixel(0, 255, 0, 255, false)).toBeCloseTo(0.7152);
    });

    it('frames a dragged shape whichever way it is dragged', () => {
        const frame = { x: 10, y: 20, width: 30, height: 40 };
        expect(shapeRect({ x: 10, y: 20 }, { x: 40, y: 60 }, false, false)).toEqual(frame);
        expect(shapeRect({ x: 40, y: 60 }, { x: 10, y: 20 }, false, false)).toEqual(frame);
        expect(shapeRect({ x: 40, y: 20 }, { x: 10, y: 60 }, false, false)).toEqual(frame);
        expect(shapeRect({ x: 10, y: 60 }, { x: 40, y: 20 }, false, false)).toEqual(frame);
        expect(shapeRect({ x: 5, y: 5 }, { x: 5, y: 5 }, false, false)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
    });

    it('makes a square of the longer side toward the pointer with Shift, centers it with Alt', () => {
        expect(shapeRect({ x: 100, y: 100 }, { x: 130, y: 110 }, true, false)).toEqual({ x: 100, y: 100, width: 30, height: 30 });
        expect(shapeRect({ x: 100, y: 100 }, { x: 90, y: 60 }, true, false)).toEqual({ x: 60, y: 60, width: 40, height: 40 });
        expect(shapeRect({ x: 100, y: 100 }, { x: 130, y: 90 }, false, true)).toEqual({ x: 70, y: 90, width: 60, height: 20 });
        expect(shapeRect({ x: 100, y: 100 }, { x: 130, y: 90 }, true, true)).toEqual({ x: 70, y: 70, width: 60, height: 60 });
    });

    it('insets the outline of a hollow shape, or fills a shape too small for it', () => {
        const rect = { x: 0, y: 0, width: 100, height: 60 };
        expect(hollowStroke(rect, 10)).toEqual({ inset: 5, lineWidth: 10 });
        expect(hollowStroke(rect, 30)).toBeNull();
        expect(hollowStroke(rect, 0)).toBeNull();
    });
});
