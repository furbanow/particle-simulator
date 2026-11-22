// Determinism of the scenarios: the CPU side of the simulation draws from Math.random (the initial
// cloud in fillCloud, the density grid shifts of the sticky dust). A scenario that needs a
// reproducible run replaces it with a seeded generator for the duration of the run.
//
// The GPU side is deterministic once the CPU side is: its random numbers are hashes of the
// particle index and of the model's substep counter, which reset() rewinds (see ProtostarModel).
// What stays out of reach: the asynchronous read-backs that act on the state (the sticky dust's supernova
// trigger) land at an unpredictable frame, so a run of the dust that calls Simulation.endFrame() is only
// reproducible to within that kick; the scenarios that compare runs bit for bit step without endFrame().
// The protostar's read-backs (the stats, the type count) only read: its runs replay bit for bit with endFrame().

/** A small fast generator (mulberry32): uniform in [0, 1), the same sequence for the same seed. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Runs `body` with Math.random replaced by a generator seeded with `seed`, then puts the previous
 * one back (even when `body` throws or rejects). Nests; do not start two at once.
 */
export async function withSeededRandom<T>(seed: number, body: () => T | Promise<T>): Promise<T> {
    const saved = Math.random;
    Math.random = mulberry32(seed);
    try {
        return await body();
    } finally {
        Math.random = saved;
    }
}
