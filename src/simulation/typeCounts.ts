/**
 * Particles per type in positions read back from the GPU (RGBA per particle, type rank in z),
 * for models whose particles change type. Ranks are rounded and clamped like the shaders do;
 * removed particles (negative w) are not counted.
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
