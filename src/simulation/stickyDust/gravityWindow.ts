/** A rectangle of texels (or of corners of texels), bounds included, in the coordinates of one level of the density pyramid. */
export interface TexelRect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

const clampTo = (v: number, max: number): number => Math.min(max, Math.max(0, v));

/**
 * The corners of density texels (level 0, `res` x `res` over `domainSize`: corner i is at i / res of
 * the field, 0..res) that a particle inside the screen (0..width, 0..height, the grid shifted by
 * `offset`) can read bilinearly, `margin` more on every side.
 */
export function gravityWindow(offsetX: number, offsetY: number, domainSize: number, width: number, height: number,
                              res: number, margin: number): TexelRect {
    const toTexel = (px: number): number => px / domainSize * res;
    return {
        x0: clampTo(Math.floor(toTexel(offsetX)) - margin, res),
        y0: clampTo(Math.floor(toTexel(offsetY)) - margin, res),
        x1: clampTo(Math.floor(toTexel(offsetX + width)) + 1 + margin, res),
        y1: clampTo(Math.floor(toTexel(offsetY + height)) + 1 + margin, res),
    };
}

/**
 * The part of the grid of `level` (`res >> level` texels, one texel = 2^level level-0 texels, plus one
 * texel of apron on every side: texel i is at index i + 1) that the corners of `rect` (level-0
 * coordinates) read when they sample that level bilinearly: the two texels around each corner, hence
 * one more on each side than the rect divided by 2^level. Indices in the grid, apron included.
 */
export function levelRect(rect: TexelRect, level: number, res: number): TexelRect {
    const lastIndex = (res >> level) + 1;
    const scale = 2 ** level;
    const index = (texel: number): number => clampTo(texel + 1, lastIndex);
    return {
        x0: index(Math.floor(rect.x0 / scale) - 1),
        y0: index(Math.floor(rect.y0 / scale) - 1),
        x1: index(Math.floor(rect.x1 / scale) + 1),
        y1: index(Math.floor(rect.y1 / scale) + 1),
    };
}
