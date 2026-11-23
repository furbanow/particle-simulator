// The stability map of the protostar's gas (proposal A12): Toomre's Q and the cooling parameter beta = t_cool Omega of every cell of
// the gas grid, the TypeScript twin of protostar-stability.frag (tested here, checked against the GPU by the lab). Pure functions.
//
// The gas pass already holds, per cell, the surface density Sigma (rho / rho0), the dispersion t = <|v - u|^2> and the mean velocity u
// of its 3 x 3 neighborhood, and the factor mu / mu_H of its temperature. From them:
//
//  - Omega = u_t / r, the angular velocity of the mean flow about the center of mass: (dx u_y - dy u_x) / r^2;
//  - zeta = d u_y / dx - d u_x / dy, the vorticity of the mean flow, by central differences over the neighbouring cells (one-sided
//    where a neighbour holds no gas, 0 where neither does);
//  - kappa^2 = 2 Omega zeta, the epicyclic frequency (for a rotation curve v(r) it is (1 / r^3) d(r^2 v^2) / dr: Omega = v / r and
//    zeta = v / r + dv / dr give 2 Omega zeta = 2 (v / r)(v / r + dv / dr), the same); a flow whose angular momentum falls outwards
//    (kappa^2 <= 0) has no epicyclic support: kappa = 0, so Q = 0;
//  - Q = sigma kappa / (3.36 G Sigma), with the stellar criterion of toomre.ts and the radial dispersion sigma = sqrt(t / 2) (the
//    dispersion of the plane is that of two components);
//  - beta = t_cool |Omega|, with Gammie's (2001) cooling time t_cool = E / |dE/dt| = 1 / |d ln T / dt|, the rate of the thin-disc law of
//    cooling.ts (coolingLogRate) at the cell's temperature T = mu t / T0. A gas at or below T_min, or with no cooling, has t_cool and beta
//    unbounded.
//
// A disc fragments where Q < 1 and beta < 3 (Gammie 2001 for a 2D gas): self-gravity wins over rotation and pressure, and the gas
// sheds the heat of its compression faster than the shear can bring it. Unbounded values are written as PROTOSTAR_STABILITY_CAP.

import { PROTOSTAR_STABILITY_CAP } from '../../config';
import { coolingLogRate, type RadiativeCooling } from './cooling';
import { STELLAR_TOOMRE } from './toomre';

/** What the map shows over the animation: nothing, where the disc fragments (Q < 1 and beta < 3), Q, or beta. */
export const STABILITY_MAP_MODES = ['off', 'fragmentation', 'toomre', 'cooling'] as const;
export type StabilityMapMode = typeof STABILITY_MAP_MODES[number];

export const isStabilityMapMode = (value: unknown): value is StabilityMapMode =>
    typeof value === 'string' && (STABILITY_MAP_MODES as readonly string[]).includes(value);

/** What turns the grid's numbers into Q and beta. */
export interface StabilityScales {
    /** Cell size, px. */
    cell: number;
    /** G_eff rho0, px/s^2: G Sigma of a cell is this times its rho / rho0. */
    gravityDensity: number;
    /** T0 as a dispersion, px^2/s^2: a hydrogen gas of dispersion t has the temperature t / T0. */
    t0: number;
    cooling: RadiativeCooling;
}

/** One cell's stability: what the shader writes, (q, beta, rho, kappa2). */
export interface CellStability {
    /** Toomre's Q (CAP where there is no gas). */
    q: number;
    /** t_cool |Omega| (CAP where the gas does not cool). */
    beta: number;
    /** rho / rho0 of the cell (0: no gas). */
    rho: number;
    /** kappa^2, 1/s^2 (2 Omega zeta). */
    kappa2: number;
}

/** The angular velocity (1/s, counterclockwise positive) of a velocity (ux, uy) at the offset (dx, dy) from the center, r^2 at least `minR2`. */
export function angularVelocity(dx: number, dy: number, ux: number, uy: number, minR2: number): number {
    return (dx * uy - dy * ux) / Math.max(dx * dx + dy * dy, minR2);
}

/** Toomre's Q of a cell of surface density `rho` (rho0), dispersion `t` (px^2/s^2) and epicyclic frequency squared `kappa2`. */
export function cellToomre(rho: number, t: number, kappa2: number, gravityDensity: number): number {
    const gravity = STELLAR_TOOMRE * gravityDensity * rho;
    if (!(gravity > 0)) return PROTOSTAR_STABILITY_CAP;
    return Math.min(Math.sqrt(Math.max(t, 0) / 2) * Math.sqrt(Math.max(kappa2, 0)) / gravity, PROTOSTAR_STABILITY_CAP);
}

/** beta = t_cool |Omega| of a cell (CAP when it does not cool). */
export function cellCooling(rho: number, t: number, mu: number, omega: number, scales: StabilityScales): number {
    const rate = coolingLogRate(mu * t / scales.t0, mu, rho, scales.cooling);
    if (!(rate < 0)) return PROTOSTAR_STABILITY_CAP;
    return Math.min(Math.abs(omega) / -rate, PROTOSTAR_STABILITY_CAP);
}

/** The gas grid as the gas pass writes it: RGBA rows of `resolution` cells, (rho / rho0, t, ux, uy); and its thermo attachment (z: mu / mu_H). */
export interface GasGrid {
    gas: ArrayLike<number>;
    thermo: ArrayLike<number>;
    resolution: number;
}

/**
 * The stability of every cell (RGBA rows: q, beta, rho, kappa^2), around `center` (px; the center of mass), as the shader computes it.
 * Cell (i, j) has its center at ((i + 0.5) cell, (j + 0.5) cell), y up.
 */
export function stabilityMap(grid: GasGrid, center: { x: number; y: number }, scales: StabilityScales): Float32Array {
    const { gas, thermo, resolution: res } = grid;
    const out = new Float32Array(res * res * 4);
    const at = (i: number, j: number): number => (j * res + i) * 4;
    const hasGas = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < res && j < res && gas[at(i, j)] > 0;
    /** d(component)/d(axis) by central differences, one-sided where a neighbour is empty. */
    const derivative = (i: number, j: number, di: number, dj: number, component: number): number => {
        const hiOk = hasGas(i + di, j + dj), loOk = hasGas(i - di, j - dj);
        if (!hiOk && !loOk) return 0;
        const hi = hiOk ? gas[at(i + di, j + dj) + component] : gas[at(i, j) + component];
        const lo = loOk ? gas[at(i - di, j - dj) + component] : gas[at(i, j) + component];
        return (hi - lo) / ((hiOk && loOk ? 2 : 1) * scales.cell);
    };
    for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
            const k = at(i, j);
            const rho = gas[k];
            if (!(rho > 0)) {
                out.set([PROTOSTAR_STABILITY_CAP, PROTOSTAR_STABILITY_CAP, 0, 0], k);
                continue;
            }
            const t = gas[k + 1], ux = gas[k + 2], uy = gas[k + 3];
            const omega = angularVelocity((i + 0.5) * scales.cell - center.x, (j + 0.5) * scales.cell - center.y, ux, uy, scales.cell * scales.cell);
            const vorticity = derivative(i, j, 1, 0, 3) - derivative(i, j, 0, 1, 2);
            const kappa2 = 2 * omega * vorticity;
            out.set([
                cellToomre(rho, t, kappa2, scales.gravityDensity),
                cellCooling(rho, t, thermo[k + 2], omega, scales),
                rho, kappa2,
            ], k);
        }
    }
    return out;
}
