import { describe, expect, it } from 'vitest';
import {
    PROTOSTAR_GRID_RES, PROTOSTAR_NESTED_INNER, PROTOSTAR_NESTED_OFF_DENSITY, PROTOSTAR_NESTED_ON_DENSITY, PROTOSTAR_NESTED_ON_READINGS,
    PROTOSTAR_NESTED_RATIO, PROTOSTAR_NESTED_STILL_CELLS,
} from '../src/config';
import {
    NestedBoxController, bilinearAt, boxCells, boxOrigin, gatherWeight, insideInner, readRegion, type NestedBoxSettings,
} from '../src/simulation/protostar/nestedBox';

const settings: NestedBoxSettings = {
    gridRes: PROTOSTAR_GRID_RES, ratio: PROTOSTAR_NESTED_RATIO, onDensity: PROTOSTAR_NESTED_ON_DENSITY, offDensity: PROTOSTAR_NESTED_OFF_DENSITY,
    readings: PROTOSTAR_NESTED_ON_READINGS, stillCells: PROTOSTAR_NESTED_STILL_CELLS, inner: PROTOSTAR_NESTED_INNER,
};
const cell = 6;
const size = boxCells(settings);
const reading = (density: number, x: number, y: number, finePeak: { x: number; y: number } | null = null) =>
    ({ mainPeakDensity: density, mainPeak: { x, y }, finePeak });

describe('the nested box', () => {
    it('is 16 main cells of 128 fine cells', () => {
        expect(size).toBe(16);
    });

    it('is centred on the peak, on the main cells, inside the grid', () => {
        expect(boxOrigin({ x: 64 * cell, y: 64 * cell }, cell, settings)).toEqual({ x: 56, y: 56 });
        expect(boxOrigin({ x: 2 * cell, y: 127.9 * cell }, cell, settings)).toEqual({ x: 0, y: 112 });
        const o = boxOrigin({ x: 40.3 * cell, y: 70.7 * cell }, cell, settings);
        expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
        expect(insideInner({ x: 40.3 * cell, y: 70.7 * cell }, o, cell, settings)).toBe(true);
    });

    it('stays off while the peak jumps between clumps, then switches on once a core holds still', () => {
        const box = new NestedBoxController(settings);
        const jumps = [[30, 30], [90, 40], [50, 100], [31, 31]];
        for (const [x, y] of jumps) expect(box.update(reading(20, x * cell, y * cell), cell)).toBe(false);
        expect(box.box).toBeNull();
        // Too thin: no box however still.
        for (let i = 0; i < 5; i++) box.update(reading(PROTOSTAR_NESTED_ON_DENSITY / 2, 64 * cell, 64 * cell), cell);
        expect(box.box).toBeNull();
        let switched = false;
        for (let i = 0; i < PROTOSTAR_NESTED_ON_READINGS; i++) switched = box.update(reading(20, (64 + 0.5 * i) * cell, 64 * cell), cell);
        expect(switched).toBe(true);
        expect(box.box).not.toBeNull();
    });

    it('moves only when the peak leaves the middle of the box (hysteresis), and goes off when the core fades', () => {
        const box = new NestedBoxController({ ...settings, readings: 1 });
        box.update(reading(20, 64 * cell, 64 * cell), cell);
        const placed = box.box;
        const generation = box.placement;
        // Within the middle half: stays.
        expect(box.update(reading(20, 64 * cell, 64 * cell, { x: 66.5 * cell, y: 61.5 * cell }), cell)).toBe(false);
        expect(box.box).toEqual(placed);
        expect(box.placement).toBe(generation);
        // Out of it: recentred on the fine peak.
        expect(box.update(reading(20, 64 * cell, 64 * cell, { x: 69 * cell, y: 64 * cell }), cell)).toBe(true);
        expect(box.box).toEqual({ x: 61, y: 56 });
        expect(box.placement).toBe(generation + 1);
        expect(box.update(reading(PROTOSTAR_NESTED_OFF_DENSITY / 2, 64 * cell, 64 * cell), cell)).toBe(true);
        expect(box.box).toBeNull();
    });

    it('reads the fine level a margin inside its edges', () => {
        const r = readRegion({ x: 100, y: 200 }, 0.5, 128, 2);
        expect(r).toEqual({ lo: { x: 101, y: 201 }, hi: { x: 163, y: 263 } });
    });
});

describe('the junction of the levels', () => {
    it('gathers a fine cell onto the main cells with weights that sum to 1 and keep its center', () => {
        const fine = { x: 10.37, y: 4.81 };          // in main cells
        let sum = 0, mx = 0, my = 0;
        for (let j = 3; j <= 6; j++) {
            for (let i = 9; i <= 12; i++) {
                const w = gatherWeight({ x: fine.x - (i + 0.5), y: fine.y - (j + 0.5) });
                sum += w;
                mx += w * (i + 0.5);
                my += w * (j + 0.5);
            }
        }
        expect(sum).toBeCloseTo(1, 12);
        expect(mx).toBeCloseTo(fine.x, 12);
        expect(my).toBeCloseTo(fine.y, 12);
    });

    it('reads a linear main field exactly at the fine centers', () => {
        const field = (i: number, j: number): number => 3 + 2 * (i + 0.5) * cell - 0.5 * (j + 0.5) * cell;
        for (const x of [{ x: 20.2, y: 31.7 }, { x: 100, y: 64.01 }]) {
            expect(bilinearAt(field, x, cell, 128)).toBeCloseTo(3 + 2 * x.x - 0.5 * x.y, 10);
        }
    });
});
