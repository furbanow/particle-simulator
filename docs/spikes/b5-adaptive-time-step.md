# Spike B5: the protostar's adaptive time step

Phase P5c of the improvement plan (proposal B5, protostar only; the sticky dust is not concerned). The substeps of a frame were `ceil(speed)` of
`BASE_DT x speed / ceil(speed)`: a time step that does not look at what the cloud is doing, so that the dense core of the default cloud is
integrated at an omega dt that grows from 0.01 to 0.21 over 34 s. This document records the criterion, what changes in the integration when the step
changes, the constants and what they were chosen from, what the lab measured, and why the flag is off by default.

## Verdict

Measured on the code after the Gamow rates of phase P3b-2 (A2), whose recalibration changed the default cloud's history; the tuning of the constants was done before it (below).

- **The step adapts and the core is kept within the criterion.** With the flag on, the default cloud (400 000 particles, speed 1.7, three seeds, 34 s) runs 2 or 3 substeps a frame
  (2.69, 2.66 and 2.59 on average: 35 % of the frames at 2, 65 % at 3; the 3s in the first burst, 2.6 to 3.1 s, and from 11 to 14 s on) and the omega dt of its core never exceeds
  **0.138, 0.116 and 0.113** (0.171, 0.158 and 0.176 at the fixed step; 0.21 at 34 s in the baseline of phase P0b). Its median falls from 0.11 to 0.08, the share of the readings above 0.1
  from 70 % to 12 to 23 %, above 0.15 from 3 to 12 % to none. The count changes three times in a run (2 -> 3 -> 2 -> 3), by one each time.
- **It does not do worse than the fixed step, and does a little better where the core is.** Against a reference at 1/8 of the substep the adaptive run is identical to the fixed one until the
  burst (the count is never under the fixed one) and closer after it: the first burst of the fusion rate is +10.9, +9.5 and +8.6 % too high (+12.8, +12.2 and +11.2 % at the fixed step; +2.5,
  +4.2 and +2.6 % at 1/4 of the substep), the density of the core 23 to 38 % closer in the burst's window; its timing is not better, 0.9 to 1.7 ms later than the fixed step's (9 to 13 ms behind the
  reference; 1/4 of the substep itself leaves 2 to 3 ms, the random draws of the fusions differing from run to run). The gain is smaller than it was with the defaults before A2 (+15 to +20 % at the
  fixed step, +9 to +13 % adaptive): the new rates make a gentler burst. The cold Maclaurin disc's free-fall time
  agrees with its reference to 1e-4 at every step: gravity alone is converged at the default step.
- **It costs a quarter to a third more work: the flag is off by default.** The substeps per simulated second go from 70.6 to 94.9 (+34 %, the schedule of the rebased run) and the time of the whole run of the default cloud by **+30 % (1.25 to 1.31) at 400 000 particles and +29 % (1.27 to 1.29) at 1 000 000**, 5 alternated pairs; with the schedule of the tuning
  runs, before A2 (2.41 substeps a frame), it was +19 % (1.18 to 1.25) and +22 %. The plan sets a tenth of a frame as the cost under which a flag is on by default. The cost is where the core is dense: the last
  half of the run costs 15.2 ms a frame at the fixed step and 22.1 at 3 substeps.
