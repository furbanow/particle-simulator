// Tuning constants of the lab page (dev only, never built into the application): areas, seeds,
// frame counts and the thresholds of the sanity checks. The application's own constants stay in
// src/config.ts.

import { DUST_GRADIENT_CORNER_WEIGHT, DUST_GRAVITY_GAIN } from '../config';

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

// ---- Energy diagnostics (phase P1a) ----
/** Clouds of the consistency check against the direct sum: small enough for the O(N^2) pair sum. */
export const ENERGY_REFERENCE_PARTICLES = 5000;
/** Frames of each: a young smooth cloud, and one whose core has formed (the grid is then the least accurate). */
export const ENERGY_REFERENCE_FRAMES = [6, 110] as const;
/** The kinetic energy is a plain sum of the deposit: float32 accumulation of 5 000 contributions, a few times 1e-7. */
export const ENERGY_KINETIC_TOLERANCE = 1e-5;
/**
 * The GPU potential energy against the CPU twin of the same scheme (same deposit, same two-level sums, double precision): only
 * float32 roundoff and the cloud-in-cell weight error of the deposit separate them.
 */
export const ENERGY_TWIN_TOLERANCE = 1e-4;
/**
 * The grid potential energy (with its self term removed) against the direct pair sum. What separates them is the grid's own
 * approximation of the force law, estimated per kind of pair: a pair closer than epsilon is smoothed by the cloud-in-cell spread
 * and sees the other particle of its cell at distance 0, an error up to about (h / epsilon)^2 / 12 of that pair's energy (3.5 % at
 * a cell of 2/3 epsilon); a pair farther than a coarse cell is summed with the other cell as one mass at its center, an error of
 * order (S / r)^2 / 12 with S = 4 cells, below 1 % beyond 12 cells. Most of the energy is in the far pairs, so the sum is far better
 * than the worst pair: 0.15 % (smooth young cloud) and 0.33 % (core formed) were measured at 5 000 particles. The tolerance is three
 * times the larger, a margin for another GPU or cloud, and well inside the 3.5 % of the worst pairs.
 */
export const ENERGY_GRID_TOLERANCE = 0.01;
/** The fields of the grid gravity (force and potential) against the twin, relative to their largest value. */
export const GRAVITY_TWIN_TOLERANCE = 1e-4;
/** A cloud for the reduction's channels: its core has formed, several thousand particles in a cell. */
export const REDUCTION_PARTICLES = 100000;
export const REDUCTION_FRAMES = 110;
/** The reduction's sums against the twin that adds up the grids read back (float32 trees against double precision). */
export const REDUCTION_SUM_TOLERANCE = 1e-5;
/** The center of mass, the momentum and the kinetic energy against sums over the particles themselves. */
export const REDUCTION_PARTICLE_TOLERANCE = 1e-5;

/** Energy drift: the cloud and its run (the plan's criterion is K + U within 1 % over 100 orbits). */
export const ENERGY_DRIFT_PARTICLES = 100000;
export const ENERGY_DRIFT_ORBITS = 100;
export const ENERGY_DRIFT_TARGET = 0.01;
/** The first orbits, in which the cloud falls in and settles, are left out of the "after settling" statistics. */
export const ENERGY_DRIFT_SETTLE_ORBITS = 5;
/**
 * The oscillation of the energy is what is left once a slow trend is taken off: the readings minus their running median over this many orbits
 * (a straight line would leave the curvature of a drift that speeds up).
 */
export const ENERGY_OSCILLATION_WINDOW_ORBITS = 2;
/** Orbits at which the drift is reported, besides the statistics. */
export const ENERGY_DRIFT_REPORT_ORBITS = [1, 3, 10, 30, 100] as const;
/** Frames between two readings of the energy in the drift run. */
export const ENERGY_DRIFT_READ_EVERY = 10;
/** Frames between two awaits of the GPU in the drift run (the readings synchronize it anyway). */
export const ENERGY_DRIFT_CHUNK_FRAMES = 500;
/** Software renderer: a token run, to exercise the code. */
export const ENERGY_DRIFT_FRAMES_SOFTWARE = 40;
/**
 * The runs of the drift scenario, each with the wall-clock budget (a run that does not reach its orbits in time stops and says how many it
 * did) and the restitution of the walls (`ELASTIC_WALLS`: a conservative run has walls that return all of the speed; the application's
 * return half of it, and the energy that goes there is not the scheme's). The criterion is judged on the first: the default cloud in a
 * conservative configuration. The second is a cold cloud with rotation at the circular speed and no agitation. The third is the
 * first with the application's walls, to measure what they take.
 */
export const ENERGY_DRIFT_CLOUDS = [
    { name: 'default', params: {}, budgetMs: 480_000, elasticWalls: true },
    { name: 'circular', params: { rotation: 1, agitation: 0 }, budgetMs: 120_000, elasticWalls: true },
    { name: 'default, application walls', params: {}, budgetMs: 100_000, elasticWalls: false },
] as const;
/**
 * Where the energy goes (baseline.protostar.energy-drift-attribution): the conservative default cloud with elastic walls at the default
 * time step divided by each of these, and once with the application's walls at the default step; orbits and wall-clock budget of each.
 */
export const ENERGY_ATTRIBUTION_ORBITS = 12;
export const ENERGY_ATTRIBUTION_STEP_DIVISORS = [1, 2, 4] as const;
export const ENERGY_ATTRIBUTION_BUDGET_MS = 150_000;
/** Restitution of the walls with which the variants make them elastic (the application's is PROTOSTAR_RESTITUTION). */
export const ELASTIC_WALLS = 1;
/** Parameters of a conservative run: no cooling, no heat from fusion, no fusion at all (set below the sliders' minima). */
export const CONSERVATIVE_OVERRIDES = { cooling: 0, feedback: 0, fusionRate: 0, heFusionRate: 0 } as const;

// ---- Default cloud of the sticky dust (clump statistics, recalibration of the gravity) ----
export const DUST_CLOUD_SEED = 20240612;
export const DUST_CLOUD_PARTICLES = 400000;
export const DUST_CLOUD_FRAMES = 600;
/** Frames between two readings of the density grid. */
export const DUST_CLOUD_SAMPLE_EVERY = 10;
/** A clump is a group of at least this many touching dense texels. */
export const DUST_CLOUD_CLUMP_MIN_TEXELS = 4;
/** Shares of the mass in dense texels (at or above REST_DENSITY) whose time of arrival is reported. */
export const DUST_CLOUD_LEVELS = [0.02, 0.05, 0.1, 0.2, 0.3] as const;
/**
 * Arms of the recalibration: the stencil of the coarse levels' gradient (0 is the central difference of
 * the original loop) and the gain on the pull. The default build is the arm `shipped`.
 */
export const DUST_RECALIBRATION_ARMS: readonly { name: string; cornerWeight: number; gain: number }[] = [
    { name: 'original', cornerWeight: 0, gain: 1 },
    { name: 'stencil, gain 1', cornerWeight: DUST_GRADIENT_CORNER_WEIGHT, gain: 1 },
    { name: 'stencil, gain 1.1', cornerWeight: DUST_GRADIENT_CORNER_WEIGHT, gain: 1.1 },
    { name: 'stencil, gain 1.2', cornerWeight: DUST_GRADIENT_CORNER_WEIGHT, gain: 1.2 },
    { name: 'stencil, gain 1.3', cornerWeight: DUST_GRADIENT_CORNER_WEIGHT, gain: 1.3 },
    { name: 'shipped', cornerWeight: DUST_GRADIENT_CORNER_WEIGHT, gain: DUST_GRAVITY_GAIN },
];
