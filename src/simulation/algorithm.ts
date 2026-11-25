// Declaration side of a simulation algorithm: its panel parameters, its particle type schema and
// its live stats. Pure data and functions (no GPU, no DOM): the UI builds itself from it. The GPU
// side (shaders, uniforms, passes) is a GpuModel, registered separately in gpuModels.ts.

import type { Range, SliderSpec } from '../config';
import { t } from '../i18n';
import { clamp, snap } from '../util/math';

// ---- Global parameters ----

export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

/** Key of the particle count parameter, which every algorithm declares (number, applied on restart). */
export const PARTICLE_COUNT_PARAM = 'count';

/**
 * The tabs of the panel, in display order. 'initial' holds what only takes effect on the next
 * restart; the other tabs hold what applies while it changes. A tab shows only when a parameter
 * is declared in it, so an algorithm gets its Fusion or Supernova tab by declaring its parameters.
 * A switch sits in the tab and the section (`ParamBase.section`) of the parameters it changes;
 * 'features' (labelled Advanced, the last tab) holds the ones that only change how the model is computed or
 * observed (time step, grids, diagnostics). Switches are applied right away.
 */
export const PANEL_TABS = [
    { id: 'initial', label: t('tab.initial') },
    { id: 'physics', label: t('tab.physics') },
    { id: 'fusion', label: t('tab.fusion') },
    { id: 'supernova', label: t('tab.supernova') },
    { id: 'drawing', label: t('tab.drawing') },
    { id: 'elements', label: t('tab.elements') },
    { id: 'effects', label: t('tab.effects') },
    { id: 'features', label: t('tab.features') },
] as const;

export type PanelTab = typeof PANEL_TABS[number];
export type PanelTabId = PanelTab['id'];

interface ParamBase {
    /** Unique among the algorithm's parameters; the GPU model receives values by this key. */
    readonly key: string;
    /** Name of the control. */
    readonly label: string;
    /** Concise explanation, shown on hover: what it is and what it does in the algorithm. */
    readonly doc: string;
    readonly tab: PanelTabId;
    /**
     * Title of the group of the tab this parameter belongs to (already translated). The panel shows
     * it above the first parameter of a run of parameters sharing it, so those are declared
     * next to each other. A flag goes in the section of the parameter it changes.
     */
    readonly section?: string;
    /** The control is greyed out while the parameter `param` has the value `equals` (it has no effect then). */
    readonly disabledWhen?: { readonly param: string; readonly equals: ParamValue };
}

/** A number, edited with a slider. */
export interface NumberParam extends ParamBase {
    readonly kind: 'number';
    readonly min: number;
    readonly max: number;
    /** Value step (linear scale only: a log scale keeps LOG_PARAM_DIGITS significant digits). */
    readonly step: number;
    readonly default: number;
    /** 'log' for values spanning orders of magnitude (min must then be > 0). Linear by default. */
    readonly scale?: 'linear' | 'log';
    format(value: number): string;
}

/** An on/off switch, edited with a checkbox. */
export interface BooleanParam extends ParamBase {
    readonly kind: 'boolean';
    readonly default: boolean;
}

/** One option among a few, edited with a select. */
export interface ChoiceParam extends ParamBase {
    readonly kind: 'choice';
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly default: string;
}

export type ParamDef = NumberParam | BooleanParam | ChoiceParam;

// ---- Particle types ----

/**
 * A particle type. Every algorithm's types have a name, a symbol and a color (labels, swatches,
 * rendering); the numeric properties its schema declares (population weight, mass, size, …) are
 * in `values`, by property key. Types are identified by their rank: it is what the GPU state
 * stores per particle (position texture, z channel).
 */
export interface ParticleType {
    name: string;
    symbol: string;
    color: string;
    values: Record<string, number>;
}

/** Value <-> 0..1 position (chart bar height). `fromPosition` rounds and clamps to the property. */
export interface PropertyScale {
    /** Position step (keyboard and drag granularity). */
    readonly step: number;
    toPosition(value: number): number;
    fromPosition(position: number): number;
}

const UNIT: Range = [0, 1];

/** Linear scale over `range`, values rounded to `step`. */
export function linearScale(range: Range, step: number): PropertyScale {
    const [lo, hi] = range;
    return {
        step: step / (hi - lo),
        toPosition: v => (v - lo) / (hi - lo),
        fromPosition: t => snap(lo + clamp(t, UNIT) * (hi - lo), step, range),
    };
}

/** A numeric property of the particle types. */
export interface NumberProperty {
    readonly kind: 'number';
    readonly key: string;
    /** Chart tab. */
    readonly label: string;
    /** Shown next to the tab and the values ('' for none). */
    readonly unit: string;
    readonly range: Range;
    readonly scale: PropertyScale;
    /** Applied to the running simulation right away (false: on restart). */
    readonly live: boolean;
    /**
     * 'population': the population weight. Particles are split pro rata of it on restart, the
     * chart shows the resulting shares. At most one property has it.
     */
    readonly role?: 'population';
    readonly resetLabel: string;
    readonly resetTitle: string;
    readonly randomTitle: string;
    format(value: number): string;
    /** Random values for `count` types, `visible` of them shown. Default: uniform over the scale. */
    randomize?(count: number, visible: number, random: () => number): number[];
}