- **Four things the lab found on the way**, kept in the code. Running *fewer* substeps than the fixed count in the calm phases (the plan's "calm phases need fewer") delays the first burst by
  6 ms more and doubles the early error of the density, for 3 % of the work saved (they are 6 % of the frames): the count is never below the fixed one (`PROTOSTAR_MIN_SUBSTEP_RATIO` = 1). The
  core read after a frame describes the grids of its *last substep*, one substep before the end of the frame, so a run at a coarse step looks late by `(dt - dt_ref) d ln(rho) / dt` (4 % of the
  density at 2 s) if the reading is not dated so. The early fall of the default cloud converges more slowly than second order in the step, and not through the integrator or the cooling
  (below). And after A2 the criterion of the default cloud sits at 15 to 17 ms from 11 to 20 s, right at the 14.2 ms of two substeps: the count is at the edge of its threshold, and the release margin
  keeps 3 where 2 would nearly do.
- With the count changing every frame between 1 and 4 substeps, a conservative run keeps K + U within 0.91 % over 86 orbits (-0.13 %, as at the fixed step); the integration on the GPU with a
  step that changes agrees with its twin to 1.6e-4 px/s; with the flag off the frame is the one of before, digit for digit (all at the end of the numbers).

## What the adaptive step is

The frame still simulates `BASE_DT x speed`; only the number of substeps it is cut into adapts, between frames (the substep is the same inside
a frame). `Simulation.step()` asks the model (`ProtostarModel.substepCount(frameTime, fixedCount)`); with the flag `adaptiveTimeStep` off the answer
is `ceil(speed)` and the frame is the same one, bit for bit, as before the phase. The pure part (`src/simulation/protostar/timeStep.ts`, tested):

    dt_crit = min( COURANT cell / |v|max , OMEGA sqrt( max(eps, cell) / |a|max ) )

- **The acceleration term** is the accuracy of the core. In a core of oscillation frequency omega a particle is pulled by at most omega^2 eps (the
  Plummer force of softening eps peaks at 0.385 G M / eps^2 and the core's omega^2 is G M / eps^3 at the centre: a / (eps omega^2) is 0.4 for a point
  mass; the lab's default cloud has 1.0 to 1.4 once the core has formed, 4 to 18 before, where the largest pull is at the edge of the cloud, not
  in the core), so `OMEGA sqrt(eps / a)` is `OMEGA / omega` or less: omega dt stays under OMEGA, and the criterion is conservative where the core
  has not formed. eps is taken as no less than a cell: below that the force is the grid's own smoothing.
- **The speed term** keeps the gas from crossing more than `COURANT` cells in a substep (the deposit and the gathering of the grids resolve one
  cell). In the default cloud it decides only the first seconds (speed bound 190 to 410 px/s against a 8 px cell).
- **Both maxima are the reduction's proxies** (`reduction.ts`: the speed bound is the largest |mean velocity| + sqrt(t) of a cell, the acceleration
  bound the largest |a| of the gravity grid) and they arrive late: an asynchronous read, a frame or two old. They are read every
  `PROTOSTAR_STEP_READ_INTERVAL` frames while the flag is on.
- **The count** is the smallest one that keeps every substep within dt_crit, between `PROTOSTAR_MIN_SUBSTEP_RATIO` x and
  `PROTOSTAR_MAX_SUBSTEP_RATIO` x the fixed count (1 and 1.5: refine only, and never more than half as many substeps as the benchmark measured; at
  speed 1.7 that is 2 or 3). It goes up at once and comes down one count at a time, and only when the lower count keeps 85 % of dt_crit
  (`PROTOSTAR_STEP_RELEASE`): the count of the default cloud changes 3 to 15 times in 34 s, by one each time. While a drawing or the point force acts, the count
  is at least the fixed one (their pull is not in the maxima). The velocity caps (`PROTOSTAR_MAX_SPEED`) are kept: the lab did not try to remove them.
- **The benchmark** runs with the flag off (`BENCHMARK_PARAMS`): it times the calm first frames of a restart, where the adaptive step would run
  fewer substeps than later (with a minimum under 1 it would run 1 instead of 2), and its count depends on the instant the asynchronous reads land; the fixed count is
  a deterministic load, and the adaptive step is bounded by a ratio of it.

## The scheme with a step that changes

