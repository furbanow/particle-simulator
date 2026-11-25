// CPU references for the initial conditions of the protostar (phase P5b, docs/spikes/a8-initial-conditions.md): the analytic
// collapse of the cold Maclaurin disc, profiles of a field about the cloud's center, and the energies of a cloud measured on its
// particles. Pure (tested in tests/labInitial.test.ts): no GPU, no DOM.

/**
 * Free-fall time of the cold Maclaurin disc without softening, t_ff = (pi / 2) sqrt(2 R^3 / (3 pi G M)): the pull of the disc is
 * linear, g = (3 pi / 4) G M r / R^3, so that it falls in homologously and its radius a(t) obeys a'' = -(3 pi / 4) G M / a^2,
 * the radial fall onto a point of mass 3 pi M / 4 from rest at R. `gm` is G M (px^3 / s^2).
 */
export const maclaurinFreeFallTime = (gm: number, radius: number): number =>
    Math.PI / 2 * Math.sqrt(2 * radius ** 3 / (3 * Math.PI * gm));

/** The share of t_ff at which the disc has fallen to the fraction x of its radius (1 at rest, 0 when the disc reaches the center). */
export const maclaurinFallShare = (x: number): number => {
    const u = Math.min(Math.max(x, 0), 1);
    return 2 / Math.PI * (Math.acos(Math.sqrt(u)) + Math.sqrt(u * (1 - u)));
};

/** The fraction of its initial radius the cold Maclaurin disc has at the share `share` of t_ff (the inverse of `maclaurinFallShare`, by bisection). */
export function maclaurinRadiusAt(share: number): number {
    if (share <= 0) return 1;
    if (share >= 1) return 0;
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (maclaurinFallShare(mid) > share) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * The first time a series falls to `level`, by linear interpolation between the two readings it falls between (NaN if it never does);
 * `times` increasing, `values` the series (the half-mass radius of a collapsing cloud).
 */
export function crossingTime(times: readonly number[], values: readonly number[], level: number): number {
    for (let k = 1; k < times.length; k++) {
        if (values[k - 1] > level && values[k] <= level) {
            return times[k - 1] + (times[k] - times[k - 1]) * (values[k - 1] - level) / (values[k - 1] - values[k]);
        }
    }
    return NaN;
}

/**
 * The softening length (between `lo` and `hi`, by golden-section search on its logarithm) at which a table's pull best matches a measured one:
 * `pulls[b]` the inward pull measured at radius `radii[b]`, `pullAt(softening)(r)` the table's. The error is the rms of the relative differences.
 * What a grid's own smoothing amounts to, as a Plummer length.
 */
export function fitSoftening(radii: readonly number[], pulls: readonly number[], pullAt: (softening: number) => (r: number) => number,
                             lo: number, hi: number): { softening: number; rmsError: number } {
    const error = (softening: number): number => {
        const table = pullAt(softening);
        return Math.sqrt(radii.reduce((sum, r, b) => sum + (pulls[b] / table(r) - 1) ** 2, 0) / radii.length);
    };
    const golden = (Math.sqrt(5) - 1) / 2;
    let a = Math.log(lo), b = Math.log(hi);
    let c = b - golden * (b - a), d = a + golden * (b - a);
    let fc = error(Math.exp(c)), fd = error(Math.exp(d));
    for (let i = 0; i < 40; i++) {
        if (fc < fd) { b = d; d = c; fd = fc; c = b - golden * (b - a); fc = error(Math.exp(c)); }
        else { a = c; c = d; fc = fd; d = a + golden * (b - a); fd = error(Math.exp(d)); }
    }
    const best = Math.exp((a + b) / 2);
    return { softening: best, rmsError: error(best) };
}

/** The radius that holds the half of `count` points about `center` (their median distance to it). */
export function halfMassRadius(positions: ArrayLike<number>, count: number, center: { x: number; y: number }): number {
    const radii = new Float64Array(count);
    for (let i = 0; i < count; i++) radii[i] = Math.hypot(positions[i * 4] - center.x, positions[i * 4 + 1] - center.y);
    radii.sort();
    return count % 2 ? radii[(count - 1) / 2] : (radii[count / 2 - 1] + radii[count / 2]) / 2;
}

/** The centre of mass of `count` equal points (x, y of the state texels). */
export function meanPosition(positions: ArrayLike<number>, count: number): { x: number; y: number } {
    let x = 0, y = 0;
    for (let i = 0; i < count; i++) { x += positions[i * 4]; y += positions[i * 4 + 1]; }
    return { x: x / count, y: y / count };
}

export interface RadialBin {
    /** Mean radius of the points of the bin. */
    radius: number;
    /** Mean of the field's component along the radius (outward) and across it (counterclockwise). */
    radial: number;
    tangential: number;
    count: number;
}

/**
 * The profile of a vector field (two channels of an RGBA texture, from `first`) about `center`: the points sorted by radius and cut
 * into `bins` groups of as many points each.
 */
export function radialProfile(positions: ArrayLike<number>, field: ArrayLike<number>, count: number, center: { x: number; y: number },
                              bins: number, first = 0): RadialBin[] {
    const radii = new Float64Array(count), radial = new Float64Array(count), tangential = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        const dx = positions[i * 4] - center.x, dy = positions[i * 4 + 1] - center.y, r = Math.hypot(dx, dy) || 1e-9;
        const fx = field[i * 4 + first], fy = field[i * 4 + first + 1];
        radii[i] = r;
        radial[i] = (dx * fx + dy * fy) / r;
        tangential[i] = (dx * fy - dy * fx) / r;
    }
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => radii[a] - radii[b]);
    const perBin = Math.floor(count / bins);
    const result: RadialBin[] = [];
    for (let b = 0; b < bins; b++) {
        const members = order.slice(b * perBin, (b + 1) * perBin);
        const mean = (values: Float64Array): number => members.reduce((s, i) => s + values[i], 0) / members.length;
        result.push({ radius: mean(radii), radial: mean(radial), tangential: mean(tangential), count: members.length });
    }
    return result;
}

