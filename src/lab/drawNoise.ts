// The gate of C3 (continuous composition per particle; docs/spikes/c3-continuous-composition.md): how noisy the composition is that the
// fusion draw of A4 leaves behind. Pure (tested): the scenario spike.c3.draw-noise reads the positions and the grids back and calls these.

/** The positions as readPositions() gives them: x, y, type, w per particle. */
export interface PositionArray {
    readonly length: number;
    readonly [index: number]: number;
}

/** The type of particle i, rounded as the shaders round it. */
const typeOf = (positions: PositionArray, i: number): number => Math.round(positions[i * 4 + 2]);

/**
 * The relative noise of the fuel share that the rate laws read, where the gas burns. A parcel is all fuel or all ash (A4), so the fuel
 * share X of a neighborhood of N parcels (3 x 3 cells, the neighborhood of the grids' gas) has the binomial standard deviation
 * sqrt(X (1 - X) / N): relative to X, sqrt((1 - X) / (X N)). It is averaged over the cells weighted by `weights` (the burning: rho q of
 * the gas and heat grids) times X (the share of that burning the fuel has). Continuous compositions (C3) would have none of it.
 */
export function fuelShareNoise(positions: PositionArray, count: number, cell: number, resolution: number,
    weights: ArrayLike<number>, fuel: number): { noise: number; parcels: number; fuelShare: number } | null {
    const cells = resolution * resolution;
    const all = new Float64Array(cells), fueled = new Float64Array(cells);
    for (let i = 0; i < count; i++) {
        if (!(positions[i * 4 + 3] >= 0)) continue;
        const cx = Math.min(resolution - 1, Math.max(0, Math.floor(positions[i * 4] / cell)));
        const cy = Math.min(resolution - 1, Math.max(0, Math.floor(positions[i * 4 + 1] / cell)));
        all[cy * resolution + cx]++;
        if (typeOf(positions, i) === fuel) fueled[cy * resolution + cx]++;
    }
    let weight = 0, noise = 0, parcels = 0, share = 0;
    for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
            const w = weights[y * resolution + x];
            if (!(w > 0) || !Number.isFinite(w)) continue;
            let n = 0, f = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const [u, v] = [x + dx, y + dy];
                    if (u < 0 || v < 0 || u >= resolution || v >= resolution) continue;
                    n += all[v * resolution + u];
                    f += fueled[v * resolution + u];
                }
            }
            if (f <= 0 || n <= 0) continue;
            const xShare = f / n;
            const wx = w * xShare;
            weight += wx;
            noise += wx * Math.sqrt((1 - xShare) / (xShare * n));
            parcels += wx * n;
            share += wx * xShare;
        }
    }
    return weight > 0 ? { noise: noise / weight, parcels: parcels / weight, fuelShare: share / weight } : null;
}

/** The share of the particles of each of the first `types` types within `radius` px of `center`, and their number. */
export function coreShares(positions: PositionArray, count: number, center: { x: number; y: number }, radius: number,
    types: number): { shares: number[]; particles: number } {
    const counts = new Array<number>(types).fill(0);
    let total = 0;
    const r2 = radius * radius;
    for (let i = 0; i < count; i++) {
        if (!(positions[i * 4 + 3] >= 0)) continue;
        const [dx, dy] = [positions[i * 4] - center.x, positions[i * 4 + 1] - center.y];
        if (dx * dx + dy * dy > r2) continue;
        total++;
        const k = typeOf(positions, i);
        if (k >= 0 && k < types) counts[k]++;
    }
    return { shares: counts.map(n => total > 0 ? n / total : 0), particles: total };
}

/** Mean, sample standard deviation and their ratio (null for a zero mean) of `values`; the finite ones only. */
export function spread(values: readonly (number | null)[]): { mean: number; std: number; relative: number | null; n: number } | null {
    const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
    if (finite.length === 0) return null;
    const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
    const variance = finite.length > 1 ? finite.reduce((s, v) => s + (v - mean) ** 2, 0) / (finite.length - 1) : 0;
    const std = Math.sqrt(variance);
    return { mean, std, relative: mean !== 0 ? std / Math.abs(mean) : null, n: finite.length };
}

/** The first time of `series` ([t, value] pairs in time order) at which the value reaches `level`, or null. */
export function firstReaching(series: readonly (readonly [number, number])[], level: number): number | null {
    return series.find(([, v]) => v >= level)?.[0] ?? null;
}
