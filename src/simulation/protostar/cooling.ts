// The radiative cooling of the velocity pass (proposal A6) and the Jeans floor (A13), as pure functions: the TypeScript twins
// of the "Radiative cooling" and "Jeans floor" blocks of protostar-velocity.frag, which the tests and the lab check.
//
// Thin-disc cooling (Johnson & Gammie 2003). The grid's density is the surface density Sigma of the model, so a column of gas
// has the optical depth tau = kappa Sigma / 2 from its mid-plane to either face, whatever its thickness, and it radiates
// through an effective depth that joins the optically thick and the thin limits:
//
//     tau_eff = 3 tau / 8 + sqrt(3) / 4 + 1 / (4 tau).
//
// The energy it loses per unit mass is the flux of its two faces over Sigma: in the units of the model (T in T0, Sigma in rho0)
//
//     dT/dt = -c mu T^4 / (Sigma tau_eff),
//
// with c (1/s) the rate at which a column of Sigma = rho0 and tau_eff = 1 at T0 of hydrogen loses ln T. T is the temperature (the
// dispersion times mu, mu = mu_mean / mu_H): the radiation goes as T^4, while the energy per unit mass is the dispersion t = T / mu,
// so at the same temperature a gas of heavier ions (less heat per unit mass) cools mu times faster in T. Sigma and mu are frozen over
// a step and the law integrates exactly:
//
//     T' = T (1 + 3 c mu T^3 dt / (Sigma tau_eff))^(-1/3),
//
// unconditionally stable (no time step to respect however stiff the cooling is). It stops at the floor T_min, and a gas already
// below it is left alone. The velocities' deviations from the local mean are scaled by sqrt(T' / T): only the disordered motion
// loses energy; rotation and infall are kept. Sigma tau_eff is computed as 3 kappa Sigma^2 / 16 + sqrt(3) Sigma / 4 + 1 / (2 kappa),
// which stays finite when Sigma goes to 0 (the optically thin limit: the loss is then 2 c kappa mu T^4, whatever Sigma is).
//
// Jeans floor (A13). On a grid of cell dx a thin sheet's Jeans length lambda_J = c_s^2 / (G Sigma) must stay above N_J cells
// (Truelove et al. 1997: N_J = 4), or the gas fragments at the scale of the grid, not of the physics. With the dispersion
// t = <|v - u|^2> = 2 c_s^2 of the plane, that is a floor on the dispersion of each neighborhood:
//
//     t_J = 2 N_J dx G Sigma,
//
// and a gas below it has its velocities' deviations scaled by sqrt(t_J / t), as the heating does (a cold one, with nothing to
// scale, gets the missing dispersion as a kick in a random direction). An artificial pressure, behind the `jeansFloor` flag.

// The damping law (the cooling of the first protostar, the `coolingLaw` choice): the disordered part of the velocity is damped, v <- u + (v - u) e^(-k_eff dt),
// at the rate k_eff = k / (1 + Sigma / rho_opq) whatever the temperature (the dense gas, opaque, keeps the heat of its compression). The dispersion
// loses e^(-2 k_eff dt), so d ln T / dt = -2 k_eff. Unlike the radiation it keeps cooling a cold gas, which falls in and fragments; there is no
// floor and no dependence on the molecular weight.

/** The laws of the cooling, `coolingLaw`'s options: the thin-disc radiation (T^4) or the constant damping. */
export const COOLING_LAWS = ['radiation', 'damping'] as const;
export type CoolingLaw = typeof COOLING_LAWS[number];
export const isCoolingLaw = (value: unknown): value is CoolingLaw => COOLING_LAWS.some(law => law === value);

/** sqrt(3) / 4, the middle term of the effective optical depth. */
const SQRT3_OVER_4 = Math.sqrt(3) / 4;

/** The effective optical depth tau_eff of a column of optical depth `tau` from its mid-plane to a face (Infinity at tau = 0). */
export function effectiveDepth(tau: number): number {
    return 3 * tau / 8 + SQRT3_OVER_4 + 1 / (4 * tau);
}

/** Sigma tau_eff for a surface density `sigma` (rho0) and an opacity `kappa` (tau = kappa sigma / 2), finite at sigma = 0; Infinity when kappa <= 0 (no radiation escapes). */
export function columnDepth(sigma: number, kappa: number): number {
    if (!(kappa > 0)) return Infinity;
    return 3 * kappa * sigma * sigma / 16 + SQRT3_OVER_4 * sigma + 1 / (2 * kappa);
}

/** The parameters of the cooling: the radiation's (c, kappa, T_min) and, for the damping law, k and rho_opq. */
export interface RadiativeCooling {
    /** c, 1/s. */
    rate: number;
    /** kappa, per rho0. */
    opacity: number;
    /** T_min, in T0 (a temperature, not a dispersion). */
    floor: number;
    /** The law at work (the radiation when absent). */
    law?: CoolingLaw;
    /** k, 1/s: the damping of the speed of the thin gas (damping law). */
    damping?: number;
    /** rho_opq, rho0: the density at which the damping halves (damping law). */
    dampingOpacity?: number;
}

