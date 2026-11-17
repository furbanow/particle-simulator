import { ELEMENT_CONFIGS_KEY } from './config';
import { t } from './i18n';
import {
    cloneType, defaultTypeCount, numberProperties, type AlgorithmDeclaration, type ParticleType,
    type ParticleTypeSchema,
} from './simulation/algorithm';
import { ALGORITHMS, DEFAULT_ALGORITHM, type AlgorithmId } from './simulation/algorithms';
import { clamp } from './util/math';

/** What the element bar edits: the particle types of an algorithm and how many of them are used. */
export interface ElementSetup {
    typeCount: number;
    species: ParticleType[];
}

/** A named element setup saved in the browser, for one algorithm. */
export interface ElementConfig extends ElementSetup {
    id: string;
    name: string;
    algorithm: string;
}

/** The minimal Storage subset the store needs (localStorage, or a fake in tests). */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Algorithms by id, as the store and the sanitizer look them up. */
export type AlgorithmCatalog = Readonly<Record<string, AlgorithmDeclaration>>;

interface StoredState {
    version: 2;
    /** Current config of each algorithm. */
    currentIds: Record<string, string>;
    /** Configs of every algorithm, including ones of algorithms this version doesn't know (kept as is). */
    configs: unknown[];
}

/** Configs saved before configs belonged to an algorithm (version 1) are sticky dust ones. */
const LEGACY_ALGORITHM: AlgorithmId = 'stickyDust';
const NEW_CONFIG_PREFIX = t('name.configPrefix');
const COPY_SUFFIX = ` (${t('name.copy')})`;
const MAX_NAME_LENGTH = 40;
const MAX_SYMBOL_LENGTH = 3;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export const defaultSetup = (schema: ParticleTypeSchema): ElementSetup =>
    ({ typeCount: defaultTypeCount(schema), species: schema.defaults.map(cloneType) });

export const cloneSetup = ({ typeCount, species }: ElementSetup): ElementSetup =>
    ({ typeCount, species: species.map(cloneType) });

/** Two setups are equal when this key is (field order fixed, so it doesn't depend on object shape). */
const setupKey = ({ typeCount, species }: ElementSetup): string =>
    JSON.stringify([typeCount, species.map(s =>
        [s.name, s.symbol, s.color, Object.keys(s.values).sort().map(k => [k, s.values[k]])])]);

export const sameSetup = (a: ElementSetup, b: ElementSetup): boolean => setupKey(a) === setupKey(b);

export const cleanName = (name: string, maxLength = MAX_NAME_LENGTH): string => name.trim().slice(0, maxLength);

/** `base`, followed by the first free number when that name is taken. */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

/** Name of a copy of a config called `name`. */
export const copyName = (name: string, taken: ReadonlySet<string>): string =>
    uniqueName(cleanName(name + COPY_SUFFIX), taken);

/** `prefix` followed by the first free number, starting at 1. */
export function numberedName(prefix: string, taken: ReadonlySet<string>): string {
    let n = 1;
    while (taken.has(`${prefix} ${n}`)) n++;
    return `${prefix} ${n}`;
}

// ---- Validation of stored data (anything may have been written there) ----

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

export function finiteIn(x: unknown, range: readonly [number, number], fallback: number): number {
    return typeof x === 'number' && Number.isFinite(x) ? clamp(x, range) : fallback;
}

function text(x: unknown, maxLength: number, fallback: string): string {
    const t = typeof x === 'string' ? cleanName(x, maxLength) : '';
    return t || fallback;
}

/**
 * A valid type of `schema` from parsed JSON. Numeric properties are read from `values`, or from
 * the type itself as configs of version 1 stored them ({ mass, size, weight }).
 */
function sanitizeType(raw: unknown, fallback: ParticleType, schema: ParticleTypeSchema): ParticleType {
    const r = isRecord(raw) ? raw : {};
    const values = isRecord(r.values) ? r.values : {};
    return {
        name: text(r.name, MAX_NAME_LENGTH, fallback.name),
        symbol: text(r.symbol, MAX_SYMBOL_LENGTH, fallback.symbol),
        color: typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color.toLowerCase() : fallback.color,
        values: Object.fromEntries(numberProperties(schema).map(p =>
            [p.key, finiteIn(values[p.key] ?? r[p.key], p.range, fallback.values[p.key])])),
    };
}

