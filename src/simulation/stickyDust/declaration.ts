// Declaration of the "sticky dust" algorithm: panel parameters, particle types (the first ten
// chemical elements) and live stats. Its GPU side is ./gpuModel.ts.

import {
    COLLISION_SPEED_SLIDER, CONCENTRATION_RADIUS_SLIDER, DEFAULT_POPULATION_WEIGHT, GRAVITY_SLIDER, MASS_RANGE, MASS_SLIDER_STEPS,
    PARTICLE_COUNT_SLIDER, POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP, SIZE_RANGE, SIZE_STEP,
    STICKINESS_SLIDER, STICKY_DUST_CAP_RATIO, SUPERNOVA_POWER_SLIDER, SUPERNOVA_THRESHOLD_SLIDER,
} from '../../config';
import { formatNumber, t } from '../../i18n';
import { randomPopulationWeights } from '../../population';
import {
    ELEMENTS, formatMass, massToSlider, randomSpeciesMasses, randomSpeciesSizes, sliderToMass,
} from '../../species';
import { formatInt } from '../../util/format';
import { clamp } from '../../util/math';
import {
    linearScale, PARTICLE_COUNT_PARAM, sliderFields, type AlgorithmDeclaration, type ParamDef, type ParticleType,
} from '../algorithm';

/** Keys of the parameters and of the type properties, shared with the GPU model. */
export const STICKY_DUST_PARAM = {
    count: PARTICLE_COUNT_PARAM,
    gravity: 'gravity',
    stickiness: 'stickiness',
    collisionSpeed: 'collisionSpeed',
    supernovaThreshold: 'supernovaThreshold',
    concentrationRadius: 'concentrationRadius',
    supernovaPower: 'supernovaPower',
} as const;

export const STICKY_DUST_PROPERTY = { weight: 'weight', mass: 'mass', size: 'size' } as const;

export const STICKY_DUST_STAT = { supernovae: 'supernovae', concentration: 'concentration' } as const;

const percent = (v: number): string => t('format.percent', { value: v });

const params: readonly ParamDef[] = [
    { ...sliderFields(PARTICLE_COUNT_SLIDER), key: STICKY_DUST_PARAM.count, tab: 'initial', label: t('algo.stickyDust.param.count.label'),
        doc: t('algo.stickyDust.param.count.doc'),
        format: formatInt },
    { ...sliderFields(GRAVITY_SLIDER), key: STICKY_DUST_PARAM.gravity, tab: 'physics', label: t('algo.stickyDust.param.gravity.label'),
        doc: t('algo.stickyDust.param.gravity.doc'),
        format: v => `G = ${formatNumber(v, 1)}` },
    { ...sliderFields(STICKINESS_SLIDER), key: STICKY_DUST_PARAM.stickiness, tab: 'physics', label: t('algo.stickyDust.param.stickiness.label'),
        doc: t('algo.stickyDust.param.stickiness.doc'),
        format: percent },
    { ...sliderFields(COLLISION_SPEED_SLIDER), key: STICKY_DUST_PARAM.collisionSpeed, tab: 'physics', label: t('algo.stickyDust.param.collisionSpeed.label'),
        doc: t('algo.stickyDust.param.collisionSpeed.doc'),
        format: v => `${formatNumber(v, 0)} px/s` },
    { ...sliderFields(SUPERNOVA_THRESHOLD_SLIDER), key: STICKY_DUST_PARAM.supernovaThreshold, tab: 'supernova', label: t('algo.stickyDust.param.supernovaThreshold.label'),
        doc: t('algo.stickyDust.param.supernovaThreshold.doc'),
        format: percent },
    { ...sliderFields(CONCENTRATION_RADIUS_SLIDER), key: STICKY_DUST_PARAM.concentrationRadius, tab: 'supernova', label: t('algo.stickyDust.param.concentrationRadius.label'),
        doc: t('algo.stickyDust.param.concentrationRadius.doc'),
        format: v => `${v} px` },
    { ...sliderFields(SUPERNOVA_POWER_SLIDER), key: STICKY_DUST_PARAM.supernovaPower, tab: 'supernova', label: t('algo.stickyDust.param.supernovaPower.label'),
        doc: t('algo.stickyDust.param.supernovaPower.doc'),
        format: percent },
];

// Rendered diameters are proportional to the atomic radii, the largest atom filling the slider.
const MAX_RADIUS = Math.max(...ELEMENTS.map(e => e.radius));

