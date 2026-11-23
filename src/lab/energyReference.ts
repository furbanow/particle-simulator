// CPU references for the energy diagnostics, in double precision: the direct sum of the Plummer
// pair energies, a twin of the two-level grid gravity of grid-gravity.frag / grid-coarse.frag, a
// twin of the reduction (protostar-reduce.frag), and the statistics of an energy series. Pure
// (tested in tests/lab.test.ts): no GPU, no DOM.

import { REDUCTION_NO_THICKNESS } from '../simulation/protostar/reduction';
import { ENERGY_OSCILLATION_WINDOW_ORBITS } from './config';
import { quantile } from './numbers';

// ---- Direct sums ----

export interface DirectEnergies {
    /** 1/2 sum m |v|^2, simulation units (mass x px^2/s^2). */
    kinetic: number;
    /** -G sum over pairs i < j of m_i m_j / sqrt(r_ij^2 + eps^2). */
    potential: number;
    /** Live particles summed. */
    particles: number;
}

/**
 * The energies of the particles themselves, with no grid: `positions` and `velocities` are state
 * texels (x, y, type, w and vx, vy, ..., one per particle), `masses[type]` the mass of a particle
 * of each type in simulation units, `gravity` G_eff (px^3 / (mass s^2)). O(N^2).
 */
export function directEnergies(positions: ArrayLike<number>, velocities: ArrayLike<number>, count: number,
                               masses: readonly number[], gravity: number, softening: number): DirectEnergies {
    const x: number[] = [], y: number[] = [], m: number[] = [];
    let kinetic = 0;
    for (let i = 0; i < count; i++) {
        if (!(positions[i * 4 + 3] >= 0)) continue;
        const mass = masses[Math.round(positions[i * 4 + 2])] ?? 0;
        x.push(positions[i * 4]);
        y.push(positions[i * 4 + 1]);
        m.push(mass);
        kinetic += 0.5 * mass * (velocities[i * 4] ** 2 + velocities[i * 4 + 1] ** 2);
    }
    const eps2 = softening * softening;
    let potential = 0;
    for (let i = 0; i < x.length; i++) {
        let row = 0;
        for (let j = i + 1; j < x.length; j++) {
            const dx = x[j] - x[i], dy = y[j] - y[i];
            row += m[j] / Math.sqrt(dx * dx + dy * dy + eps2);
        }
        potential -= gravity * m[i] * row;
    }
    return { kinetic, potential, particles: x.length };
}

// ---- The grid gravity, as the shaders compute it ----

export interface GridGravityOptions {
    /** Fine cells per side. */
    resolution: number;
    coarseFactor: number;
    /** Chebyshev radius, in coarse cells, of the cells summed one by one. */
    nearRadius: number;
    /** px per fine cell. */
    cell: number;
    /** Epsilon, px. */
    softening: number;
    /** G_eff x simulation mass of one deposit unit. */
    gravityPerDeposit: number;
}

export interface GridGravity {
    ax: Float64Array;
    ay: Float64Array;
    /** The Plummer potential at the cell centers, px^2/s^2. */
    phi: Float64Array;
}

/**
 * grid-coarse.frag then grid-gravity.frag on the CPU: `mass` is the mass grid (deposit units, one
 * value per cell, row by row from the bottom). The far coarse cells are summed as a mass at their
 * center of mass, the near ones cell by cell; the cell's own mass is in the sums (at distance 0).
 */
