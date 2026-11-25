// The CPU reference of the type count of the GPU (protostar-types.frag, typeReduction.ts): the particles of each type in positions
// read back from the GPU.

/**
 * Particles per type in positions read back from the GPU (RGBA per particle, type rank in z). Ranks are rounded and clamped like the
 * shaders do. A particle with a negative w is not live and is not counted: nothing removes particles any more (A4), but the lab also
 * runs on the build before, where fusions did.
 */
export function countTypes(positions: Float32Array, count: number, typeCount: number): number[] {
    const counts = new Array<number>(typeCount).fill(0);
    if (typeCount <= 0) return counts;
    for (let i = 0; i < count; i++) {
        if (positions[i * 4 + 3] < 0) continue;
        const rank = Math.round(positions[i * 4 + 2]);
        counts[Math.min(typeCount - 1, Math.max(0, rank))]++;
    }
    return counts;
}
