import { describe, expect, it } from 'vitest';
import {
    CONCENTRATION_RADIUS_SLIDER, DEFAULT_POPULATION_WEIGHT, GRAVITY_SLIDER, K_GRAVITY, MAX_PARTICLES, MAX_SPECIES,
    PARTICLE_COUNT_SLIDER, SUPERNOVA_POWER_SLIDER, SUPERNOVA_THRESHOLD_SLIDER,
} from '../src/config';
import {
    defaultTypeCount, numberProperties, PARTICLE_COUNT_PARAM, populationProperty, populationWeights,
} from '../src/simulation/algorithm';
import { ALGORITHM_IDS, ALGORITHMS, algorithmList, DEFAULT_ALGORITHM, isAlgorithmId } from '../src/simulation/algorithms';
import { defaultParams } from '../src/simulation/params';
import { STICKY_DUST, STICKY_DUST_TYPES } from '../src/simulation/stickyDust/declaration';

describe('algorithm catalog', () => {
    it('declares every id exactly once, in the same order', () => {
        expect(algorithmList().map(a => a.id)).toEqual([...ALGORITHM_IDS]);
        for (const id of ALGORITHM_IDS) expect(ALGORITHMS[id].id).toBe(id);
    });

    it('gives every algorithm a label and a description', () => {
        for (const a of algorithmList()) {
            expect(a.label.trim()).not.toBe('');
            expect(a.description.trim()).not.toBe('');
        }
    });

    it('has a known default', () => {
        expect(isAlgorithmId(DEFAULT_ALGORITHM)).toBe(true);
        expect(ALGORITHMS[DEFAULT_ALGORITHM].label).toBe('Poussière collante');
    });

    it('rejects unknown ids', () => {
        expect(isAlgorithmId('stickyDust')).toBe(true);
        expect(isAlgorithmId('plasma')).toBe(false);
        expect(isAlgorithmId('')).toBe(false);
    });

    it('gives each algorithm its own built-in config', () => {
        const ids = algorithmList().map(a => a.particleTypes.builtinConfig.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// The UI builds itself from these declarations: every one must be consistent.
describe.each(algorithmList())('declaration of $id', algorithm => {
    it('has unique parameter keys, usable in element ids, each in a declared section', () => {
        const keys = algorithm.params.map(p => p.key);
        expect(new Set(keys).size).toBe(keys.length);
        const sections = new Set(algorithm.sections.map(s => s.id));
        expect(sections.size).toBe(algorithm.sections.length);
        for (const p of algorithm.params) {
            expect(p.key).toMatch(/^\w+$/);
            expect(sections.has(p.section)).toBe(true);
        }
    });

    it('declares the particle count, applied on restart', () => {
        const count = algorithm.params.find(p => p.key === PARTICLE_COUNT_PARAM);
        expect(count?.kind).toBe('number');
        expect(count?.apply).toBe('restart');
        if (count?.kind !== 'number') return;
        expect(count.max).toBeLessThanOrEqual(MAX_PARTICLES);
        expect(count.min).toBeGreaterThan(0);
    });

    it('has number parameters whose defaults sit inside their bounds', () => {
        for (const p of algorithm.params) {
            if (p.kind !== 'number') continue;
            expect(p.min).toBeLessThan(p.max);
            expect(p.default).toBeGreaterThanOrEqual(p.min);
            expect(p.default).toBeLessThanOrEqual(p.max);
            if (p.scale === 'log') expect(p.min).toBeGreaterThan(0);
            expect(p.format(p.default).trim()).not.toBe('');
        }
    });

    it('has default types that fit the shader arrays and set every property in range', () => {
        const schema = algorithm.particleTypes;
        expect(schema.defaults.length).toBeGreaterThan(0);
        expect(schema.defaults.length).toBeLessThanOrEqual(MAX_SPECIES);
        expect(defaultTypeCount(schema)).toBeGreaterThanOrEqual(1);
        expect(defaultTypeCount(schema)).toBeLessThanOrEqual(schema.defaults.length);
        const keys = numberProperties(schema).map(p => p.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(numberProperties(schema).filter(p => p.role === 'population').length).toBeLessThanOrEqual(1);
        for (const t of schema.defaults) {
            expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
            expect(Object.keys(t.values).sort()).toEqual([...keys].sort());
            for (const p of numberProperties(schema)) {
                expect(t.values[p.key]).toBeGreaterThanOrEqual(p.range[0]);
                expect(t.values[p.key]).toBeLessThanOrEqual(p.range[1]);
                const position = p.scale.toPosition(t.values[p.key]);
                expect(position).toBeGreaterThanOrEqual(0);
                expect(position).toBeLessThanOrEqual(1);
            }
        }
    });

    it('has transitions between existing types', () => {
        const n = algorithm.particleTypes.defaults.length;
        for (const t of algorithm.particleTypes.transitions ?? []) {
            expect(t.from).toBeLessThan(n);
            expect(t.to).toBeLessThan(n);
            expect(t.from).not.toBe(t.to);
        }
    });

    it('has stats with unique keys, meter markers on number parameters', () => {
        const keyed = (algorithm.stats ?? []).flatMap(s => s.kind === 'typeCounts' ? [] : [s]);
        expect(new Set(keyed.map(s => s.key)).size).toBe(keyed.length);
        for (const s of keyed) {
            if (s.kind !== 'meter' || !s.marker) continue;
            const marker = s.marker;
            expect(algorithm.params.find(p => p.key === marker.param)?.kind).toBe('number');
        }
    });
});

// Same values as before the algorithms declared them (panel markup and DEFAULT_SPECIES).
describe('sticky dust keeps its defaults', () => {
    it('parameters', () => {
        expect(defaultParams(STICKY_DUST)).toEqual({
            count: 30000, gravity: 3, supernovaThreshold: 60, concentrationRadius: 80, supernovaPower: 70,
        });
        const bounds = STICKY_DUST.params.map(p => p.kind === 'number' ? [p.key, p.min, p.max, p.step, p.apply] : []);
        expect(bounds).toEqual([
            ['count', 1000, 500000, 1000, 'restart'],
            ['gravity', 0, 15, 0.1, 'live'],
            ['supernovaThreshold', 0, 100, 1, 'live'],
            ['concentrationRadius', 10, 400, 5, 'live'],
            ['supernovaPower', 5, 100, 5, 'live'],
        ]);
        expect(GRAVITY_SLIDER.default).toBe(K_GRAVITY);
        expect([PARTICLE_COUNT_SLIDER, SUPERNOVA_THRESHOLD_SLIDER, CONCENTRATION_RADIUS_SLIDER, SUPERNOVA_POWER_SLIDER]
            .map(s => s.default)).toEqual([30000, 60, 80, 70]);
    });

    it('displays', () => {
        const display = Object.fromEntries(STICKY_DUST.params.map(p => [p.key, p.kind === 'number' ? p.format(p.default) : '']));
        expect(display).toEqual({
            count: (30000).toLocaleString('fr-FR'), gravity: 'G = 3.0', supernovaThreshold: '60 %',
            concentrationRadius: '80 px', supernovaPower: '70 %',
        });
        expect(STICKY_DUST.sections.map(s => [s.id, s.label]))
            .toEqual([['particles', 'Particules'], ['dynamics', 'Dynamique'], ['supernova', 'Supernova']]);
    });

    it('particle types: the first ten elements, atomic masses in u', () => {
        expect(STICKY_DUST.particleTypes.defaults).toBe(STICKY_DUST_TYPES);
        expect(STICKY_DUST_TYPES.map(t => [t.symbol, t.values.mass, t.color])).toEqual([
            ['H', 1.008, '#ffffff'], ['He', 4.0026, '#d9ffff'], ['Li', 6.94, '#cc80ff'], ['Be', 9.0122, '#c2ff00'],
            ['B', 10.81, '#ffb5b5'], ['C', 12.011, '#a8a8a8'], ['N', 14.007, '#6b8bff'], ['O', 15.999, '#ff5c5c'],
            ['F', 18.998, '#90e050'], ['Ne', 20.180, '#b3e3f5'],
        ]);
        expect(STICKY_DUST_TYPES[0].values.size).toBeCloseTo(1.9041916167664672, 12);
        expect(STICKY_DUST_TYPES.every(t => t.values.weight === DEFAULT_POPULATION_WEIGHT)).toBe(true);
        expect(defaultTypeCount(STICKY_DUST.particleTypes)).toBe(MAX_SPECIES);
        expect(populationProperty(STICKY_DUST.particleTypes)?.key).toBe('weight');
        expect(populationWeights(STICKY_DUST.particleTypes, STICKY_DUST_TYPES)).toEqual(new Array(10).fill(0.5));
        expect(STICKY_DUST.particleTypes.builtinConfig).toEqual({ id: 'builtin:chemical-elements', name: 'Éléments chimiques' });
    });

    it('stats: supernovae and the concentration meter with the threshold marker', () => {
        expect(STICKY_DUST.stats?.map(s => [s.kind, s.label])).toEqual([['value', 'Supernovae'], ['meter', 'Concentration max']]);
        const meter = STICKY_DUST.stats?.[1];
        expect(meter?.kind === 'meter' && meter.marker?.format(60)).toBe('seuil 60 %');
    });
});