export interface MeasuredEnergies {
    /** (1/2) sum m |v|^2 over the particles, every particle weighing totalMass / count. */
    kinetic: number;
    /**
     * The energy of the mean rotation: the tangential speed averaged over rings of `bins` equal groups of particles, squared. It counts the
     * agitation's own mean over each ring (a few percent of it for white noise, more for a handful of large eddies).
     */
    rotationRings: number;
    /**
     * The energy of the rotation along the pattern the cloud was given, (1/2) (sum m v_t c)^2 / sum m c^2 with c the circular speed
     * `pattern(r)`: what the sliders set (the agitation has no part of it).
     */
    rotationPattern: number;
}

/** The energies of a cloud measured on its particles (state texels). */
export function measureEnergies(positions: ArrayLike<number>, velocities: ArrayLike<number>, count: number, center: { x: number; y: number },
                                totalMass: number, bins: number, pattern: (r: number) => number): MeasuredEnergies {
    const mass = totalMass / count;
    let kinetic = 0, along = 0, norm = 0;
    for (let i = 0; i < count; i++) {
        const vx = velocities[i * 4], vy = velocities[i * 4 + 1];
        kinetic += 0.5 * mass * (vx * vx + vy * vy);
        const dx = positions[i * 4] - center.x, dy = positions[i * 4 + 1] - center.y, r = Math.hypot(dx, dy);
        if (r === 0) continue;
        const c = pattern(r);
        along += c * (dx * vy - dy * vx) / r;
        norm += c * c;
    }
    const rings = radialProfile(positions, velocities, count, center, bins);
    const rotationRings = rings.reduce((sum, ring) => sum + 0.5 * mass * ring.count * ring.tangential * ring.tangential, 0);
    return { kinetic, rotationRings, rotationPattern: norm > 0 ? 0.5 * mass * along * along / norm : 0 };
}
