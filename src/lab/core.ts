// The core of a protostar cloud as seen on the grids read back from the GPU. Pure (tested).

export interface CoreProbe {
    /** Cell of the highest density (the first one of a tie, scanning row by row). */
    cell: { x: number; y: number };
    /** rho / rho0 there. */
    density: number;
    /** Temperature there, px^2/s^2 (the gas grid's second channel). */
    temperature: number;
    /**
     * Oscillation frequency of a particle in the core, 1/s: the gravity grid read as a harmonic
     * well a = -omega^2 (x - x0) around the core, so omega^2 = -div(a) / 2. 0 where the field
     * does not converge there.
     */
    omega: number;
}

/**
 * Probes the densest cell of `gas` (RGBA per cell: rho / rho0, T, ...) and the divergence of the
 * acceleration `gravity` (RGBA per cell: ax, ay, ...) there, by central differences over `cell`
 * px (one-sided at the border). Both grids are `resolution` x `resolution`.
 */
export function probeCore(gas: ArrayLike<number>, gravity: ArrayLike<number>, resolution: number, cell: number): CoreProbe {
    let best = 0;
    let density = -Infinity;
    for (let i = 0; i < resolution * resolution; i++) {
        if (gas[i * 4] > density) { density = gas[i * 4]; best = i; }
    }
    const x = best % resolution;
    const y = Math.floor(best / resolution);
    const at = (cx: number, cy: number, channel: number): number =>
        gravity[(Math.min(resolution - 1, Math.max(0, cy)) * resolution + Math.min(resolution - 1, Math.max(0, cx))) * 4 + channel];
    const span = (lo: number, hi: number): number => Math.max(1, Math.min(resolution - 1, hi) - Math.max(0, lo)) * cell;
    const dax = (at(x + 1, y, 0) - at(x - 1, y, 0)) / span(x - 1, x + 1);
    const day = (at(x, y + 1, 1) - at(x, y - 1, 1)) / span(y - 1, y + 1);
    const omega2 = -(dax + day) / 2;
    return {
        cell: { x, y }, density, temperature: gas[best * 4 + 1],
        omega: omega2 > 0 ? Math.sqrt(omega2) : 0,
    };
}
