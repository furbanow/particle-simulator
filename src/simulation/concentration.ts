export interface Concentration {
    /** Fraction (0..1) of the particles inside the densest disk. */
    fraction: number;
    /** Number of particles inside the disk (flagged with 255 in the mask). */
    members: number;
    centerX: number;
    centerY: number;
}

/** Reused between calls to avoid reallocating the coarse grid. */
let cellCounts = new Int32Array(0);

/**
 * Finds the disk of the given radius holding the most particles: a coarse grid (cells of
 * radius/4) locates the densest disk, then its center moves to the centroid of the particles
 * inside and the exact count is taken around that centroid.
 *
 * @param positions RGBA float texels (x, y, species, 1) of the particles, 4 floats per particle.
 * @param n         number of active particles.
 * @param mask      receives 255 for every particle inside the final disk, 0 elsewhere.
 */
export function analyzeConcentration(positions: ArrayLike<number>, n: number, radius: number,
                                     width: number, height: number, mask: Uint8Array): Concentration {
    const cellSize = Math.max(2, radius / 4);
    const gw = Math.ceil(width / cellSize);
    const gh = Math.ceil(height / cellSize);
    const cells = gw * gh;
    if (cellCounts.length < cells) cellCounts = new Int32Array(cells);
    cellCounts.fill(0, 0, cells);
    for (let i = 0; i < n; i++) {
        const cx = Math.min(gw - 1, Math.max(0, Math.floor(positions[i * 4] / cellSize)));
        const cy = Math.min(gh - 1, Math.max(0, Math.floor(positions[i * 4 + 1] / cellSize)));
        cellCounts[cy * gw + cx]++;
    }

    const reach = Math.floor(radius / cellSize);
    const offsets: number[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
            if ((dx * dx + dy * dy) * cellSize * cellSize <= radius * radius) offsets.push(dx, dy);
        }
    }

    let bestCell = 0, bestSum = -1;
    for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
            if (cellCounts[cy * gw + cx] === 0) continue;
            let sum = 0;
            for (let k = 0; k < offsets.length; k += 2) {
                const x = cx + offsets[k], y = cy + offsets[k + 1];
                if (x >= 0 && x < gw && y >= 0 && y < gh) sum += cellCounts[y * gw + x];
            }
            if (sum > bestSum) { bestSum = sum; bestCell = cy * gw + cx; }
        }
    }

    const r2 = radius * radius;
    let centerX = ((bestCell % gw) + 0.5) * cellSize;
    let centerY = (Math.floor(bestCell / gw) + 0.5) * cellSize;
    let sx = 0, sy = 0, inside = 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 4], y = positions[i * 4 + 1];
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > r2) continue;
        sx += x;
        sy += y;
        inside++;
    }
    if (inside > 0) {
        centerX = sx / inside;
        centerY = sy / inside;
    }

    mask.fill(0);
    let members = 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 4], y = positions[i * 4 + 1];
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > r2) continue;
        mask[i] = 255;
        members++;
    }

    return { fraction: n > 0 ? members / n : 0, members, centerX, centerY };
}
