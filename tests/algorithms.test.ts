import { describe, expect, it } from 'vitest';
import { ALGORITHM_IDS, ALGORITHMS, DEFAULT_ALGORITHM, algorithmInfo, isAlgorithmId } from '../src/simulation/algorithms';

describe('algorithm catalog', () => {
    it('describes every id exactly once, in the same order', () => {
        expect(ALGORITHMS.map(a => a.id)).toEqual([...ALGORITHM_IDS]);
    });

    it('gives every algorithm a label and a description', () => {
        for (const a of ALGORITHMS) {
            expect(a.label.trim()).not.toBe('');
            expect(a.description.trim()).not.toBe('');
        }
    });

    it('has a known default', () => {
        expect(isAlgorithmId(DEFAULT_ALGORITHM)).toBe(true);
        expect(algorithmInfo(DEFAULT_ALGORITHM).label).toBe('Poussière collante');
    });

    it('rejects unknown ids', () => {
        expect(isAlgorithmId('stickyDust')).toBe(true);
        expect(isAlgorithmId('plasma')).toBe(false);
        expect(isAlgorithmId('')).toBe(false);
    });
});
