// Every tunable constant of the simulation and its rendering.

// ---- Simulation ----
export const TEX_SIZE = 1733;                      // 1733x1733 = 3 003 289 slots (>= the largest particle count slider, 3 000 000)
export const MAX_PARTICLES = TEX_SIZE * TEX_SIZE;
export const BASE_DT = 1 / 60;

// ---- Initial donut ----
export const DONUT_INNER = 0.12;                   // fraction of min(width, height)
export const DONUT_OUTER = 0.40;
/** Slider steps of the speed slider per press of PageUp/PageDown (render area focused). */
export const SPEED_SHORTCUT_STEPS = 10;
/** View zoom (rendering only: the simulation world does not change). */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 16;
export const ZOOM_KEY_FACTOR = 1.1;                // per press (or repeat) of the + / - key
export const PAN_KEY_PX = 40;                      // screen px per press (or repeat) of an arrow key
export const ZOOM_WHEEL_SENSITIVITY = 0.0015;      // zoom exponent per wheel pixel
export const ZOOM_WHEEL_LINE_PX = 16;              // pixels of a wheel "line" (deltaMode 1)
export const INITIAL_SPEED = 20;                   // px/s

// ---- Gravity field ----
// Total mass is constant, so the dynamics (and timescale) don't depend on the particle count.
export const TOTAL_MASS = 20000;
// Power-of-two square field so every mip level halves exactly. Coarse mip texels pull mass toward
// their own centers; shifting the grid randomly every step averages that bias out. The field is
// twice the screen size so the screen stays inside it for any shift.
export const DENSITY_RES = 512;
export const DENSITY_DOMAIN_SCALE = 2;
/** Highest mip level of the density field that carries a gradient (the 1x1 level carries none). */
export const DENSITY_TOP_LEVEL = Math.log2(DENSITY_RES) - 1;
/**
 * The gravity of the sticky dust is computed per texel, only where the particles can read it: the
 * screen's window of the density field plus this margin (density texels, bilinear footprint included).
 */
export const GRAVITY_WINDOW_MARGIN = 2;
/**
 * Stencil of the gradient of each coarse level in the sticky dust's gravity: the difference across a
 * texel is averaged over the three rows with the weights w, 1 - 2w, w. 0 is the plain central difference
 * (a square kernel: the pull of a point mass varies by about 38 % with the angle), 3/16 the isotropic
 * stencil of Scharr (about 9 % at its worst radius). 0.21 balances the median and the worst radius
 * (3.9 % and 4.9 %): see docs/spikes/b1-dust-gravity.md.
 */
export const DUST_GRADIENT_CORNER_WEIGHT = 0.21;
/**
 * The pull of the sticky dust is the gravity slider's value times this gain. The isotropic stencil of the coarse
 * levels (above) weakens the pull of the small structures of a clumped cloud to 84-85 % of the central difference's
 * (RMS); the gain restores the strength the sliders' values were tuned for: docs/spikes/a10-granular-dust.md.
 */
export const DUST_GRAVITY_GAIN = 1.2;
// Weight of mip level L is 2^(L * LONG_RANGE): 0 gives a 1/r^2 pull, 1 gives 1/r (2D gravity).
// In between, distant clumps still find each other and merge.
export const LONG_RANGE = 0.5;
export const K_PRESSURE = 40;
export const REST_DENSITY = 30;                    // mass per density texel above which clumps push back

