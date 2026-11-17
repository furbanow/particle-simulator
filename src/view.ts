import { ZOOM_MAX, ZOOM_MIN } from './config';

/** A point of the world (CSS px of the simulation area, y up) or of the screen (y down), per the function using it. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

/** The visual zoom: the world point `center` is shown at the middle of the area, `zoom` screen px per world px. */
export interface ViewState {
    readonly zoom: number;
    readonly center: Point;
}

export function clampZoom(zoom: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Keeps the visible part inside the world (width x height). */
export function clampCenter(zoom: number, center: Point, width: number, height: number): Point {
    const clampAxis = (c: number, size: number): number => {
        const half = size / (2 * zoom);
        return Math.min(size - half, Math.max(half, c));
    };
    return { x: clampAxis(center.x, width), y: clampAxis(center.y, height) };
}

/** Zooms by `factor`, the world point `anchor` staying where it is on the screen. */
export function zoomAt(view: ViewState, factor: number, anchor: Point, width: number, height: number): ViewState {
    const zoom = clampZoom(view.zoom * factor);
    const ratio = view.zoom / zoom;
    const center = {
        x: anchor.x - (anchor.x - view.center.x) * ratio,
        y: anchor.y - (anchor.y - view.center.y) * ratio,
    };
    return { zoom, center: clampCenter(zoom, center, width, height) };
}

/** Screen position (CSS px from the top left corner of the area) to world position (y up). */
export function screenToWorld(view: ViewState, screen: Point, width: number, height: number): Point {
    return {
        x: view.center.x + (screen.x - width / 2) / view.zoom,
        y: view.center.y - (screen.y - height / 2) / view.zoom,
    };
}

/** Screen position to the canvas coordinates of the world (CSS px from its top left corner, y down). */
export function screenToCanvas(view: ViewState, screen: Point, width: number, height: number): Point {
    const world = screenToWorld(view, screen, width, height);
    return { x: world.x, y: height - world.y };
}

/** CSS `transform` (origin top left) that lays a world-sized canvas over the zoomed view. */
export function canvasTransform(view: ViewState, width: number, height: number): string {
    const tx = width / 2 - view.center.x * view.zoom;
    const ty = height / 2 - (height - view.center.y) * view.zoom;
    return `translate(${tx}px, ${ty}px) scale(${view.zoom})`;
}
