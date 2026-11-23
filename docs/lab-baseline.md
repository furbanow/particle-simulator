# Lab baseline: the protostar model before the improvements

What the current model does, measured by the lab ([lab.md](lab.md)) before any physics change
(phase P0b of the improvement plan). Later phases compare their lab runs with these numbers. The
protostar physics is untouched by this phase; the only changes it brought to the shipped
application are the extraction of `createRenderer` (same behaviour), a one-line reset of the GPU
random-stream counter at restart, which makes a restart replayable, and a switch for the lab to
force the half-float deposit (off by default).

## How it was obtained

| | |
|---|---|
| Date | 2026-11-20 |
| Code | branch `feat/lab`, commit `ef8d4c1` |
| Renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)` |
| Browser | HeadlessChrome 155, ANGLE OpenGL backend (`--angle gl`), `EXT_float_blend` available |
| Command | `npx vite --port 5199` then `node scripts/run-lab.mjs --angle gl --out results.json` |
| Area, seed | 1024 x 768 px, seed 20240611 (`src/lab/config.ts`) |
| Whole run | 87 s, 9 scenarios: 8 pass, 1 skip (energy drift: needs A7) |

The same run on SwiftShader (`--angle swiftshader`, software) passes the same checks in 6 minutes
with a smaller baseline (20 000 particles, 200 frames) and reports the timings as invalid.

## Which numbers depend on the hardware

- **Not on the hardware**: the ignition temperatures and ratios (pure formulas), the checks of
  `lab.selftest`, the particle bookkeeping (`depositedMassOverCount` close to 1).
- **On the GPU and its driver, in a small way**: the default-cloud series. A run is deterministic
  (two runs on this GPU gave the same 60 readings of four quantities to the last digit, see
  below), but the GPU's floating-point rounding and the fusion random numbers make the history
  diverge slowly between GPUs, drivers and backends: the OpenGL and the Vulkan backends of this
  very GPU agree to the 5th digit for the first 200 frames, then drift apart; at the end the
  core temperature agrees to 1 % (55.1 against 55.2 MK), the peak density to 1 % (109.0 against
  110.2 rho0) and the fusion rate to 4 % (2810 against 2921 per second). Expect the same order of
  difference on another GPU, not tested here: compare the shape and the plateaus, not the digits.
- **On the GPU strongly**: every timing. They are from a GTX 1060 (2016); a recent GPU is several
  times faster. Compare a later phase with a run of the baseline code on the same machine.

## The default cloud

`baseline.protostar.default-cloud`: 400 000 particles, default parameters, speed 1.7 (two substeps
of 14.2 ms per frame), 1200 frames, that is 34 s of simulated time, 26 s of wall time. The
temperature is that of the densest cell (the core, as the application's stats show it), the
density in units of the initial mean density rho0, the fusion rate the expected number of fusions
per second in the whole cloud.

| t (s) | frame | core T (MK) | peak density (rho0) | fusions / s | omega.dt in the core |
|---|---|---|---|---|---|
| 0.28 | 10 | 3.2 | 1.1 | 0.65 | 0.014 |
| 1.4 | 50 | 5.1 | 4.5 | 4.6 | 0.036 |
| 2.27 | 80 | **91.7** | 32 | **119 300** | 0.10 |
| 4.25 | 150 | 30.7 | 34.6 | 1 833 | 0.123 |
| 8.2 | 290 | 15.7 | 37.8 | 4 297 | 0.129 |
| 11.6 | 410 | 51.5 | 53.6 | 15 493 | 0.146 |
| 14.5 | 510 | 57.7 | 60.0 | 14 974 | 0.154 |
| 20.4 | 720 | 58.6 | 72.2 | 9 928 | 0.169 |
| 25.5 | 900 | 58.7 | 86.5 | 6 117 | 0.187 |
| 34 | 1200 | 55.1 | 109.0 | 2 810 | 0.213 |

(The lab reads the stats every 10 frames and keeps 60 of the 120 readings in its results. The
2.27 s row, frame 80, comes from a 100-frame run of the same seed, `?baselineFrames=100`, which
keeps all its readings and repeats the 1200-frame run's history exactly; the other rows are
readings of the 1200-frame run.)

What it shows:

- **The core ignites at about 60 MK, not 15.** The first collapse reaches 91.7 MK at 2.3 s and
  burns 119 000 fusions per second for an instant; the cloud rebounds (core 15 to 30 MK), then
  settles from 11 s on at a **plateau of 58 to 59 MK** that slowly declines to 55 MK, with the
  fusion rate decaying from 15 000 to 2 800 per second as hydrogen runs out in the core. This is
  the "H burns near 50 MK in the simulator" of the plan's A2 note.
- **The density never saturates**: 109 rho0 at the end and still rising (about 2.5 rho0 per
  second over the last 20 s), the core keeps contracting while it burns.
- **omega.dt in the core, the oscillation frequency of a particle in the core times the substep,
  passes 0.1 at 3.7 s and reaches 0.21 at the end.** Phase P5's criterion (energy drift under 1 %
  for omega.dt up to 0.1) is not met for most of the run: the Verlet step is too long for the
  core from 3.7 s on, and gets worse as the core densifies.
- Composition at the end: 93 345 H, 75 491 He, 407 C from 400 000 hydrogen atoms (H + 4 He +
  12 C = 400 193: the mass number is conserved on average by the removal bookkeeping). The mass that
  the grids hold, in hydrogen masses, is 99.5 % of the initial one (`depositedMassOverCount`):
  the mass defect of the fusions (0.71 % of the fused mass, three quarters of it fused).
- The model's own stats (`Simulation.stat()`) agree with the lab's reading of the same GPU
  reduction: 55.138 MK, 108.98 rho0; the model smooths the fusion rate (2 948 against 2 810 per
  second).

Reproducibility on this GPU: a second run of the scenario gave the same 60 readings of core
temperature, density, fusion rate and omega.dt to the last printed digit, and the same final
composition.

## Ignition temperature ratio He/H

`baseline.protostar.ignition-ratio`, pure TypeScript (`src/simulation/protostar/ignition.ts`, the
inverse of `fusionRate()` in `reactions.ts`, itself the twin of `fusionRateOf` in
`protostar-common.glsl`). Temperature at which a particle's expected fusion rate
lambda rho^n (T / T_ref)^alpha reaches a reference rate, at a reference density; default
parameters (hydrogen: lambda 1.5e-4, alpha 2.8, T_ref 15 MK, n = 1; helium: lambda 3.75e-5,
alpha 16, T_ref 100 MK, n = 2).

At the reference point of the lab, 0.5 fusions per second per particle at 60 rho0 (about what
the core of the default cloud has once it burns: 58 MK, 60 to 65 rho0, 0.4 to 0.5 per second):

| | Ignition temperature |
|---|---|
| Hydrogen | 63.0 MK |
| Helium | 108.5 MK |
| **Ratio He/H** | **1.72** (real physics: 100 / 15 = 6.7) |

The ratio depends on the reference point, because the two laws have different density exponents
and different steepness. Of the table below only the corner at 0.01 per second and 300 rho0
exceeds 6.7, and the point the model actually works at is in its lower half:

| rate per particle (1/s) \ density (rho0) | 10 | 30 | 60 | 100 | 300 |
|---|---|---|---|---|---|
| 0.01 | 3.60 | 4.65 | 5.46 | 6.14 | 7.93 |
| 0.1 | 1.83 | 2.36 | 2.77 | 3.12 | 4.02 |
| 0.5 | 1.14 | 1.47 | **1.72** | 1.94 | 2.50 |
| 1 | 0.93 | 1.20 | 1.41 | 1.58 | 2.04 |

The professor's "about 2 to 2.5" is the order of the 0.1 per second row at 10 to 60 rho0 (1.8 to
2.8). Whatever the point, the current model ignites helium far too close to hydrogen: its steepness alpha = 16
at 100 MK (real value about 40) and alpha = 2.8 at 15 MK (real about 4) are both too gentle.
The target of phase P3b is a ratio of 6.7 at a reference point to be fixed there, which this
table makes comparable.

## Infrastructure checks

- `lab.selftest`: 9 checks pass. At G = 0 (below the slider's minimum of 0.1) the gravity grid is
  exactly zero; the deposit holds 19 999.999989 of 20 000 mass units (error 6e-10); the
  asynchronous and synchronous read-backs agree exactly; two runs of the same seed give the same
  moments grid bit for bit (with fusions forced, so the GPU random stream takes part), another
  seed differs by 7.8 units in a cell. Without the reset of the substep counter, two runs of the
  same seed differ by 2.5 units: the check does fail then.
- `protostar.half-float-deposit`: with the half-float path forced (`forcedPathTaken: true`), the
  deposited mass is 99 955 against 100 000 (error 4.5e-4), the worst occupied cell differs by
  1.3 % from the float32 value, the peak density by 2.3e-4. The scenario runs 6 frames of a
  100 000-particle cloud (peak density 1.25 rho0), so it does not test the large accumulations of
  a collapsed core: the half-float path is checked for correctness, not yet under load.

## Performance

`perf.<algorithm>.<count>`: median of four chunks of 30 timed frames after at least 30 frames and
1.5 s of warm-up, the GPU waited for at the end of each chunk, in ms per frame at the
algorithm's default parameters and speed (two substeps per frame for both). "Simulation" is
`Simulation.step()` plus `endFrame()`; "whole frame" adds the application's particle layer,
nebula, bloom and output (1024 x 768).

| Algorithm | Particles | Simulation (ms) | Whole frame (ms) | Recorded |
|---|---|---|---|---|
| Protostar | 400 000 | **8.3** (7.9 to 9.3) | **9.3** (8.6 to 10.0) | after P0c, 6 runs |
| Protostar | 1 000 000 | **17.9** (17.2 to 20.4) | **19.7** (18.4 to 20.4) | after P0c, 6 runs |
| Sticky dust | 400 000 | 9.9 | 18.7 | P0b, 4 runs (being re-measured) |
| Sticky dust | 1 000 000 | 16.0 | 33.4 | P0b, 4 runs (being re-measured) |

The protostar rows were recorded again on the code of phase P0c (commit `343d69c`), on the same
GPU with nothing else drawing on it: the runs went through a lock that the other users of the GPU
also take, and no headless Chrome was left over. Each figure is the median over six fresh pages of
the median of the four chunks of a page, with the range of the six pages in brackets. The first
recording of the protostar (20.2 and 39.6 ms) was disturbed (a stray Chrome was drawing on the
GPU): a clean run of the same code gives less than half. The sticky dust rows are those of the
first recording, unchanged: they are being measured again.

- The protostar's cost **varies within a measurement**: the 24 timed chunks (6 pages) go from 7.4
  to 9.8 ms at 400 000 particles and from 15.1 to 23.2 ms at 1 000 000. This follows the formation
  of the core, so the suspect is the additive deposit of many particles into a few cells, which
  serializes in the blending hardware; a GPU still raising its clocks may add to it. The cause is
  not isolated. The probe always warms up for the same time, so two phases are comparable as long
  as their dynamics are alike; a phase that changes how fast the core forms changes this number.
- 2.5 times more particles cost 2.2 times more for the protostar (after P0c) and 1.6 times more for
  the sticky dust (simulation, first recording).
- The animation-frame intervals (what the application's own GPU benchmark measures) read 16.7 ms
  in every case: headless Chrome runs animation frames on a 60 Hz timer and does not wait for the
  GPU. They are in the results (`animationFrameMedianMs`, flagged `animationFramesIgnoreGpu`) but
  mean nothing here; the synchronized figures above are the ones to compare.
- On a software renderer the probe reports `valid: false` and status `skip`.
  SwiftShader gave 1 400 to 2 800 ms per frame.

## After phase P0c

P0c (the [second deposit](spikes/a1-second-deposit.md): a second attachment of the moments pass,
read by nothing yet) changed no physics. `baseline.protostar.default-cloud` and `lab.selftest` were
run again on the same GPU, on the code that recorded this baseline and on the branch of P0c: the two
results are identical on all 428 values (all readings of the four series, peaks, final composition,
deposited mass, the self-test's checks), and every row of the table above is reproduced at its
printed precision.

The protostar rows of the performance table above were first recorded with the GPU in another
state than the one P0c found (20.2 and 39.6 ms) and have been re-recorded since (see there):
`perf.protostar.400k` on the branch of P0c (composition on) reads 8.2 to 8.6 ms for the simulation
and 8.8 to 9.1 ms for the whole frame (3 runs), `perf.protostar.1m` 17.0 to 18.3 and 17.4 to 19.9
ms; the extra cost of the composition is about 1 ms of the 8 (see the spike). Compare a phase with a
run of the previous code taken the same day on the same machine, not with a table recorded earlier.

## After phase P2

P2 (the sticky dust's [gravity per density texel](spikes/b1-dust-gravity.md) with an isotropic stencil) does
not touch the protostar. It changes the dust: the force is the old one to 0.2 % with the old stencil, and
84 % of it in RMS on a clumped cloud with the new one. Simulation and whole-frame times of the dust, runs
of the code before (`a83a556`) and after alternated, 5 pairs, the same hour (the GPU was in another state
than the one that recorded the performance table above, so compare these with each other only), median ms:

| Particles | Simulation before | Simulation after | Whole frame before | Whole frame after |
|---|---|---|---|---|
| 400 000 | 3.24 | 2.61 | 5.52 | 4.73 |
| 1 000 000 | 5.75 | 4.67 | 9.85 | 9.37 |
| 3 000 000 | 12.19 | 11.70 | 31.62 | 30.91 |

The protostar in the same hour, 4 runs: 6.85 (simulation) and 7.34 (whole frame) at 400 000 particles,
13.31 and 16.40 at 1 000 000.

## After phase P1a: the energy of the protostar

P1a (proposal A7 and the multichannel reduction, [algorithms.md](algorithms.md#energy-diagnostics))
made the energy of the cloud measurable. It changed no physics: `baseline.protostar.default-cloud` and
`lab.selftest` were run on the branch of P1a and on the code it comes from (`f722262`, the same GPU, two
development servers): the two results are identical on all 426 values, the 120 readings of the four
series, the peaks, the final composition and the self-test's checks included.

| | |
|---|---|
| Date | 2026-11-21 |
| Code | branch `feat/energy-diagnostics` on `f722262` |
| Renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)` |
| Browser | HeadlessChrome, ANGLE OpenGL backend, `EXT_float_blend` available |
| Area, seed | 1024 x 768 px, seed 20240611; speed 1.7 (two substeps of 14.17 ms per frame) |

