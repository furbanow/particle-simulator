// Toomre's stability parameter of the protostar's initial disc, from the velocity field it is given: the mean rotation and the
// agitation. Q = kappa sigma / (3.36 G Sigma) with the criterion of a stellar (collisionless) disc, 3.36, not the gas's pi (which
// would read 7 % higher): a disc with Q below about 1 is unstable to rings and clumps, one well above it is smooth. kappa is the
// epicyclic frequency, kappa^2 = (1/r^3) d(r^2 v^2) / dr for a rotation v(r), sigma the dispersion of the radial velocity, Sigma
// the surface density. Pure functions (tested); a figure for the lab and the docs, not a UI readout.

export const STELLAR_TOOMRE = 3.36;

/** Toomre's Q at one radius. */
export const toomreQ = (kappa: number, sigma: number, surface: number, gravity: number): number =>
    surface > 0 ? kappa * sigma / (STELLAR_TOOMRE * gravity * surface) : Infinity;

/** The epicyclic frequency kappa at radius r of a rotation `speed`(r): kappa^2 = (1/r^3) d(r^2 v^2)/dr, by a central difference of relative step `step`. */
export function epicyclicFrequency(speed: (r: number) => number, r: number, step = 1e-4): number {
    const h = r * step;
    const angular = (x: number): number => x * x * speed(x) ** 2;
    return Math.sqrt(Math.max((angular(r + h) - angular(r - h)) / (2 * h * r ** 3), 0));
}

export interface ToomrePoint {
    /** Radius, px. */
    radius: number;
    /** Mean tangential speed, px/s (counterclockwise positive). */
    rotation: number;
    /** Dispersion of the radial velocity, px/s. */
    sigma: number;
    /** Surface density, mass / px^2. */
    surface: number;
    /** Epicyclic frequency, 1/s. */
    kappa: number;
    q: number;
}

/**
 * Toomre's Q of a cloud as it is drawn: the particles (state texels: x, y, ... and vx, vy, ...) are cut into `bins` rings of as many
 * particles each, and the rotation, the radial dispersion and the surface density of each ring give kappa (from the rotation
 * of the neighbouring rings: the finite difference over two rings on each side) and Q. The first and last two rings have no kappa.
 */
export function measureToomre(positions: ArrayLike<number>, velocities: ArrayLike<number>, count: number, center: { x: number; y: number },
                              totalMass: number, gravity: number, bins = 40): ToomrePoint[] {
    const radii = new Float64Array(count), radial = new Float64Array(count), tangential = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        const dx = positions[i * 4] - center.x, dy = positions[i * 4 + 1] - center.y, r = Math.hypot(dx, dy) || 1e-9;
        radii[i] = r;
        radial[i] = (dx * velocities[i * 4] + dy * velocities[i * 4 + 1]) / r;
        tangential[i] = (dx * velocities[i * 4 + 1] - dy * velocities[i * 4]) / r;
    }
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => radii[a] - radii[b]);
    const perBin = Math.floor(count / bins);
    const rings: Omit<ToomrePoint, 'kappa' | 'q'>[] = [];
    let inner = 0;
    for (let b = 0; b < bins; b++) {
        const members = order.slice(b * perBin, (b + 1) * perBin);
        const mean = (values: Float64Array): number => members.reduce((s, i) => s + values[i], 0) / members.length;
        const meanRadial = mean(radial);
        const sigma = Math.sqrt(members.reduce((s, i) => s + (radial[i] - meanRadial) ** 2, 0) / members.length);
        const outer = b === bins - 1 ? radii[members[members.length - 1]] : radii[order[(b + 1) * perBin]];
        const area = Math.PI * (outer * outer - inner * inner);
        rings.push({ radius: mean(radii), rotation: mean(tangential), sigma, surface: members.length * (totalMass / count) / area });
        inner = outer;
    }
    return rings.map((ring, b) => {
        const lo = rings[b - 2], hi = rings[b + 2];
        if (!lo || !hi) return { ...ring, kappa: NaN, q: NaN };
        const angular = (p: typeof ring): number => p.radius ** 2 * p.rotation ** 2;
        const kappa = Math.sqrt(Math.max((angular(hi) - angular(lo)) / (hi.radius - lo.radius) / ring.radius ** 3, 0));
        return { ...ring, kappa, q: toomreQ(kappa, ring.sigma, ring.surface, gravity) };
    });
}
