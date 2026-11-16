import { describe, expect, it } from 'vitest';
import { panelParamValue } from '../src/simulation/params';
import { VISUAL_EFFECT_KEYS, VISUAL_EFFECTS } from '../src/visualEffects';

describe('visual effects', () => {
    it('declare each key once, in the effects tab, documented', () => {
        expect(VISUAL_EFFECTS.map(e => e.key)).toEqual(VISUAL_EFFECT_KEYS);
        for (const effect of VISUAL_EFFECTS) {
            expect(effect.tab).toBe('effects');
            expect(effect.doc.length).toBeGreaterThan(effect.label.length);
        }
    });

    // Saved simulation configs hold these values by key: they must keep their names and meanings.
    it('keep the keys, bounds and defaults of the former panel sliders', () => {
        expect(Object.fromEntries(VISUAL_EFFECTS.map(e => [e.key, [e.min, e.max, e.step, e.default]]))).toEqual({
            exposure: [0.2, 3, 0.05, 0.6],
            bloomStrength: [0, 3, 0.05, 0.35],
            bloomRadius: [0, 1, 0.05, 0.6],
            bloomThreshold: [0, 1.5, 0.01, 0.3],
            nebula: [0, 3, 0.05, 0],
            lens: [0, 3, 0.05, 0.05],
            heat: [0, 2, 0.05, 0.1],
            stretch: [0, 3, 0.1, 1.5],
        });
    });

    // Otherwise a config would read as modified as soon as the panel has shown it.
    it('have defaults that the panel gives back unchanged', () => {
        for (const effect of VISUAL_EFFECTS) expect(panelParamValue(effect, effect.default)).toBe(effect.default);
    });
});