// ---- Granular dust (sticking, agitation and pressure of the sticky dust) ----
// The density grid's alpha channel holds the agitation energy: m |v - v_ref|^2 * ENERGY_SCALE (cloud-in-cell
// weighted), v_ref the mean flow of a coarse level of the previous substep's density. The scale keeps the sums inside
// half-float range (65 504): a texel of mass 128, about all the half floats let a cell hold at 400 000 particles, whose
// grains all fly at 3000 px/s from the reference sums to 11 500. The reference keeps E / rho - |u|^2 free of cancellation.
export const ENERGY_SCALE = 1e-5;
/** Mip level of the density (DENSITY_RES >> level texels a side) whose mean flow is the deposit's reference velocity. */
export const REFERENCE_LEVEL = 5;
// T = <|v|^2> - |u|^2 (px^2/s^2) is the agitation of a texel. Haff's law: grains collide at a frequency
// proportional to rho sqrt(T) and stick, so velocities relax toward the local mean flow at nu = STICK_RATE x
// stickiness x rho x sqrt(T) (1/s, rho in mass per texel, T in px^2/s^2): T falls as 1 / (1 + t / t0)^2.
export const STICK_RATE = 8e-3;
/** Fractions of REST_DENSITY between which the grains are in contact (the pressure acts, from nothing to all of it). */
export const CONTACT_RANGE: Range = [0.1, 0.6];
// Kinetic pressure, P = rho T / 2 (two degrees of freedom), acts as -grad(P) / rho on the grains in contact. Its time
// step is bounded: the sound speed sqrt(T / 2) cannot cross more than PRESSURE_CFL texels per substep.
export const KINETIC_PRESSURE = 1;
export const PRESSURE_CFL = 1;
/** Speeds (px/s) of the agitation sqrt(T) between which a particle glows from nothing to full. */
export const GLOW_AGITATION_RANGE: Range = [5, 60];
export const GLOBAL_DRAG = 0.03;                   // 1/s
export const MAX_SPEED = 1500;                     // px/s
export const RESTITUTION = 0.8;
export const MOMENTUM_SCALE = 0.01;                // keeps splatted momentum inside half-float range

// ---- Supernova ----
export const CLUSTER_CHECK_INTERVAL = 12;          // frames
// The search of the densest disk of the detection radius (simulation/concentration.ts, and its GPU twin in stickyDust/concentrationReduction.ts):
// the particles' masses are summed in square cells of CONCENTRATION_CELLS_PER_RADIUS to the radius (at least CONCENTRATION_MIN_CELL px a side),
// the densest disk of cells is refined on the particles themselves. On the GPU the particles that pass the disk are summed in
// CONCENTRATION_BINS x CONCENTRATION_BINS bins (spreads the blending over many texels), then reduced CONCENTRATION_REDUCE_BLOCK x BLOCK texels at a time.
export const CONCENTRATION_CELLS_PER_RADIUS = 4;
export const CONCENTRATION_MIN_CELL = 2;           // px
export const CONCENTRATION_BINS = 64;
export const CONCENTRATION_REDUCE_BLOCK = 16;
// A collapsed clump puts millions of particles in a few cells, and blending that many float32 additions into one texel serializes in the
// ROP (11 to 16 ms at 3 000 000 particles): each cell is therefore drawn into up to CONCENTRATION_REPLICAS copies (chosen by the particle's
// index, laid out in tiles CONCENTRATION_REPLICA_COLUMNS wide) that a pass folds into one grid. The copies are limited to a budget of texels.
export const CONCENTRATION_REPLICAS = 16;
export const CONCENTRATION_REPLICA_COLUMNS = 4;
export const CONCENTRATION_REPLICA_BUDGET = 1 << 20;
export const SUPERNOVA_SPEED = 840;                // px/s at 100 % power (scaled by the power slider): rms speed of the ejecta, initial speed of the shock wave
// The ejecta fly out as v = H r (homologous): H is set so that the mass-weighted rms speed is the ejection speed, whatever the
// size of the cluster (the explosion releases the same energy per unit of mass in a compact clump as in a diffuse one). The
// size of the cluster is its rms radius, bounded below by this fraction of the detection radius.
export const EJECTA_RADIUS_FLOOR = 0.1;
export const EJECT_TIME = 0.6;                     // s during which ejecta feel neither pressure nor sticking (fading back in); gravity always acts
export const SUPERNOVA_COOLDOWN = 240;             // frames (6 s at the default speed)
// Shock wave: the front starts at the edge of the detection zone at the ejection speed and slows down as
// dR/dt = K / R (R ~ t^(1/2)); the outward kick it gives is SHOCK_STRENGTH * the front's speed, so it
// falls off as 1/r.
export const SHOCK_STRENGTH = 0.9;
export const SHOCK_MIN_KICK = 0.03;                // fraction of the ejection speed below which the wave dies

