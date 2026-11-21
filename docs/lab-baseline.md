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

| Algorithm | Particles | Simulation (ms) | Whole frame (ms) |
|---|---|---|---|
| Protostar | 400 000 | 20.2 | 24.1 |
| Protostar | 1 000 000 | 39.6 | 50.2 |
| Sticky dust | 400 000 | 9.9 | 18.7 |
| Sticky dust | 1 000 000 | 16.0 | 33.4 |

Spread over four runs on this machine (simulation, whole frame): protostar 400 000, 19.8 to
22.0 and 24.1 to 25.1 ms; protostar 1 000 000, 38.6 to 39.6 and 47.1 to 54.2 ms; sticky dust
400 000, 9.5 to 9.9 and 18.7 to 19.0 ms; sticky dust 1 000 000, 16.0 to 16.2 and 32.1 to 33.4 ms.
Count on about 10 % between runs.

- The protostar's cost **varies within a measurement**: at 400 000 particles the four chunks
  were 19.2 to 22.2 ms in this run and 12.4 to 21.8 ms in another; at 1 000 000 they climb from 34
  to 47 ms. This follows the formation of the core, so the suspect is the additive deposit of many
  particles into a few cells, which serializes in the blending hardware; a GPU still raising its
  clocks may add to it. The cause is not isolated. The probe always warms up for the same time, so
  two phases are comparable as long as their dynamics are alike; a phase that changes how fast
  the core forms changes this number.
- 2.5 times more particles cost 2.0 times more for the protostar and 1.6 times more for the sticky
  dust (simulation).
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

The performance table above was recorded with the GPU in another state than the one P0c found.
`perf.protostar.400k` on the branch of P0c (composition on) reads 8.2 to 8.6 ms for the simulation
and 8.8 to 9.1 ms for the whole frame (3 runs), `perf.protostar.1m` 17.0 to 18.3 and 17.4 to 19.9
ms, against 20.2, 24.1, 39.6 and 50.2 ms here; the extra cost of the composition is about 1 ms of
the 8 (see the spike). Compare a phase with a run of the previous code taken the same day on the
same machine, not with the table.

## Open points for later phases

- The energy-drift scenario (`baseline.protostar.energy-drift`) is registered and skipped: it
  needs the potential energy of A7 (phase P1a). The omega.dt column above is its precursor.
- The ignition ratio is the number to move in P3b; the reference point (0.5 per second, 60 rho0)
  is a lab convention, to be revisited with the new rate laws, and the table above is the
  evidence that it matters.
- Re-record this baseline, with the commit it comes from, whenever a phase recalibrates G,
  lambda, alpha or the feedback (the plan's recalibration steps).
