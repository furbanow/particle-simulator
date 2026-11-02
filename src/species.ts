import { MASS_JITTER, MASS_RANGE, MASS_SLIDER_STEPS, SIZE_RANGE } from './config';
import { clamp, shuffle } from './util/math';

/**
 * A species is a chemical element. Mass is the atomic mass in u (only ratios matter to the
 * simulation: the total mass stays TOTAL_MASS); size is the rendered diameter in CSS px.
 * Density = mass / disc area.
 */
export interface Species {
    name: string;
    symbol: string;
    color: string;
    mass: number;
    size: number;
}

interface Element {
    name: string;
    symbol: string;
    atomicMass: number;     // u, IUPAC standard atomic weight (conventional value)
    radius: number;         // pm, calculated atomic radius (Clementi et al., 1967)
    color: string;          // CPK / Jmol color, lightened where too dark on black
}

/** The first ten elements of the periodic table, in order. */
export const ELEMENTS: readonly Element[] = [
    { name: 'Hydrogène', symbol: 'H',  atomicMass: 1.008,  radius: 53,  color: '#ffffff' },
    { name: 'Hélium',    symbol: 'He', atomicMass: 4.0026, radius: 31,  color: '#d9ffff' },
    { name: 'Lithium',   symbol: 'Li', atomicMass: 6.94,   radius: 167, color: '#cc80ff' },
    { name: 'Béryllium', symbol: 'Be', atomicMass: 9.0122, radius: 112, color: '#c2ff00' },
    { name: 'Bore',      symbol: 'B',  atomicMass: 10.81,  radius: 87,  color: '#ffb5b5' },
    { name: 'Carbone',   symbol: 'C',  atomicMass: 12.011, radius: 67,  color: '#a8a8a8' },
    { name: 'Azote',     symbol: 'N',  atomicMass: 14.007, radius: 56,  color: '#6b8bff' },
    { name: 'Oxygène',   symbol: 'O',  atomicMass: 15.999, radius: 48,  color: '#ff5c5c' },
    { name: 'Fluor',     symbol: 'F',  atomicMass: 18.998, radius: 42,  color: '#90e050' },
    { name: 'Néon',      symbol: 'Ne', atomicMass: 20.180, radius: 38,  color: '#b3e3f5' },
];

// Rendered diameters are proportional to the atomic radii, the largest atom filling the slider.
const MAX_RADIUS = Math.max(...ELEMENTS.map(e => e.radius));

export const DEFAULT_SPECIES: readonly Species[] = ELEMENTS.map(({ name, symbol, atomicMass, radius, color }) => ({
    name, symbol, color, mass: atomicMass, size: radius / MAX_RADIUS * SIZE_RANGE[1],
}));

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

/** Four significant digits without trailing zeros, like standard atomic weights (4.003, 20.18). */
export const formatMass = (m: number): string => String(Number(m.toPrecision(4)));

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