// ---- Panel parameters of the sticky dust algorithm (slider min, max, step and default) ----
export const PARTICLE_COUNT_SLIDER: SliderSpec = { min: 1000, max: 3000000, step: 1000, default: 400000 };
export const GRAVITY_SLIDER: SliderSpec = { min: 0, max: 15, step: 0.1, default: 2.5 };
export const SUPERNOVA_THRESHOLD_SLIDER: SliderSpec = { min: 0, max: 100, step: 1, default: 37 };  // % of the total mass
export const CONCENTRATION_RADIUS_SLIDER: SliderSpec = { min: 10, max: 400, step: 5, default: 65 }; // px
export const SUPERNOVA_POWER_SLIDER: SliderSpec = { min: 5, max: 100, step: 5, default: 70 };      // % of SUPERNOVA_SPEED
export const STICKINESS_SLIDER: SliderSpec = { min: 0, max: 400, step: 5, default: 100 };               // % of STICK_RATE
export const COLLISION_SPEED_SLIDER: SliderSpec = { min: 20, max: 1500, step: 10, default: 600 };    // px/s, above it grains bounce

// ---- Removed particles (common GPU contract) ----
// A particle whose position w is negative has been removed (e.g. absorbed by a fusion): it is
// neither drawn nor deposited on any grid nor counted. Live particles have w = 1.
export const REMOVED_PARTICLE_W = -1;

