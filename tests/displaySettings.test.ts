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
    it('default to 60 FPS, help and author shown, stats hidden, no particle cap before the benchmark', () => {
        expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
            fpsLimit: 60, showHelp: true, showStats: false, showAuthor: true, language: 'auto',
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
        store.update({ showAuthor: false, fpsLimit: 30 });
        expect(seen).toBe(1);
        const reloaded = new DisplaySettingsStore(storage as unknown as Storage);
        expect(reloaded.values).toMatchObject({ showAuthor: false, fpsLimit: 30 });
    });
});
