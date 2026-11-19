// Geometry and pixel rules of the drawing masks: fitting an image, wrapping a text, the density
// of an image pixel, the dabs of a brush stroke, the shapes. Pure functions (tested);
// ui/drawing/maskCanvas.ts draws with them.

import { DRAWING_SPRAY_COVERAGE, DRAWING_SPRAY_DOT, DRAWING_SPRAY_DOT_MIN, DRAWING_SPRAY_MAX_DOTS } from './config';

export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The largest rectangle of the source's aspect ratio inside `width` x `height`, centered. */
export function containRect(sourceWidth: number, sourceHeight: number, width: number, height: number): Rect {
    if (sourceWidth <= 0 || sourceHeight <= 0) return { x: width / 2, y: height / 2, width: 0, height: 0 };
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const w = sourceWidth * scale, h = sourceHeight * scale;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/**
 * Splits `text` into lines no wider than `maxWidth`: at its line breaks, then between words; a word
 * wider than a line is cut between characters. An empty paragraph stays an empty line.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
        let line = '';
        for (const word of paragraph.split(' ').filter(w => w !== '')) {
            const candidate = line ? `${line} ${word}` : word;
            if (measure(candidate) <= maxWidth) {
                line = candidate;
                continue;
            }
            if (line) lines.push(line);
            line = '';
            for (const ch of word) {
                if (line && measure(line + ch) > maxWidth) {
                    lines.push(line);
                    line = ch;
                } else {
                    line += ch;
                }
            }
        }
        lines.push(line);
    }
    return lines;
}

/**
 * Density (0..1) of an image pixel (bytes): its luminance (Rec. 709 weights) times its opacity. Inverted,
 * the dark parts are the dense ones (transparent pixels stay empty either way).
 */
export function densityFromPixel(r: number, g: number, b: number, a: number, invert: boolean): number {
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return (invert ? 1 - luminance : luminance) * a / 255;
}

/** A point of the drawing area (canvas coordinates). */
export interface MaskPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * The frame of a shape dragged from `start` to `end`: from corner to corner, or from its center
 * (`fromCenter`, the frame then spans the drag on both sides); a square when `constrain`, on the
 * side of the longer drag, toward the pointer.
 */
export function shapeRect(start: MaskPoint, end: MaskPoint, constrain: boolean, fromCenter: boolean): Rect {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if (constrain) {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = dx < 0 ? -side : side;
        dy = dy < 0 ? -side : side;
    }
    if (fromCenter) {
        const w = Math.abs(dx), h = Math.abs(dy);
        return { x: start.x - w, y: start.y - h, width: 2 * w, height: 2 * h };
    }
    return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

/**
 * The outline of a hollow shape of `thickness` inside `rect`: the stroke is centered on the frame
 * inset by half the thickness, so its outer edge is the frame. Null when the outline would fill
 * the shape (thickness at least half its short side): the shape is then drawn filled.
 */
export function hollowStroke(rect: Rect, thickness: number): { inset: number; lineWidth: number } | null {
    if (thickness <= 0 || 2 * thickness >= Math.min(rect.width, rect.height)) return null;
    return { inset: thickness / 2, lineWidth: thickness };
}

/**
 * The dabs of a stroke going on from `from` to `to`, one every `spacing` px: `carry` is the distance
 * travelled since the last dab (on the previous segments), so the dabs stay evenly spaced however
 * the pointer events cut the stroke. Returns the dabs and the carry for the next segment.
 */
export function dabsAlong(from: MaskPoint, to: MaskPoint, spacing: number, carry: number): { dabs: MaskPoint[]; carry: number } {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.max(spacing, 0.5);
    const dabs: MaskPoint[] = [];
    let at = step - carry;                      // distance along the segment of the next dab
    for (; at <= length; at += step) {
        const f = length > 0 ? at / length : 0;
        dabs.push({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f });
    }
    return { dabs, carry: length - (at - step) };
}

/**
 * Density of a dab at `r` from its center (0) to its edge (1): full up to `hardness`, then fading
 * smoothly (no visible ring) to nothing at the edge.
 */
export function dabFalloff(hardness: number, r: number): number {
    if (r <= hardness) return 1;
    if (r >= 1) return 0;
    const u = (r - hardness) / (1 - hardness);
    return (1 - u * u) ** 2;
}

/** A dot of the spray. */
export interface Dot extends MaskPoint {
    readonly radius: number;
}

/**
 * The dots of one spray dab of `diameter` around `center`: DRAWING_SPRAY_DOT of the diameter each
 * (at least DRAWING_SPRAY_DOT_MIN px), spread evenly over the dab and covering DRAWING_SPRAY_COVERAGE
 * of it. `random` gives numbers in [0, 1).
 */
export function sprayDots(center: MaskPoint, diameter: number, random: () => number): Dot[] {
    const dot = Math.max(DRAWING_SPRAY_DOT_MIN, diameter * DRAWING_SPRAY_DOT);
    const count = Math.min(DRAWING_SPRAY_MAX_DOTS, Math.max(1, Math.round(DRAWING_SPRAY_COVERAGE * (diameter / dot) ** 2)));
    const reach = Math.max(0, (diameter - dot) / 2);
    return Array.from({ length: count }, () => {
        const angle = 2 * Math.PI * random();
        const distance = reach * Math.sqrt(random());
        return { x: center.x + distance * Math.cos(angle), y: center.y + distance * Math.sin(angle), radius: dot / 2 };
    });
}
