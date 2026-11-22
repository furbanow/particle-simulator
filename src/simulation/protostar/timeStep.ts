// The adaptive time step of the protostar (phase B5). Pure (tested): the criterion, the number of substeps it gives and
// the controller that keeps that number from flickering. The model feeds it the maxima of the GPU reduction (reduction.ts)
// and Simulation.step() runs the substeps it asks for.
//
// What changes is the NUMBER of substeps of a frame, never the simulated time of the frame (BASE_DT x the speed slider):
// the substep is frameTime / count, constant within a frame, and changes between two frames only. The integration takes
// that into account (leapfrog.ts: the half kicks over the previous substep's length).
//
// The criterion is the accuracy of the dense core, not the energy of the whole cloud (which no longer depends on the step,
// docs/spikes/p5a-integrator-order.md). A particle in the core oscillates at omega, with omega^2 about a / r, and the
// velocity Verlet scheme needs omega dt well under 1 (0.1 to 0.2 in practice); r can be no smaller than the softening
// epsilon (or the grid's cell, which smooths the force the same way), so omega^2 <= a / epsilon and
//
//     dt_acceleration = OMEGA sqrt(epsilon / |a|max).
//
// The speed bound keeps the gas from crossing more than a fraction of a grid cell per substep, which is what the grids'
// deposit and gathering (the temperature, the fusion rate, the force) resolve:
//
//     dt_speed = COURANT cell / |v|max.
//
// The maxima are the reduction's proxies (reduction.ts) and arrive late (an asynchronous read, a few frames old): OMEGA
// carries a safety factor for the growth of the core in that time, and the controller adds a step at once but gives one
// up only when the lower count has room to spare.

/** What the criterion needs to know of the run. */
export interface StepCriterion {
    /** Cell of the grids, px. */
    cell: number;
    /** Plummer softening of the gravity, px. */
    softening: number;
    /** Cells the fastest gas may cross in one substep. */
    courant: number;
    /** Target of omega dt in the core (with its safety margin). */
    omega: number;
}

/**
 * The longest substep, in seconds, that keeps the criterion for the given maxima (px/s and px/s^2); Infinity when they
 * ask for nothing (a maximum of 0: nothing moves, or no mass is there). The softening is taken as no less than a cell: the
 * grid's own smoothing of the force is of that size.
 */
export function criticalStep(maxSpeed: number, maxAcceleration: number, criterion: StepCriterion): number {
    const length = Math.max(criterion.softening, criterion.cell);
    const bySpeed = maxSpeed > 0 ? criterion.courant * criterion.cell / maxSpeed : Infinity;
    const byAcceleration = maxAcceleration > 0 ? criterion.omega * Math.sqrt(length / maxAcceleration) : Infinity;
    return Math.min(bySpeed, byAcceleration);
}

/** Substeps of a frame of `frameTime` seconds that keep every substep within `dtCritical`, in [1, max]. */
export function substepsFor(frameTime: number, dtCritical: number, max: number): number {
    if (!(frameTime > 0)) return 1;
    // A ratio a rounding error above an integer is that integer: ceil(2.0000000001) must not ask for a third substep.
    const needed = dtCritical > 0 ? Math.ceil(frameTime / dtCritical - 1e-9) : max;
    return Math.min(Math.max(needed, 1), Math.max(max, 1));
}

/** The fewest and the most substeps a frame may run. */
export interface SubstepBounds {
    min: number;
    max: number;
}

/**
 * The bounds of the count: `minRatio` times the fixed count of the speed (rounded up, at least 1: 1 never runs a coarser substep than
 * the fixed step does, which keeps the accuracy of the fixed step everywhere and refines where the core needs it) and `maxRatio` times
 * it (so that the work of a frame stays within that ratio of what the fixed count costs and of what the GPU benchmark measured). The
 * bounds stay on either side of the fixed count itself, and the top is within `absolute` unless the fixed count is above it.
 */
export function substepBounds(fixed: number, minRatio: number, maxRatio: number, absolute: number): SubstepBounds {
    return {
        min: Math.max(1, Math.min(fixed, Math.ceil(minRatio * fixed - 1e-9))),
        max: Math.max(fixed, Math.min(absolute, Math.ceil(maxRatio * fixed - 1e-9))),
    };
}

const clamp = (value: number, { min, max }: SubstepBounds): number => Math.min(Math.max(value, min), max);

/**
 * Keeps the substep count of consecutive frames from flickering. It goes up at once to what the criterion asks (a collapse
 * must not outrun the readings), and comes down one count at a time, and only when the lower count keeps `release`
 * (a fraction below 1) of the critical step: a criterion hovering around a count's limit does not toggle the count
 * every frame, and the step changes by one count at most when it grows.
 */
export class SubstepController {
    private count: number | null = null;

    constructor(private readonly release: number) {}

    /** Forgets the count (a restart, or the flag switched off): the next frame starts from the fixed count. */
    reset(): void {
        this.count = null;
    }

    /**
     * The count for the next frame. `dtCritical` is null while no reading is there (the fixed count is used); `fixed` is the
     * count the speed slider alone would give; `bounds` come from substepBounds().
     */
    next(frameTime: number, dtCritical: number | null, fixed: number, bounds: SubstepBounds): number {
        const current = clamp(this.count ?? fixed, bounds);
        if (dtCritical === null) return this.count = current;
        const wanted = clamp(substepsFor(frameTime, dtCritical, bounds.max), bounds);
        if (wanted >= current) return this.count = wanted;
        // Down by one (never under the minimum: wanted is within the bounds), and only with room to spare.
        const lower = current - 1;
        return this.count = frameTime / lower <= this.release * dtCritical ? lower : current;
    }
}
