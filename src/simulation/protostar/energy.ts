// Energy bookkeeping of the protostar diagnostics: the virial ratio and the drift of the total
// energy since the start, from the kinetic and potential energies the GPU reduction reports
// (reduction.ts). Pure functions and a small state holder (tested).

import { PROTOSTAR_ENERGY_RATIO_FLOOR } from '../../config';

const finite = (...values: number[]): boolean => values.every(Number.isFinite);

/**
 * Virial ratio 2K / |U|: 1 for a system in virial equilibrium, below it for a cloud that falls in
 * (gravity wins), above for one that expands. Null when it means nothing: no potential (a gravity
 * of 0, an empty grid) or one so small next to the kinetic energy that the ratio only measures noise.
 */
export function virialRatio(kinetic: number, potential: number): number | null {
    if (!finite(kinetic, potential)) return null;
    const scale = Math.abs(kinetic) + Math.abs(potential);
    if (!(Math.abs(potential) > PROTOSTAR_ENERGY_RATIO_FLOOR * scale)) return null;
    return 2 * kinetic / Math.abs(potential);
}

/**
 * Change of the total energy since `initial`, as a fraction of its magnitude: (E - E0) / |E0|.
 * Negative when energy was lost. Null when the initial energy is 0 (or not a number): the cloud
 * starts exactly at the marginal state where "relative" has no scale.
 */
export function relativeDrift(total: number, initial: number): number | null {
    if (!finite(total, initial) || initial === 0) return null;
    return (total - initial) / Math.abs(initial);
}

/** What a stat shows for one energy reading. */
export interface EnergyStats {
    total: number;
    /** Fraction of the initial total energy; null until an initial energy is known. */
    drift: number | null;
    virial: number | null;
}

/**
 * Keeps the initial total energy of a run: the first usable reading after a restart (or after the
 * diagnostics were switched on). A reading is usable when it is finite and its total energy is not
 * negligible next to its parts (K + U near 0 is the marginal state: no relative scale to measure
 * a drift against; the next reading is tried).
 */
export class EnergyBalance {
    private initial: number | null = null;

    /** Forgets the initial energy: a restart. */
    reset(): void {
        this.initial = null;
    }

    get initialEnergy(): number | null {
        return this.initial;
    }

    /**
     * One reading; `work` is what no force did and the balance takes off (the work of the adaptive thickness, A11: total = K + U - W),
     * while the virial ratio stays 2K / |U|.
     */
    record(kinetic: number, potential: number, work = 0): EnergyStats | null {
        if (!finite(kinetic, potential, work)) return null;
        const total = kinetic + potential - work;
        if (this.initial === null) {
            const scale = Math.abs(kinetic) + Math.abs(potential);
            if (Math.abs(total) > PROTOSTAR_ENERGY_RATIO_FLOOR * scale) this.initial = total;
        }
        return {
            total,
            drift: this.initial === null ? null : relativeDrift(total, this.initial),
            virial: virialRatio(kinetic, potential),
        };
    }
}
