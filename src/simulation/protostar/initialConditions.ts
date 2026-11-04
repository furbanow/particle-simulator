// Initial state of the protostar algorithm: a uniform disk of gas with a slight rotation (a
// fraction of the circular speed) and a random thermal agitation. Pure functions (tested).

import type { InitialState } from '../gpuModel';

export interface CloudOptions {
    /** Cloud radius, px. */
    radius: number;
    /** Effective gravitational constant (px^3 / (mass s^2)) and total mass of the cloud. */
    gravity: number;
    totalMass: number;
    /** Softening length epsilon, px. */
    softening: number;
    /** Tangential speed, as a fraction of the circular speed v_circ(r). */
    rotation: number;
    /** Thermal agitation: standard deviation of each velocity component, as a fraction of v_circ(R). */
    agitation: number;
}

/**
 * Mass enclosed within each particle's radius, as a fraction of the total: (rank + 1/2) / count.
 * The types are drawn independently of the radius, so every particle stands for the mean mass.
 */
export function enclosedMassFractions(radii: ArrayLike<number>): Float64Array {
    const n = radii.length;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => radii[a] - radii[b]);
    const fractions = new Float64Array(n);
    order.forEach((i, rank) => { fractions[i] = (rank + 0.5) / n; });
    return fractions;
}

/**
 * Softened pull toward the center of a mass `enclosed` at radius r: G M r / (r^2 + eps^2)^(3/2),
 * the softened force law of a point mass (exact for the enclosed mass seen as one point).
 */
export const softenedPull = (gravity: number, enclosed: number, r: number, softening: number): number =>
    gravity * enclosed * r / (r * r + softening * softening) ** 1.5;

/**
 * Circular speed at radius r around the enclosed mass: v^2 / r = pull. Far from the softening
 * length it is sqrt(G M_enc(r) / r); it goes to 0 at the center instead of diverging.
 */
export const circularSpeed = (gravity: number, enclosed: number, r: number, softening: number): number =>
    Math.sqrt(softenedPull(gravity, enclosed, r, softening) * r);

/** A standard normal variate (Box-Muller). */
function gaussian(random: () => number): number {
    const u = Math.max(random(), Number.MIN_VALUE);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * Fills the positions (x, y, type, 1) and velocities (vx, vy, 0, 0) of a rotating cloud centered
 * on the area. Returns the initial gravitational accelerations (ax, ay per particle, 4 floats a
 * texel like the state textures), estimated from the enclosed mass, for the Verlet integrator.
 * The net momentum of the agitation is removed, so the cloud does not drift.
 */
export function fillCloud(state: InitialState, options: CloudOptions, random: () => number = Math.random): Float32Array {
    const { positions: p, velocities: v, count, typeCounts, width, height } = state;
    const { radius, gravity, totalMass, softening, rotation, agitation } = options;
    const cx = width / 2, cy = height / 2;
    const radii = new Float64Array(count);
    const angles = new Float64Array(count);
    let type = 0, blockEnd = typeCounts[0] ?? count;
    for (let i = 0; i < count; i++) {
        while (i >= blockEnd && type < typeCounts.length - 1) blockEnd += typeCounts[++type];
        radii[i] = radius * Math.sqrt(random());                   // uniform in area
        angles[i] = random() * Math.PI * 2;
        p[i * 4] = cx + Math.cos(angles[i]) * radii[i];
        p[i * 4 + 1] = cy + Math.sin(angles[i]) * radii[i];
        p[i * 4 + 2] = type;
        p[i * 4 + 3] = 1;
    }

    const enclosed = enclosedMassFractions(radii);
    const sigma = agitation * circularSpeed(gravity, totalMass, radius, softening);
    const accel = new Float32Array(count * 4);
    let meanX = 0, meanY = 0;
    for (let i = 0; i < count; i++) {
        const r = radii[i], m = enclosed[i] * totalMass;
        const c = Math.cos(angles[i]), s = Math.sin(angles[i]);
        const vt = rotation * circularSpeed(gravity, m, r, softening);
        const nx = sigma * gaussian(random), ny = sigma * gaussian(random);
        meanX += nx; meanY += ny;
        v[i * 4] = -s * vt + nx;                                    // counterclockwise
        v[i * 4 + 1] = c * vt + ny;
        const pull = softenedPull(gravity, m, r, softening);
        accel[i * 4] = -c * pull;
        accel[i * 4 + 1] = -s * pull;
    }
    if (count > 0) {
        meanX /= count; meanY /= count;
        for (let i = 0; i < count; i++) { v[i * 4] -= meanX; v[i * 4 + 1] -= meanY; }
    }
    return accel;
}
