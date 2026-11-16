import { describe, expect, it } from 'vitest';
import { PARTICLE_COUNT_SLIDER, SIMULATION_CONFIGS_KEY } from '../src/config';
import { defaultDarkMatter } from '../src/darkMatter';
import type { KeyValueStorage } from '../src/elementConfigs';
import { ALGORITHMS, algorithmList } from '../src/simulation/algorithms';
import { sliderToParam, paramToSlider } from '../src/simulation/params';
import { cloneSimulationSetup, sanitizeSimulationConfig, SimulationConfigStore, type ControlSpec } from '../src/simulationConfigs';

const CONTROLS: readonly ControlSpec[] = [
    { key: 'speed', default: 1, range: [0, 3] },
    { key: 'bloom', default: 0.35, range: [0, 3] },
];

class MemoryStorage implements KeyValueStorage {
    readonly data = new Map<string, string>();
    getItem(key: string): string | null { return this.data.get(key) ?? null; }
    setItem(key: string, value: string): void { this.data.set(key, value); }
}

const counter = () => { let n = 0; return () => `id${++n}`; };
const newStore = (storage: KeyValueStorage | null = new MemoryStorage()) => new SimulationConfigStore(storage, CONTROLS, counter());

describe('simulation config store', () => {
    it('starts on the first built-in config, one per algorithm', () => {
        const store = newStore();
        expect(store.list().map(c => c.algorithm)).toEqual(algorithmList().map(a => a.id));
        expect(store.current.algorithm).toBe('stickyDust');
        expect(store.current.controls).toEqual({ speed: 1.5, bloom: 0.35 });
        expect(store.current.species).toEqual(ALGORITHMS.stickyDust.particleTypes.defaults);
    });

    it('works without storage', () => {
        const store = newStore(null);
        store.create('protostar');
        expect(store.list()).toHaveLength(algorithmList().length + 1);
    });

    it('holds the whole setup through create, duplicate, rename, save and reload', () => {
        const storage = new MemoryStorage();
        const store = newStore(storage);
        const created = store.create('protostar');
        expect(created.name).toBe('Simulation 1');
        expect(created.algorithm).toBe('protostar');
        expect(store.current.id).toBe(created.id);

        const edited = cloneSimulationSetup(store.current);
        edited.params.count = 5000;
        edited.controls.speed = 2;
        edited.typeCount = 1;
        edited.species[0].name = 'Deutérium';
        edited.species[0].color = '#123456';
        expect(store.isDirty(edited)).toBe(true);
        const copy = store.duplicate(edited);
        expect(copy.name).toBe('Simulation 1 (copie)');
        expect(store.isDirty(edited)).toBe(false);

        expect(store.rename(copy.id, '  Grand nuage  ')).toBe(true);
        expect(store.rename(copy.id, '   ')).toBe(false);
        edited.controls.bloom = 1;
        expect(store.save(edited)).toBe(true);
        edited.species[0].color = '#654321';           // the saved copy is detached from the edited state

        const reloaded = newStore(storage);
        expect(reloaded.current.id).toBe(copy.id);
        expect(reloaded.current.name).toBe('Grand nuage');
        expect(reloaded.current.params.count).toBe(5000);
        expect(reloaded.current.controls).toEqual({ speed: 2, bloom: 1 });
        expect(reloaded.current.typeCount).toBe(1);
        expect(reloaded.current.species[0]).toMatchObject({ name: 'Deutérium', color: '#123456' });
        expect(reloaded.list().map(c => c.name)).toEqual(['Par défaut', 'Par défaut', 'Simulation 1', 'Grand nuage']);
    });

    it('sees a change of any part of the setup as an edit', () => {
        const store = newStore();
        const edits: ((s: ReturnType<typeof cloneSimulationSetup>) => void)[] = [
            s => { s.algorithm = 'protostar'; },
            s => { s.params.count = 2000; },
            s => { s.controls.speed = 0; },
            s => { s.typeCount = 1; },
            s => { s.species[1].values.weight = 0.9; },
            s => { s.species[1].symbol = 'X'; },
            s => { s.darkMatter.params.strength = 7; },
            s => { s.darkMatter.text = 'Autre texte'; },
        ];
        for (const edit of edits) {
            const setup = cloneSimulationSetup(store.current);
            expect(store.isDirty(setup)).toBe(false);
            edit(setup);
            expect(store.isDirty(setup)).toBe(true);
        }
    });

    it('saves the dark matter settings, and gives them their defaults in older configs', () => {
        const storage = new MemoryStorage();
        const store = newStore(storage);
        store.create('stickyDust');
        const edited = cloneSimulationSetup(store.current);
        edited.darkMatter.params.mode = 'text';
        edited.darkMatter.text = 'Bonjour\nle monde';
        expect(store.save(edited)).toBe(true);
        expect(newStore(storage).current.darkMatter).toEqual(edited.darkMatter);

        const older = { ...store.current, darkMatter: undefined };
        expect(sanitizeSimulationConfig(older, CONTROLS)?.darkMatter).toEqual(defaultDarkMatter());
    });

    it('keeps the built-in configs read-only', () => {
        const store = newStore();
        const builtin = store.current;
        const edited = cloneSimulationSetup(builtin);
        edited.controls.speed = 3;
        expect(store.canEdit(builtin.id)).toBe(false);
        expect(store.canRemove(builtin.id)).toBe(false);
        expect(store.save(edited)).toBe(false);
        expect(store.rename(builtin.id, 'Autre')).toBe(false);
        expect(store.remove(builtin.id)).toBe(builtin);
        expect(store.current.controls.speed).toBe(1.5);
    });

    it('lets a saved config change algorithm, like any other part of the setup', () => {
        const store = newStore();
        store.create('stickyDust');
        const setup = cloneSimulationSetup(store.list().find(c => c.algorithm === 'protostar')!);
        expect(store.save(setup)).toBe(true);
        expect(store.current.algorithm).toBe('protostar');
    });

    it('stays on the same algorithm when the current config is deleted', () => {
        const store = newStore();
        const a = store.create('protostar');
        const b = store.create('stickyDust');
        const c = store.create('protostar');
        expect(store.remove(c.id).id).toBe(a.id);      // the last one of its algorithm: the previous one
        expect(store.remove(a.id).algorithm).toBe('protostar');
        expect(store.current.name).toBe('Par défaut');
        store.select(b.id);
        expect(store.remove(a.id).id).toBe(b.id);      // gone already: nothing moves
    });

    it('survives corrupt storage', () => {
        for (const junk of ['{not json', 'null', '42', '{"configs":"no"}', '{"configs":[null,3,{"id":""},{"id":"x"}]}']) {
            const storage = new MemoryStorage();
            storage.setItem(SIMULATION_CONFIGS_KEY, junk);
            expect(newStore(storage).list()).toHaveLength(algorithmList().length);
        }
    });

    it('does not let stored data replace a built-in config or an unknown current id stand', () => {
        const storage = new MemoryStorage();
        const store = newStore(storage);
        const builtin = store.current;
        storage.setItem(SIMULATION_CONFIGS_KEY, JSON.stringify({
            currentId: 'gone',
            configs: [{ ...builtin, name: 'Piraté', controls: { speed: 3 } }],
        }));
        const reloaded = newStore(storage);
        expect(reloaded.current.id).toBe(builtin.id);
        expect(reloaded.current.name).toBe('Par défaut');
        expect(reloaded.current.controls.speed).toBe(1.5);
    });

    it('keeps configs of unknown algorithms untouched', () => {
        const storage = new MemoryStorage();
        const foreign = { id: 'f1', name: 'Du futur', algorithm: 'future', params: { warp: 9 } };
        storage.setItem(SIMULATION_CONFIGS_KEY, JSON.stringify({ configs: [foreign] }));
        const store = newStore(storage);
        expect(store.list().some(c => c.id === 'f1')).toBe(false);
        store.create('stickyDust');
        const stored = JSON.parse(storage.getItem(SIMULATION_CONFIGS_KEY)!) as { configs: { id: string }[] };
        expect(stored.configs.find(c => c.id === 'f1')).toEqual(foreign);
    });
});

