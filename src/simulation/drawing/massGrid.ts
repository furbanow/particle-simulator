// Mass of a drawing on its grid, from the opacity mask. Pure function (tested).

/** The mass grid of a mask, and its total mass. */
export interface MassGrid {
    /** RGBA per cell, row by row from the bottom (texture order): the mass in R, px^2 at opacity 1. */
    readonly data: Float32Array;
    readonly total: number;
}

/**
 * Sums the mask's opacity (RGBA bytes, alpha = density, row by row from the top as a canvas holds
 * them) on a `res` x `res` grid of square cells of `cell` px from the origin. A pixel of opacity 1
 * weighs 1. The simulation's y axis points up: the canvas rows are flipped. Pixels beyond the grid
 * are dropped. `out` (res * res * 4 floats) is reused when given.
 */
export function maskMassGrid(rgba: ArrayLike<number>, width: number, height: number, res: number, cell: number,
                             out: Float32Array = new Float32Array(res * res * 4)): MassGrid {
    out.fill(0);
    const column = new Int32Array(width);
    for (let x = 0; x < width; x++) column[x] = Math.floor((x + 0.5) / cell);
    let total = 0;
    for (let row = 0; row < height; row++) {
        const j = Math.floor((height - row - 0.5) / cell);
        if (j < 0 || j >= res) continue;
        const line = row * width * 4;
        const cellRow = j * res;
        for (let x = 0; x < width; x++) {
            const alpha = rgba[line + x * 4 + 3];
            if (alpha === 0) continue;
            const i = column[x];
            if (i >= res) continue;
            const m = alpha / 255;
            out[(cellRow + i) * 4] += m;
            total += m;
        }
    }
    return { data: out, total };
}
