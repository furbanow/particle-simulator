import { describe, expect, it } from 'vitest';
import { PARTICLE_CAP_RANGE } from '../src/config';
import {
    DEFAULT_DISPLAY_SETTINGS, DisplaySettingsStore, frameMs, sanitizeDisplaySettings, sanitizeParticleCap,
} from '../src/displaySettings';

class MemoryStorage {
    data = new Map<string, string>();
    getItem(k: string) { return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('display settings', () => {
    it('default to 60 FPS, help and stats shown, no particle cap before the benchmark', () => {
        expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
            fpsLimit: 60, showHelp: true, showStats: true, language: 'auto',
            particleCap: null, benchmarkCap: null,
        });
    });

    it('round the particle cap to its step, within its range', () => {
        expect(sanitizeParticleCap(412345)).toBe(410000);
        expect(sanitizeParticleCap(10)).toBe(PARTICLE_CAP_RANGE[0]);
        expect(sanitizeParticleCap(1e9)).toBe(PARTICLE_CAP_RANGE[1]);
        expect(sanitizeParticleCap('400000')).toBeNull();
        expect(sanitizeParticleCap(NaN)).toBeNull();
        expect(sanitizeDisplaySettings({ particleCap: 250000, benchmarkCap: 400000 }))
            .toMatchObject({ particleCap: 250000, benchmarkCap: 400000 });
    });

    it('sanitize unknown or ill-typed values', () => {
        expect(sanitizeDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
        expect(sanitizeDisplaySettings({ fpsLimit: 77, showHelp: 'x', showStats: true }))
            .toEqual({ ...DEFAULT_DISPLAY_SETTINGS, showStats: true });
    });

    it('ignores any stored showAuthor: the author overlay cannot be hidden', () => {
        expect(sanitizeDisplaySettings({ showAuthor: false })).toEqual(DEFAULT_DISPLAY_SETTINGS);
    });

    it('keeps a valid language preference and drops an unknown one', () => {
        expect(sanitizeDisplaySettings({ language: 'de' }).language).toBe('de');
        expect(sanitizeDisplaySettings({ language: 'xx' }).language).toBe('auto');
    });

    it('computes the frame duration, none when unlimited', () => {
        expect(frameMs(60)).toBeCloseTo(1000 / 60);
        expect(frameMs(0)).toBe(0);
    });

    it('persists changes and notifies listeners', () => {
        const storage = new MemoryStorage();
        const store = new DisplaySettingsStore(storage as unknown as Storage);
        let seen = 0;
        store.onChange(() => seen++);
        store.update({ fpsLimit: 30, showStats: true });
        expect(seen).toBe(1);
        const reloaded = new DisplaySettingsStore(storage as unknown as Storage);
        expect(reloaded.values).toMatchObject({ showStats: true, fpsLimit: 30 });
    });
});

describe('settings reset', () => {
    it('clears the settings and the selected presets but keeps the saved configurations', async () => {
        const { resetSettings } = await import('../src/displaySettings');
        const { ELEMENT_CONFIGS_KEY, SIMULATION_CONFIGS_KEY, DISPLAY_SETTINGS_KEY } = await import('../src/config');
        const store = new Map<string, string>([
            [DISPLAY_SETTINGS_KEY, '{}'],
            [ELEMENT_CONFIGS_KEY, JSON.stringify({ version: 2, currentIds: { a: 'x' }, configs: [{ id: 'x' }] })],
            [SIMULATION_CONFIGS_KEY, JSON.stringify({ version: 1, currentId: 'y', configs: [{ id: 'y' }] })],
        ]);
        resetSettings({
            removeItem: k => void store.delete(k),
            getItem: k => store.get(k) ?? null,
            setItem: (k, v) => void store.set(k, v),
        });
        expect([...store.keys()].sort()).toEqual([ELEMENT_CONFIGS_KEY, SIMULATION_CONFIGS_KEY].sort());
        expect(JSON.parse(store.get(ELEMENT_CONFIGS_KEY)!)).toEqual({ version: 2, configs: [{ id: 'x' }] });
        expect(JSON.parse(store.get(SIMULATION_CONFIGS_KEY)!)).toEqual({ version: 1, configs: [{ id: 'y' }] });
    });
});
