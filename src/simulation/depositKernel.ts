// The kernels of the particle deposits (deposit-kernel.glsl), on the CPU: the weight a particle gives each cell it covers, and
// what the kernel does to the noise of a quantity estimated from the deposit (the temperature of the protostar). Pure, tested.
// Distances and positions are in cells: cell i spans [i, i + 1), its center is i + 0.5.

/** cloud-in-cell (2x2 cells, bilinear weights) or triangular-shaped cloud (3x3 cells, quadratic weights). */
export type DepositKernel = 'cic' | 'tsc';

/** Weight along one axis of a cell whose center is `d` cells from the particle. */
export function kernelWeight(kernel: DepositKernel, d: number): number {
    const a = Math.abs(d);
    if (kernel === 'cic') return Math.max(1 - a, 0);
    if (a < 0.5) return 0.75 - a * a;
    return a < 1.5 ? 0.5 * (1.5 - a) ** 2 : 0;
}

/** Cells a side of the block a particle covers. */
export const kernelWidth = (kernel: DepositKernel): number => (kernel === 'cic' ? 2 : 3);

/**
 * The first cell (along one axis) of the block a particle at `p` covers: the cells first .. first + width - 1. Cloud-in-cell: the
 * two cells whose centers bracket p; TSC: the cell that holds p and its two neighbors.
 */
export function kernelFirstCell(kernel: DepositKernel, p: number): number {
    return kernel === 'cic' ? Math.floor(p - 0.5) : Math.floor(p) - 1;
}

/** The cells (along one axis) a particle at `p` covers and their weights, which sum to 1. */
export function kernelStencil(kernel: DepositKernel, p: number): { first: number; weights: number[] } {
    const first = kernelFirstCell(kernel, p);
    const weights = Array.from({ length: kernelWidth(kernel) }, (_, j) => kernelWeight(kernel, first + j + 0.5 - p));
    return { first, weights };
}

/**
 * The noise shape of a 3x3 neighborhood estimate read at a point, for a uniform gas: the effective number of particles of the
 * estimate over the weighted count the gas pass sees, (sum w)^2 / sum w^2 over sum w (the (sum m)^2 / sum m^2 of the deposits, for
 * equal masses), where a particle's weight w is its kernel weights summed over the 3x3 cells of each neighborhood, interpolated
 * bilinearly between the centers of the neighborhoods' cells as the particle passes read them. `offset` is where the estimate is
 * read, in cells from a cell center along each axis (0: at a cell center, 0.5: between four cells). Separable: the 1D ratio squared.
 * Integrates over the particle positions with `samples` points per cell.
 */
export function neighborhoodNoiseShape(kernel: DepositKernel, offset: number, samples = 2000): number {
    const reach = 4;                                  // a neighborhood's weights vanish beyond 3.5 cells of a cell center
    const h = 1 / samples;
    let sum = 0, square = 0;
    for (let x = -reach; x < reach + 1; x += h) {
        const box = (center: number): number => kernelWeight(kernel, x - center + 1) + kernelWeight(kernel, x - center) + kernelWeight(kernel, x - center - 1);
        const w = (1 - offset) * box(0) + offset * box(1);
        sum += w * h;
        square += w * w * h;
    }
    const ratio = sum / square;                       // (sum w)^2 / sum w^2 over sum w, per unit density
    return ratio * ratio;
}
