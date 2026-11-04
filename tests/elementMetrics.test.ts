import { describe, expect, it } from 'vitest';
import { MASS_RANGE, POPULATION_WEIGHT_RANGE, SIZE_RANGE, VIVID_LIGHTNESS, VIVID_SATURATION } from '../src/config';
import { buildMetrics, colorGradient, metricGroups, speciesHsl, withHue, type MetricId } from '../src/elementMetrics';
import { cloneType, linearScale, type ParticleTypeSchema } from '../src/simulation/algorithm';
import { STICKY_DUST, STICKY_DUST_TYPES } from '../src/simulation/stickyDust/declaration';
import { hexToHsl, hslToHex } from '../src/util/color';

const ELEMENT_METRICS = buildMetrics(STICKY_DUST.particleTypes);
const METRIC_GROUPS = metricGroups(ELEMENT_METRICS);
const DEFAULT_SPECIES = STICKY_DUST_TYPES;
const createSpecies = () => STICKY_DUST_TYPES.map(cloneType);
const metric = (id: MetricId) => ELEMENT_METRICS.find(m => m.id === id)!;

describe('hex <-> HSL', () => {
    it('round-trips colors', () => {
        for (const hex of ['#ffffff', '#000000', '#ff5c5c', '#6b8bff', '#c2ff00', '#808080', '#b3e3f5']) {
            expect(hslToHex(hexToHsl(hex))).toBe(hex);
        }
    });

    it('converts primaries', () => {
        expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 });
        expect(hexToHsl('#00ff00').h).toBeCloseTo(1 / 3);
        expect(hslToHex({ h: 2 / 3, s: 1, l: 0.5 })).toBe('#0000ff');
    });
});

describe('element metrics', () => {
    it('are, in order, population, atomic mass, size and the three color channels', () => {
        expect(ELEMENT_METRICS.map(m => m.label))
            .toEqual(['Répartition', 'Masse atomique', 'Taille', 'Teinte', 'Saturation', 'Luminosité']);
        expect(ELEMENT_METRICS.map(m => m.live)).toEqual([false, true, true, true, true, true]);
    });

    it('group the color channels in one tab', () => {
        expect(METRIC_GROUPS.map(g => g.label)).toEqual(['Répartition', 'Masse atomique', 'Taille', 'Couleur']);
        expect(METRIC_GROUPS[3].metrics.map(m => m.id)).toEqual(['hue', 'saturation', 'lightness']);
        expect(METRIC_GROUPS[1].unit).toBe('u');
    });

    it('place the default elements inside 0..1', () => {
        for (const m of ELEMENT_METRICS) {
            for (const s of DEFAULT_SPECIES) {
                expect(m.position(s)).toBeGreaterThanOrEqual(0);
                expect(m.position(s)).toBeLessThanOrEqual(1);
            }
        }
    });

    it('map the bar ends to the range ends', () => {
        const [s] = createSpecies();
        metric('weight').set(s, 0);
        expect(s.values.weight).toBe(POPULATION_WEIGHT_RANGE[0]);
        metric('weight').set(s, 2);
        expect(s.values.weight).toBe(POPULATION_WEIGHT_RANGE[1]);
        metric('mass').set(s, 0);
        expect(s.values.mass).toBe(MASS_RANGE[0]);
        metric('mass').set(s, 1);
        expect(s.values.mass).toBe(MASS_RANGE[1]);
        metric('size').set(s, -1);
        expect(s.values.size).toBe(SIZE_RANGE[0]);
        metric('size').set(s, 1);
        expect(s.values.size).toBe(SIZE_RANGE[1]);
    });

    it('round to their steps and report changes', () => {
        const [s] = createSpecies();
        expect(metric('weight').set(s, 0.123)).toBe(true);
        expect(s.values.weight).toBe(0.12);
        expect(metric('weight').set(s, 0.1201)).toBe(false);
        metric('size').set(s, 0.5);
        expect(s.values.size).toBe(3.5);
    });

    it('reset to the element of the periodic table at that rank', () => {
        const species = createSpecies();
        for (const m of ELEMENT_METRICS) m.randomize(species, 10, () => 0.9);
        for (const m of ELEMENT_METRICS) m.reset(species[7], 7);
        expect(species[7]).toEqual(DEFAULT_SPECIES[7]);
    });

    it('randomize inside the ranges', () => {
        const species = createSpecies();
        for (const m of ELEMENT_METRICS) m.randomize(species, 6);
        for (const s of species) {
            expect(s.values.size).toBeGreaterThanOrEqual(SIZE_RANGE[0]);
            expect(s.values.size).toBeLessThanOrEqual(SIZE_RANGE[1]);
            expect(s.values.weight).toBeGreaterThan(POPULATION_WEIGHT_RANGE[0]);
            expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
        }
    });

    it('format population as a share and the rest as values', () => {
        const [h] = DEFAULT_SPECIES;
        expect(metric('weight').format(h, 0.1)).toBe('10 %');
        expect(metric('weight').format(h, null)).toBe('–');
        expect(metric('mass').format(h, null)).toBe('1.008');
        expect(metric('lightness').format(h, null)).toBe('100 %');
        expect(metric('hue').format(DEFAULT_SPECIES[6], null)).toMatch(/^\d+°$/);
    });
});

