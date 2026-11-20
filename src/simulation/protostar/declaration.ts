// Declaration of the "protostar" algorithm: a hydrogen cloud collapses under its own gravity,
// cools, and its core ignites H -> He fusion, then He -> C once it is hot enough. Panel parameters,
// particle types (hydrogen, helium, carbon), fusion reactions and live stats. Its GPU side is
// ./gpuModel.ts.

import {
    CARBON_12_MASS, HYDROGEN_1_MASS, MASS_RANGE, MASS_SLIDER_STEPS, POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP,
    PROTOSTAR_AGITATION_SLIDER, PROTOSTAR_ALPHA_SLIDER, PROTOSTAR_C_SIZE, PROTOSTAR_COOLING_SLIDER,
    PROTOSTAR_COUNT_SLIDER, PROTOSTAR_FEEDBACK_SLIDER, PROTOSTAR_GRAVITY_SLIDER, PROTOSTAR_H_SIZE,
    PROTOSTAR_HE_ALPHA_SLIDER, PROTOSTAR_HE_IGNITION_KELVIN, PROTOSTAR_HE_LAMBDA_SLIDER, PROTOSTAR_HE_SIZE,
    PROTOSTAR_LAMBDA_SLIDER, PROTOSTAR_OPACITY_SLIDER, PROTOSTAR_ROTATION_SLIDER, PROTOSTAR_SOFTENING_SLIDER,
    PROTOSTAR_T0_KELVIN, SIZE_RANGE, SIZE_STEP, type SliderSpec,
} from '../../config';
import { formatNumber, localizeDecimal, t } from '../../i18n';
import { randomPopulationWeights } from '../../population';
import { ELEMENTS, formatMass, massToSlider, randomSpeciesMasses, randomSpeciesSizes, sliderToMass } from '../../species';
import { formatInt } from '../../util/format';
import { clamp } from '../../util/math';
import {
    linearScale, PARTICLE_COUNT_PARAM, sliderFields, type AlgorithmDeclaration, type ParamDef, type ParticleType,
} from '../algorithm';
import { reactionTransitions, type FusionReaction } from './reactions';

/** Keys of the parameters, shared with the GPU model. */
export const PROTOSTAR_PARAM = {
    count: PARTICLE_COUNT_PARAM,
    rotation: 'rotation',
    agitation: 'agitation',
    gravity: 'gravity',
    softening: 'softening',
    cooling: 'cooling',
    opacity: 'opacity',
    fusionRate: 'fusionRate',
    fusionExponent: 'fusionExponent',
    heFusionRate: 'heFusionRate',
    heFusionExponent: 'heFusionExponent',
    feedback: 'feedback',
} as const;

export const PROTOSTAR_PROPERTY = { weight: 'weight', mass: 'mass', size: 'size' } as const;

export const PROTOSTAR_STAT = {
    coreTemperature: 'coreTemperature',
    coreDensity: 'coreDensity',
    fusionRate: 'fusionRate',
} as const;

/** Type ranks. */
export const HYDROGEN = 0;
export const HELIUM = 1;
export const CARBON = 2;

const KELVIN_PER_MK = 1e6;

/**
 * The fusion reactions. A later stage adds rows (C + He -> O with its own rate parameters, ...)
 * and the types they need; the GPU model and its shaders read the table as it is.
 */
export const PROTOSTAR_REACTIONS: readonly FusionReaction[] = [
    { from: HYDROGEN, to: HELIUM, consumed: 4, label: t('algo.protostar.reaction.protonProton'), rateParam: PROTOSTAR_PARAM.fusionRate,
        exponentParam: PROTOSTAR_PARAM.fusionExponent, referenceTemperature: PROTOSTAR_T0_KELVIN, densityExponent: 1 },
    { from: HELIUM, to: CARBON, consumed: 3, label: t('algo.protostar.reaction.tripleAlpha'), rateParam: PROTOSTAR_PARAM.heFusionRate,
        exponentParam: PROTOSTAR_PARAM.heFusionExponent, referenceTemperature: PROTOSTAR_HE_IGNITION_KELVIN, densityExponent: 2 },
];

const logSliderFields = (spec: SliderSpec) => ({ ...sliderFields(spec), scale: 'log' }) as const;

/** Three significant digits, in scientific notation below 0.01 (2e-5 -> "2.00e-5", or "2,00e-5" in French). */
export function formatSmall(v: number): string {
    if (v === 0) return '0';
    return Math.abs(v) < 0.01 ? localizeDecimal(v.toExponential(2)) : formatNumber(Number(v.toPrecision(3)), 4, 0);
}

