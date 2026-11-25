// Pure helpers of the lab's conservation checks of the fusion of parcels of constant mass (proposal A4, docs/spikes/a4-constant-mass-fusion.md):
// the total momentum of a cloud read back from the GPU, in double precision, the scale it is judged against, and the changes of type
// between two read-backs. No GPU, no DOM (tested in tests/labConservation.test.ts).

/** Sums over the live particles of a cloud, double precision. */
export interface MomentumSums {
    /** Live particles (position w >= 0: a removed particle has w < 0). */
    live: number;
    /** Total mass, in the units of `massOf`. */
    mass: number;
    /** Total momentum, mass x px/s. */
    px: number;
    py: number;
    /** Sum of m |v|: what the momentum would be if every particle moved the same way. */
    absolute: number;
    /** Sum of m |v|^2. */
    doubleKinetic: number;
}

/**
 * The momentum of the first `count` particles of `positions` (x, y, type rank, w per texel: the type and the removal) and `velocities`
 * (vx, vy per texel), each weighing `massOf(type rank)`. A particle with a negative w is not live and weighs nothing.
 */
export function totalMomentum(positions: ArrayLike<number>, velocities: ArrayLike<number>, count: number,
                              massOf: (type: number) => number): MomentumSums {
    const sums: MomentumSums = { live: 0, mass: 0, px: 0, py: 0, absolute: 0, doubleKinetic: 0 };
    for (let i = 0; i < count; i++) {
        if (!(positions[i * 4 + 3] >= 0)) continue;
        const m = massOf(Math.round(positions[i * 4 + 2]));
        const vx = velocities[i * 4], vy = velocities[i * 4 + 1];
        sums.live++;
        sums.mass += m;
        sums.px += m * vx;
        sums.py += m * vy;
        sums.absolute += m * Math.hypot(vx, vy);
        sums.doubleKinetic += m * (vx * vx + vy * vy);
    }
    return sums;
}

/**
 * How much the momentum moved between two readings, as a fraction of two scales: the thermal momentum M sigma (sigma = sqrt(sum m |v|^2 / (2 M)), the
 * one-component speed of a gas at rest: the momentum a gas of this agitation would have if a fraction of its particles all moved the same way) and the
 * sum of m |v|. `reference` is the reading the scales are taken from (the first one).
 */
export function momentumChange(reference: MomentumSums, current: MomentumSums): { relativeThermal: number; relativeAbsolute: number; absolute: number } {
    const absolute = Math.hypot(current.px - reference.px, current.py - reference.py);
    const sigma = reference.mass > 0 ? Math.sqrt(reference.doubleKinetic / (2 * reference.mass)) : 0;
    return {
        absolute,
        relativeThermal: sigma > 0 ? absolute / (reference.mass * sigma) : NaN,
        relativeAbsolute: reference.absolute > 0 ? absolute / reference.absolute : NaN,
    };
}

/**
 * Particles that changed type between two read-backs of the same particles (`before` and `after`: x, y, type rank, w per texel), as a matrix:
 * `moved[from][to]`, `types` ranks each way. A particle live in one reading and not in the other is counted in `lost` (a removal, which the parcels
 * of constant mass no longer do).
 */
export function typeChanges(before: ArrayLike<number>, after: ArrayLike<number>, count: number, types: number):
    { moved: number[][]; lost: number } {
    const moved = Array.from({ length: types }, () => new Array<number>(types).fill(0));
    let lost = 0;
    const rank = (value: number): number => Math.min(types - 1, Math.max(0, Math.round(value)));
    for (let i = 0; i < count; i++) {
        const aliveBefore = before[i * 4 + 3] >= 0, aliveAfter = after[i * 4 + 3] >= 0;
        if (aliveBefore !== aliveAfter) { lost++; continue; }
        if (!aliveBefore) continue;
        const [from, to] = [rank(before[i * 4 + 2]), rank(after[i * 4 + 2])];
        if (from !== to) moved[from][to]++;
    }
    return { moved, lost };
}
