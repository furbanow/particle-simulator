// Tuning constants of the lab page (dev only, never built into the application): areas, seeds,
// frame counts and the thresholds of the sanity checks. The application's own constants stay in
// src/config.ts.

import { DUST_GRADIENT_CORNER_WEIGHT } from '../config';

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
/** The omega.dt the Verlet integrator is meant to stay under in the core (the energy-drift criterion of phase P5). */
export const OMEGA_DT_LIMIT = 0.1;
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
/** Particle counts timed per algorithm; the sticky dust, the cheaper one, goes up to the largest count of the sliders too. */
export const PERF_COUNTS: Record<(typeof PERF_ALGORITHMS)[number], readonly number[]> = {
    protostar: [400000, 1000000],
    stickyDust: [400000, 1000000, 3000000],
};
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

// ---- Second deposit (composition grid, spike P0c) ----
export const SECOND_DEPOSIT_PARTICLES = 20000;
export const SECOND_DEPOSIT_FRAMES = 6;
/** Population weights (H, He, C) of the validation cloud: every type is present, so the per-type factor is exercised. */
export const SECOND_DEPOSIT_WEIGHTS = [0.6, 0.3, 0.1] as const;
/**
 * Error model of a deposit path (see DepositTolerance): the unit roundoff of a float32 and of a
 * half float (2^-24 and 2^-11), the roundings each contribution suffers (the product with the
 * weight, the weight itself, the rounded output, the addition), and the error of the cloud-in-cell
 * weight, 2 x 128 x 2^-24 rounded up: the position divided by the cell size in single precision is
 * off by 128 x 2^-24 cells at the far edge of the 128-cell grid, in each of the two axes.
 */
export const DEPOSIT_ROUNDOFF_FLOAT32 = 2 ** -24;
export const DEPOSIT_ROUNDOFF_HALF = 2 ** -11;
export const DEPOSIT_ROUNDINGS = 4;
export const DEPOSIT_WEIGHT_ERROR = 2 ** -15;
/** The same limit as a margin on the footprint of a cloud, to count the cells it may reach. */
export const DEPOSIT_WEIGHT_MARGIN = DEPOSIT_WEIGHT_ERROR;
/** Cells holding less mass than this (in mean particle masses) are left out of the 1 / mu ratio check: there the weights' own error dominates. */
export const RATIO_MIN_MASS = 1;
/** At least this many particles must overlap in the busiest cell for the accumulation to count as tested. */
export const SECOND_DEPOSIT_MIN_OVERLAP = 8;
/** The collapsed cloud of the load test: restarted at the baseline's size, stepped until its core has formed. */
export const SECOND_DEPOSIT_LOAD_PARTICLES = 400000;
export const SECOND_DEPOSIT_LOAD_FRAMES = 100;

// ---- Cost of the second deposit ----
/** Cloud of the cost comparison: the baseline's. */
export const COST_PARTICLES = 400000;
/** The frame at which the early grid-passes comparison is made: its core has not formed yet (it collapses at about frame 80). */
export const COST_EARLY_FRAMES = 55;
/**
 * Whole-frame comparison: rounds of two chunks, with and without the second deposit, the order
 * swapped every round so that the slow change of the cloud (the core forming, the clocks
 * settling) cancels; each chunk is COST_CHUNK_FRAMES frames, the GPU waited for at its end.
 */
export const COST_ROUNDS = 12;
export const COST_CHUNK_FRAMES = 30;
/**
 * Grid-passes-only comparison on a frozen state: rounds of COST_FROZEN_SUBSTEPS repetitions of the
 * grid update (the deposits, gas, heat, gravity), the same alternation.
 */
export const COST_FROZEN_ROUNDS = 12;
export const COST_FROZEN_SUBSTEPS = 40;

// ---- Gravity of the sticky dust (per-texel field against the per-particle loop) ----
export const DUST_GRAVITY_SEED = 7771;
export const DUST_PARITY_PARTICLES = 400000;
/** Frames before the comparison: long enough for the clumps to have formed (the field is then rough at every scale). */
export const DUST_PARITY_FRAMES = 150;
/** Comparisons, a few frames apart so the grid is shifted differently each time, and particles compared in each. */
export const DUST_PARITY_SNAPSHOTS = 4;
export const DUST_PARITY_SNAPSHOT_GAP = 5;
export const DUST_PARITY_PROBES = 262144;
/** The error limit of the acceptance test (relative to the reference pull). */
export const DUST_PARITY_LIMIT = 0.01;
/** Pulls shorter than this fraction of the RMS pull are not judged by their relative error (the levels nearly cancel there). */
export const DUST_PARITY_FLOOR = 0.1;

// Point mass: the pull of one particle's worth of mass on rings around it.
export const POINT_MASS = 1000;
/** Radii of the rings (density texels; the probe domain is one px per texel) and angles on each. */
export const POINT_MASS_RADII = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96] as const;
export const POINT_MASS_ANGLES = 360;
/** Positions of the mass relative to the grid (the app shifts the grid at random every substep: the pull it feels is their average; Halton points). */
export const POINT_MASS_PHASES = 256;
/** Rings smaller than this (texels) feel the 2-texel stencil and the 2x2 deposit of the mass: the anisotropy is judged beyond. */
export const POINT_MASS_MIN_RADIUS = 4;
/** Orders of the angular harmonics a 4-fold symmetric (square) kernel produces: the anisotropy is read on these only, the rest being noise. */
export const ANISOTROPY_HARMONICS = [4, 8, 12, 16] as const;
/** Stencils compared: name and corner weight of the coarse levels' gradient (0 is the central difference of the original loop). */
export const POINT_MASS_STENCILS: readonly (readonly [string, number])[] = [
    ['cross', 0], ['scharr', 3 / 16], ['tuned', DUST_GRADIENT_CORNER_WEIGHT],
];