describe('color channels', () => {
    it('reach black and white through the lightness', () => {
        const [s] = createSpecies();
        metric('hue').set(s, 0.6);
        metric('lightness').set(s, 0);
        expect(s.color).toBe('#000000');
        metric('lightness').set(s, 1);
        expect(s.color).toBe('#ffffff');
    });

    it('keep the hue and saturation through black, white and grays', () => {
        const [s] = createSpecies();
        metric('hue').set(s, 0.6);
        const vivid = speciesHsl(s);
        metric('lightness').set(s, 0);
        expect(metric('hue').position(s)).toBeCloseTo(0.6);
        metric('lightness').set(s, vivid.l);
        metric('saturation').set(s, 0);
        metric('saturation').set(s, vivid.s);
        expect(s.color).toBe(hslToHex(vivid));
    });

    it('make a color vivid when its hue could not be seen', () => {
        expect(withHue({ h: 0, s: 0, l: 1 }, 0.5)).toEqual({ h: 0.5, s: VIVID_SATURATION, l: VIVID_LIGHTNESS });
        expect(withHue({ h: 0, s: 0.5, l: 0.3 }, 0.5)).toEqual({ h: 0.5, s: 0.5, l: 0.3 });
    });

    it('reset and randomize the whole color', () => {
        const species = createSpecies();
        metric('lightness').randomize(species, 10);
        for (const s of species) expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
        metric('saturation').reset(species[2], 2);
        expect(species[2].color).toBe(DEFAULT_SPECIES[2].color);
    });

    it('draw the track gradients', () => {
        const [s] = createSpecies();
        metric('hue').set(s, 0);
        const g = metric('lightness').track!(s, 'to top');
        expect(g.startsWith('linear-gradient(to top, #000000')).toBe(true);
        expect(g.endsWith('#ffffff)')).toBe(true);
        expect(colorGradient('to right', t => ({ h: t, s: 1, l: 0.5 }))).toMatch(/^linear-gradient\(to right, #ff0000.*#ff0000\)$/);
    });
});

describe('metrics built from any schema', () => {
    const schema = {
        ...STICKY_DUST.particleTypes,
        properties: [
            {
                kind: 'number', key: 'charge', label: 'Charge', unit: 'e', range: [-1, 1], scale: linearScale([-1, 1], 0.5),
                live: false, resetLabel: 'Neutre', resetTitle: '', randomTitle: '', format: (v: number) => v.toFixed(1),
            },
        ],
        defaults: [{ name: 'A', symbol: 'A', color: '#ff0000', values: { charge: 0.5 } }],
    } satisfies ParticleTypeSchema;

    it('give one metric per number property and no color tab without a color property', () => {
        const metrics = buildMetrics(schema);
        expect(metrics.map(m => [m.id, m.group, m.unit, m.live, m.population])).toEqual([['charge', 'Charge', 'e', false, false]]);
        const [charge] = metrics;
        const t = cloneType(schema.defaults[0]);
        expect(charge.position(t)).toBe(0.75);
        expect(charge.set(t, 0.1)).toBe(true);
        expect(t.values.charge).toBe(-1);
        expect(charge.format(t, 0.3)).toBe('-1.0');
        expect(charge.reset(t, 0)).toBe(true);
        expect(t.values.charge).toBe(0.5);
    });

    it('randomize uniformly over the scale by default', () => {
        const [charge] = buildMetrics(schema);
        const types = [cloneType(schema.defaults[0])];
        charge.randomize(types, 1, () => 0);
        expect(types[0].values.charge).toBe(-1);
        charge.randomize(types, 1, () => 1);
        expect(types[0].values.charge).toBe(1);
    });

    it('flag the population metric of sticky dust', () => {
        expect(ELEMENT_METRICS.filter(m => m.population).map(m => m.id)).toEqual(['weight']);
    });
});
