export interface Concentration {
    /** Share (0..1) of the total mass inside the densest disk (of the particles, when no masses are given). */
    fraction: number;
    /** Number of particles inside the disk (flagged with 255 in the mask). */
    members: number;
    /** Center of mass of the particles inside the disk. */
    centerX: number;
    centerY: number;
    /** Root-mean-square distance (px) of the particles inside the disk to that center, weighted by mass: the size of the cluster. */
    spread: number;
}

/** Reused between calls to avoid reallocating the coarse grid. */
let cellMass = new Float64Array(0);

/**
 * Finds the disk of the given radius holding the most mass: a coarse grid (cells of radius/4)
 * locates the densest disk, then its center moves to the center of mass of the particles inside
 * and the exact mass is taken around that center. The fraction is that mass over the total mass.
 *
 * @param positions RGBA float texels (x, y, species, 1) of the particles, 4 floats per particle.
 * @param n         number of active particles.
 * @param mask      receives 255 for every particle inside the final disk, 0 elsewhere.
 * @param masses    mass of each species, by the species index of the position texel; every particle weighs 1 when omitted.
 */
export function analyzeConcentration(positions: ArrayLike<number>, n: number, radius: number,
                                     width: number, height: number, mask: Uint8Array,
                                     masses?: ArrayLike<number>): Concentration {
    const weight = (i: number): number => masses ? (masses[Math.round(positions[i * 4 + 2])] ?? 0) : 1;
    const cellSize = Math.max(2, radius / 4);
    const gw = Math.ceil(width / cellSize);
    const gh = Math.ceil(height / cellSize);
    const cells = gw * gh;
    if (cellMass.length < cells) cellMass = new Float64Array(cells);
    cellMass.fill(0, 0, cells);
    let totalMass = 0;
    for (let i = 0; i < n; i++) {
        const cx = Math.min(gw - 1, Math.max(0, Math.floor(positions[i * 4] / cellSize)));
        const cy = Math.min(gh - 1, Math.max(0, Math.floor(positions[i * 4 + 1] / cellSize)));
        const m = weight(i);
        cellMass[cy * gw + cx] += m;
        totalMass += m;
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
            if (cellMass[cy * gw + cx] === 0) continue;
            let sum = 0;
            for (let k = 0; k < offsets.length; k += 2) {
                const x = cx + offsets[k], y = cy + offsets[k + 1];
                if (x >= 0 && x < gw && y >= 0 && y < gh) sum += cellMass[y * gw + x];
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
        const m = weight(i);
        sx += m * x;
        sy += m * y;
        inside += m;
    }
    if (inside > 0) {
        centerX = sx / inside;
        centerY = sy / inside;
    }

    mask.fill(0);
    let members = 0, memberMass = 0, moment = 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 4], y = positions[i * 4 + 1];
        const d2 = (x - centerX) ** 2 + (y - centerY) ** 2;
        if (d2 > r2) continue;
        mask[i] = 255;
        members++;
        const m = weight(i);
        memberMass += m;
        moment += m * d2;
    }

    return {
        fraction: totalMass > 0 ? memberMass / totalMass : 0, members, centerX, centerY,
        spread: memberMass > 0 ? Math.sqrt(moment / memberMass) : 0,
    };
}
