// The adaptive thickness of the protostar's gas layer (proposal A11, the `adaptiveThickness` flag), as pure functions: the TypeScript
// twins of what protostar-gas.frag, grid-coarse.frag (COARSE_THICKNESS) and grid-gravity.frag (GRAVITY_SOURCE) compute, which the tests
// and the lab check.
//
// A self-gravitating isothermal sheet of surface density Sigma and vertical dispersion sigma_z has the scale height
//
//     h = sigma_z^2 / (pi G Sigma),
//
// and the model, whose gas moves in the plane only, takes sigma_z^2 = t / 2 (t = <|v - u|^2>, the dispersion of the two components of
// the gas pass; isotropy). h is computed in every cell from the 3 x 3 neighborhood the gas pass already sums, bounded below by a cell
// (the grid resolves nothing finer) and above by a fraction of the initial cloud radius (empty cells take the ceiling). It replaces
// the fixed softening eps of the gravity: a pair of cells i, j is softened by
//
//     eps_ij^2 = (h_i^2 + h_j^2) / 2,
//
// symmetric, so the near sum keeps action and reaction exact; the far monopoles use the mass-weighted mean of h^2 over their coarse
// cell. With the flag off every cell holds h^2 = eps^2 and (eps^2 + eps^2) / 2 = eps^2 exactly: the force is the fixed softening's,
// to the bit. A softening that changes in time does not conserve the energy exactly (the grad-h terms of Price & Monaghan 2007 are
// left out): the drift is measured by the lab.
//
// The fusion law reads the volume density Sigma / (2 h) (A2 with A11), as Sigma h_ref / h: h_ref is the default fixed softening
// (PROTOSTAR_THICKNESS_REFERENCE), so the rates are unchanged where the layer is as thick as the old softening was.

import { buildDiscTable, type DensityProfile } from './disc';

/** The bounds of the thickness, px. */
export interface ThicknessBounds {
    floor: number;
    ceiling: number;
}

/**
 * 1 / (2 pi G rho0) (px per (px^2/s^2)): the thickness is t / sigma times this, t the dispersion (px^2/s^2), sigma in rho0;
 * G_eff in px^3 / (mass s^2), rho0 in mass / px^2.
 */
export function thicknessPerDispersion(gravity: number, rho0: number): number {
    return gravity > 0 && rho0 > 0 ? 1 / (2 * Math.PI * gravity * rho0) : Infinity;
}

/** The scale height h (px) of a cell of dispersion `t` (px^2/s^2) and surface density `sigma` (rho0), within the bounds. */
export function layerThickness(t: number, sigma: number, perDispersion: number, bounds: ThicknessBounds): number {
    const h = sigma > 0 ? Math.max(t, 0) * perDispersion / sigma : Infinity;
    return Math.min(Math.max(h, bounds.floor), bounds.ceiling);
}

/** The softening^2 of a pair of cells of thicknesses h_i, h_j given as squares: (h_i^2 + h_j^2) / 2. */
export function pairSoftening2(h2i: number, h2j: number): number {
    return 0.5 * (h2i + h2j);
}

/** The factor h_ref / h that turns the surface density into the volume density the fusion law reads (1 at h = h_ref). */
export function lawDensityFactor(thickness: number, reference: number): number {
    return reference / thickness;
}

/** The mass-weighted mean of h^2 over cells (masses m, squares h2): what a far monopole is softened with; `fallback` when massless. */
export function meanThickness2(masses: ArrayLike<number>, h2: ArrayLike<number>, fallback: number): number {
    let m = 0, mh = 0;
    for (let k = 0; k < masses.length; k++) { m += masses[k]; mh += masses[k] * h2[k]; }
    return m > 0 ? mh / m : fallback;
}

/** A square grid of cells (row-major, `res` per side, `cell` px each): the mass and the thickness^2 of every cell. */
export interface ThicknessGrid {
    res: number;
    cell: number;
    mass: ArrayLike<number>;
    h2: ArrayLike<number>;
}

