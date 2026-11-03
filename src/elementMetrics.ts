import {
    COLOR_GRADIENT_STOPS, COLOR_PERCENT_STEPS, HUE_STEPS, HUE_VISIBLE_LIGHTNESS, HUE_VISIBLE_MIN_SATURATION,
    MASS_SLIDER_STEPS, POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP, SIZE_RANGE, SIZE_STEP, VIVID_LIGHTNESS,
    VIVID_SATURATION, type Range,
} from './config';
import { formatShare, randomPopulationWeights } from './population';
import {
    DEFAULT_SPECIES, formatMass, massToSlider, randomSpeciesHsl, randomSpeciesMasses, randomSpeciesSizes,
    sliderToMass, type Species,
} from './species';
import { hexToHsl, hslToHex, type Hsl } from './util/color';
import { clamp, snap } from './util/math';

export type MetricId = 'weight' | 'mass' | 'size' | 'hue' | 'saturation' | 'lightness';
type Field = 'weight' | 'mass' | 'size' | 'color';

/**
 * One editable species property, seen as a 0..1 position (bar height in the chart, slider
 * position in the editor). `set` rounds to the property's own steps and reports whether the
 * value changed; `reset` restores the default element at that rank. Metrics sharing a `group`
 * (the three color channels) share a chart tab.
 */
export interface ElementMetric {
    readonly id: MetricId;
    /** Chart tab: the metric's own label, or the group (Couleur) of the color channels. */
    readonly group: string;
    readonly label: string;
    readonly unit: string;
    /** Applied to the running simulation right away (false: on restart). */
    readonly live: boolean;
    /** Slider step, in position units. */
    readonly step: number;
    readonly resetLabel: string;
    readonly resetTitle: string;
    readonly randomTitle: string;
    position(s: Species): number;
    set(s: Species, t: number): boolean;
    reset(s: Species, index: number): boolean;
    randomize(species: readonly Species[], visible: number, random?: () => number): void;
    /** Display value; `share` is the population share, null when the species isn't selected. */
    format(s: Species, share: number | null): string;
    /** Track background showing what each position gives (color channels), else undefined. */
    track?(s: Species, direction: string): string;
}

function assign<K extends Field>(s: Species, key: K, value: Species[K]): boolean {
    if (s[key] === value) return false;
    s[key] = value;
    return true;
}

const resetTo = (key: Field) => (s: Species, index: number): boolean => assign(s, key, DEFAULT_SPECIES[index][key]);

const UNIT: Range = [0, 1];
const toUnit = ([lo, hi]: Range, x: number): number => (x - lo) / (hi - lo);
const fromUnit = ([lo, hi]: Range, t: number): number => lo + clamp(t, UNIT) * (hi - lo);

// ---- Colors ----

// The HSL a species was last given. A hex color loses the hue of grays (and the saturation of
// black and white); remembering the HSL keeps them while the user goes through those colors.
const lastHsl = new WeakMap<Species, Hsl>();

/** HSL of the species color: the remembered one while it still matches the color, else derived from it. */
export function speciesHsl(s: Species): Hsl {
    const remembered = lastHsl.get(s);
    return remembered && hslToHex(remembered) === s.color ? remembered : hexToHsl(s.color);
}

function setHsl(s: Species, hsl: Hsl): boolean {
    const before = speciesHsl(s);
    lastHsl.set(s, hsl);
    const hslChanged = before.h !== hsl.h || before.s !== hsl.s || before.l !== hsl.l;
    return assign(s, 'color', hslToHex(hsl)) || hslChanged;
}

/** `hsl` turned to hue `h`; a color showing no hue also becomes vivid, so the new hue is seen. */
export function withHue(hsl: Hsl, h: number): Hsl {
    const hidden = hsl.s < HUE_VISIBLE_MIN_SATURATION || clamp(hsl.l, HUE_VISIBLE_LIGHTNESS) !== hsl.l;
    return hidden ? { h, s: VIVID_SATURATION, l: VIVID_LIGHTNESS } : { ...hsl, h };
}

