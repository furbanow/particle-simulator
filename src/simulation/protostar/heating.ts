// The fusion feedback of the velocity pass (proposal A5), as a pure function: the TypeScript twin of
// the "Fusion feedback" block of protostar-velocity.frag, which the tests check for the energy it
// adds and the momentum it keeps.
//
// The heating adds q dt of kinetic energy per unit mass. Energy per unit mass is |v|^2 / 2, so
// twice that, E = 2 q dt, is what the velocities' squares must grow by. The velocity dispersion T
// of a neighborhood is the mean of |v - u|^2 around its mean velocity u, so scaling every
// velocity's deviation by s = sqrt(1 + E / T) multiplies T by s^2 and adds exactly E / 2 = q dt of
// energy per unit mass on average. The mean velocity does not move: the neighborhood's momentum is
// conserved (the heating is heat, not push) and no noise is added. In a cell that is too cold for
// the scaling to hold energy (T near 0) the same energy goes in as a kick in a random direction.

/** Twice the energy per unit mass the heating adds in a step, bounded by the square of the speed limit (q can be infinite on half-float grids). */
export function heatingEnergy(q: number, dt: number, maxSpeed: number): number {
    return Math.min(2 * q * dt, maxSpeed * maxSpeed);
}

/**
 * The velocity of a particle after the heating: `v` and the neighborhood's mean velocity `u`
 * (px/s), the dispersion `t` of the neighborhood (px^2/s^2), the heating `q` per unit mass (px^2/s^3).
 * `angle` is the direction of the kick of a cold cell (radians). The speed limit is not applied here.
 */
export function heatedVelocity(
    v: readonly [number, number], u: readonly [number, number], t: number, q: number, dt: number,
    maxSpeed: number, floor: number, angle: number,
): [number, number] {
    if (!(q > 0)) return [v[0], v[1]];
    const energy = heatingEnergy(q, dt, maxSpeed);
    if (t > floor) {
        const scale = Math.sqrt(1 + energy / t);
        return [u[0] + (v[0] - u[0]) * scale, u[1] + (v[1] - u[1]) * scale];
    }
    const kick = Math.sqrt(energy);
    return [v[0] + kick * Math.cos(angle), v[1] + kick * Math.sin(angle)];
}
