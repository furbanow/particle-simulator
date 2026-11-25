// Initial state of the protostar algorithm: a disc of gas (uniform, or Maclaurin's) that turns at a share of the circular
// speed of the disc itself, with a random agitation of a set energy. The energies are the ones that matter for what the cloud
// will do, in units of the disc's own potential energy |U|: the virial ratio alpha_vir = 2K / |U| and the share of the
// rotation beta_rot = E_rot / |U| (K the whole kinetic energy, E_rot the part that is the mean rotation). Pure functions (tested).

import {
    PROTOSTAR_TURBULENCE_GRID, PROTOSTAR_TURBULENCE_K_RANGE, PROTOSTAR_TURBULENCE_SLOPE,
} from '../../config';
import { gaussian } from '../../util/math';
import type { InitialState } from '../gpuModel';
import { buildDiscTable, radiusFraction, type DensityProfile, type DiscTable } from './disc';
import { sampleField, solenoidalField } from './turbulence';

/** How the agitation is laid out: independent for each particle (white noise), or correlated in space (a power-law spectrum). */
export type Turbulence = 'white' | 'correlated';

export const TURBULENCE_KINDS: readonly Turbulence[] = ['white', 'correlated'];

export interface CloudOptions {
    /** Cloud radius, px. */
    radius: number;
    /** Effective gravitational constant (px^3 / (mass s^2)) and total mass of the cloud. */
    gravity: number;
    totalMass: number;
    /** Softening length epsilon, px. */
    softening: number;
    profile: DensityProfile;
    /** The virial ratio alpha_vir = 2K / |U| of the whole kinetic energy (rotation and agitation). */
    virial: number;
    /** The share of the rotation beta_rot = E_rot / |U|: a cloud on circular orbits has about 0.5. At most half the virial ratio. */
    rotation: number;
    turbulence: Turbulence;
}

/** What `fillCloud` laid out: the disc's table and the energies it set (simulation units: mass px^2 / s^2). */
export interface CloudSummary {
    table: DiscTable;
    /** |U|, the potential energy of the disc. */
    potentialEnergy: number;
    /** E_rot = beta_rot |U|, and the energy of the agitation, (alpha_vir / 2 - beta_rot) |U| (0 when the rotation takes it all). */
    rotationEnergy: number;
    randomEnergy: number;
    /** The tangential speed as a fraction of the disc's circular speed (1: circular orbits). */
    rotationFactor: number;
    /** The agitation's standard deviation of each velocity component, px/s. */
    dispersion: number;
}

/**
 * Fills the positions (x, y, type, 1) and velocities (vx, vy, 0, 0) of a rotating cloud centered on the area. The velocities
 * are those at the positions, at time 0: the first substep of the integration owes no half kick (see leapfrog.ts), so no
 * initial acceleration is needed (the disc's table gives it: `discAcceleration`). The tangential speed is a common fraction
 * of the circular speed of the disc, sqrt(r g(r)), chosen so that the rotation has the energy beta_rot |U| to the
 * particle; the agitation, of zero mean (the cloud does not drift), is scaled to the energy the virial ratio leaves, to the
 * particle too (the agitation has no part along the rotation's pattern, so the two add without a cross term): the energies the
 * sliders ask for are the ones of the cloud drawn, up to the particles' own potential energy, which is the Poisson noise's.
 */