// ---- Protostar (hydrogen and helium fusion) algorithm ----
// Lengths are measured in L = min(width, height) of the simulation area, frozen at restart, so the
// behavior does not depend on the screen size; masses in fractions of TOTAL_MASS; time in s.
// Gravity and gas grids: GRID_RES^2 square cells over max(width, height), from the origin.
export const PROTOSTAR_GRID_RES = 128;
// Gravity is summed cell to cell in two levels: the coarse grid groups GRID_COARSE_FACTOR^2 fine
// cells (monopole at their center of mass); coarse cells within GRID_NEAR_RADIUS (Chebyshev) of a
// cell's own coarse cell are summed fine cell by fine cell.
export const PROTOSTAR_COARSE_FACTOR = 4;
export const PROTOSTAR_NEAR_RADIUS = 2;
// G slider -> G_eff = G * GRAVITY_UNIT * L^3 / TOTAL_MASS (px^3 / (mass s^2)).
export const PROTOSTAR_GRAVITY_UNIT = 0.001;
export const PROTOSTAR_CLOUD_RADIUS = 0.38;        // initial cloud radius / L
// Initial conditions (initialConditions.ts, disc.ts, turbulence.ts). The disc's self-gravity is tabulated at restart: the
// table has DISC_TABLE_NODES intervals, each ring integral is cut into DISC_UNIFORM_PANELS equal panels plus panels graded
// towards the field point and (Maclaurin) towards the edge, DISC_EDGE_PANELS of them, of DISC_PANEL_POINTS Gauss-Legendre
// points each; a softening below DISC_MIN_SOFTENING x R is taken as that (the quadrature's panels would crowd to nothing).
export const PROTOSTAR_DISC_TABLE_NODES = 256;
export const PROTOSTAR_DISC_PANEL_POINTS = 8;
export const PROTOSTAR_DISC_UNIFORM_PANELS = 16;
export const PROTOSTAR_DISC_EDGE_PANELS = 16;
export const PROTOSTAR_DISC_MIN_SOFTENING = 1e-4;
// The correlated agitation is a solenoidal Gaussian field of power P(k) ~ k^-TURBULENCE_SLOPE per Fourier mode of the plane
// (a velocity spectrum E(k) = 2 pi k P(k) ~ k^-2 per wave number: the supersonic turbulence of molecular clouds, Larson's
// law v ~ l^1/2), on a TURBULENCE_GRID x TURBULENCE_GRID grid spanning the cloud's diameter, for the wave numbers of
// TURBULENCE_K_RANGE (1 is one wavelength across the diameter; the largest is 8 cells a wavelength, which the bilinear
// sampling keeps to within 8 % of the amplitude).
export const PROTOSTAR_TURBULENCE_GRID = 64;
export const PROTOSTAR_TURBULENCE_SLOPE = 3;
export const PROTOSTAR_TURBULENCE_K_RANGE: Range = [1, 8];
// Temperature unit, T0 = FUSION_T_REF * (L/s)^2, which stands for T0_KELVIN (the core of the Sun);
// densities in rho0, the initial mean density of the cloud. A reaction's rate per particle is
// lambda * (rho/rho0)^n * (T/T_ref)^alpha, capped at FUSION_RATE_MAX (1/s): the cap is above 1 / dt, so
// it only keeps the steepest laws finite, a capped particle fuses within a few steps anyway.
export const PROTOSTAR_FUSION_T_REF = 0.02;
export const PROTOSTAR_T0_KELVIN = 1.5e7;
export const PROTOSTAR_HE_IGNITION_KELVIN = 1e8;   // triple alpha
export const PROTOSTAR_FUSION_RATE_MAX = 100;
// Specific energy released by a fusion: (mass defect / fused mass) * c^2, with c^2 = FUSION_C2 * T0.
export const PROTOSTAR_FUSION_C2 = 2000;
// Fusion heating (A5): a cell whose velocity dispersion is below HEATING_T_FLOOR (in T0) is too cold to be heated by
// scaling its velocities around the mean (the energy added is proportional to the dispersion): its particles get a kick
// in a random direction instead, of the same mean energy.
export const PROTOSTAR_HEATING_T_FLOOR = 1e-3;
// Noise of the temperature (A3). The temperature of a neighborhood is estimated from a few particles, with a relative
// noise of 1 / sqrt(N); a rate that grows as T^alpha is then too high on average, by about exp(alpha (alpha - 3) / 2N)
// for large N (noiseBias.ts). Two remedies: the rate is divided by that bias, with N the effective number of particles
// of the neighborhood, and the temperature that feeds the rate is averaged over time.
// NOISE_N_SHAPE: the effective number of particles of the temperature a particle sees over the (sum m)^2 / sum m^2 of
// its 3 x 3 neighborhood: the cloud-in-cell weights, the sum over 3 x 3 cells and the bilinear interpolation spread the
// particles' weights, 1.27 for a particle at a cell center and up to 1.65 between four cells; 1.5 is what the lab measures
// (the bias of a thermal gas at alpha = 40, protostar.temperature-noise).
// NOISE_N_MIN: the smallest shape of the temperature's Gamma law (below it the temperature carries no information).
// TEMPERATURE_TAU: time constant (s) of the exponential average of the temperature, well below the cooling time.
export const PROTOSTAR_NOISE_N_SHAPE = 1.5;
export const PROTOSTAR_NOISE_N_MIN = 1;
export const PROTOSTAR_TEMPERATURE_TAU = 0.1;
export const PROTOSTAR_RESTITUTION = 0.5;          // walls
export const PROTOSTAR_MAX_SPEED = 2;              // L/s
export const PROTOSTAR_DRIFT_GAIN = 0.5;           // fraction of the measured drift of the star taken off at each read-back
export const PROTOSTAR_STATS_INTERVAL = 10;        // frames between two GPU reductions of the stats
export const PROTOSTAR_STATS_REDUCE_RES = 16;      // first reduction stage (GRID_RES / 16 = 8 x 8 cells each)
// Energy diagnostics (reduction.ts, energy.ts): besides the stats' frames, the first frame is read too, so that the
// initial energy is the one of the start and not of 10 frames of cooling later.
export const PROTOSTAR_ENERGY_FIRST_FRAME = 1;
// A virial ratio or an energy drift is not shown when the potential (or the total) energy is below this fraction of
// |K| + |U|: the quantity it divides by is then noise, not a scale.
export const PROTOSTAR_ENERGY_RATIO_FLOOR = 1e-6;
export const PROTOSTAR_RATE_SMOOTHING = 0.3;       // weight of a new fusion rate reading (exponential smoothing)
// Glow of the particles (0..GLOW_MAX), read by the particle layer from velocity w: it rises with
// the local temperature (T/T0 over GLOW_T_RANGE) and with the local fusion heating (per unit mass,
// in T0 per second, GLOW_HEATING_REF giving full glow).
export const PROTOSTAR_GLOW_T_RANGE: Range = [1, 7];  // 15 to 105 MK: helium burning shines brightest
export const PROTOSTAR_GLOW_TEMPERATURE = 0.7;
export const PROTOSTAR_GLOW_HEATING_REF = 0.3;
export const PROTOSTAR_GLOW_FUSION = 1.3;
export const PROTOSTAR_GLOW_MAX = 2;
// Panel parameters (slider min, max, step, default).
// G and lambda_0 were recalibrated for the mean molecular weight in the temperature (A1: docs/spikes/a1-mean-molecular-weight.md):
// the default cloud burns hydrogen at about 15 MK (T0) and helium at about 100 MK, as read by a thermometer. G 13.85 -> 9 (the core
// of a hydrogen star settles at about 1.6 MK per unit of G), lambda_0 1.5e-4 -> 4e-3 (so that hydrogen burns at 15 MK and not at 55).
// A minimal change: the fine recalibration (G, lambda, alpha, feedback, glow ranges) belongs to the Gamow rates of A2.
export const PROTOSTAR_COUNT_SLIDER: SliderSpec = { min: 1000, max: 2000000, step: 1000, default: 400000 };
export const PROTOSTAR_ROTATION_SLIDER: SliderSpec = { min: 0, max: 1, step: 0.01, default: 0.44 };       // x v_circ
export const PROTOSTAR_AGITATION_SLIDER: SliderSpec = { min: 0, max: 1.5, step: 0.01, default: 0.26 };    // x v_circ(R)
export const PROTOSTAR_GRAVITY_SLIDER: SliderSpec = { min: 0.1, max: 20, step: 0.05, default: 9 };
export const PROTOSTAR_SOFTENING_SLIDER: SliderSpec = { min: 0.2, max: 5, step: 0.1, default: 1.6 };       // % of L
export const PROTOSTAR_COOLING_SLIDER: SliderSpec = { min: 0, max: 3, step: 0.01, default: 0.51 };        // 1/s
export const PROTOSTAR_OPACITY_SLIDER: SliderSpec = { min: 1, max: 1000, step: 0, default: 5.32 };         // rho0, log
export const PROTOSTAR_LAMBDA_SLIDER: SliderSpec = { min: 1e-7, max: 1e-2, step: 0, default: 4e-3 };       // 1/s, log
export const PROTOSTAR_ALPHA_SLIDER: SliderSpec = { min: 1, max: 6, step: 0.1, default: 2.8 };            // real value: about 4 at 15 MK
export const PROTOSTAR_HE_LAMBDA_SLIDER: SliderSpec = { min: 1e-10, max: 1e-2, step: 0, default: 3.75e-5 };  // 1/s at 100 MK and rho0, log
export const PROTOSTAR_HE_ALPHA_SLIDER: SliderSpec = { min: 1, max: 45, step: 0.5, default: 16 };        // real value: about 40 at 100 MK
export const PROTOSTAR_FEEDBACK_SLIDER: SliderSpec = { min: 0.01, max: 100, step: 0, default: 0.146 };       // log
export const PROTOSTAR_H_SIZE = 1.6;               // px, default rendered diameters
export const PROTOSTAR_HE_SIZE = 2.4;
export const PROTOSTAR_C_SIZE = 3.2;
// The protostar's masses are those of the isotopes that react (hydrogen 1, helium 4, carbon 12), as
// their differences give the energy of the reactions: 26.7 MeV for 4 H -> He.
export const HYDROGEN_1_MASS = 1.00783;
// Carbon 12, the product of triple alpha, and not the standard atomic weight of carbon (12.011 u, a
// mix with carbon 13): three helium atoms weigh 12.0078 u, the reaction would release no energy.
export const CARBON_12_MASS = 12;
// Mean molecular weight of a fully ionised gas: 1 / mu = (1 + Z) / A (one nucleus and Z electrons per A u).
// For a type whose symbol is not an element of the table, Z is taken as A * this ratio (the valley of
// stability: about as many neutrons as protons in the light nuclei).
export const PROTONS_PER_NUCLEON = 0.5;
// The protostar's temperature is the velocity dispersion times the mean molecular weight of the gas (A1), normalised to pure
// hydrogen: T = (mu / mu_H) <|v - u|^2>, so that T0 (15 MK) still stands for a hydrogen gas of that dispersion. This is
// 1 / mu_H, (1 + Z) / A of hydrogen 1 (1.984 per u, mu_H = 0.504): the reference does not follow the edited mass of the
// hydrogen type, which changes its own mu and so its temperature at a given dispersion, as a heavier ion would.
export const PROTOSTAR_REFERENCE_INVERSE_MU = (1 + 1) / HYDROGEN_1_MASS;