/** Algorithm id of a stored config (configs of version 1 have none). */
const storedAlgorithm = (raw: Record<string, unknown>): unknown => raw.algorithm ?? LEGACY_ALGORITHM;

/**
 * A valid config from parsed JSON, or null when it has no usable id or its algorithm is unknown.
 * Out-of-range values are clamped and missing types are filled in with the algorithm's defaults.
 */
export function sanitizeConfig(raw: unknown, catalog: AlgorithmCatalog = ALGORITHMS): ElementConfig | null {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
    const algorithm = storedAlgorithm(raw);
    if (typeof algorithm !== 'string' || !Object.hasOwn(catalog, algorithm)) return null;
    const schema = catalog[algorithm].particleTypes;
    const species = Array.isArray(raw.species) ? raw.species : [];
    const maxCount = schema.defaults.length;
    return {
        id: raw.id,
        name: text(raw.name, MAX_NAME_LENGTH, schema.builtinConfig.name),
        algorithm,
        typeCount: Math.round(finiteIn(raw.typeCount, [1, maxCount], defaultTypeCount(schema))),
        species: schema.defaults.map((fallback, k) => sanitizeType(species[k], fallback, schema)),
    };
}

export const randomId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2);

/**
 * Saved element configs, per algorithm: the methods act on the configs of the algorithm selected
 * with use(). Each algorithm's built-in config (its default types) is always there and read-only,
 * so there is always a current config and the defaults can always be reloaded. Every change is
 * written to the storage right away (best effort: without storage, e.g. in a private window, it
 * works in memory only).
 */
export class ElementConfigStore {
    private configs: ElementConfig[] = [];
    /** Stored configs of algorithms missing from the catalog, written back untouched. */
    private foreign: unknown[] = [];
    private currentIds: Record<string, string> = {};
    private algorithm: AlgorithmDeclaration;

    constructor(private readonly storage: KeyValueStorage | null, private readonly newId: () => string = randomId,
                private readonly catalog: AlgorithmCatalog = ALGORITHMS, algorithm: string = DEFAULT_ALGORITHM) {
        this.algorithm = catalog[algorithm];
        this.load();
    }

    /** Selects the algorithm the other methods act on. */
    use(algorithm: string): void {
        if (Object.hasOwn(this.catalog, algorithm)) this.algorithm = this.catalog[algorithm];
    }

    /** Configs of the selected algorithm. */
    list(): readonly ElementConfig[] {
        return this.configs.filter(c => c.algorithm === this.algorithm.id);
    }

    get current(): ElementConfig {
        const list = this.list();
        return list.find(c => c.id === this.currentIds[this.algorithm.id]) ?? list[0];
    }

    /** Makes `id` the current config and returns it. */
    select(id: string): ElementConfig {
        if (this.list().some(c => c.id === id)) this.currentIds[this.algorithm.id] = id;
        this.persist();
        return this.current;
    }

    /** Makes a config identical to `setup` current, if the current one isn't and there is one. */
    selectMatching(setup: ElementSetup): void {
        if (!this.isDirty(setup)) return;
        const match = this.list().find(c => sameSetup(c, setup));
        if (match) this.select(match.id);
    }

    /** A new config with the algorithm's default types; it becomes current. */
    create(): ElementConfig {
        return this.add(numberedName(NEW_CONFIG_PREFIX, this.names()), defaultSetup(this.algorithm.particleTypes));
    }

    /** A copy of `setup` (the state being edited), named after the current config; it becomes current. */
    duplicate(setup: ElementSetup): ElementConfig {
        return this.add(copyName(this.current.name, this.names()), setup);
    }

    /** Whether `id` can be saved over or renamed (every config but the built-in one). */
    canEdit(id: string): boolean {
        return id !== this.builtinId && this.list().some(c => c.id === id);
    }

