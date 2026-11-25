// Statistics of the adaptive time step's runs (phase B5), pure (tested): how often each count of substeps was used, and how close the
// history of a cloud's core is to the one of a reference run at a much smaller step.

/** A cloud's core read once per frame: the time of the state the reading describes, the densest cell (rho0), the temperature there (MK) and the expected fusions per second. */
export interface CoreSeries {
    seconds: number[];
    density: number[];
    temperatureMK: number[];
    rate: number[];
}

/** How many frames ran each count of substeps: `counts[n]` frames ran n substeps (index 0 unused). */
export function histogram(steps: readonly number[]): number[] {
    const top = steps.reduce((m, s) => Math.max(m, s), 0);
    const counts = new Array<number>(top + 1).fill(0);
    for (const s of steps) counts[s]++;
    return counts;
}

/** Mean of the substeps of a frame, and its share of the frames spent at each count (index = count). */
export function stepSummary(steps: readonly number[]): { mean: number; shares: number[] } {
    const counts = histogram(steps);
    const total = steps.length || 1;
    return { mean: steps.reduce((sum, s) => sum + s, 0) / total, shares: counts.map(c => c / total) };
}

/** The largest value and the time it is reached at. */
export function peak(values: readonly number[], seconds: readonly number[]): { value: number; seconds: number } {
    let best = 0;
    for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
    return { value: values[best] ?? NaN, seconds: seconds[best] ?? NaN };
}

/** The time at which a series first reaches `level` (linear interpolation between two frames), null if it never does. */
export function firstCrossing(values: readonly number[], seconds: readonly number[], level: number): number | null {
    for (let i = 0; i < values.length; i++) {
        if (values[i] < level) continue;
        if (i === 0) return seconds[0];
        const t = (level - values[i - 1]) / (values[i] - values[i - 1]);
        return seconds[i - 1] + t * (seconds[i] - seconds[i - 1]);
    }
    return null;
}

/** Running mean over `width` frames centered on each (shorter at the ends): what takes the frame-to-frame noise off a rate. */
export function smooth(values: readonly number[], width: number): number[] {
    const half = Math.floor(width / 2);
    return values.map((_, i) => {
        const lo = Math.max(0, i - half), hi = Math.min(values.length - 1, i + half);
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += values[k];
        return sum / (hi - lo + 1);
    });
}

/** The integral of a rate over time (trapezoids): the fusions made up to each frame. */
export function cumulative(rate: readonly number[], seconds: readonly number[]): number[] {
    const out = [0];
    for (let i = 1; i < rate.length; i++) out.push(out[i - 1] + 0.5 * (rate[i] + rate[i - 1]) * (seconds[i] - seconds[i - 1]));
    return out;
}

/** The value of a series at time `t` (linear interpolation; the ends outside). */
export function valueAt(values: readonly number[], seconds: readonly number[], t: number): number {
    if (t <= seconds[0]) return values[0];
    for (let i = 1; i < seconds.length; i++) {
        if (t <= seconds[i]) return values[i - 1] + (values[i] - values[i - 1]) * (t - seconds[i - 1]) / (seconds[i] - seconds[i - 1]);
    }
    return values[values.length - 1];
}

/** How a run's first `until` seconds differ from a reference's (both read at the same frames). */
export interface CoreComparison {
    /** Root mean square of ln(rho / rho_reference) over the frames. */
    densityLogRms: number;
    /** The largest |ln(rho / rho_reference)|. */
    densityLogMax: number;
    /** (peak rho - reference's) / reference's. */
    peakDensityRelative: number;
    /** Peak rho of the run, and the time it is at, minus the reference's, s. */
    peakDensityTimeDelta: number;
    /** Time the fusion rate (smoothed over three frames) first reaches half its own peak, minus the reference's, s: the burst's timing. */
    burstTimeDelta: number | null;
    /** (peak smoothed fusion rate - reference's) / reference's. */
    burstPeakRelative: number;
    /** (fusions made up to each time - reference's) / reference's. */
    fusedRelative: number[];
    /** (highest core temperature - reference's) / reference's. */
    peakTemperatureRelative: number;
}

/**
 * Compares `run` with `reference` over the first `until` seconds; `fusedAt` are the times of the cumulative fusion counts. The two are read
 * at their own times (a run at another substep describes another instant in each frame: see the lab scenario), so `run` is first
 * resampled (linear interpolation) at the reference's times.
 */
export function compareCore(run: CoreSeries, reference: CoreSeries, until: number, fusedAt: readonly number[]): CoreComparison {
    const last = run.seconds[run.seconds.length - 1];
    const frames = reference.seconds.findIndex(t => t > Math.min(until, last));
    const n = frames < 0 ? reference.seconds.length : frames;
    const cut = (values: readonly number[]): number[] => values.slice(0, n);
    const seconds = cut(reference.seconds);
    const resampled = (values: readonly number[]): number[] => seconds.map(t => valueAt(values, run.seconds, t));
    const runDensity = resampled(run.density), runRate = resampled(run.rate), runTemperature = resampled(run.temperatureMK);
    const logs = seconds.map((_, i) => Math.log(runDensity[i] / reference.density[i]));
    const rmsLog = Math.sqrt(logs.reduce((sum, d) => sum + d * d, 0) / Math.max(1, logs.length));
    const maxLog = logs.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
    const runPeak = peak(runDensity, seconds), refPeak = peak(cut(reference.density), seconds);
    const runSmooth = smooth(runRate, 3), refSmooth = smooth(cut(reference.rate), 3);
    const runBurst = peak(runSmooth, seconds), refBurst = peak(refSmooth, seconds);
    const runHalf = firstCrossing(runSmooth, seconds, 0.5 * runBurst.value);
    const refHalf = firstCrossing(refSmooth, seconds, 0.5 * refBurst.value);
    const runFused = cumulative(runRate, seconds), refFused = cumulative(cut(reference.rate), seconds);
    return {
        densityLogRms: rmsLog,
        densityLogMax: maxLog,
        peakDensityRelative: runPeak.value / refPeak.value - 1,
        peakDensityTimeDelta: runPeak.seconds - refPeak.seconds,
        burstTimeDelta: runHalf === null || refHalf === null ? null : runHalf - refHalf,
        burstPeakRelative: runBurst.value / refBurst.value - 1,
        fusedRelative: fusedAt.map(t => valueAt(runFused, seconds, t) / valueAt(refFused, seconds, t) - 1),
        peakTemperatureRelative: Math.max(...runTemperature) / Math.max(...cut(reference.temperatureMK)) - 1,
    };
}

/** A schedule of substeps per frame written as run lengths, `2x90,3x18,2x507`: 90 frames of 2 substeps, then 18 of 3, then 507 of 2. */
export function parseSchedule(text: string): number[] {
    return text.split(',').flatMap(part => {
        const [count, length] = part.trim().split('x').map(Number);
        if (!(count >= 1) || !(length >= 1)) throw new Error(`Bad run of a schedule: "${part}"`);
        return Array.from({ length }, () => count);
    });
}
