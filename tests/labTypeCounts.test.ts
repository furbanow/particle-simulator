import { describe, expect, it } from 'vitest';
import { countTypes } from '../src/lab/typeCounts';

describe('countTypes', () => {
    it('counts the type ranks of the read-back positions (z), clamped like the shaders', () => {
        const ranks = [0, 0, 1, 0.9, 2, 7, -1];
        const data = new Float32Array(ranks.length * 4 + 8);
        ranks.forEach((z, i) => { data[i * 4 + 2] = z; });
        expect(countTypes(data, ranks.length, 3)).toEqual([3, 2, 2]);
        expect(countTypes(data, 2, 3)).toEqual([2, 0, 0]);
        expect(countTypes(data, 3, 0)).toEqual([]);
    });

    it('leaves out the particles that are not live', () => {
        const data = new Float32Array(4 * 4);
        [[0, 1], [1, 1], [0, -1], [1, 1]].forEach(([z, w], i) => { data[i * 4 + 2] = z; data[i * 4 + 3] = w; });
        expect(countTypes(data, 4, 2)).toEqual([1, 2]);
    });
});
