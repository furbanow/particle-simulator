// The fit of Haff's law to a series of the agitation T(t) of a cooling granular gas: T = T0 / (1 + t / t0)^2,
// that is T^(-1/2) = T0^(-1/2) (1 + t / t0), a straight line in time. Pure (tested in tests/dustLab.test.ts).

export interface LineFit {
    slope: number;
    intercept: number;
    /** Coefficient of determination of the fit (1 for a perfect line). */
    r2: number;
}

/** Least-squares line through the points (x, y). */
export function fitLine(points: readonly (readonly [number, number])[]): LineFit {
    const n = points.length;
    if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
    let sx = 0, sy = 0;
    for (const [x, y] of points) { sx += x; sy += y; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of points) {
        sxx += (x - mx) ** 2;
        sxy += (x - mx) * (y - my);
        syy += (y - my) ** 2;
    }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    return { slope, intercept, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

export interface HaffFit {
    /** Fit of T^(-1/2) against t. */
    line: LineFit;
    /** Time scale t0 = intercept / slope, s: T = T0 (1 + t / t0)^p. */
    t0: number;
    /** Initial agitation implied by the line, px^2/s^2. */
    initialAgitation: number;
    /** The exponent p of T against (1 + t / t0), fitted in log-log: -2 for Haff's law. */
    exponent: number;
    exponentR2: number;
}

/** Fits a series of (time, agitation) pairs; the points with a non-positive agitation are left out. */
export function fitHaff(series: readonly (readonly [number, number])[]): HaffFit {
    const valid = series.filter(([, temperature]) => temperature > 0 && Number.isFinite(temperature));
    const line = fitLine(valid.map(([t, temperature]): [number, number] => [t, temperature ** -0.5]));
    const t0 = line.intercept / line.slope;
    const logs = fitLine(valid.map(([t, temperature]): [number, number] => [Math.log(1 + t / t0), Math.log(temperature)]));
    return { line, t0, initialAgitation: line.intercept ** -2, exponent: logs.slope, exponentR2: logs.r2 };
}
