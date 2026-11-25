// The multichannel GPU reduction of the protostar grids (shaders/protostar-reduce.frag) and how to
// read its result. Pure (tested): the layout, and the conversion of the raw sums, which are in the
// grids' units (deposit units, v / L), into the simulation's.
//
// One reduction, one asynchronous read-back, every number the stats and the later phases need.
// The final target is REDUCTION_TEXELS x 1 RGBA32F (REDUCTION_FLOATS floats once read):
//
//   texel 0  CORE      (max rho / rho0, T / T0 of the densest cell, sum of the fusions per s, sum of the mass)
//   texel 1  EXTREMES  (x, y of the densest cell in px, speed bound in px/s, acceleration bound in px/s^2)
//   texel 2  ENERGY    (sum m |v/L|^2, U of the grids just drawn, smallest softening px, U one substep earlier)
//   texel 3  MOMENTS   (sum M x, sum M y, sum m v_x / L, sum m v_y / L)
//   texel 4  NESTED_CORE      (max rho / rho0 of the fine level, T / T0 there, mass inside the box, 1 while the box is on)
//   texel 5  NESTED_EXTREMES  (x, y of the fine level's densest cell px, its speed bound, its acceleration bound: the whole force)
//   texel 6  NESTED_ENERGY    (delta U of the grids just drawn, the fine level's smallest softening px, delta U one substep earlier, 0)
//
// The last three are the nested grid's (C2, nestedBox.ts), all zero while the box is off. Inside the box the particles feel the fine level:
// the potential energy gains delta U = 1/2 sum m (phi_fine - phi_main) over the mass inside, with its self-interaction at the fine softening
// instead of the main one, and the maxima of the stats and of the adaptive step are the larger of the two levels'.
//
// All the sums are over the 128 x 128 cells of the grids, in deposit units (the mean particle
// mass is 1) with the cloud-in-cell weights, so the particle sums are exact up to the footprints
// clipped at the edge of the grid. The CORE texel keeps the layout the stats always had
// ((rho, T, rate) first, now with the mass where a constant 1 was). What the numbers are:
//
//  - densest cell: the first one with the highest gas density rho (3 x 3 neighborhood), its
//    temperature (the velocity dispersion there) and its center. The "core".
//  - speed bound: max over the cells holding mass of |mean velocity| + sqrt(T), with the mean
//    velocity and T of the cell's 3 x 3 neighborhood. A proxy for the fastest particles: it
//    follows bulk flow and thermal spread, and misses the far tail of a distribution and any
//    particle faster than its neighborhood's mean by more than one dispersion.
//  - acceleration bound: max over the cells holding mass of |a| of the gravity grid (the force
//    on a particle is the bilinear interpolation of four cells, so it never exceeds the grid's
//    maximum); the drawings' force is not in it.
//  - center of mass and momentum: from the first moments of the deposit. The cloud-in-cell weights
//    reproduce a particle's position exactly, so these are the particles' own sums, not a grid
//    approximation (apart from the clipped footprints).
//  - kinetic energy: 1/2 sum m v^2 of the velocity texture as it is when the grids are drawn.
//  - potential energy: U = 1/2 sum M phi with the Plummer potential of the gravity grid, minus the
//    interaction of every particle with itself, taken off on the GPU cell by cell (see unpackReduction).
//  - smallest softening: the least softening (px) of a cell holding mass, the fixed epsilon or, with the adaptive thickness (A11),
//    the thinnest layer: what the adaptive time step takes for its length (REDUCTION_NO_THICKNESS when no cell holds mass).

import type { Vec2 } from '../../util/math';

export const REDUCTION_TEXEL = { core: 0, extremes: 1, energy: 2, moments: 3, nestedCore: 4, nestedExtremes: 5, nestedEnergy: 6 } as const;
export const REDUCTION_TEXELS = 7;
export const REDUCTION_FLOATS = REDUCTION_TEXELS * 4;
/** The smallest softening the reduction writes when no cell holds mass (exact in float32; NO_THICKNESS of protostar-reduce.frag). */
export const REDUCTION_NO_THICKNESS = 2 ** 100;