// ---- Drawings: static attractors and repellers (common to every algorithm) ----
// Two kinds, each drawn as an opacity mask the size of the simulation area: a pixel of opacity 1 holds a unit of
// mass per px^2. Its mass is summed on a DRAWING_GRID_RES^2 grid of square cells over
// max(width, height), from the origin, and its softened gravity computed once per change of the
// mask, on two levels (as the protostar's): coarse cells group COARSE_FACTOR^2 fine cells, the
// ones within NEAR_RADIUS (Chebyshev) of a cell's own coarse cell are summed fine cell by fine cell.
export const DRAWING_GRID_RES = 128;
export const DRAWING_COARSE_FACTOR = 8;
export const DRAWING_NEAR_RADIUS = 1;
// Acceleration: a = strength * GRAVITY_UNIT * L * sum m (r_j - r) / (|r_j - r|^2 + eps^2)^(3/2), with
// L = min(width, height): the sum has no dimension, so the pull does not depend on the screen size.
export const DRAWING_GRAVITY_UNIT = 1;
export const DRAWING_PREVIEW_MS = 1000;        // the mask shows while it changes, then fades after this delay
export const DRAWING_UPDATE_MS = 100;          // gravity recomputed at most this often while drawing
export const DRAWING_ATTRACTOR_TINT: readonly [number, number, number] = [139, 92, 246];   // preview color (RGB)
export const DRAWING_REPELLER_TINT: readonly [number, number, number] = [249, 115, 22];
// Brush tips: the fraction of the dab radius at full density (beyond it the density fades to the
// edge), and the distance between dabs / brush diameter. The spray scatters dots instead of a disc.
export const DRAWING_BRUSH_TIPS = {
    soft: { hardness: 0, spacing: 0.12 },
    hard: { hardness: 0.85, spacing: 0.1 },
    spray: { hardness: 1, spacing: 0.3 },
} as const;
export const DRAWING_BRUSH_FALLOFF_STOPS = 6;  // gradient stops of a dab's fading edge
export const DRAWING_SPRAY_DOT = 0.035;        // diameter of a spray dot / brush diameter
export const DRAWING_SPRAY_DOT_MIN = 1.2;      // smallest spray dot diameter, px
export const DRAWING_SPRAY_COVERAGE = 0.2;     // area of the dots of one spray dab / area of the dab
export const DRAWING_SPRAY_MAX_DOTS = 400;     // at most this many dots per spray dab
export const DRAWING_TEXT_MARGIN = 0.05;       // text margins / min(width, height)
export const DRAWING_TEXT_MAX = 2000;          // characters kept in a saved config
// Panel parameters (slider min, max, step, default).
export const DRAWING_STRENGTH_SLIDER: SliderSpec = { min: 0, max: 10, step: 0.1, default: 2 };
export const DRAWING_SOFTENING_SLIDER: SliderSpec = { min: 0.5, max: 10, step: 0.1, default: 2 };   // % of L
export const DRAWING_BRUSH_SIZE_SLIDER: SliderSpec = { min: 4, max: 300, step: 1, default: 60 };     // px
export const DRAWING_BRUSH_FLOW_SLIDER: SliderSpec = { min: 1, max: 100, step: 1, default: 25 };     // %
export const DRAWING_OPACITY_SLIDER: SliderSpec = { min: 0, max: 100, step: 1, default: 100 };       // %
export const DRAWING_FONT_SIZE_SLIDER: SliderSpec = { min: 12, max: 600, step: 1, default: 160 };    // px
export const DRAWING_LINE_HEIGHT_SLIDER: SliderSpec = { min: 0.6, max: 2.5, step: 0.05, default: 1.1 };
export const DRAWING_SHAPE_THICKNESS_SLIDER: SliderSpec = { min: 1, max: 200, step: 1, default: 20 };   // px

