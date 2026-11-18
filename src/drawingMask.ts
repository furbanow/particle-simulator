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
