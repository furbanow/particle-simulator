// Declaration of the "protostar" algorithm: a hydrogen cloud collapses under its own gravity,
// cools, and its core ignites H -> He fusion. Panel parameters, particle types (hydrogen, helium),
// fusion reactions and live stats. Its GPU side is ./gpuModel.ts.

import {
    MASS_RANGE, MASS_SLIDER_STEPS, POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP, PROTOSTAR_AGITATION_SLIDER,
    PROTOSTAR_ALPHA_SLIDER, PROTOSTAR_COOLING_SLIDER, PROTOSTAR_COUNT_SLIDER, PROTOSTAR_FEEDBACK_SLIDER,
    PROTOSTAR_GRAVITY_SLIDER, PROTOSTAR_H_SIZE, PROTOSTAR_HE_SIZE, PROTOSTAR_LAMBDA_SLIDER, PROTOSTAR_OPACITY_SLIDER, PROTOSTAR_ROTATION_SLIDER,
    PROTOSTAR_SOFTENING_SLIDER, SIZE_RANGE, SIZE_STEP, type SliderSpec,
} from '../../config';
import { randomPopulationWeights } from '../../population';
import { ELEMENTS, formatMass, massToSlider, randomSpeciesMasses, randomSpeciesSizes, sliderToMass } from '../../species';
import { formatInt } from '../../util/format';
import { clamp } from '../../util/math';
import {
    linearScale, PARTICLE_COUNT_PARAM, type AlgorithmDeclaration, type NumberParam, type ParticleType,
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

/**
 * The fusion reactions. A later stage adds rows (He -> C with its own rate parameters, ...)
 * and the types they need; the GPU model and its shaders read the table as it is.
 */
export const PROTOSTAR_REACTIONS: readonly FusionReaction[] = [
    { from: HYDROGEN, to: HELIUM, consumed: 4, label: 'Fusion', rateParam: PROTOSTAR_PARAM.fusionRate,
        exponentParam: PROTOSTAR_PARAM.fusionExponent },
];

const slider = (spec: SliderSpec) => ({ kind: 'number', min: spec.min, max: spec.max, step: spec.step, default: spec.default }) as const;
const logSlider = (spec: SliderSpec) => ({ ...slider(spec), scale: 'log' }) as const;

/** Three significant digits, in scientific notation below 0.01 (2e-5 -> "2,00e-5"). */
export function formatSmall(v: number): string {
    if (v === 0) return '0';
    return Math.abs(v) < 0.01 ? v.toExponential(2).replace('.', ',') : String(Number(v.toPrecision(3))).replace('.', ',');
}

const fixed = (digits: number) => (v: number): string => v.toFixed(digits).replace('.', ',');

const params: readonly NumberParam[] = [
    { ...slider(PROTOSTAR_COUNT_SLIDER), key: PROTOSTAR_PARAM.count, label: 'Nombre de particules',
        section: 'cloud', apply: 'restart', summary: true, format: formatInt },
    { ...slider(PROTOSTAR_ROTATION_SLIDER), key: PROTOSTAR_PARAM.rotation, label: 'Rotation initiale',
        section: 'cloud', apply: 'restart', summary: true, hint: 'Vitesse tangentielle, en fraction de la vitesse circulaire',
        format: v => `${fixed(2)(v)} × v_circ` },
    { ...slider(PROTOSTAR_AGITATION_SLIDER), key: PROTOSTAR_PARAM.agitation, label: 'Agitation initiale',
        section: 'cloud', apply: 'restart', hint: 'Dispersion des vitesses, en fraction de la vitesse circulaire au bord',
        format: v => `${fixed(2)(v)} × v_circ` },
    { ...slider(PROTOSTAR_GRAVITY_SLIDER), key: PROTOSTAR_PARAM.gravity, label: 'Constante de gravité',
        section: 'gravity', apply: 'live', summary: true, format: v => `G = ${fixed(2)(v)}` },
    { ...slider(PROTOSTAR_SOFTENING_SLIDER), key: PROTOSTAR_PARAM.softening, label: 'Adoucissement ε',
        section: 'gravity', apply: 'live', summary: true, hint: 'En % du petit côté de l\'écran ; la grille impose environ une maille au minimum',
        format: v => `ε = ${fixed(1)(v)} %` },
    { ...slider(PROTOSTAR_COOLING_SLIDER), key: PROTOSTAR_PARAM.cooling, label: 'Refroidissement',
        section: 'cooling', apply: 'live', summary: true, hint: 'Amortissement de l\'agitation autour du flux local, par seconde',
        format: v => `${fixed(2)(v)} /s` },
    { ...logSlider(PROTOSTAR_OPACITY_SLIDER), key: PROTOSTAR_PARAM.opacity, label: 'Densité d\'opacité',
        section: 'cooling', apply: 'live', summary: true,
        hint: 'Au-delà, le gaz piège sa chaleur : le refroidissement devient k / (1 + ρ / ρ_opq)',
        format: v => `ρ_opq = ${formatSmall(v)} ρ₀` },
    { ...logSlider(PROTOSTAR_LAMBDA_SLIDER), key: PROTOSTAR_PARAM.fusionRate, label: 'Taux de fusion λ₀',
        section: 'fusion', apply: 'live', summary: true, hint: 'P = λ₀ · ρ · T^α · Δt (ρ en ρ₀, T en T₀)',
        format: v => `λ₀ = ${formatSmall(v)}` },
    { ...slider(PROTOSTAR_ALPHA_SLIDER), key: PROTOSTAR_PARAM.fusionExponent, label: 'Exposant de température α',
        section: 'fusion', apply: 'live', summary: true, hint: 'Plus il est grand, plus l\'allumage ressemble à un seuil',
        format: v => `α = ${fixed(1)(v)}` },
    { ...logSlider(PROTOSTAR_FEEDBACK_SLIDER), key: PROTOSTAR_PARAM.feedback, label: 'Rétroaction',
        section: 'fusion', apply: 'live', summary: true, hint: 'Part de l\'énergie de fusion rendue au gaz sous forme de chaleur',
        format: v => `× ${formatSmall(v)}` },
];

const element = (symbol: string) => {
    const e = ELEMENTS.find(x => x.symbol === symbol);
    if (!e) throw new Error(`Élément inconnu : ${symbol}`);
    return e;
};

/** Hydrogen (cold blue-white, all of the initial gas) and helium (yellow, none at first). */
export const PROTOSTAR_TYPES: readonly ParticleType[] = [
    { name: element('H').name, symbol: 'H', color: '#bcd4ff',
        values: { weight: 1, mass: element('H').atomicMass, size: PROTOSTAR_H_SIZE } },
    { name: element('He').name, symbol: 'He', color: '#ffd23f',
        values: { weight: 0, mass: element('He').atomicMass, size: PROTOSTAR_HE_SIZE } },
];

const UNIT = [0, 1] as const;

export const PROTOSTAR: AlgorithmDeclaration = {
    id: 'protostar',
    label: 'Protoétoile (fusion H → He)',
    description: 'Un nuage d\'hydrogène refroidit et s\'effondre ; son cœur dense et chaud allume la fusion, '
        + 'dont la chaleur freine l\'effondrement.',
    sections: [
        { id: 'cloud', label: 'Nuage' },
        { id: 'gravity', label: 'Gravité' },
        { id: 'cooling', label: 'Refroidissement' },
        { id: 'fusion', label: 'Fusion H → He' },
    ],
    params,
    particleTypes: {
        labels: { title: 'Éléments', item: 'Élément', count: 'Nombre d\'éléments', active: 'Éléments actifs' },
        properties: [
            {
                kind: 'number', key: PROTOSTAR_PROPERTY.weight, label: 'Répartition initiale', unit: '', role: 'population',
                range: POPULATION_WEIGHT_RANGE, scale: linearScale(POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP),
                live: false, resetLabel: 'Par défaut', resetTitle: 'Hydrogène pur, sans hélium primordial',
                randomTitle: 'Répartition aléatoire', format: v => String(v),
                randomize: (count, _visible, random) => randomPopulationWeights(count, random),
            },
            {
                kind: 'number', key: PROTOSTAR_PROPERTY.mass, label: 'Masse atomique', unit: 'u',
                range: MASS_RANGE,
                scale: {
                    step: 1 / MASS_SLIDER_STEPS,
                    toPosition: m => massToSlider(m) / MASS_SLIDER_STEPS,
                    fromPosition: t => sliderToMass(clamp(t, UNIT) * MASS_SLIDER_STEPS),
                },
                live: true, resetLabel: 'Par défaut', resetTitle: 'Masses atomiques de l\'hydrogène et de l\'hélium',
                randomTitle: 'Masses aléatoires', format: formatMass,
                randomize: randomSpeciesMasses,
            },
            {
                kind: 'number', key: PROTOSTAR_PROPERTY.size, label: 'Taille', unit: 'px',
                range: SIZE_RANGE, scale: linearScale(SIZE_RANGE, SIZE_STEP),
                live: true, resetLabel: 'Par défaut', resetTitle: 'Tailles par défaut',
                randomTitle: 'Tailles aléatoires', format: v => v.toFixed(1),
                randomize: (count, _visible, random) => randomSpeciesSizes(count, random),
            },
            { kind: 'color', label: 'Couleur', resetTitle: 'Couleurs par défaut', randomTitle: 'Couleurs aléatoires' },
        ],
        transitions: reactionTransitions(PROTOSTAR_REACTIONS),
        defaults: PROTOSTAR_TYPES,
        builtinConfig: { id: 'builtin:protostar', name: 'Hydrogène et hélium' },
    },
    stats: [
        { kind: 'typeCounts', label: 'Particules par type' },
        { kind: 'value', key: PROTOSTAR_STAT.coreTemperature, label: 'Température max (cœur)',
            format: v => `${fixed(2)(v)} T₀` },
        { kind: 'value', key: PROTOSTAR_STAT.coreDensity, label: 'Densité max (cœur)',
            format: v => `${v < 10 ? fixed(1)(v) : formatInt(Math.round(v))} ρ₀` },
        { kind: 'value', key: PROTOSTAR_STAT.fusionRate, label: 'Fusions / s', flash: false,
            format: v => v < 10 ? fixed(2)(v) : formatInt(Math.round(v)) },
    ],
};