export function gridGravity(mass: ArrayLike<number>, o: GridGravityOptions): GridGravity {
    const { resolution: res, coarseFactor: factor, nearRadius, cell, gravityPerDeposit } = o;
    const coarseRes = res / factor;
    const eps2 = o.softening * o.softening;
    const coarse = new Float64Array(coarseRes * coarseRes * 3);                 // (mass, x px, y px)
    for (let cy = 0; cy < coarseRes; cy++) {
        for (let cx = 0; cx < coarseRes; cx++) {
            let m = 0, mx = 0, my = 0;
            for (let j = 0; j < factor; j++) {
                for (let i = 0; i < factor; i++) {
                    const fx = cx * factor + i, fy = cy * factor + j;
                    const mi = mass[fy * res + fx];
                    m += mi;
                    mx += mi * (fx + 0.5);
                    my += mi * (fy + 0.5);
                }
            }
            const k = (cy * coarseRes + cx) * 3;
            coarse[k] = m;
            coarse[k + 1] = (m > 0 ? mx / m : (cx + 0.5) * factor) * cell;
            coarse[k + 2] = (m > 0 ? my / m : (cy + 0.5) * factor) * cell;
        }
    }
    const span = (2 * nearRadius + 1) * factor;
    const ax = new Float64Array(res * res), ay = new Float64Array(res * res), phi = new Float64Array(res * res);
    for (let cy = 0; cy < res; cy++) {
        for (let cx = 0; cx < res; cx++) {
            const x = (cx + 0.5) * cell, y = (cy + 0.5) * cell;
            const ownX = Math.floor(cx / factor), ownY = Math.floor(cy / factor);
            let fx = 0, fy = 0, p = 0;
            for (let j = 0; j < coarseRes; j++) {
                for (let i = 0; i < coarseRes; i++) {
                    if (Math.max(Math.abs(i - ownX), Math.abs(j - ownY)) <= nearRadius) continue;
                    const k = (j * coarseRes + i) * 3;
                    if (coarse[k] <= 0) continue;
                    const rx = coarse[k + 1] - x, ry = coarse[k + 2] - y;
                    const s = 1 / Math.sqrt(rx * rx + ry * ry + eps2);
                    fx += coarse[k] * rx * s * s * s;
                    fy += coarse[k] * ry * s * s * s;
                    p -= coarse[k] * s;
                }
            }
            const originX = (ownX - nearRadius) * factor, originY = (ownY - nearRadius) * factor;
            for (let j = 0; j < span; j++) {
                for (let i = 0; i < span; i++) {
                    const ix = originX + i, iy = originY + j;
                    if (ix < 0 || iy < 0 || ix >= res || iy >= res) continue;
                    const m = mass[iy * res + ix];
                    if (m <= 0) continue;
                    const rx = (ix + 0.5) * cell - x, ry = (iy + 0.5) * cell - y;
                    const s = 1 / Math.sqrt(rx * rx + ry * ry + eps2);
                    fx += m * rx * s * s * s;
                    fy += m * ry * s * s * s;
                    p -= m * s;
                }
            }
            const c = cy * res + cx;
            ax[c] = fx * gravityPerDeposit;
            ay[c] = fy * gravityPerDeposit;
            phi[c] = p * gravityPerDeposit;
        }
    }
    return { ax, ay, phi };
}

/** 1/2 sum M phi over the cells (deposit units x px^2/s^2). */
export function gridPotentialSum(mass: ArrayLike<number>, phi: ArrayLike<number>): number {
    let sum = 0;
    for (let c = 0; c < mass.length; c++) sum += 0.5 * mass[c] * phi[c];
    return sum;
}

// ---- The reduction, as the shader computes it ----

/** The grids the reduction reads, as read back (RGBA per cell, row by row from the bottom). */
export interface ReductionGrids {
    gas: ArrayLike<number>;
    /** The gas pass's second attachment (T averaged, effective particles, mu / mu_H, 0): the factor that turns the dispersion into the temperature. */
    thermo: ArrayLike<number>;
    moments: ArrayLike<number>;
    composition: ArrayLike<number>;
    force: ArrayLike<number>;
    power: ArrayLike<number>;
    /** The gas pass's fourth attachment, the source of the gravity (m, h^2, 0, 0): the softening of every cell. */
    source: ArrayLike<number>;
    /** G_eff x mass of one deposit unit: the self-interaction G m^2 / (2 h) the reduction takes off. */
    gravityPerDeposit: number;
    resolution: number;
    /** Cells per side of a first-stage block (the reduction's scan order). */
    block: number;
    cell: number;
    fusionTRef: number;
}

/** The raw sums of the reduction, in the grids' units (before the conversion to simulation units). */
export interface ReductionSums {
    peakDensity: number;
    peakTemperature: number;
    fusionRate: number;
    mass: number;
    peak: { x: number; y: number };
    maxSpeed: number;
    maxAcceleration: number;
    doubleKinetic: number;
    /** 1/2 sum M phi less the self-interaction, cell by cell. */
    potential: number;
    /** The smallest softening of a cell with mass, px (REDUCTION_NO_THICKNESS without any). */
    minSoftening: number;
    massPosition: { x: number; y: number };
    momentum: { x: number; y: number };
}

/**
 * protostar-reduce.frag on the CPU, in double precision, cell by cell. The densest cell is the
 * first one with a strictly greater density, scanning the blocks of the first stage in reading
 * order and the cells of each block in reading order, as the two stages do.
 */
