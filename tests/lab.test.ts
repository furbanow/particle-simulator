import { describe, expect, it } from 'vitest';
import { probeCore } from '../src/lab/core';
import { jsonSafe } from '../src/lab/json';
import {
    decimate, maxAbsChannel, maxAbsDiff, maxChannel, mean, quantile, relativeDiff, significant, sumChannel,
} from '../src/lab/numbers';
import { mulberry32, withSeededRandom } from '../src/lab/random';
import { isSoftwareRenderer, parseOptions, selectScenarios } from '../src/lab/select';
import type { LabOptions, Scenario } from '../src/lab/types';

describe('lab: seeded random numbers', () => {
    it('the same seed gives the same sequence, another seed another one', () => {
        const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
        const first = [a(), a(), a()];
        expect([b(), b(), b()]).toEqual(first);
        expect([c(), c(), c()]).not.toEqual(first);
        expect(first.every(v => v >= 0 && v < 1)).toBe(true);
    });

    it('replaces Math.random for the body only, even when it throws', async () => {
        const original = Math.random;
        const drawn = await withSeededRandom(1, () => [Math.random(), Math.random()]);
        expect(Math.random).toBe(original);
        expect(drawn).toEqual([mulberry32(1)(), (() => { const g = mulberry32(1); g(); return g(); })()]);
        await expect(withSeededRandom(1, () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(Math.random).toBe(original);
        await expect(withSeededRandom(1, async () => { await Promise.resolve(); throw new Error('later'); })).rejects.toThrow('later');
        expect(Math.random).toBe(original);
    });

    it('nests and restores the outer generator', async () => {
        await withSeededRandom(1, async () => {
            const outer = Math.random;
            await withSeededRandom(2, () => undefined);
            expect(Math.random).toBe(outer);
        });
    });
});

describe('lab: grid and series helpers', () => {
    const rgba = [1, -5, 0, 0, 3, 2, 0, 0, 2, -9, 0, 0];

    it('reduces one channel of an RGBA array', () => {
        expect(sumChannel(rgba, 0)).toBe(6);
        expect(sumChannel(rgba, 1)).toBe(-12);
        expect(maxChannel(rgba, 0)).toBe(3);
        expect(maxAbsChannel(rgba, 1)).toBe(9);
        expect(maxChannel([], 0)).toBe(-Infinity);
        expect(maxAbsChannel([], 0)).toBe(0);
    });

    it('compares arrays', () => {
        expect(maxAbsDiff([1, 2, 3], [1, 2.5, 3])).toBe(0.5);
        expect(maxAbsDiff([1], [1, 2])).toBe(Infinity);
        expect(maxAbsDiff([NaN], [1])).toBeNaN();
        expect(relativeDiff(1.1, 1)).toBeCloseTo(0.1, 12);
        expect(relativeDiff(0.5, 0)).toBe(0.5);
    });

    it('computes means and quantiles', () => {
        expect(mean([1, 2, 3, 4])).toBe(2.5);
        expect(mean([])).toBeNaN();
        expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
        expect(quantile([4, 1, 3, 2], 0)).toBe(1);
        expect(quantile([4, 1, 3, 2], 1)).toBe(4);
        expect(quantile([], 0.5)).toBeNaN();
    });

    it('decimates evenly and keeps the ends', () => {
        const series = Array.from({ length: 101 }, (_, i) => i);
        const kept = decimate(series, 11);
        expect(kept).toHaveLength(11);
        expect(kept[0]).toBe(0);
        expect(kept[10]).toBe(100);
        expect(kept[5]).toBe(50);
        expect(decimate([1, 2, 3], 10)).toEqual([1, 2, 3]);
    });

    it('rounds to significant digits', () => {
        expect(significant(123456.789, 3)).toBe(123000);
        expect(significant(0.00123456, 3)).toBe(0.00123);
        expect(significant(0, 3)).toBe(0);
        expect(significant(Infinity, 3)).toBe(Infinity);
    });
});

describe('lab: JSON results', () => {
    it('turns non-finite numbers into strings, which JSON would lose', () => {
        const safe = jsonSafe({ a: NaN, b: [Infinity, -Infinity, 1], c: { d: 'x', e: null, f: true } });
        expect(safe).toEqual({ a: 'NaN', b: ['Infinity', '-Infinity', 1], c: { d: 'x', e: null, f: true } });
        expect(JSON.parse(JSON.stringify(safe))).toEqual(safe);
    });
});

describe('lab: scenario selection', () => {
    const scenario = (id: string, ...tags: string[]): Scenario => ({ id, title: id, tags, run: async () => ({ status: 'pass', metrics: {}, details: '' }) });
    const all = [
        scenario('lab.selftest', 'fast'),
        scenario('baseline.protostar.default-cloud', 'slow'),
        scenario('baseline.protostar.ignition-ratio', 'fast'),
        scenario('perf.protostar.400k', 'slow', 'perf'),
        scenario('perf.stickyDust.400k', 'slow', 'perf'),
    ];
    const ids = (filter: string | null) => selectScenarios(all, filter).map(s => s.id);

    it('selects everything without a filter', () => {
        expect(ids(null)).toEqual(all.map(s => s.id));
        expect(ids('')).toEqual(all.map(s => s.id));
        expect(ids(' , ')).toEqual(all.map(s => s.id));
    });

    it('selects by id, by group prefix and by tag, in registry order', () => {
        expect(ids('lab.selftest')).toEqual(['lab.selftest']);
        expect(ids('baseline')).toEqual(['baseline.protostar.default-cloud', 'baseline.protostar.ignition-ratio']);
        expect(ids('baseline.protostar')).toEqual(['baseline.protostar.default-cloud', 'baseline.protostar.ignition-ratio']);
        expect(ids('perf.stickyDust')).toEqual(['perf.stickyDust.400k']);
        expect(ids('fast')).toEqual(['lab.selftest', 'baseline.protostar.ignition-ratio']);
        expect(ids('perf,lab')).toEqual(['lab.selftest', 'perf.protostar.400k', 'perf.stickyDust.400k']);
    });

    it('does not select on a partial word', () => {
        expect(ids('base')).toEqual([]);
        expect(ids('nothing')).toEqual([]);
    });
});

describe('lab: page options and renderer', () => {
    const defaults: LabOptions = { baselineParticles: 400000, baselineFrames: 1200, perfFrames: 120 };

    it('reads positive integers from the query and ignores the rest', () => {
        expect(parseOptions('', defaults)).toEqual(defaults);
        expect(parseOptions('?baselineFrames=300&perfFrames=9', defaults)).toEqual({ ...defaults, baselineFrames: 300, perfFrames: 9 });
        expect(parseOptions('?baselineFrames=abc&baselineParticles=-4&perfFrames=1.5', defaults)).toEqual(defaults);
        expect(parseOptions('?baselineFrames=0', defaults)).toEqual(defaults);
    });

    it('recognizes software rasterizers', () => {
        expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
        expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
        expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
        expect(isSoftwareRenderer('ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)')).toBe(false);
        expect(isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe(false);
    });
});

describe('lab: core probe', () => {
    const res = 8;
    const cell = 10;
    const grid = (fill: (x: number, y: number) => [number, number, number, number]): Float32Array => {
        const out = new Float32Array(res * res * 4);
        for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) out.set(fill(x, y), (y * res + x) * 4);
        return out;
    };

    it('finds the densest cell and the frequency of the harmonic well around it', () => {
        const omega = 0.7;
        const gas = grid((x, y) => [x === 4 && y === 3 ? 50 : 1, x === 4 && y === 3 ? 9 : 0, 0, 0]);
        // a = -omega^2 (r - r0), in px/s^2, around the cell (4, 3).
        const gravity = grid((x, y) => [-omega * omega * (x - 4) * cell, -omega * omega * (y - 3) * cell, 0, 0]);
        const core = probeCore(gas, gravity, res, cell);
        expect(core.cell).toEqual({ x: 4, y: 3 });
        expect(core.density).toBe(50);
        expect(core.temperature).toBe(9);
        expect(core.omega).toBeCloseTo(omega, 6);
    });

    it('has no oscillation where the field diverges, and copes with the border', () => {
        const gas = grid((x, y) => [x === 0 && y === 0 ? 5 : 1, 0, 0, 0]);
        const repulsive = grid((x, y) => [(x - 3) * cell, (y - 3) * cell, 0, 0]);
        expect(probeCore(gas, repulsive, res, cell).omega).toBe(0);
        const attractive = grid((x, y) => [-(x - 3) * cell, -(y - 3) * cell, 0, 0]);
        const core = probeCore(gas, attractive, res, cell);
        expect(core.cell).toEqual({ x: 0, y: 0 });
        expect(core.omega).toBeCloseTo(1, 6);
    });
});
