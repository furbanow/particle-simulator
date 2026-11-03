import { ELEMENT_CONFIGS_KEY, MASS_RANGE, MAX_SPECIES, POPULATION_WEIGHT_RANGE, SIZE_RANGE } from './config';
import { createSpecies, DEFAULT_SPECIES, type Species } from './species';
import { clamp } from './util/math';

/** What the element bar edits: the species definitions and how many of them are used. */
export interface ElementSetup {
    typeCount: number;
    species: Species[];
}

/** A named element setup saved in the browser. */
export interface ElementConfig extends ElementSetup {
    id: string;
    name: string;
}

/** The minimal Storage subset the store needs (localStorage, or a fake in tests). */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

interface StoredState {
    version: 1;
    currentId: string;
    configs: ElementConfig[];
}

export const DEFAULT_CONFIG_NAME = 'Éléments chimiques';
/** Id of the config shipped with the app: always present, read-only (cannot be saved over, renamed or deleted). */
export const BUILTIN_CONFIG_ID = 'builtin:chemical-elements';
const NEW_CONFIG_PREFIX = 'Configuration';
const COPY_SUFFIX = ' (copie)';
const MAX_NAME_LENGTH = 40;
const MAX_SYMBOL_LENGTH = 3;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export const defaultSetup = (): ElementSetup => ({ typeCount: MAX_SPECIES, species: createSpecies() });

export const cloneSetup = ({ typeCount, species }: ElementSetup): ElementSetup =>
    ({ typeCount, species: species.map(s => ({ ...s })) });

/** Two setups are equal when this key is (field order fixed, so it doesn't depend on object shape). */
const setupKey = ({ typeCount, species }: ElementSetup): string =>
    JSON.stringify([typeCount, species.map(s => [s.name, s.symbol, s.color, s.mass, s.size, s.weight])]);

export const sameSetup = (a: ElementSetup, b: ElementSetup): boolean => setupKey(a) === setupKey(b);

export const cleanName = (name: string, maxLength = MAX_NAME_LENGTH): string => name.trim().slice(0, maxLength);

// ---- Validation of stored data (anything may have been written there) ----

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function finiteIn(x: unknown, range: readonly [number, number], fallback: number): number {
    return typeof x === 'number' && Number.isFinite(x) ? clamp(x, range) : fallback;
}

function text(x: unknown, maxLength: number, fallback: string): string {
    const t = typeof x === 'string' ? cleanName(x, maxLength) : '';
    return t || fallback;
}

function sanitizeSpecies(raw: unknown, fallback: Species): Species {
    const r = isRecord(raw) ? raw : {};
    return {
        name: text(r.name, MAX_NAME_LENGTH, fallback.name),
        symbol: text(r.symbol, MAX_SYMBOL_LENGTH, fallback.symbol),
        color: typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color.toLowerCase() : fallback.color,
        mass: finiteIn(r.mass, MASS_RANGE, fallback.mass),
        size: finiteIn(r.size, SIZE_RANGE, fallback.size),
        weight: finiteIn(r.weight, POPULATION_WEIGHT_RANGE, fallback.weight),
    };
}

/**
 * A valid config from parsed JSON, or null when it has no usable id. Out-of-range values are
 * clamped and missing species are filled in with the default elements.
 */
export function sanitizeConfig(raw: unknown): ElementConfig | null {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
    const species = Array.isArray(raw.species) ? raw.species : [];
    return {
        id: raw.id,
        name: text(raw.name, MAX_NAME_LENGTH, DEFAULT_CONFIG_NAME),
        typeCount: Math.round(finiteIn(raw.typeCount, [1, MAX_SPECIES], MAX_SPECIES)),
        species: DEFAULT_SPECIES.map((fallback, k) => sanitizeSpecies(species[k], fallback)),
    };
}

const randomId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2);

/**
 * Saved element configs. The built-in config (chemical elements) is always there and read-only,
 * so there is always a current config and the defaults can always be reloaded. Every
 * change is written to the storage right away (best effort: without storage, e.g. in a private
 * window, it works in memory only).
 */
export class ElementConfigStore {
    private configs: ElementConfig[] = [];
    private currentId = '';

    constructor(private readonly storage: KeyValueStorage | null, private readonly newId: () => string = randomId) {
        this.load();
    }

    list(): readonly ElementConfig[] {
        return this.configs;
    }

    get current(): ElementConfig {
        return this.configs.find(c => c.id === this.currentId) ?? this.configs[0];
    }

