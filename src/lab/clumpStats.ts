// Clump statistics of the sticky dust's density grid read back from the GPU (mass in the R channel,
// RGBA per texel, row by row). Pure (tested in tests/lab.test.ts).

export interface ClumpStats {
    /** Mass on the grid (R summed). */
    totalMass: number;
    /** Highest texel value. */
    peak: number;
    /** Texels at or above the threshold. */
    denseTexels: number;
    /** Share of the mass held by those texels. */
    denseMassFraction: number;
    /** 4-connected groups of dense texels with at least `minTexels` texels. */
    clumps: number;
    /** Mass of the heaviest group (0 when there is none). */
    largestClumpMass: number;
}

/**
 * The statistics of a `resolution` x `resolution` density grid: texels at or above `threshold` are
 * dense, the dense texels that touch (by an edge) form a clump, and clumps of fewer than `minTexels`
 * texels are not counted.
 */
export function clumpStats(rgba: ArrayLike<number>, resolution: number, threshold: number, minTexels: number): ClumpStats {
    const texels = resolution * resolution;
    let totalMass = 0, peak = 0, denseMass = 0, denseTexels = 0;
    for (let i = 0; i < texels; i++) {
        const rho = rgba[i * 4];
        totalMass += rho;
        if (rho > peak) peak = rho;
        if (rho >= threshold) { denseMass += rho; denseTexels++; }
    }
    const seen = new Uint8Array(texels);
    const stack: number[] = [];
    let clumps = 0, largestClumpMass = 0;
    for (let start = 0; start < texels; start++) {
        if (seen[start] || !(rgba[start * 4] >= threshold)) continue;
        let size = 0, mass = 0;
        seen[start] = 1;
        stack.push(start);
        while (stack.length > 0) {
            const at = stack.pop() as number;
            size++;
            mass += rgba[at * 4];
            const x = at % resolution;
            const neighbours = [x > 0 ? at - 1 : -1, x < resolution - 1 ? at + 1 : -1, at >= resolution ? at - resolution : -1,
                at < texels - resolution ? at + resolution : -1];
            for (const next of neighbours) {
                if (next < 0 || seen[next] || !(rgba[next * 4] >= threshold)) continue;
                seen[next] = 1;
                stack.push(next);
            }
        }
        if (size >= minTexels) {
            clumps++;
            if (mass > largestClumpMass) largestClumpMass = mass;
        }
    }
    return { totalMass, peak, denseTexels, denseMassFraction: totalMass > 0 ? denseMass / totalMass : 0, clumps, largestClumpMass };
}

/** Time of the first sample of `series` (pairs of time and value) whose value reaches `level`; null when none does. */
export function firstCrossing(series: readonly (readonly [number, number])[], level: number): number | null {
    for (let i = 0; i < series.length; i++) {
        if (series[i][1] < level) continue;
        if (i === 0) return series[0][0];
        const [t0, v0] = series[i - 1];
        const [t1, v1] = series[i];
        return v1 === v0 ? t1 : t0 + (t1 - t0) * (level - v0) / (v1 - v0);
    }
    return null;
}
