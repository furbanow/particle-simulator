import { CONCENTRATION_CELLS_PER_RADIUS, CONCENTRATION_MIN_CELL } from '../config';

export interface Concentration {
    /** Share (0..1) of the total mass inside the densest disk (of the particles, when no masses are given). */
    fraction: number;
    /** Number of particles inside the disk. */
    members: number;
    /** Center of mass of the particles inside the disk. */
    centerX: number;
    centerY: number;
    /** Root-mean-square distance (px) of the particles inside the disk to that center, weighted by mass: the size of the cluster. */
    spread: number;
}

/**
 * The coarse grid the densest disk is looked for on: square cells of `CONCENTRATION_CELLS_PER_RADIUS` to the radius (at least
 * `CONCENTRATION_MIN_CELL` px), `columns` x `rows` of them over the screen. The GPU search builds the same grid.
 */
export interface ConcentrationGrid {
    cellSize: number;
    columns: number;
    rows: number;
    /**
     * The disk of a cell is every cell at offset (dx, dy) with dx^2 + dy^2 <= this (cell centers inside the radius), an integer:
     * the CPU and the GPU take the same cells, whatever the rounding of the distances.
     */
    reachSquared: number;
}

export function concentrationGrid(radius: number, width: number, height: number): ConcentrationGrid {
    const cellSize = Math.max(CONCENTRATION_MIN_CELL, radius / CONCENTRATION_CELLS_PER_RADIUS);
    const unit = cellSize * cellSize, r2 = radius * radius;
    let reachSquared = Math.floor(r2 / unit);
    while ((reachSquared + 1) * unit <= r2) reachSquared++;
    while (reachSquared > 0 && reachSquared * unit > r2) reachSquared--;
    return { cellSize, columns: Math.ceil(width / cellSize), rows: Math.ceil(height / cellSize), reachSquared };
}

/** Reused between calls to avoid reallocating the coarse grid. */
let cellMass = new Float64Array(0);

/**
 * Finds the disk of the given radius holding the most mass: a coarse grid (cells of radius/4)
 * locates the densest disk, then its center moves to the center of mass of the particles inside
 * and the exact mass is taken around that center. The fraction is that mass over the total mass.
 *
 * This is the reference of the GPU reduction the sticky dust runs (stickyDust/concentrationReduction.ts, which does the same
 * steps on float32 sums); the application runs it itself only on a device that cannot blend float32 targets.
 *
 * @param positions RGBA float texels (x, y, species, 1) of the particles, 4 floats per particle.
 * @param n         number of active particles.
 * @param masses    mass of each species, by the species index of the position texel; every particle weighs 1 when omitted.
 */
export function analyzeConcentration(positions: ArrayLike<number>, n: number, radius: number,
                                     width: number, height: number, masses?: ArrayLike<number>): Concentration {
    const weight = (i: number): number => masses ? (masses[Math.round(positions[i * 4 + 2])] ?? 0) : 1;
    const { cellSize, columns: gw, rows: gh, reachSquared } = concentrationGrid(radius, width, height);
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

    const reach = Math.floor(Math.sqrt(reachSquared));
    const offsets: number[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
            if (dx * dx + dy * dy <= reachSquared) offsets.push(dx, dy);
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

    let members = 0, memberMass = 0, moment = 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 4], y = positions[i * 4 + 1];
        const d2 = (x - centerX) ** 2 + (y - centerY) ** 2;
        if (d2 > r2) continue;
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

/**
 * What the GPU search leaves in its result target (two RGBA32F texels, read back as eight floats): the center of the disk, the
 * mass inside it and the total mass; then the second moment of that mass about the center, the number of particles inside and the
 * mass of the densest disk of cells (the coarse search's own figure, for the lab).
 */
export const CONCENTRATION_RESULT_TEXELS = 2;
export const CONCENTRATION_RESULT_FLOATS = CONCENTRATION_RESULT_TEXELS * 4;

export interface ConcentrationReading extends Concentration {
    totalMass: number;
    memberMass: number;
    /** Sum of m d^2 of the members about the center. */
    moment: number;
    /** Mass of the densest disk of cells, whose center the search started from. */
    coarseMass: number;
}

/**
 * Turns the eight floats of the GPU result into the same figures `analyzeConcentration` gives. `totalMass` replaces the one the GPU
 * summed when given: the cells of the coarse grid hold float32 sums of up to millions of units, which round to a whole unit (to within
 * a percent when a clump falls into one cell), whereas the caller knows the total exactly (the species' masses times their counts).
 */
export function unpackConcentration(texels: ArrayLike<number>, totalMass?: number): ConcentrationReading {
    const [centerX, centerY, memberMass, summedMass, moment, count, coarseMass] = [0, 1, 2, 3, 4, 5, 6].map(i => texels[i]);
    const total = totalMass !== undefined && totalMass > 0 ? totalMass : summedMass;
    const members = Math.round(count);
    return {
        fraction: total > 0 ? Math.min(memberMass / total, 1) : 0, members, centerX, centerY,
        spread: memberMass > 0 ? Math.sqrt(Math.max(moment, 0) / memberMass) : 0,
        totalMass: total, memberMass, moment, coarseMass,
    };
}