// ---- Mouse toolbar: point force and shortcuts ----
// The point force held under the mouse is a softened point mass M = POINT_MASS * density * pi * eps^2,
// eps the brush radius (world px), pulling as a drawing of the same mass would (DRAWING_GRAVITY_UNIT,
// the kind's strength): its peak acceleration depends on the density only, its size sets its reach.
export const DRAWING_POINT_MASS = 4;
// The vortex: the same profile, tangential (counterclockwise), this strength in place of a kind's.
export const DRAWING_VORTEX_STRENGTH = 2;
export const BRUSH_SIZE_KEY_FACTOR = 1.15;     // brush size multiplied (divided) per press of ] ([)
export const BRUSH_FLOW_KEY_STEP = 5;          // brush density (%) added (removed) per press of Shift+] (Shift+[)
export const VORTEX_TINT: readonly [number, number, number] = [56, 189, 248];   // toolbar color of the vortex (RGB)

// ---- Species ----
export const MAX_SPECIES = 10;
export const INV_REL_DENSITY_RANGE: Range = [0.25, 4];
export const EJECT_SCALE_RANGE: Range = [0.3, 3];
// The mass slider is logarithmic over MASS_RANGE (position 0..MASS_SLIDER_STEPS), so the
// light end (0.05-1) stays as easy to set as the heavy end (10-100).
export const MASS_RANGE: Range = [0.05, 100];
// Random masses: visible species get the ladder 1/N, 2/N, ... 1 (shuffled between species),
// each rung nudged by up to +/- MASS_JITTER of a rung step, so the order of the ladder holds.
export const MASS_JITTER = 0.35;
export const MASS_SLIDER_STEPS = 1000;
// Rendered diameter range (CSS px) of the size slider; default sizes scale atomic radii into it.
export const SIZE_RANGE: Range = [1, 6];
export const SIZE_STEP = 0.1;
// Population weight of each species: particles are split pro rata of the weights on restart.
// The default sits mid-range so a species can gain as well as lose population.
export const POPULATION_WEIGHT_RANGE: Range = [0, 1];
export const DEFAULT_POPULATION_WEIGHT = 0.5;
export const POPULATION_WEIGHT_STEP = 0.01;
export const RANDOM_WEIGHT_RANGE: Range = [0.05, 1];