/** The damping rate k_eff = k / (1 + Sigma / rho_opq) (1/s) of a gas of surface density `sigma` (rho0). */
export const dampingRate = (sigma: number, damping: number, opacity: number): number => damping / (1 + sigma / opacity);

/**
 * The ratio T' / T (as well t' / t: mu does not change) of a gas of temperature `temperature` (T0), molecular weight `mu` (mu / mu_H)
 * and surface density `sigma` (rho0) after `dt` seconds of radiative cooling; 1 for a gas at or below the floor, or with no cooling.
 */
export function coolingRatio(temperature: number, mu: number, sigma: number, dt: number, cooling: RadiativeCooling): number {
    if (cooling.law === 'damping') {
        if (!(sigma > 0) || !(dt > 0) || !((cooling.damping ?? 0) > 0)) return 1;
        return Math.exp(-2 * dampingRate(sigma, cooling.damping!, cooling.dampingOpacity ?? 1) * dt);
    }
    if (!(temperature > cooling.floor) || !(cooling.rate > 0) || !(dt > 0) || !(sigma > 0)) return 1;
    const x = 3 * cooling.rate * mu * temperature ** 3 * dt / columnDepth(sigma, cooling.opacity);
    return Math.max((1 + x) ** (-1 / 3), cooling.floor / temperature);
}

/** The rate d ln T / dt (1/s, negative) of the cooling at that state: what sets the cooling time 1 / (3 |rate|) of the exact law at small dt. */
export function coolingLogRate(temperature: number, mu: number, sigma: number, cooling: RadiativeCooling): number {
    if (cooling.law === 'damping') {
        return sigma > 0 && (cooling.damping ?? 0) > 0 ? -2 * dampingRate(sigma, cooling.damping!, cooling.dampingOpacity ?? 1) : 0;
    }
    if (!(temperature > cooling.floor) || !(cooling.rate > 0) || !(sigma > 0)) return 0;
    return -cooling.rate * mu * temperature ** 3 / columnDepth(sigma, cooling.opacity);
}

/** The Jeans floor t_J (px^2/s^2) of the dispersion: 2 N_J dx G Sigma, with `perDensity` = 2 N_J dx G rho0 and `sigma` in rho0. */
export function jeansDispersion(sigma: number, perDensity: number): number {
    return Math.max(sigma, 0) * perDensity;
}

/** 2 N_J dx G rho0 (px^2/s^2): the Jeans floor of a gas of density rho0, for cells of `cell` px, G_eff (px^3 / (mass s^2)) and rho0 (mass / px^2). */
export function jeansPerDensity(cells: number, cell: number, gravity: number, rho0: number): number {
    return 2 * cells * cell * gravity * rho0;
}

/** The Jeans length of a sheet of dispersion `t` (px^2/s^2) and surface density `sigma` (rho0), in cells of the floor's grid: N_J t / t_J. */
export function jeansCells(t: number, sigma: number, perDensity: number, cells: number): number {
    const floor = jeansDispersion(sigma, perDensity);
    return floor > 0 ? cells * t / floor : Infinity;
}

/**
 * The velocity of a particle after the cooling and the Jeans floor (in that order), the TypeScript twin of the shader's two blocks:
 * `v` and the neighborhood's mean velocity `u` (px/s), its dispersion `t` (px^2/s^2), mu and sigma (rho0); `t0` is T0 (px^2/s^2),
 * `jeans` the floor's 2 N_J dx G rho0 (px^2/s^2, 0 when the flag is off), `coldFloor` the dispersion below which the floor kicks
 * instead of scaling, `angle` the kick's direction. Returns the velocity and the neighborhood's dispersion after both (what the heating
 * then scales).
 */
export function cooledVelocity(
    v: readonly [number, number], u: readonly [number, number], t: number, mu: number, sigma: number, dt: number, t0: number,
    cooling: RadiativeCooling, jeans: number, coldFloor: number, angle: number,
): { v: [number, number]; t: number } {
    let out: [number, number] = [v[0], v[1]];
    let dispersion = t;
    if (sigma > 0) {
        const ratio = coolingRatio(mu * t / t0, mu, sigma, dt, cooling);
        const scale = Math.sqrt(ratio);
        out = [u[0] + (out[0] - u[0]) * scale, u[1] + (out[1] - u[1]) * scale];
        dispersion *= ratio;
        const floor = jeansDispersion(sigma, jeans);
        if (dispersion < floor) {
            if (dispersion > coldFloor) {
                const s = Math.sqrt(floor / dispersion);
                out = [u[0] + (out[0] - u[0]) * s, u[1] + (out[1] - u[1]) * s];
            } else {
                const kick = Math.sqrt(floor - dispersion);
                out = [out[0] + kick * Math.cos(angle), out[1] + kick * Math.sin(angle)];
            }
            dispersion = floor;
        }
    }
    return { v: out, t: dispersion };
}
