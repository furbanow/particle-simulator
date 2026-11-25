// The exact solution of the Riemann problem of an ideal gas (Toro, "Riemann Solvers and Numerical Methods for Fluid Dynamics",
// chapter 4): two uniform states meet at x0 at t = 0, and the solution depends on (x - x0) / t alone. The reference of the lab's
// shock tube (Sod 1978) for the collisions of the protostar's gas (C1, protostar.collisions.sod). Pure.

/** A uniform state of the gas: density, velocity along the tube, pressure (any consistent units). */
export interface GasState {
    rho: number;
    u: number;
    p: number;
}

/** The star region between the two waves: its pressure and velocity, and the densities on either side of the contact. */
export interface StarRegion {
    p: number;
    u: number;
    rhoLeft: number;
    rhoRight: number;
}

const NEWTON_TOLERANCE = 1e-12;
const NEWTON_MAX_ITERATIONS = 100;

const soundSpeedOf = (s: GasState, gamma: number): number => Math.sqrt(gamma * s.p / s.rho);

/** Toro's f_K(p) and its derivative: the velocity change across the wave between state K and a pressure p (shock above p_K, rarefaction below). */
function waveFunction(p: number, s: GasState, gamma: number): [number, number] {
    const c = soundSpeedOf(s, gamma);
    if (p > s.p) {
        const a = 2 / ((gamma + 1) * s.rho);
        const b = (gamma - 1) / (gamma + 1) * s.p;
        const root = Math.sqrt(a / (p + b));
        return [(p - s.p) * root, root * (1 - (p - s.p) / (2 * (b + p)))];
    }
    const ratio = p / s.p;
    return [
        2 * c / (gamma - 1) * (ratio ** ((gamma - 1) / (2 * gamma)) - 1),
        1 / (s.rho * c) * ratio ** (-(gamma + 1) / (2 * gamma)),
    ];
}

/** The density behind the wave that takes state K to pressure p (Rankine-Hugoniot for a shock, isentropic for a rarefaction). */
function densityBehind(p: number, s: GasState, gamma: number): number {
    const ratio = p / s.p;
    if (p > s.p) {
        const g = (gamma - 1) / (gamma + 1);
        return s.rho * (ratio + g) / (g * ratio + 1);
    }
    return s.rho * ratio ** (1 / gamma);
}

/** The star region of the Riemann problem (Newton on f_L + f_R + u_R - u_L = 0 from the primitive-variable guess). Throws on vacuum. */
export function starRegion(left: GasState, right: GasState, gamma: number): StarRegion {
    const cl = soundSpeedOf(left, gamma), cr = soundSpeedOf(right, gamma);
    const du = right.u - left.u;
    if (2 * (cl + cr) / (gamma - 1) <= du) throw new Error('starRegion: the states create a vacuum');
    let p = Math.max(1e-12 * Math.max(left.p, right.p), 0.5 * (left.p + right.p) - 0.125 * du * (left.rho + right.rho) * (cl + cr));
    for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
        const [fl, dl] = waveFunction(p, left, gamma);
        const [fr, dr] = waveFunction(p, right, gamma);
        const next = Math.max(p - (fl + fr + du) / (dl + dr), 1e-12 * p);
        const change = 2 * Math.abs(next - p) / (next + p);
        p = next;
        if (change < NEWTON_TOLERANCE) break;
    }
    const [fl] = waveFunction(p, left, gamma);
    const [fr] = waveFunction(p, right, gamma);
    return { p, u: 0.5 * (left.u + right.u) + 0.5 * (fr - fl), rhoLeft: densityBehind(p, left, gamma), rhoRight: densityBehind(p, right, gamma) };
}

/** The state at x0 + xi t, t > 0 (Toro's sampling): xi = (x - x0) / t. */
export function sampleRiemann(left: GasState, right: GasState, gamma: number, xi: number, star = starRegion(left, right, gamma)): GasState {
    const g1 = (gamma - 1) / (gamma + 1);
    const g2 = 2 / (gamma + 1);
    if (xi <= star.u) {
        const cl = soundSpeedOf(left, gamma);
        if (star.p > left.p) {
            // Left shock.
            const speed = left.u - cl * Math.sqrt((gamma + 1) / (2 * gamma) * star.p / left.p + (gamma - 1) / (2 * gamma));
            return xi <= speed ? { ...left } : { rho: star.rhoLeft, u: star.u, p: star.p };
        }
        // Left rarefaction: head, fan, tail.
        const head = left.u - cl;
        const tail = star.u - cl * (star.p / left.p) ** ((gamma - 1) / (2 * gamma));
        if (xi <= head) return { ...left };
        if (xi >= tail) return { rho: star.rhoLeft, u: star.u, p: star.p };
        const factor = g2 + g1 / cl * (left.u - xi);
        return { rho: left.rho * factor ** (2 / (gamma - 1)), u: g2 * (cl + (gamma - 1) / 2 * left.u + xi), p: left.p * factor ** (2 * gamma / (gamma - 1)) };
    }
    const cr = soundSpeedOf(right, gamma);
    if (star.p > right.p) {
        // Right shock.
        const speed = right.u + cr * Math.sqrt((gamma + 1) / (2 * gamma) * star.p / right.p + (gamma - 1) / (2 * gamma));
        return xi >= speed ? { ...right } : { rho: star.rhoRight, u: star.u, p: star.p };
    }
    // Right rarefaction.
    const head = right.u + cr;
    const tail = star.u + cr * (star.p / right.p) ** ((gamma - 1) / (2 * gamma));
    if (xi >= head) return { ...right };
    if (xi <= tail) return { rho: star.rhoRight, u: star.u, p: star.p };
    const factor = g2 - g1 / cr * (right.u - xi);
    return { rho: right.rho * factor ** (2 / (gamma - 1)), u: g2 * (-cr + (gamma - 1) / 2 * right.u + xi), p: right.p * factor ** (2 * gamma / (gamma - 1)) };
}

/** The speed of the right-moving shock of a Riemann problem whose right wave is a shock (the front of the shock tube), else null. */
export function rightShockSpeed(left: GasState, right: GasState, gamma: number, star = starRegion(left, right, gamma)): number | null {
    if (star.p <= right.p) return null;
    const cr = soundSpeedOf(right, gamma);
    return right.u + cr * Math.sqrt((gamma + 1) / (2 * gamma) * star.p / right.p + (gamma - 1) / (2 * gamma));
}
