// Tuning constants of the lab page (dev only, never built into the application): areas, seeds,
// frame counts and the thresholds of the sanity checks. The application's own constants stay in
// src/config.ts.

import { DUST_GRADIENT_CORNER_WEIGHT, DUST_GRAVITY_GAIN, PROTOSTAR_GRAVITY_SLIDER } from '../config';

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
/** Seeds (LAB_SEED, +1...) of each variant of the default-cloud ablation. */
export const CLOUD_VARIANT_SEEDS = 3;
export const BASELINE_PARTICLES = 400000;
export const BASELINE_FRAMES = 1200;
/** A software rasterizer cannot run the full baseline in reasonable time: a smaller, noisier one. */
export const BASELINE_PARTICLES_SOFTWARE = 20000;
export const BASELINE_FRAMES_SOFTWARE = 200;
/** The omega.dt the Verlet integrator is meant to stay under in the core (the energy-drift criterion of phase P5). */
export const OMEGA_DT_LIMIT = 0.1;
/** Points kept of each time series in the results (decimated evenly). */
export const BASELINE_SERIES_POINTS = 120;

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

// ---- The integration step (phase P5a) ----
/**
 * protostar.integration: a gas filling the whole area (so that a few percent of the particles reach a wall in every step), with
 * Gaussian velocities of standard deviation INTEGRATION_SIGMA (px/s, per component, under the speed limit), stepped one substep at a time
 * INTEGRATION_STEPS times; each step is compared with the twin of the integration (leapfrog.ts) fed with the acceleration the GPU stored.
 */
export const INTEGRATION_PARTICLES = 20000;
export const INTEGRATION_STEPS = 4;
/**
 * The speed (time scale, under 1: one substep a frame) of each step after the first INTEGRATION_STEPS: the time step changes from one
 * step to the next, so the half kicks are over the previous step's length (phase B5, the shaders' dtPrev).
 */
export const INTEGRATION_CHANGING_SPEEDS = [0.5, 0.9, 0.25, 0.25, 0.7, 0.4] as const;
export const INTEGRATION_SIGMA = 300;
/** Float32 positions of about 1000 px have a unit in the last place of 6e-5 px, velocities of 1000 px/s of 6e-5 px/s: a few of them. */
export const INTEGRATION_POSITION_TOLERANCE = 5e-4;
export const INTEGRATION_VELOCITY_TOLERANCE = 5e-4;
/** The check must have met this many bounces to count. */
export const INTEGRATION_MIN_BOUNCES = 100;

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
 * conservative configuration. The second is a cold cloud with rotation at the circular speed (the disc's: beta_rot 0.48 is 1.003 times the circular speed at the
 * default softening, alpha_vir twice that leaves no agitation) and no agitation. The third is the
 * first with the application's walls, to measure what they take.
 */
