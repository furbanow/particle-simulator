// The static dark matter's settings, shown in the panel's dark matter tab: its gravity, the source of
// its mask (drawn with the mouse, imported image, text) and the settings of each source. Shared by
// every algorithm and saved in simulation configs. Pure data (ui/darkMatterPanel.ts builds the tab).

import {
    DARK_MATTER_BRUSH_FLOW_SLIDER, DARK_MATTER_BRUSH_SIZE_SLIDER, DARK_MATTER_FONT_SIZE_SLIDER,
    DARK_MATTER_LINE_HEIGHT_SLIDER, DARK_MATTER_OPACITY_SLIDER, DARK_MATTER_SOFTENING_SLIDER,
    DARK_MATTER_STRENGTH_SLIDER, DARK_MATTER_TEXT_MAX,
} from './config';
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
    { value: 'cursive', label: 'Manuscrite', css: '\'Brush Script MT\', \'Segoe Script\', cursive' },
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

const percent = (v: number): string => `${v} %`;
const px = (v: number): string => `${v} px`;

export const DARK_MATTER_PARAMS: readonly DarkMatterParam[] = [
    { ...sliderFields(DARK_MATTER_STRENGTH_SLIDER), key: P.strength, tab: 'darkMatter', group: 'gravity',
        label: 'Intensité gravitationnelle',
        doc: 'Force avec laquelle la matière noire attire la matière. À 0, elle n\'a plus aucun effet. Elle ne bouge jamais et ne ressent rien : seule la matière est attirée.',
        format: v => v.toFixed(1) },
    { ...sliderFields(DARK_MATTER_SOFTENING_SLIDER), key: P.softening, tab: 'darkMatter', group: 'gravity',
        label: 'Adoucissement',
        doc: 'Distance, en pourcentage du petit côté de l\'écran, en dessous de laquelle l\'attraction cesse de croître. Plus il est grand, plus l\'attraction est douce et diffuse près du masque.',
        format: v => `${v.toFixed(1)} %` },
    { kind: 'choice', key: P.mode, tab: 'darkMatter', group: 'source', label: 'Source du masque', default: 'draw',
        options: [
            { value: 'draw', label: 'Dessin' },
            { value: 'image', label: 'Image' },
            { value: 'text', label: 'Texte' },
        ],
        doc: 'D\'où vient le masque d\'opacité qui place la matière noire : plus il est opaque, plus elle est dense. Chaque source garde son contenu quand on passe à une autre.' },
    { ...sliderFields(DARK_MATTER_BRUSH_SIZE_SLIDER), key: P.brushSize, tab: 'darkMatter', group: 'draw',
        label: 'Taille du pinceau',
        doc: 'Diamètre du pinceau, en pixels. Le bord du pinceau est adouci.',
        format: px },
    { ...sliderFields(DARK_MATTER_BRUSH_FLOW_SLIDER), key: P.brushFlow, tab: 'darkMatter', group: 'draw',
        label: 'Densité du pinceau',
        doc: 'Matière noire déposée à chaque passage du pinceau. Repasser au même endroit la rend plus dense, jusqu\'à l\'opacité complète.',
        format: percent },
    { ...sliderFields(DARK_MATTER_OPACITY_SLIDER), key: P.imageOpacity, tab: 'darkMatter', group: 'image',
        label: 'Opacité du masque',
        doc: 'Densité de la matière noire là où l\'image est la plus claire. Les zones sombres ou transparentes de l\'image n\'en contiennent pas.',
        format: percent },
    { kind: 'boolean', key: P.imageInvert, tab: 'darkMatter', group: 'image', label: 'Inverser', default: false,
        doc: 'Place la matière noire dans les zones sombres de l\'image au lieu des zones claires.' },
    { kind: 'choice', key: P.fontFamily, tab: 'darkMatter', group: 'text', label: 'Police', default: 'inter',
        options: DARK_MATTER_FONTS.map(({ value, label }) => ({ value, label })),
        doc: 'Police du texte. Les polices épaisses donnent des lettres plus massives.' },
    { ...sliderFields(DARK_MATTER_FONT_SIZE_SLIDER), key: P.fontSize, tab: 'darkMatter', group: 'text',
        label: 'Taille du texte',
        doc: 'Hauteur des caractères, en pixels. Les lignes trop longues pour l\'écran passent à la ligne.',
        format: px },
    { ...sliderFields(DARK_MATTER_LINE_HEIGHT_SLIDER), key: P.lineHeight, tab: 'darkMatter', group: 'text',
        label: 'Interligne',
        doc: 'Distance entre deux lignes, en multiple de la taille du texte.',
        format: v => `${v.toFixed(2)}×` },
    { kind: 'boolean', key: P.bold, tab: 'darkMatter', group: 'text', label: 'Gras', default: true,
        doc: 'Lettres épaisses : plus de matière noire par lettre.' },
    { kind: 'boolean', key: P.italic, tab: 'darkMatter', group: 'text', label: 'Italique', default: false,
        doc: 'Lettres penchées.' },
    { kind: 'choice', key: P.align, tab: 'darkMatter', group: 'text', label: 'Alignement', default: 'center',
        options: [
            { value: 'left', label: 'Gauche' },
            { value: 'center', label: 'Centré' },
            { value: 'right', label: 'Droite' },
        ],
        doc: 'Alignement horizontal des lignes. Le bloc de texte est centré verticalement.' },
    { ...sliderFields(DARK_MATTER_OPACITY_SLIDER), key: P.textOpacity, tab: 'darkMatter', group: 'text',
        label: 'Opacité du masque',
        doc: 'Densité de la matière noire dans les lettres.',
        format: percent },
];

/** The dark matter's settings: the declared parameters, by key, and the text of the text mask. */
export interface DarkMatterSettings {
    params: ParamValues;
    text: string;
}

export const DEFAULT_DARK_MATTER_TEXT = 'Matière\nnoire';

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
    if (!found) throw new Error(`Paramètre de matière noire inconnu : ${key}`);
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
