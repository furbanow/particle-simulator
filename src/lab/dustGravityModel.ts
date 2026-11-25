// A CPU twin of the sticky dust's multi-scale gravity (pure, tested in tests/dustGravityModel.test.ts): the
// density pyramid of the GPU (box-averaged mip levels, clamp-to-edge bilinear reads) and the pull summed
// over its levels, level by level. It lets the anisotropy of the pull of a point mass be explored
// (stencil weights) without a GPU; the lab's dust.gravity.point-mass is the same measurement on the GPU.

/** One level of the pyramid: `size` x `size` values, row by row from the bottom. */
export interface Level {
    size: number;
    data: Float64Array;
}

/** The mip chain of a `res` x `res` grid: level L averages 2^L x 2^L texels of level 0, as generateMipmap does. */
export function pyramid(level0: Float64Array, res: number): Level[] {
    const levels: Level[] = [{ size: res, data: level0 }];
    while (levels[levels.length - 1].size > 1) {
        const { size, data } = levels[levels.length - 1];
        const half = size / 2;
        const next = new Float64Array(half * half);
        for (let y = 0; y < half; y++) {
            for (let x = 0; x < half; x++) {
                next[y * half + x] = (data[2 * y * size + 2 * x] + data[2 * y * size + 2 * x + 1]
                    + data[(2 * y + 1) * size + 2 * x] + data[(2 * y + 1) * size + 2 * x + 1]) / 4;
            }
        }
        levels.push({ size: half, data: next });
    }
    return levels;
}

/** A unit-weight cloud-in-cell deposit of `mass` at (x, y), in texels: the grid the splat shader builds for one particle. */
export function pointMassGrid(res: number, x: number, y: number, mass: number): Float64Array {
    const grid = new Float64Array(res * res);
    const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
    for (let j = y0; j <= y0 + 1; j++) {
        for (let i = x0; i <= x0 + 1; i++) {
            if (i < 0 || j < 0 || i >= res || j >= res) continue;
            grid[j * res + i] = mass * Math.max(0, 1 - Math.abs(i + 0.5 - x)) * Math.max(0, 1 - Math.abs(j + 0.5 - y));
        }
    }
    return grid;
}

/** The bilinear read of a level at (u, v), in texels of that level measured from the corner (clamp to edge, as the texture does). */
export function bilinear(level: Level, u: number, v: number): number {
    const { size, data } = level;
    const fx = u - 0.5, fy = v - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const at = (a: number, b: number): number => data[Math.min(size - 1, Math.max(0, b)) * size + Math.min(size - 1, Math.max(0, a))];
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

export interface GravityOptions {
    /** Weight of level L is 2^(L * longRange). */
    longRange: number;
    /** Highest level that carries a gradient (the 1x1 level carries none). */
    topLevel: number;
    /**
     * Weight w of the two outer rows of the gradient's 3 x 3 stencil (the middle row weighs 1 - 2w) on the
     * levels 1 and up: 0 is the central difference, 3/16 the isotropic stencil of Scharr,
     * gx = [3 (D++ - D-+) + 10 (D+0 - D-0) + 3 (D+- - D--)] / 16, gy by symmetry. Level 0 is always the central difference.
     */
    cornerWeight: number;
}

/**
 * The pull at (x, y) (level-0 texels, from the corner of the grid): the sum over the levels of their
 * gradient, one level texel away, read bilinearly at the position. Same figure as the GPU's field (plus the
 * level 0 the particle reads itself), see DustGravityField and the reference loop of gravityProbe.ts.
 */
export function gravityAt(levels: readonly Level[], x: number, y: number, options: GravityOptions): [number, number] {
    let gx = 0, gy = 0;
    for (let lod = 0; lod <= options.topLevel; lod++) {
        const level = levels[lod];
        const scale = 2 ** lod;
        const u = x / scale, v = y / scale;
        const d = (dx: number, dy: number): number => bilinear(level, u + dx, v + dy);
        const w = 2 ** (lod * options.longRange);
        const c = lod === 0 ? 0 : options.cornerWeight;
        gx += w * (c * (d(1, 1) - d(-1, 1) + d(1, -1) - d(-1, -1)) + (1 - 2 * c) * (d(1, 0) - d(-1, 0)));
        gy += w * (c * (d(1, 1) - d(1, -1) + d(-1, 1) - d(-1, -1)) + (1 - 2 * c) * (d(0, 1) - d(0, -1)));
    }
    return [gx, gy];
}