// ---- Visuals ----
export const NEBULA_DOWNSCALE = 4;                 // nebula target = canvas CSS size / 4
export const HEAT_SPEED_RANGE: Range = [60, 500];  // px/s over which particles heat to white
export const MAX_STRETCH = 6;                      // max streak length / particle size
// HDR brightness of one particle. Overlaps in clumps go well above 1 and feed the bloom.
export const PARTICLE_GAIN = 0.45;
// Panel sliders of the visual effects, shared by every algorithm (min, max, step, default).
export const EXPOSURE_SLIDER: SliderSpec = { min: 0.2, max: 3, step: 0.05, default: 0.6 };
export const BLOOM_STRENGTH_SLIDER: SliderSpec = { min: 0, max: 3, step: 0.05, default: 0.35 };
export const BLOOM_RADIUS_SLIDER: SliderSpec = { min: 0, max: 1, step: 0.05, default: 0.6 };
export const BLOOM_THRESHOLD_SLIDER: SliderSpec = { min: 0, max: 1.5, step: 0.01, default: 0.3 };
export const NEBULA_SLIDER: SliderSpec = { min: 0, max: 3, step: 0.05, default: 0 };
export const LENS_SLIDER: SliderSpec = { min: 0, max: 3, step: 0.05, default: 0.05 };
export const HEAT_SLIDER: SliderSpec = { min: 0, max: 2, step: 0.05, default: 0.1 };
export const STRETCH_SLIDER: SliderSpec = { min: 0, max: 3, step: 0.1, default: 1.5 };

