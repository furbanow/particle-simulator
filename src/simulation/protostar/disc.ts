// The self-gravity of the protostar's initial disc: the inward pull g(r), the potential Phi(r), the potential energy U and the
// energy of circular motion of a flat disc of radius R whose particles attract each other with the softened (Plummer) force
// G m d / (d^2 + eps^2)^(3/2), the force the simulation's own grids approximate. Pure functions (tested). The cloud is
// laid out by `initialConditions.ts`; this module is what it needs to know about the disc it laid out.
//
// The pull and the potential at radius r are sums over rings of radius a (the mass is axisymmetric). The angular integral
// of one ring is a complete elliptic integral (Carlson's arithmetic-geometric mean computes it to rounding error), so the
// quadrature left is a one-dimensional one over a, on panels graded towards the two places where the integrand is not
// smooth: a = r (a logarithmic peak of width eps) and, for the Maclaurin profile, the edge a = R (a square root).

import {
    PROTOSTAR_DISC_EDGE_PANELS, PROTOSTAR_DISC_MIN_SOFTENING, PROTOSTAR_DISC_PANEL_POINTS, PROTOSTAR_DISC_TABLE_NODES,
    PROTOSTAR_DISC_UNIFORM_PANELS,
} from '../../config';

/** The radial distribution of the mass: a uniform disc, or Maclaurin's, whose surface density falls as sqrt(1 - r^2 / R^2). */
export type DensityProfile = 'uniform' | 'maclaurin';

export const DENSITY_PROFILES: readonly DensityProfile[] = ['uniform', 'maclaurin'];

/** Share of the mass that lies within the fraction x = r / R of the radius. */
export function massWithin(profile: DensityProfile, x: number): number {
    const u = Math.min(Math.max(x, 0), 1);
    return profile === 'uniform' ? u * u : 1 - (1 - u * u) ** 1.5;
}

/** The radius (as a fraction of R) within which lies the share `mass` of the mass: the inverse of `massWithin`. */
export function radiusFraction(profile: DensityProfile, mass: number): number {
    const m = Math.min(Math.max(mass, 0), 1);
    return profile === 'uniform' ? Math.sqrt(m) : Math.sqrt(Math.max(0, 1 - (1 - m) ** (2 / 3)));
}

/** Density of the mass along the radius, per unit of x = r / R: the share of the mass in the ring [x, x + dx] is `ringDensity(x) dx`. */
export function ringDensity(profile: DensityProfile, x: number): number {
    if (x < 0 || x > 1) return 0;
    return profile === 'uniform' ? 2 * x : 3 * x * Math.sqrt(1 - x * x);
}

/** Surface density of the disc at radius r (mass per px^2). */
export function surfaceDensity(profile: DensityProfile, radius: number, totalMass: number, r: number): number {
    const x = r / radius;
    if (x < 0 || x > 1) return 0;
    const sigma0 = profile === 'uniform' ? 1 / Math.PI : 3 / (2 * Math.PI);
    return totalMass / (radius * radius) * sigma0 * (profile === 'uniform' ? 1 : Math.sqrt(1 - x * x));
}

/**
 * The complete elliptic integrals K(m) and E(m) of the parameter m = k^2, 0 <= m < 1, by the arithmetic-geometric mean:
 * K = pi / (2 AGM(1, sqrt(1 - m))), E = K (1 - sum 2^(n-1) c_n^2).
 */
export function ellipticIntegrals(m: number): { k: number; e: number } {
    let a = 1, b = Math.sqrt(1 - m);
    let sum = m / 2, weight = 1;
    for (let n = 0; n < 60; n++) {
        const c = (a - b) / 2;
        const next = (a + b) / 2;
        b = Math.sqrt(a * b);
        a = next;
        sum += weight * c * c;
        weight *= 2;
        if (c <= 1e-16 * a) break;
    }
    const k = Math.PI / (2 * a);
    return { k, e: k * (1 - sum) };
}