    /** Makes `id` the current config and returns it. */
    select(id: string): ElementConfig {
        if (this.configs.some(c => c.id === id)) this.currentId = id;
        this.persist();
        return this.current;
    }

    /** A new config with the chemical elements, uniform population; it becomes current. */
    create(): ElementConfig {
        return this.add(this.numberedName(NEW_CONFIG_PREFIX), defaultSetup());
    }

    /** A copy of `setup` (the state being edited), named after the current config; it becomes current. */
    duplicate(setup: ElementSetup): ElementConfig {
        return this.add(this.uniqueName(cleanName(this.current.name + COPY_SUFFIX)), setup);
    }

    /** Whether `id` can be saved over or renamed (every config but the built-in one). */
    canEdit(id: string): boolean {
        return id !== BUILTIN_CONFIG_ID && this.configs.some(c => c.id === id);
    }

    /** Returns false (and changes nothing) for an empty name or the built-in config. */
    rename(id: string, name: string): boolean {
        const config = this.configs.find(c => c.id === id);
        const clean = cleanName(name);
        if (!config || !clean || !this.canEdit(id)) return false;
        config.name = clean;
        this.persist();
        return true;
    }

    /** Whether `id` can be deleted (every config but the built-in one). */
    canRemove(id: string): boolean {
        return id !== BUILTIN_CONFIG_ID && this.configs.some(c => c.id === id);
    }

    /** Removes `id` (the built-in config is kept). Returns the new current config. */
    remove(id: string): ElementConfig {
        if (!this.canRemove(id)) return this.current;
        const index = this.configs.findIndex(c => c.id === id);
        this.configs.splice(index, 1);
        if (id === this.currentId) this.currentId = this.configs[Math.min(index, this.configs.length - 1)].id;
        this.persist();
        return this.current;
    }

    /** Writes `setup` into the current config (no-op on the built-in one). Returns whether it saved. */
    save(setup: ElementSetup): boolean {
        if (!this.canEdit(this.current.id)) return false;
        Object.assign(this.current, cloneSetup(setup));
        this.persist();
        return true;
    }

    /** True when `setup` differs from the saved version of the current config. */
    isDirty(setup: ElementSetup): boolean {
        return !sameSetup(setup, this.current);
    }

    private add(name: string, setup: ElementSetup): ElementConfig {
        const config: ElementConfig = { id: this.freshId(), name, ...cloneSetup(setup) };
        this.configs.push(config);
        this.currentId = config.id;
        this.persist();
        return config;
    }

    private freshId(): string {
        let id = this.newId();
        while (this.configs.some(c => c.id === id)) id = this.newId();
        return id;
    }

    private uniqueName(base: string): string {
        const taken = new Set(this.configs.map(c => c.name));
        if (!taken.has(base)) return base;
        let n = 2;
        while (taken.has(`${base} ${n}`)) n++;
        return `${base} ${n}`;
    }

    private numberedName(prefix: string): string {
        const taken = new Set(this.configs.map(c => c.name));
        let n = 1;
        while (taken.has(`${prefix} ${n}`)) n++;
        return `${prefix} ${n}`;
    }

    private load(): void {
        let raw: unknown = null;
        try { raw = JSON.parse(this.storage?.getItem(ELEMENT_CONFIGS_KEY) ?? 'null'); } catch { /* corrupt: start over */ }
        const builtin = (): ElementConfig => ({ id: BUILTIN_CONFIG_ID, name: DEFAULT_CONFIG_NAME, ...defaultSetup() });
        if (isRecord(raw) && Array.isArray(raw.configs)) {
            const seen = new Set<string>();
            for (const item of raw.configs) {
                const config = sanitizeConfig(item);
                if (config && !seen.has(config.id)) {
                    seen.add(config.id);
                    // The built-in config always comes from the code: this also repairs one
                    // overwritten by an older version that let it be saved over.
                    this.configs.push(config.id === BUILTIN_CONFIG_ID ? builtin() : config);
                }
            }
            if (typeof raw.currentId === 'string') this.currentId = raw.currentId;
        }
        if (!this.configs.some(c => c.id === BUILTIN_CONFIG_ID)) this.configs.unshift(builtin());
        if (!this.configs.some(c => c.id === this.currentId)) this.currentId = this.configs[0].id;
    }

    private persist(): void {
        const state: StoredState = { version: 1, currentId: this.currentId, configs: this.configs };
        try { this.storage?.setItem(ELEMENT_CONFIGS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }
}
