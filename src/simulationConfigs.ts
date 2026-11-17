import { SIMULATION_CONFIGS_KEY, type Range } from './config';
import { cloneDarkMatter, defaultDarkMatter, sanitizeDarkMatterSettings, type DarkMatterSettings } from './darkMatter';
import {
    cleanName, cloneSetup, copyName, defaultSetup, finiteIn, isRecord, numberedName, randomId, sameSetup, sanitizeConfig,
    type AlgorithmCatalog, type ElementSetup, type KeyValueStorage,
} from './elementConfigs';
import { t } from './i18n';
import type { AlgorithmDeclaration, ParamValues } from './simulation/algorithm';
import { ALGORITHMS } from './simulation/algorithms';
import { panelParamValue } from './simulation/params';

/** The whole setup of a simulation, except the particles themselves: loading it restarts. */
export interface SimulationSetup extends ElementSetup {
    algorithm: string;
    /** The algorithm's parameters, by key. */
    params: ParamValues;
    /** Sliders shared by every algorithm (speed, visual effects), by name. */
    controls: Record<string, number>;
    /** The static dark matter's settings (its drawing and image are not saved). */
    darkMatter: DarkMatterSettings;
}

/** A named simulation setup saved in the browser. */
export interface SimulationConfig extends SimulationSetup {
    id: string;
    name: string;
}

/** A slider shared by every algorithm, as the store needs to know it (the DOM has the values). */
export interface ControlSpec {
    readonly key: string;
    readonly default: number;
    readonly range: Range;
}

interface StoredState {
    version: 1;
    currentId: string;
    /** Saved configs, including ones of algorithms this version doesn't know (kept as is). */
    configs: unknown[];
}

const BUILTIN_NAME = t('name.default');
const NEW_CONFIG_PREFIX = t('name.simulationPrefix');

const builtinId = (algorithm: string): string => `builtin:simulation:${algorithm}`;

/** Every parameter of `algorithm` from `raw` or at its default, as the panel holds it. */
const panelParams = (algorithm: AlgorithmDeclaration, raw: Record<string, unknown>): ParamValues =>
    Object.fromEntries(algorithm.params.map(p => [p.key, panelParamValue(p, raw[p.key] ?? p.default)]));

const defaultControls = (controls: readonly ControlSpec[]): Record<string, number> =>
    Object.fromEntries(controls.map(c => [c.key, c.default]));

/** The defaults of `algorithm`, as they read once the panel has shown them. */
function defaultSimulationSetup(algorithm: AlgorithmDeclaration, controls: readonly ControlSpec[]): SimulationSetup {
    return {
        algorithm: algorithm.id,
        params: panelParams(algorithm, {}),
        controls: { ...defaultControls(controls), ...(algorithm.defaultSpeed === undefined ? {} : { speed: algorithm.defaultSpeed }) },
        darkMatter: defaultDarkMatter(),
        ...defaultSetup(algorithm.particleTypes),
    };
}

export const cloneSimulationSetup = (setup: SimulationSetup): SimulationSetup => ({
    algorithm: setup.algorithm,
    params: { ...setup.params },
    controls: { ...setup.controls },
    darkMatter: cloneDarkMatter(setup.darkMatter),
    ...cloneSetup(setup),
});

const sortedEntries = (values: Readonly<Record<string, unknown>>): [string, unknown][] =>
    Object.keys(values).sort().map(k => [k, values[k]]);

/** Two setups are equal when their elements are and this key is (independent of object shape). */
const settingsKey = ({ algorithm, params, controls, darkMatter }: SimulationSetup): string =>
    JSON.stringify([algorithm, sortedEntries(params), sortedEntries(controls), sortedEntries(darkMatter.params), darkMatter.text]);

const sameSimulationSetup = (a: SimulationSetup, b: SimulationSetup): boolean =>
    settingsKey(a) === settingsKey(b) && sameSetup(a, b);

/**
 * A valid config from parsed JSON, or null when it has no usable id or its algorithm is unknown.
 * Elements go through sanitizeConfig(); invalid or missing settings get their default, and
 * out-of-range ones are clamped.
 */
export function sanitizeSimulationConfig(raw: unknown, controls: readonly ControlSpec[],
                                         catalog: AlgorithmCatalog = ALGORITHMS): SimulationConfig | null {
    if (!isRecord(raw) || typeof raw.algorithm !== 'string') return null;
    const elements = sanitizeConfig(raw, catalog);
    if (!elements) return null;
    const algorithm = catalog[elements.algorithm];
    const rawControls = isRecord(raw.controls) ? raw.controls : {};
    return {
        ...elements,
        name: typeof raw.name === 'string' && cleanName(raw.name) || NEW_CONFIG_PREFIX,
        params: panelParams(algorithm, isRecord(raw.params) ? raw.params : {}),
        controls: Object.fromEntries(controls.map(c => [c.key, finiteIn(rawControls[c.key], c.range, c.default)])),
        darkMatter: sanitizeDarkMatterSettings(raw.darkMatter),
    };
}

/**
 * Saved simulation configs, of every algorithm in one list. Each algorithm has a read-only config
 * holding its defaults (not stored: it comes from the code), so there is always a current config
 * and the defaults can always be reloaded. Every change is written to the storage right away
 * (best effort: without storage, e.g. in a private window, it works in memory only).
 */
