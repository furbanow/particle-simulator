import { describe, expect, it } from 'vitest';
import { probeCore } from '../src/lab/core';
import { compareDeposit, ratioError, referenceDeposit, type DepositTolerance } from '../src/lab/depositReference';
import { jsonSafe } from '../src/lab/json';
import {
    alternatingOrders, decimate, extractChannel, halton, maxAbsChannel, maxAbsDiff, maxChannel, mean, quantile, relativeDiff, significant, sumChannel,
} from '../src/lab/numbers';
import { mulberry32, withSeededRandom } from '../src/lab/random';
import { isSoftwareRenderer, parseOptions, selectScenarios } from '../src/lab/select';
import type { LabOptions, Scenario } from '../src/lab/types';
import type { DepositInputs } from '../src/simulation/protostar/grids';

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

describe('lab: channel extraction', () => {
    it('takes one channel of an RGBA array', () => {
        expect(Array.from(extractChannel([1, 2, 3, 4, 5, 6, 7, 8], 2))).toEqual([3, 7]);
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

    it('draws well spread points from the Halton sequence', () => {
        expect([1, 2, 3, 4].map(i => halton(i, 2))).toEqual([0.5, 0.25, 0.75, 0.125]);
        expect(halton(1, 3)).toBeCloseTo(1 / 3, 12);
        expect(halton(4, 3)).toBeCloseTo(1 / 3 + 1 / 9, 12);
        // In each quarter of the unit square: close to a quarter of the points.
        const counts = [0, 0, 0, 0];
        for (let i = 1; i <= 256; i++) counts[(halton(i, 2) < 0.5 ? 0 : 1) + (halton(i, 3) < 0.5 ? 0 : 2)]++;
        for (const count of counts) expect(Math.abs(count - 64)).toBeLessThan(8);
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
    const defaults: LabOptions = { baselineParticles: 400000, baselineFrames: 1200, perfFrames: 120, noiseReadings: 900, noiseBudgetSeconds: 150, cloudSeeds: 3, cloudVariants: '[]', perfVariant: '{}', params: '{}' };

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

describe('lab: CPU reference of the composition deposit', () => {
    const RES = 8;
    const inputs: DepositInputs = {
        gridResolution: RES, gridCell: 10, depositMassScale: 2,
        depositMass: [1, 3, 0.5, 0, 0, 0, 0, 0, 0, 0], inverseMolecularWeight: [2, 0.75, 0.5, 0, 0, 0, 0, 0, 0, 0],
        fuel: [[1, 0], [0, 1], [0, 0], ...new Array<[number, number]>(7).fill([0, 0])],
    };
    const cell = (x: number, y: number) => y * RES + x;
    const at = (ref: ReturnType<typeof referenceDeposit>, x: number, y: number, channel: number) =>
        ref.composition[cell(x, y) * 4 + channel];

    it('puts a particle at a cell center in that cell alone: (m / mu, m of hydrogen, m^2, m of helium)', () => {
        const ref = referenceDeposit([35, 55, 1, 1], 1, inputs, 1e-5);   // cell (3, 5), He: m = 3 * 2 = 6
        expect([0, 1, 2, 3].map(c => at(ref, 3, 5, c))).toEqual([6 * 0.75, 0, 36, 6]);
        expect(ref.composition.reduce((s, v) => s + v, 0)).toBe(6 * 0.75 + 36 + 6);
        expect(ref.deposited).toBe(1);
        expect(ref.mass[cell(3, 5)]).toBe(6);
        expect(ref.occupancy[cell(3, 5)]).toBe(1);
        const hydrogen = referenceDeposit([35, 55, 0, 1], 1, inputs, 1e-5);   // H: m = 1 * 2 = 2
        expect([0, 1, 2, 3].map(c => at(hydrogen, 3, 5, c))).toEqual([2 * 2, 2, 4, 0]);
    });

    it('puts the types that are the fuel of no reaction (carbon, custom elements) in neither the hydrogen nor the helium channel', () => {
        const ref = referenceDeposit([35, 55, 2, 1], 1, inputs, 1e-5);   // C: m = 0.5 * 2 = 1
        expect([0, 1, 2, 3].map(c => at(ref, 3, 5, c))).toEqual([0.5, 0, 1, 0]);
    });

    it('splits a particle at a cell corner in four quarters', () => {
        const ref = referenceDeposit([40, 60, 0, 1], 1, inputs, 1e-5);   // corner of cells (3..4, 5..6), H: m = 2
        for (const [x, y] of [[3, 5], [4, 5], [3, 6], [4, 6]]) {
            expect(at(ref, x, y, 0)).toBeCloseTo(0.25 * 2 * 2, 12);
            expect(at(ref, x, y, 1)).toBeCloseTo(0.25 * 2, 12);
            expect(at(ref, x, y, 2)).toBeCloseTo(0.25 * 4, 12);
            expect(ref.occupancy[cell(x, y)]).toBeCloseTo(0.25, 12);
        }
    });

    it('adds the particles that overlap and counts them per cell', () => {
        const texels = [35, 55, 0, 1, 35, 55, 1, 1, 35, 55, 2, 1];   // H, He, C on the same spot
        const ref = referenceDeposit(texels, 3, inputs, 1e-5);
        expect(at(ref, 3, 5, 0)).toBeCloseTo(2 * 2 + 6 * 0.75 + 1 * 0.5, 12);
        expect(at(ref, 3, 5, 1)).toBe(2);
        expect(at(ref, 3, 5, 3)).toBe(6);
        expect(at(ref, 3, 5, 2)).toBeCloseTo(4 + 36 + 1, 12);
        expect(ref.occupancy[cell(3, 5)]).toBe(3);
        expect(ref.contributions[cell(3, 5)]).toBe(3);
        expect(ref.payloadMax).toEqual([4.5, 2, 36, 6]);
    });

    it('skips the particles beyond count and those whose point is clipped', () => {
        const texels = [35, 55, 0, 1, -30, 55, 0, 1, 35, 55, 0, 1];
        const ref = referenceDeposit(texels, 2, inputs, 1e-5);
        expect(ref.deposited).toBe(1);
        expect(ref.occupancy[cell(3, 5)]).toBe(1);
    });

    it('keeps cloud-in-cell weights summing to one inside the grid, a cell on the edge included', () => {
        const random = mulberry32(5);
        const texels = Array.from({ length: 200 }, (_, i) => [random() * 80, random() * 80, i % 3, 1]).flat();
        const ref = referenceDeposit(texels, 200, inputs, 1e-5);
        const counted = ref.occupancy.reduce((s, v) => s + v, 0);
        // A particle in the outer half cell loses the part of its cloud that falls outside the grid.
        expect(counted).toBeLessThanOrEqual(200 + 1e-9);
        expect(counted).toBeGreaterThan(150);
        expect(ref.deposited).toBe(200);
    });

    it('widens the counted footprint by the margin', () => {
        const justOutside = [45.01, 55, 0, 1];   // 1 + 1e-3 cells from the center of cell (3, 5)
        const tight = referenceDeposit(justOutside, 1, inputs, 1e-4);
        const wide = referenceDeposit(justOutside, 1, inputs, 1e-2);
        expect(tight.contributions[cell(3, 5)]).toBe(0);
        expect(wide.contributions[cell(3, 5)]).toBe(1);
        expect(wide.composition[cell(3, 5) * 4]).toBe(0);
    });

    describe('ratioError', () => {
        const texels = [35, 55, 0, 1, 45, 55, 1, 1, 45, 55, 1, 1];   // one H in cell (3, 5), two He in cell (4, 5)
        const ref = referenceDeposit(texels, 3, inputs, 1e-5);
        const numerator = extractChannel(ref.composition, 0);

        it('is 0 for the reference itself, per cell and over neighborhoods', () => {
            expect(ratioError(numerator, ref.mass, numerator, ref.mass, RES, 0, 1)).toBe(0);
            expect(ratioError(numerator, ref.mass, numerator, ref.mass, RES, 1, 1)).toBe(0);
        });

        it('is the mean 1 / mu of a cell: 2 for hydrogen, 0.75 for helium', () => {
            expect(numerator[cell(3, 5)] / ref.mass[cell(3, 5)]).toBeCloseTo(2, 12);
            expect(numerator[cell(4, 5)] / ref.mass[cell(4, 5)]).toBeCloseTo(0.75, 12);
        });

        it('finds the error of a biased numerator and skips the cells with too little mass', () => {
            const biased = Array.from(numerator);
            biased[cell(4, 5)] *= 1.1;
            expect(ratioError(biased, ref.mass, numerator, ref.mass, RES, 0, 1)).toBeCloseTo(0.1, 12);
            expect(ratioError(biased, ref.mass, numerator, ref.mass, RES, 0, 100)).toBe(0);
            // Over 3x3 sums the worst neighborhood is one that sees the biased cell alone.
            expect(ratioError(biased, ref.mass, numerator, ref.mass, RES, 1, 1)).toBeCloseTo(0.1, 9);
        });
    });

    describe('compareDeposit', () => {
        const tolerance: DepositTolerance = { roundoff: 1e-3, roundings: 2, weightError: 1e-4 };
        const texels = [35, 55, 0, 1, 35, 55, 1, 1];
        const ref = referenceDeposit(texels, 2, inputs, 1e-5);
        const exact = Array.from(ref.composition);

        it('finds no excess in the reference itself', () => {
            const result = compareDeposit(exact, ref, tolerance);
            expect(result.map(r => r.maxExcess)).toEqual([0, 0, 0, 0]);
            expect(result[1].sumGpu).toBe(2);
        });

        it('accepts a rounding-sized error and flags a larger one', () => {
            const near = [...exact];
            near[cell(3, 5) * 4] *= 1 + 1e-3;      // within 2 contributions x 2 roundings x 1e-3
            expect(compareDeposit(near, ref, tolerance)[0].maxExcess).toBeLessThan(1);
            const far = [...exact];
            far[cell(3, 5) * 4] *= 1.05;
            const flagged = compareDeposit(far, ref, tolerance)[0];
            expect(flagged.maxExcess).toBeGreaterThan(1);
            expect(flagged.cellsOverTolerance).toBe(1);
            expect(flagged.maxRelativeError).toBeCloseTo(0.05, 12);
        });

        it('rejects anything in a cell no particle reaches, and a NaN', () => {
            const stray = [...exact];
            stray[cell(0, 0) * 4 + 1] = 1e-9;
            expect(compareDeposit(stray, ref, tolerance)[1].maxExcess).toBe(Infinity);
            const nan = [...exact];
            nan[cell(3, 5) * 4 + 2] = NaN;
            expect(Number.isNaN(compareDeposit(nan, ref, tolerance)[2].maxExcess)).toBe(true);
        });
    });
});

describe('lab: alternating comparison orders', () => {
    it('swaps two items every round', () => {
        expect(alternatingOrders(['on', 'off'], 4)).toEqual([['on', 'off'], ['off', 'on'], ['on', 'off'], ['off', 'on']]);
    });

    it('goes through the six orders of three items before repeating, each item first twice', () => {
        const orders = alternatingOrders(['a', 'b', 'c'], 6);
        expect(new Set(orders.map(o => o.join(''))).size).toBe(6);
        for (const item of ['a', 'b', 'c']) expect(orders.filter(o => o[0] === item)).toHaveLength(2);
        expect(alternatingOrders(['a', 'b', 'c'], 12).slice(6)).toEqual(orders);
    });

    it('handles a single item', () => {
        expect(alternatingOrders(['x'], 2)).toEqual([['x'], ['x']]);
    });
});
