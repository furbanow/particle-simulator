// The profiles of a gas across the area, column by column, and their distance to the exact solution of a Riemann problem: the lab's
// shock tube (protostar.collisions.sod, proposal C1). Pure.

import { sampleRiemann, starRegion, type GasState } from './riemann';

/** The gas of each of `bins` columns of the area: particle count, mean velocity along x, and the velocity dispersions per component. */
export interface ColumnProfiles {
    count: number[];
    ux: number[];
    /** <(vx - ux)^2> and <(vy - uy)^2>, px^2/s^2. */
    pxx: number[];
    pyy: number[];
}

/** The columns of `count` particles (x, y, ... per 4 floats; velocities likewise) over [0, width). */
export function columnProfiles(positions: ArrayLike<number>, velocities: ArrayLike<number>, count: number, width: number, bins: number): ColumnProfiles {
    const n = new Array<number>(bins).fill(0);
    const sx = new Array<number>(bins).fill(0), sy = new Array<number>(bins).fill(0);
    const sxx = new Array<number>(bins).fill(0), syy = new Array<number>(bins).fill(0);
    for (let i = 0; i < count; i++) {
        const b = Math.min(bins - 1, Math.max(0, Math.floor(positions[i * 4] / width * bins)));
        const vx = velocities[i * 4], vy = velocities[i * 4 + 1];
        n[b]++;
        sx[b] += vx;
        sy[b] += vy;
        sxx[b] += vx * vx;
        syy[b] += vy * vy;
    }
    const ux = n.map((m, b) => m > 0 ? sx[b] / m : 0);
    const uy = n.map((m, b) => m > 0 ? sy[b] / m : 0);
    return {
        count: n, ux,
        pxx: n.map((m, b) => m > 0 ? sxx[b] / m - ux[b] * ux[b] : 0),
        pyy: n.map((m, b) => m > 0 ? syy[b] / m - uy[b] * uy[b] : 0),
    };
}

/** A shock tube in the units of its left state: density 1, velocity dispersion per component 1 (P_L = 1), its diaphragm at x0 px. */
export interface TubeUnits {
    /** Particles per column of the left state at rest. */
    leftCount: number;
    /** The left state's velocity dispersion per component, px/s (the unit of velocity). */
    sigma: number;
    /** The diaphragm, px; the time since it broke, s; the column width, px. */
    x0: number;
    seconds: number;
    binWidth: number;
}

/** The columns in the tube's units: density, velocity and pressure rho (pxx + pyy) / 2 (the planar gas). */
export function normalizedProfiles(p: ColumnProfiles, units: TubeUnits): GasState[] {
    return p.count.map((n, b) => {
        const rho = n / units.leftCount;
        return { rho, u: p.ux[b] / units.sigma, p: rho * (p.pxx[b] + p.pyy[b]) / 2 / (units.sigma * units.sigma) };
    });
}

/** The mean absolute differences of density, velocity and pressure from the exact solution of (left, right) for `gamma`, over the columns `from` to `to` (exclusive). */
export function profileErrors(profile: readonly GasState[], left: GasState, right: GasState, gamma: number, units: TubeUnits,
                              from: number, to: number): { rho: number; u: number; p: number } {
    const star = starRegion(left, right, gamma);
    let rho = 0, u = 0, p = 0;
    const velocityUnit = units.sigma;
    for (let b = from; b < to; b++) {
        const x = (b + 0.5) * units.binWidth;
        const exact = sampleRiemann(left, right, gamma, (x - units.x0) / (units.seconds * velocityUnit), star);
        rho += Math.abs(profile[b].rho - exact.rho);
        u += Math.abs(profile[b].u - exact.u);
        p += Math.abs(profile[b].p - exact.p);
    }
    const n = Math.max(1, to - from);
    return { rho: rho / n, u: u / n, p: p / n };
}
