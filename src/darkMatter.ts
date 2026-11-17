// The static dark matter's settings, shown in the panel's dark matter tab: its gravity, the source of
// its mask (drawn with the mouse, imported image, text) and the settings of each source. Shared by
// every algorithm and saved in simulation configs. Pure data (ui/darkMatterPanel.ts builds the tab).

import {
    DARK_MATTER_BRUSH_FLOW_SLIDER, DARK_MATTER_BRUSH_SIZE_SLIDER, DARK_MATTER_FONT_SIZE_SLIDER,
    DARK_MATTER_LINE_HEIGHT_SLIDER, DARK_MATTER_OPACITY_SLIDER, DARK_MATTER_SOFTENING_SLIDER,
    DARK_MATTER_STRENGTH_SLIDER, DARK_MATTER_TEXT_MAX,
} from './config';
import { formatNumber, t } from './i18n';
import { sliderFields, type ParamDef, type ParamValue, type ParamValues } from './simulation/algorithm';
import { panelParamValue } from './simulation/params';

/** Where the mask comes from: one source at a time, each keeping its own content. */
export type DarkMatterMode = 'draw' | 'image' | 'text';

/** Fonts of the text mask (Inter and JetBrains Mono are bundled; the others are system fonts). */
export const DARK_MATTER_FONTS = [
    { value: 'inter', label: 'Inter', css: '\'Inter\', sans-serif' },
    { value: 'mono', label: 'JetBrains Mono', css: '\'JetBrains Mono\', monospace' },
    { value: 'serif', label: 'Serif', css: 'Georgia, \'Times New Roman\', serif' },
    { value: 'impact', label: 'Impact', css: 'Impact, \'Arial Black\', sans-serif' },
    { value: 'cursive', label: t('darkMatter.option.font.cursive'), css: '\'Brush Script MT\', \'Segoe Script\', cursive' },
] as const;

