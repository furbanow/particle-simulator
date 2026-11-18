import { describe, expect, it } from 'vitest';
import { containRect, densityFromPixel, wrapText } from '../src/drawingMask';

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
});