/** The color of the types, edited as hue, saturation and lightness in one chart tab. */
export interface ColorProperty {
    readonly kind: 'color';
    readonly label: string;
    readonly resetTitle: string;
    readonly randomTitle: string;
}

export type TypeProperty = NumberProperty | ColorProperty;

/** A read-only value derived from a type, shown in the type editor. */
export interface TypeReadout {
    readonly label: string;
    format(type: ParticleType): string;
}

/**
 * A type turning into another one during the simulation (e.g. hydrogen fusing into helium).
 * `from` and `to` are type ranks. The GPU model performs it; the declaration lets the UI show it.
 */
export interface TypeTransition {
    readonly from: number;
    readonly to: number;
    /** Process name, e.g. 'Fusion'. */
    readonly label: string;
}

export interface ParticleTypeSchema {
    /** Words of the element bar: title ('Elements'), one type ('Element'), count slider, active stat. */
    readonly labels: { readonly title: string; readonly item: string; readonly count: string; readonly active: string };
    /** Chart tabs, in display order. */
    readonly properties: readonly TypeProperty[];
    readonly readouts?: readonly TypeReadout[];
    readonly transitions?: readonly TypeTransition[];
    /** Default types (at most MAX_SPECIES), every numeric property set. */
    readonly defaults: readonly ParticleType[];
    /** Types used by default (1..defaults.length; all of them when omitted). */
    readonly defaultCount?: number;
    /** The built-in, read-only config holding the defaults. */
    readonly builtinConfig: { readonly id: string; readonly name: string };
}

// ---- Live stats ----

interface StatBase {
    /** Value read from the GPU model (GpuModel.stat). */
    readonly key: string;
    readonly label: string;
}

/** A number in a tile; null shows '–'. `flash`: the tile flashes when the value increases. `title`: explanation shown on hover. */
export interface ValueStat extends StatBase {
    readonly kind: 'value';
    readonly flash?: boolean;
    readonly title?: string;
    format(value: number): string;
}

/** A 0..1 fraction drawn as a bar, with an optional marker at a parameter's slider position. */
export interface MeterStat extends StatBase {
    readonly kind: 'meter';
    readonly title?: string;
    format(fraction: number): string;
    readonly marker?: { readonly param: string; format(value: number): string };
}

/**
 * Share of the total mass held by each type (Simulation.liveTypeMasses: the live particle count per type, GpuModel.liveTypeCounts,
 * else the split of the last restart, times the mass of a particle). `title`: explanation shown on hover.
 */
export interface TypeMassesStat {
    readonly kind: 'typeMasses';
    readonly label: string;
    readonly title?: string;
}

export type StatDef = ValueStat | MeterStat | TypeMassesStat;

// ---- Algorithm ----

/**
 * A built-in simulation config of an algorithm besides its defaults: the parameters it changes (the others
 * keep their defaults). Read-only, like the defaults; it comes from the code, not from the storage.
 */
export interface AlgorithmPreset {
    /** Unique among the algorithm's presets. */
    readonly id: string;
    /** Name shown in the config list (already translated). */
    readonly name: string;
    readonly params: Readonly<Record<string, ParamValue>>;
}

export interface AlgorithmDeclaration {
    readonly id: string;
    /** Name shown in the UI. */
    readonly label: string;
    /** One-line explanation shown when hovering the selector. */
    readonly description: string;
    /** In display order within each tab; one of them is the PARTICLE_COUNT_PARAM. */
    readonly params: readonly ParamDef[];
    readonly particleTypes: ParticleTypeSchema;
    readonly stats?: readonly StatDef[];
    /** Simulation speed of the built-in simulation config (the shared speed slider default when omitted). */
    readonly defaultSpeed?: number;
    /** Name of the built-in simulation config holding the defaults (already translated); "Default" when omitted. */
    readonly defaultsName?: string;
    /** Built-in simulation configs offered after the defaults one. */
    readonly presets?: readonly AlgorithmPreset[];
    /** Particle cap of this algorithm relative to the benchmark's (1 when omitted): cheaper ones allow more. */
    readonly particleCapRatio?: number;
}

// ---- Helpers ----

/** Whether a parameter only takes effect on the next restart (the panel says so while it differs). */
export const appliesOnRestart = (param: ParamDef): boolean => param.tab === 'initial';

/** The tabs holding at least one of `params`, in display order. */
export const tabsOf = (params: readonly ParamDef[]): PanelTab[] =>
    PANEL_TABS.filter(tab => params.some(p => p.tab === tab.id));

/** The fields of a number parameter given by a slider spec of the config. */
export const sliderFields = ({ min, max, step, default: value }: SliderSpec) =>
    ({ kind: 'number', min, max, step, default: value }) as const;

export const numberProperties = (schema: ParticleTypeSchema): NumberProperty[] =>
    schema.properties.filter((p): p is NumberProperty => p.kind === 'number');

export const populationProperty = (schema: ParticleTypeSchema): NumberProperty | undefined =>
    numberProperties(schema).find(p => p.role === 'population');

/** Population weight of each type (all equal when the schema has no population property). */
export function populationWeights(schema: ParticleTypeSchema, types: readonly ParticleType[]): number[] {
    const population = populationProperty(schema);
    return types.map(t => population ? t.values[population.key] : 1);
}

export const cloneType = (t: ParticleType): ParticleType => ({ ...t, values: { ...t.values } });

export const defaultTypeCount = (schema: ParticleTypeSchema): number => schema.defaultCount ?? schema.defaults.length;