    /** Returns false (and changes nothing) for an empty name or the built-in config. */
    rename(id: string, name: string): boolean {
        const config = this.list().find(c => c.id === id);
        const clean = cleanName(name);
        if (!config || !clean || !this.canEdit(id)) return false;
        config.name = clean;
        this.persist();
        return true;
    }

    /** Whether `id` can be deleted (every config but the built-in one). */
    canRemove(id: string): boolean {
        return this.canEdit(id);
    }

    /** Removes `id` (the built-in config is kept). Returns the new current config. */
    remove(id: string): ElementConfig {
        if (!this.canRemove(id)) return this.current;
        const list = [...this.list()];
        const index = list.findIndex(c => c.id === id);
        this.configs.splice(this.configs.indexOf(list[index]), 1);
        list.splice(index, 1);
        if (id === this.currentIds[this.algorithm.id]) this.currentIds[this.algorithm.id] = list[Math.min(index, list.length - 1)].id;
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

    private get builtinId(): string {
        return this.algorithm.particleTypes.builtinConfig.id;
    }

    private add(name: string, setup: ElementSetup): ElementConfig {
        const config: ElementConfig = { id: this.freshId(), name, algorithm: this.algorithm.id, ...cloneSetup(setup) };
        this.configs.push(config);
        this.currentIds[this.algorithm.id] = config.id;
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

    private names(): ReadonlySet<string> {
        return new Set(this.list().map(c => c.name));
    }

    private load(): void {
        let raw: unknown = null;
        try { raw = JSON.parse(this.storage?.getItem(ELEMENT_CONFIGS_KEY) ?? 'null'); } catch { /* corrupt: start over */ }
        const builtin = (algorithm: AlgorithmDeclaration): ElementConfig => {
            const { id, name } = algorithm.particleTypes.builtinConfig;
            return { id, name, algorithm: algorithm.id, ...defaultSetup(algorithm.particleTypes) };
        };
        if (isRecord(raw) && Array.isArray(raw.configs)) {
            const seen = new Set<string>();
            for (const item of raw.configs) {
                const config = sanitizeConfig(item, this.catalog);
                if (config && !seen.has(config.id)) {
                    seen.add(config.id);
                    // The built-in configs always come from the code: this also repairs one
                    // overwritten by an older version that let it be saved over.
                    const algorithm = this.catalog[config.algorithm];
                    this.configs.push(config.id === algorithm.particleTypes.builtinConfig.id ? builtin(algorithm) : config);
                } else if (!config && isRecord(item) && typeof item.id === 'string' && item.id !== ''
                           && typeof storedAlgorithm(item) === 'string' && !seen.has(item.id)) {
                    seen.add(item.id);
                    this.foreign.push(item);
                }
            }
            if (isRecord(raw.currentIds)) {
                for (const [algorithm, id] of Object.entries(raw.currentIds)) {
                    if (typeof id === 'string') this.currentIds[algorithm] = id;
                }
            } else if (typeof raw.currentId === 'string') {
                this.currentIds[LEGACY_ALGORITHM] = raw.currentId;     // version 1
            }
        }
        Object.values(this.catalog).forEach(algorithm => {
            const builtinId = algorithm.particleTypes.builtinConfig.id;
            const own = this.configs.filter(c => c.algorithm === algorithm.id);
            if (!own.some(c => c.id === builtinId)) {
                // Before the algorithm's other configs, like when the storage was empty.
                const first = own.length > 0 ? this.configs.indexOf(own[0]) : this.configs.length;
                this.configs.splice(first, 0, builtin(algorithm));
            }
            if (!this.configs.some(c => c.algorithm === algorithm.id && c.id === this.currentIds[algorithm.id])) {
                this.currentIds[algorithm.id] = this.configs.find(c => c.algorithm === algorithm.id)!.id;
            }
        });
    }

    private persist(): void {
        const state: StoredState = { version: 2, currentIds: this.currentIds, configs: [...this.configs, ...this.foreign] };
        try { this.storage?.setItem(ELEMENT_CONFIGS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }
}
