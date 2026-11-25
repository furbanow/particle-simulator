import { describe, expect, it } from 'vitest';
import { SIMULATION_CONFIGS_KEY } from '../src/config';
import type { KeyValueStorage } from '../src/elementConfigs';
import {
    appliesOnRestart, PANEL_TABS, tabsOf, type AlgorithmDeclaration, type BooleanParam, type ChoiceParam, type ParamDef,
} from '../src/simulation/algorithm';
import { defaultParams, panelParamValue, validParamValue } from '../src/simulation/params';
import { STICKY_DUST } from '../src/simulation/stickyDust/declaration';
import {
    cloneSimulationSetup, sanitizeSimulationConfig, SimulationConfigStore, type ControlSpec,
} from '../src/simulationConfigs';

// The feature flags come with their features: these tests declare their own on a copy of an
// algorithm, to prove the plumbing (tab, defaults, validation, saved configurations) holds.

const flag: BooleanParam = { kind: 'boolean', key: 'tidy', label: 'Tidy', doc: 'Switches the tidying on and off.', tab: 'features', default: true };
const mode: ChoiceParam = {
    kind: 'choice', key: 'mode', label: 'Mode', doc: 'Picks how it tidies.', tab: 'features', default: 'fast',
    options: [{ value: 'fast', label: 'Fast' }, { value: 'exact', label: 'Exact' }],
};
const FLAGGED: AlgorithmDeclaration = { ...STICKY_DUST, id: 'flagged', params: [...STICKY_DUST.params, flag, mode] };
const CATALOG = { flagged: FLAGGED };

const CONTROLS: readonly ControlSpec[] = [{ key: 'speed', default: 1, range: [0, 3] }];

class MemoryStorage implements KeyValueStorage {
    readonly data = new Map<string, string>();
    getItem(key: string): string | null { return this.data.get(key) ?? null; }
    setItem(key: string, value: string): void { this.data.set(key, value); }
}

const counter = () => { let n = 0; return () => `id${++n}`; };
const newStore = (storage: KeyValueStorage) => new SimulationConfigStore(storage, CONTROLS, counter(), CATALOG);

describe('the features tab', () => {
    it('is the last tab, on the far right', () => {
        expect(PANEL_TABS.at(-1)?.id).toBe('features');
    });

    it('has a label, and shows only for an algorithm declaring a parameter in it', () => {
        expect(PANEL_TABS.find(tab => tab.id === 'features')?.label).toBe('Advanced');
        expect(tabsOf(STICKY_DUST.params.filter(p => p.tab !== 'features')).map(tab => tab.id)).toEqual(['initial', 'physics', 'supernova']);
        expect(tabsOf(FLAGGED.params).map(tab => tab.id)).toEqual(['initial', 'physics', 'supernova', 'features']);
    });
});

describe('a feature flag', () => {
    it('is applied live and starts at its default', () => {
        for (const param of [flag, mode]) expect(appliesOnRestart(param)).toBe(false);
        expect(defaultParams(FLAGGED)).toMatchObject({ tidy: true, mode: 'fast' });
    });

    it('is a boolean, whatever else is stored under its key', () => {
        expect(validParamValue(flag, false)).toBe(false);
        expect(validParamValue(flag, true)).toBe(true);
        for (const junk of ['false', 0, null, undefined, {}]) expect(validParamValue(flag, junk)).toBe(true);
        expect(validParamValue(mode, 'exact')).toBe('exact');
        expect(validParamValue(mode, 'slow')).toBe('fast');
    });

    it('reads the same once the panel has shown it', () => {
        const params: readonly ParamDef[] = [flag, mode];
        for (const param of params) {
            for (const value of [param.default, false, 'exact']) {
                const once = panelParamValue(param, value);
                expect(panelParamValue(param, once)).toBe(once);
            }
        }
        expect(panelParamValue(flag, false)).toBe(false);
    });
});

describe('a feature flag in the simulation configs', () => {
    it('starts at its default in a new config, and a saved off survives a reload', () => {
        const storage = new MemoryStorage();
        const store = newStore(storage);
        expect(store.current.params).toMatchObject({ tidy: true, mode: 'fast' });
        store.create('flagged');

        const edited = cloneSimulationSetup(store.current);
        edited.params.tidy = false;
        edited.params.mode = 'exact';
        expect(store.isDirty(edited)).toBe(true);
        expect(store.save(edited)).toBe(true);
        expect(store.isDirty(edited)).toBe(false);

        const reloaded = newStore(storage);
        expect(reloaded.current.params).toMatchObject({ tidy: false, mode: 'exact' });
    });

    it('falls back to the default when an older saved config lacks the key', () => {
        const storage = new MemoryStorage();
        const store = newStore(storage);
        const saved = store.create('flagged');
        const stored = JSON.parse(storage.getItem(SIMULATION_CONFIGS_KEY)!) as { configs: { id: string; params: Record<string, unknown> }[] };
        const config = stored.configs.find(c => c.id === saved.id)!;
        delete config.params.tidy;
        delete config.params.mode;
        storage.setItem(SIMULATION_CONFIGS_KEY, JSON.stringify(stored));

        const reloaded = newStore(storage);
        expect(reloaded.current.id).toBe(saved.id);
        expect(reloaded.current.params).toMatchObject({ tidy: true, mode: 'fast' });
        expect(reloaded.isDirty(cloneSimulationSetup(reloaded.current))).toBe(false);
    });

    it('sanitizes a stored flag like any other parameter', () => {
        const base = { id: 'a', algorithm: 'flagged' };
        const read = (params: unknown) => sanitizeSimulationConfig({ ...base, params }, CONTROLS, CATALOG)?.params;
        expect(read({ tidy: false })).toMatchObject({ tidy: false });
        expect(read({ tidy: 'no', mode: 'slow' })).toMatchObject({ tidy: true, mode: 'fast' });
        expect(read({ count: 5000 })).toMatchObject({ tidy: true, mode: 'fast', count: 5000 });
        expect(read(undefined)).toMatchObject({ tidy: true, mode: 'fast' });
    });
});
