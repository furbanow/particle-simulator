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
  is a `known-failure`, fixed by phase P5 (adaptive time step) if the dependence on the step below
  holds. The virial ratio goes from 0.33 to about 1 within 3 orbits, then rises to 1.40: the cloud heats
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

## Open points for later phases

- The energy-drift scenario (`baseline.protostar.energy-drift`) runs since phase P1a and is a
  documented known failure (K + U +39.5 % over 100 orbits, against a target of 1 %): it turns to `pass`
  when phase P5 (adaptive time step) brings the secular drift down. The omega.dt column above is its
  precursor. Re-record its table, with the commit, whenever the integration or the gravity change.
- The ignition ratio is the number to move in P3b; the reference point (0.5 per second, 60 rho0)
  is a lab convention, to be revisited with the new rate laws, and the table above is the
  evidence that it matters.
- Re-record this baseline, with the commit it comes from, whenever a phase recalibrates G,
  lambda, alpha or the feedback (the plan's recalibration steps).
