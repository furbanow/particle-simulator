# Spike A10: a granular sticky dust

Phase P6a of the improvement plan. Proposal A10 deposits the energy of the particles' motion in the alpha channel of the
density grid and derives from it the agitation `T = <|v|^2> - |u|^2` of the dust, which sets how often grains stick
(Haff's law), what pressure the dust resists compression with, and the colour of its particles. This document records what
was built, how exact it is, what it costs and what it does not do. The first step (recalibration of the pull after the
isotropic stencil of B1/A14) is in the first section.

## Verdict

- **Haff's law holds.** A cloud of grains filling the area uniformly, with no gravity, pressure or drag, cools by sticking
  alone: `T^(-1/2)` is a straight line of time (R^2 = 0.999997 on the grid, 0.999999 on the particles, over a fall of the
  agitation by a factor 60 to 100) and the exponent of `T ~ (1 + t / t0)^p` is **p = -1.996** (grid) and **-2.002**
  (particles). The slope is 96 % of the sticking rate times the density the particles feel.
- **The deposit equals its CPU reference** within the half-float tolerance model on a sparse cloud and on a cold fast flow
  (worst error 0.73 and 0.60 of what the model allows, one being 1). On the cold flow the agitation the shader derives is
  within **0.81 % (median)** of the exact variance, where the energy about zero (the plain `m |v|^2`) loses all of it.
  Where the half floats saturate (the cores of the clumps) it does not: see "What it does not do".
- **The default cloud still forms its clumps**: it collapses 8 % later (10 % of its mass in dense texels at 2.27 s against 2.10 s),
  goes supernova at the same time (2.78 s), and holds 4 clumps with 20 % of its mass in dense texels at 15 s (4 clumps and 29.5 % before). One
  difference: its clumps merge more, and a second supernova fires at 14.7 s (none before).
- **Cost** (sim-only ms per frame, 6 alternating pairs of the build before and after): no measurable change at 400 000 particles (-1 % to
  +3 %, noise about 5 %), **+14 % at 1 000 000 particles** once the cloud has clumped (4.42 to 5.03 ms; +1 % before the collapse), 0.6 ms that
  I did not isolate. The whole frame is 5 to 10 % cheaper (the clumps are less crushed).
- **K_GRAVITY was dead code**, and the slider keeps its meaning: the pull of the isotropic stencil is restored by a gain of
  **1.2** on the slider's value (`DUST_GRAVITY_GAIN`).

## Recalibration of the pull (step 0)

The per-texel gravity with the isotropic stencil (B1/A14) pulls less than the central-difference loop it replaced: its RMS
over the particles of a clumped cloud is 83.7 % (B1's measurement) to 85.1 % (this session, `dust.gravity.parity`) of the
original's. The report of B1 suggested scaling `K_GRAVITY` by about 1.2. **`K_GRAVITY` did nothing**: the model created its
uniform from it, and the slider's default (2.5) overwrote the uniform at once, so the felt strength was the slider's. The
gain is now applied to the slider's value (`kGravity = G x DUST_GRAVITY_GAIN`); the slider's range, default and display, and
the values saved in configurations, are unchanged, so a saved value pulls as it did before B1. The constant `K_GRAVITY` is gone.

The gain was chosen from the dynamics (`dust.recalibration`, new): the default cloud (400 000 particles, seed 20240612,
15 s) under the original stencil (`DUST_GRADIENT_CORNER_WEIGHT = 0`, the equivalent of the old loop to 0.17 %), under the
isotropic stencil with several gains, the time at which a given share of the mass sits in dense texels (at or above
`REST_DENSITY`) being the felt strength:

| Arm | 2 % | 5 % | 10 % | 20 % | 30 % | First supernova |
|---|---|---|---|---|---|---|
| Original stencil | 2.02 | 2.06 | 2.11 | 2.22 | 2.34 | 2.78 s |
| Isotropic, gain 1 | 2.27 | 2.29 | 2.33 | 2.41 | 2.49 | 3.03 s |
| Isotropic, gain 1.1 | 2.05 | 2.13 | 2.25 | 2.33 | 2.40 | 2.78 s |
| **Isotropic, gain 1.2** | **2.02** | **2.05** | **2.10** | **2.19** | **2.28** | **2.78 s** |
| Isotropic, gain 1.3 | 2.01 | 2.03 | 2.06 | 2.14 | 2.21 | 2.78 s |

Without the gain everything is 0.25 s (12 %) late. With 1.2 the timeline is the original's to 0.01 to 0.06 s and the first
supernova comes at the same time; this agrees with `1 / 0.85 = 1.18` from the RMS pull. As B1's report noted, the gain also
strengthens the smooth, large-scale pull (which A14 did not change) by 20 %: a trade, which the timeline of a whole cloud
settles in favour of the gain. The supernova trigger (a share of the particles in a disk, read back every 12 frames) was
not touched; it fires at the same frame as before the stencil. The supernova's constants wait for A9.

## What was built

| | |
|---|---|
| `src/shaders/splat.vert`, `splat.frag` | The deposit: (m, m v S_mom, m \|v - v_ref\|^2 S_E) in R, G B and A, cloud-in-cell weighted. |
| `src/shaders/density-reference.glsl`, `.frag`, `src/simulation/densityField.ts` | The reference velocity: a pass copies level `REFERENCE_LEVEL` (5: 16 x 16 texels) of the previous deposit into a small filtered grid; the splat and the velocity pass read it (mass and momentum interpolated, then divided) with the offset of the grid that deposit was made with. `DensityField.render` clears alpha to 0 locally (the renderer's clear alpha is 1 and stays so). |
| `src/shaders/velocity-sticky-dust.frag` | T from the four taps (now read as `vec4`: the same fetches), Haff sticking, the bounce barrier, the kinetic pressure, the glow in `w`. |
| `src/simulation/stickyDust/granular.ts` | The pure twin of those formulas (the lab and the tests use it). |
| `src/simulation/stickyDust/declaration.ts`, `gpuModel.ts`, `src/i18n/locales/*` | Two parameters of the Physics tab: stickiness (% of `STICK_RATE`, 100 by default) and collision speed (px/s, 600); the model's `glow` is `'state'`. |
| `src/config.ts` | `ENERGY_SCALE`, `REFERENCE_LEVEL`, `STICK_RATE`, `CONTACT_RANGE`, `KINETIC_PRESSURE`, `PRESSURE_CFL`, `GLOW_AGITATION_RANGE`, the two sliders. `VISCOSITY_RATE` and `K_GRAVITY` are gone. |
| Lab | `dust.deposit`, `dust.haff`, `dust.default-cloud`, `dust.recalibration`, `dust.granular-sweep`; `GpuPipeline.debugSetState` and `debugVelocityTarget`, `DensityField.debugReferenceTarget` and `referenceEnabled`. |

## The design

**Agitation.** With the mass `rho`, the momentum `rho u` and the energy `E` of a texel, `T = E / rho - |u|^2` (px^2/s^2), at
least 0. It is the professor's definition: twice the variance of one component, so the pressure of an ideal gas in 2D is
`rho T / 2`.

**Half floats.** The grid is a half-float mip chain (filterable and blendable everywhere; float32 mips would need
`OES_texture_float_linear`, which nothing checks). Two things keep `E / rho - |u|^2` from being the difference of two large
numbers. The scale `ENERGY_SCALE = 1e-5` keeps the sums below 65 504 (a texel of mass 128, about all a half float lets a cell
hold at 400 000 particles, whose grains all fly at 3000 px/s from the reference sums to 11 500). The reference velocity makes the
energy the size of the agitation and not of the speed. A cold flow shows why: 12 px/s of agitation (T = 288) in a bulk flow of
806 px/s, 400 000 particles, `dust.deposit`:

| | Median error of T | 95th percentile | 99th |
|---|---|---|---|
| Energy about the reference velocity (shipped) | **0.81 %** | 4.4 % | 7.7 % |
| Energy about zero (`m \|v\|^2`) | 100 % (T read as 0) | 1067 % | 1571 % |

The reference is the mean flow of the previous substep at a coarse level (16 x 16 texels over the domain, 128 px a texel at 1024 x 768);
a finer one (32 x 32) gave no better agreement on the default cloud (9.2 % against 9.1 %) and a deposit that the tolerance model no
longer covers (the hardware's 8-bit filter weights on a steeper reference). Exact arithmetic gives the same T for any reference; the
reference only chooses the rounding. It is read in the velocity pass at the particle's position, from the same texture the deposit
read, so the two always agree.

**Sticking.** `nu = STICK_RATE x stickiness x rho x sqrt(T)` (rho at the particle, bilinear), applied as
`v <- mix(v, u, share (1 - exp(-nu dt)))`: each particle's velocity relative to the local mean flow decays at `nu`, so
`dT/dt = -2 nu T` and `T^(-1/2)` grows at `STICK_RATE x stickiness x rho`. `share` is the bounce barrier,
`1 - smoothstep(v_coll / 2, v_coll, |v - u|)`: grains that meet faster than the collision speed do not stick. It replaces the ejection
timer for the sticking (the timer, `vel.z`, still gates gravity and pressure through `bound`, until A9).

**Pressure.** The threshold pressure is unchanged, `kPressure x grad max(rho - REST_DENSITY, 0)`. The kinetic one,
`-grad(P) / rho` with `P = rho T / 2`, is computed from the same four taps (their moments, not only their mass), gated by the contact
ramp (0.1 to 0.6 `REST_DENSITY`: a collisionless cloud has no pressure, and a few particles' variance is noise), and with the agitation
capped at `2 (PRESSURE_CFL x texel / dt)^2` so that the sound speed does not cross more than a texel in a substep (the explicit scheme
would otherwise ring: at the default speed the cap is `T = 204 800`, 320 px/s a component). Both are multiplied by the species'
relative density as before. The pressure could not move into the per-texel passes of B1 (the contact ramp and the cap are taken after
the interpolation), so it stays a per-particle read of the taps the shader already did.

**Colour.** `w = smoothstep(5, 60, sqrt(T))` of the texel under the particle, drawn by the particle layer's 'state' glow. A cloud falling in
coherently stays dark, shell crossing and shocks light up. The supernova's ejection writes `w = 0` (its ejecta start dark).

## The defaults

`STICK_RATE = 8e-3` comes from the agitation measured in the default cloud (`dust.default-cloud` now records it): the grains of the dense
texels (at or above `REST_DENSITY`) have `sqrt(T)` of 10 to 25 px/s and the loose gas 15 to 45 px/s (the initial donut: 16 px/s, which is
`sqrt(2 x 20^2 / 3)`, the value of its random velocities: the measurement checks out), so a frequency of about 6 per second in a clump of
mass 50 needs `rate = 6 / (50 x 15) = 8e-3`. The sweep (`dust.granular-sweep`, one run each, the default cloud, 15 s):

| Arm | 10 % of the mass dense at | First supernova | At 15 s: dense share, clumps, peak |
|---|---|---|---|
| Before A10 (constant 6 per second) | 2.10 s | 2.78 s | 29.5 %, 4, 106 |
| **Default (100 %, kinetic pressure, 600 px/s)** | **2.27 s** | **2.78 s** | **20 %, 4, 98** |
| No kinetic pressure | 1.91 s | 2.78 s | 43 %, 6, 129 |
| Stickiness 50 % | 2.54 s | 2.78 s | 21 %, 6, 77 |
| Stickiness 125 % | 2.28 s | 2.78 s | 25 %, 4, 131 |
| Stickiness 150 % | 1.99 s | 2.78 s | 26 %, 9, 123 |
| Stickiness 175 % | 1.88 s | 2.78 s | 29 %, 6, 119 |
| Stickiness 200 % | 1.84 s | 2.78 s | 28 %, 4, 128 |
| Collision speed 200 px/s | 2.27 s | 2.78 s | 24 %, 4, 129 |
| Collision speed 1000 px/s | 2.27 s | 2.78 s | 15 %, 4, 96 |

(A first sweep at `STICK_RATE = 5e-4`, the value guessed before measuring the agitation, gave a cloud that collapsed 0.6 s late (10 % at 2.71 s) and
never formed clumps again after the supernova.) The kinetic pressure is what keeps the collapse 8 % behind the original's (2.27 s
against 2.10 s: without it 1.91 s): the streams that cross when the donut collapses heat the cloud (`sqrt(T)` up to 60 px/s), and a hot gas resists.
The collision speed does not show in this cloud (the infall is slower than 300 px/s relative to the local flow); it matters for fast
ejecta. The last column is one run of a chaotic system (the number of clumps ranges 4 to 9 between neighbouring arms): read the arrival
times, not the late statistics. The sticking frequency of the dense texels at the default is 4 to 7 per second (`stickingDense` in the
series), the constant rate it replaces being 6.

## Evidence

### Haff's free cooling (`dust.haff`)

1 000 000 equal grains uniformly over the 1024 x 768 area, Gaussian velocities of 60 px/s a component (initial `T` 7201 exactly, 7200
expected), no net momentum; gravity, both pressures and the global drag set to 0, elastic walls, the collision speed out of reach, and the
sticking rate raised to 0.015 (the cloud is thin: mass 0.43 a texel for the particles, against 50 in a clump, so a lab override
brings the cooling into 700 frames, 17.5 s). The agitation is read every 20 frames, on the grid (mass-weighted mean of `rho T` over the texels, the
quantity the sticking acts on) and exactly from the velocities read back (about the global mean).

| | Grid | Particles |
|---|---|---|
| Points, `T` from 4387 down to 1.6 % (grid) and 1 % (particles) of the initial | 35 | 36 |
| Slope of `T^(-1/2)` against `t` (1/(px/s) per s) | 0.006158 | 0.006064 |
| R^2 of the line | 0.999997 | 0.999999 |
| `t0` | 1.93 s | 1.96 s |
| Exponent `p` of `T ~ (1 + t / t0)^p`, fitted in log-log | **-1.996** | **-2.002** |

The slope predicted by the law, `rate x` the density the particles feel (`sum rho^2 / sum rho` of the grid, 0.426), is 0.006395: the
fit is **96 %** of it, the 4 % being the density's own spread (a bilinear read is not the texel's `rho^2`) and the sample variance
of the local mean flow (about 20 particles' worth). The scenario passes at an exponent within 0.1 of -2 and R^2 of 0.99.

### The deposit against a CPU reference (`dust.deposit`)

The reference deposits the positions and velocities read back (double precision, the same cloud-in-cell weights, the reference velocity read
back from the small grid and interpolated on the CPU) and is compared channel by channel texel by texel to the grid, against the model of
`depositReference.ts` for the half-float path: each contribution suffers 4 roundings of 2^-11 relative to the running sum (to the sum of the
absolute values for the momentum, whose terms cancel), and its weight is off by 2^-15 of the largest payload, plus, for the energy, the
rounding of the hardware's 8-bit filter weights on the reference (`2 m w |v - v_ref| S_E` x spread / 256, summed). A texel nothing reaches
must hold exactly 0: the alpha channel is cleared locally.

| State | Particles, busiest texel | Mass | Momentum x, y | Energy | Judged |
|---|---|---|---|---|---|
| Sparse donut, 10 frames | 20 000, 15 | 0.46 | 0.39, 0.40 | 0.73 | yes |
| Cold flow, 806 px/s, T = 288 | 400 000, 181 | 0.06 | 0.05, 0.05 | 0.60 | yes |
| Default cloud, 110 frames (clumps) | 400 000, 9921 | 0.31 | 0.32, 0.28 | 0.67 | measured |

(Worst error as a fraction of what the model allows; each must be at most 1.) Sums: the grid holds 19 990 of the 20 000 units of
mass (5e-4) in the first two, 19 120 (4.4 % lost) in the third. The agitation derived from the grid against the exact variance
of the particles of each texel (texels reached by at least 30 particle clouds):

| State | Class (mass of the texel) | Texels | Median | 95th | 99th |
|---|---|---|---|---|---|
| Cold flow | all | 12 254 | 0.81 % | 4.4 % | 7.7 % |
| Default cloud | 1 to 10 | 221 | 5.1 % | 30 % | 59 % |
| | 10 to 30 | 310 | 9.2 % | 41 % | 70 % |
| | 30 to 100 | 268 | 16 % | 164 % | 592 % |
| | 100 and more | 5 | 250 % | 460 % | 461 % |
| | all | 804 | 9.1 % | 100 % | 252 % |

### The default cloud, before and after (`dust.default-cloud`)

400 000 particles, default parameters and speed (1.5: two substeps of 12.5 ms per frame), seed 20240612, 600 frames (15 s of simulated time), the density
grid read every 10 frames; "dense" is a texel at or above `REST_DENSITY` (30), a clump a 4-connected group of at least 4 dense texels. Before is the
build of `05cb977` (the constant rate of 6 per second, the isotropic stencil with its gain), after this branch.

| | Before A10 | After |
|---|---|---|
| Time to 2 / 5 / 10 / 20 / 30 % of the mass in dense texels | 2.02 / 2.05 / 2.10 / 2.19 / 2.28 s | 2.06 / 2.16 / 2.27 / 2.37 / 2.48 s |
| At 2.75 s (collapse): dense share, clumps, heaviest clump (mass of 20 000) | 85 %, 2, 15 440 | 64 %, 6, 10 050 |
| First supernova | 2.78 s | 2.78 s |
| Most clumps at once (the collapse's fragments, 2.25 s) | 20 | 9 |
| At 15 s: dense share, clumps, peak density, heaviest clump | 29.5 %, 4, 106, 1174 | 19.9 %, 4, 98, 1628 |
| Supernovae in 15 s | 1 | 2 (the second seen at 14.75 s) |
| Share of the particles in the densest 65-px disk, late (the supernova's trigger, 37 %) | 0.09 to 0.13 | 0.19 to 0.39 |
| At 15 s: `sqrt(T)` of the dense texels, of the loose ones, hottest; sticking frequency of the dense texels | | 14 px/s, 47 px/s, 122 px/s; 6.0 per second |

The collapse is less crushed (a heaviest clump of 10 050 against 15 440 at 2.75 s: the kinetic pressure of the crossing streams holds it
up), the later clumps merge more (the trigger's share is 2 to 4 times higher). The supernova's constants were left alone, as asked: A9 revisits the trigger.

### Timing

Simulation time per frame (`Simulation.step()` and `endFrame()`, two substeps, the GPU waited for every 10 or 30 frames), ms, default parameters, 1024 x 768. Median over
6 runs of each build, alternated pair by pair with the order swapped every pair (one run of the build before, one of this branch), [min, max] in
brackets, and the median of the six pair ratios. Before is `05cb977` (A10 not yet in); no other headless browser ran (the lock); the GPU
was at 1.92 GHz and mostly idle before each run (0 to 47 %).

| Window | Particles | Before | After | Median of the pairs (range) |
|---|---|---|---|---|
| Frames 10 to 50 (`perf.dustEarly`, the donut: the same load) | 400 000 | 3.718 [3.125, 3.965] | 3.532 [3.355, 3.770] | -6.6 % (-11 to +21 %: noise) |
| | 1 000 000 | 4.723 [4.685, 4.865] | 4.783 [4.755, 5.730] | **+1.3 %** (-1.6 to +21 %, one outlier) |
| Frames 150 to 190 (`perf.dustLate`, after the first supernova) | 400 000 | 2.845 [2.800, 2.900] | 2.827 [2.805, 2.840] | **-0.9 %** (-2.1 to +0.2 %) |
| | 1 000 000 | 4.418 [4.185, 4.590] | 5.027 [4.915, 5.110] | **+14.0 %** (+7 to +22 %) |
| The probe, `perf.stickyDust` (frames after a 1.5 s warm-up: hundreds in) | 400 000 | 3.013 [2.782, 3.350] | 2.849 [2.788, 2.868] | -5.8 % (-17 to +2 %) |
| | 1 000 000 | 4.569 [4.557, 4.873] | 5.217 [4.965, 5.350] | +14.1 % (+2 to +17 %) |
| Whole frame (simulation, particles, nebula, bloom), the probe | 400 000 | 4.828 [4.782, 5.048] | 4.363 [4.285, 4.547] | -10.1 % (-13 to -6 %) |
| | 1 000 000 | 8.814 [8.720, 9.430] | 8.385 [8.148, 8.817] | -5.3 % (-11 to -1 %) |

- **On the same load the extra cost is small**: the new pass (16 x 16 texels), the second texture read of the deposit and of the velocity pass and the arithmetic
  of T, of the pressure and of the sticking cost about 1 % at 1 000 000 particles before the collapse. The early window at 400 000 particles is noisy
  (restarts, clocks): its pairs range from -11 % to +21 %.
- **The cost depends on the phase of the cloud and on the count**: after the collapse and the first supernova, the dust costs 14 % more at 1 000 000 particles
  (every pair, +7 to +22 %) and the same at 400 000. I did not find why; it is not a cost per particle (that would show at 400 000 too). Candidates:
  the grid's mass saturating at 41 (not 128) at 1 000 000 particles changes what the clumps look like, and the velocity pass is more costly where the
  texels are dense (the contact ramp's branches do not diverge, but the clumps differ between the builds). The probe's window is the late one (its
  warm-up lasts 1.5 s of wall time, hundreds of frames) and reads the same +14 %.
- **The whole frame is cheaper** in the probe (5 to 10 %): the clumps are less crushed after the collapse (a heaviest clump of 10 050 against 15 440 units at 2.75 s), which the particle layer
  and the deposit pay for in overdraw and contention. The simulation's own figure is the one to compare, and neither is a cost of the physics.
- Budget: the plan's criterion for a feature was about 10 % of the frame. At 1 000 000 particles the simulation is 14 % higher but the whole frame is 5 % lower in the probe's window; the number of particles
  the GPU benchmark finds (it times the protostar) and the dust's cap ratio 1.25 are not changed (B1's spike left that choice to the owner).

## What it does not do

- **The agitation of a saturated core is wrong.** The mass channel of the grid cannot grow past about 128 at 400 000 particles (peak densities
  read 128.0, 128.1, 128 ... in every run, before A10 too): above it a half float is rounded to a multiple of 0.125 (then 0.25 ...) and a
  contribution of a particle's mass (0.05 or less) is lost. The five texels of the densest class hold under 99 % of the mass the particles
  put in them, 4.4 % of the total mass is missing from the grid in the clumped cloud, and the agitation derived there is off by a factor
  of 3. Between 30 and 100 the error is 16 % (median). The sticking and the pressure in the very core of a clump therefore work on
  a rough T; the mass there is as wrong as it was. The fix would deposit the level 0 in float32 (`EXT_float_blend` is checked by the
  protostar) and convert it to the half-float mip chain by a pass: not done, as it changes the dynamics of the cores (their density
  would no longer saturate) and the plan did not ask for it. At 3 000 000 particles a particle weighs 0.0067: the saturation is at a mass of 14.
- **Agitation is the grid's.** A texel is 4 px at 1024 x 768 (domain twice the screen over 512): a bulk shear inside one is read as heat.
- **The reference costs accuracy in smooth flows.** On the default cloud (bulk speeds of a few hundred px/s, agitation of tens)
  the energy about zero is not cancelled much and the reference's own gradient within a footprint is the larger error: 5 % (median, loose
  gas) with it against 1.3 % without. It decides where the flow is fast and cold, which is where it matters (the supernova's ejecta, the 806 px/s
  flow above).
- **Sticking is a relaxation to the texel's mean flow, not a pairwise collision**; the bounce barrier does not bounce, it only stops sticking.
- **The collision speed is not seen by the default cloud**; its value (600 px/s, 0.4 of `MAX_SPEED`) is a guess for the ejecta of A9.

## Method

| | |
|---|---|
| Renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)` |
| Browser | HeadlessChrome, ANGLE OpenGL backend, 1024 x 768, `--angle gl` |
| Date | 2026-11-21 |
| Code | this branch; `05cb977` (the recalibration commit, A10 not yet in) for the "before" builds |

The GPU was shared with other jobs; every run went through a lock and waited for any other headless browser to leave. The scenarios:

    npx vite --port 5204                                          # this code
    git archive 05cb977 | tar -x -C /tmp/before && ln -s "$PWD/node_modules" /tmp/before/node_modules
    (cd /tmp/before && npx vite --port 5205)                      # the code before A10
    node scripts/run-lab.mjs --url http://localhost:5204/particle-simulator/lab.html --query scenarios=dust.haff,dust.deposit
    node scripts/run-lab.mjs --url http://localhost:5204/particle-simulator/lab.html --query scenarios=dust.default-cloud,dust.granular-sweep,dust.recalibration
    # timing: alternate the two servers, one run each, as many pairs as wanted
    node scripts/run-lab.mjs --url http://localhost:5205/particle-simulator/lab.html --query scenarios=perf.stickyDust.400k,perf.stickyDust.1m
    node scripts/run-lab.mjs --url http://localhost:5204/particle-simulator/lab.html --query scenarios=perf.stickyDust.400k,perf.stickyDust.1m

`dust.haff` takes 10 s, `dust.deposit` 4 s, `dust.default-cloud` 11 s, `dust.recalibration` 80 s, `dust.granular-sweep` 100 s.

## Deviations from the plan

- **`K_GRAVITY` could not be scaled** (dead): the gain is on the slider's value, and the constant is removed.
- **The pressure is `-grad(P) / rho`**, with the threshold part kept as it was (an acceleration `-kPressure grad(max(rho - rho_rest, 0))`, not divided by the
  density): the plan's `P = rho T + K max(rho - rho_rest, 0)` has no unit that makes the two parts of one sum, since the existing law's
  stiffness is not a velocity squared. P = rho T / 2 for two degrees of freedom, gated by contact and capped by the CFL condition.
- **The deposit's reference velocity comes from a small grid made by a pass** (one 16 x 16 pass per substep), not from the particles: the mip
  chain cannot be read while it is written, and a second target would have touched the gravity passes.
- **No float32 deposit** (see above).
- **The bounce barrier fades out** (between half the collision speed and all of it) instead of cutting off.
- **The glow range** is `[5, 60]` px/s of `sqrt(T)`, from the measured agitation of the default cloud, not a physical value.

## What P6b (A9, coherent supernova) should know

- Gravity for the ejecta: the eject timer (`vel.z`) still multiplies gravity, pressure and the drawings' pull through `bound`; the sticking is
  gated by the barrier only. The slow ejecta (relative speed under half the collision speed: heavy species at `ejectScale` 0.3, 90 px/s)
  stick to the local mean flow at once where the dust is dense. A stratified, homologous ejection (`v` proportional to `r`) will make `T`
  grow at the texel scale by `(v / R)^2 x` (texel width)^2 / 6: a few px^2/s^2 at one second, negligible; the shock's heat shows as `T`.
- The ejection writes `w = 0`, so the ejecta are dark until the grid sees them agitated; the glow comes from the grid, not from the model.
- The alpha channel is a sum of energies: the grid no longer says how many particles are in a texel. A trigger on mass has to count on the CPU
  (the periodic read-back of the positions has no masses either: add the species' splat masses) or on the GPU with a reduction.
- The grid's mass saturates at about 128 at 400 000 particles: a trigger or a threshold on the grid's density (or on the compactness `GM/R`
  from it) sees at most that, not the true mass of a core.
- `debugSetState` and `dust.haff` give a way to set up a cloud of one's own (a uniform shell, a ring of ejecta) and read it back, which a test of
  `R ~ t^(1/2)` or `v ~ r` needs.
- The supernova's constants were not touched; the first supernova still comes at 2.78 s in the default cloud, as before.
