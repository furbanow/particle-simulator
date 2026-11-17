import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN } from '../src/config';
import { canvasTransform, clampCenter, clampZoom, screenToCanvas, screenToWorld, zoomAt, type ViewState } from '../src/view';

const W = 800;
const H = 600;
const home: ViewState = { zoom: 1, center: { x: W / 2, y: H / 2 } };

describe('view', () => {
    it('clamps the zoom', () => {
        expect(clampZoom(0.1)).toBe(ZOOM_MIN);
        expect(clampZoom(1e6)).toBe(ZOOM_MAX);
    });

    it('keeps the view inside the world', () => {
        expect(clampCenter(1, { x: 0, y: 9999 }, W, H)).toEqual({ x: W / 2, y: H / 2 });
        const c = clampCenter(2, { x: 0, y: 9999 }, W, H);
        expect(c).toEqual({ x: W / 4, y: H - H / 4 });
    });

    it('keeps the anchor fixed on screen', () => {
        const anchor = { x: 600, y: 450 };
        const screenBefore = { x: W / 2 + (anchor.x - home.center.x), y: H / 2 - (anchor.y - home.center.y) };
        const zoomed = zoomAt(home, 2, anchor, W, H);
        expect(zoomed.zoom).toBe(2);
        const back = screenToWorld(zoomed, screenBefore, W, H);
        expect(back.x).toBeCloseTo(anchor.x);
        expect(back.y).toBeCloseTo(anchor.y);
    });

    it('does not zoom out past the world', () => {
        expect(zoomAt(home, 0.5, { x: 100, y: 100 }, W, H)).toEqual(home);
    });

    it('converts screen to canvas coordinates (y down)', () => {
        const p = screenToCanvas(home, { x: 10, y: 20 }, W, H);
        expect(p).toEqual({ x: 10, y: 20 });
    });

    it('lays the canvas over the view', () => {
        expect(canvasTransform(home, W, H)).toBe('translate(0px, 0px) scale(1)');
    });
});
