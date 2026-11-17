import { DEFAULT_LANGUAGE, DISPLAY_SETTINGS_KEY, SUPPORTED_LANGUAGES, type Language } from '../config';
import { de } from './locales/de';
import { en, type MessageKey } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { pl } from './locales/pl';

export type { MessageKey };
export type { Language };

/** What the user picked in the settings: a language, or 'auto' to follow the browser. */
export type LanguagePreference = Language | 'auto';

export type MessageParams = Record<string, string | number>;

const CATALOGS: Record<Language, Record<MessageKey, string>> = { en, fr, pl, de, es };

export const isLanguage = (value: unknown): value is Language =>
    typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

export const isLanguagePreference = (value: unknown): value is LanguagePreference =>
    value === 'auto' || isLanguage(value);

/** First supported primary language among the browser's ('fr-CH' gives 'fr'), else the default one. */
export function resolveLanguage(preference: LanguagePreference, browserLanguages: readonly string[]): Language {
    if (preference !== 'auto') return preference;
    for (const tag of browserLanguages) {
        const primary = tag.toLowerCase().split('-')[0];
        if (isLanguage(primary)) return primary;
    }
    return DEFAULT_LANGUAGE;
}

/** The saved preference, read straight from the display settings (the i18n must work before the UI is built). */
export function readStoredPreference(storage: Storage | null): LanguagePreference {
    try {
        const raw: unknown = JSON.parse(storage?.getItem(DISPLAY_SETTINGS_KEY) ?? 'null');
        const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).language : undefined;
        return isLanguagePreference(value) ? value : 'auto';
    } catch {
        return 'auto';
    }
}

function detectLanguage(): Language {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* storage blocked or no DOM: browser language */ }
    const browser = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
    return resolveLanguage(readStoredPreference(storage), browser);
}

let current: Language | null = null;

/** The active language: fixed on first use (declarations read it at import time), changed only by a reload. */
export function getLanguage(): Language {
    current ??= detectLanguage();
    return current;
}

/** Forces the language (tests). */
export function setLanguage(language: Language): void {
    current = language;
}

/** Replaces each `{name}` of the message by its parameter. */
export function interpolate(message: string, params?: MessageParams): string {
    if (!params) return message;
    return message.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole);
}

/** The message of `key` in the active language; falls back to English. */
export function t(key: MessageKey, params?: MessageParams): string {
    const message = CATALOGS[getLanguage()][key] ?? CATALOGS[DEFAULT_LANGUAGE][key] ?? key;
    return interpolate(message, params);
}

/** Number with the active language's digit grouping and decimal separator. */
export function formatNumber(value: number, maxFractionDigits = 0, minFractionDigits = maxFractionDigits): string {
    return value.toLocaleString(getLanguage(), {
        minimumFractionDigits: minFractionDigits,
        maximumFractionDigits: maxFractionDigits,
    });
}

/** A number written with a '.' decimal point (e.g. from toExponential) turned to the language's separator. */
export function localizeDecimal(text: string): string {
    return text.replace('.', (1.1).toLocaleString(getLanguage()).charAt(1));
}

export { CATALOGS };

/** Fills the static page: `data-i18n*` attributes give the message key of the text or attribute. */
export function applyStaticTranslations(root: ParentNode): void {
    const attributes: ReadonlyArray<readonly [string, string]> = [
        ['data-i18n-title', 'title'],
        ['data-i18n-aria', 'aria-label'],
        ['data-i18n-tooltip', 'data-tooltip'],
        ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-content', 'content'],
    ];
    for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
        el.textContent = t(el.dataset.i18n as MessageKey);
    }
    for (const [source, target] of attributes) {
        for (const el of root.querySelectorAll<HTMLElement>(`[${source}]`)) {
            el.setAttribute(target, t(el.getAttribute(source) as MessageKey));
        }
    }
}