/** CSS gradient of the colors along a channel, from position 0 to 1. */
export function colorGradient(direction: string, colorAt: (t: number) => Hsl): string {
    const stops = Array.from({ length: COLOR_GRADIENT_STOPS + 1 }, (_, i) => hslToHex(colorAt(i / COLOR_GRADIENT_STOPS)));
    return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

const percent = (v: number): string => `${Math.round(v * 100)} %`;

/** Shared by the three channels: Default / Random / double-click act on the whole color. */
const colorChannel = {
    group: 'Couleur', unit: '', live: true,
    resetLabel: 'Par défaut', resetTitle: 'Couleurs CPK des éléments chimiques', randomTitle: 'Couleurs aléatoires',
    reset: (s: Species, index: number) => setHsl(s, hexToHsl(DEFAULT_SPECIES[index].color)),
    randomize: (species: readonly Species[], visible: number, random?: () => number) =>
        randomSpeciesHsl(species.length, visible, random).forEach((hsl, k) => { setHsl(species[k], hsl); }),
} as const;

const hue: ElementMetric = {
    ...colorChannel, id: 'hue', label: 'Teinte', step: 1 / HUE_STEPS,
    position: s => speciesHsl(s).h,
    set: (s, t) => setHsl(s, withHue(speciesHsl(s), snap(t, 1 / HUE_STEPS, UNIT))),
    format: s => `${Math.round(speciesHsl(s).h * HUE_STEPS)}°`,
    track: (s, direction) => { const hsl = speciesHsl(s); return colorGradient(direction, t => withHue(hsl, t)); },
};

const saturation: ElementMetric = {
    ...colorChannel, id: 'saturation', label: 'Saturation', step: 1 / COLOR_PERCENT_STEPS,
    position: s => speciesHsl(s).s,
    set: (s, t) => setHsl(s, { ...speciesHsl(s), s: snap(t, 1 / COLOR_PERCENT_STEPS, UNIT) }),
    format: s => percent(speciesHsl(s).s),
    track: (s, direction) => { const hsl = speciesHsl(s); return colorGradient(direction, t => ({ ...hsl, s: t })); },
};

const lightness: ElementMetric = {
    ...colorChannel, id: 'lightness', label: 'Luminosité', step: 1 / COLOR_PERCENT_STEPS,
    position: s => speciesHsl(s).l,
    set: (s, t) => setHsl(s, { ...speciesHsl(s), l: snap(t, 1 / COLOR_PERCENT_STEPS, UNIT) }),
    format: s => percent(speciesHsl(s).l),
    track: (s, direction) => { const hsl = speciesHsl(s); return colorGradient(direction, t => ({ ...hsl, l: t })); },
};

// ---- Other properties ----

const weight: ElementMetric = {
    id: 'weight', group: 'Répartition', label: 'Répartition', unit: '', live: false, step: POPULATION_WEIGHT_STEP,
    resetLabel: 'Uniforme', resetTitle: 'Même population pour chaque élément', randomTitle: 'Répartition aléatoire',
    position: s => toUnit(POPULATION_WEIGHT_RANGE, s.weight),
    set: (s, t) => assign(s, 'weight',
        snap(fromUnit(POPULATION_WEIGHT_RANGE, t), POPULATION_WEIGHT_STEP, POPULATION_WEIGHT_RANGE)),
    reset: resetTo('weight'),
    randomize: (species, _visible, random) =>
        randomPopulationWeights(species.length, random).forEach((w, k) => { species[k].weight = w; }),
    format: (_s, share) => share === null ? '–' : formatShare(share),
};

const mass: ElementMetric = {
    id: 'mass', group: 'Masse atomique', label: 'Masse atomique', unit: 'u', live: true, step: 1 / MASS_SLIDER_STEPS,
    resetLabel: 'Par défaut', resetTitle: 'Masses atomiques des éléments chimiques',
    randomTitle: 'Masses aléatoires (échelle 1/N … 1, légèrement décalée)',
    position: s => massToSlider(s.mass) / MASS_SLIDER_STEPS,
    set: (s, t) => assign(s, 'mass', sliderToMass(clamp(t, UNIT) * MASS_SLIDER_STEPS)),
    reset: resetTo('mass'),
    randomize: (species, visible, random) =>
        randomSpeciesMasses(species.length, visible, random).forEach((m, k) => { species[k].mass = m; }),
    format: s => formatMass(s.mass),
};

const size: ElementMetric = {
    id: 'size', group: 'Taille', label: 'Taille', unit: 'px', live: true, step: SIZE_STEP / (SIZE_RANGE[1] - SIZE_RANGE[0]),
    resetLabel: 'Par défaut', resetTitle: 'Tailles proportionnelles aux rayons atomiques', randomTitle: 'Tailles aléatoires',
    position: s => toUnit(SIZE_RANGE, s.size),
    set: (s, t) => assign(s, 'size', snap(fromUnit(SIZE_RANGE, t), SIZE_STEP, SIZE_RANGE)),
    reset: resetTo('size'),
    randomize: (species, _visible, random) =>
        randomSpeciesSizes(species.length, random).forEach((v, k) => { species[k].size = v; }),
    format: s => s.size.toFixed(1),
};

/** In display order: chart tabs and editor sliders. */
export const ELEMENT_METRICS: readonly ElementMetric[] = [weight, mass, size, hue, saturation, lightness];

export interface MetricGroup {
    label: string;
    unit: string;
    metrics: readonly ElementMetric[];
}

/** The metrics by group, in display order: one chart tab per group. */
export const METRIC_GROUPS: readonly MetricGroup[] = [...new Set(ELEMENT_METRICS.map(m => m.group))].map(label => {
    const metrics = ELEMENT_METRICS.filter(m => m.group === label);
    return { label, unit: metrics[0].unit, metrics };
});
