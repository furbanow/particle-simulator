// Declaration of the "sticky dust" algorithm: panel parameters, particle types (the first ten
// chemical elements) and live stats. Its GPU side is ./gpuModel.ts.

import {
    CONCENTRATION_RADIUS_SLIDER, DEFAULT_POPULATION_WEIGHT, GRAVITY_SLIDER, MASS_RANGE, MASS_SLIDER_STEPS,
    PARTICLE_COUNT_SLIDER, POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP, SIZE_RANGE, SIZE_STEP,
    SUPERNOVA_POWER_SLIDER, SUPERNOVA_THRESHOLD_SLIDER, type SliderSpec,
} from '../../config';
import { randomPopulationWeights } from '../../population';
import {
    ELEMENTS, formatMass, massToSlider, randomSpeciesMasses, randomSpeciesSizes, sliderToMass,
} from '../../species';
import { formatInt } from '../../util/format';
import { clamp } from '../../util/math';
import {
    linearScale, PARTICLE_COUNT_PARAM, type AlgorithmDeclaration, type NumberParam, type ParticleType,
} from '../algorithm';

/** Keys of the parameters and of the type properties, shared with the GPU model. */
export const STICKY_DUST_PARAM = {
    count: PARTICLE_COUNT_PARAM,
    gravity: 'gravity',
    supernovaThreshold: 'supernovaThreshold',
    concentrationRadius: 'concentrationRadius',
    supernovaPower: 'supernovaPower',
} as const;

export const STICKY_DUST_PROPERTY = { weight: 'weight', mass: 'mass', size: 'size' } as const;

export const STICKY_DUST_STAT = { supernovae: 'supernovae', concentration: 'concentration' } as const;

const percent = (v: number): string => `${v} %`;

const slider = (spec: SliderSpec) => ({ kind: 'number', min: spec.min, max: spec.max, step: spec.step, default: spec.default }) as const;

const params: readonly NumberParam[] = [
    { ...slider(PARTICLE_COUNT_SLIDER), key: STICKY_DUST_PARAM.count, label: 'Nombre de particules',
        section: 'particles', apply: 'restart', summary: true, format: formatInt },
    { ...slider(GRAVITY_SLIDER), key: STICKY_DUST_PARAM.gravity, label: 'Constante de gravité',
        section: 'dynamics', apply: 'live', summary: true, format: v => `G = ${v.toFixed(1)}` },
    { ...slider(SUPERNOVA_THRESHOLD_SLIDER), key: STICKY_DUST_PARAM.supernovaThreshold, label: 'Seuil',
        section: 'supernova', apply: 'live', summary: true, hint: 'Part des particules dans la zone', format: percent },
    { ...slider(CONCENTRATION_RADIUS_SLIDER), key: STICKY_DUST_PARAM.concentrationRadius, label: 'Rayon de concentration',
        section: 'supernova', apply: 'live', summary: true, hint: 'Zone où l\'on compte les particules', format: v => `${v} px` },
    { ...slider(SUPERNOVA_POWER_SLIDER), key: STICKY_DUST_PARAM.supernovaPower, label: 'Puissance',
        section: 'supernova', apply: 'live', summary: true, hint: 'Vitesse d\'éjection (100 % = max)', format: percent },
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
    label: 'Poussière collante',
    description: 'Gravité sur grille multi-échelle ; les amas résistent à la compression et absorbent l\'agitation.',
    sections: [
        { id: 'particles', label: 'Particules' },
        { id: 'dynamics', label: 'Dynamique' },
        { id: 'supernova', label: 'Supernova' },
    ],
    params,
    particleTypes: {
        labels: { title: 'Éléments', item: 'Élément', count: 'Nombre d\'éléments', active: 'Éléments actifs' },
        properties: [
            {
                kind: 'number', key: STICKY_DUST_PROPERTY.weight, label: 'Répartition', unit: '', role: 'population',
                range: POPULATION_WEIGHT_RANGE, scale: linearScale(POPULATION_WEIGHT_RANGE, POPULATION_WEIGHT_STEP),
                live: false, resetLabel: 'Uniforme', resetTitle: 'Même population pour chaque élément',
                randomTitle: 'Répartition aléatoire', format: v => String(v),
                randomize: (count, _visible, random) => randomPopulationWeights(count, random),
            },
            {
                kind: 'number', key: STICKY_DUST_PROPERTY.mass, label: 'Masse atomique', unit: 'u',
                range: MASS_RANGE,
                // Logarithmic, so the light end (0.05-1) is as easy to set as the heavy end (10-100).
                scale: {
                    step: 1 / MASS_SLIDER_STEPS,
                    toPosition: m => massToSlider(m) / MASS_SLIDER_STEPS,
                    fromPosition: t => sliderToMass(clamp(t, UNIT) * MASS_SLIDER_STEPS),
                },
                live: true, resetLabel: 'Par défaut', resetTitle: 'Masses atomiques des éléments chimiques',
                randomTitle: 'Masses aléatoires (échelle 1/N … 1, légèrement décalée)', format: formatMass,
                randomize: randomSpeciesMasses,
            },
            {
                kind: 'number', key: STICKY_DUST_PROPERTY.size, label: 'Taille', unit: 'px',
                range: SIZE_RANGE, scale: linearScale(SIZE_RANGE, SIZE_STEP),
                live: true, resetLabel: 'Par défaut', resetTitle: 'Tailles proportionnelles aux rayons atomiques',
                randomTitle: 'Tailles aléatoires', format: v => v.toFixed(1),
                randomize: (count, _visible, random) => randomSpeciesSizes(count, random),
            },
            { kind: 'color', label: 'Couleur', resetTitle: 'Couleurs CPK des éléments chimiques', randomTitle: 'Couleurs aléatoires' },
        ],
        readouts: [{ label: 'Densité', format: t => `ρ ${stickyDustDensity(t).toFixed(2)}` }],
        defaults: STICKY_DUST_TYPES,
        builtinConfig: { id: 'builtin:chemical-elements', name: 'Éléments chimiques' },
    },
    stats: [
        { kind: 'value', key: STICKY_DUST_STAT.supernovae, label: 'Supernovae', flash: true, format: v => String(v) },
        {
            kind: 'meter', key: STICKY_DUST_STAT.concentration, label: 'Concentration max',
            title: 'Le repère indique le seuil de supernova', format: f => `${(f * 100).toFixed(0)} %`,
            marker: { param: STICKY_DUST_PARAM.supernovaThreshold, format: v => `seuil ${v} %` },
        },
    ],
};
