import { describe, expect, it } from 'vitest';
import { maskMassGrid } from '../src/simulation/darkMatter/massGrid';

/** RGBA bytes of a width x height mask, alpha given per pixel (rows from the top). */
function mask(width: number, height: number, alpha: (x: number, row: number) => number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
        for (let x = 0; x < width; x++) data[(row * width + x) * 4 + 3] = alpha(x, row);
    }
    return data;
}

const massAt = (data: Float32Array, res: number, i: number, j: number): number => data[(j * res + i) * 4];

describe('dark matter mass grid', () => {
    it('weighs 1 per opaque pixel and conserves the mass', () => {
        const { data, total } = maskMassGrid(mask(8, 4, () => 255), 8, 4, 4, 2);
        expect(total).toBe(32);
        let sum = 0;
        for (let k = 0; k < data.length; k += 4) sum += data[k];
        expect(sum).toBe(32);
        expect(massAt(data, 4, 0, 0)).toBe(4);              // 2 x 2 pixels per cell
        expect(massAt(data, 4, 0, 2)).toBe(0);              // the grid spans max(width, height): above the mask
    });

    it('flips the rows: the top of the canvas is the top of the simulation', () => {
        const { data } = maskMassGrid(mask(4, 4, (_x, row) => row === 0 ? 255 : 0), 4, 4, 4, 1);
        expect(massAt(data, 4, 0, 3)).toBe(1);
        expect(massAt(data, 4, 0, 0)).toBe(0);
    });

    it('scales the mass with the opacity', () => {
        expect(maskMassGrid(mask(2, 2, () => 51), 2, 2, 2, 1).total).toBeCloseTo(0.8);
    });

    it('reuses and clears the output buffer', () => {
        const out = new Float32Array(2 * 2 * 4).fill(7);
        const { data, total } = maskMassGrid(mask(2, 2, () => 0), 2, 2, 2, 1, out);
        expect(data).toBe(out);
        expect(total).toBe(0);
        expect([...out].every(v => v === 0)).toBe(true);
    });
});
