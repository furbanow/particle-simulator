import {
    DARK_MATTER_BRUSH_HARDNESS, DARK_MATTER_BRUSH_SPACING, DARK_MATTER_TEXT_MARGIN, DARK_MATTER_TINT,
} from '../../config';
import {
    DARK_MATTER_PARAM as P, darkMatterChoice, darkMatterFlag, darkMatterFont, darkMatterMode, darkMatterNumber,
    type DarkMatterSettings,
} from '../../darkMatter';
import { containRect, densityFromPixel, wrapText } from '../../darkMatterMask';

const [TINT_R, TINT_G, TINT_B] = DARK_MATTER_TINT;
const tint = (alpha: number): string => `rgba(${TINT_R}, ${TINT_G}, ${TINT_B}, ${alpha})`;

function context2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d', { willReadFrequently });
    if (!ctx) throw new Error('Canvas 2D indisponible');
    return ctx;
}

/** A point of the simulation area, in CSS px from its top left corner (canvas coordinates). */
export interface MaskPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * The dark matter mask, the size of the simulation area in CSS px: its alpha is the density, its
 * color the preview tint, so the same canvas is shown as the preview. It is composed from one of
 * three sources, each keeping its own content: a drawing (a layer of its own, painted with soft
 * dabs), an image (fitted to the area, its density per pixel) or a text (wrapped to the area).
 */
export class MaskCanvas {
    readonly canvas = document.createElement('canvas');
    private readonly ctx = context2d(this.canvas, true);
    private readonly drawing = document.createElement('canvas');
    private readonly drawingCtx = context2d(this.drawing);
    private image: ImageBitmap | null = null;
    /** Fonts already asked for: each is loaded once (a failed load would otherwise loop). */
    private readonly requestedFonts = new Set<string>();

    /** `onFontLoaded`: a font the text needs has just loaded, the text should be rendered again. */
    constructor(private readonly onFontLoaded: () => void) {
        this.canvas.className = 'dark-matter-overlay';
        this.canvas.setAttribute('aria-hidden', 'true');
    }

    get width(): number { return this.canvas.width; }
    get height(): number { return this.canvas.height; }

    /** Follows the simulation area: the drawing is stretched along, the other sources are rendered again. */
    resize(width: number, height: number): void {
        width = Math.max(0, Math.round(width));
        height = Math.max(0, Math.round(height));
        if (width === this.width && height === this.height) return;
        const old = this.drawing.width > 0 && this.drawing.height > 0 ? copyOf(this.drawing) : null;
        this.canvas.width = this.drawing.width = width;
        this.canvas.height = this.drawing.height = height;
        if (old && width > 0 && height > 0) this.drawingCtx.drawImage(old, 0, 0, width, height);
    }

    /** Paints soft dabs from `from` to `to` (or one dab at `to`) on the drawing, or erases there. */
    stroke(from: MaskPoint | null, to: MaskPoint, diameter: number, flow: number, erase: boolean): void {
        const ctx = this.drawingCtx;
        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        ctx.globalAlpha = flow;
        const radius = diameter / 2;
        const dab = (x: number, y: number) => {
            const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
            g.addColorStop(0, tint(1));
            g.addColorStop(DARK_MATTER_BRUSH_HARDNESS, tint(1));
            g.addColorStop(1, tint(0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        };
        if (!from) {
            dab(to.x, to.y);
        } else {
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            const steps = Math.max(1, Math.ceil(distance / Math.max(1, diameter * DARK_MATTER_BRUSH_SPACING)));
            for (let k = 1; k <= steps; k++) {
                const t = k / steps;
                dab(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
            }
        }
        ctx.restore();
    }

    clearDrawing(): void {
        this.drawingCtx.clearRect(0, 0, this.drawing.width, this.drawing.height);
    }

    /** The imported image (the previous one is released). */
    setImage(image: ImageBitmap): void {
        this.image?.close();
        this.image = image;
    }

    /** Composes the mask from the source the settings select. */
    render(settings: DarkMatterSettings): void {
        const { ctx, width, height } = this;
        ctx.clearRect(0, 0, width, height);
        if (width === 0 || height === 0) return;
        switch (darkMatterMode(settings)) {
            case 'draw':
                ctx.drawImage(this.drawing, 0, 0);
                break;
            case 'image':
                this.renderImage(settings);
                break;
            case 'text':
                this.renderText(settings);
                break;
        }
    }

    /** RGBA bytes of the mask, row by row from the top. */
    pixels(): Uint8ClampedArray {
        return this.ctx.getImageData(0, 0, this.width, this.height).data;
    }

    private renderImage(settings: DarkMatterSettings): void {
        const { ctx, width, height, image } = this;
        if (!image) return;
        const r = containRect(image.width, image.height, width, height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, r.x, r.y, r.width, r.height);
        const opacity = darkMatterNumber(settings, P.imageOpacity) / 100;
        const invert = darkMatterFlag(settings, P.imageInvert);
        const pixels = ctx.getImageData(0, 0, width, height);
        const d = pixels.data;
        for (let i = 0; i < d.length; i += 4) {
            const density = d[i + 3] === 0 ? 0 : densityFromPixel(d[i], d[i + 1], d[i + 2], d[i + 3], invert) * opacity;
            d[i] = TINT_R;
            d[i + 1] = TINT_G;
            d[i + 2] = TINT_B;
            d[i + 3] = Math.round(density * 255);
        }
        ctx.putImageData(pixels, 0, 0);
    }

    private renderText(settings: DarkMatterSettings): void {
        const { ctx, width, height } = this;
        const font = darkMatterFont(settings);
        const text = settings.text;
        if (!this.requestedFonts.has(font) && !document.fonts.check(font, text)) {
            this.requestedFonts.add(font);
            document.fonts.load(font, text).then(() => this.onFontLoaded(), () => { /* fallback font kept */ });
        }
        const fontSize = darkMatterNumber(settings, P.fontSize);
        const lineHeight = fontSize * darkMatterNumber(settings, P.lineHeight);
        const margin = DARK_MATTER_TEXT_MARGIN * Math.min(width, height);
        const align = darkMatterChoice(settings, P.align);
        ctx.save();
        ctx.font = font;
        ctx.fillStyle = tint(1);
        ctx.globalAlpha = darkMatterNumber(settings, P.textOpacity) / 100;
        ctx.textBaseline = 'middle';
        ctx.textAlign = align === 'left' || align === 'right' ? align : 'center';
        const x = align === 'left' ? margin : align === 'right' ? width - margin : width / 2;
        const lines = wrapText(text, width - 2 * margin, s => ctx.measureText(s).width);
        const top = (height - lines.length * lineHeight) / 2;
        lines.forEach((line, i) => ctx.fillText(line, x, top + lineHeight * (i + 0.5)));
        ctx.restore();
    }
}

function copyOf(source: HTMLCanvasElement): HTMLCanvasElement {
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    context2d(copy).drawImage(source, 0, 0);
    return copy;
}