The velocity pass computes `v(n) = v(n-1) + (a(n-1) + a(n)) dt / 2` and the position pass `x(n+1) = x(n) + v(n) dt + a(n) dt^2 / 2` ([spike P5a](p5a-integrator-order.md)); both
half kicks of `v(n)` belong to the step that ended at `x(n)`, the drift to the step that starts there. With a step that changes they must therefore take different lengths:
the half kicks the *previous* substep's (`dtPrev`, one uniform shared by the two passes, kept by `ProtostarModel.beforeSubstep()`, which ignores the calls with `dt = 0` the
lab makes to draw the grids), the drift, the cooling, the heating, the fusion draw and the bounce the current one. Written as the map `(x(n), v(n)) -> (x(n+1), v(n+1))` that is
velocity Verlet with a step of any length at each step: second order for any sequence of steps (symplectic while the sequence does not depend on the state), and the velocity
stored after a wall bounce, `-e (v + a s dt) - a s dt`, is exact whatever the next step is, because the next substep's kicks are over this substep's `dt`. The first substep owes no
kick (`z = 1`) and takes no `dtPrev`. With the flag off `dtPrev = dt` and the passes compute what they did.

Before this phase both kicks took the current `dt`, which is wrong by `a (dt - dt') / 2` at every change: the speed slider's, and every change of the adaptive count.

- **Twin** (`leapfrog.ts`, `tests/leapfrog.test.ts`): a Kepler orbit whose frames are cut into 1 to 4 substeps (the pattern 2 2 3 3 4 3 2 2 1 1 2 3, the frame at 80, 160, 320 and 640
  to the period): the energy error is 7.2e-3, 1.8e-3, 3.7e-4 and 8.9e-5 (order 2.0 to 2.3), and 100 periods leave it where 10 did (x 1.0); with the half kicks over the current
  step (the shaders of before) it is 0.91, 0.25, 0.12 and 0.054 (order 1.0 to 1.1): 600 times larger at the finest. A step that follows the orbit (proportional to r^1.5, an
  equal angle at every step) is second order too, and its error grows slowly with time (+1.8e-6 per period): a step chosen from the state is not symplectic, which the application's
  count (the same for every particle, from the maxima of the cloud) is not.
- **GPU, one step at a time** (`protostar.integration`): 10 steps of 20 000 particles of a gas that fills the area, the first four of one length and the six others each of its own (0.25 to 0.9 of a frame
  at the default speed halved), against the twin fed with the GPU's own accelerations: 1 131 bounces, worst error 1.2e-4 px and 1.6e-4 px/s, none beyond the tolerances.
- **GPU, over a run** (`baseline.protostar.energy-drift&energyStep=varying`): the conservative default cloud (cooling, feedback and fusion off, elastic walls) with a count that changes every frame, from
  the pattern 2 3 1 2 4 2 3 1 (so a substep of 7 to 28 ms, 2.25 on average): K + U -0.16, -0.15, -0.15 and -0.16 % after 1, 3, 10 and 30 orbits, **-0.13 % after 86 orbits**, the largest excursion 0.91 %
  (the first collapse), a slope of +0.0002 % per orbit and an oscillation of 0.006 %: what the fixed step does (-0.17 %, 0.80 %, -0.00009 % per orbit), and the criterion of the plan, under 1 %, met.

## Where the constants come from

The constants were tuned on the code *before* A2 landed (the defaults of the time had a more violent burst), with the criterion run with other constants on the same clouds (`stepVariants`; two seeds, the count between
1 and 1.5 x the fixed count or more, so *with* the calm-phase coarsening that was later removed; the reference is 1/8 of the substep; the time of the readings corrected as below). The choice was kept after the rebase;
the figures of the verdict are those of the rebased code with the final constants.

