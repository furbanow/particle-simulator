// The granular physics of the sticky dust, as pure functions: the TypeScript twin of the formulas of
// velocity-sticky-dust.frag (the lab and the tests check the shader against it). Moments are those of the
// density grid: R the mass, G and B the momentum x MOMENTUM_SCALE, A the energy about a reference
// velocity, sum m |v - v_ref|^2 x ENERGY_SCALE.

import { CONTACT_RANGE, GLOW_AGITATION_RANGE, KINETIC_PRESSURE, MOMENTUM_SCALE, ENERGY_SCALE, type Range } from '../../config';

/** The four channels of a density texel. */
export interface Moments {
    mass: number;
    momentumX: number;
    momentumY: number;
    energy: number;
}

export interface MomentScales {
    momentum: number;
    energy: number;
}

export const DEFAULT_SCALES: MomentScales = { momentum: MOMENTUM_SCALE, energy: ENERGY_SCALE };

/** Below this mass (per texel) the moments carry no information: there is no mean flow and no agitation. */
export const EMPTY_TEXEL_MASS = 1e-4;

export const smoothstep = (lo: number, hi: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};

/** Mean velocity of a texel (the particle's own velocity when it is empty is the caller's choice: here zero). */
export function meanFlow(m: Moments, scales: MomentScales = DEFAULT_SCALES): [number, number] {
    if (!(m.mass > EMPTY_TEXEL_MASS)) return [0, 0];
    return [m.momentumX / (m.mass * scales.momentum), m.momentumY / (m.mass * scales.momentum)];
}

/**
 * rho T of a texel, T = <|v|^2> - |u|^2 the agitation (px^2/s^2): the energy about the reference, minus
 * the energy of the mean flow about it. The reference only keeps the two terms close to each other (both are
 * the size of the agitation, not of the speed), which is what the half floats of the grid need. At least 0.
 */
export function peculiarEnergy(m: Moments, reference: readonly [number, number], scales: MomentScales = DEFAULT_SCALES): number {
    if (!(m.mass > EMPTY_TEXEL_MASS)) return 0;
    const rx = m.momentumX / scales.momentum - m.mass * reference[0];
    const ry = m.momentumY / scales.momentum - m.mass * reference[1];
    return Math.max(m.energy / scales.energy - (rx * rx + ry * ry) / m.mass, 0);
}

/** The agitation T of a texel (px^2/s^2); 0 when it is empty. */
export function agitation(m: Moments, reference: readonly [number, number], scales: MomentScales = DEFAULT_SCALES): number {
    return m.mass > EMPTY_TEXEL_MASS ? peculiarEnergy(m, reference, scales) / m.mass : 0;
}

/** Haff's sticking frequency nu = rate x rho x sqrt(T), in 1/s. */
export const stickingFrequency = (rate: number, rho: number, temperature: number): number => rate * rho * Math.sqrt(Math.max(temperature, 0));

/** Share of the sticking that survives the bounce barrier: all of it below half the collision speed, none at it and above. */
export const stickingShare = (relativeSpeed: number, collisionSpeed: number): number =>
    1 - smoothstep(0.5 * collisionSpeed, collisionSpeed, relativeSpeed);

/** The velocity after a substep of sticking: the part of the velocity relative to the mean flow decays at `frequency`. */
export function relax(v: readonly [number, number], mean: readonly [number, number], share: number, frequency: number, dt: number): [number, number] {
    const k = share * (1 - Math.exp(-frequency * dt));
    return [v[0] + (mean[0] - v[0]) * k, v[1] + (mean[1] - v[1]) * k];
}

/** 0 for loose grains, 1 for grains in contact: the pressure acts only between the two densities. */
export function contactShare(rho: number, restDensity: number, range: Range = CONTACT_RANGE): number {
    return smoothstep(range[0] * restDensity, range[1] * restDensity, rho);
}

/** Largest agitation the pressure feels: the sound speed sqrt(T / 2) may cross `cfl` texels (of `texel` px) per substep `dt`. */
export const pressureAgitationLimit = (cfl: number, texel: number, dt: number): number => 2 * (cfl * texel / dt) ** 2;

/**
 * Kinetic pressure of a texel, P = rho T / 2 for grains in contact, the agitation capped at `maxAgitation`. The
 * pressure's push on a particle is -grad(P) / rho, where the grid's difference across two texels of `texel` px is the gradient.
 */
export function kineticPressure(m: Moments, reference: readonly [number, number], restDensity: number, maxAgitation: number,
                                scales: MomentScales = DEFAULT_SCALES, gain: number = KINETIC_PRESSURE): number {
    const rhoT = Math.min(peculiarEnergy(m, reference, scales), m.mass * maxAgitation);
    return 0.5 * gain * contactShare(m.mass, restDensity) * rhoT;
}

/** The glow (0..1) of a particle in a texel of agitation T. */
export function agitationGlow(temperature: number, range: Range = GLOW_AGITATION_RANGE): number {
    return smoothstep(range[0], range[1], Math.sqrt(Math.max(temperature, 0)));
}
