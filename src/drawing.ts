// The settings of the static drawings, shown in the panel's drawing tab. A drawing is a mask that
// pulls the matter (an attractor) or pushes it away (a repeller); each kind has its own gravity,
// source of mask (drawn with the mouse, imported image, text) and settings of that source. Shared by
// every algorithm and saved in simulation configs. Pure data (ui/drawingPanel.ts builds the tab).

import {
    DRAWING_BRUSH_FLOW_SLIDER, DRAWING_BRUSH_SIZE_SLIDER, DRAWING_FONT_SIZE_SLIDER,
    DRAWING_LINE_HEIGHT_SLIDER, DRAWING_OPACITY_SLIDER, DRAWING_SHAPE_THICKNESS_SLIDER, DRAWING_SOFTENING_SLIDER,
    DRAWING_STRENGTH_SLIDER, DRAWING_TEXT_MAX,
} from './config';
import { formatNumber, t } from './i18n';
import { sliderFields, type ParamDef, type ParamValue, type ParamValues } from './simulation/algorithm';
import { panelParamValue } from './simulation/params';

/** What a drawing does to the matter: pulls it (attractor) or pushes it away (repeller). */
export type DrawingKind = 'attractor' | 'repeller';

export const DRAWING_KINDS: readonly DrawingKind[] = ['attractor', 'repeller'];

/** The tip of the brush (and of the eraser): fading edge, sharp edge, or scattered dots. */
export type BrushTip = 'soft' | 'hard' | 'spray';

/** The brush tips, in toolbar order (B, pressed again, goes through them). */
export const BRUSH_TIPS: readonly BrushTip[] = ['soft', 'hard', 'spray'];

/** Where the mask comes from: one source at a time, each keeping its own content. */
export type DrawingMode = 'draw' | 'image' | 'text';

/** Fonts of the text mask (Inter and JetBrains Mono are bundled; the others are system fonts). */
export const DRAWING_FONTS = [
    { value: 'inter', label: 'Inter', css: '\'Inter\', sans-serif' },
    { value: 'mono', label: 'JetBrains Mono', css: '\'JetBrains Mono\', monospace' },
    { value: 'serif', label: 'Serif', css: 'Georgia, \'Times New Roman\', serif' },
    { value: 'impact', label: 'Impact', css: 'Impact, \'Arial Black\', sans-serif' },
    { value: 'cursive', label: t('drawing.option.font.cursive'), css: '\'Brush Script MT\', \'Segoe Script\', cursive' },
] as const;

/** Keys of the settings of one kind (saved as `<kind>.<key>`, see drawingKey()). */
export const DRAWING_PARAM = {
    strength: 'strength',
    softening: 'softening',
    mode: 'mode',
    brushTip: 'brushTip',
    brushSize: 'brushSize',
    brushFlow: 'brushFlow',
    shapeThickness: 'shapeThickness',
    imageOpacity: 'imageOpacity',
    imageInvert: 'imageInvert',
    fontFamily: 'fontFamily',
    fontSize: 'fontSize',
    lineHeight: 'lineHeight',
    bold: 'bold',
    italic: 'italic',
    align: 'align',
    textOpacity: 'textOpacity',
} as const;

const P = DRAWING_PARAM;

/** The name a setting of `kind` is held and saved under. */
export const drawingKey = (kind: DrawingKind, key: string): string => `${kind}.${key}`;

/** The part of the tab a setting shows in: always ('gravity', 'source') or with its mode only. */
export type DrawingGroup = 'gravity' | 'source' | DrawingMode;

export type DrawingParam = ParamDef & { readonly group: DrawingGroup };

const percent = (v: number): string => t('format.percent', { value: v });
const px = (v: number): string => `${v} px`;

