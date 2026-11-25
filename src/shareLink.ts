import { SHARE_KEY } from './config';
import { ALL_DRAWING_PARAMS, DRAWING_KINDS, type DrawingKind } from './drawing';
import type { AlgorithmCatalog } from './elementConfigs';
import { numberProperties, type ParamDef, type ParamValue, type ParticleType } from './simulation/algorithm';
import { ALGORITHMS } from './simulation/algorithms';
import {
    defaultSimulationSetup, sanitizeSimulationConfig, type ControlSpec, type SimulationSetup,
} from './simulationConfigs';

/**
 * Share links: a whole simulation setup as a readable query string, holding only what differs from
 * the defaults of its algorithm, e.g. `algo=protostar&gravity=1.2&speed=3&species.0.mass=4`.
 * Everything is read from the declarations (parameters, particle types, shared sliders, drawing
 * settings), so a new algorithm is shared with no extra code. Keys:
 *   algo                                 the algorithm id (required)
 *   <param key>                          a parameter of the algorithm
 *   <control key>                        a slider shared by every algorithm (speed, visual effects)
 *   <kind>.<key>, <kind>.text            a drawing setting, the text of a drawing kind
 *   types                                the number of particle types used
 *   species.<rank>.<name|symbol|color|property key>
 * A link read back goes through sanitizeSimulationConfig(): unknown keys are ignored, invalid
 * values fall back to their default and out-of-range ones are clamped.
 */

/** Significant digits of the numbers written (no binary noise such as 0.30000000000000004). */
const NUMBER_DIGITS = 12;
const SHARED_ID = 'shared';
const COLOR_PREFIX = '#';

const formatNumber = (value: number): string => String(Number(value.toPrecision(NUMBER_DIGITS)));

function formatValue(value: ParamValue): string {
    if (typeof value === 'boolean') return value ? '1' : '0';
    return typeof value === 'number' ? formatNumber(value) : value;
}

/** The value of `def` written as `text`, or undefined when it is not one (the default then applies). */
function parseValue(def: ParamDef, text: string): ParamValue | undefined {
    switch (def.kind) {
        case 'number': return text.trim() === '' ? undefined : Number(text);
        case 'boolean': return text === '1' || text === 'true' ? true : text === '0' || text === 'false' ? false : undefined;
        case 'choice': return text;
    }
}

const textKey = (kind: DrawingKind): string => `${kind}${SHARE_KEY.textSuffix}`;
const speciesKey = (rank: number, field: string): string => `${SHARE_KEY.speciesPrefix}${rank}.${field}`;

/** The fields of a particle type as a link writes them (text values), by field name. */
function typeFields(type: ParticleType): Record<string, string> {
    const fields: Record<string, string> = {
        name: type.name,
        symbol: type.symbol,
        color: type.color.replace(COLOR_PREFIX, ''),
    };
    for (const [key, value] of Object.entries(type.values)) fields[key] = formatNumber(value);
    return fields;
}

/** Every key a link may hold for `algorithm`, apart from the species (for the collision check of the tests). */
export function shareKeys(algorithm: string, controls: readonly ControlSpec[], catalog: AlgorithmCatalog = ALGORITHMS): string[] {
    return [
        SHARE_KEY.algorithm, SHARE_KEY.typeCount,
        ...catalog[algorithm].params.map(p => p.key),
        ...controls.map(c => c.key),
        ...ALL_DRAWING_PARAMS.map(p => p.key),
        ...DRAWING_KINDS.map(textKey),
    ];
}

/** The query string (without `?`) of a link to `setup`. */
export function encodeShareQuery(setup: SimulationSetup, controls: readonly ControlSpec[],
                                 catalog: AlgorithmCatalog = ALGORITHMS): string {
    const algorithm = catalog[setup.algorithm];
    const defaults = defaultSimulationSetup(algorithm, controls);
    const query = new URLSearchParams({ [SHARE_KEY.algorithm]: setup.algorithm });
    const put = (key: string, value: ParamValue | undefined, fallback: ParamValue | undefined): void => {
        if (value !== undefined && value !== fallback) query.set(key, formatValue(value));
    };
    for (const p of algorithm.params) put(p.key, setup.params[p.key], defaults.params[p.key]);
    for (const c of controls) put(c.key, setup.controls[c.key], defaults.controls[c.key]);
    for (const p of ALL_DRAWING_PARAMS) put(p.key, setup.drawing.params[p.key], defaults.drawing.params[p.key]);
    for (const kind of DRAWING_KINDS) put(textKey(kind), setup.drawing.texts[kind], defaults.drawing.texts[kind]);
    put(SHARE_KEY.typeCount, setup.typeCount, defaults.typeCount);
    defaults.species.forEach((fallback, rank) => {
        const type = setup.species[rank];
        if (!type) return;
        const now = typeFields(type);
        const before = typeFields(fallback);
        for (const [field, text] of Object.entries(now)) {
            if (text !== before[field]) query.set(speciesKey(rank, field), text);
        }
    });
    return query.toString();
}

/** The setup a link's query string (with or without `?`) holds, or null when it is not a share link. */
export function decodeShareQuery(search: string, controls: readonly ControlSpec[],
                                 catalog: AlgorithmCatalog = ALGORITHMS): SimulationSetup | null {
    const query = new URLSearchParams(search);
    const id = query.get(SHARE_KEY.algorithm);
    if (id === null || !Object.hasOwn(catalog, id)) return null;
    const algorithm = catalog[id];
    const defaults = defaultSimulationSetup(algorithm, controls);
    const read = (def: ParamDef, into: Record<string, unknown>): void => {
        const text = query.get(def.key);
        const value = text === null ? undefined : parseValue(def, text);
        if (value !== undefined) into[def.key] = value;
    };

    const params: Record<string, unknown> = { ...defaults.params };
    for (const p of algorithm.params) read(p, params);
    const controlValues: Record<string, unknown> = { ...defaults.controls };
    for (const c of controls) {
        const text = query.get(c.key);
        if (text !== null) controlValues[c.key] = Number(text);
    }
    const drawingParams: Record<string, unknown> = { ...defaults.drawing.params };
    for (const p of ALL_DRAWING_PARAMS) read(p, drawingParams);
    const texts: Record<string, unknown> = { ...defaults.drawing.texts };
    for (const kind of DRAWING_KINDS) texts[kind] = query.get(textKey(kind)) ?? texts[kind];

    const properties = numberProperties(algorithm.particleTypes);
    const species = defaults.species.map((type, rank) => {
        const field = (name: string): string | null => query.get(speciesKey(rank, name));
        const color = field('color');
        const values: Record<string, unknown> = { ...type.values };
        for (const p of properties) {
            const text = field(p.key);
            if (text !== null) values[p.key] = Number(text);
        }
        return {
            name: field('name') ?? type.name,
            symbol: field('symbol') ?? type.symbol,
            color: color === null ? type.color : COLOR_PREFIX + color,
            values,
        };
    });
    const typeCount = query.get(SHARE_KEY.typeCount);

    const config = sanitizeSimulationConfig({
        id: SHARED_ID,
        algorithm: id,
        params,
        controls: controlValues,
        drawing: { params: drawingParams, texts },
        typeCount: typeCount === null ? defaults.typeCount : Number(typeCount),
        species,
    }, controls, catalog);
    if (!config) return null;
    const { algorithm: algorithmId, params: values, controls: sliders, drawing, typeCount: count, species: types } = config;
    return { algorithm: algorithmId, params: values, controls: sliders, drawing, typeCount: count, species: types };
}