export function reductionReference(g: ReductionGrids): ReductionSums {
    const { resolution: res, block, cell } = g;
    const sums: ReductionSums = {
        peakDensity: 0, peakTemperature: 0, fusionRate: 0, mass: 0, peak: { x: 0, y: 0 }, maxSpeed: 0, maxAcceleration: 0,
        doubleKinetic: 0, potential: 0, minSoftening: REDUCTION_NO_THICKNESS, massPosition: { x: 0, y: 0 }, momentum: { x: 0, y: 0 },
    };
    const blocks = res / block;
    for (let by = 0; by < blocks; by++) {
        for (let bx = 0; bx < blocks; bx++) {
            for (let j = 0; j < block; j++) {
                for (let i = 0; i < block; i++) {
                    const cx = bx * block + i, cy = by * block + j;
                    const k = (cy * res + cx) * 4;
                    const [density, temperature, ux, uy] = [g.gas[k], g.gas[k + 1], g.gas[k + 2], g.gas[k + 3]];
                    const m = g.moments[k];
                    const x = (cx + 0.5) * cell, y = (cy + 0.5) * cell;
                    sums.fusionRate += g.power[k + 1];
                    if (density > sums.peakDensity) {
                        sums.peakDensity = density;
                        sums.peakTemperature = temperature * g.thermo[k + 2] / g.fusionTRef;   // the temperature (A1), not the dispersion
                        sums.peak = { x, y };
                    }
                    if (density > 0) sums.maxSpeed = Math.max(sums.maxSpeed, Math.hypot(ux, uy) + Math.sqrt(temperature));
                    const h2 = g.source[k + 1];
                    if (m > 0) {
                        sums.maxAcceleration = Math.max(sums.maxAcceleration, Math.hypot(g.force[k], g.force[k + 1]));
                        sums.minSoftening = Math.min(sums.minSoftening, Math.sqrt(h2));
                    }
                    sums.mass += m;
                    sums.massPosition.x += m * x;
                    sums.massPosition.y += m * y;
                    sums.momentum.x += g.moments[k + 1];
                    sums.momentum.y += g.moments[k + 2];
                    sums.doubleKinetic += g.moments[k + 3];
                    sums.potential += 0.5 * m * g.force[k + 2] + (h2 > 0 ? 0.5 * g.gravityPerDeposit * g.composition[k + 2] / Math.sqrt(h2) : 0);
                }
            }
        }
    }
    return sums;
}

// ---- Orbits and energy series ----

/**
 * Period of a circular orbit of radius `radius` around `enclosed` mass taken as one softened point, s: v^2 / r = G M r / (r^2 + eps^2)^(3/2).
 * The lab's unit of time for the energy runs (an orbit at the half-mass radius), kept as it was when the cloud's own circular speed was
 * this law's: the disc's (disc.ts) is not what the unit stands for.
 */
export function orbitalPeriod(gravity: number, enclosed: number, radius: number, softening: number): number {
    const speed = Math.sqrt(gravity * enclosed * radius * radius / (radius * radius + softening * softening) ** 1.5);
    return 2 * Math.PI * radius / speed;
}

export interface DriftStatistics {
    /** Readings used. */
    count: number;
    /** The last reading. */
    final: number;
    /** The largest magnitude over the readings. */
    maxAbs: number;
    /** Mean of the last tenth of the readings (smooths the oscillation). */
    lateMean: number;
    /** Least-squares slope per orbit. */
    slopePerOrbit: number;
    /**
     * Amplitude of the oscillation about the trend: half of the 5th-to-95th-percentile range of the
     * readings minus their running median over `windowOrbits` (a slow drift, however curved, is not oscillation).
     */
    oscillation: number;
}

/** The running median of `values` (at `times`) over a window centered on each reading, `window` wide in the units of the times. */
function runningMedian(times: readonly number[], values: readonly number[], window: number): number[] {
    let lo = 0, hi = 0;
    return values.map((_, i) => {
        while (times[lo] < times[i] - window / 2) lo++;
        while (hi < times.length && times[hi] <= times[i] + window / 2) hi++;
        return quantile(values.slice(lo, hi), 0.5);
    });
}

/**
 * Statistics of a series of relative drifts (fractions) against time in orbits, from `fromOrbits`
 * on. Null when fewer than three readings remain.
 */
export function driftStatistics(orbits: readonly number[], drifts: readonly number[], fromOrbits = 0,
                                windowOrbits = ENERGY_OSCILLATION_WINDOW_ORBITS): DriftStatistics | null {
    const t: number[] = [], d: number[] = [];
    orbits.forEach((o, i) => { if (o >= fromOrbits && Number.isFinite(drifts[i])) { t.push(o); d.push(drifts[i]); } });
    const n = d.length;
    if (n < 3) return null;
    const meanT = t.reduce((s, v) => s + v, 0) / n;
    const meanD = d.reduce((s, v) => s + v, 0) / n;
    let covariance = 0, variance = 0;
    for (let i = 0; i < n; i++) { covariance += (t[i] - meanT) * (d[i] - meanD); variance += (t[i] - meanT) ** 2; }
    const slope = variance > 0 ? covariance / variance : 0;
    const trend = runningMedian(t, d, windowOrbits);
    const residual = d.map((v, i) => v - trend[i]);
    const late = d.slice(Math.floor(n * 0.9));
    return {
        count: n,
        final: d[n - 1],
        maxAbs: d.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
        lateMean: late.reduce((s, v) => s + v, 0) / late.length,
        slopePerOrbit: slope,
        oscillation: (quantile(residual, 0.95) - quantile(residual, 0.05)) / 2,
    };
}