/**
 * The two-level softened gravity of grid-gravity.frag (GRAVITY_SOURCE) at the centre of cell (i, j), per unit of G times the mass unit:
 * the coarse cells farther than `nearRadius` (Chebyshev) from the cell's own as monopoles at their centre of mass softened with
 * their mean h^2, the fine cells of the others one by one. Returns (ax, ay, phi). The CPU reference of the GPU grid (lab) and of the
 * tests (action and reaction).
 */
export function softenedGravityAt(grid: ThicknessGrid, factor: number, nearRadius: number, i: number, j: number): [number, number, number] {
    const { res, cell, mass, h2 } = grid;
    const coarseRes = res / factor;
    const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    const own = [Math.floor(i / factor), Math.floor(j / factor)];
    const h2i = h2[j * res + i];
    let ax = 0, ay = 0, phi = 0;
    const add = (m: number, cx: number, cy: number, e2: number): void => {
        const rx = cx - x, ry = cy - y;
        const s = 1 / Math.sqrt(rx * rx + ry * ry + e2);
        ax += m * rx * s * s * s; ay += m * ry * s * s * s; phi -= m * s;
    };
    for (let cj = 0; cj < coarseRes; cj++) {
        for (let ci = 0; ci < coarseRes; ci++) {
            const near = Math.max(Math.abs(ci - own[0]), Math.abs(cj - own[1])) <= nearRadius;
            let m = 0, mx = 0, my = 0, mh = 0;
            for (let dj = 0; dj < factor; dj++) {
                for (let di = 0; di < factor; di++) {
                    const fi = ci * factor + di, fj = cj * factor + dj, k = fj * res + fi;
                    if (near) {
                        if (mass[k] > 0) add(mass[k], (fi + 0.5) * cell, (fj + 0.5) * cell, pairSoftening2(h2i, h2[k]));
                        continue;
                    }
                    m += mass[k]; mx += mass[k] * (fi + 0.5) * cell; my += mass[k] * (fj + 0.5) * cell; mh += mass[k] * h2[k];
                }
            }
            if (!near && m > 0) add(m, mx / m, my / m, pairSoftening2(h2i, mh / m));
        }
    }
    return [ax, ay, phi];
}

/** The most fixed-point iterations of initialThickness() and the relative change it stops at (the default cloud settles in 3, a virial one in about 10). */
const INITIAL_ITERATIONS = 20;
const INITIAL_TOLERANCE = 1e-4;

/** What the initial thickness of a cloud depends on (see initialThickness). */
export interface InitialThicknessOptions {
    radius: number;
    gravity: number;
    totalMass: number;
    profile: DensityProfile;
    virial: number;
    rotation: number;
    bounds: ThicknessBounds;
    /** The fixed softening to start the iteration from, px. */
    softening: number;
    /** Exactly this many iterations (the tests); by default until it settles. */
    iterations?: number;
}

/**
 * The thickness of the initial cloud (px), the softening its disc's table is built with when the flag is on: the agitation's
 * dispersion per component sigma^2 = (alpha_vir / 2 - beta_rot) |U| / M (initialConditions.ts) over pi G Sigma_0, Sigma_0 = M / (pi R^2)
 * the mean surface density, so h = sigma^2 R^2 / (G M); |U| depends on the softening, a little: a few fixed-point iterations.
 */
export function initialThickness(options: InitialThicknessOptions): number {
    const { radius, gravity, totalMass, profile, virial, rotation, bounds } = options;
    const share = Math.max(virial / 2 - Math.max(rotation, 0), 0);
    let h = Math.min(Math.max(options.softening, bounds.floor), bounds.ceiling);
    if (!(gravity > 0) || !(totalMass > 0)) return h;
    for (let k = 0; k < (options.iterations ?? INITIAL_ITERATIONS); k++) {
        const table = buildDiscTable({ radius, gravity, totalMass, softening: h, profile });
        const sigma2 = share * -table.potentialEnergy / totalMass;
        const next = Math.min(Math.max(sigma2 * radius * radius / (gravity * totalMass), bounds.floor), bounds.ceiling);
        const settled = Math.abs(next - h) <= INITIAL_TOLERANCE * next;
        h = next;
        if (settled && options.iterations === undefined) break;
    }
    return h;
}
