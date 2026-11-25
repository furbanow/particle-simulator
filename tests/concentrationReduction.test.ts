import { describe, expect, it } from 'vitest';
import { CONCENTRATION_REPLICA_BUDGET, CONCENTRATION_REPLICA_COLUMNS, CONCENTRATION_REPLICAS } from '../src/config';
import { concentrationGrid } from '../src/simulation/concentration';
import { replicaTiles } from '../src/simulation/stickyDust/concentrationReduction';

describe('replicaTiles', () => {
    it('makes every copy the maximum allows for the grid of the default area and radius, in tiles four wide', () => {
        const grid = concentrationGrid(65, 1024, 768);
        const tiles = replicaTiles(grid.columns * grid.rows);

        expect(tiles.columns * tiles.rows).toBe(CONCENTRATION_REPLICAS);
        expect(tiles.columns).toBe(CONCENTRATION_REPLICA_COLUMNS);
    });

    it('makes fewer copies of a bigger grid, always a power of two, and never more texels than the budget', () => {
        for (const cells of [3072, 20000, 126280, 400000, 700000, 1327104]) {
            const { columns, rows } = replicaTiles(cells);
            const copies = columns * rows;

            expect(copies).toBeGreaterThanOrEqual(1);
            expect(copies).toBeLessThanOrEqual(CONCENTRATION_REPLICAS);
            expect(Math.log2(copies) % 1).toBe(0);
            if (copies > 1) expect(cells * copies).toBeLessThanOrEqual(CONCENTRATION_REPLICA_BUDGET);
        }
    });

    it('keeps one copy of the largest grid (a 4K screen with the smallest radius)', () => {
        const grid = concentrationGrid(10, 3840, 2160);

        expect(replicaTiles(grid.columns * grid.rows)).toEqual({ columns: 1, rows: 1 });
    });

    it('halves the copies as the grid doubles', () => {
        expect(replicaTiles(126280)).toEqual({ columns: 4, rows: 2 });
        expect(replicaTiles(252560)).toEqual({ columns: 4, rows: 1 });
        expect(replicaTiles(505120)).toEqual({ columns: 2, rows: 1 });
    });
});