const fixed = (digits: number) => (v: number): string => formatNumber(v, digits);

/** A temperature in T0, in millions of kelvins. */
export const formatTemperature = (t: number): string => `${fixed(1)(t * PROTOSTAR_T0_KELVIN / KELVIN_PER_MK)} MK`;

const params: readonly ParamDef[] = [
    { ...sliderFields(PROTOSTAR_COUNT_SLIDER), key: PROTOSTAR_PARAM.count, tab: 'initial', label: t('algo.protostar.param.count.label'),
        doc: t('algo.protostar.param.count.doc'),
        format: formatInt },
    { ...sliderFields(PROTOSTAR_ROTATION_SLIDER), key: PROTOSTAR_PARAM.rotation, tab: 'initial', label: t('algo.protostar.param.rotation.label'),
        doc: t('algo.protostar.param.rotation.doc'),
        format: v => `${fixed(2)(v)} × v_circ` },
    { ...sliderFields(PROTOSTAR_AGITATION_SLIDER), key: PROTOSTAR_PARAM.agitation, tab: 'initial', label: t('algo.protostar.param.agitation.label'),
        doc: t('algo.protostar.param.agitation.doc'),
        format: v => `${fixed(2)(v)} × v_circ` },
    { ...sliderFields(PROTOSTAR_GRAVITY_SLIDER), key: PROTOSTAR_PARAM.gravity, tab: 'physics', label: t('algo.protostar.param.gravity.label'),
        doc: t('algo.protostar.param.gravity.doc'),
        format: v => `G = ${fixed(2)(v)}` },
    { ...sliderFields(PROTOSTAR_SOFTENING_SLIDER), key: PROTOSTAR_PARAM.softening, tab: 'physics', label: t('algo.protostar.param.softening.label'),
        doc: t('algo.protostar.param.softening.doc'),
        format: v => `ε = ${fixed(1)(v)} %` },
    { ...sliderFields(PROTOSTAR_COOLING_SLIDER), key: PROTOSTAR_PARAM.cooling, tab: 'physics', label: t('algo.protostar.param.cooling.label'),
        doc: t('algo.protostar.param.cooling.doc'),
        format: v => `${fixed(2)(v)} /s` },
    { ...logSliderFields(PROTOSTAR_OPACITY_SLIDER), key: PROTOSTAR_PARAM.opacity, tab: 'physics', label: t('algo.protostar.param.opacity.label'),
        doc: t('algo.protostar.param.opacity.doc'),
        format: v => `ρ_opq = ${formatSmall(v)} ρ₀` },
    { ...logSliderFields(PROTOSTAR_LAMBDA_SLIDER), key: PROTOSTAR_PARAM.fusionRate, tab: 'fusion', label: t('algo.protostar.param.fusionRate.label'),
        doc: t('algo.protostar.param.fusionRate.doc'),
        format: v => `λ₀ = ${formatSmall(v)}` },
    { ...sliderFields(PROTOSTAR_ALPHA_SLIDER), key: PROTOSTAR_PARAM.fusionExponent, tab: 'fusion', label: t('algo.protostar.param.fusionExponent.label'),
        doc: t('algo.protostar.param.fusionExponent.doc'),
        format: v => `α = ${fixed(1)(v)}` },
    { ...logSliderFields(PROTOSTAR_HE_LAMBDA_SLIDER), key: PROTOSTAR_PARAM.heFusionRate, tab: 'fusion', label: t('algo.protostar.param.heFusionRate.label'),
        doc: t('algo.protostar.param.heFusionRate.doc'),
        format: v => `λ = ${formatSmall(v)}` },
    { ...sliderFields(PROTOSTAR_HE_ALPHA_SLIDER), key: PROTOSTAR_PARAM.heFusionExponent, tab: 'fusion', label: t('algo.protostar.param.heFusionExponent.label'),
        doc: t('algo.protostar.param.heFusionExponent.doc'),
        format: v => `α = ${fixed(1)(v)}` },
    { ...logSliderFields(PROTOSTAR_FEEDBACK_SLIDER), key: PROTOSTAR_PARAM.feedback, tab: 'fusion', label: t('algo.protostar.param.feedback.label'),
        doc: t('algo.protostar.param.feedback.doc'),
        format: v => `× ${formatSmall(v)}` },
];