// ---- GPU benchmark (first visit, or on demand from the settings) ----
// The protostar runs as in the application, one frame per animation frame, at a few particle
// counts; the mean interval between frames tells whether a count keeps the target frame rate. The
// counts are searched on a geometric scale and the largest one keeping it caps the particle count
// sliders. Above the running count, frames are repeated instead of restarting (cheaper, and on the
// safe side). The user may move the cap within PARTICLE_CAP_RANGE.
export const BENCHMARK_TARGET_FPS = 60;
// A count keeps the target when its mean frame interval is within this factor of the target's
// (or of the display's own interval, on a display slower than the target).
export const BENCHMARK_FRAME_TOLERANCE = 1.1;
export const BENCHMARK_DURATION_MS = 1600;         // no new count is tried past this (the final restart follows)
export const BENCHMARK_FIRST_COUNT = 350000;    // what the protostar keeps at 60 FPS on the reference GPU (GTX 1060)
export const BENCHMARK_GROWTH = 2;                 // count factor while every count keeps the target
export const BENCHMARK_RESOLUTION = 1.25;          // the search stops when the first failing count is within this factor
export const BENCHMARK_MAX_PROBES = 5;             // particle counts tried at most
export const BENCHMARK_REFRESH_FRAMES = 4;         // idle frames timing the display's own interval
export const BENCHMARK_WARMUP_FRAMES = 3;          // untimed frames after each restart (uploads, shader compilation)
export const BENCHMARK_LOAD_WARMUP_FRAMES = 1;     // untimed frames after the load changes without a restart
// Timed frames per count (fewer once BENCHMARK_PROBE_MAX_MS is over): with the warm-up, they
// include the first read-back of the positions to the CPU (CLUSTER_CHECK_INTERVAL frames after a restart).
export const BENCHMARK_PROBE_FRAMES = 10;
export const BENCHMARK_PROBE_MAX_MS = 300;
// The slowest intervals left out of a count's mean: a read-back or a garbage collection is a
// one-off hitch, not the frame rate the GPU keeps.
export const BENCHMARK_DROPPED_FRAMES = 2;
export const PARTICLE_CAP_RANGE: Range = [10000, PARTICLE_COUNT_SLIDER.max];
export const PARTICLE_CAP_STEP = 10000;
// The particle cap is measured on the protostar. The sticky dust costs less per particle: its own
// cap is the protostar's times this ratio.
export const STICKY_DUST_CAP_RATIO = 1.25;

// ---- UI ----
export const PANEL_STATE_KEY = 'gpu-gravity-bloom.panel';
export const DISPLAY_SETTINGS_KEY = 'gpu-gravity-bloom.display';
/** Languages of the interface, each shown under its own name in the language selector. */
export const SUPPORTED_LANGUAGES = ['en', 'fr', 'pl', 'de', 'es'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];
export const DEFAULT_LANGUAGE: Language = 'en'; // fallback when the browser language is not supported
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', fr: 'Français', pl: 'Polski', de: 'Deutsch', es: 'Español' };
export const FPS_LIMIT_OPTIONS = [30, 60, 120, 144, 0]; // frames per second; 0 = unlimited (display refresh rate)
export const DEFAULT_FPS_LIMIT = 60;
export const PANEL_TAB_KEY = 'gpu-gravity-bloom.panelTab';
export const TOOLTIP_DELAY_MS = 200;               // hover time before a tooltip shows
export const TOOLTIP_GAP = 10;                     // px between a tooltip and what it documents
export const ELEMENT_CONFIGS_KEY = 'gpu-gravity-bloom.elements';
export const SIMULATION_CONFIGS_KEY = 'gpu-gravity-bloom.simulations';
export const DELETE_CONFIRM_MS = 3000;            // delay to confirm a config deletion
// Element chart: arrow keys move a bar by this fraction of its height.
export const CHART_KEY_STEP = 0.05;
// Colors are edited as hue (HUE_STEPS steps per turn), saturation and lightness (in %).
export const HUE_STEPS = 360;
export const COLOR_PERCENT_STEPS = 100;
// Setting the hue of a color where no hue shows (gray, or close to black / white) also gives it
// the vivid saturation and lightness below, so the new hue is seen.
export const HUE_VISIBLE_MIN_SATURATION = 0.1;
export const HUE_VISIBLE_LIGHTNESS: Range = [0.05, 0.95];
export const VIVID_SATURATION = 0.7;
export const VIVID_LIGHTNESS = 0.6;
export const COLOR_GRADIENT_STOPS = 6;             // stops of the color track gradients
// Algorithm parameters on a logarithmic scale: slider positions, and significant digits kept.
export const LOG_PARAM_SLIDER_STEPS = 1000;
export const LOG_PARAM_DIGITS = 3;
// The supernova threshold label stays inside the meter: its position is clamped to this range (%).
export const METER_LABEL_RANGE: Range = [16, 84];

export type Range = readonly [number, number];

/** Bounds, step and default value of a slider. */
export interface SliderSpec {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly default: number;
}
