// Fusions conserve momentum only on average: a survivor carries its velocity with three or four
// times the mass, and that noise makes a hot star drift across the screen. The GPU model measures
// the drift on the positions it reads back and takes it off every particle. Pure functions (tested).

export interface Vec2 {
    readonly x: number;
    readonly y: number;
}

/** Center of mass of the live particles (position texels x, y, type, w), null when none weighs anything. */
export function centerOfMass(positions: Float32Array, count: number, masses: readonly number[]): Vec2 | null {
    let x = 0, y = 0, total = 0;
    for (let i = 0; i < count; i++) {
        if (positions[i * 4 + 3] < 0) continue;
        const m = masses[Math.round(positions[i * 4 + 2])] ?? 0;
        x += m * positions[i * 4];
        y += m * positions[i * 4 + 1];
        total += m;
    }
    return total > 0 ? { x: x / total, y: y / total } : null;
}

/**
 * Velocity to take off every particle, given two centers of mass `elapsed` seconds apart. `gain`
 * below 1 keeps it stable: a read-back lags, so the measure still contains part of the last correction.
 */
export function driftCorrection(previous: Vec2, current: Vec2, elapsed: number, gain: number): Vec2 {
    if (elapsed <= 0) return { x: 0, y: 0 };
    return { x: gain * (current.x - previous.x) / elapsed, y: gain * (current.y - previous.y) / elapsed };
}
