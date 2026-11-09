import { describe, expect, it } from 'vitest';
import { DARK_MATTER_STRENGTH_SLIDER, DARK_MATTER_TEXT_MAX } from '../src/config';
import {
    DARK_MATTER_PARAM, DARK_MATTER_PARAMS, darkMatterFont, darkMatterMode, DEFAULT_DARK_MATTER_TEXT, defaultDarkMatter,
    sanitizeDarkMatterSettings,
} from '../src/darkMatter';
import { panelParamValue } from '../src/simulation/params';

describe('dark matter settings', () => {
    it('declare each key once, in the dark matter tab, documented', () => {
        expect(DARK_MATTER_PARAMS.map(p => p.key)).toEqual(Object.values(DARK_MATTER_PARAM));
        for (const param of DARK_MATTER_PARAMS) {
            expect(param.tab).toBe('darkMatter');
            expect(param.doc.length).toBeGreaterThan(param.label.length);
        }
    });

    // Otherwise a config would read as modified as soon as the panel has shown it.
    it('have defaults that the panel gives back unchanged', () => {
        for (const param of DARK_MATTER_PARAMS) expect(panelParamValue(param, param.default)).toBe(param.default);
    });

    it('default every missing or invalid setting', () => {
        const defaults = defaultDarkMatter();
        expect(defaults.text).toBe(DEFAULT_DARK_MATTER_TEXT);
        expect(darkMatterMode(defaults)).toBe('draw');
        for (const junk of [null, 42, 'x', { params: 3 }, { params: { strength: 'fort', mode: 'laser' }, text: 5 }]) {
            expect(sanitizeDarkMatterSettings(junk)).toEqual(defaults);
        }
    });

    it('keep valid settings, clamp numbers and cut the text', () => {
        const settings = sanitizeDarkMatterSettings({
            params: { mode: 'text', strength: 1000, bold: false, fontFamily: 'serif' },
            text: 'x'.repeat(DARK_MATTER_TEXT_MAX + 10),
        });
        expect(darkMatterMode(settings)).toBe('text');
        expect(settings.params.strength).toBe(DARK_MATTER_STRENGTH_SLIDER.max);
        expect(settings.text).toHaveLength(DARK_MATTER_TEXT_MAX);
        expect(darkMatterFont(settings)).toMatch(/^400 \d+px Georgia/);
    });

    it('build the CSS font of the text', () => {
        const settings = sanitizeDarkMatterSettings({ params: { italic: true, bold: true, fontSize: 100, fontFamily: 'inter' } });
        expect(darkMatterFont(settings)).toBe('italic 700 100px \'Inter\', sans-serif');
    });
});