/**
 * What a ring of radius a and unit mass does at radius r in its plane, per unit of G: the inward pull (a positive number
 * pulls toward the center) and the potential (negative).
 */
export function ringField(r: number, a: number, softening: number): { pull: number; potential: number } {
    const eps2 = softening * softening;
    const sumSq = (r + a) * (r + a) + eps2;                    // A + B
    const diffSq = (r - a) * (r - a) + eps2;                   // A - B
    const { k, e } = ellipticIntegrals(4 * r * a / sumSq);
    const root = Math.sqrt(sumSq);
    const i1 = 2 * k / root;                                   // integral over [0, pi] of dphi / d
    const potential = -i1 / Math.PI;
    if (r === 0) return { pull: 0, potential };
    const i3 = 2 * e / (diffSq * root);                        // integral over [0, pi] of dphi / d^3
    return { pull: ((r * r - a * a - eps2) * i3 + i1) / (2 * Math.PI * r), potential };
}

/** The nodes and weights of the n-point Gauss-Legendre rule on [-1, 1] (Newton's iteration on the Legendre polynomial). */
export function gaussLegendre(n: number): { nodes: Float64Array; weights: Float64Array } {
    const nodes = new Float64Array(n), weights = new Float64Array(n);
    for (let i = 0; i < Math.ceil(n / 2); i++) {
        let x = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
        let derivative = 1;
        for (let iteration = 0; iteration < 100; iteration++) {
            let p0 = 1, p1 = x;
            for (let j = 2; j <= n; j++) [p0, p1] = [p1, ((2 * j - 1) * x * p1 - (j - 1) * p0) / j];
            derivative = n * (x * p1 - p0) / (x * x - 1);
            const step = p1 / derivative;
            x -= step;
            if (Math.abs(step) < 1e-15) break;
        }
        nodes[i] = -x; nodes[n - 1 - i] = x;
        weights[i] = weights[n - 1 - i] = 2 / ((1 - x * x) * derivative * derivative);
    }
    return { nodes, weights };
}

/**
 * The edges of the panels the integral over the ring radius a in [0, R] is cut into for a field point at r: a uniform cut, a
 * geometric cut towards the field point from both sides (the integrand peaks at a = r, over a width of eps), and for the
 * Maclaurin profile a geometric cut towards the edge (its density falls as the square root of the distance to it).
 */
export function panelEdges(profile: DensityProfile, radius: number, r: number, softening: number, uniformPanels: number, edgePanels: number): number[] {
    const edges: number[] = [];
    for (let i = 0; i <= uniformPanels; i++) edges.push(radius * i / uniformPanels);
    edges.push(r);
    for (let d = softening / 2; d < radius; d *= 2) { edges.push(r - d, r + d); }
    if (profile === 'maclaurin') for (let j = 1; j <= edgePanels; j++) edges.push(radius * (1 - 2 ** -j));
    const inside = edges.filter(e => e >= 0 && e <= radius).sort((x, y) => x - y);
    const unique: number[] = [inside[0]];
    for (const e of inside) if (e - unique[unique.length - 1] > 1e-9 * radius) unique.push(e);
    return unique;
}

export interface DiscOptions {
    /** Radius of the disc, px. */
    radius: number;
    /** Effective gravitational constant (px^3 / (mass s^2)) and total mass. */
    gravity: number;
    totalMass: number;
    /** Plummer softening length, px. */
    softening: number;
    profile: DensityProfile;
    /** Intervals of the table (nodes at r = R j / nodes, j = 0..nodes); an even number. */
    nodes?: number;
}

/** The self-gravity of the disc at the nodes r_j = R j / nodes, and what is derived from it. */
export interface DiscTable {
    readonly radius: number;
    readonly profile: DensityProfile;
    readonly nodes: number;
    /** Inward pull g(r_j) (px / s^2). */
    readonly pull: Float64Array;
    /** Potential Phi(r_j) (px^2 / s^2), negative, zero at infinity. */
    readonly potential: Float64Array;
    /** Potential energy U = (1/2) integral Phi dm, negative (mass px^2 / s^2). */
    readonly potentialEnergy: number;
    /** Kinetic energy of the whole disc on circular orbits, (1/2) integral r g dm. */
    readonly circularEnergy: number;
    /** The pull at radius r, interpolated linearly (that of the edge beyond it). */
    pullAt(r: number): number;
    /** The circular speed sqrt(r g(r)) at radius r. */
    circularSpeedAt(r: number): number;
}

