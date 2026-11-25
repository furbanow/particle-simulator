// Declaration of the "protostar" algorithm: a hydrogen cloud collapses under its own gravity,
// cools, and its core ignites H -> He fusion, then He -> C once it is hot enough. Panel parameters,
// particle types (hydrogen, helium, carbon), fusion reactions and live stats. Its GPU side is
// ./gpuModel.ts.

import {
    CARBON_12_MASS, HYDROGEN_1_MASS, MASS_RANGE, MASS_SLIDER_STEPS, POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP,
    PROTOSTAR_C_SIZE,
    PROTOSTAR_COUNT_SLIDER, PROTOSTAR_FEEDBACK_SLIDER, PROTOSTAR_GRAVITY_SLIDER, PROTOSTAR_H_SIZE,
    PROTOSTAR_HE_IGNITION_KELVIN, PROTOSTAR_HE_LAMBDA_SLIDER, PROTOSTAR_HE_SIZE,
    PROTOSTAR_KAPPA_SLIDER, PROTOSTAR_LAMBDA_SLIDER, PROTOSTAR_MIN_TEMPERATURE_SLIDER, PROTOSTAR_PP_LAW, PROTOSTAR_RADIATION_SLIDER, PROTOSTAR_ROTATION_ENERGY_SLIDER, PROTOSTAR_SOFTENING_SLIDER,
    PROTOSTAR_T0_KELVIN, PROTOSTAR_TRIPLE_ALPHA_LAW, PROTOSTAR_VIRIAL_SLIDER, SIZE_RANGE, SIZE_STEP, type SliderSpec,
} from '../../config';
import { formatNumber, localizeDecimal, t } from '../../i18n';
import { randomPopulationWeights } from '../../population';
import { ELEMENTS, formatMass, massToSlider, randomSpeciesMasses, randomSpeciesSizes, sliderToMass } from '../../species';
import { formatInt } from '../../util/format';
import { clamp } from '../../util/math';
import {
    linearScale, PARTICLE_COUNT_PARAM, sliderFields, type AlgorithmDeclaration, type ParamDef, type ParticleType,
} from '../algorithm';
import { DENSITY_PROFILES } from './disc';
import { STABILITY_MAP_MODES } from './stability';
import { TURBULENCE_KINDS } from './initialConditions';
import { reactionTransitions, type FusionReaction } from './reactions';

/** Keys of the parameters, shared with the GPU model. */
export const PROTOSTAR_PARAM = {
    count: PARTICLE_COUNT_PARAM,
    alphaVir: 'alphaVir',
    betaRot: 'betaRot',
    profile: 'profile',
    turbulence: 'turbulence',
    gravity: 'gravity',
    softening: 'softening',
    radiation: 'radiation',
    kappa: 'kappa',
    minTemperature: 'minTemperature',
    fusionRate: 'fusionRate',
    heFusionRate: 'heFusionRate',
    feedback: 'feedback',
    diagnostics: 'diagnostics',
    adaptiveTimeStep: 'adaptiveTimeStep',
    jeansFloor: 'jeansFloor',
    stabilityMap: 'stabilityMap',
    tscDeposit: 'tscDeposit',
    collisions: 'collisions',
    adaptiveThickness: 'adaptiveThickness',
    nestedGrid: 'nestedGrid',
} as const;

export const PROTOSTAR_PROPERTY = { weight: 'weight', mass: 'mass', size: 'size' } as const;

export const PROTOSTAR_STAT = {
    coreTemperature: 'coreTemperature',
    coreDensity: 'coreDensity',
    fusionRate: 'fusionRate',
    energyDrift: 'energyDrift',
    virialRatio: 'virialRatio',
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
        law: PROTOSTAR_PP_LAW, referenceTemperature: PROTOSTAR_T0_KELVIN, densityExponent: 1 },
    { from: HELIUM, to: CARBON, consumed: 3, label: t('algo.protostar.reaction.tripleAlpha'), rateParam: PROTOSTAR_PARAM.heFusionRate,
        law: PROTOSTAR_TRIPLE_ALPHA_LAW, referenceTemperature: PROTOSTAR_HE_IGNITION_KELVIN, densityExponent: 2 },
];

const logSliderFields = (spec: SliderSpec) => ({ ...sliderFields(spec), scale: 'log' }) as const;