Energies are in simulation units (mass x px^2/s^2); a specific energy is divided by `TOTAL_MASS` = 20 000.

### The diagnostics against CPU references

`protostar.energy-reference`, a cloud of 5 000 particles after 6 frames (smooth) and after 110 frames
(core formed, 4 690 live particles), the positions and velocities read back and summed on the CPU in
double precision:

| | 6 frames | 110 frames | Tolerance |
|---|---|---|---|
| K, reduction against the direct sum | 1.4e-7 | 1.7e-7 | 1e-5 (float32 accumulation) |
| U, reduction against the CPU twin of the grid scheme (same deposit, same two-level sums) | 3.0e-8 | 2.1e-7 | 1e-4 |
| U, reduction against the direct O(N^2) Plummer sum | 0.15 % | 0.33 % | 1 % |
| the same without removing the particles' self-interaction | 0.14 % | 0.10 % | |
| Self-interaction, share of U | 0.29 % | 0.23 % | |
| Grid gravity (ax, ay, potential) against the twin, relative to its maximum | 9e-7, 1.0e-6, 1.8e-6 | 8.7e-7, 6.3e-7, 1.0e-6 | 1e-4 |
| Virial ratio 2K / \|U\| | 0.31 | 0.70 | |

The tolerance of U against the direct sum is the grid's own approximation of the force law (see
`src/lab/config.ts`: up to 3.5 % for the pairs closer than the softening, which carry a small part of
the energy, below 1 % for the far pairs); the measured error is a third of the tolerance. Removing the
self-interaction is exact for the diagonal, but the grid's other approximations (the smoothing of the
kernel by the cloud-in-cell spread, which weakens close pairs) are of the same size and of the opposite
sign at this number of particles, so the corrected figure is not better than the uncorrected one here; at
400 000 particles the self-interaction is 6e-5 of U and the question disappears. The potential of the
previous substep, which the model keeps to pair with the velocities, comes back exactly (8.5e-10).

`protostar.reduction-channels`, 100 000 particles after 110 frames (core formed, 392 deposit units in
the busiest cell): every channel against the CPU sum of the grids read back, 1.4e-7 at worst (tolerance
1e-5); mass, kinetic energy, center of mass and momentum against sums over the particles themselves, 3.7e-8,
8.8e-8, 4.4e-5 px and 8e-9 to 4e-8 of the momentum scale. The speed bound
(max of |mean velocity| + sqrt(T) over the cells) is 1.12 times the speed of the fastest particle, with no
particle above it.

### The energy of a conservative run

`baseline.protostar.energy-drift`: 100 000 particles, cooling, feedback and both fusion rates set to 0
below the sliders' minima, walls elastic, 100 orbits; an orbit is the period of a circular orbit at the
initial half-mass radius, 10.54 s (372 frames, 37 216 frames for 100 orbits). The energy is read every
10 frames. Initial state of the default cloud: K = 5.66e7, U = -3.48e8, E = -2.91e8 (specific:
2 829, -17 380 and -14 552 px^2/s^2), **virial ratio 0.33** (the cloud falls in). The cold cloud on
circular orbits starts at K = 1.42e8, virial ratio 0.82.

| Drift of K + U (%) after | 1 orbit | 3 | 10 | 30 | 100 |
|---|---|---|---|---|---|
| default cloud, elastic walls | -0.05 | +0.21 | +1.31 | +5.50 | **+39.5** |
| cold cloud on circular orbits, elastic walls | +0.46 | +3.07 | +6.62 | +19.2 | +71.4 after 75 orbits |
| default cloud, the application's walls (restitution 0.5) | -5.2 | -8.6 | -13.2 | -17.8 | -19.8 after 63 orbits |

