import { describe, expect, it } from 'vitest';
import { SHARE_KEY } from '../src/config';
import { ALL_DRAWING_PARAMS, DRAWING_KINDS } from '../src/drawing';
import { numberProperties, type ParamDef, type ParamValue } from '../src/simulation/algorithm';
import { algorithmList } from '../src/simulation/algorithms';
import { panelParamValue } from '../src/simulation/params';
import { decodeShareQuery, encodeShareQuery, shareKeys } from '../src/shareLink';
import { cloneSimulationSetup, defaultSimulationSetup, type ControlSpec } from '../src/simulationConfigs';

const CONTROLS: readonly ControlSpec[] = [
    { key: 'speed', default: 1, range: [0, 3] },
    { key: 'bloomStrength', default: 0.35, range: [0, 3] },
];

/** A valid value of `def` other than its default, as the panel holds it. */
function otherValue(def: ParamDef): ParamValue {
    switch (def.kind) {
        case 'boolean': return !def.default;
        case 'choice': return def.options.find(o => o.value !== def.default)?.value ?? def.default;
        case 'number': {
            const target = def.default === def.max ? def.min : def.max;
            return panelParamValue(def, target);
        }
    }
}

describe('share links', () => {
    for (const algorithm of algorithmList()) {
        describe(algorithm.label, () => {
            it('write only the algorithm for its defaults', () => {
                const setup = defaultSimulationSetup(algorithm, CONTROLS);
                expect(encodeShareQuery(setup, CONTROLS)).toBe(`${SHARE_KEY.algorithm}=${algorithm.id}`);
                expect(decodeShareQuery(encodeShareQuery(setup, CONTROLS), CONTROLS)).toEqual(setup);
            });

            it('carry every part of a modified setup there and back', () => {
                const setup = cloneSimulationSetup(defaultSimulationSetup(algorithm, CONTROLS));
                for (const p of algorithm.params) setup.params[p.key] = otherValue(p);
                setup.controls.speed = 2.5;
                for (const p of ALL_DRAWING_PARAMS) setup.drawing.params[p.key] = otherValue(p);
                setup.drawing.texts.attractor = 'Hello & ünïcode = ?';
                const schema = algorithm.particleTypes;
                setup.typeCount = setup.typeCount > 1 ? 1 : schema.defaults.length;
                const first = setup.species[0];
                first.name = 'Custom name';
                first.symbol = 'Cu';
                first.color = '#123abc';
                for (const p of numberProperties(schema)) first.values[p.key] = p.range[1];
                const query = encodeShareQuery(setup, CONTROLS);
                expect(decodeShareQuery(`?${query}`, CONTROLS)).toEqual(setup);
            });

            it('use no key twice', () => {
                const keys = shareKeys(algorithm.id, CONTROLS);
                expect(new Set(keys).size).toBe(keys.length);
                expect(keys.filter(k => k.startsWith(SHARE_KEY.speciesPrefix))).toEqual([]);
            });
        });
    }

    it('are not read without a known algorithm', () => {
        expect(decodeShareQuery('', CONTROLS)).toBeNull();
        expect(decodeShareQuery('?speed=2', CONTROLS)).toBeNull();
        expect(decodeShareQuery('?algo=unknown', CONTROLS)).toBeNull();
        expect(decodeShareQuery('?algo=toString', CONTROLS)).toBeNull();
    });

    it('fall back to defaults or clamp invalid values, and ignore unknown keys', () => {
        const algorithm = algorithmList()[0];
        const defaults = defaultSimulationSetup(algorithm, CONTROLS);
        const number = algorithm.params.find(p => p.kind === 'number')!;
        const flag = algorithm.params.find(p => p.kind === 'boolean');
        const property = numberProperties(algorithm.particleTypes)[0];
        const query = new URLSearchParams({
            algo: algorithm.id, [number.key]: 'abc', speed: '99', unknown: '1', types: '-4',
            [`species.0.color`]: 'nope', [`species.0.${property.key}`]: '1e30',
            ...(flag ? { [flag.key]: 'maybe' } : {}),
        });
        const setup = decodeShareQuery(query.toString(), CONTROLS)!;
        expect(setup.params[number.key]).toBe(defaults.params[number.key]);
        if (flag) expect(setup.params[flag.key]).toBe(defaults.params[flag.key]);
        expect(setup.controls.speed).toBe(3);
        expect(setup.typeCount).toBe(1);
        expect(setup.species[0].color).toBe(defaults.species[0].color);
        expect(setup.species[0].values[property.key]).toBe(property.range[1]);
        expect(setup.params).not.toHaveProperty('unknown');
    });

    it('write drawing texts under each kind', () => {
        const algorithm = algorithmList()[0];
        const setup = cloneSimulationSetup(defaultSimulationSetup(algorithm, CONTROLS));
        setup.drawing.texts[DRAWING_KINDS[1]] = 'Hi';
        expect(new URLSearchParams(encodeShareQuery(setup, CONTROLS)).get(`${DRAWING_KINDS[1]}${SHARE_KEY.textSuffix}`)).toBe('Hi');
    });
});