/** The settings of a kind, their keys prefixed by it. */
function declareParams(kind: DrawingKind): readonly DrawingParam[] {
    const attractor = kind === 'attractor';
    const base: readonly DrawingParam[] = [
        { ...sliderFields(DRAWING_STRENGTH_SLIDER), key: P.strength, tab: 'drawing', group: 'gravity',
            label: t(attractor ? 'drawing.param.strength.label' : 'drawing.param.repulsion.label'),
            doc: t(attractor ? 'drawing.param.strength.doc' : 'drawing.param.repulsion.doc'),
            format: v => formatNumber(v, 1) },
        { ...sliderFields(DRAWING_SOFTENING_SLIDER), key: P.softening, tab: 'drawing', group: 'gravity',
            label: t('drawing.param.softening.label'),
            doc: t(attractor ? 'drawing.param.softening.doc' : 'drawing.param.softeningRepeller.doc'),
            format: v => t('format.percent', { value: formatNumber(v, 1) }) },
        { kind: 'choice', key: P.mode, tab: 'drawing', group: 'source', label: t('drawing.param.mode.label'), default: 'draw',
            options: [
                { value: 'draw', label: t('drawing.option.mode.draw') },
                { value: 'image', label: t('drawing.option.mode.image') },
                { value: 'text', label: t('drawing.option.mode.text') },
            ],
            doc: t('drawing.param.mode.doc') },
        { kind: 'choice', key: P.brushTip, tab: 'drawing', group: 'draw', label: t('drawing.param.brushTip.label'), default: 'soft',
            options: BRUSH_TIPS.map(value => ({ value, label: t(`drawing.option.tip.${value}`) })),
            doc: t('drawing.param.brushTip.doc') },
        { ...sliderFields(DRAWING_BRUSH_SIZE_SLIDER), key: P.brushSize, tab: 'drawing', group: 'draw',
            label: t('drawing.param.brushSize.label'),
            doc: t('drawing.param.brushSize.doc'),
            format: px },
        { ...sliderFields(DRAWING_BRUSH_FLOW_SLIDER), key: P.brushFlow, tab: 'drawing', group: 'draw',
            label: t('drawing.param.brushFlow.label'),
            doc: t('drawing.param.brushFlow.doc'),
            format: percent },
        { ...sliderFields(DRAWING_SHAPE_THICKNESS_SLIDER), key: P.shapeThickness, tab: 'drawing', group: 'draw',
            label: t('drawing.param.shapeThickness.label'),
            doc: t('drawing.param.shapeThickness.doc'),
            format: px },
        { ...sliderFields(DRAWING_OPACITY_SLIDER), key: P.imageOpacity, tab: 'drawing', group: 'image',
            label: t('drawing.param.imageOpacity.label'),
            doc: t('drawing.param.imageOpacity.doc'),
            format: percent },
        { kind: 'boolean', key: P.imageInvert, tab: 'drawing', group: 'image', label: t('drawing.param.imageInvert.label'), default: false,
            doc: t('drawing.param.imageInvert.doc') },
        { kind: 'choice', key: P.fontFamily, tab: 'drawing', group: 'text', label: t('drawing.param.fontFamily.label'), default: 'inter',
            options: DRAWING_FONTS.map(({ value, label }) => ({ value, label })),
            doc: t('drawing.param.fontFamily.doc') },
        { ...sliderFields(DRAWING_FONT_SIZE_SLIDER), key: P.fontSize, tab: 'drawing', group: 'text',
            label: t('drawing.param.fontSize.label'),
            doc: t('drawing.param.fontSize.doc'),
            format: px },
        { ...sliderFields(DRAWING_LINE_HEIGHT_SLIDER), key: P.lineHeight, tab: 'drawing', group: 'text',
            label: t('drawing.param.lineHeight.label'),
            doc: t('drawing.param.lineHeight.doc'),
            format: v => `${formatNumber(v, 2)}×` },
        { kind: 'boolean', key: P.bold, tab: 'drawing', group: 'text', label: t('drawing.param.bold.label'), default: true,
            doc: t('drawing.param.bold.doc') },
        { kind: 'boolean', key: P.italic, tab: 'drawing', group: 'text', label: t('drawing.param.italic.label'), default: false,
            doc: t('drawing.param.italic.doc') },
        { kind: 'choice', key: P.align, tab: 'drawing', group: 'text', label: t('drawing.param.align.label'), default: 'center',
            options: [
                { value: 'left', label: t('drawing.option.align.left') },
                { value: 'center', label: t('drawing.option.align.center') },
                { value: 'right', label: t('drawing.option.align.right') },
            ],
            doc: t('drawing.param.align.doc') },
        { ...sliderFields(DRAWING_OPACITY_SLIDER), key: P.textOpacity, tab: 'drawing', group: 'text',
            label: t('drawing.param.textOpacity.label'),
            doc: t('drawing.param.textOpacity.doc'),
            format: percent },
    ];
    return base.map(p => ({ ...p, key: drawingKey(kind, p.key) }));
}

/** The settings of each kind, with their prefixed keys. */
export const DRAWING_PARAMS: Readonly<Record<DrawingKind, readonly DrawingParam[]>> = {
    attractor: declareParams('attractor'),
    repeller: declareParams('repeller'),
};

/**
 * What owns a brush: a kind of drawing (its brush paints its mask and sizes its point force), or the
 * vortex, a point force only (toolbar), whose brush is saved as `vortex.<key>`.
 */
export type BrushOwner = DrawingKind | 'vortex';

/** The brush settings of the vortex (edited in the toolbar only). */
export const VORTEX_PARAMS: readonly DrawingParam[] = [
    { ...sliderFields(DRAWING_BRUSH_SIZE_SLIDER), key: `vortex.${P.brushSize}`, tab: 'drawing', group: 'draw',
        label: t('drawing.param.vortexBrushSize.label'),
        doc: t('drawing.param.vortexBrushSize.doc'),
        format: px },
    { ...sliderFields(DRAWING_BRUSH_FLOW_SLIDER), key: `vortex.${P.brushFlow}`, tab: 'drawing', group: 'draw',
        label: t('drawing.param.vortexBrushFlow.label'),
        doc: t('drawing.param.vortexBrushFlow.doc'),
        format: percent },
];

