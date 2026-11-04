import {
    COLOR_GRADIENT_STOPS, COLOR_PERCENT_STEPS, HUE_STEPS, HUE_VISIBLE_LIGHTNESS, HUE_VISIBLE_MIN_SATURATION,
    VIVID_LIGHTNESS, VIVID_SATURATION, type Range,
} from './config';
import { formatShare } from './population';
import type { ColorProperty, NumberProperty, ParticleType, ParticleTypeSchema } from './simulation/algorithm';
import { randomSpeciesHsl } from './species';
import { hexToHsl, hslToHex, type Hsl } from './util/color';
import { clamp, snap } from './util/math';

/** A number property's key, or one of the color channels. */
export type MetricId = string;

/**
 * One editable type property, seen as a 0..1 position (bar height in the chart). `set` rounds to
 * the property's own steps and reports whether the value changed; `reset` restores the default
 * type at that rank. Metrics sharing a `group` (the three color channels) share a chart tab.
 * Built from the algorithm's particle type schema by buildMetrics().
 */
export interface ElementMetric {
    readonly id: MetricId;
    /** Chart tab: the metric's own label, or the group (Couleur) of the color channels. */
    readonly group: string;
    readonly label: string;
    readonly unit: string;
    /** Applied to the running simulation right away (false: on restart). */
    readonly live: boolean;
    /** The population weight: the chart shows the shares. */
    readonly population: boolean;
    /** Position step. */
    readonly step: number;
    readonly resetLabel: string;
    readonly resetTitle: string;
    readonly randomTitle: string;
    position(t: ParticleType): number;
    set(t: ParticleType, position: number): boolean;
    reset(t: ParticleType, index: number): boolean;
    randomize(types: readonly ParticleType[], visible: number, random?: () => number): void;
    /** Display value; `share` is the population share, null when the type isn't selected. */
    format(t: ParticleType, share: number | null): string;
    /** Track background showing what each position gives (color channels), else undefined. */
    track?(t: ParticleType, direction: string): string;
}

const DEFAULT_RESET_LABEL = 'Par défaut';
const UNIT: Range = [0, 1];

// ---- Colors ----

// The HSL a type was last given. A hex color loses the hue of grays (and the saturation of
// black and white); remembering the HSL keeps them while the user goes through those colors.
const lastHsl = new WeakMap<ParticleType, Hsl>();

/** HSL of the type color: the remembered one while it still matches the color, else derived from it. */
export function speciesHsl(t: ParticleType): Hsl {
    const remembered = lastHsl.get(t);
    return remembered && hslToHex(remembered) === t.color ? remembered : hexToHsl(t.color);
}

function setHsl(t: ParticleType, hsl: Hsl): boolean {
    const before = speciesHsl(t);
    lastHsl.set(t, hsl);
    const hslChanged = before.h !== hsl.h || before.s !== hsl.s || before.l !== hsl.l;
    const color = hslToHex(hsl);
    const colorChanged = t.color !== color;
    t.color = color;
    return colorChanged || hslChanged;
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

/** The three channels of a color property; Default / Random / double-click act on the whole color. */
function colorMetrics(property: ColorProperty, defaults: readonly ParticleType[]): ElementMetric[] {
    const shared = {
        group: property.label, unit: '', live: true, population: false,
        resetLabel: DEFAULT_RESET_LABEL, resetTitle: property.resetTitle, randomTitle: property.randomTitle,
        reset: (t: ParticleType, index: number) => setHsl(t, hexToHsl(defaults[index].color)),
        randomize: (types: readonly ParticleType[], visible: number, random?: () => number) =>
            randomSpeciesHsl(types.length, visible, random).forEach((hsl, k) => { setHsl(types[k], hsl); }),
    } as const;
    return [
        {
            ...shared, id: 'hue', label: 'Teinte', step: 1 / HUE_STEPS,
            position: t => speciesHsl(t).h,
            set: (t, p) => setHsl(t, withHue(speciesHsl(t), snap(p, 1 / HUE_STEPS, UNIT))),
            format: t => `${Math.round(speciesHsl(t).h * HUE_STEPS)}°`,
            track: (t, direction) => { const hsl = speciesHsl(t); return colorGradient(direction, p => withHue(hsl, p)); },
        },
        {
            ...shared, id: 'saturation', label: 'Saturation', step: 1 / COLOR_PERCENT_STEPS,
            position: t => speciesHsl(t).s,
            set: (t, p) => setHsl(t, { ...speciesHsl(t), s: snap(p, 1 / COLOR_PERCENT_STEPS, UNIT) }),
            format: t => percent(speciesHsl(t).s),
            track: (t, direction) => { const hsl = speciesHsl(t); return colorGradient(direction, p => ({ ...hsl, s: p })); },
        },
        {
            ...shared, id: 'lightness', label: 'Luminosité', step: 1 / COLOR_PERCENT_STEPS,
            position: t => speciesHsl(t).l,
            set: (t, p) => setHsl(t, { ...speciesHsl(t), l: snap(p, 1 / COLOR_PERCENT_STEPS, UNIT) }),
            format: t => percent(speciesHsl(t).l),
            track: (t, direction) => { const hsl = speciesHsl(t); return colorGradient(direction, p => ({ ...hsl, l: p })); },
        },
    ];
}

// ---- Numeric properties ----

function numberMetric(property: NumberProperty, defaults: readonly ParticleType[]): ElementMetric {
    const { key, scale } = property;
    const assign = (t: ParticleType, value: number): boolean => {
        if (t.values[key] === value) return false;
        t.values[key] = value;
        return true;
    };
    const population = property.role === 'population';
    return {
        id: key, group: property.label, label: property.label, unit: property.unit, live: property.live,
        population, step: scale.step,
        resetLabel: property.resetLabel, resetTitle: property.resetTitle, randomTitle: property.randomTitle,
        position: t => scale.toPosition(t.values[key]),
        set: (t, p) => assign(t, scale.fromPosition(p)),
        reset: (t, index) => assign(t, defaults[index].values[key]),
        randomize: (types, visible, random = Math.random) => {
            const values = property.randomize
                ? property.randomize(types.length, visible, random)
                : types.map(() => scale.fromPosition(random()));
            values.forEach((v, k) => { types[k].values[key] = v; });
        },
        format: (t, share) => population
            ? share === null ? '–' : formatShare(share)
            : property.format(t.values[key]),
    };
}

/** The chart metrics of a schema, in display order (a color property gives its three channels). */
export function buildMetrics(schema: ParticleTypeSchema): ElementMetric[] {
    return schema.properties.flatMap(p => p.kind === 'color'
        ? colorMetrics(p, schema.defaults)
        : [numberMetric(p, schema.defaults)]);
}

export interface MetricGroup {
    label: string;
    unit: string;
    metrics: readonly ElementMetric[];
}

/** The metrics by group, in display order: one chart tab per group. */
export function metricGroups(metrics: readonly ElementMetric[]): MetricGroup[] {
    return [...new Set(metrics.map(m => m.group))].map(label => {
        const grouped = metrics.filter(m => m.group === label);
        return { label, unit: grouped[0].unit, metrics: grouped };
    });
}