/** Keys of the settings, also the names they are saved under. */
export const DARK_MATTER_PARAM = {
    strength: 'strength',
    softening: 'softening',
    mode: 'mode',
    brushSize: 'brushSize',
    brushFlow: 'brushFlow',
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

const P = DARK_MATTER_PARAM;

/** The part of the tab a setting shows in: always ('gravity', 'source') or with its mode only. */
export type DarkMatterGroup = 'gravity' | 'source' | DarkMatterMode;

export type DarkMatterParam = ParamDef & { readonly group: DarkMatterGroup };

const percent = (v: number): string => t('format.percent', { value: v });
const px = (v: number): string => `${v} px`;

export const DARK_MATTER_PARAMS: readonly DarkMatterParam[] = [
    { ...sliderFields(DARK_MATTER_STRENGTH_SLIDER), key: P.strength, tab: 'darkMatter', group: 'gravity',
        label: t('darkMatter.param.strength.label'),
        doc: t('darkMatter.param.strength.doc'),
        format: v => formatNumber(v, 1) },
    { ...sliderFields(DARK_MATTER_SOFTENING_SLIDER), key: P.softening, tab: 'darkMatter', group: 'gravity',
        label: t('darkMatter.param.softening.label'),
        doc: t('darkMatter.param.softening.doc'),
        format: v => t('format.percent', { value: formatNumber(v, 1) }) },
    { kind: 'choice', key: P.mode, tab: 'darkMatter', group: 'source', label: t('darkMatter.param.mode.label'), default: 'draw',
        options: [
            { value: 'draw', label: t('darkMatter.option.mode.draw') },
            { value: 'image', label: t('darkMatter.option.mode.image') },
            { value: 'text', label: t('darkMatter.option.mode.text') },
        ],
        doc: t('darkMatter.param.mode.doc') },
    { ...sliderFields(DARK_MATTER_BRUSH_SIZE_SLIDER), key: P.brushSize, tab: 'darkMatter', group: 'draw',
        label: t('darkMatter.param.brushSize.label'),
        doc: t('darkMatter.param.brushSize.doc'),
        format: px },
    { ...sliderFields(DARK_MATTER_BRUSH_FLOW_SLIDER), key: P.brushFlow, tab: 'darkMatter', group: 'draw',
        label: t('darkMatter.param.brushFlow.label'),
        doc: t('darkMatter.param.brushFlow.doc'),
        format: percent },
    { ...sliderFields(DARK_MATTER_OPACITY_SLIDER), key: P.imageOpacity, tab: 'darkMatter', group: 'image',
        label: t('darkMatter.param.imageOpacity.label'),
        doc: t('darkMatter.param.imageOpacity.doc'),
        format: percent },
    { kind: 'boolean', key: P.imageInvert, tab: 'darkMatter', group: 'image', label: t('darkMatter.param.imageInvert.label'), default: false,
        doc: t('darkMatter.param.imageInvert.doc') },
    { kind: 'choice', key: P.fontFamily, tab: 'darkMatter', group: 'text', label: t('darkMatter.param.fontFamily.label'), default: 'inter',
        options: DARK_MATTER_FONTS.map(({ value, label }) => ({ value, label })),
        doc: t('darkMatter.param.fontFamily.doc') },
    { ...sliderFields(DARK_MATTER_FONT_SIZE_SLIDER), key: P.fontSize, tab: 'darkMatter', group: 'text',
        label: t('darkMatter.param.fontSize.label'),
        doc: t('darkMatter.param.fontSize.doc'),
        format: px },
    { ...sliderFields(DARK_MATTER_LINE_HEIGHT_SLIDER), key: P.lineHeight, tab: 'darkMatter', group: 'text',
        label: t('darkMatter.param.lineHeight.label'),
        doc: t('darkMatter.param.lineHeight.doc'),
        format: v => `${formatNumber(v, 2)}×` },
    { kind: 'boolean', key: P.bold, tab: 'darkMatter', group: 'text', label: t('darkMatter.param.bold.label'), default: true,
        doc: t('darkMatter.param.bold.doc') },
    { kind: 'boolean', key: P.italic, tab: 'darkMatter', group: 'text', label: t('darkMatter.param.italic.label'), default: false,
        doc: t('darkMatter.param.italic.doc') },
    { kind: 'choice', key: P.align, tab: 'darkMatter', group: 'text', label: t('darkMatter.param.align.label'), default: 'center',
        options: [
            { value: 'left', label: t('darkMatter.option.align.left') },
            { value: 'center', label: t('darkMatter.option.align.center') },
            { value: 'right', label: t('darkMatter.option.align.right') },
        ],
        doc: t('darkMatter.param.align.doc') },
    { ...sliderFields(DARK_MATTER_OPACITY_SLIDER), key: P.textOpacity, tab: 'darkMatter', group: 'text',
        label: t('darkMatter.param.textOpacity.label'),
        doc: t('darkMatter.param.textOpacity.doc'),
        format: percent },
];

/** The dark matter's settings: the declared parameters, by key, and the text of the text mask. */
export interface DarkMatterSettings {
    params: ParamValues;
    text: string;
}

export const DEFAULT_DARK_MATTER_TEXT = t('darkMatter.defaultText');

export const defaultDarkMatter = (): DarkMatterSettings => sanitizeDarkMatterSettings(null);

export const cloneDarkMatter = ({ params, text }: DarkMatterSettings): DarkMatterSettings => ({ params: { ...params }, text });

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/**
 * Valid settings from parsed JSON: every parameter as the panel holds it (its default when missing
 * or invalid), the text cut to DARK_MATTER_TEXT_MAX characters.
 */
export function sanitizeDarkMatterSettings(raw: unknown): DarkMatterSettings {
    const record = isRecord(raw) ? raw : {};
    const params = isRecord(record.params) ? record.params : {};
    return {
        params: Object.fromEntries(DARK_MATTER_PARAMS.map(p => [p.key, panelParamValue(p, params[p.key] ?? p.default)])),
        text: typeof record.text === 'string' ? record.text.slice(0, DARK_MATTER_TEXT_MAX) : DEFAULT_DARK_MATTER_TEXT,
    };
}

function param(key: string): DarkMatterParam {
    const found = DARK_MATTER_PARAMS.find(p => p.key === key);
    if (!found) throw new Error(`Unknown dark matter parameter: ${key}`);
    return found;
}

/** Value of a setting, its default when missing or of the wrong type. */
function valueOf<T extends ParamValue>(settings: DarkMatterSettings, key: string, type: string): T {
    const v = settings.params[key];
    return (typeof v === type ? v : param(key).default) as T;
}

export const darkMatterNumber = (s: DarkMatterSettings, key: string): number => valueOf<number>(s, key, 'number');
export const darkMatterFlag = (s: DarkMatterSettings, key: string): boolean => valueOf<boolean>(s, key, 'boolean');
export const darkMatterChoice = (s: DarkMatterSettings, key: string): string => valueOf<string>(s, key, 'string');

export function darkMatterMode(s: DarkMatterSettings): DarkMatterMode {
    const mode = darkMatterChoice(s, P.mode);
    return mode === 'image' || mode === 'text' ? mode : 'draw';
}

/** CSS font shorthand of the text mask, e.g. `italic 700 160px 'Inter', sans-serif`. */
export function darkMatterFont(s: DarkMatterSettings): string {
    const family = DARK_MATTER_FONTS.find(f => f.value === darkMatterChoice(s, P.fontFamily)) ?? DARK_MATTER_FONTS[0];
    const style = darkMatterFlag(s, P.italic) ? 'italic ' : '';
    const weight = darkMatterFlag(s, P.bold) ? 700 : 400;
    return `${style}${weight} ${darkMatterNumber(s, P.fontSize)}px ${family.css}`;
}
