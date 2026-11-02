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

// ---- Visuals ----
export const NEBULA_DOWNSCALE = 4;                 // nebula target = canvas CSS size / 4
export const HEAT_SPEED_RANGE: Range = [60, 500];  // px/s over which particles heat to white
export const MAX_STRETCH = 6;                      // max streak length / particle size
// HDR brightness of one particle. Overlaps in clumps go well above 1 and feed the bloom.
export const PARTICLE_GAIN = 0.45;

// ---- UI ----
export const PANEL_STATE_KEY = 'gpu-gravity-bloom.panel';

export type Range = readonly [number, number];
