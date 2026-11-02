import { MASS_JITTER, MASS_RANGE, MASS_SLIDER_STEPS } from './config';
import { clamp, shuffle } from './util/math';

/**
 * Mass is relative (only ratios matter: the total mass stays TOTAL_MASS); size is the rendered
 * diameter in CSS px. Density = mass / disc area.
 */
export interface Species {
    color: string;
    mass: number;
    size: number;
}

export const DEFAULT_SPECIES: readonly Species[] = [
    { color: '#d8b4fe', mass: 1.0, size: 2.0 },   // reference
    { color: '#67e8f9', mass: 3.0, size: 2.5 },   // heavy, dense: sinks to the core
    { color: '#fdba74', mass: 0.4, size: 3.0 },   // light, airy: floats to the rim
    { color: '#4ade80', mass: 2.0, size: 2.0 },   // dense
    { color: '#f472b6', mass: 0.7, size: 2.0 },   // slightly light
    { color: '#fde047', mass: 5.0, size: 3.0 },   // very heavy
    { color: '#60a5fa', mass: 1.5, size: 4.0 },   // big, light density
    { color: '#f87171', mass: 4.0, size: 1.5 },   // tiny and very dense: sinks hardest
    { color: '#e5e7eb', mass: 0.2, size: 1.5 },   // dust: flies fastest on ejection
    { color: '#a3e635', mass: 2.5, size: 5.0 },   // huge, airy
];

export const createSpecies = (): Species[] => DEFAULT_SPECIES.map(s => ({ ...s }));

export const speciesDensity = (s: Species): number => s.mass / (Math.PI * (s.size / 2) ** 2);

// ---- Logarithmic mass slider ----
const MASS_LOG_SPAN = Math.log(MASS_RANGE[1] / MASS_RANGE[0]);

/** Slider position -> mass, rounded to 0.01 below 1, to 0.1 below 10 and to 1 above. */
export function sliderToMass(pos: number): number {
    const m = MASS_RANGE[0] * Math.exp(pos / MASS_SLIDER_STEPS * MASS_LOG_SPAN);
    const step = m < 1 ? 0.01 : m < 10 ? 0.1 : 1;
    return clamp(Math.round(m / step) * step, MASS_RANGE);
}

export const massToSlider = (m: number): number =>
    Math.round(Math.log(m / MASS_RANGE[0]) / MASS_LOG_SPAN * MASS_SLIDER_STEPS);

export const formatMass = (m: number): string => m.toFixed(m < 1 ? 2 : m < 10 ? 1 : 0);

// ---- Randomization ----

export interface Hsl { h: number; s: number; l: number; }

/**
 * Hues evenly spread over the visible species (random start + small jitter), the rest follow
 * the golden-ratio sequence; bright, saturated tones so every species reads on black.
 */
export function randomSpeciesHsl(count: number, visible: number, random: () => number = Math.random): Hsl[] {
    visible = Math.max(1, visible);
    const start = random();
    const order = [...Array(visible).keys()].sort(() => random() - 0.5);
    return Array.from({ length: count }, (_, k) => {
        const hue = k < visible
            ? start + (order[k] + (random() - 0.5) * 0.4) / visible
            : start + k * 0.618034;
        const s = 0.7 + random() * 0.25;
        const l = 0.58 + random() * 0.14;
        return { h: ((hue % 1) + 1) % 1, s, l };
    });
}

/**
 * Visible species: the ladder 1/N, 2/N, ... 1 (N = visible species), rungs shuffled between
 * species and each nudged by up to +/- MASS_JITTER of a rung step. Hidden species get a value
 * anywhere in the same span, so they fit in if the species count is raised later.
 */
export function randomSpeciesMasses(count: number, visible: number, random: () => number = Math.random): number[] {
    visible = Math.max(1, visible);
    const rungStep = 1 / visible;
    const rungs = shuffle([...Array(visible).keys()], random);
    return Array.from({ length: count }, (_, k) => {
        const base = k < visible ? (rungs[k] + 1) * rungStep : rungStep + random() * (1 - rungStep);
        const jitter = (random() * 2 - 1) * MASS_JITTER * rungStep;
        return clamp(base + jitter, MASS_RANGE);
    });
}