/** Three significant digits, in scientific notation below 0.01 (2e-5 -> "2.00e-5", or "2,00e-5" in French). */
export function formatSmall(v: number): string {
    if (v === 0) return '0';
    return Math.abs(v) < 0.01 ? localizeDecimal(v.toExponential(2)) : formatNumber(Number(v.toPrecision(3)), 4, 0);
}

const fixed = (digits: number) => (v: number): string => formatNumber(v, digits);

/** A change of the total energy, as a fraction of the initial one: "+0.31 %", "-12.5 %" (one digit once it is above 10 %). */
export const formatEnergyDrift = (fraction: number): string =>
    `${fraction > 0 ? '+' : ''}${fixed(Math.abs(fraction) < 0.1 ? 2 : 1)(fraction * 100)} %`;

/** A temperature in T0, in millions of kelvins. */
export const formatTemperature = (t: number): string => `${fixed(1)(t * PROTOSTAR_T0_KELVIN / KELVIN_PER_MK)} MK`;

const params: readonly ParamDef[] = [
    { ...sliderFields(PROTOSTAR_COUNT_SLIDER), key: PROTOSTAR_PARAM.count, tab: 'initial', label: t('algo.protostar.param.count.label'),
        doc: t('algo.protostar.param.count.doc'),
        format: formatInt },
    { ...sliderFields(PROTOSTAR_VIRIAL_SLIDER), key: PROTOSTAR_PARAM.alphaVir, tab: 'initial', label: t('algo.protostar.param.alphaVir.label'),
        doc: t('algo.protostar.param.alphaVir.doc'),
        format: v => `α = ${fixed(2)(v)}` },
    { ...sliderFields(PROTOSTAR_ROTATION_ENERGY_SLIDER), key: PROTOSTAR_PARAM.betaRot, tab: 'initial', label: t('algo.protostar.param.betaRot.label'),
        doc: t('algo.protostar.param.betaRot.doc'),
        format: v => `β = ${fixed(2)(v)}` },
    { kind: 'choice', key: PROTOSTAR_PARAM.profile, tab: 'initial', label: t('algo.protostar.param.profile.label'), default: 'uniform',
        options: DENSITY_PROFILES.map(value => ({ value, label: t(`algo.protostar.option.profile.${value}`) })),
        doc: t('algo.protostar.param.profile.doc') },
    { kind: 'choice', key: PROTOSTAR_PARAM.turbulence, tab: 'initial', label: t('algo.protostar.param.turbulence.label'), default: 'white',
        options: TURBULENCE_KINDS.map(value => ({ value, label: t(`algo.protostar.option.turbulence.${value}`) })),
        doc: t('algo.protostar.param.turbulence.doc') },
    { ...sliderFields(PROTOSTAR_GRAVITY_SLIDER), key: PROTOSTAR_PARAM.gravity, tab: 'physics', label: t('algo.protostar.param.gravity.label'),
        doc: t('algo.protostar.param.gravity.doc'),
        format: v => `G = ${fixed(2)(v)}` },
    { ...sliderFields(PROTOSTAR_SOFTENING_SLIDER), key: PROTOSTAR_PARAM.softening, tab: 'physics', label: t('algo.protostar.param.softening.label'),
        doc: t('algo.protostar.param.softening.doc'),
        format: v => `ε = ${fixed(1)(v)} %` },
    { ...logSliderFields(PROTOSTAR_RADIATION_SLIDER), key: PROTOSTAR_PARAM.radiation, tab: 'physics', label: t('algo.protostar.param.radiation.label'),
        doc: t('algo.protostar.param.radiation.doc'),
        format: v => `c = ${formatSmall(v)} /s` },
    { ...logSliderFields(PROTOSTAR_KAPPA_SLIDER), key: PROTOSTAR_PARAM.kappa, tab: 'physics', label: t('algo.protostar.param.kappa.label'),
        doc: t('algo.protostar.param.kappa.doc'),
        format: v => `κ = ${formatSmall(v)} / ρ₀` },
    { ...sliderFields(PROTOSTAR_MIN_TEMPERATURE_SLIDER), key: PROTOSTAR_PARAM.minTemperature, tab: 'physics',
        label: t('algo.protostar.param.minTemperature.label'), doc: t('algo.protostar.param.minTemperature.doc'),
        format: formatTemperature },
    { ...logSliderFields(PROTOSTAR_LAMBDA_SLIDER), key: PROTOSTAR_PARAM.fusionRate, tab: 'fusion', label: t('algo.protostar.param.fusionRate.label'),
        doc: t('algo.protostar.param.fusionRate.doc'),
        format: v => `λ₀ = ${formatSmall(v)}` },
    { ...logSliderFields(PROTOSTAR_HE_LAMBDA_SLIDER), key: PROTOSTAR_PARAM.heFusionRate, tab: 'fusion', label: t('algo.protostar.param.heFusionRate.label'),
        doc: t('algo.protostar.param.heFusionRate.doc'),
        format: v => `λ = ${formatSmall(v)}` },
    { ...logSliderFields(PROTOSTAR_FEEDBACK_SLIDER), key: PROTOSTAR_PARAM.feedback, tab: 'fusion', label: t('algo.protostar.param.feedback.label'),
        doc: t('algo.protostar.param.feedback.doc'),
        format: v => `× ${formatSmall(v)}` },
    { kind: 'boolean', key: PROTOSTAR_PARAM.diagnostics, tab: 'features', label: t('algo.protostar.param.diagnostics.label'),
        doc: t('algo.protostar.param.diagnostics.doc'), default: false },
    { kind: 'boolean', key: PROTOSTAR_PARAM.adaptiveTimeStep, tab: 'features', label: t('algo.protostar.param.adaptiveTimeStep.label'),
        doc: t('algo.protostar.param.adaptiveTimeStep.doc'), default: false },
    { kind: 'boolean', key: PROTOSTAR_PARAM.jeansFloor, tab: 'features', label: t('algo.protostar.param.jeansFloor.label'),
        doc: t('algo.protostar.param.jeansFloor.doc'), default: true },
    { kind: 'choice', key: PROTOSTAR_PARAM.stabilityMap, tab: 'features', label: t('algo.protostar.param.stabilityMap.label'), default: 'off',
        options: STABILITY_MAP_MODES.map(value => ({ value, label: t(`algo.protostar.option.stabilityMap.${value}`) })),
        doc: t('algo.protostar.param.stabilityMap.doc') },
    { kind: 'boolean', key: PROTOSTAR_PARAM.tscDeposit, tab: 'features', label: t('algo.protostar.param.tscDeposit.label'),
        doc: t('algo.protostar.param.tscDeposit.doc'), default: false },
    { kind: 'boolean', key: PROTOSTAR_PARAM.collisions, tab: 'features', label: t('algo.protostar.param.collisions.label'),
        doc: t('algo.protostar.param.collisions.doc'), default: true },
    { kind: 'boolean', key: PROTOSTAR_PARAM.adaptiveThickness, tab: 'features', label: t('algo.protostar.param.adaptiveThickness.label'),
        doc: t('algo.protostar.param.adaptiveThickness.doc'), default: true },
    { kind: 'boolean', key: PROTOSTAR_PARAM.nestedGrid, tab: 'features', label: t('algo.protostar.param.nestedGrid.label'),
        doc: t('algo.protostar.param.nestedGrid.doc'), default: false },
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
        { kind: 'typeMasses', label: t('algo.protostar.stat.typeMasses'), title: t('algo.protostar.stat.typeMasses.doc') },
        { kind: 'value', key: PROTOSTAR_STAT.coreTemperature, label: t('algo.protostar.stat.coreTemperature'),
            format: formatTemperature },
        { kind: 'value', key: PROTOSTAR_STAT.coreDensity, label: t('algo.protostar.stat.coreDensity'),
            format: v => `${v < 10 ? fixed(1)(v) : formatInt(Math.round(v))} ρ₀` },
        { kind: 'value', key: PROTOSTAR_STAT.fusionRate, label: t('algo.protostar.stat.fusionRate'), flash: false,
            format: v => v < 10 ? fixed(2)(v) : formatInt(Math.round(v)) },
        { kind: 'value', key: PROTOSTAR_STAT.energyDrift, label: t('algo.protostar.stat.energyDrift'),
            title: t('algo.protostar.stat.energyDrift.doc'), flash: false, format: formatEnergyDrift },
        { kind: 'value', key: PROTOSTAR_STAT.virialRatio, label: t('algo.protostar.stat.virialRatio'),
            title: t('algo.protostar.stat.virialRatio.doc'), flash: false, format: fixed(2) },
    ],
};
