import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_SETTINGS, DisplaySettingsStore, frameMs, sanitizeDisplaySettings } from '../src/displaySettings';

class MemoryStorage {
    data = new Map<string, string>();
    getItem(k: string) { return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('display settings', () => {
    it('default to 60 FPS, help and author shown, stats hidden', () => {
        expect(DEFAULT_DISPLAY_SETTINGS).toEqual({ fpsLimit: 60, showHelp: true, showStats: false, showAuthor: true });
    });

    it('sanitize unknown or ill-typed values', () => {
        expect(sanitizeDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
        expect(sanitizeDisplaySettings({ fpsLimit: 77, showHelp: 'x', showStats: true }))
            .toEqual({ ...DEFAULT_DISPLAY_SETTINGS, showStats: true });
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
