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
export const K_GRAVITY = 3;
// Weight of mip level L is 2^(L * LONG_RANGE): 0 gives a 1/r^2 pull, 1 gives 1/r (2D gravity).
// In between, distant clumps still find each other and merge.
export const LONG_RANGE = 0.5;
export const K_PRESSURE = 40;
export const REST_DENSITY = 30;                    // mass per density texel above which clumps push back
export const VISCOSITY_RATE = 6;                   // 1/s, damping of velocity relative to local flow
export const GLOBAL_DRAG = 0.03;                   // 1/s
export const MAX_SPEED = 1500;                     // px/s
export const RESTITUTION = 0.8;
export const MOMENTUM_SCALE = 0.01;                // keeps splatted momentum inside half-float range

// ---- Supernova ----
export const CLUSTER_CHECK_INTERVAL = 12;          // frames
export const SUPERNOVA_SPEED = 420;                // px/s at 100 % power (scaled by the power slider)
export const EJECT_TIME = 0.6;                     // s during which ejecta ignore gravity/viscosity (fading back in)
export const SUPERNOVA_COOLDOWN = 120;             // frames
// Shock wave: the front moves at the ejection speed; the outward kick it gives is
// SHOCK_STRENGTH * ejection speed at the aggregate edge and falls off as 1/r beyond it.
export const SHOCK_STRENGTH = 0.9;
export const SHOCK_MIN_KICK = 0.03;                // fraction of the ejection speed below which the wave dies

// ---- Panel parameters of the sticky dust algorithm (slider min, max, step and default) ----
export const PARTICLE_COUNT_SLIDER: SliderSpec = { min: 1000, max: 3000000, step: 1000, default: 400000 };
export const GRAVITY_SLIDER: SliderSpec = { min: 0, max: 15, step: 0.1, default: 2.5 };
export const SUPERNOVA_THRESHOLD_SLIDER: SliderSpec = { min: 0, max: 100, step: 1, default: 37 };  // % of the particles
export const CONCENTRATION_RADIUS_SLIDER: SliderSpec = { min: 10, max: 400, step: 5, default: 65 }; // px
export const SUPERNOVA_POWER_SLIDER: SliderSpec = { min: 5, max: 100, step: 5, default: 70 };      // % of SUPERNOVA_SPEED

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
export const PROTOSTAR_RESTITUTION = 0.5;          // walls
export const PROTOSTAR_MAX_SPEED = 2;              // L/s
export const PROTOSTAR_DRIFT_GAIN = 0.5;           // fraction of the measured drift of the star taken off at each read-back
export const PROTOSTAR_STATS_INTERVAL = 10;        // frames between two GPU reductions of the stats
export const PROTOSTAR_STATS_REDUCE_RES = 16;      // first reduction stage (GRID_RES / 16 = 8 x 8 cells each)
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
export const PROTOSTAR_COUNT_SLIDER: SliderSpec = { min: 1000, max: 2000000, step: 1000, default: 400000 };
export const PROTOSTAR_ROTATION_SLIDER: SliderSpec = { min: 0, max: 1, step: 0.01, default: 0.44 };       // x v_circ
export const PROTOSTAR_AGITATION_SLIDER: SliderSpec = { min: 0, max: 1.5, step: 0.01, default: 0.26 };    // x v_circ(R)
export const PROTOSTAR_GRAVITY_SLIDER: SliderSpec = { min: 0.1, max: 20, step: 0.05, default: 13.85 };
export const PROTOSTAR_SOFTENING_SLIDER: SliderSpec = { min: 0.2, max: 5, step: 0.1, default: 1.6 };       // % of L
export const PROTOSTAR_COOLING_SLIDER: SliderSpec = { min: 0, max: 3, step: 0.01, default: 0.51 };        // 1/s
export const PROTOSTAR_OPACITY_SLIDER: SliderSpec = { min: 1, max: 1000, step: 0, default: 5.32 };         // rho0, log
export const PROTOSTAR_LAMBDA_SLIDER: SliderSpec = { min: 1e-7, max: 1e-2, step: 0, default: 1.5e-4 };     // 1/s, log
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