/** What it takes to turn the raw sums into simulation units; set by the model every substep. */
export interface ReductionScales {
    /** Simulation mass of one deposit unit (the mean particle mass). */
    massPerDeposit: number;
    /** Deposit units per px/s (the deposit stores v / L, so 1 / L). */
    depositVelScale: number;
    /** G_eff x simulation mass of one deposit unit, px^3/s^2 per deposit unit. */
    gravityPerDeposit: number;
    /** Softening length epsilon, px (the fixed one: the adaptive thickness's are in the grids). */
    softening: number;
}

/** Energies in simulation units (mass x px^2/s^2; divide by the total mass for a specific energy). */
export interface EnergyReading {
    kinetic: number;
    /**
     * Potential energy of the positions that go with `kinetic` (the previous substep's: the velocity
     * the deposit reads is that of the step before the positions), self-interaction removed.
     * Null when the model did not keep the previous substep's potential (diagnostics off).
     */
    potential: number | null;
    /**
     * Potential energy of the positions the grids were just drawn from, one substep after the
     * velocities. kinetic + potentialNow is the unsynchronized sum: it oscillates by about
     * dt |dU/dt|, which is the lag this reading avoids; kept to measure that lag.
     */
    potentialNow: number;
}

/** The fine level of the nested grid (C2) in a reduction, while its box is on. */
export interface NestedReduction {
    /** The fine level's peak density, rho0. */
    peakDensity: number;
    /** Its temperature, T0. */
    peakTemperature: number;
    /** Center of its densest cell, px. */
    peak: Vec2;
    /** The mass deposited on the fine level (inside the box), simulation units. */
    mass: number;
    maxSpeed: number;
    /** The largest whole force over its cells holding mass, px/s^2. */
    maxAcceleration: number;
    /** Its softening, px. */
    softening: number;
}

export interface Reduction {
    /** Peak gas density, in the initial mean density rho0 (the larger of the two levels' with the nested grid on). */
    peakDensity: number;
    /** Temperature of the densest cell, in T0. */
    peakTemperature: number;
    /** Expected fusions per second in the whole cloud. */
    fusionRate: number;
    /** Deposited mass, simulation units (the cloud's mass, less the clipped footprints and the removed particles). */
    mass: number;
    /** Center of the densest cell, px. */
    peak: Vec2;
    /** Proxy of the fastest particles' speed, px/s (see the file header). */
    maxSpeed: number;
    /** Largest gravitational acceleration of the grid over the cells holding mass, px/s^2. */
    maxAcceleration: number;
    /** Center of mass, px; null when nothing is deposited. */
    centerOfMass: Vec2 | null;
    /** Total momentum, mass x px/s. */
    momentum: Vec2;
    /** The smallest softening of a cell holding mass, px (the fixed epsilon, or the thinnest layer with A11); null when nothing is deposited. */
    minSoftening: number | null;
    energy: EnergyReading;
    /** The main grid's own peak density, rho0 (the nested box's switch compares it from one reading to the next). */
    mainPeakDensity: number;
    /** The main grid's densest cell, px. */
    mainPeak: Vec2;
    /** The fine level of the nested grid (C2), null while its box is off. */
    nested: NestedReduction | null;
}

/** Plummer self-interaction of one deposit: -G m^2 / epsilon, per unit of m^2 (deposit units, before the 1/2). */
export const selfPotentialPerMassSquared = (gravityPerDeposit: number, softening: number): number =>
    softening > 0 ? -gravityPerDeposit / softening : 0;

