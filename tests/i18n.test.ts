import { afterEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../src/config';
import {
    CATALOGS, formatNumber, getLanguage, interpolate, readStoredPreference, resolveLanguage, setLanguage, t,
} from '../src/i18n';
import { en } from '../src/i18n/locales/en';

const storageWith = (value: string | null): Storage => ({ getItem: () => value } as unknown as Storage);
const placeholders = (message: string): string[] => [...message.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('language resolution', () => {
    it('follows an explicit preference over the browser', () => {
        expect(resolveLanguage('de', ['fr-FR'])).toBe('de');
    });

    it('takes the first supported browser language, by its primary subtag', () => {
        expect(resolveLanguage('auto', ['ja-JP', 'fr-CH', 'de'])).toBe('fr');
        expect(resolveLanguage('auto', ['PL'])).toBe('pl');
    });

    it('falls back to English when no browser language is supported', () => {
        expect(resolveLanguage('auto', ['ja', 'zh-CN'])).toBe('en');
        expect(resolveLanguage('auto', [])).toBe('en');
    });

    it('reads the preference saved with the display settings, auto when missing or invalid', () => {
        expect(readStoredPreference(storageWith('{"language":"pl"}'))).toBe('pl');
        expect(readStoredPreference(storageWith('{"language":"xx"}'))).toBe('auto');
        expect(readStoredPreference(storageWith('not json'))).toBe('auto');
        expect(readStoredPreference(storageWith(null))).toBe('auto');
        expect(readStoredPreference(null)).toBe('auto');
    });
});

describe('messages', () => {
    afterEach(() => setLanguage('en'));

    it('are looked up in the active language', () => {
        setLanguage('fr');
        expect(getLanguage()).toBe('fr');
        expect(t('ui.restart')).toBe('Redémarrer');
        setLanguage('de');
        expect(t('ui.restart')).toBe('Neustart');
    });

    it('fall back to English for a key missing from the language, then to the key itself', () => {
        const messages = CATALOGS.pl as Record<string, string>;
        const saved = messages['ui.restart'];
        delete messages['ui.restart'];
        setLanguage('pl');
        try {
            expect(t('ui.restart')).toBe(en['ui.restart']);
            expect(t('no.such.key' as never)).toBe('no.such.key');
        } finally {
            messages['ui.restart'] = saved;
        }
    });

    it('replace the {placeholders} and keep unknown ones', () => {
        expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
        expect(t('ui.chart.share', { element: 'H', share: '10%' })).toBe('H: 10%');
    });

    it('format numbers with the active language', () => {
        setLanguage('en');
        expect(formatNumber(1234.5, 1)).toBe('1,234.5');
        setLanguage('de');
        expect(formatNumber(1234.5, 1)).toBe('1.234,5');
    });
});

describe('catalogs', () => {
    for (const language of SUPPORTED_LANGUAGES) {
        it(`${language} has every key, no empty message and the same placeholders as English`, () => {
            const messages = CATALOGS[language] as Record<string, string>;
            expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
            for (const [key, message] of Object.entries(messages)) {
                expect(message.trim(), key).not.toBe('');
                expect(placeholders(message), key).toEqual(placeholders((en as Record<string, string>)[key]));
            }
        });
    }
});