/** Composite Simpson's rule of f(j) over the table's nodes j = 0..n (n even). */
function simpson(n: number, f: (j: number) => number): number {
    let sum = f(0) + f(n);
    for (let j = 1; j < n; j++) sum += (j % 2 ? 4 : 2) * f(j);
    return sum / (3 * n);
}

/**
 * The table of a disc: at each node, the pull and the potential of the softened disc by quadrature (a few hundred
 * thousand evaluations of a ring, a few milliseconds), then the potential and circular energies by Simpson's rule.
 */
export function buildDiscTable(options: DiscOptions): DiscTable {
    const { radius, gravity, totalMass, profile } = options;
    const nodes = options.nodes ?? PROTOSTAR_DISC_TABLE_NODES;
    if (nodes % 2 !== 0 || nodes < 2) throw new Error(`The disc table needs an even number of intervals, not ${nodes}`);
    const softening = Math.max(options.softening, PROTOSTAR_DISC_MIN_SOFTENING * radius);
    const gl = gaussLegendre(PROTOSTAR_DISC_PANEL_POINTS);
    const scale = gravity * totalMass / radius;                // the potential's unit; the pull's is this over R
    const pull = new Float64Array(nodes + 1), potential = new Float64Array(nodes + 1);
    // The integrals are over x = a / R, in units of R: the ring density is ringDensity(x).
    const eps = softening / radius;
    for (let j = 0; j <= nodes; j++) {
        const x0 = j / nodes;
        const edges = panelEdges(profile, 1, x0, eps, PROTOSTAR_DISC_UNIFORM_PANELS, PROTOSTAR_DISC_EDGE_PANELS);
        let g = 0, phi = 0;
        for (let p = 0; p + 1 < edges.length; p++) {
            const lo = edges[p], half = (edges[p + 1] - lo) / 2, mid = lo + half;
            for (let q = 0; q < gl.nodes.length; q++) {
                const x = mid + half * gl.nodes[q];
                const w = half * gl.weights[q] * ringDensity(profile, x);
                const field = ringField(x0, x, eps);
                g += w * field.pull;
                phi += w * field.potential;
            }
        }
        pull[j] = g * scale / radius;
        potential[j] = phi * scale;
    }
    const weightAt = (j: number): number => ringDensity(profile, j / nodes);
    const potentialEnergy = 0.5 * totalMass * simpson(nodes, j => weightAt(j) * potential[j]);
    const circularEnergy = 0.5 * totalMass * simpson(nodes, j => weightAt(j) * (j / nodes) * radius * pull[j]);
    const pullAt = (r: number): number => {
        const s = Math.min(Math.max(r / radius, 0), 1) * nodes;
        const j = Math.min(Math.floor(s), nodes - 1);
        return pull[j] + (s - j) * (pull[j + 1] - pull[j]);
    };
    return {
        radius, profile, nodes, pull, potential, potentialEnergy, circularEnergy, pullAt,
        circularSpeedAt: r => Math.sqrt(Math.max(r, 0) * pullAt(r)),
    };
}

/**
 * The acceleration (ax, ay) the disc gives a particle at (dx, dy) from its center (px / s^2): the pull toward the
 * center. It is what the first half step of the integration would read; the integration owes none (leapfrog.ts), so
 * the initial state does not hold it, and the lab checks the grids against this.
 */
export function discAcceleration(table: DiscTable, dx: number, dy: number): { x: number; y: number } {
    const r = Math.hypot(dx, dy);
    if (r === 0) return { x: 0, y: 0 };
    const g = table.pullAt(r);
    return { x: -g * dx / r, y: -g * dy / r };
}
