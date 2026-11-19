import { t } from '../../i18n';
import {
    DRAWING_ATTRACTOR_TINT, DRAWING_BRUSH_FALLOFF_STOPS, DRAWING_BRUSH_TIPS, DRAWING_REPELLER_TINT, DRAWING_TEXT_MARGIN,
} from '../../config';
import {
    DRAWING_PARAM as P, drawingChoice, drawingFlag, drawingFont, drawingMode, drawingNumber,
    type BrushTip, type DrawingKind, type DrawingSettings,
} from '../../drawing';
import {
    containRect, dabFalloff, densityFromPixel, hollowStroke, sprayDots, wrapText, type MaskPoint, type Rect,
} from '../../drawingMask';
import type { ShapeStyle } from '../../mouseTools';

export type { MaskPoint };


function context2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d', { willReadFrequently });
    if (!ctx) throw new Error(t('error.canvas2d'));
    return ctx;
}

/**
 * A drawing mask, the size of the simulation area in CSS px: its alpha is the density, its
 * color the preview tint, so the same canvas is shown as the preview. It is composed from one of
 * three sources, each keeping its own content: a drawing (a layer of its own, painted with brush
 * dabs and shapes), an image (fitted to the area, its density per pixel) or a text (wrapped to the area).
 */
export class MaskCanvas {
    readonly canvas = document.createElement('canvas');
    private readonly ctx = context2d(this.canvas, true);
    private readonly drawing = document.createElement('canvas');
    private readonly drawingCtx = context2d(this.drawing);
    private image: ImageBitmap | null = null;
    /** Fonts already asked for: each is loaded once (a failed load would otherwise loop). */
    private readonly requestedFonts = new Set<string>();

    private readonly tintRgb: readonly [number, number, number];

    /** `onFontLoaded`: a font the text needs has just loaded, the text should be rendered again. */
    constructor(readonly kind: DrawingKind, private readonly onFontLoaded: () => void) {
        this.tintRgb = kind === 'attractor' ? DRAWING_ATTRACTOR_TINT : DRAWING_REPELLER_TINT;
        this.canvas.className = 'drawing-overlay';
        this.canvas.setAttribute('aria-hidden', 'true');
    }

    private tint(alpha: number): string {
        const [r, g, b] = this.tintRgb;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

    /**
     * Paints dabs of `tip` at `points` on the drawing, or erases there: a disc fading past the tip's
     * hardness, or the scattered dots of the spray, each at density `flow`.
     */
    dabs(points: readonly MaskPoint[], diameter: number, flow: number, tip: BrushTip, erase: boolean): void {
        if (points.length === 0) return;
        const ctx = this.drawingCtx;
        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        ctx.globalAlpha = flow;
        const radius = diameter / 2;
        if (tip === 'spray') {
            ctx.fillStyle = this.tint(1);
            for (const point of points) {
                ctx.beginPath();
                for (const dot of sprayDots(point, diameter, Math.random)) {
                    ctx.moveTo(dot.x + dot.radius, dot.y);
                    ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        } else {
            const { hardness } = DRAWING_BRUSH_TIPS[tip];
            for (const { x, y } of points) {
                const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
                g.addColorStop(0, this.tint(1));
                for (let i = 0; i <= DRAWING_BRUSH_FALLOFF_STOPS; i++) {
                    const r = hardness + (1 - hardness) * i / DRAWING_BRUSH_FALLOFF_STOPS;
                    g.addColorStop(r, this.tint(dabFalloff(hardness, r)));
                }
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    /**
     * Paints a shape filling `rect` on the drawing at density `alpha`, or erases there; a hollow one
     * with an outline of `thickness` px inside the frame (filled when too thin for it).
     */
    shape(rect: Rect, style: ShapeStyle, thickness: number, alpha: number, erase: boolean): void {
        if (rect.width <= 0 || rect.height <= 0) return;
        const ctx = this.drawingCtx;
        const outline = style.filled ? null : hollowStroke(rect, thickness);
        const inset = outline?.inset ?? 0;
        const x = rect.x + inset, y = rect.y + inset;
        const w = rect.width - 2 * inset, h = rect.height - 2 * inset;
        ctx.save();
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = ctx.strokeStyle = this.tint(1);
        ctx.beginPath();
        if (style.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(x, y, w, h);
        if (outline) {
            ctx.lineWidth = outline.lineWidth;
            ctx.stroke();
        } else {
            ctx.fill();
        }
        ctx.restore();
    }

    clearDrawing(): void {
        this.drawingCtx.clearRect(0, 0, this.drawing.width, this.drawing.height);
    }

    /** The imported image (the previous one is released), or none. */
    setImage(image: ImageBitmap | null): void {
        this.image?.close();
        this.image = image;
    }

    /** Composes the mask from the source the settings select. */
    render(settings: DrawingSettings): void {
        const { ctx, width, height } = this;
        ctx.clearRect(0, 0, width, height);
        if (width === 0 || height === 0) return;
        switch (drawingMode(settings, this.kind)) {
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

    private renderImage(settings: DrawingSettings): void {
        const { ctx, width, height, image } = this;
        if (!image) return;
        const r = containRect(image.width, image.height, width, height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, r.x, r.y, r.width, r.height);
        const opacity = drawingNumber(settings, this.kind, P.imageOpacity) / 100;
        const invert = drawingFlag(settings, this.kind, P.imageInvert);
        const pixels = ctx.getImageData(0, 0, width, height);
        const d = pixels.data;
        for (let i = 0; i < d.length; i += 4) {
            const density = d[i + 3] === 0 ? 0 : densityFromPixel(d[i], d[i + 1], d[i + 2], d[i + 3], invert) * opacity;
            [d[i], d[i + 1], d[i + 2]] = this.tintRgb;
            d[i + 3] = Math.round(density * 255);
        }
        ctx.putImageData(pixels, 0, 0);
    }

    private renderText(settings: DrawingSettings): void {
        const { ctx, width, height } = this;
        const font = drawingFont(settings, this.kind);
        const text = settings.texts[this.kind];
        if (!this.requestedFonts.has(font) && !document.fonts.check(font, text)) {
            this.requestedFonts.add(font);
            document.fonts.load(font, text).then(() => this.onFontLoaded(), () => { /* fallback font kept */ });
        }
        const fontSize = drawingNumber(settings, this.kind, P.fontSize);
        const lineHeight = fontSize * drawingNumber(settings, this.kind, P.lineHeight);
        const margin = DRAWING_TEXT_MARGIN * Math.min(width, height);
        const align = drawingChoice(settings, this.kind, P.align);
        ctx.save();
        ctx.font = font;
        ctx.fillStyle = this.tint(1);
        ctx.globalAlpha = drawingNumber(settings, this.kind, P.textOpacity) / 100;
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