export const ENERGY_DRIFT_CLOUDS = [
    { name: 'default', params: {}, budgetMs: 600_000, elasticWalls: true },
    { name: 'circular', params: { alphaVir: 0.96, betaRot: 0.48 }, budgetMs: 120_000, elasticWalls: true },
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
export const CONSERVATIVE_OVERRIDES = { radiation: 0, feedback: 0, fusionRate: 0, heFusionRate: 0 } as const;

// ---- Initial conditions of the protostar (phase P5b, docs/spikes/a8-initial-conditions.md) ----
/** Particles of the checks of the initial cloud: the default's. */
export const INITIAL_PARTICLES = 400000;
/** The clouds `protostar.initial-conditions` sets up: the sliders' values and the energies read back at t = 0. */
export const INITIAL_CASES = [
    { name: 'default', params: {} },
    { name: 'cold', params: { alphaVir: 0, betaRot: 0 } },
    { name: 'circular orbits', params: { alphaVir: 0.96, betaRot: 0.48 } },
    { name: 'virial 1, no rotation', params: { alphaVir: 1, betaRot: 0 } },
    { name: 'virial 1, rotation 0.25', params: { alphaVir: 1, betaRot: 0.25 } },
    { name: 'hot', params: { alphaVir: 2, betaRot: 0.1 } },
    { name: 'default, correlated', params: { turbulence: 'correlated' } },
    { name: 'virial 1, correlated', params: { alphaVir: 1, betaRot: 0.25, turbulence: 'correlated' } },
    { name: 'Maclaurin', params: { profile: 'maclaurin' } },
    { name: 'Maclaurin, correlated', params: { profile: 'maclaurin', turbulence: 'correlated' } },
] as const;
/** Largest relative difference of the virial ratio the reduction reads (K over the grid's |U|) from the slider. */
export const INITIAL_VIRIAL_TOLERANCE = 0.01;
/** The same for the rotation energy along the circular-speed pattern (it is exact up to float32: the agitation has no part of it). */
export const INITIAL_ROTATION_TOLERANCE = 2e-3;
/** The same for the kinetic energy read by the reduction, against alpha |U| / 2 with the table's |U|. */
export const INITIAL_KINETIC_TOLERANCE = 2e-3;
/** Rings of the profiles of the initial cloud. */
export const INITIAL_BINS = 60;
/** The grid's acceleration is judged against the table between these fractions of the cloud's radius. */
export const INITIAL_FORCE_RANGE = [0.1, 0.95] as const;
/** Largest relative difference, per ring of the profile, between the pull the grid gives and the table's (at t = 0). */
export const INITIAL_FORCE_TOLERANCE = 0.06;
/**
 * The cold Maclaurin disc's collapse: no cooling, feedback or fusion, a softening of this % of L (a hundred times under the cell of the
 * grid), the speeds the run is repeated at, the fractions of the initial half-mass radius at which the free-fall time is estimated, the
 * one judged and the tolerance (the plan's 2 %), and the longest run in free-fall times.
 */
export const MACLAURIN_SOFTENING = 0.1;
export const MACLAURIN_SPEEDS = [1.7, 0.85] as const;
export const MACLAURIN_LEVELS = [0.75, 0.5, 0.25, 0.1] as const;
export const MACLAURIN_JUDGED_LEVELS = [0.75, 0.5] as const;
export const MACLAURIN_TOLERANCE = 0.02;
export const MACLAURIN_MAX_FALL_TIMES = 1.2;
/** Radii of the disc at which the table of the softened disc is built for the prediction with the softening, as fractions of the initial radius. */
export const MACLAURIN_PREDICTION_RADII = [1, 0.8, 0.6, 0.45, 0.33, 0.25, 0.18, 0.12, 0.08, 0.05] as const;
/** Particle counts of the cost of a restart, ms. */
export const INITIAL_COST_COUNTS = [400000, 1000000, 2000000] as const;
export const INITIAL_COST_REPEATS = 5;

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
// ---- Granular dust: the deposit of the agitation energy, Haff's law ----
export const DUST_DEPOSIT_SEED = 7778;
/** A sparse cloud (a few particles a texel, the donut barely collapsed): the deposit must equal its CPU reference within the tolerance model. */
export const DUST_DEPOSIT_SPARSE_PARTICLES = 20000;
export const DUST_DEPOSIT_SPARSE_FRAMES = 10;
/** The default cloud once its clumps have formed (it collapses at about frame 85): the deposit is measured, not judged. */
export const DUST_DEPOSIT_CLUMPED_PARTICLES = 400000;
export const DUST_DEPOSIT_CLUMPED_FRAMES = 110;
/**
 * A cold flow: a block of the area filled with grains whose agitation is DUST_COLD_SIGMA (px/s per axis) in a bulk flow far faster than
 * it. Half floats lose the energy about zero (the speed's square is 600 times the agitation's); the reference velocity keeps it.
 */
export const DUST_COLD_PARTICLES = 400000;
export const DUST_COLD_SIGMA = 12;
export const DUST_COLD_BULK = [700, -400] as const;
/** Fractional bits of the weights of the hardware's bilinear filter (NVIDIA, AMD and Intel use 8). */
export const REFERENCE_WEIGHT_BITS = 8;
/** The agitation of a texel is judged where at least this many particle clouds reach it (fewer: the variance of a handful of particles). */
export const AGITATION_MIN_CONTRIBUTIONS = 30;
/** Lower bounds of the classes of density (mass a texel) the agitation error is reported by. */
export const AGITATION_DENSITY_CLASSES = [1, 10, 30, 100] as const;
/** Largest median relative error of the agitation of the sparse cloud, grid against CPU. */
export const AGITATION_MEDIAN_LIMIT = 0.05;

/**
 * Haff's law: a cloud of equal grains filling the area uniformly, with Gaussian velocities of standard deviation HAFF_SIGMA
 * (px/s, per axis) and no net momentum, cooling by sticking alone (no gravity, no pressure, no drag, elastic walls). The sticking
 * rate is raised to HAFF_STICK_RATE (the cloud is thin: a texel holds less than one unit of mass) so that the agitation falls
 * by a factor 100 within HAFF_FRAMES frames. The series is read every HAFF_SAMPLE_EVERY frames.
 */
export const HAFF_PARTICLES = 1000000;
export const HAFF_SIGMA = 60;
export const HAFF_FRAMES = 700;
export const HAFF_SAMPLE_EVERY = 20;
export const HAFF_STICK_RATE = 0.015;
/** Texels lighter than this are left out of the grid's mean agitation. */
export const HAFF_MIN_MASS = 0.05;
/** The fit is judged where the agitation is at least this fraction of the initial one (below, the fluctuations of the local mean flows show). */
export const HAFF_FIT_FLOOR = 0.05;
/** Haff's exponent is -2: the fit must find it within this much, with this coefficient of determination of T^(-1/2) against t. */
export const HAFF_EXPONENT_TOLERANCE = 0.1;
export const HAFF_MIN_R2 = 0.99;

/**
 * Arms of the granular sweep (the default cloud under other settings of the sticky dust's grains): stickiness (% of the default),
 * kinetic pressure (1 is the pressure of an ideal gas) and collision speed (px/s).
 */
export const DUST_SWEEP_ARMS: readonly { name: string; stickiness: number; kinetic: number; collisionSpeed: number }[] = [
    { name: 'default', stickiness: 100, kinetic: 1, collisionSpeed: 600 },
    { name: 'no kinetic pressure', stickiness: 100, kinetic: 0, collisionSpeed: 600 },
    { name: 'stickiness 50 %', stickiness: 50, kinetic: 1, collisionSpeed: 600 },
    { name: 'stickiness 125 %', stickiness: 125, kinetic: 1, collisionSpeed: 600 },
    { name: 'stickiness 150 %', stickiness: 150, kinetic: 1, collisionSpeed: 600 },
    { name: 'stickiness 175 %', stickiness: 175, kinetic: 1, collisionSpeed: 600 },
    { name: 'stickiness 200 %', stickiness: 200, kinetic: 1, collisionSpeed: 600 },
    { name: 'collision speed 200', stickiness: 100, kinetic: 1, collisionSpeed: 200 },
    { name: 'collision speed 1000', stickiness: 100, kinetic: 1, collisionSpeed: 1000 },
];

// ---- Cost of the sticky dust in two phases of the default cloud ----
/**
 * The windows timed after a restart (the frames run first, untimed): before the collapse (it comes at about frame 85) and after the
 * first supernova (frame 111). Per window: chunks of PERF_PHASE_CHUNK_FRAMES frames, PERF_PHASE_CHUNKS of them per restart, PERF_PHASE_REPS restarts.
 */
export const PERF_PHASES = [{ name: 'Early', warmupFrames: 10 }, { name: 'Late', warmupFrames: 150 }] as const;
export const PERF_PHASE_COUNTS = [400000, 1000000] as const;
export const PERF_PHASE_CHUNK_FRAMES = 10;
export const PERF_PHASE_CHUNKS = 4;
export const PERF_PHASE_REPS = 5;

// ---- Fusion heating and the noise of the temperature (phase P3a) ----
/**
 * Parameters of the gases of known temperature (set below the sliders' ranges): no gravity, no cooling, with a feedback that
 * makes the heating a sizeable fraction of the thermal energy in one step. The scenarios that need a heating independent
 * of the temperature (hydrogen that fuses at `rate` per second and per rho0 whatever its temperature: the heating is then the
 * same in every cell of a uniform gas) restart with `flatRates`.
 */
export const THERMAL_GAS_OVERRIDES = { gravity: 0, radiation: 0, feedback: 1 } as const;
/** Fusion rate constant (1/s) of the heating test: q dt is then about a twentieth of T0 in one step. */
export const HEATING_RATE = 0.5;
/** Dispersion T of the thermal gases, in T0 (the temperature of the hydrogen law: the rate is lambda rho at it). */
export const THERMAL_GAS_TEMPERATURE = 1;
/** The uniform gas stays this far (px) from the walls, so that no particle reaches one in a step. */
export const THERMAL_GAS_MARGIN = 40;
/** Statistics are taken over the cells at least this many cells inside the gas's box, where a neighborhood is full. */
export const THERMAL_GAS_INTERIOR_CELLS = 3;
/** Particle counts of the uniform gas (about 355 and 1400 particles per 3 x 3 neighborhood): the energy error of a uniform gas is statistical, it falls as 1 / N. */
export const HEATING_UNIFORM_PARTICLES = [400000, 1600000] as const;
/** A software rasterizer cannot draw millions of particles in reasonable time: a smaller gas. */
export const HEATING_UNIFORM_PARTICLES_SOFTWARE = [100000] as const;
/** Blobs on a lattice of this spacing (cells), so that no two share a 3 x 3 neighborhood, of this many particles each. */
export const HEATING_BLOB_SPACING = 4;
export const HEATING_BLOB_PARTICLES = 200;
/** Every this many blobs one is cold (a dispersion, in T0, below the floor of the cold cells: they get the kick), to exercise it. */
export const HEATING_COLD_EVERY = 12;
export const HEATING_COLD_TEMPERATURE = 1e-5;
/** The energy a cold blob gains, against q dt in its own frame: the kick adds a cross term with the blob's thermal velocity, of order sigma / (sqrt(n) kick), a few 1e-3 here. */
export const HEATING_COLD_ENERGY_TOLERANCE = 5e-3;
/** Dispersions of the hot blobs: from this fraction of the uniform gas's to this multiple of it. */
export const HEATING_BLOB_TEMPERATURES = [0.3, 3] as const;
/** The largest bulk velocity of a blob, px/s. */
export const HEATING_BLOB_BULK = 100;
/** The energy a heated blob gains against q dt per particle (the plan's 1e-3), and the momentum it gains against its particles' thermal momentum. */
export const HEATING_ENERGY_TOLERANCE = 1e-3;
export const HEATING_MOMENTUM_TOLERANCE = 1e-4;
export const HEATING_SEED = 5115;

// ---- The noise of the temperature (A3): mean fusion rate of a thermal gas against the true rate ----
/** Particles per 3 x 3 neighborhood of the gases tried (the plan: from 100 to 6 400), and the laws: those of the proton-proton chain and of the triple alpha, at their reference temperatures, where their exponents are the real ones. */
export const NOISE_NEIGHBORHOODS = [100, 200, 400, 800, 1600, 3200, 6400] as const;
export const NOISE_LAWS = [0, 1] as const;   // the reactions of the table whose gas at the reference temperature is drawn: proton-proton (3.9), triple alpha (41)
/** The true rate per particle of the test, per rho0 (1/s): lambda is chosen so that it is this times the density, far below the cap of the rate. */
export const NOISE_RATE = 0.05;
/** The gas is drawn again (a new seed) for each reading, until the standard error of the mean rate is below this fraction, or at most NOISE_MAX_READINGS. */
export const NOISE_TARGET_ERROR = 0.01;
export const NOISE_MIN_READINGS = 4;
export const NOISE_MAX_READINGS = 900;
/** Wall-clock limit of one case, seconds (a case that has not converged stops and reports its error). */
export const NOISE_CASE_BUDGET_SECONDS = 150;
/** The most particles of a case (the box shrinks for the densest gases). */
export const NOISE_MAX_PARTICLES = 1_800_000;
/**
 * A case is judged (the corrected rate within NOISE_TOLERANCE of the true one) when its standard error is below this; the others
 * only report (the triple alpha at 100 particles per neighborhood: 1.055 +- 0.020 after 750 readings).
 */
export const NOISE_JUDGED_ERROR = 0.015;
export const NOISE_TOLERANCE = 0.05;
export const NOISE_SEED = 31337;

// ---- Smoothing of the temperature over time (A3, lever 2) ----
/** A cool gas (T in T0), so that its particles stay inside the box for the run; frames at the step of one substep per frame. */
export const SMOOTHING_TEMPERATURE = 0.25;
export const SMOOTHING_PARTICLES = 400000;
export const SMOOTHING_FRAMES = 150;
/** Time constants tried (s); 0 is no averaging. */
export const SMOOTHING_TAUS = [0, 0.05, 0.1, 0.2, 0.4] as const;
/** Distance (px) of the gas's box from the walls, and of the cells measured from the box's edge: the gas drifts without being replenished. */
export const SMOOTHING_MARGIN = 120;
/** Lags (frames) of the autocorrelation of the temperature. */
export const SMOOTHING_LAGS = [1, 2, 4, 8, 16, 32] as const;

// ---- The coherent supernova (docs/spikes/a9-coherent-supernova.md) ----
export const SUPERNOVA_SEED = 20240613;
/** The blast: a disc of the detection zone's radius holding this share of the particles at the center of the area, the rest uniform, nothing else acting (no gravity, pressure, sticking or drag). */
export const SUPERNOVA_BLAST_PARTICLES = 300000;
export const SUPERNOVA_DISC_SHARE = 0.5;
/** Particles within this many px of the zone's edge are left out of both groups (the center the supernova uses is the disc's center of mass, a pixel or so off). */
export const SUPERNOVA_EDGE_GUARD = 3;
/** Frames the blast waits for the supernova to fire (the first read-back comes at frame 12). */
export const SUPERNOVA_WAIT_FRAMES = 60;
/** Simulated seconds of the front followed after the ejection (the nearest wall is 384 px from the center: the front reaches 550 px by 8 s), and the sample at which the kicks are compared to the formula. */
export const SUPERNOVA_FRONT_SECONDS = 8;
export const SUPERNOVA_KICK_SECONDS = 0.3;
/** The speed of a particle is "kicked" above this (px/s): at rest, nothing acts on it. */
export const SUPERNOVA_KICK_FLOOR = 1;
/** Acceptance of the blast: R^2 of the speed against distance, intercept (share of the edge speed), slope against the formula, front radius error (px), exponent window. */
export const SUPERNOVA_HOMOLOGY_MIN_R2 = 0.9999;
export const SUPERNOVA_HOMOLOGY_MAX_INTERCEPT = 0.01;
export const SUPERNOVA_SLOPE_TOLERANCE = 0.01;
export const SUPERNOVA_FRONT_TOLERANCE = 2;
export const SUPERNOVA_EXPONENT_WINDOW = [1.9, 2.1] as const;
/** The infall test: the cloud of the blast, ejected at the highest and at the lowest power, with and without gravity from the instant of the ejection. */
export const SUPERNOVA_GRAVITY_PARTICLES = 300000;
export const SUPERNOVA_GRAVITY_SECONDS = 8;
/** Largest drift of the mean radial speed of the arm without gravity during the ejection timer (the fastest ejecta reach a wall), and largest ratio between the species' decelerations in the same radial bin. */
export const INFALL_DRIFT_LIMIT = 0.02;
export const INFALL_EQUIVALENCE_LIMIT = 1.5;
export const SUPERNOVA_POWERS = [70, 5] as const;
/** Frames (after the ejection) at which the arms of the infall test are compared during the ejection timer, and every this many frames after. */
export const SUPERNOVA_TIMER_FRAMES = [2, 8, 16, 24] as const;
export const SUPERNOVA_SAMPLE_EVERY = 10;
/** Radial bin (share of the zone's radius) the species' deceleration is compared in. */
export const SUPERNOVA_BIN = [0.15, 0.6] as const;
/** The history: the default cloud for this many frames (30 s of simulated time at the default speed), the density grid read every SUPERNOVA_HISTORY_SAMPLE frames, the ejecta followed this long. */
export const SUPERNOVA_HISTORY_FRAMES = 1200;
export const SUPERNOVA_HISTORY_SAMPLE = 20;
export const SUPERNOVA_HISTORY_FOLLOW_SECONDS = 8;
export const SUPERNOVA_HISTORY_MARKS = [0.5, 1, 2, 3, 4, 8] as const;
/** Radii (px) within which the share of the mass is recorded at each event: how compact the cluster is. */
export const SUPERNOVA_HISTORY_PROFILE = [5, 10, 20, 40] as const;

/** Ejection speeds (rms, px/s) of the sweep that tunes SUPERNOVA_SPEED; 294 is the default before A9 (70 % of 420), 588 the one of this build (70 % of 840). */
export const SUPERNOVA_SWEEP_SPEEDS = [294, 588, 735] as const;
/** Clouds (seeds from SUPERNOVA_SEED up) run per speed: the history is chaotic, one run says little. */
export const SUPERNOVA_SWEEP_SEEDS = 3;

/**
 * The GPU search of the densest disk against its CPU reference (dust.concentration.parity, docs/spikes/b4-gpu-concentration.md): the particles
 * of the comparisons, the snapshots of the default cloud's collapse (frames after the restart), the radii (px; the slider goes from 10 to 400),
 * and the share of the total mass, in percentage points, the two may differ by (the center may differ by one cell of the coarse grid).
 */
export const CONCENTRATION_PARITY_PARTICLES = 400000;
export const CONCENTRATION_PARITY_HEAVY_PARTICLES = 3000000;
export const CONCENTRATION_PARITY_SNAPSHOTS = [0, 60, 120, 180, 300] as const;
export const CONCENTRATION_PARITY_RADII = [10, 30, 150, 400] as const;
export const CONCENTRATION_PARITY_SHARE_POINTS = 2;

/**
 * The hitches of the periodic concentration read (perf.dustHitch.<count>): frames of the default cloud with no supernova (the read repeats every
 * CLUSTER_CHECK_INTERVAL frames), each followed by a wait for the GPU; the frames from a request up to HITCH_WINDOW_FRAMES - 1 later are "the read-back
 * frames", the others "the quiet frames".
 */
export const HITCH_COUNTS = [400000, 1000000, 3000000] as const;
export const HITCH_WARMUP_FRAMES = 30;
export const HITCH_FRAMES = 360;
export const HITCH_WINDOW_FRAMES = 4;

/** The default cloud's supernova history at the default power over several seeds (dust.supernova.seeds): the clouds, from SUPERNOVA_SEED up. */
export const SUPERNOVA_SEEDS_RUNS = 3;

/** The cost of one GPU search of the densest disk (perf.dustConcentration.<count>): the counts, the frames of the default cloud's collapse before it is timed, the batches timed. */
export const CONCENTRATION_COST_COUNTS = [400000, 1000000, 3000000] as const;
export const CONCENTRATION_COST_FRAMES = 150;
export const CONCENTRATION_COST_REPEATS = 5;

// ---- Mean molecular weight (proposal A1) ----
/** Equal-dispersion check: particles, density (rho0) and seed of the thermal gases of pure hydrogen, pure helium and a mixture. */
export const MU_GAS_PARTICLES = 400_000;
export const MU_GAS_DENSITY = 4;
export const MU_GAS_SEED = 7771;
/** Number of helium atoms per hundred atoms in the mixed gas. */
export const MU_MIXED_HELIUM_PERCENT = 20;
/** The mixture's dispersion against the hydrogen gas's (the same velocities, other weights: a statistical difference, about 0.2 %). */
export const MU_MIXED_DISPERSION_TOLERANCE = 0.01;
/** The factor mu / mu_H of each gas against its reference (the pure ones are exact to rounding, the mixture to the sums' rounding). */
export const MU_FACTOR_TOLERANCE = 1e-4;
/** The same where the deposit sums are half floats (a device without EXT_float_blend): see docs/spikes/a1-second-deposit.md. */
export const MU_FACTOR_TOLERANCE_HALF_FLOAT = 0.06;
/**
 * Ignition on thermal gases: particles of each gas and its density (rho0: the densest uniform gas that leaves interior
 * cells, all the mass of the simulation in a square of 14 cells), the temperatures (in T0, as the gas reads them, the
 * dispersion of a helium gas being 2.65 times lower) it is drawn at, the reference rates of the ignition and the tolerance of
 * the rate against the law's twin.
 */
export const IGNITION_GAS_PARTICLES = 1_000_000;
export const IGNITION_GAS_DENSITY = 20;
/** 36 temperatures, 10 % apart, from 6 MK to 195 MK: the triple alpha goes from 1 to 100 fusions per second (the cap) in a factor of 1.2 of the temperature, a coarser scan misses its ignition at 10 per second. */
export const IGNITION_GAS_TEMPERATURES: readonly number[] = Array.from({ length: 36 }, (_, i) => Number((0.4 * (13 / 0.4) ** (i / 35)).toPrecision(4)));
export const IGNITION_GAS_RATES = [0.01, 0.1, 0.5, 1, 10] as const;
/** The decades of the rate (a decade of lambda at a given density is a decade of the rate) over which the shift of the ignition temperature is reported. */
export const IGNITION_GAS_DECADES = [[0.01, 0.1], [0.1, 1], [1, 10]] as const;
export const IGNITION_GAS_SEED = 4242;
export const IGNITION_GAS_TOLERANCE = 0.1;

// ---- Gamow rates (proposal A2) ----
/** The mass fractions X and Y of the gas pass against the CPU deposit (float32: the sums' rounding; half float: see docs/spikes/a1-second-deposit.md). */
export const GAMOW_FUEL_TOLERANCE = 1e-4;
export const GAMOW_FUEL_TOLERANCE_HALF_FLOAT = 0.06;
/** The mean of X and of Y over the cells against the mass shares of the whole gas (a statistical difference: 0.3 % at 400 000 particles, and 2 % in half floats). */
export const GAMOW_FUEL_MEAN_TOLERANCE = 0.02;
/** The local exponent is measured between two gases of the same particles at T (1 - step) and T (1 + step); the error allowed against the theory (the plan: 5 %). */
export const GAMOW_STEP = 0.05;
export const GAMOW_EXPONENT_TOLERANCE = 0.05;
/** The rate (1/s per particle) the rate constant is chosen to give at each point: far from the cap and from zero. */
export const GAMOW_TARGET_RATE = 0.2;
/** The points of the measure: the reaction of the table, the temperature (K) of the gas: 3.9 at 15 MK for pp, 41 at 100 MK and 19 at 200 MK for the triple alpha. */
export const GAMOW_POINTS = [
    { reaction: 0, kelvin: 8e6 }, { reaction: 0, kelvin: 15e6 }, { reaction: 0, kelvin: 30e6 },
    { reaction: 1, kelvin: 70e6 }, { reaction: 1, kelvin: 100e6 }, { reaction: 1, kelvin: 200e6 },
] as const;

// ---- Fusion of parcels of constant mass (proposal A4) ----
/**
 * Conservation of the momentum (protostar.constant-mass.momentum): a gas of this many particles, of the density `density` (rho0), drawn cold (a
 * thermal speed of `sigma` px/s) and moving as a whole (`bulk`), gravity off, a rate of fusion that does not depend on the temperature (the rate
 * constants below, per second and per rho0) so that it all fuses within the run; `substeps` substeps of a time step of `timeScale` x BASE_DT, one per
 * frame (the gas stays inside the walls: the fastest particle crosses a fifth of the area). The momentum is summed in double precision from a
 * read-back of the velocities and of the types, at `checkpoints` instants, against the thermal momentum M sigma.
 */
export const CONSTANT_MASS_MOMENTUM = {
    particles: 100_000, density: 2, sigma: 2, bulk: [3, 1.5], heliumPercent: 20, hydrogenRate: 0.2, heliumRate: 0.3,
    substeps: 10_000, timeScale: 0.05, checkpoints: 10, seed: 6161,
} as const;
/** The fusion-only run must conserve the momentum to this fraction of the thermal momentum (it is exact: nothing else acts on the velocities). */
export const CONSTANT_MASS_MOMENTUM_TOLERANCE = 1e-6;
/** The same run with the cooling at its default and a feedback of the sliders' minimum: reported, not judged (the cooling and the heating work around a local mean). */
export const CONSTANT_MASS_FEEDBACK = 0.01;
/**
 * The energy accounting (protostar.constant-mass.energy): pure gases of this many particles at `density` (rho0), a rate of fusion that does not
 * depend on the temperature, the feedback at 1, `steps` single substeps of BASE_DT; at each step the fusions that happened (the changes of type
 * read back) against the expected ones (the power grid's fusion rate x dt) and the energy they released against the grid's power x dt.
 */
export const CONSTANT_MASS_ENERGY = { particles: 400_000, density: 2, sigma: 2, hydrogenRate: 0.3, heliumRate: 0.1, steps: 100, seed: 6262 } as const;
/** The measured against the expected number of fusions, and the released against the deposited energy, summed over the steps: the Poisson noise of the events (0.2 %) and the saturation of 1 - exp(-rate dt) (0.3 %). */
export const CONSTANT_MASS_ENERGY_TOLERANCE = 0.02;
/** The frames of the default cloud drawn by protostar.constant-mass.appearance (the whole rendering stack, the canvas read back as a JPEG). */
export const CONSTANT_MASS_APPEARANCE_FRAMES = [100, 300, 700, 1200] as const;
export const CONSTANT_MASS_APPEARANCE_QUALITY = 0.8;
/** The population of the default cloud (protostar.constant-mass.population): snapshots every this many frames over `baselineFrames`, and the radius (px) of the core around the densest cell. */
export const CONSTANT_MASS_POPULATION_EVERY = 100;
export const CONSTANT_MASS_CORE_RADIUS = 40;
/** Frame times over the periodic readings of the protostar (perf.protostarHitch.<count>): the counts, the frames run untimed, the frames timed. */
export const PROTOSTAR_HITCH_COUNTS = [400_000, 1_000_000, 2_000_000] as const;
export const PROTOSTAR_HITCH_WARMUP_FRAMES = 30;
export const PROTOSTAR_HITCH_FRAMES = 360;
/** The cost of one GPU count of the types (cost.protostar.type-count.<count>): the counts, the frames of the default cloud run first, the counts queued back to back per batch, the batches. */
export const TYPE_COUNT_COST_COUNTS = [400_000, 1_000_000, 2_000_000, 3_000_000] as const;
export const TYPE_COUNT_COST_FRAMES = 30;
export const TYPE_COUNT_COST_QUEUED = 10;
export const TYPE_COUNT_COST_BATCHES = 5;
/** The cost of the protostar in two phases of the default cloud (perf.protostarPhases.<count>): the counts, the window timed in chunks of this many frames, the early and the late phase (the frames run before it: the hydrogen is mostly burnt by the late one). */
export const PROTOSTAR_PHASE_COUNTS = [400_000, 1_000_000] as const;
export const PROTOSTAR_PHASE_CHUNK_FRAMES = 10;
export const PROTOSTAR_PHASE_CHUNKS = 4;
export const PROTOSTAR_PHASES = [{ name: 'early', warmupFrames: 10 }, { name: 'late', warmupFrames: 1000 }] as const;

// ---- Thin-disc cooling and Jeans floor (phase P4: A6, A13) ----
/**
 * protostar.thin-disc-cooling: blobs (on the lattice of the heating's, isolated cells) of these dispersions (T0) and particle counts, hydrogen
 * and helium in turn, cooled for one substep at c = COOLING_RATE, kappa = COOLING_OPACITY and T_min = COOLING_FLOOR (T0): the hot blobs' steps
 * are stiff (3 c mu T^3 dt / (Sigma tau_eff) up to 7e5), the coldest hydrogen blobs are below the floor and the thinnest helium ones cool down
 * to it, the others follow the law. The blobs' bulk velocities go up to COOLING_BLOB_BULK px/s. The dispersion ratio must be the exact
 * law's, and the mean velocity must stay, within COOLING_TOLERANCE (rounding of float32 sums).
 */
export const COOLING_BLOB_TEMPERATURES = [0.1, 0.6, 1.5, 3, 10] as const;
export const COOLING_BLOB_COUNTS = [50, 200, 800] as const;
export const COOLING_RATE = 30;
export const COOLING_OPACITY = 20;
export const COOLING_FLOOR = 0.3;
export const COOLING_BLOB_BULK = 100;
export const COOLING_TOLERANCE = 3e-4;
export const COOLING_SEED = 6601;
/** The blobs' cells stay this many cells from the walls: a hot blob's particles move a few px in a step and must not bounce. */
export const COOLING_WALL_CELLS = 4;
/**
 * protostar.jeans-floor: the blobs at the default gravity (the floor is proportional to G) must end at the floor (or be left alone) within
 * JEANS_TOLERANCE; then the default cloud with the flag off and on, JEANS_CLOUD_FRAMES frames, the Jeans length counted over the cells of
 * at least JEANS_CLOUD_MIN_DENSITY rho0 (the cloud's own gas; the thin outskirts are resolved anyway).
 */
export const JEANS_GRAVITY = PROTOSTAR_GRAVITY_SLIDER.default;
export const JEANS_TOLERANCE = 3e-4;
export const JEANS_CLOUD_FRAMES = 600;
export const JEANS_CLOUD_MIN_DENSITY = 1;

// ---- Stability map (phase P1b: A12) ----
/**
 * protostar.stability-map: the default cloud of STABILITY_PARTICLES at t = 0, its map on the GPU against the TypeScript twin on the grids read
 * back (the 99th percentile of the relative difference of Q and of beta within STABILITY_PARITY_TOLERANCE, the cells' classes the same in all
 * but STABILITY_CLASS_MISMATCH of them), and the medians of the map over rings of half-width STABILITY_RING_WIDTH R at STABILITY_RADII R against
 * Q measured on the particles (toomre.ts). protostar.stability-evolution: the same cloud run for STABILITY_EVOLUTION_SECONDS, its map read every
 * STABILITY_EVOLUTION_EVERY s.
 */
export const STABILITY_PARTICLES = 400000;
export const STABILITY_PARITY_TOLERANCE = 1e-3;
export const STABILITY_CLASS_MISMATCH = 1e-3;
export const STABILITY_RADII = [0.1, 0.2, 0.25, 0.5, 0.75, 0.9] as const;
export const STABILITY_RING_WIDTH = 0.05;
export const STABILITY_EVOLUTION_SECONDS = 30;
export const STABILITY_EVOLUTION_EVERY = 1.5;

// ---- TSC deposit (C4) ----
/**
 * deposit.tsc.parity: the protostar's deposit (SECOND_DEPOSIT_PARTICLES of the default cloud after SECOND_DEPOSIT_FRAMES) and the dust's
 * (its sparse cloud) with each kernel against the CPU reference of each kernel. protostar.tsc.noise: a thermal gas at rest of
 * TSC_NOISE_TEMPERATURE T0 filling the area but THERMAL_GAS_MARGIN px, TSC_NOISE_COUNTS particles, TSC_NOISE_DRAWS draws each: the noise of the
 * temperature and of the density from cell to cell, per kernel. protostar.tsc.aliasing: a blob of TSC_BLOB_PARTICLES particles at one point
 * at TSC_BLOB_OFFSETS of a cell (along the diagonal) from a cell center, massless probes on rings of TSC_RING_RADII cells at TSC_RING_ANGLES
 * angles: the pull against the blob's place in its cell and against the angle, and the blob's force on itself. dust.tsc.noise: a uniform
 * cloud of TSC_DUST_COUNTS grains over the middle TSC_DUST_FILL of the area (each axis), the relative variance of the mass of the texels of
 * the density grid and of its first TSC_DUST_LEVELS coarser levels (the gravity's), per kernel. cost.tsc-deposit: simulation ms per frame
 * alternated between the kernels, chunk after chunk (COST_ROUNDS of COST_CHUNK_FRAMES), at TSC_COST_PROTOSTAR_COUNTS and
 * TSC_COST_DUST_COUNTS, after COST_EARLY_FRAMES frames of the default cloud, and the deposit passes alone on that frozen state.
 */
export const TSC_NOISE_TEMPERATURE = 1;
export const TSC_NOISE_COUNTS = [100_000, 400_000, 1_600_000] as const;
export const TSC_NOISE_DRAWS = 4;
export const TSC_BLOB_PARTICLES = 4096;
export const TSC_BLOB_OFFSETS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] as const;
export const TSC_RING_RADII = [1.5, 3, 6, 12, 24] as const;
export const TSC_RING_ANGLES = 32;
export const TSC_DUST_COUNTS = [100_000, 400_000, 1_000_000] as const;
export const TSC_DUST_FILL = 0.6;
export const TSC_DUST_LEVELS = 4;
export const TSC_COST_PROTOSTAR_COUNTS = [400_000, 1_000_000] as const;
export const TSC_COST_DUST_COUNTS = [400_000, 1_000_000, 3_000_000] as const;