export class SimulationConfigStore {
    private readonly configs: SimulationConfig[] = [];
    /** Stored configs of algorithms missing from the catalog, written back untouched. */
    private readonly foreign: unknown[] = [];
    private currentId = '';

    constructor(private readonly storage: KeyValueStorage | null, private readonly controls: readonly ControlSpec[],
                private readonly newId: () => string = randomId, private readonly catalog: AlgorithmCatalog = ALGORITHMS) {
        this.load();
    }

    list(): readonly SimulationConfig[] {
        return this.configs;
    }

    get current(): SimulationConfig {
        return this.configs.find(c => c.id === this.currentId) ?? this.configs[0];
    }

    /** Makes `id` the current config and returns it. */
    select(id: string): SimulationConfig {
        if (this.configs.some(c => c.id === id)) this.currentId = id;
        this.persist();
        return this.current;
    }

    /** A new config with the defaults of `algorithm`; it becomes current. */
    create(algorithm: string): SimulationConfig {
        return this.add(numberedName(NEW_CONFIG_PREFIX, this.names()),
            defaultSimulationSetup(this.catalog[algorithm], this.controls));
    }

    /** A copy of `setup` (the state being edited), named after the current config; it becomes current. */
    duplicate(setup: SimulationSetup): SimulationConfig {
        return this.add(copyName(this.current.name, this.names()), setup);
    }

    /** Whether `id` can be saved over or renamed (every config but the built-in ones). */
    canEdit(id: string): boolean {
        return this.configs.some(c => c.id === id && c.id !== builtinId(c.algorithm));
    }

    /** Returns false (and changes nothing) for an empty name or a built-in config. */
    rename(id: string, name: string): boolean {
        const config = this.configs.find(c => c.id === id);
        const clean = cleanName(name);
        if (!config || !clean || !this.canEdit(id)) return false;
        config.name = clean;
        this.persist();
        return true;
    }

    /** Whether `id` can be deleted (every config but the built-in ones). */
    canRemove(id: string): boolean {
        return this.canEdit(id);
    }

    /**
     * Removes `id` (built-in configs are kept). When it was current, the next config of the same
     * algorithm becomes current, so the simulation doesn't jump to another one. Returns the current config.
     */
    remove(id: string): SimulationConfig {
        if (!this.canRemove(id)) return this.current;
        const config = this.configs.find(c => c.id === id)!;
        const siblings = this.configs.filter(c => c.algorithm === config.algorithm);
        const index = siblings.indexOf(config);
        siblings.splice(index, 1);
        this.configs.splice(this.configs.indexOf(config), 1);
        if (id === this.currentId) this.currentId = siblings[Math.min(index, siblings.length - 1)].id;
        this.persist();
        return this.current;
    }

    /** Writes `setup` into the current config (no-op on a built-in one). Returns whether it saved. */
    save(setup: SimulationSetup): boolean {
        if (!this.canEdit(this.current.id)) return false;
        Object.assign(this.current, cloneSimulationSetup(setup));
        this.persist();
        return true;
    }

    /** True when `setup` differs from the saved version of the current config. */
    isDirty(setup: SimulationSetup): boolean {
        return !sameSimulationSetup(setup, this.current);
    }

    private names(): ReadonlySet<string> {
        return new Set(this.configs.map(c => c.name));
    }

    private add(name: string, setup: SimulationSetup): SimulationConfig {
        const config: SimulationConfig = { id: this.freshId(), name, ...cloneSimulationSetup(setup) };
        this.configs.push(config);
        this.currentId = config.id;
        this.persist();
        return config;
    }

    /** Ids are unique across every algorithm, known or not. */
    private freshId(): string {
        const taken = (id: string) => this.configs.some(c => c.id === id)
            || this.foreign.some(c => isRecord(c) && c.id === id);
        let id = this.newId();
        while (taken(id)) id = this.newId();
        return id;
    }

    private load(): void {
        for (const algorithm of Object.values(this.catalog)) {
            this.configs.push({
                id: builtinId(algorithm.id),
                name: BUILTIN_NAME,
                ...defaultSimulationSetup(algorithm, this.controls),
            });
        }
        let raw: unknown = null;
        try { raw = JSON.parse(this.storage?.getItem(SIMULATION_CONFIGS_KEY) ?? 'null'); } catch { /* corrupt: start over */ }
        if (isRecord(raw) && Array.isArray(raw.configs)) {
            const seen = new Set(this.configs.map(c => c.id));
            for (const item of raw.configs) {
                if (!isRecord(item) || typeof item.id !== 'string' || item.id === '' || seen.has(item.id)) continue;
                const config = sanitizeSimulationConfig(item, this.controls, this.catalog);
                if (!config && typeof item.algorithm !== 'string') continue;
                seen.add(item.id);
                if (config) this.configs.push(config);
                else this.foreign.push(item);
            }
            if (typeof raw.currentId === 'string') this.currentId = raw.currentId;
        }
        if (!this.configs.some(c => c.id === this.currentId)) this.currentId = this.configs[0].id;
    }

    private persist(): void {
        const saved = this.configs.filter(c => this.canEdit(c.id));
        const state: StoredState = { version: 1, currentId: this.currentId, configs: [...saved, ...this.foreign] };
        try { this.storage?.setItem(SIMULATION_CONFIGS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }
}
