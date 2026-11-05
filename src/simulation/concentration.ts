/** One disk of particles above the threshold. */
export interface Concentration {
    /** Fraction (0..1) of all the particles inside the disk. */
    fraction: number;
    /** Number of particles claimed by the disk. */
    members: number;
    centerX: number;
    centerY: number;
}

export interface ConcentrationSearch {
    radius: number;
    width: number;
    height: number;
    /** Fraction (0..1) of all the particles a disk must hold to become a zone. */
    threshold: number;
    /** At most this many zones are returned, possibly none (the mask holds index + 1 in a byte). */
    maxZones: number;
    /** Per particle: the time until which it is not counted. */
    immuneUntil: ArrayLike<number>;
    /** Current time, in the same clock as immuneUntil. */
    now: number;
}

export interface ConcentrationResult {
    /** Fraction held by the densest disk, even when it stays below the threshold. */
    maxFraction: number;
    /** Disks above the threshold, densest first. They may overlap but share no particle. */
    zones: Concentration[];
}

/** Reused between calls to avoid reallocating the coarse grids. */
let cellCounts = new Int32Array(0);
let diskSums = new Int32Array(0);
let memberIndices = new Int32Array(0);

/**
 * Finds the disks of the given radius holding the most particles, densest first. A coarse grid
 * (cells of radius/4) locates the densest disk, then its center moves to the centroid of the
 * particles inside and the exact count is taken around that centroid. The particles of an accepted
 * disk are removed from the count and the search goes on until a disk falls below the threshold.
 *
 * @param positions RGBA float texels (x, y, species, 1) of the particles, 4 floats per particle.
 * @param n         number of active particles.
 * @param mask      receives, for every particle, the index + 1 of its zone (0: none).
 */
export function findConcentrations(positions: ArrayLike<number>, n: number, search: ConcentrationSearch,
                                   mask: Uint8Array): ConcentrationResult {
    const { radius, width, height, threshold, maxZones, immuneUntil, now } = search;
    const cellSize = Math.max(2, radius / 4);
    const gw = Math.ceil(width / cellSize);
    const gh = Math.ceil(height / cellSize);
    const cells = gw * gh;
    if (cellCounts.length < cells) {
        cellCounts = new Int32Array(cells);
        diskSums = new Int32Array(cells);
    }
    if (memberIndices.length < n) memberIndices = new Int32Array(n);
    cellCounts.fill(0, 0, cells);
    diskSums.fill(0, 0, cells);
    mask.fill(0);

    const cellOf = (i: number): number => {
        const cx = Math.min(gw - 1, Math.max(0, Math.floor(positions[i * 4] / cellSize)));
        const cy = Math.min(gh - 1, Math.max(0, Math.floor(positions[i * 4 + 1] / cellSize)));
        return cy * gw + cx;
    };
    for (let i = 0; i < n; i++) {
        if (immuneUntil[i] <= now) cellCounts[cellOf(i)]++;
    }

    const reach = Math.floor(radius / cellSize);
    const offsets: number[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
            if ((dx * dx + dy * dy) * cellSize * cellSize <= radius * radius) offsets.push(dx, dy);
        }
    }
    // Adds a cell's particles to the sum of every disk that contains it. Applied again with a
    // negative amount when a zone claims them, so the sums are never rebuilt between zones.
    const spread = (cell: number, amount: number): void => {
        const cx = cell % gw, cy = Math.floor(cell / gw);
        for (let k = 0; k < offsets.length; k += 2) {
            const x = cx + offsets[k], y = cy + offsets[k + 1];
            if (x >= 0 && x < gw && y >= 0 && y < gh) diskSums[y * gw + x] += amount;
        }
    };
    for (let cell = 0; cell < cells; cell++) {
        if (cellCounts[cell] > 0) spread(cell, cellCounts[cell]);
    }

    const r2 = radius * radius;
    const zones: Concentration[] = [];
    let maxFraction = 0;
    // The first disk is always measured, for maxFraction.
    for (let attempt = 0; attempt < Math.max(maxZones, 1); attempt++) {
        let bestCell = -1, bestSum = 0;
        for (let cell = 0; cell < cells; cell++) {
            if (cellCounts[cell] > 0 && diskSums[cell] > bestSum) { bestSum = diskSums[cell]; bestCell = cell; }
        }
        if (bestCell < 0) break;

        let centerX = ((bestCell % gw) + 0.5) * cellSize;
        let centerY = (Math.floor(bestCell / gw) + 0.5) * cellSize;
        let sx = 0, sy = 0, inside = 0;
        for (let i = 0; i < n; i++) {
            if (mask[i] !== 0 || immuneUntil[i] > now) continue;
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

        let members = 0;
        for (let i = 0; i < n; i++) {
            if (mask[i] !== 0 || immuneUntil[i] > now) continue;
            const x = positions[i * 4], y = positions[i * 4 + 1];
            if ((x - centerX) ** 2 + (y - centerY) ** 2 <= r2) memberIndices[members++] = i;
        }
        const fraction = members / n;
        if (attempt === 0) maxFraction = fraction;
        if (zones.length === maxZones || members === 0 || fraction < threshold) break;

        const claimed = new Map<number, number>();
        for (let m = 0; m < members; m++) {
            const i = memberIndices[m];
            mask[i] = zones.length + 1;
            const cell = cellOf(i);
            claimed.set(cell, (claimed.get(cell) ?? 0) + 1);
        }
        for (const [cell, count] of claimed) {
            cellCounts[cell] -= count;
            spread(cell, -count);
        }
        zones.push({ fraction, members, centerX, centerY });
    }

    return { maxFraction, zones };
}

/**
 * Time during which ejected particles are not counted, so that an aggregate does not explode again
 * before its matter has left the detection disk: the crossing time of the disk at the ejection
 * speed, and at least the time during which the ejecta ignore gravity.
 */
export function ejectaImmunity(radius: number, ejectionSpeed: number, ejectTime: number): number {
    return ejectionSpeed > 0 ? Math.max(ejectTime, radius / ejectionSpeed) : ejectTime;
}
