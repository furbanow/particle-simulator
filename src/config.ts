// Every tunable constant of the simulation and its rendering.

// ---- Simulation ----
export const TEX_SIZE = 708;                       // 708x708 = 501 264 slots (>= 500 000)
export const MAX_PARTICLES = TEX_SIZE * TEX_SIZE;
export const FRAME_MS = 1000 / 60;
export const BASE_DT = 1 / 60;

// ---- Initial donut ----
export const DONUT_INNER = 0.12;                   // fraction of min(width, height)
export const DONUT_OUTER = 0.40;
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
export const PARTICLE_COUNT_SLIDER: SliderSpec = { min: 1000, max: 500000, step: 1000, default: 30000 };
export const GRAVITY_SLIDER: SliderSpec = { min: 0, max: 15, step: 0.1, default: K_GRAVITY };
export const SUPERNOVA_THRESHOLD_SLIDER: SliderSpec = { min: 0, max: 100, step: 1, default: 60 };  // % of the particles
export const CONCENTRATION_RADIUS_SLIDER: SliderSpec = { min: 10, max: 400, step: 5, default: 80 }; // px
export const SUPERNOVA_POWER_SLIDER: SliderSpec = { min: 5, max: 100, step: 5, default: 70 };      // % of SUPERNOVA_SPEED

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

// ---- UI ----
export const PANEL_STATE_KEY = 'gpu-gravity-bloom.panel';
export const ELEMENT_CONFIGS_KEY = 'gpu-gravity-bloom.elements';
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