const element = (symbol: string) => {
    const e = ELEMENTS.find(x => x.symbol === symbol);
    if (!e) throw new Error(`Unknown element: ${symbol}`);
    return e;
};

/** Hydrogen (cold blue-white, all of the initial gas), helium (yellow) and carbon 12 (none at first). */
export const PROTOSTAR_TYPES: readonly ParticleType[] = [
    { name: element('H').name, symbol: 'H', color: '#bcd4ff',
        values: { weight: 1, mass: HYDROGEN_1_MASS, size: PROTOSTAR_H_SIZE } },
    { name: element('He').name, symbol: 'He', color: '#ffd23f',
        values: { weight: 0, mass: element('He').atomicMass, size: PROTOSTAR_HE_SIZE } },
    { name: element('C').name, symbol: 'C', color: element('C').color,
        values: { weight: 0, mass: CARBON_12_MASS, size: PROTOSTAR_C_SIZE } },
];

const UNIT = [0, 1] as const;

export const PROTOSTAR: AlgorithmDeclaration = {
    id: 'protostar',
    label: t('algo.protostar.label'),
    defaultSpeed: 1.7,
    description: t('algo.protostar.description'),
    params,
    particleTypes: {
        labels: {
            title: t('ui.elements.title'), item: t('ui.elements.item'), count: t('ui.elements.count'),
            active: t('ui.elements.active'),
        },
        properties: [
            {
                kind: 'number', key: PROTOSTAR_PROPERTY.weight, label: t('algo.protostar.prop.weight.label'), unit: '', role: 'population',
                range: POPULATION_WEIGHT_RANGE, scale: linearScale(POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP),
                live: false, resetLabel: t('prop.default'), resetTitle: t('algo.protostar.prop.weight.resetTitle'),
                randomTitle: t('algo.protostar.prop.weight.randomTitle'), format: v => String(v),
                randomize: (count, _visible, random) => randomPopulationWeights(count, random),
            },
            {
                kind: 'number', key: PROTOSTAR_PROPERTY.mass, label: t('prop.mass'), unit: 'u',
                range: MASS_RANGE,
                scale: {
                    step: 1 / MASS_SLIDER_STEPS,
                    toPosition: m => massToSlider(m) / MASS_SLIDER_STEPS,
                    fromPosition: t => sliderToMass(clamp(t, UNIT) * MASS_SLIDER_STEPS),
                },
                live: true, resetLabel: t('prop.default'), resetTitle: t('algo.protostar.prop.mass.resetTitle'),
                randomTitle: t('algo.protostar.prop.mass.randomTitle'), format: formatMass,
                randomize: randomSpeciesMasses,
            },
            {
                kind: 'number', key: PROTOSTAR_PROPERTY.size, label: t('prop.size'), unit: 'px',
                range: SIZE_RANGE, scale: linearScale(SIZE_RANGE, SIZE_STEP),
                live: true, resetLabel: t('prop.default'), resetTitle: t('algo.protostar.prop.size.resetTitle'),
                randomTitle: t('algo.protostar.prop.size.randomTitle'), format: v => formatNumber(v, 1),
                randomize: (count, _visible, random) => randomSpeciesSizes(count, random),
            },
            {
                kind: 'color', label: t('prop.color'), resetTitle: t('algo.protostar.prop.color.resetTitle'),
                randomTitle: t('algo.protostar.prop.color.randomTitle'),
            },
        ],
        transitions: reactionTransitions(PROTOSTAR_REACTIONS),
        defaults: PROTOSTAR_TYPES,
        builtinConfig: { id: 'builtin:protostar', name: t('algo.protostar.builtin') },
    },
    stats: [
        { kind: 'typeCounts', label: t('algo.protostar.stat.typeCounts') },
        { kind: 'value', key: PROTOSTAR_STAT.coreTemperature, label: t('algo.protostar.stat.coreTemperature'),
            format: formatTemperature },
        { kind: 'value', key: PROTOSTAR_STAT.coreDensity, label: t('algo.protostar.stat.coreDensity'),
            format: v => `${v < 10 ? fixed(1)(v) : formatInt(Math.round(v))} ρ₀` },
        { kind: 'value', key: PROTOSTAR_STAT.fusionRate, label: t('algo.protostar.stat.fusionRate'), flash: false,
            format: v => v < 10 ? fixed(2)(v) : formatInt(Math.round(v)) },
    ],
};