/** The first ten elements: atomic masses in u, uniform population. */
export const STICKY_DUST_TYPES: readonly ParticleType[] = ELEMENTS.map(({ name, symbol, atomicMass, radius, color }) => ({
    name, symbol, color,
    values: { weight: DEFAULT_POPULATION_WEIGHT, mass: atomicMass, size: radius / MAX_RADIUS * SIZE_RANGE[1] },
}));

/** Density = mass / disc area: denser types sink to the core of the clumps. */
export const stickyDustDensity = (t: ParticleType): number =>
    t.values.mass / (Math.PI * (t.values.size / 2) ** 2);

const UNIT = [0, 1] as const;

export const STICKY_DUST: AlgorithmDeclaration = {
    id: 'stickyDust',
    label: t('algo.stickyDust.label'),
    defaultSpeed: 1.5,
    particleCapRatio: STICKY_DUST_CAP_RATIO,
    description: t('algo.stickyDust.description'),
    params,
    particleTypes: {
        labels: {
            title: t('ui.elements.title'), item: t('ui.elements.item'), count: t('ui.elements.count'),
            active: t('ui.elements.active'),
        },
        properties: [
            {
                kind: 'number', key: STICKY_DUST_PROPERTY.weight, label: t('algo.stickyDust.prop.weight.label'), unit: '', role: 'population',
                range: POPULATION_WEIGHT_RANGE, scale: linearScale(POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP),
                live: false, resetLabel: t('algo.stickyDust.prop.weight.resetLabel'),
                resetTitle: t('algo.stickyDust.prop.weight.resetTitle'),
                randomTitle: t('algo.stickyDust.prop.weight.randomTitle'), format: v => String(v),
                randomize: (count, _visible, random) => randomPopulationWeights(count, random),
            },
            {
                kind: 'number', key: STICKY_DUST_PROPERTY.mass, label: t('prop.mass'), unit: 'u',
                range: MASS_RANGE,
                // Logarithmic, so the light end (0.05-1) is as easy to set as the heavy end (10-100).
                scale: {
                    step: 1 / MASS_SLIDER_STEPS,
                    toPosition: m => massToSlider(m) / MASS_SLIDER_STEPS,
                    fromPosition: t => sliderToMass(clamp(t, UNIT) * MASS_SLIDER_STEPS),
                },
                live: true, resetLabel: t('prop.default'), resetTitle: t('algo.stickyDust.prop.mass.resetTitle'),
                randomTitle: t('algo.stickyDust.prop.mass.randomTitle'), format: formatMass,
                randomize: randomSpeciesMasses,
            },
            {
                kind: 'number', key: STICKY_DUST_PROPERTY.size, label: t('prop.size'), unit: 'px',
                range: SIZE_RANGE, scale: linearScale(SIZE_RANGE, SIZE_STEP),
                live: true, resetLabel: t('prop.default'), resetTitle: t('algo.stickyDust.prop.size.resetTitle'),
                randomTitle: t('algo.stickyDust.prop.size.randomTitle'), format: v => formatNumber(v, 1),
                randomize: (count, _visible, random) => randomSpeciesSizes(count, random),
            },
            {
                kind: 'color', label: t('prop.color'), resetTitle: t('algo.stickyDust.prop.color.resetTitle'),
                randomTitle: t('algo.stickyDust.prop.color.randomTitle'),
            },
        ],
        readouts: [{ label: t('algo.stickyDust.readout.density'), format: type => `ρ ${formatNumber(stickyDustDensity(type), 2)}` }],
        defaults: STICKY_DUST_TYPES,
        defaultCount: 3,
    builtinConfig: { id: 'builtin:chemical-elements', name: t('algo.stickyDust.builtin') },
    },
    stats: [
        { kind: 'value', key: STICKY_DUST_STAT.supernovae, label: t('algo.stickyDust.stat.supernovae'), flash: true, format: v => String(v) },
        {
            kind: 'meter', key: STICKY_DUST_STAT.concentration, label: t('algo.stickyDust.stat.concentration'),
            title: t('algo.stickyDust.stat.concentration.title'), format: f => percent(Math.round(f * 100)),
            marker: {
                param: STICKY_DUST_PARAM.supernovaThreshold,
                format: v => t('algo.stickyDust.stat.concentration.marker', { value: v }),
            },
        },
    ],
};
