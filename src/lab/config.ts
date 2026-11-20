// Tuning constants of the lab page (dev only, never built into the application): areas, seeds,
// frame counts and the thresholds of the sanity checks. The application's own constants stay in
// src/config.ts.

/** Simulation area of every scenario, in CSS px (the physics scales with min(width, height)). */
export const LAB_AREA = { width: 1024, height: 768 } as const;

/** Seed of the scenarios' pseudo-random numbers (cloud, grid shifts). */
export const LAB_SEED = 20240611;

/** Renderer names (UNMASKED_RENDERER) of software rasterizers: their timings mean nothing. */
export const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/** Frames between two GPU synchronizations in the long loops (keeps the command queue short, lets read-backs resolve). */
export const LAB_SYNC_EVERY = 10;

// ---- Self-test ----
export const SELFTEST_PARTICLES = 20000;
export const SELFTEST_FRAMES = 6;
/** Fusion rate constant (1/s) forced for the replay check, far above the slider's range: fusions happen within a few frames. */
export const SELFTEST_FUSION_RATE = 0.5;
/** Largest relative error of the deposited mass (the grids hold `count` deposit units in total). */
export const SELFTEST_MASS_TOLERANCE = 1e-3;
/** The same for the half-float deposit path, which rounds every addition to 11 bits. */
export const HALF_FLOAT_MASS_TOLERANCE = 2e-2;

// ---- Baseline of the current protostar model ----
export const BASELINE_PARTICLES = 400000;
export const BASELINE_FRAMES = 1200;
/** A software rasterizer cannot run the full baseline in reasonable time: a smaller, noisier one. */
export const BASELINE_PARTICLES_SOFTWARE = 20000;
export const BASELINE_FRAMES_SOFTWARE = 200;
/** Points kept of each time series in the results (decimated evenly). */
export const BASELINE_SERIES_POINTS = 60;

// ---- Ignition temperature ratio ----
/**
 * Reference point of the ignition ratio: a particle fuses 0.5 times per second at 60 rho0, about
 * the working point of the default cloud's core once it burns (see docs/lab-baseline.md: core
 * density 60 to 65 rho0, a rate of 0.4 to 0.5 fusions per second and per particle there).
 */
export const IGNITION_REFERENCE_RATE = 0.5;
export const IGNITION_REFERENCE_DENSITY = 60;
/** The grid of the sensitivity table (the ratio depends on the point). */
export const IGNITION_SENSITIVITY_RATES = [0.01, 0.1, 0.5, 1] as const;
export const IGNITION_SENSITIVITY_DENSITIES = [10, 30, 60, 100, 300] as const;
/** The real ratio of the helium to the hydrogen ignition temperature (100 MK over 15 MK). */
export const REAL_IGNITION_RATIO = 100 / 15;

// ---- Performance probe ----
export const PERF_ALGORITHMS = ['protostar', 'stickyDust'] as const;
export const PERF_COUNTS = [400000, 1000000] as const;
/** Timed frames per measurement, in chunks synchronized with the GPU (the median chunk is reported). */
export const PERF_FRAMES = 120;
export const PERF_CHUNK_FRAMES = 30;
/** Warm-up before each measurement: at least this many frames and this long (a GPU raises its clocks under load). */
export const PERF_WARMUP_FRAMES = 30;
export const PERF_WARMUP_MS = 1500;
/** A software renderer would take minutes: a couple of frames only, to exercise the path. */
export const PERF_FRAMES_SOFTWARE = 2;
/**
 * Animation-frame intervals shorter than this fraction of the synchronized frame time do not
 * reflect the GPU load (the browser lets frames pile up, as headless Chrome does at its fixed rate).
 */
export const PERF_ANIMATION_FRAME_TRUST = 0.95;
