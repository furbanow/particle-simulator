import { describe, expect, it } from 'vitest';
import { ELEMENT_CONFIGS_KEY, MASS_RANGE, MAX_SPECIES, POPULATION_WEIGHT_RANGE } from '../src/config';
import {
    BUILTIN_CONFIG_ID, cloneSetup, DEFAULT_CONFIG_NAME, ElementConfigStore, sanitizeConfig, type KeyValueStorage,
} from '../src/elementConfigs';
import { DEFAULT_SPECIES } from '../src/species';

class MemoryStorage implements KeyValueStorage {
    readonly data = new Map<string, string>();
    getItem(key: string): string | null { return this.data.get(key) ?? null; }
    setItem(key: string, value: string): void { this.data.set(key, value); }
}

const counter = () => { let n = 0; return () => `id${++n}`; };

describe('element config store', () => {
    it('starts with the chemical elements on an empty storage', () => {
        const store = new ElementConfigStore(new MemoryStorage(), counter());
        expect(store.list()).toHaveLength(1);
        expect(store.current.name).toBe(DEFAULT_CONFIG_NAME);
        expect(store.current.id).toBe(BUILTIN_CONFIG_ID);
        expect(store.current.typeCount).toBe(MAX_SPECIES);
        expect(store.current.species).toEqual(DEFAULT_SPECIES);
    });

    it('works without storage', () => {
        const store = new ElementConfigStore(null, counter());
        store.create();
        expect(store.list()).toHaveLength(2);
    });

    it('creates, duplicates, renames, saves and reloads configs', () => {
        const storage = new MemoryStorage();
        const store = new ElementConfigStore(storage, counter());
        const created = store.create();
        expect(created.name).toBe('Configuration 1');
        expect(store.current.id).toBe(created.id);
        expect(created.species).toEqual(DEFAULT_SPECIES);

        const edited = cloneSetup(store.current);
        edited.species[0].weight = 0.9;
        edited.typeCount = 4;
        expect(store.isDirty(edited)).toBe(true);
        const copy = store.duplicate(edited);
        expect(copy.name).toBe('Configuration 1 (copie)');
        expect(copy.species[0].weight).toBe(0.9);
        expect(store.isDirty(edited)).toBe(false);

        expect(store.rename(copy.id, '  Mélange léger  ')).toBe(true);
        expect(store.rename(copy.id, '   ')).toBe(false);
        edited.species[1].color = '#123456';
        store.save(edited);
        edited.species[1].color = '#654321';           // the saved copy is detached from the edited state
        expect(store.current.species[1].color).toBe('#123456');

        const reloaded = new ElementConfigStore(storage, counter());
        expect(reloaded.list().map(c => c.name)).toEqual([DEFAULT_CONFIG_NAME, 'Configuration 1', 'Mélange léger']);
        expect(reloaded.current.id).toBe(copy.id);
        expect(reloaded.current.typeCount).toBe(4);
        expect(reloaded.current.species[1].color).toBe('#123456');
    });

    it('numbers new configs and copies without clashing', () => {
        const store = new ElementConfigStore(null, counter());
        expect(store.create().name).toBe('Configuration 1');
        expect(store.create().name).toBe('Configuration 2');
        store.duplicate(store.current);
        store.select(store.list()[2].id);
        expect(store.duplicate(store.current).name).toBe('Configuration 2 (copie) 2');
    });

    it('selects a neighbour on removal', () => {
        const store = new ElementConfigStore(null, counter());
        const second = store.create();
        const third = store.create();
        store.select(second.id);
        expect(store.remove(second.id).id).toBe(third.id);
        expect(store.remove(third.id).id).toBe(BUILTIN_CONFIG_ID);
    });

    it('never removes the built-in config', () => {
        const store = new ElementConfigStore(null, counter());
        expect(store.canRemove(BUILTIN_CONFIG_ID)).toBe(false);
        expect(store.canRemove(store.create().id)).toBe(true);
        store.select(BUILTIN_CONFIG_ID);
        expect(store.remove(BUILTIN_CONFIG_ID).id).toBe(BUILTIN_CONFIG_ID);
        expect(store.list()).toHaveLength(2);
    });

    it('keeps the built-in config read-only', () => {
        const storage = new MemoryStorage();
        const store = new ElementConfigStore(storage, counter());
        expect(store.canEdit(BUILTIN_CONFIG_ID)).toBe(false);
        const edited = cloneSetup(store.current);
        edited.species[0].mass = MASS_RANGE[1];
        expect(store.save(edited)).toBe(false);
        expect(store.rename(BUILTIN_CONFIG_ID, 'Autre')).toBe(false);
        expect(store.current.species).toEqual(DEFAULT_SPECIES);
        expect(store.current.name).toBe(DEFAULT_CONFIG_NAME);
        expect(store.canEdit(store.create().id)).toBe(true);
    });

    it('resets a built-in config overwritten in the storage', () => {
        const storage = new MemoryStorage();
        const overwritten = { id: BUILTIN_CONFIG_ID, name: 'Modifiée', typeCount: 3, species: [{ mass: MASS_RANGE[1] }] };
        storage.setItem(ELEMENT_CONFIGS_KEY, JSON.stringify({ currentId: BUILTIN_CONFIG_ID, configs: [{ id: 'a' }, overwritten] }));
        const store = new ElementConfigStore(storage, counter());
        expect(store.list().map(c => c.id)).toEqual(['a', BUILTIN_CONFIG_ID]);
        expect(store.current.name).toBe(DEFAULT_CONFIG_NAME);
        expect(store.current.typeCount).toBe(MAX_SPECIES);
        expect(store.current.species).toEqual(DEFAULT_SPECIES);
    });

    it('restores the built-in config if the storage lost it', () => {
        const storage = new MemoryStorage();
        storage.setItem(ELEMENT_CONFIGS_KEY, JSON.stringify({ currentId: 'a', configs: [{ id: 'a', name: 'A' }] }));
        const store = new ElementConfigStore(storage, counter());
        expect(store.list().map(c => c.id)).toEqual([BUILTIN_CONFIG_ID, 'a']);
        expect(store.current.id).toBe('a');
    });

    it('recovers from corrupt storage', () => {
        const storage = new MemoryStorage();
        storage.setItem(ELEMENT_CONFIGS_KEY, '{not json');
        expect(new ElementConfigStore(storage, counter()).current.name).toBe(DEFAULT_CONFIG_NAME);
        storage.setItem(ELEMENT_CONFIGS_KEY, JSON.stringify({ currentId: 'missing', configs: [{ id: 'a', name: 'A' }, 42, { id: 'a' }] }));
        const store = new ElementConfigStore(storage, counter());
        expect(store.list().map(c => c.id)).toEqual([BUILTIN_CONFIG_ID, 'a']);
        expect(store.current.id).toBe(BUILTIN_CONFIG_ID);
    });
});

describe('sanitizeConfig', () => {
    it('rejects configs without an id', () => {
        expect(sanitizeConfig(null)).toBeNull();
        expect(sanitizeConfig({ name: 'x' })).toBeNull();
    });

    it('clamps values and fills in missing species', () => {
        const config = sanitizeConfig({
            id: 'x', name: '', typeCount: 99,
            species: [{ name: 'Test', symbol: 'Tst4', color: 'red', mass: 1e9, size: Number.NaN, weight: -3 }],
        })!;
        expect(config.name).toBe(DEFAULT_CONFIG_NAME);
        expect(config.typeCount).toBe(MAX_SPECIES);
        expect(config.species).toHaveLength(MAX_SPECIES);
        const [s] = config.species;
        expect(s.name).toBe('Test');
        expect(s.symbol).toBe('Tst');
        expect(s.color).toBe(DEFAULT_SPECIES[0].color);
        expect(s.mass).toBe(MASS_RANGE[1]);
        expect(s.size).toBe(DEFAULT_SPECIES[0].size);
        expect(s.weight).toBe(POPULATION_WEIGHT_RANGE[0]);
        expect(config.species[5]).toEqual(DEFAULT_SPECIES[5]);
    });
});