- **The criterion of the plan, K + U within 1 % over 100 orbits, is missed**: +39.5 % at 100 orbits (the
  runs were cut by their wall-clock budget at 75 and 63 orbits for the other two). The scenario
  was a `known-failure`, expected to be fixed by phase P5 (adaptive time step) if the dependence on the step below
  held; phase P5a found the cause in the walls and fixed it ([below](#after-phase-p5a-the-order-of-the-integration)). The virial ratio goes from 0.33 to about 1 within 3 orbits, then rises to 1.40: the cloud heats
  and expands.
- **The oscillation of the energy about its trend is small**: ±0.016 % (default cloud, running median over 2
  orbits taken off, one reading per 10 frames, that is 37 per orbit). The professor's figure of 2 to
  19 % oscillation of the energy with a fixed step is not seen in the energy of the whole cloud with this
  sampling; the core oscillates faster (about 0.9 s per period in the baseline's cloud) than the readings are spaced (0.28 s), so faster
  oscillations of a part of the energy would be aliased, not resolved. What the measure shows is a
  secular drift.
- The lag of the velocity texture behind the positions is real and corrected (the model pairs the new
  kinetic energy with the potential of the previous substep): the sum without the correction differs by less
  than 0.1 percentage point of drift and oscillates by ±0.033 % against ±0.016 %.
- The application's walls return half of the speed and take **14 %** within 12 orbits (the particles that
  the collapse throws out): that is a loss of the boundary, not of the scheme.

`baseline.protostar.energy-drift-attribution`, elastic walls, 12 orbits, the time step divided by 1, 2
and 4:

| Time step | 14.17 ms | 7.08 ms | 3.54 ms | 14.17 ms, the application's walls |
|---|---|---|---|---|
| drift after 3 orbits | +0.21 % | +0.03 % | -0.04 % | -8.6 % |
| drift after 6 orbits | +0.65 % | +0.25 % | +0.06 % | -11.0 % |
| drift after 12 orbits | +1.65 % | +0.72 % | +0.28 % | -14.0 % |
| drift rate after settling (% per orbit) | 0.162 | 0.077 | 0.036 | -0.51 |
| largest drift over the 12 orbits | 1.65 % | 0.72 % | 0.69 % | 14.0 % |

The rate of the secular drift is proportional to the time step (a factor 2.1 for each halving), which
makes the fixed step the main suspect and the first power of the step, not the second, its law; the cause
is not isolated (the grid force is not the gradient of the grid potential either, and it does not depend on
the step). If the proportionality held at 100 orbits, the 0.40 % per orbit the default cloud reaches would
need a step 40 times shorter to stay inside 1 %: an adaptive step (P5) is the way, not a fixed one.
**Superseded by phase P5a**: the cause was the bounce on the walls, not the step or the order of the passes; with it fixed the
rate is 0 at every step (see below).

### Cost of the diagnostics

`cost.protostar.diagnostics`, 400 000 particles, 7 fresh pages of 12 rounds, three modes alternated chunk
after chunk (30 frames) in the six orders: "plain" (the gravity pass without its potential channel, flag
off: the pass as it was), "flag off" (potential channel, flag off), "on" (the default). Paired differences
over 84 pairs; simulation only, ms per frame:

| | Median | Quartiles | Extremes |
|---|---|---|---|
| plain, absolute | 6.04 (runs 5.76 to 6.34) | | |
| potential channel (flag off - plain) | -0.03 | -0.25 to +0.14 | -1.52 and +1.96 |
| flag on - flag off | +0.04 | -0.15 to +0.18 | -1.08 and +1.14 |
| on - plain, all of it | -0.02 | -0.15 to +0.19 | -1.47 and +1.02 |

- The potential channel costs nothing measurable: on the grid passes alone, frozen early cloud (frame 55)
  +0.005 ms per substep of 2.94 (0.2 %), late cloud (frame 1 315) 0.000 of 1.59. The near-field loops
  are limited by their texture reads, and a multiply-add per term hides behind them.
- One call of the reduction (two passes) costs 0.28 ms (0.19 to 0.37), one of the potential stash (two
  passes) 0.25 ms (0.18 to 0.33): the reduction runs every 10 frames in both modes (the stats need it), the
  stash in the substeps of the frames that are read, which makes the flag about 0.05 ms per frame, 1 %.
- Across builds, `perf.protostar.400k` (simulation only) of the code before P1a (`f722262`) and of the
  branch, alternated in 14 pairs of fresh pages (8 with the old build first, 6 with it second): 8.19
  (7.73 to 8.77) against 8.28 ms (8.00 to 9.10); paired difference +0.20 ms median (-0.47 to +1.04; the sign
  follows the order of the pair: -0.06 with the old build first, +0.25 second), whole frame +0.24 ms (-1.09
  to +1.79). That is within the noise of a run, and 2 % at most.

All of it is far below the 10 % of a frame that the plan sets: **`diagnostics` is on by default**.

## After phase P6a

P6a (the [granular dust](spikes/a10-granular-dust.md)) does not touch the protostar. It changes the sticky dust's physics (an agitation energy
in the density grid's alpha channel, Haff sticking, a kinetic pressure, a colour from the agitation), after a gain of 1.2 on its gravity slider
restored the pull B1's isotropic stencil had weakened. The default dust cloud (`dust.default-cloud`, 400 000 particles, seed 20240612, 15 s), before
(`05cb977`) and after:

| | Before | After |
|---|---|---|
| Time to 2 / 5 / 10 / 20 / 30 % of the mass in dense texels | 2.02 / 2.05 / 2.10 / 2.19 / 2.28 s | 2.06 / 2.16 / 2.27 / 2.37 / 2.48 s |
| First supernova | 2.78 s | 2.78 s |
| At 15 s: dense share, clumps, peak density | 29.5 %, 4, 106 | 19.9 %, 4, 98 |
| Supernovae in 15 s | 1 | 2 |

Simulation ms/frame of the dust, the build before and after alternated, 6 pairs, medians (the cost depends on the phase of the cloud; see the spike):

| Particles | Frames 10 to 50, before / after | Frames 150 to 190, before / after |
|---|---|---|
| 400 000 | 3.72 / 3.53 | 2.85 / 2.83 |
| 1 000 000 | 4.72 / 4.78 | 4.42 / 5.03 |

## After phase P3a: heating by scaling, the noise of the temperature

P3a (proposals A5 and A3, [the spike](spikes/a5-a3-heating-and-t-noise.md)) **changes the physics** of the protostar, so the
default cloud above is the record of the code before it (`5ed76ae`). The same run on the branch of P3a, same GPU, same seed (the
averaged temperature with tau = 0.1 s, the bias correction and the heating by scaling all on):

| t (s) | frame | core T (MK) before | after | peak density (rho0) before | after | fusions / s before | after |
|---|---|---|---|---|---|---|---|
| 0.28 | 10 | 3.2 | 3.1 | 1.1 | 1.1 | 0.65 | 0.78 |
| 1.4 | 50 | 5.1 | 5.1 | 4.5 | 4.5 | 4.6 | 3.0 |
| 2.27 | 80 | **91.7** | **90.3** | 32 | 33 | **119 300** | **33 500** |
| 4.25 | 150 | 30.7 | 29.6 | 34.6 | 30.3 | 1 833 | 1 512 |
| 8.2 | 290 | 15.7 | 14.6 | 37.8 | 37.4 | 4 297 | 2 129 |
| 11.6 | 410 | 51.5 | 66.8 | 53.6 | 67.6 | 15 493 | 29 813 |
| 14.5 | 510 | 57.7 | 67.0 | 60.0 | 63.8 | 14 974 | 19 702 |
| 20.4 | 720 | 58.6 | 68.1 | 72.2 | 76.7 | 9 928 | 10 222 |
| 34 | 1200 | 55.1 | 79.3 | 109.0 | 130 | 2 810 | 2 334 |

At the end: 20 153 H, 92 948 He, 544 C (before: 93 345, 75 491, 407). The shape is the same up to 10 s: the first collapse
at 2.27 s reaches the same temperature (90 against 92 MK) and density, the cloud rebounds and the core settles, and what changes is
the **rate of the first burst, 3.6 times lower** (the average of T takes the top off the collapse's short temperature spikes).
After that this seed's burning history goes another way: a plateau of 67 to 68 MK instead of 58, a faster consumption of the
hydrogen (95 % burnt at 34 s against 77 %), a helium flare at 119 MK at 20.7 s. The burn history of this star is chaotic, one seed
is not its plateau: over three seeds the last quarter's core temperature is 56.7 MK before (56.5 to 57.1) and 61.9 MK after (52.1 to
78.8), the heating by scaling alone gives 57.8 and the correction alone changes nothing (the core holds thousands of particles
per neighborhood); see the table of `baseline.protostar.default-cloud-variants` in the spike. No default was retuned: the star
ignites and burns hydrogen then helium as before, and the recalibration of G, lambda, alpha and the feedback is planned for
the end of P3b. The recorded table above stays the reference for phases that must not change the physics; for those that
do, compare with `baseline.protostar.default-cloud-variants`, whose first variant is the code before P3a.

Switching the three changes off (the kick of every cell, no correction, no average: `baseline.protostar.default-cloud-variants`, first
variant) reproduces the table above to the last digit for the first 250 frames and then diverges slowly, as any two
runs of this chaotic history do.

Acceptance checks of the phase (`protostar.heating`, `protostar.temperature-noise`; numbers and method in the spike): the energy
the heating adds is q dt to 4e-6 on isolated cells and to 3e-4 on a gas of 1 400 particles per neighborhood, the momentum is
unchanged to rounding on isolated cells, the mean fusion rate of a thermal gas is within 2.1 % of the true rate at 100 to 6 400
particles per neighborhood and exponents 4 and 40 (uncorrected: up to 51 times too high). Simulation cost at 400 000 particles: not
measurable (8.57 ms before, 8.62 ms after, median of 6 alternated pairs).

## After phase P6b

P6b (the [coherent supernova](spikes/a9-coherent-supernova.md)) does not touch the protostar. It changes the sticky dust's supernova (gravity on the
ejecta, a front that slows down as `1/R`, a homologous ejection, a trigger on mass) and retunes `SUPERNOVA_SPEED` (420 to 840 px/s) and
`SUPERNOVA_COOLDOWN` (120 to 240 frames). The default cloud's supernovae over 30 s (`dust.supernova.history`, 400 000 particles, three clouds), before
(`d2c1dac`) and after:

| | Before | After |
|---|---|---|
| Supernovae in 30 s | 4, 5, 5 | 4, 4, 4 |
| Times, first cloud (s) | 3.0, 12.5, 18.5, 27.5 | 3.0, 9.0, 18.5, 25.0 |
| Ejecta of the first event after 2 s: mean distance (zone radii), share inside the zone | 6.6, 0.00 | 2.7, 0.00 |
| Time for the front to reach the farthest corner, 640 px (`dust.supernova.blast`) | 2.0 s (constant speed) | 5.3 s (`R^2` linear in `t`, exponent 0.500) |

Simulation ms/frame of the dust, the build before and after alternated, 6 pairs, medians:

| Particles | Frames 10 to 50, before / after | Frames 150 to 190, before / after |
|---|---|---|
| 400 000 | 3.51 / 3.68 | 2.83 / 2.90 |
| 1 000 000 | 4.76 / 4.83 | 4.93 / 5.06 |

## After phase B4

B4 ([the sticky dust's concentration on the GPU](spikes/b4-gpu-concentration.md)) does not touch the protostar, the parameters or the statistics. It replaces the dust's periodic read-back of the positions
(up to 48 MB every 12 frames and a loop over them in JavaScript) by a GPU search of the densest disk that reads back two texels, and the mask of the ejected particles by a test in the velocity pass.
GTX 1060, the build before (`11a7a7a`) and after alternated, 6 pairs, medians (the GPU was clocked low during these runs: read the ratios, not the milliseconds):

| | Before | After |
|---|---|---|
| GPU against CPU (`dust.concentration.parity`, 35 comparisons): center, share of the mass, particles inside | | 5e-4 px, 4.4e-4 points, the same particles (one of 2 181 899 apart) |
| Worst frame over 360 frames of a cloud whose read never stops (`perf.dustHitch`), 400 000 / 1 000 000 / 3 000 000 particles | 68.5 / 74.3 / 209.2 ms | 20.1 / 31.6 / 96.7 ms |
| p99 frame, the same | 61.2 / 63.7 / 147.9 ms | 19.6 / 27.9 / 92.3 ms |
| Simulation ms/frame, frames 10 to 50 (reads) at 400 000 / 1 000 000 particles | 3.48 / 14.90 | 3.20 / 14.45 (-9 %, -4 %) |
| Simulation ms/frame, frames 150 to 190 (no read) at 400 000 / 1 000 000 particles | 9.76 / 17.38 | 9.51 / 16.94 (-2.6 %, -2.6 %) |
| One GPU search (`perf.dustConcentration`), 400 000 / 1 000 000 / 3 000 000 particles, the default cloud collapsed | | 4.1 / 5.3 / 16.6 ms |
| The default cloud's supernovae at the application's pace (`dust.supernova.paced`, three clouds) | 4, 4, 3 events; first at 2.73 to 2.75 s | 3, 4, 4 events; first at 2.75 s |
| The same in the lab's unpaced loop (`dust.supernova.seeds`) | first at 3.03 s, second at 9.03 s | first at 2.78 s, second at 13.5 to 16.0 s (a property of the loop, see the spike) |

The blast, homology and infall scenarios (`dust.supernova.blast`, `.infall`) give the numbers of phase P6b to the digit.

## After phase P3b-1: the molecular weight in the temperature

P3b-1 (proposal A1, [the spike](spikes/a1-mean-molecular-weight.md)) **changes the physics** and the defaults of the protostar. The
temperature the fusion rate, the glow and the stats read is the velocity dispersion times mu / mu_H (1 for hydrogen, 2.65 for
helium, 3.40 for carbon); the heating, the cooling and the energy keep the dispersion. Pure hydrogen is unchanged. G 13.85 -> 9 and
lambda_0 1.5e-4 -> 4e-3 are a minimal recalibration so that the default cloud still burns hydrogen at about 15 MK and helium at
about 100 MK; the fine recalibration is left to the Gamow rates (A2). Same GPU, seeds 20240611 to 20240613, 1200 frames
(`baseline.protostar.default-cloud-tuning`); "A1 off" is the same build with the factor forced to 1, which reproduces the P3a
table above to the printed digit for the seed of the baseline.

| 34 s, three seeds | P3a physics (A1 off), old defaults | A1 on, old defaults | **A1 on, new defaults** |
|---|---|---|---|
| core T while H burns, median (MK) | 58.3, 52.3, 53.6 | 22.1, 45.4, 30.5 | **14.5, 15.7, 15.8** |
| highest core T (MK) | 119, 88, 101 | 300, 209, 213 | 247, 269, 170 |
| core T in the last quarter (MK) | 78.8, 52.1, 54.8 | 259, 171, 172 | 101, 155, 47.5 |
| hydrogen left of 400 000 | 20 153, 121 539, 99 669 | 3 921, 47 926, 41 089 | 3 257, 60, 430 |
| helium / carbon at the end | 92 948 / 544, 69 815 / 0, 75 628 / 4 | 486 / 32 567, 3 059 / 28 366, 1 892 / 29 348 | 25 997 / 24 499, 2 510 / 32 664, 26 812 / 24 165 |
| peak fusions per second | 66 000, 35 000, 36 000 | 107 000, 100 000, 115 000 | 637 000, 615 000, 683 000 |

The seed of the baseline (20240611), new defaults, at the rows of the first table (readings of 10 frames, the nearest to each row):

| t (s) | frame | core T (MK) | peak density (rho0) | fusions / s | H, He, C |
|---|---|---|---|---|---|
| 0.28 | 10 | 1.9 | 1.1 | 6 | 400 000, 0, 0 |
| 1.4 | 50 | 1.9 | 2.6 | 4 | 399 999, 0, 0 |
| 2.0 | 70 | 5.1 | 8.4 | 160 | 399 996, 2, 0 |
| 4.25 | 150 | 5.1 | 12.9 | 93 | 281 244, 25 552, 1 431 |
| 8.2 | 290 | 15.7 | 31.7 | 11 280 | 261 181, 30 546, 1 431 |
| 11.6 | 410 | 16.1 | 29.9 | 20 411 | 219 315, 40 854, 1 431 |
| 14.5 | 510 | 95.4 | 41.6 | 167 970 | 171 400, 52 915, 1 431 |
| 20.4 | 720 | 31.5 | 33.7 | 9 948 | 52 810, 82 598, 1 441 |
| 25.5 | 900 | 51.9 | 47.1 | 2 075 | 8 358, 92 832, 1 720 |
| 34 | 1200 | 138.9 | 99.8 | 824 | 3 257, 25 997, 24 499 |

What changed against P3a, honestly:

- **Hydrogen burns at 15 MK, not 55**: the first collapse is colder (5 MK at 2 s against 24), hydrogen burns on a plateau of 15 to 16 MK
  (8 to 12 s) and the cloud has burnt 99 % of its hydrogen at 34 s (against 70 to 95 %).
- **The star is no longer a stable burner to the end**: its hydrogen is gone in 20 s and the helium core contracts and ignites in a
  flash (the fusion rate of the whole cloud peaks at 600 000 to 700 000 per second, against 35 000 to 66 000), converting most of its
  helium to carbon (33 000 carbons would be all of it: 32 700 at 34 s in one seed, 24 200 and 24 500 in the two others). The helium burns at 59 to
  114 MK (weighted median over the carbon made) and its flash peaks at 170 to 270 MK, carbon ash included (it reads 3.4 times its
  dispersion and does not burn here). With the carbon formed the cloud ends at 140 to 160 MK, a reading and not a runaway.
- **The burn history is as chaotic as before**: one seed of three keeps 26 000 helium at 34 s, the three go to carbon within 56 s.
- The default recalibration is not a calibration: see the spike for what was and was not touched.
- **Cost**, `perf.protostar.400k` simulation at 400 000 particles, the build before (`9109727`) and this one alternated, 6 pairs: 8.51 ms
  (8.32 to 9.46) against **7.21 ms** (7.00 to 7.73) with each build's own defaults (the new cloud is colder and less crushed in the
  probe's window), whole frame 9.33 against 7.34 ms; on the same physics (the new build set to the old defaults and the factor off,
  18 pairs, the GPU at low clocks that day: 25 ms) the paired difference is **-0.25 ms** (-8.9 to +7.0), not measurable.

Acceptance checks of the phase (numbers and method in the spike): at equal dispersion the helium gas reads 2.6477 times the hydrogen gas
(error 3e-8), a mixture's factor is that of a CPU deposit of its particles to 1e-6; the mean fusion rate of pure gases of
20 rho0 equals the law's twin to 0.26 % and the ignition ratio He/H at 0.5 per second is 4.3 on them, 5.57 at the lab's reference
point (0.5 per second, 60 rho0) with the new defaults against 1.72 with the old ones. A1 alone (laws unchanged) leaves the
ratio of temperatures where it was and lowers the ratio of dispersions 2.65 times.

## After phase P5a: the order of the integration

P5a ([the spike](spikes/p5a-integrator-order.md)) changes how the velocity and position passes treat a bounce on a wall and the
first substep of a run; nothing else (not the order of the passes, not the grids, not the parameters or the statistics). The
first-order drift of the conservative run found by P1a was the walls'. Same GPU and protocol as the P1a section (100 000 particles,
elastic walls, seed 20240611, 1024 x 768 px area), on the head of the improvements branch at the time (`4dae91f`, with phase P3b-1's
G = 9: the orbit lasts 13.08 s now, 10.54 s in the P1a section) "before", and the same plus P5a "after" (the commits of this phase).

`baseline.protostar.energy-drift` (the default cloud, 100 orbits of 46 168 frames; 224 s of wall time; the scenario is a `pass`):

| Drift of K + U (%) after | 1 orbit | 3 | 10 | 30 | 100 |
|---|---|---|---|---|---|
| default cloud, before (P1a's run, G = 13.85) | -0.05 | +0.21 | +1.31 | +5.50 | +39.5 |
| default cloud, before (`4dae91f`) | -0.07 | +0.14 | +1.00 | +4.17 | +16.5 after 76 orbits (budget) |
| default cloud, **after** | **-0.136** | **-0.140** | **-0.145** | **-0.146** | **-0.133** |
| cold cloud on circular orbits, before (`4dae91f`) | +0.36 | +2.48 | +5.50 | | +10.0 after 19.5 orbits |
| cold cloud on circular orbits, **after** | -0.07 | +0.05 | +0.08 | +0.15 | +0.20 after 54 orbits (budget) |

The largest drift of the default cloud over the run is 0.71 % (the first collapse, in the first orbit; 0.16 % after the fifth orbit),
the slope after settling 7e-5 % per orbit (0.007 % over 100 orbits) and the oscillation about it +-0.006 %. The criterion (below 1 %)
is met and the scenario is a `pass`. The synchronized and the unsynchronized sums differ only in the first collapse (largest excursion 4.9 %
against 0.71 %). The cold cloud: the largest drift 0.72 % (also the first orbit), slope 0.0027 % per orbit, ten times the default cloud's and
the one slope that does not vanish: a floor of about 0.3 % over 100 orbits whose cause is not isolated (the grid force is the suspect, see
[algorithms](algorithms.md)); the criterion is judged on the default cloud. With the application's walls (restitution 0.5) the energy is not
conserved by construction: -5.18, -8.61, -12.79, -17.31 % after 1, 3, 10 and 30 orbits (-18.4 % after 44), against -5.15, -8.59, -13.03 % before
(-15.3 % after 16 orbits): the boundary's, not the scheme's.

`baseline.protostar.energy-drift-attribution`, 12 orbits, elastic walls, the time step divided by 1, 2 and 4 (the dt/4 run of the new
code stops after 5.4 orbits on its time budget):

| Slope after settling, % per orbit | 14.17 ms | 7.08 ms | 3.54 ms |
|---|---|---|---|
| before, `36ea02b` (P1a: clamp, `v(n)` reversed alone) | 0.162 | 0.077 | 0.036 |
| before, `4dae91f` | 0.127 | 0.061 | 0.029 |
| position mirrored, `v(n)` still reversed alone (`36ea02b`, a variant that was not kept) | 0.105 | 0.051 | 0.023 |
| **after** (the bounce as an event of the step) | **-0.0008** | **-0.0008** | **+0.00007** |
| drift after 12 orbits, before (`4dae91f`) / after | 1.27 / -0.144 | 0.55 / -0.140 | 0.19 / -0.137 (5.4 orbits) |
| largest drift over the run, before / after | 1.27 / 0.78 | 0.71 / 0.70 | 0.68 / 0.69 |

The drift no longer depends on the step: what is left, -0.14 % from the first orbit on, is set by the first collapse (-0.145, -0.134,
-0.134 % after one orbit at the three steps) and does not grow; the first-order slope of the rows before (0.127, 0.061, 0.029: halved
with the step) is gone. The 1.5 u a dt of energy per bounce that the walls gained explains the rows before: the clamp of the position was
a third of it (0.162 to 0.105 is 35 %), the velocity reversed alone the other two thirds. Putting back half of the old spare kick of the first
substep on the new scheme changes nothing (-0.141 and -0.139 % after 12 orbits at dt and dt/2, slope -0.0009 and -0.0002 % per orbit,
measured on `36ea02b`'s physics): the first substep was not what drifted. A CPU twin of the particle-mesh force without walls (a one-off script, not kept: 20 000
particles, 64 x 64 grid) gives the same energy series at dt, dt/2 and dt/4 (3.03, 3.03, 3.04 % after one orbit): velocity Verlet with the
grid force has no dependence on the step of its own (that run is confounded by particles that leave the grid, so its absolute drift is not a floor).

The unit tests (`tests/leapfrog.test.ts`) pin the second order on a Kepler orbit (energy error 1.13e-2, 2.87e-3, 7.2e-4 at 100, 200 and 400
steps a period, no drift over 100 periods) and on a bouncing particle. `protostar.integration`: pass, 4 steps of 20 000 particles with 591
bounces, worst error 1.2e-4 px and 9.1e-5 px/s against the CPU twin (tolerance 5e-4), no particle beyond the tolerances.

The consistency scenarios of phase P1a on the new code: `lab.selftest` passes (9 checks); `protostar.energy-reference` passes (K 2.8e-8, U to
the twin 1.4e-8, U to the pair sum 0.15 %); `protostar.reduction-channels` **fails on `4dae91f` as well as here** (peak temperature 4.9e-2
before, 3.9e-2 after, against the twin of the grids; the channels against the particles pass to 1e-7): since phase P3b-1 the reduction's peak
temperature is the temperature (times mu / mu_H) and the lab's twin (`src/lab/energyReference.ts`) still reads the dispersion. Not a P5a effect,
left for the owner of that phase.

The default cloud (`baseline.protostar.default-cloud-tuning`, one variant with the defaults, 400 000 particles, 1 200 frames, seeds 20240611 to
20240613; "before" is `4dae91f` and reproduces the P3b-1 table above to the digit, which makes the comparison exact):

| 34 s, three seeds | before | after |
|---|---|---|
| core T while H burns, median (MK) (readings every 20 frames) | 14.0, 14.9, 15.9 | 14.2, 14.7, 15.5 |
| highest core T (MK) | 247, 269, 170 | 162, 214, 115 |
| core T in the last quarter (MK) | 101, 155, 47.5 | 63, 139, 54 |
| hydrogen left of 400 000 | 3 257, 60, 430 | 219, 51, 459 |
| helium / carbon at the end | 25 997 / 24 499, 2 510 / 32 664, 26 812 / 24 165 | 61 723 / 12 750, 1 505 / 32 558, 67 684 / 10 737 |
| peak fusions per second (at 2.83 s in all six runs) | 637 000, 615 000, 683 000 | 509 000, 481 000, 550 000 |

The first collapse is the same to a few percent until frame 70 (peak density 8.4 against 8.2 rho0, 2.0 s) and the burst of the fusion rate at
2.8 s is 20 % lower in the three seeds. That burst is the same to the digit (509 200, 481 460, 549 920 per second) with the old walls on the new
first substep: it is the removal of the spare kick of the first substep (every particle of the old scheme got a full `a dt` too many, inward,
0.7 % of its orbital speed: a harder first collapse), not the walls. After the first collapse the history is chaotic and the two builds
diverge, as two seeds of the same build do. With eight seeds each (20240611 to 20240618): the hydrogen plateau at 14.4 (before) and 13.9 MK
(after, means; spread 1.1 and 1.2), hydrogen below 20 000 at 22.1 and 21.8 s (medians), carbon above 10 000 at 26.4 and 26.7 s, carbon at 34 s
27 300 and 26 200 on average (spread of one build: 16 800 to 33 200): not distinguishable. What does differ is the helium flash's peak
core T: 250 MK on average (spread 60) before, 183 (spread 34) after, lower in seven seeds of eight, and the peak fusion rate (649 000 and 547 000, the
burst above). The star still behaves: hydrogen burns at about 15 MK, is gone by 30 s, helium ignites at 115 to 240 MK and turns to carbon (10 700 to
33 600 carbons at 34 s), the last-quarter temperature stays at 54 to 209 MK, no runaway.

Simulation ms/frame, `perf.protostar.400k` and `.1m`, `4dae91f` and the new code alternated, 6 pairs of fresh pages, GTX 1060 (read the ratios):

| | Before | After | Paired ratio, median |
|---|---|---|---|
| 400 000 particles | 7.28 (6.82 to 7.40) | 7.11 (6.86 to 7.42) | 0.98 |
| 1 000 000 particles | 13.99 (13.08 to 14.21) | 14.36 (13.97 to 15.45) | 1.02 |

Not measurable (a spread of 5 to 10 % of the readings): the change adds no texture read and two cheap branches.

## After phase P5b: initial conditions consistent with the disc

P5b ([the spike](spikes/a8-initial-conditions.md)) changes the initial cloud of the protostar: the circular speed is the disc's own (a table of the softened disc, not the sphere's formula), the sliders
`rotation` and `agitation` become the virial ratio `alphaVir` = 2K/|U| (0.33) and the rotation energy `betaRot` = E_rot/|U| (0.08), and there are two new choices: a Maclaurin density profile and a correlated
agitation (white noise is the default). Same GPU and protocol as the sections above (400 000 particles, seeds 20240611 to 20240613, 1 200 frames, 1024 x 768 px area); "before" is `da1473c`, which reproduces the
P5a table above to the digit.

The initial energies (seed 20240611, `|U|` = 2.261e8 mass px^2/s^2 from the disc's table): K 3.681e7 before, 3.731e7 after (+1.4 %); E_rot 1.79e7 and 1.81e7; 2K/|U| 0.326 and 0.330 (the old recipe on the disc: 0.325, with beta 0.079). The
reduction reads at t = 0 the virial ratio the sliders ask for to 0.2 % (`protostar.initial-conditions`, ten clouds) and the grid's pull matches the table's to 0.5 % in the median ring (worst ring 5 % at 0.16 R,
`protostar.initial-grid-force`). Toomre's Q (stellar criterion, measured on the particles): 0.19 to 0.25 from 0.25 to 0.75 R after, against 0.33 at 0.3 R falling to 0.18 at 0.94 R before.

The cold Maclaurin disc (`protostar.maclaurin-collapse`): the free-fall time estimated from the half-mass radius is 1.0125, 1.017, 1.023 and 1.025 of the analytic 1.787 s at 0.75, 0.5, 0.25 and 0.1 of the initial radius,
the same at half the time step; within the plan's 2 % for the first half of the fall, 0.7 to 0.9 points of the excess being the grid's smoothing (2.4 px as a Plummer length) and the slider's softening 0.2 to 0.3.

The default cloud (`baseline.protostar.default-cloud-tuning`, the series are decimated to 60 points of 0.57 s):

| 34 s, three seeds | before | after (white, the default) |
|---|---|---|
| peak density of the first collapse (rho0) | 25.7, 25.8, 26.7 | 30.2, 28.3, 31.5 |
| peak fusion rate of the first burst (per s), time | 43 000, 43 900, 43 400 at 3.1 s | 32 000, 30 400, 33 500 at 2.55 s |
| core T at that burst (MK) | 19, 19, 21 | 23, 22, 26 |
| hydrogen burnt by 4.5 s | 30, 29, 31 % | 37, 36, 37 % |
| core T, 8 to 12 s (MK) | 14.2, 16.5, 19.8 | 10.2, 13.8, 19.6 |
| hydrogen below 20 000 at (s) | 21.5, 18.7, 22.1 | 24.4, 22.7, 18.7 |
| carbon above 10 000 at (s) | 34.0, 27.8, 31.7 | 27.8, 24.9, not reached |
| highest core T (MK) | 114, 214, 114 | 219, 259, 147 |
| hydrogen / helium / carbon at 34 s | 219 / 61 723 / 12 750, 51 / 1 505 / 32 558, 459 / 67 684 / 10 737 | 62 / 196 / 33 443, 210 / 3 638 / 32 056, 1 096 / 75 082 / 8 236 |

The first collapse shifts the same way in the three seeds (10 to 20 % denser, burst 25 % lower and 0.5 s earlier at a core 3 to 5 MK hotter, 6 to 7 points more hydrogen burnt by 4.5 s; the likely cause, not isolated by a run of its own, is the rotation of the inner disc, which is a third of the sphere's at 0.07 R and 0.55 of it at 0.33 R); afterwards the history is the chaotic one of before, with the same plateaus and flashes. With `turbulence: correlated` the burst is 3 to 10 times higher (105 000 to 298 000 per second at 48 to 116 MK):
the gas pass reads a correlated flow as bulk motion, not as heat, and the cloud has almost no pressure at the start.

The restart (`perf.protostar.restart`, median of five): 305, 629 and 1 047 ms at 400 000, 1 000 000 and 2 000 000 particles against 487, 1 154 and 2 388 ms before (the sort by radius is gone); the table is 4.4 ms.
Not P5b's: `protostar.reduction-channels` still fails by the temperature of the peak (see P5a above) and `baseline.protostar.energy-drift` skips when the shared GPU does not leave its budget (95 of 100 orbits: drift -0.17 %, largest 0.80 %).

## After phase P3b-2: the Gamow rates, and the recalibration of the defaults

P3b-2 (proposal A2, [the spike](spikes/a2-gamow-rates.md)) **changes the physics** and one default of the protostar. The fusion rate is
Gamow's per nucleus, `lambda (rho X)^n f(T) / f(T_ref)`, with `f` the real temperature law (proton-proton `T^(-2/3) exp(-33.8 T6^(-1/3))`, local exponent 3.9
at 15 MK; triple alpha `T8^-3 exp(-44 / T8)`, 41 at 100 MK), the mass fractions X and Y of the fuels in the neighborhood in it, no exponent sliders,
and the noise of T corrected at the real exponents (an exact unbiased estimate for the triple alpha). Defaults: lambda_He 3.75e-5 -> **2.5e-4** (a pure helium gas of 20 rho0
fuses 0.1 times per second at exactly 100 MK; hydrogen at 15.9 MK there, He/H 6.3), glow range 1 to 7 -> 1 to 15 T0; lambda_0, G, cooling, opacity and feedback unchanged
(scanned twice, see the spike). Same GPU and protocol as above (400 000 particles, 1024 x 768 px area, 1200 frames = 34 s, seeds 20240611 onward), on top of phase P5a and of the
initial conditions of P5b (`9215ab1`, whose default cloud is the "before" below: it reproduces the P5b table's numbers to the digit).

Three seeds, 34 s; "A1 defaults" are the same defaults on the Gamow laws:

| 34 s, three seeds | before (power laws, A1 defaults) | A1 defaults on the Gamow laws | **new defaults** |
|---|---|---|---|
| hydrogen burnt before 4.5 s (the first collapse) | 37 %, 36 %, 37 % | 35 %, 35 %, 35 % | 35 %, 35 %, 35 % |
| peak fusions per second of that burst | 32 000, 30 400, 33 500 | 738 000, 773 000, 757 000 | 783 000, 807 000, 771 000 |
| core T on the plateau, median (MK) | 10.2, 16.3, 20.6 | 19.9, 16.2, 15.7 | 38.7, 17.7, 19.2 |
| core T weighted by the hydrogen burnt after (MK) | 9.6, 18.8, 24.3 | 19.9, 14.8, 24.6 | 16.7, 17.5, 23.7 |
| highest core T (MK) | 219, 259, 147 | 205, 223, 268 | 205, 213, 168 |
| core T in the last quarter (MK) | 133, 164, 58 | 51, 57, 87 | 72, 77, 55 |
| hydrogen left of 400 000 | 62, 210, 1 096 | 47 601, 33 655, 22 408 | 47 291, 24 551, 24 246 |
| helium / carbon at the end | 196 / 33 443, 3 638 / 32 056, 75 082 / 8 236 | 72 021 / 5 544, 39 809 / 17 171, 24 151 / 23 365 | 79 371 / 3 030, 17 238 / 25 456, 64 162 / 10 057 |
| first helium flash (carbon + 3 000 over its 6 s value), s | 27.8, 24.9, 17.6 | none, 28.3, 23.2 | none, 24.6, 17.6 |

Six seeds, medians (34 s): plateau **18.2 MK** (14.8 to 38.7, five seeds in six within 10 to 20 MK; A1's defaults on the Gamow laws: 19.9, four in six), helium flash in
five seeds of six at **22.9 s** (A1's defaults: five of six, 28.3 s), 25 800 hydrogens left, core T in the last 15 %: 79 MK. Twelve seeds (20240611 to 20240622): plateau 18.2 and 18.3 MK in each half, nine seeds in twelve in the target, helium flash in ten of twelve.
Three seeds at 56 s (2 000 frames): plateau 51.2, 17.7, 20.2 MK; helium flash at 48.7, 24.9, 17.9 s; hydrogen left 13 314, 4 615, 8 349; core T in the last 15 %: 86, 157, 91 MK
(before: 219, 229, 52).

The seed of the baseline (20240611), new defaults, at the rows of the first table (readings of 10 frames, the nearest to each row); it is the weak seed of the three (a plateau at 39 MK):

| t (s) | frame | core T (MK) | peak density (rho0) | fusions / s | H, He, C |
|---|---|---|---|---|---|
| 0.28 | 10 | 2.0 | 1.1 | 0.0187 | 400 000, 0, 0 |
| 1.42 | 50 | 1.6 | 2.3 | 0.000528 | 400 000, 0, 0 |
| 1.98 | 70 | 3.7 | 6.5 | 0.247 | 400 000, 0, 0 |
| 4.25 | 150 | 3.6 | 6.9 | 0.54 | 259 209, 26 612, 3 030 |
| 8.22 | 290 | 23.5 | 37.4 | 7 628 | 254 996, 27 619, 3 030 |
| 11.6 | 410 | 13.7 | 36.2 | 5 352 | 229 178, 34 089, 3 030 |
| 14.4 | 510 | 8.0 | 40.3 | 20 661 | 193 787, 42 944, 3 030 |
| 20.4 | 720 | 38.7 | 38.4 | 6 865 | 110 495, 63 654, 3 030 |
| 25.5 | 900 | 58.2 | 49.4 | 4 756 | 83 061, 70 464, 3 030 |
| 34.0 | 1200 | 81.0 | 90.3 | 1 892 | 47 291, 79 371, 3 030 |

What changed against the build before, honestly:

- **The cloud starts colder in fusion and burns the hydrogen at 15 to 20 MK, in a flash at the first collapse.** The rate at 2 MK is 0.02 fusions per second (6 before): the
  Gamow law gives a particle at 2 MK 7e-6 of its rate at 15 MK, where the power law gave 3e-3. The first collapse burns 35 % of the hydrogen in a burst of 770 000 to 810 000 fusions per second (37 %,
  32 000 before): about the same share of the hydrogen, burnt in 0.3 s instead of 3, because the law is steep below 10 MK. This is the main thing the recalibration did not remove.
- **The plateau is at 18 MK and the helium flash is five seconds earlier than with A1's values**; one seed in three (and one in six) runs a hot plateau, 39 to 51 MK, and ignites its helium late (49 s).
- **The hydrogen lasts longer**: 25 000 left at 34 s against 200, and 4 600 to 13 000 at 56 s against 0 to 600.
- **The carbon ash reads 33 to 95 MK at 34 s and 86 to 157 MK at 56 s**: carbon is 3.4 times its dispersion and does not burn (600 MK); the highest reading of the runs of the phase is about 410 MK, for one reading in a helium flash.
- **Cost**, `perf.protostar.400k` at 400 000 particles, the build before (`9215ab1`) and this one alternated, six pairs, each build with its own defaults: whole frame 24.34 against 24.81 ms (paired difference +0.12 ms, -0.47 to +1.10); on the same dynamics (the cloud only expanding, nothing fusing) 25.42 against 25.94 ms, **+0.80 ms or +3.2 %**, the new build slower in six pairs of six; the GPU in its P5 state (734 MHz, three times the idle frame time), and the simulation-only figure unreadable for the steps of the clock between runs. The first-visit benchmark finds the same cap (700 000 particles at 5 to 9 ms per 400 000, replayed with a fake 60 Hz clock; 490 000 at 12 ms).

Acceptance checks of the phase (numbers and method in the spike): the local exponents measured on the GPU are the theory's within 0.023 % (4.969 against
4.970 at 8 MK of hydrogen, 3.904 at 15 MK, 2.961 at 30 MK; 59.96, 41.07, 19.04 for helium at 70, 100 and 200 MK); the ignition temperature of a pure gas of 20 rho0 moves by
0.581, 0.502 and 0.379 per decade of lambda for hydrogen (1.7 to 2.6), 0.947 to 0.939 for helium, which is `10^(-1/alpha)`; He/H of the pure gases at 0.1 per second is
6.297 on the GPU (law 6.293, real 6.67); the corrected mean rate at the real exponents is within 5 % of the true one for hydrogen at every N (0.998 to 1.005) and for helium from 200 particles per
neighborhood (1.015 +- 0.010 at 200, 1.003 at 400, 0.987 at 800; 1.053 +- 0.019 at 100, not judged), where dividing by the bias left 3.54 at 100 and 1.16 at 400;
`protostar.reduction-channels` passes again (its twin read the dispersion instead of the temperature, and the gas grid of the wrong substep).

## After phase P5c: the adaptive time step

The record of the scenarios of [spike B5](spikes/b5-adaptive-time-step.md) (`baseline.protostar.adaptive-step`, `protostar.adaptive-maclaurin`, `cost.protostar.adaptive-step`, the energy drift with the
time step changing), on the code rebased on the Gamow rates of phase P3b-2. Same machine and area as above, 400 000 particles, speed 1.7, seeds 20240611 to 20240613. The flag is **off by default**: every other
baseline in this file is unchanged (`protostar.energy-reference` and `protostar.reduction-channels` give identical metrics, digit for digit, on the head of the improvements branch and on this one).

| | fixed count (2 substeps) | adaptive (2 or 3) |
|---|---|---|
| substeps per frame, mean over the run | 2.00 | 2.69, 2.66, 2.59 (35 % of the frames at 2, 65 % at 3) |
| omega dt in the core, largest of a run | 0.171, 0.158, 0.176 | 0.138, 0.116, 0.113 |
| omega dt, median; share of the readings above 0.1 | 0.112, 0.106, 0.106; 71, 73, 70 % | 0.081, 0.077, 0.086; 15, 12, 23 % |
| first burst of the fusion rate against the reference at 1/8 of the substep: height | +12.8, +12.2, +11.2 % | +10.9, +9.5, +8.6 % (1/4 of the substep: +2.5, +4.2, +2.6 %) |
| the same: timing | +11.1, +8.9, +9.7 ms | +12.8, +9.8, +10.8 ms (1/4 of the substep: +2.2, +2.9, +2.6 ms) |
| cold Maclaurin disc: free-fall time at 0.75, 0.5, 0.25, 0.1 of the radius, over the analytic one | 1.0125, 1.0169, 1.0233, 1.0251 | the same to 1e-4 (and at 1/4 and 1/8 of the substep) |
| cost, whole run, ms / frame at 400 000 and 1 000 000 particles (5 alternated pairs, the adaptive count replayed) | 18.0, 34.1 | 23.4, 44.1: ratios 1.30 (1.25 to 1.31) and 1.29 (1.27 to 1.29) |
| substeps per simulated second | 70.6 | 94.9 (+34 %) |

The omega dt of the core by time of the run, the three seeds together (median / largest):

| t (s) | 0-2 | 2-4 | 4-8 | 8-12 | 12-16 | 16-20 | 20-24 | 24-28 | 28-34 |
|---|---|---|---|---|---|---|---|---|---|
| fixed | .014 / .037 | .056 / .103 | .085 / .101 | .103 / .118 | .108 / .145 | .110 / .145 | .112 / .144 | .127 / .176 | .147 / .169 |
| adaptive | .014 / .037 | .048 / .089 | .085 / .120 | .100 / .108 | .073 / .116 | .073 / .092 | .074 / .103 | .084 / .102 | .098 / .138 |
| substeps per frame | 2.00 | 2.27 | 2.00 | 2.07 | 2.78 | 3.00 | 3.00 | 3.00 | 3.00 |

**Energy drift of a conservative run** (100 000 particles, elastic walls, cooling, feedback and fusion off, the GPU shared and the run held to its wall-clock budget, hence `skip` with the 1 % target met; before
A2, which does not enter a run with the fusion off): the default cloud, K + U after 1, 3, 10 and 30 orbits and at the end (largest excursion): fixed step, 95 orbits: -0.170, -0.171, -0.165, -0.170, -0.17 % (0.80 %);
adaptive step as shipped, 96 orbits, 2.0002 substeps a frame (the conservative cloud almost never asks for a third): -0.245, -0.240, -0.231, -0.244, -0.24 % (0.80 %); the count changing every frame between 1 and 4
(2.25 on average), 86 orbits: -0.158, -0.151, -0.148, -0.159, -0.13 % (0.91 %), slope +0.0002 % per orbit. The cold cloud on circular orbits: +0.09 % (0.52 to 0.58 %) in all three.

## After phase P3c: fusion of parcels of constant mass

P3c (proposal A4, [the spike](spikes/a4-constant-mass-fusion.md)) changes the bookkeeping of the fusions, not their laws, and **no default**. A fusing particle changes type and keeps its mass and its
velocity; none is removed; every type deposits the same mass; the statistical drift correction and the periodic read-back of the positions are gone; the particles of each type are counted on the GPU.
Same GPU and protocol as above (400 000 particles, 1024 x 768 px area, 1 200 frames = 34 s, seeds 20240611 onward), on top of phase P3b-2 (`0e4fc9c`, whose default cloud is the "before" below: it reproduces the A2 table
to the digit). The old tables count particles of different masses (H + 4 He + 12 C = the hydrogen atoms of the cloud); the figures below are **percent of the mass**, which both builds can give.

| 34 s, six seeds | before (A2) | after (A4) |
|---|---|---|
| hydrogen burnt before 4.5 s | 35 %, 35 %, 35 %, 35 %, 34 %, 36 % | 35 %, 35 %, 36 %, 35 %, 34 %, 36 % |
| peak fusions per second of that burst | 783 k, 807 k, 771 k, 779 k, 759 k, 785 k | 946 k, 891 k, 842 k, 856 k, 809 k, 994 k |
| core T on the plateau, median (MK) | 38.7, 17.7, 19.2, 18.2, 14.8, 16.4 | 11.9, 18.7, 17.1, 20.9, 25.2, 11.6 |
| core T weighted by the hydrogen burnt after (MK) | 16.7, 17.5, 23.7, 24.4, 11.9, 29.5 | 23.8, 41.6, 20.0, 33.7, 27.6, 12.1 |
| highest core T after 6 s (MK) | 99, 196, 150, 151, 64, 114 | 285, 144, 211, 162, 113, 233 |
| core T in the last 15 % (MK) | 79, 86, 33, 95, 41, 67 | 86, 102, 181, 123, 47, 77 |
| hydrogen left (% of the mass) | 11.8, 6.1, 6.1, 5.8, 16.1, 6.4 | 6.3, 5.7, 1.8, 2.9, 10.2, 6.0 |
| helium left (% of the mass) | 79, 17, 64, 33, 50, 62 | 25, 27, 1, 2, 60, 23 |
| carbon (% of the mass) | 9, 76, 30, 61, 33, 32 | 68, 67, 98, 95, 30, 71 |
| first helium flash (s) | none, 24.6, 17.6, 15.3, 22.9, 25.2 | 26.4, 23.2, 18.7, 24.4, 32.0, 25.5 |

Six seeds, medians: first collapse 35 % in both (891 000 fusions per second against 783 000), plateau **18.7 MK** (5 seeds of 6 in 10 to 20 MK before, 4 of 6 after; twelve seeds 17.9 MK, 9 of 12, as in the A2 twelve), helium flash in
**6 of 6** seeds (median 25.5 s; 5 of 6 at 22.9 s before; twelve seeds 12 of 12), carbon **70 %** of the mass at 34 s in the median (33 % before), core T in the last 15 % 102 MK (79).

The seed of the baseline (20240611), at the rows of the first table (the readings of 10 frames nearest to each row); the three columns are particles, which are parcels of one mass:

| t (s) | frame | core T (MK) | peak density (rho0) | fusions / s | H, He, C (parcels) |
|---|---|---|---|---|---|
| 0.28 | 10 | 2.0 | 1.1 | 0.019 | 400 000, 0, 0 |
| 1.42 | 50 | 1.6 | 2.3 | 0.001 | 400 000, 0, 0 |
| 1.98 | 70 | 3.7 | 6.5 | 0.247 | 400 000, 0, 0 |
| 4.25 | 150 | 3.7 | 6.9 | 0.523 | 259 499, 105 953, 34 548 |
| 8.22 | 290 | 10.1 | 30.5 | 3 639 | 253 127, 112 325, 34 548 |
| 11.62 | 410 | 12.0 | 36.3 | 6 187 | 227 795, 137 657, 34 548 |
| 14.45 | 510 | 7.8 | 37.2 | 12 351 | 185 196, 180 256, 34 548 |
| 20.40 | 720 | 8.3 | 44.4 | 4 696 | 122 872, 242 580, 34 548 |
| 25.50 | 900 | 56.6 | 54.5 | 9 738 | 79 615, 285 837, 34 548 |
| 34.00 | 1200 | 119.5 | 84.4 | 2 541 | 25 272, 100 799, 273 929 |

What changed against the build before, honestly:

- **Nothing before the first fusions**: the rows at frames 10, 50 and 70 are the same to the printed digit, and the first collapse burns 35 % in every seed. The burst is 14 % higher (the core is not thinned by removals).
- **The helium burns further**: carbon is 70 % of the mass at 34 s against 33 % in the median, two seeds of six ending above 95 %; the flash starts within the spread of the seeds. Switching the correction of the
  noise of T off moves the build before from 33 to 44 % and this build from 70 to 69 %: the effective number of particles of the correction accounted for a part of it, not all ([the spike](spikes/a4-constant-mass-fusion.md)).
- **Momentum, energy and counts**: no gravity, 10 000 substeps, the momentum of a fusing gas moves by 4.5e-9 of its thermal momentum (5.3e-3 before, with half of the particles gone); the energy the fusions
  release is the power deposited to 0.25 %; the default cloud has its 400 000 particles at the end (54 360 before) and 193 632 of them within 40 px of the densest cell (21 771 before).
- **The mass the grids hold is the cloud's**: `depositedMassOverCount` of the baseline scenario is 0.99993 (99.5 % before: the mass defect, which now leaves only as energy).

- **Cost** (six alternated pairs on the GPU in its P5 state, [the spike](spikes/a4-constant-mass-fusion.md)): the late window of the default cloud (frames 1 000 to 1 040) costs **15.6 -> 23.3 ms/frame at 400 000 particles and 27.0 -> 41.8 at 1 000 000** (x1.5: nothing is removed any more); the early window is the same load (50.0 against 51.1 ms at 1 000 000; at 400 000 the pairs read 25.4 against 10.8 and a clocked pair 10.9 against 11.0: a state of the GPU); the worst frame over the median of the periodic readings falls from 65, 68 and 135 ms to 8, 14 and 26 ms at 400 000, 1 000 000 and 2 000 000 particles. The type count on the GPU costs 2.1, 4.2 and 5.9 ms per count at 400 000, 1 000 000 and 2 000 000 particles, every 10 frames. The first-visit benchmark's cap is 580 000 for both builds at equal early cost (replayed with a fake 60 Hz clock).

## After phase C1: the collisions of the gas (RTX 5070)

Phase C1 ([the spike](spikes/c1-mpc-collisions.md)) adds the `collisions` flag, **off by default**: with it off, the passes take one
uniform branch and the deposit is skipped, and the default cloud runs as before (see [the reference on the RTX 5070](#reference-on-the-rtx-5070)).
Recorded on the branch `feat/mpc-collisions` (headless Windows Chrome 157, Direct3D 11, RTX 5070). The figures with the flag on:

| Scenario | Result |
|---|---|
| `protostar.collisions.parity` | GPU against the twin 4.2e-7 sigma; momentum 1.1e-8 N sigma, energy 5.4e-9 (one substep, 200 000 particles) |
| `protostar.collisions.conservation` | 30 substeps: momentum 3.5e-7 N sigma, energy 2.7e-7 (half floats: 4.7e-3 and -3.2e-3) |
| `baseline.protostar.energy-drift` with `params={"collisions":true}` | +0.27 % over 100 orbits (max 0.67 %), circular -0.04 % (0.17 %), application walls -184 % in 78 orbits; the same run off: -0.17 %, +0.24 %, -20 % in 86 orbits |
| `protostar.collisions.sod` | best gamma 2 in the collisional limit and at the application's rate (density error 0.014 against 0.021 at 5/3 and 2.5); shock at 752 px, exact 747 |
| `protostar.collisions.sound-speed` | gamma_eff 2.04 (collisional limit), 2.05 (application rate); damping 0.15 and 0.11 /s; without collisions 1.68 /s |
| `protostar.collisions.equipartition` | dispersion ratio 4 -> 1.00 with e-folding times of 2.5 substeps (4 particles per cell) and 21 (33 per cell); 3.95 and 3.99 without |
| default cloud, 3 seeds, `cloudVariants=[{"name":"collisions","params":{"collisions":true}}]` | first collapse burns 39.8 % of H (33.5 % off), the helium flashes at 7.4 s (about 23 s off), peak density 433 to 450 rho0 (193 to 365 off), the star is 99.8 % carbon at 34 s |
| cost, `perf.protostarPhases.*`, frames 10 to 50 | 400 000: 3.50 -> 3.99 ms (+14 %); 1 000 000: 6.64 -> 7.85 ms (+18 %); frames 1000 to 1040: +31 % and +63 % |
| cost, `perf.protostar.*` | 400 000: simulation 3.17 -> 4.55 ms, whole frame 5.01 -> 7.47 ms; 1 000 000: 5.74 -> 9.64 and 8.62 -> 15.96 ms |

## Open points for later phases

- The energy-drift scenario (`baseline.protostar.energy-drift`) runs since phase P1a; it was a documented
  known failure (K + U +39.5 % over 100 orbits, against a target of 1 %) and passes since phase P5a, which
  removed the first-order error of the walls. The omega.dt column above is the precursor of the criterion that
  the adaptive time step (B5, phase P5c, off by default) uses. Re-record its table, with the commit, whenever the integration or the gravity change.
- The ignition ratio is 5.41 at the reference point (0.5 per second, 60 rho0) since P3b-2 (5.57 with the P3b-1 power laws, 1.72 before), and 6.3
  at 20 rho0 and 0.1 per second, where lambda_He is normalised; it is a property of the point (4.1 to 10.9 over 20 to 100 rho0 and 0.03 to 0.5 per
  second), not of the model. The reference point is a lab convention.
- Re-record this baseline, with the commit it comes from, whenever a phase recalibrates G,
  lambda, alpha or the feedback (the plan's recalibration steps).
