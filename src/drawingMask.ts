// Geometry and pixel rules of the drawing masks: fitting an image, wrapping a text, the density
// of an image pixel. Pure functions (tested); ui/drawing/maskCanvas.ts draws with them.

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
