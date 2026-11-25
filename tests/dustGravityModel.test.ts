import { describe, expect, it } from 'vitest';
import { DUST_GRADIENT_CORNER_WEIGHT, LONG_RANGE } from '../src/config';
import { bilinear, gravityAt, pointMassGrid, pyramid } from '../src/lab/dustGravityModel';
import { harmonicAnisotropy, radialTangential } from '../src/lab/gravityStats';
import { halton } from '../src/lab/numbers';

const RES = 128;
const TOP_LEVEL = Math.log2(RES) - 1;
const options = (cornerWeight: number) => ({ longRange: LONG_RANGE, topLevel: TOP_LEVEL, cornerWeight });

describe('lab: CPU twin of the sticky dust gravity', () => {
    it('builds the mip chain by averaging 2 x 2 texels', () => {
        const level0 = Float64Array.from({ length: 16 }, (_, i) => i);
        const levels = pyramid(level0, 4);
        expect(levels.map(l => l.size)).toEqual([4, 2, 1]);
        expect(levels[1].data[0]).toBeCloseTo((0 + 1 + 4 + 5) / 4, 12);
        expect(levels[2].data[0]).toBeCloseTo(7.5, 12);
    });

    it('reads bilinearly between texel centers and repeats the edge texels beyond', () => {
        const level = { size: 2, data: Float64Array.from([0, 2, 4, 6]) };
        expect(bilinear(level, 1, 1)).toBeCloseTo(3, 12);          // the corner shared by the four texels
        expect(bilinear(level, 0.5, 0.5)).toBe(0);
        expect(bilinear(level, -5, 0.5)).toBe(0);                  // clamp to edge
        expect(bilinear(level, 1.5, 1.5)).toBe(6);
    });

    it('gives the same pull whatever the stencil on a smooth field (rows sum to one)', () => {
        // A density ramp along x, away from the edges: its gradient is the same constant for every weight.
        const ramp = new Float64Array(RES * RES);
        for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) ramp[y * RES + x] = 0.01 * x;
        const levels = pyramid(ramp, RES);
        const pulls = [0, 3 / 16, 0.25].map(w => gravityAt(levels, 64.3, 60.7, { ...options(w), topLevel: 3 }));
        expect(pulls[1][0]).toBeCloseTo(pulls[0][0], 10);
        expect(pulls[2][0]).toBeCloseTo(pulls[0][0], 10);
        expect(pulls[0][1]).toBeCloseTo(0, 10);
        expect(pulls[1][1]).toBeCloseTo(0, 10);
    });

    it('makes the pull of a point mass much less dependent on the angle than the central difference does', () => {
        const angles = 180;
        const anisotropy = (w: number): number => {
            let worst = 0;
            for (const radius of [6, 9, 12, 16, 24]) {
                const sum = new Float64Array(angles);
                const phases = 24;
                for (let p = 0; p < phases; p++) {
                    const cx = RES / 4 + halton(p + 1, 2) * RES / 2, cy = RES / 4 + halton(p + 1, 3) * RES / 2;
                    const levels = pyramid(pointMassGrid(RES, cx, cy, 1000), RES);
                    for (let k = 0; k < angles; k++) {
                        const a = (k + 0.5) / angles * 2 * Math.PI;
                        const [gx, gy] = gravityAt(levels, cx + radius * Math.cos(a), cy + radius * Math.sin(a), options(w));
                        sum[k] += radialTangential(gx, gy, a).radial / phases;
                    }
                }
                worst = Math.max(worst, harmonicAnisotropy(sum, [4, 8, 12, 16]));
            }
            return worst;
        };
        const cross = anisotropy(0);
        const scharr = anisotropy(3 / 16);
        const shipped = anisotropy(DUST_GRADIENT_CORNER_WEIGHT);
        expect(cross).toBeGreaterThan(0.3);                // about 0.42 here: a square kernel
        expect(scharr).toBeLessThan(0.15);                 // about 0.095
        expect(shipped).toBeLessThan(scharr);              // about 0.05: the weight kept is the one that lowers the worst ring
        expect(shipped).toBeLessThan(0.08);
    });
});