/**
 * Unpacks the REDUCTION_FLOATS floats read back. `synchronized`: the previous substep's potential
 * was kept (the model ran the potential pass before drawing the grids).
 *
 * Self-interaction. The potential energy of the pairs is U = 1/2 sum_{i != j} m_i m_j K(r_ij) with
 * K the Plummer kernel -G / sqrt(r^2 + epsilon^2). The grid computes 1/2 sum_cells M phi, and phi
 * of a cell includes the cell's own mass at distance 0 (-G M / epsilon; the force does not feel
 * it, r = 0 gives no pull), so every particle is also counted against itself. Through the
 * cloud-in-cell spread that self term is the particle's own mass on its four cells, at distances
 * from 0 to a cell: -G m^2 / epsilon for a particle at the center of a cell, 0.84 times that at a
 * corner when a cell is two thirds of epsilon (the default softening on the 128-cell grid). The
 * deposit holds sum m^2 per cell, so the reductions (protostar-reduce.frag, protostar-potential.frag) add
 * G (sum m^2)_c / (2 h_c) cell by cell, h_c the softening of the cell (epsilon, or its thickness with the adaptive
 * thickness: its pairs with itself are softened by h_c): the values unpacked here are corrected already. That is exact for particles at cell
 * centers and overcorrects by less than 10 % of itself on average, itself about R / (N epsilon)
 * of |U| for N particles in a cloud of radius R: 6e-5 at 400 000 particles, 5e-3 at 5 000.
 * (Two particles of the same cell are treated as being at distance 0 by the grid, whatever their
 * true separation: the grid's resolution, not a bias to correct.)
 */
export function unpackReduction(texels: ArrayLike<number>, scales: ReductionScales, synchronized: boolean): Reduction {
    const at = (texel: number, channel: number): number => texels[texel * 4 + channel];
    const { core, extremes, energy, moments } = REDUCTION_TEXEL;
    const { massPerDeposit: massUnit, depositVelScale: velocityScale } = scales;
    const depositMass = at(core, 3);
    const minSoftening = at(energy, 2);
    const { nestedCore, nestedExtremes, nestedEnergy } = REDUCTION_TEXEL;
    const nested: NestedReduction | null = at(nestedCore, 3) > 0.5 ? {
        peakDensity: at(nestedCore, 0), peakTemperature: at(nestedCore, 1), mass: at(nestedCore, 2) * massUnit,
        peak: { x: at(nestedExtremes, 0), y: at(nestedExtremes, 1) }, maxSpeed: at(nestedExtremes, 2), maxAcceleration: at(nestedExtremes, 3),
        softening: at(nestedEnergy, 1),
    } : null;
    // The fine level is the finer view of the core: it gives the peak when it holds the denser cell, and its maxima count.
    const fineFirst = nested !== null && nested.peakDensity > at(core, 0);
    const mainPeak = { x: at(extremes, 0), y: at(extremes, 1) };
    const mainSoftening = depositMass > 0 && minSoftening < REDUCTION_NO_THICKNESS ? minSoftening : null;
    const gain = nested ? at(nestedEnergy, 0) : 0, gainBefore = nested ? at(nestedEnergy, 2) : 0;
    return {
        peakDensity: fineFirst ? nested.peakDensity : at(core, 0),
        peakTemperature: fineFirst ? nested.peakTemperature : at(core, 1),
        fusionRate: at(core, 2),
        mass: depositMass * massUnit,
        peak: fineFirst ? { ...nested.peak } : mainPeak,
        maxSpeed: Math.max(at(extremes, 2), nested?.maxSpeed ?? 0),
        maxAcceleration: Math.max(at(extremes, 3), nested?.maxAcceleration ?? 0),
        centerOfMass: depositMass > 0 ? { x: at(moments, 0) / depositMass, y: at(moments, 1) / depositMass } : null,
        momentum: { x: at(moments, 2) / velocityScale * massUnit, y: at(moments, 3) / velocityScale * massUnit },
        minSoftening: nested && mainSoftening !== null ? Math.min(mainSoftening, nested.softening) : mainSoftening,
        energy: {
            kinetic: 0.5 * at(energy, 0) / (velocityScale * velocityScale) * massUnit,
            potential: synchronized ? (at(energy, 3) + gainBefore) * massUnit : null,
            potentialNow: (at(energy, 1) + gain) * massUnit,
        },
        mainPeakDensity: at(core, 0),
        mainPeak,
        nested,
    };
}