export function fillCloud(state: InitialState, options: CloudOptions, random: () => number = Math.random): CloudSummary {
    const { positions: p, velocities: v, count, typeCounts, width, height } = state;
    const { radius, gravity, totalMass, softening, profile, virial, rotation, turbulence } = options;
    const cx = width / 2, cy = height / 2;
    let type = 0, blockEnd = typeCounts[0] ?? count;
    for (let i = 0; i < count; i++) {
        while (i >= blockEnd && type < typeCounts.length - 1) blockEnd += typeCounts[++type];
        const r = radius * radiusFraction(profile, random());      // the mass inside r is uniform in [0, 1]
        const angle = random() * Math.PI * 2;
        p[i * 4] = cx + Math.cos(angle) * r;
        p[i * 4 + 1] = cy + Math.sin(angle) * r;
        p[i * 4 + 2] = type;
        p[i * 4 + 3] = 1;
    }

    const table = buildDiscTable({ radius, gravity, totalMass, softening, profile });
    const potentialEnergy = -table.potentialEnergy;
    const rotationEnergy = Math.max(rotation, 0) * potentialEnergy;
    const randomEnergy = Math.max(virial / 2 - Math.max(rotation, 0), 0) * potentialEnergy;
    const dispersion = Math.sqrt(randomEnergy / totalMass);          // K = M sigma^2 for two components

    // The agitation, first as noise of any scale (written in the velocities), its mean taken off, then scaled.
    let meanX = 0, meanY = 0;
    if (turbulence === 'correlated') {
        const [kMin, kMax] = PROTOSTAR_TURBULENCE_K_RANGE;
        const field = solenoidalField({ size: PROTOSTAR_TURBULENCE_GRID, slope: PROTOSTAR_TURBULENCE_SLOPE, kMin, kMax }, random);
        const toCells = field.size / (2 * radius);
        const sample = { x: 0, y: 0 };
        for (let i = 0; i < count; i++) {
            sampleField(field, (p[i * 4] - cx + radius) * toCells, (p[i * 4 + 1] - cy + radius) * toCells, sample);
            v[i * 4] = sample.x; v[i * 4 + 1] = sample.y;
            meanX += sample.x; meanY += sample.y;
        }
    } else {
        for (let i = 0; i < count; i++) {
            const nx = gaussian(random), ny = gaussian(random);
            v[i * 4] = nx; v[i * 4 + 1] = ny;
            meanX += nx; meanY += ny;
        }
    }
    // The agitation carries no net rotation: what a cloud turns at is the rotation's to set (beta_rot), not a few large eddies'. Its
    // projection on the rotation's pattern (the circular speed, along the tangent) is taken off, which also leaves no cross term
    // between the two in the kinetic energy.
    let circular = 0, along = 0;
    if (count > 0) {
        meanX /= count; meanY /= count;
        for (let i = 0; i < count; i++) {
            const nx = v[i * 4] - meanX, ny = v[i * 4 + 1] - meanY;
            v[i * 4] = nx; v[i * 4 + 1] = ny;
            const dx = p[i * 4] - cx, dy = p[i * 4 + 1] - cy, r = Math.hypot(dx, dy);
            if (r === 0) continue;
            const speed = table.circularSpeedAt(r);
            circular += speed * speed;
            along += speed * (dx * ny - dy * nx) / r;
        }
    }
    const projection = circular > 0 ? along / circular : 0;
    let squares = 0;
    for (let i = 0; i < count; i++) {
        const dx = p[i * 4] - cx, dy = p[i * 4 + 1] - cy, r = Math.hypot(dx, dy);
        if (r > 0) {
            const share = projection * table.circularSpeedAt(r) / r;
            v[i * 4] += dy * share; v[i * 4 + 1] -= dx * share;              // minus the tangent (-dy, dx)
        }
        squares += v[i * 4] * v[i * 4] + v[i * 4 + 1] * v[i * 4 + 1];
    }
    const noiseScale = squares > 0 ? dispersion / Math.sqrt(squares / (2 * count)) : 0;
    // E_rot = (M / 2) <v_t^2> = beta |U| with v_t = f v_circ.
    const rotationFactor = circular > 0 ? Math.sqrt(2 * rotationEnergy * count / (totalMass * circular)) : 0;
    for (let i = 0; i < count; i++) {
        const dx = p[i * 4] - cx, dy = p[i * 4 + 1] - cy;
        const r = Math.hypot(dx, dy);
        const speed = r > 0 ? rotationFactor * table.circularSpeedAt(r) / r : 0;     // counterclockwise: (-dy, dx) / r
        v[i * 4] = -dy * speed + noiseScale * v[i * 4];
        v[i * 4 + 1] = dx * speed + noiseScale * v[i * 4 + 1];
    }
    return { table, potentialEnergy, rotationEnergy, randomEnergy, rotationFactor, dispersion };
}