/** Every setting of every kind, and the vortex's. */
export const ALL_DRAWING_PARAMS: readonly DrawingParam[] = [...DRAWING_KINDS.flatMap(kind => DRAWING_PARAMS[kind]), ...VORTEX_PARAMS];

/** A brush setting of `owner`: its size (px) or density (%). */
export type BrushKey = typeof P.brushSize | typeof P.brushFlow;

/** The declaration of a brush setting of `owner`. */
export function brushParam(owner: BrushOwner, key: BrushKey): DrawingParam {
    const name = `${owner}.${key}`;
    const found = ALL_DRAWING_PARAMS.find(p => p.key === name);
    if (!found) throw new Error(`Unknown brush parameter: ${name}`);
    return found;
}

/** Value of a brush setting of `owner`, its default when missing or invalid. */
export function brushNumber(s: DrawingSettings, owner: BrushOwner, key: BrushKey): number {
    const param = brushParam(owner, key);
    const v = s.params[param.key];
    return typeof v === 'number' ? v : param.default as number;
}

/** The drawings' settings: the declared parameters, by prefixed key, and the text of each kind's text mask. */
export interface DrawingSettings {
    params: ParamValues;
    texts: Record<DrawingKind, string>;
}

export const DEFAULT_DRAWING_TEXTS: Readonly<Record<DrawingKind, string>> = {
    attractor: t('drawing.defaultText.attractor'),
    repeller: t('drawing.defaultText.repeller'),
};

export const defaultDrawing = (): DrawingSettings => sanitizeDrawingSettings(null);

export const cloneDrawing = ({ params, texts }: DrawingSettings): DrawingSettings => ({ params: { ...params }, texts: { ...texts } });

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/**
 * Valid settings from parsed JSON: every parameter as the panel holds it (its default when missing
 * or invalid), each text cut to DRAWING_TEXT_MAX characters. Configs saved when the only drawing was
 * the dark matter (unprefixed keys, one `text`) give the attractor its settings.
 */
export function sanitizeDrawingSettings(raw: unknown): DrawingSettings {
    const record = isRecord(raw) ? raw : {};
    const params = isRecord(record.params) ? record.params : {};
    const texts = isRecord(record.texts) ? record.texts : {};
    const text = (kind: DrawingKind): string => {
        const saved = texts[kind] ?? (kind === 'attractor' ? record.text : undefined);
        return typeof saved === 'string' ? saved.slice(0, DRAWING_TEXT_MAX) : DEFAULT_DRAWING_TEXTS[kind];
    };
    return {
        params: Object.fromEntries(ALL_DRAWING_PARAMS.map(p => {
            const legacy = p.key.startsWith('attractor.') ? params[p.key.slice('attractor.'.length)] : undefined;
            return [p.key, panelParamValue(p, params[p.key] ?? legacy ?? p.default)];
        })),
        texts: { attractor: text('attractor'), repeller: text('repeller') },
    };
}

function param(kind: DrawingKind, key: string): DrawingParam {
    const found = DRAWING_PARAMS[kind].find(p => p.key === drawingKey(kind, key));
    if (!found) throw new Error(`Unknown drawing parameter: ${key}`);
    return found;
}

/** Value of a setting of `kind`, its default when missing or of the wrong type. */
function valueOf<T extends ParamValue>(settings: DrawingSettings, kind: DrawingKind, key: string, type: string): T {
    const v = settings.params[drawingKey(kind, key)];
    return (typeof v === type ? v : param(kind, key).default) as T;
}

export const drawingNumber = (s: DrawingSettings, kind: DrawingKind, key: string): number => valueOf<number>(s, kind, key, 'number');
export const drawingFlag = (s: DrawingSettings, kind: DrawingKind, key: string): boolean => valueOf<boolean>(s, kind, key, 'boolean');
export const drawingChoice = (s: DrawingSettings, kind: DrawingKind, key: string): string => valueOf<string>(s, kind, key, 'string');

export function drawingTip(s: DrawingSettings, kind: DrawingKind): BrushTip {
    const tip = drawingChoice(s, kind, P.brushTip);
    return BRUSH_TIPS.find(b => b === tip) ?? 'soft';
}

export function drawingMode(s: DrawingSettings, kind: DrawingKind): DrawingMode {
    const mode = drawingChoice(s, kind, P.mode);
    return mode === 'image' || mode === 'text' ? mode : 'draw';
}

/** CSS font shorthand of a kind's text mask, e.g. `italic 700 160px 'Inter', sans-serif`. */
export function drawingFont(s: DrawingSettings, kind: DrawingKind): string {
    const family = DRAWING_FONTS.find(f => f.value === drawingChoice(s, kind, P.fontFamily)) ?? DRAWING_FONTS[0];
    const style = drawingFlag(s, kind, P.italic) ? 'italic ' : '';
    const weight = drawingFlag(s, kind, P.bold) ? 700 : 400;
    return `${style}${weight} ${drawingNumber(s, kind, P.fontSize)}px ${family.css}`;
}
