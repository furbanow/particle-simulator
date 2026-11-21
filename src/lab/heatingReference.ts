// CPU references of the fusion heating for the lab (phase P3a, proposal A5): the gas state a
// particle reads (a twin of gasAt() in protostar-common.glsl, from the grids read back) and the
// sums over a group of particles of the energy and the momentum the heating added. Pure.

export interface GasSample {
    /** rho / rho0. */
    rho: number;
    /** Velocity dispersion, px^2/s^2. */
    t: number;
    /** Mean velocity, px/s. */
    u: [number, number];
    /** Fusion heating per unit mass, T0 per s. */
    heat: number;
}

/**
 * The gas at (x, y), as gasAt() computes it: the four cells around the point (cell centers, bilinear
 * weights, clamped at the grid's edge), each weighted by its density as well. `gas` holds (rho, T, ux, uy)
 * and `heat` (q, 0, 0, 0) per cell, `resolution` x `resolution` cells row by row from the bottom (as readTarget
 * gives them), `cell` is the cell size in px.
 */
export function sampleGas(x: number, y: number, gas: ArrayLike<number>, heat: ArrayLike<number>, resolution: number, cell: number): GasSample {
    const px = x / cell - 0.5;
    const py = y / cell - 0.5;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const clamp = (c: number): number => Math.min(resolution - 1, Math.max(0, c));
    const corners: [number, number, number][] = [
        [clamp(ix), clamp(iy), (1 - fx) * (1 - fy)], [clamp(ix + 1), clamp(iy), fx * (1 - fy)],
        [clamp(ix), clamp(iy + 1), (1 - fx) * fy], [clamp(ix + 1), clamp(iy + 1), fx * fy],
    ];
    const out: GasSample = { rho: 0, t: 0, u: [0, 0], heat: 0 };
    for (const [cx, cy, weight] of corners) {
        const k = (cy * resolution + cx) * 4;
        const m = weight * gas[k];
        out.rho += m;
        out.t += m * gas[k + 1];
        out.u[0] += m * gas[k + 2];
        out.u[1] += m * gas[k + 3];
        out.heat += m * heat[k];
    }
    if (out.rho > 0) {
        out.t /= out.rho;
        out.u[0] /= out.rho;
        out.u[1] /= out.rho;
        out.heat /= out.rho;
    }
    return out;
}

/** What the heating added to a group of particles of unit mass. */
export interface HeatingTotals {
    /** Kinetic energy added, sum of (|v'|^2 - |v|^2) / 2. */
    energy: number;
    /** Momentum added, sum of (v' - v). */
    momentum: [number, number];
}

/** The energy and the momentum that go from the velocities `before` to `after` (x, y of each particle, 4 floats per particle, `indices` selecting the particles). */
export function heatingTotals(before: ArrayLike<number>, after: ArrayLike<number>, indices: Iterable<number>): HeatingTotals {
    const totals: HeatingTotals = { energy: 0, momentum: [0, 0] };
    for (const i of indices) {
        const [bx, by, ax, ay] = [before[i * 4], before[i * 4 + 1], after[i * 4], after[i * 4 + 1]];
        totals.energy += 0.5 * (ax * ax + ay * ay - bx * bx - by * by);
        totals.momentum[0] += ax - bx;
        totals.momentum[1] += ay - by;
    }
    return totals;
}
