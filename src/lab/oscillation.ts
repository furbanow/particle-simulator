// Fit of a damped oscillation, for the lab's sound wave (protostar.collisions.sound-speed): the amplitude of a standing density wave
// against time, a(t) = e^(-beta t) (A cos(omega t) + B sin(omega t)) + C. Pure.

export interface DampedFit {
    /** rad/s. */
    omega: number;
    /** 1/s. */
    beta: number;
    amplitude: number;
    offset: number;
    /** Root-mean-square residual over the root-mean-square signal (about its mean). */
    residual: number;
}

/** A, B, C of the least-squares fit at fixed omega and beta (normal equations, 3 x 3), and the squared residual. */
function linearPart(times: readonly number[], values: readonly number[], omega: number, beta: number): { coefficients: number[]; residual2: number } {
    const n = times.length;
    const basis = (t: number): number[] => {
        const e = Math.exp(-beta * t);
        return [e * Math.cos(omega * t), e * Math.sin(omega * t), 1];
    };
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const r = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        const b = basis(times[i]);
        for (let j = 0; j < 3; j++) {
            r[j] += b[j] * values[i];
            for (let k = 0; k < 3; k++) m[j][k] += b[j] * b[k];
        }
    }
    const coefficients = solve3(m, r);
    let residual2 = 0;
    for (let i = 0; i < n; i++) {
        const b = basis(times[i]);
        const fit = b[0] * coefficients[0] + b[1] * coefficients[1] + b[2] * coefficients[2];
        residual2 += (values[i] - fit) ** 2;
    }
    return { coefficients, residual2 };
}

/** Solves the 3 x 3 system m x = r by Cramer's rule (zeros if singular). */
function solve3(m: number[][], r: number[]): number[] {
    const det = (a: number[][]): number =>
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d = det(m);
    if (Math.abs(d) < 1e-300) return [0, 0, 0];
    return [0, 1, 2].map(col => det(m.map((row, i) => row.map((v, j) => (j === col ? r[i] : v)))) / d);
}

/**
 * The damped cosine that fits (times, values) best: a grid over omega in `omegaRange` and beta in [0, betaMax], refined twice around
 * the best node; the amplitudes are linear. Needs a few samples per period.
 */
export function fitDampedCosine(times: readonly number[], values: readonly number[], omegaRange: readonly [number, number], betaMax: number): DampedFit {
    let best = { omega: omegaRange[0], beta: 0, residual2: Infinity, coefficients: [0, 0, 0] };
    let [w0, w1] = omegaRange;
    let [b0, b1] = [0, betaMax];
    const nodes = 60;
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i <= nodes; i++) {
            const omega = w0 + (w1 - w0) * i / nodes;
            for (let j = 0; j <= nodes; j++) {
                const beta = b0 + (b1 - b0) * j / nodes;
                const { coefficients, residual2 } = linearPart(times, values, omega, beta);
                if (residual2 < best.residual2) best = { omega, beta, residual2, coefficients };
            }
        }
        const dw = 2 * (w1 - w0) / nodes, db = 2 * (b1 - b0) / nodes;
        [w0, w1] = [Math.max(1e-9, best.omega - dw), best.omega + dw];
        [b0, b1] = [Math.max(0, best.beta - db), best.beta + db];
    }
    const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
    const spread = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length));
    const [a, b, c] = best.coefficients;
    return {
        omega: best.omega, beta: best.beta, amplitude: Math.hypot(a, b), offset: c,
        residual: spread > 0 ? Math.sqrt(best.residual2 / Math.max(1, values.length)) / spread : 0,
    };
}

/**
 * The e-folding time of a decaying positive excess, from a least-squares line through ln(values) over the points before the first
 * one at or below `floor` (0 by default: the noise of a relaxed signal would flatten the line); null if it does not decay.
 */
export function eFoldingTime(times: readonly number[], values: readonly number[], floor = 0): number | null {
    const end = values.findIndex(v => !(v > floor));
    const points = times.slice(0, end < 0 ? times.length : end).map((t, i) => [t, values[i]] as const);
    if (points.length < 2) return null;
    const n = points.length;
    const mt = points.reduce((s, [t]) => s + t, 0) / n;
    const ml = points.reduce((s, [, v]) => s + Math.log(v), 0) / n;
    let num = 0, den = 0;
    for (const [t, v] of points) { num += (t - mt) * (Math.log(v) - ml); den += (t - mt) ** 2; }
    const slope = den > 0 ? num / den : 0;
    return slope < 0 ? -1 / slope : null;
}