| | substeps / frame | omega dt max | burst height error | burst timing lag |
|---|---|---|---|---|
| fixed count (2) | 2.00 | 0.164, 0.175 | +18, +20 % | 12 ms |
| OMEGA 0.10, any ceiling | 2.92, 2.94 | 0.093 | +10, +12 % | 17 ms |
| **OMEGA 0.12**, ceiling 1.5 x | 2.42, 2.40 | 0.122, 0.111 | +11, +11 % | 19 ms |
| OMEGA 0.15 | 2.11, 2.13 | 0.144, 0.146 | +16, +18 % | 20, 21 ms |
| OMEGA 0.20 | 1.88, 1.87 | 0.214, 0.189 | +16, +17 % | 21 ms |
| OMEGA 0.12, read every 3 frames | 2.40, 2.34 | 0.120, 0.109 | +11, +11 % | 19 ms |
| OMEGA 0.12, read every 10 frames (the stats' cadence) | 2.23, 2.23 | 0.126, 0.141 | +11, +11 % | 19 ms |

- **OMEGA = 0.12**: omega dt (the lab's: the core's oscillation frequency, `probeCore`, times the substep) follows the constant to within 10 % (the largest figure of a run is OMEGA x 0.92 to
  1.06 before A2, 0.94 to 1.15 after it, because the largest pull is not always the core's: a / (eps omega^2) is 1.0 to 1.4 once the core has formed). There is a knee: at 0.15 and 0.2 the count is
  that of the fixed step for most of the run and the burst is as wrong as it was; at 0.12 the burst is closer by a third (before A2) for 21 % more work, at 0.10 for 46 % more (2.9
  substeps) and no more accuracy to speak of. The plan's `omega dt <= 0.1` is therefore not bought: 0.12 is the price of a core kept under about 0.13.
- **COURANT = 1**: the first runs used 0.5, which makes the speed term decide the whole first phase (a speed bound of 190 to 410 px/s against a cell of 8 px: 2 and 3 substeps while the
  core's omega dt is 0.01 to 0.05). At 1 the speed bound decides the first frames only (an offline replay of the criterion on the fixed run's maxima with a speed term of 1.5 cells, or none, gives the same counts).
- **Reading every 3 frames** (`PROTOSTAR_STEP_READ_INTERVAL`) gives the same omega dt as every frame (age of the reading 0 to 3 frames, median 1) for a third of the reductions (0.28 ms each
  at 400 000 particles); every 10 frames (no extra reduction) lets the largest omega dt of a run go 15 % higher (0.126 and 0.141) and leaves the count lower on average: the cloud
  does not change faster than that in 34 s (an offline replay of the criterion on the fixed run's per-frame maxima, with the reading 1, 2, 4, 6 and 10 frames old, moves the largest omega
  dt by 0.095 -> 0.109 at OMEGA 0.1 and 0.138 -> 0.156 at 0.15). The cold Maclaurin disc, a collapse to a point, was not sensitive to the cadence either (all the free-fall
  times agree to 1e-4). `PROTOSTAR_STEP_MAX_READINGS` = 3 reads in flight at most.
- **Release 0.85, one count at a time**: no flicker (3 to 15 changes of the count in 1 200 frames, the shortest stay at a count is more than 3 frames in every run). The price is the one seen after A2:
  a criterion hovering just over the threshold of a count keeps the higher one.
- **Ceiling 1.5 x the fixed count**: the work of a frame is bounded by half as much again as what the benchmark measured. In the default cloud it is never reached at speed 1.7 (the
  criterion asks for 4 substeps at 34 s only with OMEGA 0.1 and without ceiling).
- **Minimum 1 x the fixed count** (`PROTOSTAR_MIN_SUBSTEP_RATIO`): with the minimum at 1 substep, the first 65 to 75 frames of a run (the calm phase) ran 1 substep: the density rms error
  of the first second grows from 0.0020 to 0.0034 and of the next from 0.012 to 0.023, and the burst comes 6 ms later than at the fixed step (18 to 21 ms behind the reference, against
  12 ms), for 3 % of the work saved. A ratio under 1 is kept in config for the clouds that stay calm much longer (a lower G, a higher speed) and have more to save; the default is 1.
- **The velocity caps stay** (`PROTOSTAR_MAX_SPEED`, 2 L/s): the criterion does not replace the clamp that the heating's energy bound also uses; the lab did not try to remove it.

## Numbers

All on the GTX 1060 (`ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)`, at low clocks: read the ratios), HeadlessChrome with the ANGLE OpenGL backend,
area 1024 x 768 px, default parameters and speed 1.7 (frame 28.3 ms, fixed substep 14.2 ms), seeds 20240611 to 20240613, 400 000 particles, the code of this branch rebased on `0e4fc9c` (A2). The adaptive runs
are paced to the animation frames, as the application runs, so that the asynchronous reads land with the lag they have there (0 to 3 frames, median 1).

**The omega dt of the core, over the run** (the readings of the three seeds, every 5 frames; fixed count, then adaptive; mean substeps and the share of frames at 3):

| t (s) | fixed: median / max | adaptive: median / max | substeps / frame | frames at 3 |
|---|---|---|---|---|
| 0 to 2 | 0.014 / 0.037 | 0.014 / 0.037 | 2.00 | 0 % |
| 2 to 4 (the first burst) | 0.056 / 0.103 | 0.048 / 0.089 | 2.27 | 27 % |
| 4 to 8 | 0.085 / 0.101 | 0.085 / 0.120 | 2.00 | 0 % |
| 8 to 12 | 0.103 / 0.118 | 0.100 / 0.108 | 2.07 | 7 % |
| 12 to 16 | 0.108 / 0.145 | 0.073 / 0.116 | 2.78 | 78 % |
| 16 to 20 | 0.110 / 0.145 | 0.073 / 0.092 | 3.00 | 100 % |
| 20 to 24 | 0.112 / 0.144 | 0.074 / 0.103 | 3.00 | 100 % |
| 24 to 28 | 0.127 / 0.176 | 0.084 / 0.102 | 3.00 | 100 % |
| 28 to 34 | 0.147 / 0.169 | 0.098 / 0.138 | 3.00 | 100 % |

Histogram of the substeps over the 34 s: 2 substeps in 375, 411 and 487 frames of 1 200 and 3 in 825, 789 and 713 (35 % and 65 % of the 3 600 frames). What the criterion saw (seed 20240611, adaptive): at 2.8 s the speed
bound is 428 px/s and the acceleration bound 1 044 px/s^2 (dt_crit 12.6 ms: 3 substeps), at 5.7 s 213 px/s and 450 px/s^2 (19.9 ms: 2), at 11.3 s 288 and 670 (16.2 ms: 3 held, 2 would need 14.2 <= 0.85 x 16.2),
at 17 s 258 and 745 (15.3 ms), at 22.7 s 269 and 962 (13.3 ms), at 28.3 s 276 and 1 535 (10.7 ms), at 33.7 s 375 and 2 120 (8.9 ms: 3 substeps of 9.4 ms).

**Convergence against the reference at 1/8 of the substep** (first 8 s of the three seeds; the readings dated at the start of the frame's last substep and the run resampled at the
reference's times). Root mean square of ln(rho_run / rho_ref) of the densest cell, in windows of frames (28.3 ms each), and the first burst of the fusion rate (peak of the three-frame mean, and
the time at which it first reaches half of it), as the run's difference with the reference's. The runs are chaotic from the burst on (the random draws of the fusions follow the substep
counter): after frame 140 even 1/4 of the substep differs from 1/8 by 0.03 to 0.13, so the last window shows the spread of a history, not an error.

| seed | | frames 0-40 | 40-70 | 70-100 | 100-140 | 140-330 | burst height | burst timing |
|---|---|---|---|---|---|---|---|---|
| 20240611 | fixed | 0.0018 | 0.0121 | 0.0256 | 0.0449 | 0.109 | +12.8 % | +11.1 ms |
| | adaptive | 0.0018 | 0.0121 | 0.0263 | 0.0345 | 0.134 | +10.9 % | +12.8 ms |
| | 1/4 of the substep | 0.0005 | 0.0018 | 0.0058 | 0.0176 | 0.129 | +2.5 % | +2.2 ms |
| 20240612 | fixed | 0.0019 | 0.0111 | 0.0288 | 0.0559 | 0.159 | +12.2 % | +8.9 ms |
| | adaptive | 0.0019 | 0.0111 | 0.0285 | 0.0348 | 0.089 | +9.5 % | +9.8 ms |
| | 1/4 of the substep | 0.0004 | 0.0019 | 0.0057 | 0.0274 | 0.101 | +4.2 % | +2.9 ms |
| 20240613 | fixed | 0.0020 | 0.0116 | 0.0229 | 0.0438 | 0.083 | +11.2 % | +9.7 ms |
| | adaptive | 0.0020 | 0.0116 | 0.0233 | 0.0324 | 0.065 | +8.6 % | +10.8 ms |
| | 1/4 of the substep | 0.0006 | 0.0020 | 0.0052 | 0.0231 | 0.031 | +2.6 % | +2.6 ms |

The adaptive step is the fixed one until the burst (the count is 2), then closer to the reference by 23 to 38 % in the window of the burst and by 22 to 44 % after it in two seeds of three (seed 20240611's
last window is 0.134 against 0.109: the histories have separated); the burst's timing is 0.9 to 1.7 ms later than the fixed step's. The tuning runs before A2 (two seeds, the same table) had the burst's height at +18, +20 % at the fixed step and +11,
+13 % adaptive, and 1/4 of the substep at +3 %.

The error of the first fall is what the fixed step leaves: it falls by 4 to 6 when the substep is divided by 4 (a first-order law would give 7, a second-order one 21), and the same run with
the cooling off (`stepOverrides={"cooling":0}`, one seed, before A2) leaves it as it was (0.0012 against 0.0004 and 0.0017 against 0.0005 in the first two windows, a factor of 3): the cooling's splitting is not the cause,
and neither is the integrator (the Kepler twin above; the Maclaurin disc, whose free-fall time estimated at 0.75, 0.5, 0.25 and 0.1 of the radius is 1.0125, 1.0169, 1.0233 and 1.0251 of the analytic one
at 1 substep of 14.2 ms, 1.0125, 1.0169, 1.0233 and 1.0250 at the adaptive step (2.36 substeps a frame) and the same to 1e-4 at 1/4 and 1/8 of it: the 1.2 to 2.5 % are the grid's smoothing). Not isolated: it
would need the grid force, which is not smooth across the near zone's edge, or the temperature's average.

**Energy drift** (`baseline.protostar.energy-drift`, 100 000 particles, elastic walls, cooling, feedback and fusion off, one reduction every 10 frames; the GPU shared and the run held to its wall-clock budget
of 600 s for the default cloud, hence 86 to 99 orbits and `skip` with the target met; before A2, which does not enter a run with the fusion off):

| run | orbits | K + U after 1, 3, 10, 30 orbits (%) | at the end (%) | largest (%) | slope after settling (% per orbit) | substeps / frame |
|---|---|---|---|---|---|---|
| fixed count | 95.3 | -0.170, -0.171, -0.165, -0.170 | -0.17 | 0.80 | -0.00007 | 2 |
| adaptive, as shipped | 96.4 | -0.245, -0.240, -0.231, -0.244 | -0.24 | 0.80 | -0.00012 | 2.0002 |
| adaptive, count free down to 1 (an earlier version) | 98.6 | -0.235, -0.229, -0.223, -0.233 | -0.22 | 0.79 | -0.00003 | 1.9985 |
| the count changing every frame, 1 to 4 | 85.6 | -0.158, -0.151, -0.148, -0.159 | -0.13 | 0.91 | +0.00019 | 2.25 |

The cold cloud on circular orbits, 17 to 21 orbits: +0.09 % (0.52 %) fixed, +0.09 % (0.52 %) adaptive as shipped, +0.09 % (0.58 %) with the count changing every frame. The conservative cloud almost never asks for a third substep (its core
is less dense than the burning one's), so the run with the flag on is the fixed step but for 0.02 % of the frames: the run with a count that changes every frame is the one that tests the integration; the plan's
criterion, 1 % over the run, is met by all (the largest figure is the first collapse's). The drift with the walls of the application is 13.4 to 14.0 % in 15 to 17 orbits in all of them (the walls', not the scheme's).

**Cost** (`cost.protostar.adaptive-step`, the application's loop for the default cloud's 1 200 frames, 5 alternated pairs per size, the adaptive runs with the flag on and the substeps of the
paced run replayed: seed 20240611 after A2, `2x90,3x19,2x285,3x806`, 2.69 on average; the first version of the scenario let the adaptive step decide in an unpaced loop, where the asynchronous reads land
late, and its count was 2.08 to 2.17 on average).

| | fixed | adaptive (replay) | paired ratio | substeps per simulated second |
|---|---|---|---|---|
| 400 000 particles, ms / frame | 18.0 (17.7 to 18.3) | 23.4 (22.2 to 23.5) | **1.30** (1.25 to 1.31) | 70.6 and 94.9 |
| 1 000 000 particles, ms / frame | 34.1 (34.1 to 34.8) | 44.1 (44.1 to 44.1) | **1.29** (1.27 to 1.29) | 70.6 and 94.9 |
| the same with the schedule before A2 (2.41), 400 000 / 1 000 000 | 18.0 / 34.3 | 21.5 / 41.8 | 1.19 (1.18 to 1.25) / 1.22 | 70.6 and 85.2 |

By phase (frames 0-300, 300-600, 600-1200), 400 000 particles: 20.5, 20.1 and 15.2 ms fixed against 21.6, 27.5 and 22.1 adaptive. A substep costs the same in the two modes (9.0 and 8.7 ms at 400 000
particles, 17.1 and 16.4 at 1 000 000, a frame's per-frame work included), and the reads of the reduction every third frame are in the figures: the adaptive step costs what its substeps cost. (The ms per
frame are those of the whole run, with its position read-backs, the dense late core, and a GPU at low clocks; the 7.3 ms of `perf.protostar.400k` is the first 1.5 s.)

**The benchmark** runs the protostar at its default parameters and speed through `Simulation.borrowAlgorithm()`, which resets the parameters to their defaults; it now passes
`BENCHMARK_PARAMS` (the flag off), so that it measures the fixed count whatever the default of the flag is: the first frames of a restart are the calm ones, where the adaptive count is the fixed one anyway
but the count is not what the cloud will ask for later (3 substeps against the 2 measured, up to 1.5 times the work), the reads land when the frames let them (a count that depends on the timing is not
a deterministic load), and the fixed count is what the adaptive count is bounded by a ratio of. The cap the benchmark finds is therefore the one of today; with the flag on the dense phases of a run
cost up to 1.5 times as much per frame, and a GPU that just keeps 60 FPS at the benchmark's count will not in them.

**The flag off is the frame it was.** `protostar.energy-reference` (a 5 000-particle cloud, 6 and 110 frames: K, U against the pair sum and the twin, the stash of the potential) and `protostar.reduction-channels` (every channel of the
reduction against the CPU) give the same metrics and the same details, to the last printed digit, on `0e4fc9c` (the head of the improvements branch, A2 included) and on this branch with the flag at its default, and
on `9215ab1` against the branch before the rebase (they run without reading anything back, so they are deterministic; a run that reads the positions back, such as `baseline.protostar.default-cloud`, is
not reproducible from one run to the next, with the landing frame of the read-back).

## What the next phases need to know

- **B3 (one pass per particle).** The single pass must keep the `dtPrev` uniform (the half kicks over the previous substep's length, the drift over the current one) and the stored layout
  (`x(n+1)`, `v(n)`, `a(n)`, `z = 1` on the first substep); `leapfrog.ts` and `protostar.integration` (which now steps with a changing time step) follow them. The model decides the count
  of a frame between frames, so nothing changes inside one. `beforeSubstep(0)` (the lab's way of drawing the grids) must keep leaving `dtPrev` alone. The energy run with a count changing every frame
  (`energyStep=varying`) is the check that a rewrite of the passes kept the second order with a changing step.
- **A6 and A13 (new physics on the velocity block) and anything that adds a force.** A force enters through `forceAt()` at `x(n)` only (P5a). Whatever acts on the velocity between the half kicks
  (cooling, heating, a collision step) is operator splitting with the *current* `dt`, first order in `dt`, and its rate must be in seconds, not per step (the average of the temperature is: `1 - exp(-dt / tau)`):
  the count of substeps can change during a run, so a per-step constant would change with it. The grids' velocity lags the positions by a substep (the deposit at `x(n)` reads `v(n-1)`): a
  process computed from the mean velocity or the dispersion of the grid sees a state `dt` old. The criterion knows only the gravity and the speed: a new stiff term (a collision rate, a
  stiffer pressure) must add its own term to `criticalStep()` (the fusion rate is already capped at 1 / dt) or it is integrated at whatever the cloud's omega asks.
- **The maxima are proxies** (`reduction.ts`): the speed bound is the largest |mean velocity| + sqrt(t) of a cell, the acceleration bound the largest pull of the gravity grid with the drawings' force
  left out; the criterion uses `max(eps, cell)` for the softening. A reduction that changes (C2's nested grid, A11's adaptive thickness) changes what dt_crit means.
- **The convergence of the whole model is not second order** (the early fall of the default cloud: the error falls by 4 to 6 when the step is divided by 4). The adaptive step shrinks the
  error where the core needs it, not the cause; a phase that recalibrates the defaults should compare its runs at one count of substeps, and judge the burst's height with the 9 to 11 % this
  leaves at the adaptive step (11 to 13 % at the fixed one) in mind.
- **A recalibration moves the count.** The adaptive count of the default cloud is at the edge of the threshold between 2 and 3 substeps (dt_crit 15 to 17 ms against 14.2 ms) after A2: a change of G, of the
  softening or of the core's density changes the cost of the flag by a quarter or more. Lower `PROTOSTAR_STEP_OMEGA`'s sensitivity by re-tuning it, or `PROTOSTAR_STEP_RELEASE` towards 1, if the flag is to be on by default.
- **Defaults and the lab.** The flag is off, so every lab scenario keeps its baseline; the ones that call `endFrame()` and run the adaptive step do so only when a scenario sets the flag
  (`restart()` gives it its default back). A run is not reproducible bit for bit from one lab run to the next when it reads back (the landing frame of the asynchronous reads), nor with the adaptive step on.

## Reproduction

```
npx vite --port 5215
node scripts/run-lab.mjs --url http://localhost:5215/particle-simulator/lab.html --query "scenarios=protostar.integration"
node scripts/run-lab.mjs --url http://localhost:5215/particle-simulator/lab.html --query "scenarios=baseline.protostar.adaptive-step&stepSeeds=3&stepDump=1" --out cloud.json      # 8.5 minutes
node scripts/run-lab.mjs --url http://localhost:5215/particle-simulator/lab.html --query "scenarios=protostar.adaptive-maclaurin"                                                  # 1 minute
node scripts/run-lab.mjs --url http://localhost:5215/particle-simulator/lab.html --query "scenarios=cost.protostar.adaptive-step&costSchedule=2x90,3x19,2x285,3x806"             # 11 minutes
node scripts/run-lab.mjs --url http://localhost:5215/particle-simulator/lab.html --query "scenarios=baseline.protostar.energy-drift&energyStep=varying"                          # 14 minutes
npx vitest run tests/timeStep.test.ts tests/leapfrog.test.ts tests/labStep.test.ts
```

`energyStep` is `fixed`, `adaptive` or `varying`. The tuning of the constants: `stepVariants=[{"omega":0.1,"courant":1,"minRatio":0.5,"ratio":8},{"omega":0.12,"courant":1,"minRatio":0.5,"ratio":1.5,"readInterval":3},...]` (URL-encoded);
the cooling-off run `stepOverrides={"cooling":0}`. Every figure of the tables above can be recomputed from `stepDump=1` (every frame of every run: the substeps, what the criterion saw, the core).

Same machine, same session as the other phases (see [lab-baseline.md](../lab-baseline.md)). The runs of the tuning table and of the cooling-off check, and the energy-drift runs, are of the code before the
rebase on A2 (`9215ab1` plus this phase); the others of the rebased code. The flag-off comparisons serve `0e4fc9c` and `9215ab1` from other directories.
