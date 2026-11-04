import { describe, expect, it } from 'vitest';
import { ELEMENT_CONFIGS_KEY, MASS_RANGE, MAX_SPECIES, POPULATION_WEIGHT_RANGE } from '../src/config';
import { cloneSetup, ElementConfigStore, sanitizeConfig, type KeyValueStorage } from '../src/elementConfigs';
import { linearScale, type AlgorithmDeclaration } from '../src/simulation/algorithm';
import { STICKY_DUST, STICKY_DUST_TYPES } from '../src/simulation/stickyDust/declaration';

const DEFAULT_SPECIES = STICKY_DUST_TYPES;
const { id: BUILTIN_CONFIG_ID, name: DEFAULT_CONFIG_NAME } = STICKY_DUST.particleTypes.builtinConfig;

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
        edited.species[0].values.weight = 0.9;
        edited.typeCount = 4;
        expect(store.isDirty(edited)).toBe(true);
        const copy = store.duplicate(edited);
        expect(copy.name).toBe('Configuration 1 (copie)');
        expect(copy.species[0].values.weight).toBe(0.9);
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
        edited.species[0].values.mass = MASS_RANGE[1];
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
        expect(s.values.mass).toBe(MASS_RANGE[1]);
        expect(s.values.size).toBe(DEFAULT_SPECIES[0].values.size);
        expect(s.values.weight).toBe(POPULATION_WEIGHT_RANGE[0]);
        expect(config.species[5]).toEqual(DEFAULT_SPECIES[5]);
    });
});

// A second algorithm, to check that configs belong to their algorithm.
const FAKE: AlgorithmDeclaration = {
    ...STICKY_DUST,
    id: 'fake',
    particleTypes: {
        ...STICKY_DUST.particleTypes,
        properties: [{
            kind: 'number', key: 'charge', label: 'Charge', unit: 'e', range: [-1, 1], scale: linearScale([-1, 1], 1),
            live: true, resetLabel: '', resetTitle: '', randomTitle: '', format: String,
        }],
        defaults: [
            { name: 'Électron', symbol: 'e', color: '#ffff00', values: { charge: -1 } },
            { name: 'Proton', symbol: 'p', color: '#ff0000', values: { charge: 1 } },
        ],
        builtinConfig: { id: 'builtin:fake', name: 'Particules' },
    },
};
const CATALOG = { stickyDust: STICKY_DUST, fake: FAKE };

describe('configs per algorithm', () => {
    it('reads the storage of version 1 (flat species, no algorithm) as sticky dust configs', () => {
        const storage = new MemoryStorage();
        const legacySpecies: Record<string, string | number>[] =
            DEFAULT_SPECIES.map(({ name, symbol, color, values }) => ({ name, symbol, color, ...values }));
        legacySpecies[2].mass = 42;
        storage.setItem(ELEMENT_CONFIGS_KEY, JSON.stringify({
            version: 1, currentId: 'old',
            configs: [{ id: BUILTIN_CONFIG_ID, name: DEFAULT_CONFIG_NAME, typeCount: 10, species: DEFAULT_SPECIES.map(() => ({})) },
                { id: 'old', name: 'Ancienne', typeCount: 4, species: legacySpecies }],
        }));
        const store = new ElementConfigStore(storage, counter());
        expect(store.current.id).toBe('old');
        expect(store.current.algorithm).toBe('stickyDust');
        expect(store.current.typeCount).toBe(4);
        expect(store.current.species[2].values.mass).toBe(42);
        expect(store.current.species[0]).toEqual(DEFAULT_SPECIES[0]);
        // Written back in the new layout, and read again the same.
        store.select('old');
        expect(new ElementConfigStore(storage, counter()).current).toEqual(store.current);
    });

    it('keeps each algorithm its own configs, built-in config and current config', () => {
        const storage = new MemoryStorage();
        const store = new ElementConfigStore(storage, counter(), CATALOG);
        const dust = store.create();
        store.use('fake');
        expect(store.list().map(c => c.id)).toEqual(['builtin:fake']);
        expect(store.current.species).toEqual(FAKE.particleTypes.defaults);
        expect(store.current.typeCount).toBe(2);
        expect(store.canEdit('builtin:fake')).toBe(false);
        expect(store.canEdit(dust.id)).toBe(false);          // not one of this algorithm's
        const fake = store.create();
        expect(fake.name).toBe('Configuration 1');            // names are numbered per algorithm
        store.use('stickyDust');
        expect(store.current.id).toBe(dust.id);
        expect(store.list().map(c => c.id)).toEqual([BUILTIN_CONFIG_ID, dust.id]);

        const reloaded = new ElementConfigStore(storage, counter(), CATALOG);
        expect(reloaded.current.id).toBe(dust.id);
        reloaded.use('fake');
        expect(reloaded.current.id).toBe(fake.id);
    });

    it('keeps the configs of algorithms it does not know', () => {
        const storage = new MemoryStorage();
        const store = new ElementConfigStore(storage, counter(), CATALOG);
        store.use('fake');
        store.create();
        // An older build without the "fake" algorithm leaves its configs alone.
        const older = new ElementConfigStore(storage, counter());
        older.create();
        const ids = new ElementConfigStore(storage, counter(), CATALOG);
        ids.use('fake');
        expect(ids.list()).toHaveLength(2);
    });

    it('sanitizes the types against their algorithm schema', () => {
        const config = sanitizeConfig({ id: 'x', algorithm: 'fake', typeCount: 5, species: [{ values: { charge: 7, mass: 3 } }] }, CATALOG)!;
        expect(config.typeCount).toBe(2);
        expect(config.species[0].values).toEqual({ charge: 1 });
        expect(config.species[1]).toEqual(FAKE.particleTypes.defaults[1]);
        expect(sanitizeConfig({ id: 'x', algorithm: 'unknown' }, CATALOG)).toBeNull();
    });
});
