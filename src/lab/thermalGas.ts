// Initial states of known temperature for the lab (phase P3a: the heating and the noise of the
// temperature): a uniform gas whose particles have Maxwellian velocities, and isolated blobs of
// particles placed exactly at the center of a grid cell. Pure: they fill the position and velocity
// arrays of an InitialState (x, y, type rank, w and vx, vy, 0, 0 per particle) from a random source.
// The velocity dispersion T of a gas (the mean of |v - u|^2, what the simulation calls temperature)
// is 2 sigma^2 for a standard deviation of sigma per component.

import { PROTOSTAR_FUSION_T_REF, PROTOSTAR_GRID_RES } from '../config';
import type { InitialState } from '../simulation/gpuModel';
import { LAB_AREA } from './config';

/**
 * The scales of the lab's area (1024 x 768 px): T0 (px^2/s^2) and the cell size of the grids (px).
 * The standard deviation of the velocity per component, px/s, of a gas of dispersion `t` (in T0) is thermalSigma(t).
 */
const length = Math.min(LAB_AREA.width, LAB_AREA.height);
export const LAB_T0 = PROTOSTAR_FUSION_T_REF * length * length;
export const LAB_CELL = Math.max(LAB_AREA.width, LAB_AREA.height) / PROTOSTAR_GRID_RES;
export const thermalSigma = (temperature: number): number => Math.sqrt(temperature * LAB_T0 / 2);

/** A rectangle of the simulation area, px. */
export interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** Two independent standard normal numbers from two uniforms in (0, 1] and [0, 1) (Box-Muller). */
export function gaussianPair(u1: number, u2: number): [number, number] {
    const radius = Math.sqrt(-2 * Math.log(1 - u1));
    const angle = 2 * Math.PI * u2;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** Writes particle `i`: position, type 0 (the first type: hydrogen) and w = 1 (alive); velocity (vx, vy). */
function place(state: InitialState, i: number, x: number, y: number, vx: number, vy: number): void {
    const { positions, velocities } = state;
    positions[i * 4] = x;
    positions[i * 4 + 1] = y;
    positions[i * 4 + 2] = 0;
    positions[i * 4 + 3] = 1;
    velocities[i * 4] = vx;
    velocities[i * 4 + 1] = vy;
    velocities[i * 4 + 2] = 0;
    velocities[i * 4 + 3] = 0;
}

/**
 * `state.count` particles of the first type, uniform in `box`, with velocities drawn from a normal
 * distribution of standard deviation `sigma` (px/s) per component around `bulk`: a gas of dispersion
 * T = 2 sigma^2 at rest (or moving as a whole).
 */
export function fillThermalGas(state: InitialState, box: Box, sigma: number, random: () => number,
                               bulk: readonly [number, number] = [0, 0]): void {
    for (let i = 0; i < state.count; i += 2) {
        const [gx, gy] = gaussianPair(random(), random());
        const [hx, hy] = gaussianPair(random(), random());
        place(state, i, box.x0 + random() * (box.x1 - box.x0), box.y0 + random() * (box.y1 - box.y0),
            bulk[0] + sigma * gx, bulk[1] + sigma * gy);
        if (i + 1 < state.count) {
            place(state, i + 1, box.x0 + random() * (box.x1 - box.x0), box.y0 + random() * (box.y1 - box.y0),
                bulk[0] + sigma * hx, bulk[1] + sigma * hy);
        }
    }
}

/** A group of particles at the center of one grid cell. */
export interface Blob {
    /** Column and row of the cell (from the origin). */
    cell: readonly [number, number];
    count: number;
    /** Standard deviation of the velocity per component, px/s (0: all the particles have the mean velocity). */
    sigma: number;
    /** Mean velocity, px/s. */
    bulk: readonly [number, number];
}

/**
 * The blobs one after the other, each particle exactly at the center of its blob's cell (cell size
 * `cellSize` px): the bilinear weights of such a particle are 1 for its own cell and 0 for the
 * others, so it reads that cell's gas state alone. The blobs' velocities are standardized: the
 * sample mean is exactly `bulk` and the sample variance exactly sigma^2 per component (a count of
 * at least 3 is needed), so that the temperature of a blob is known to rounding.
 * The caller's `state.count` must be the sum of the counts.
 */
export function fillBlobs(state: InitialState, blobs: readonly Blob[], cellSize: number, random: () => number): void {
    let i = 0;
    for (const blob of blobs) {
        const x = (blob.cell[0] + 0.5) * cellSize;
        const y = (blob.cell[1] + 0.5) * cellSize;
        const raw: [number, number][] = [];
        for (let k = 0; k < blob.count; k++) raw.push(gaussianPair(random(), random()));
        const meanX = raw.reduce((s, g) => s + g[0], 0) / blob.count;
        const meanY = raw.reduce((s, g) => s + g[1], 0) / blob.count;
        const varX = raw.reduce((s, g) => s + (g[0] - meanX) ** 2, 0) / blob.count;
        const varY = raw.reduce((s, g) => s + (g[1] - meanY) ** 2, 0) / blob.count;
        const scaleX = varX > 0 ? 1 / Math.sqrt(varX) : 0;
        const scaleY = varY > 0 ? 1 / Math.sqrt(varY) : 0;
        for (const [gx, gy] of raw) {
            place(state, i++, x, y, blob.bulk[0] + blob.sigma * (gx - meanX) * scaleX, blob.bulk[1] + blob.sigma * (gy - meanY) * scaleY);
        }
    }
}
