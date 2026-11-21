// The pure parts of the lab's check of the GPU search of the densest disk against its CPU reference (docs/spikes/b4-gpu-concentration.md):
// the clouds the two are compared on, and how far apart two answers are. No GPU or DOM here (tested in tests/lab.test.ts).

import type { Concentration } from '../simulation/concentration';

/** How far the GPU's answer is from the CPU's. */
export interface Agreement {
    /** Distance between the two centers, px. */
    centerPx: number;
    /** Difference of the shares of the total mass, in percentage points (GPU minus CPU). */
    sharePoints: number;
    /** Difference of the rms radii, px (GPU minus CPU). */
    spreadPx: number;
    /** Difference of the number of particles inside, relative to the CPU's (0 when both are 0). */
    membersRelative: number;
}

export function compareConcentration(gpu: Concentration, cpu: Concentration): Agreement {
    return {
        centerPx: Math.hypot(gpu.centerX - cpu.centerX, gpu.centerY - cpu.centerY),
        sharePoints: 100 * (gpu.fraction - cpu.fraction),
        spreadPx: gpu.spread - cpu.spread,
        membersRelative: cpu.members > 0 ? (gpu.members - cpu.members) / cpu.members : gpu.members === 0 ? 0 : Infinity,
    };
}

/** Whether the GPU's answer is as good as the stated tolerance: its center within `cellPx`, its share within `sharePoints` points. */
export const agrees = (a: Agreement, cellPx: number, sharePoints: number): boolean =>
    a.centerPx <= cellPx && Math.abs(a.sharePoints) <= sharePoints;

export const CLOUD_KINDS = ['uniform', 'blob', 'twin-blobs', 'corner', 'far-edge', 'compact', 'ring'] as const;
export type CloudKind = (typeof CLOUD_KINDS)[number];

/** A normal deviate from two uniform ones (Box-Muller). */
function gaussian(random: () => number): number {
    return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/**
 * A synthetic cloud of `count` particles over a `width` x `height` area, as position texels (x, y, species, 1); `species[i]` is the species of
 * particle i. A share of the particles sits in clumps, the rest is uniform; the clumps are placed where the coarse grid and the screen's edges
 * make the search difficult:
 *  - `uniform`: nothing stands out;
 *  - `blob`: 40 % in a gaussian of 25 px at (300, 250);
 *  - `twin-blobs`: two clumps of 30 % each with the same species, so the same mass (up to a particle): a near tie, answered by either;
 *  - `corner`: 50 % in a gaussian of 20 px at the top left corner, half of it off the area (clamped by the position pass);
 *  - `far-edge`: 50 % in a gaussian of 20 px at the bottom right corner, some particles exactly on the far edges;
 *  - `compact`: 90 % within a gaussian of 3 px (a collapsed clump: a few cells hold almost everything);
 *  - `ring`: 60 % on a ring of radius 70 around (500, 400) with a 6 px thickness, nothing at its center.
 */
export function syntheticCloud(kind: CloudKind, count: number, species: ArrayLike<number>, random: () => number,
                               width: number, height: number): Float32Array {
    const out = new Float32Array(count * 4);
    const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max);
    const uniform = (): [number, number] => [random() * width, random() * height];
    const place = (i: number, x: number, y: number): void => out.set([clamp(x, width), clamp(y, height), species[i], 1], i * 4);
    const clump = (i: number, cx: number, cy: number, sigma: number): void => place(i, cx + sigma * gaussian(random), cy + sigma * gaussian(random));
    const twins = kind === 'twin-blobs' ? Math.floor(count * 0.3) : 0;   // particles in each clump
    for (let i = 0; i < count; i++) {
        const u = random();
        switch (kind) {
            case 'uniform': place(i, ...uniform()); break;
            case 'blob': if (u < 0.4) clump(i, 300, 250, 25); else place(i, ...uniform()); break;
            case 'twin-blobs':
                // The particles of the pair (2k, 2k + 1) have the same species (the species are contiguous blocks by index, up to one
                // pair at the border of two blocks): the even ones make the first clump, the odd ones its copy, so the two weigh the same.
                if (i < 2 * twins && i % 2 === 1) out.set([out[(i - 1) * 4] + 450, out[(i - 1) * 4 + 1] + 120, species[i], 1], i * 4);
                else if (i < 2 * twins) clump(i, 250, 300, 15);
                else place(i, ...uniform());
                break;
            case 'corner': if (u < 0.5) clump(i, 0, 0, 20); else place(i, ...uniform()); break;
            case 'far-edge':
                if (u < 0.5) clump(i, width, height, 20);
                else if (i % 1000 === 0) place(i, width, height);
                else place(i, ...uniform());
                break;
            case 'compact': if (u < 0.9) clump(i, 640, 380, 3); else place(i, ...uniform()); break;
            case 'ring': {
                if (u < 0.6) {
                    const a = 2 * Math.PI * random(), r = 70 + 6 * (random() - 0.5);
                    place(i, 500 + r * Math.cos(a), 400 + r * Math.sin(a));
                } else place(i, ...uniform());
                break;
            }
        }
    }
    return out;
}
