import { DEFAULT_FPS_LIMIT, DISPLAY_SETTINGS_KEY, FPS_LIMIT_OPTIONS, PARTICLE_CAP_RANGE, PARTICLE_CAP_STEP } from './config';
import { isLanguagePreference, type LanguagePreference } from './i18n';
import { snap } from './util/math';

/** Technical display settings, kept per browser (not part of the simulation configurations). */
export interface DisplaySettings {
    /** Frames per second cap; 0 = unlimited. */
    fpsLimit: number;
    showHelp: boolean;
    showStats: boolean;
    showAuthor: boolean;
    /** Interface language; 'auto' follows the browser. A change takes effect after a reload. */
    language: LanguagePreference;
    /** Upper bound of the particle count sliders; null until the GPU benchmark has run. */
    particleCap: number | null;
    /** Cap found by the last GPU benchmark (null: never run). */
    benchmarkCap: number | null;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
    fpsLimit: DEFAULT_FPS_LIMIT,
    showHelp: true,
    showStats: false,
    showAuthor: true,
    language: 'auto',
    particleCap: null,
    benchmarkCap: null,
};

/** A valid particle cap (rounded to PARTICLE_CAP_STEP, within PARTICLE_CAP_RANGE), or null. */
export const sanitizeParticleCap = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? snap(value, PARTICLE_CAP_STEP, PARTICLE_CAP_RANGE) : null;

/** Minimal duration of a frame for an FPS cap (0 when unlimited). */
export const frameMs = (fpsLimit: number): number => fpsLimit > 0 ? 1000 / fpsLimit : 0;

/** Any JSON read back becomes valid settings: unknown or ill-typed fields fall back to the defaults. */
export function sanitizeDisplaySettings(raw: unknown): DisplaySettings {
    const src = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const d = DEFAULT_DISPLAY_SETTINGS;
    const flag = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
    return {
        fpsLimit: typeof src.fpsLimit === 'number' && FPS_LIMIT_OPTIONS.includes(src.fpsLimit) ? src.fpsLimit : d.fpsLimit,
        showHelp: flag(src.showHelp, d.showHelp),
        showStats: flag(src.showStats, d.showStats),
        showAuthor: flag(src.showAuthor, d.showAuthor),
        language: isLanguagePreference(src.language) ? src.language : d.language,
        particleCap: sanitizeParticleCap(src.particleCap),
        benchmarkCap: sanitizeParticleCap(src.benchmarkCap),
    };
}

/** The current settings, saved on every change (best effort: the storage may be unavailable). */
export class DisplaySettingsStore {
    values: DisplaySettings;
    private listeners: Array<(values: DisplaySettings) => void> = [];

    constructor(private readonly storage: Storage | null) {
        let raw: unknown = null;
        try { raw = JSON.parse(storage?.getItem(DISPLAY_SETTINGS_KEY) ?? 'null'); } catch { /* corrupt: defaults */ }
        this.values = sanitizeDisplaySettings(raw);
    }

    onChange(listener: (values: DisplaySettings) => void): void {
        this.listeners.push(listener);
    }

    update(patch: Partial<DisplaySettings>): void {
        this.values = sanitizeDisplaySettings({ ...this.values, ...patch });
        try { this.storage?.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
        for (const listener of this.listeners) listener(this.values);
    }
}