describe('sanitizeSimulationConfig', () => {
    it('refuses a config with no usable id or a missing or unknown algorithm', () => {
        expect(sanitizeSimulationConfig(null, CONTROLS)).toBeNull();
        expect(sanitizeSimulationConfig({ algorithm: 'stickyDust' }, CONTROLS)).toBeNull();
        expect(sanitizeSimulationConfig({ id: 'a' }, CONTROLS)).toBeNull();
        expect(sanitizeSimulationConfig({ id: 'a', algorithm: 'future' }, CONTROLS)).toBeNull();
    });

    it('fills in, clamps and drops what is wrong', () => {
        const config = sanitizeSimulationConfig({
            id: 'a',
            name: 42,
            algorithm: 'stickyDust',
            params: { count: 1e12, gravity: 'fort', unknown: 1 },
            controls: { speed: 99, bloom: 'beaucoup', other: 1 },
            typeCount: 2,
            species: [{ name: 'Azote', color: 'rouge' }],
        }, CONTROLS)!;
        const defaults = ALGORITHMS.stickyDust.particleTypes.defaults;
        expect(config.name).toBe('Simulation');
        expect(config.params.count).toBe(PARTICLE_COUNT_SLIDER.max);
        expect(config.params).not.toHaveProperty('unknown');
        expect(config.controls).toEqual({ speed: 3, bloom: 0.35 });
        expect(config.typeCount).toBe(2);
        expect(config.species).toHaveLength(defaults.length);
        expect(config.species[0]).toMatchObject({ name: 'Azote', color: defaults[0].color });
    });
});

describe('built-in configs against the panel', () => {
    it('are not edited by the rounding of the sliders that show them', () => {
        const store = newStore();
        for (const config of store.list()) {
            store.select(config.id);
            const shown = cloneSimulationSetup(config);
            for (const param of ALGORITHMS[config.algorithm as keyof typeof ALGORITHMS].params) {
                if (param.kind === 'number') {
                    // What ParamPanel pushes to the simulation when it builds the slider.
                    shown.params[param.key] = sliderToParam(param, paramToSlider(param, shown.params[param.key] as number));
                }
            }
            expect(store.isDirty(shown)).toBe(false);
        }
    });
});
