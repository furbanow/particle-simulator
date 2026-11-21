# Spike P5a: the order of the protostar's integration

Phase P5a of the improvement plan. Phase P1a measured that the total energy K + U of a conservative run (cooling,
feedback and fusion off, elastic walls) of the default cloud drifts by -0.05, +0.21, +1.3, +5.5 and +39.5 % after 1, 3,
10, 30 and 100 orbits, at a rate proportional to the time step (0.162, 0.077, 0.036 % per orbit at dt, dt/2, dt/4): the
behaviour of a first-order, non-symplectic scheme, where the plan assumed a second-order velocity Verlet. The suspect
was the order of the GPU passes: the velocity, position and acceleration textures are all computed from the old
textures of the previous substep, which looks like an explicit Euler step with a lagged acceleration. This document
records what the scheme really is, where the first-order drift came from, what was changed and what it did.

## Verdict

- **The order of the passes was not the cause, and it is not changed.** Written out, the three passes compute exactly
  velocity Verlet on lagged storage (below): the positions obey `x(n+1) = 2 x(n) - x(n-1) + a(n) dt^2`, the sequence of
  the kick-drift-kick leapfrog, with one force evaluation and one grid rebuild per substep. A Kepler orbit run with a
  CPU twin of the passes (`src/simulation/protostar/leapfrog.ts`, tested) shows the second order: the energy error falls
  by 4 when the step is halved and does not drift over 100 periods. No reordering of passes, extra force
  evaluation or extra grid pass was needed.
- **The first-order drift was the walls.** A particle that leaves the area was bounced by reversing the velocity `v(n)`
  alone and clamping the position on the wall. In velocity Verlet the stored velocity carries the first half kick of
  the next step, so reversing it alone leaves every bounce with an extra inward speed `a dt`, and the clamp leaves the
  particle on the wall instead of bringing it back inside: about `1.5 u a dt` of energy gained per bounce (`u` the normal
  speed, `a` the pull towards the inside), always positive, first order in `dt`. With elastic walls the particles that
  the first collapse throws out bounce back and forth for as long as the run lasts, so the gain accumulates in
  proportion to the time, and it grows with the number of bounces. (The application's walls return half of the
  speed and lose far more than that, which is why nobody saw it there.)
- **The fix is in the velocity and position passes only**: a bounce is treated as an event of the step (the position is
  mirrored, the velocity stored is the one that makes the next kicks give the right speed after the bounce at the
  instant the wall is reached), and the first substep of a run owes no half kick. No other pass, no parameter, no
  statistic changes.
- **Result**: the conservative run of the default cloud (100 000 particles, elastic walls) keeps K + U within **0.71 %** over **100 orbits**
  (largest excursion in the first collapse; -0.136, -0.140, -0.145, -0.146 and -0.133 % after 1, 3, 10, 30 and 100 orbits, slope 7e-5 %
  per orbit), where the same code before drifted by +1.00, +4.17 % after 10 and 30 orbits and +16.5 % after 76 (P1a, with the previous
  defaults: +39.5 % after 100). The rate no longer depends on the time step (slope -0.0008, -0.0008, +0.00007 % per orbit at dt, dt/2, dt/4,
  against 0.127, 0.061, 0.029 before), so the scenario `baseline.protostar.energy-drift` is a `pass` and the plan's criterion is met. A
  floor remains: -0.14 % set by the first collapse, and a slope of 0.0027 % per orbit on the cold cloud of circular orbits (0.3 % over 100
  orbits), both independent of the step; the grid force, whose interpolation is not exactly the gradient of the potential U is
  computed from, is the suspect and was not isolated. The passes are checked against a CPU twin to 1e-4 px (`protostar.integration`).
  It changes the default cloud's first collapse (the burst of the fusion rate at 2.8 s is 20 % lower in three seeds out of three, see below)
  and nothing else that can be told from the seed-to-seed spread. No measurable cost

## What the scheme was, and is

`GPUComputationRenderer.compute()` renders the velocity, position and `textureAccel` variables one after the other,
each reading the textures of the current ping-pong index, and swaps at the end: none reads what another writes in the
same substep. The grids of the substep (deposit, gas, gravity) are drawn before it from the positions of the start
of the substep. Call `x(n)` the positions the substep starts from. The textures hold `x(n)`, `v(n-1)` (the velocity
lags the position by one substep) and `a(n-1)`. With `a(n) = a(x(n))`, interpolated from the grids just drawn (the
acceleration pass does the same, hence it stores `a(n)`), the passes compute:

| Pass | Reads | Writes |
|---|---|---|
| velocity | `x(n)`, `v(n-1)`, `a(n-1)`, grids | `v(n) = v(n-1) + (a(n-1) + a(n)) dt / 2`, then cooling, heating, speed limit, walls |
| position | the same | `x(n+1) = x(n) + v(n) dt + a(n) dt^2 / 2` (it recomputes `v(n)`), fusions |
| acceleration | the same | `a(n)` |

That is the velocity Verlet scheme: `v(n) = v(n-1) + (a(n-1) + a(n)) dt / 2` is the second half kick of the last step
and the first one of this step, `x(n+1)` the drift from `v(n) + a(n) dt / 2`. Substituting `x(n) - x(n-1)` into
`x(n+1) - x(n)` gives `x(n+1) = 2 x(n) - x(n-1) + a(n) dt^2`. It is second order and symplectic for a force that
depends on the positions alone, and it needs no force evaluation at the new position: `a(n+1)` is evaluated when the
next substep starts, from the grids it draws then. The hypothesis of an Euler-like step with a lagged acceleration
does not hold, because the velocity update uses the average of the two accelerations and the position update the
velocity of the same substep.

## What was wrong, and what changed

### The bounce, before

A particle whose step `x(n) -> x(n+1)` ended outside the area had, in the velocity pass, the velocity `v(n)` that
it was about to store reversed (times the restitution) and, in the position pass, its new position clamped to the wall.
Take one axis, `u` the speed away from the wall at `x(n)`, `g` the pull towards the inside, restitution 1:

- the velocity stored is `-u`; the next substep adds its two half kicks, `(a(n) + a(n+1)) dt / 2 = -g dt`, so the particle
  leaves the wall at `u + g dt` instead of the `u` it came with: **`u g dt` of kinetic energy gained** (plus `g^2 dt^2 / 2`).
  In velocity Verlet the stored velocity is not the velocity at the end of the step but the one that still owes the
  first half kick of the next step, and that half kick must be taken before the reflection, not after;
- the position stays on the wall instead of coming back by the overshoot `(x(n+1) - wall)`, which is `u dt / 2` on
  average: the particle sits higher in the potential by **`g u dt / 2`**.

Together about `1.5 u g dt` per bounce, always positive, proportional to `dt`, and the number of bounces per orbit does not
depend on `dt`: which is the "rate proportional to the time step" of P1a. The fraction of the particles that sit on a
wall at a given time is tiny (0.04 % at 12 orbits), which is why the walls were not the first suspect, but the
particles the first collapse throws out with the largest speeds bounce back and forth for as long as the walls are
elastic, and each bounce adds.

The first substep had a smaller flaw of the same family. The initial state holds the velocities at the initial positions and
an estimate of the acceleration there (from the enclosed mass); the first substep then computed `v + (a + a) dt / 2` and
moved the particle with it, as if the initial velocity were the one of a step before: a full kick `a dt` too many for every
particle, inward. It is a one-off error of the start, not a drift.

### The scheme, now

- **Walls.** If `x(n+1)` is outside the area, the position pass stores its mirror image about the wall (held inside if the
  particle went further than the area). The velocity pass computes the share `s` of the step at which the particle reaches
  the wall (`s = (wall - x(n)) / (x(n+1) - x(n))`, the drift being taken as uniform) and stores
  `-e (v(n) + a(n) s dt) - a(n) s dt`, `e` being the restitution: the particle reaches the wall with `v(n) + a(n) s dt`, leaves
  it with `e` times that reversed, and is pulled by the same acceleration for the rest of the step, which the next substep's
  two half kicks supply. Reversing the half-step velocity (`s = 1/2`) would leave a first-order error of either sign,
  that averages out between particles but not on one; the instant of the bounce makes it second order (the harmonic
  well of `tests/leapfrog.test.ts`: the energy error falls by 4 each time the step is halved). The passes agree on which
  particles bounce because they compute `x(n+1)` with the same expression.
- **First substep.** The acceleration texture starts with `z = 1` for every particle, and the passes multiply the half
  kicks by `1 - z`: nothing is owed at the first substep, where the velocity stored is the one at `x(0)`. The acceleration pass
  writes `z = 0` from then on. `fillCloud` no longer computes an initial acceleration, and the test of that estimate is gone.
- Nothing else changed: the order of the passes, the grids, cooling, heating, fusion, the drift correction and the
  statistics are what they were.

## Numbers

All on the GTX 1060 (renderer below), 100 000 particles, elastic walls, seed 20240611, 1024 x 768 px area; orbit 13.08 s, time step
14.17 ms (speed 1.7), the head of the improvements branch at the time (`4dae91f`, phase P3b-1's G = 9) "before", the same plus this phase
"after". The tables, with the circular cloud and the application's walls, are in [lab-baseline.md](../lab-baseline.md#after-phase-p5a-the-order-of-the-integration).

**Energy of the conservative run** (`baseline.protostar.energy-drift`, 224 s of wall time for 100 orbits):

| Drift of K + U (%) after | 1 orbit | 3 | 10 | 30 | 100 |
|---|---|---|---|---|---|
| before (P1a, G = 13.85) | -0.05 | +0.21 | +1.31 | +5.50 | +39.5 |
| before (`4dae91f`) | -0.07 | +0.14 | +1.00 | +4.17 | +16.5 after 76 orbits |
| after | -0.136 | -0.140 | -0.145 | -0.146 | -0.133 |

**Scaling with the time step** (`baseline.protostar.energy-drift-attribution`, 12 orbits, slope after settling in % per orbit):

| | dt = 14.17 ms | dt/2 | dt/4 |
|---|---|---|---|
| before (`4dae91f`) | 0.127 | 0.061 | 0.029 |
| the position mirrored, `v(n)` still reversed alone (a variant, on `36ea02b`: 0.162, 0.077, 0.036 before) | 0.105 | 0.051 | 0.023 |
| after | -0.0008 | -0.0008 | +0.00007 |
| drift after 12 orbits | -0.144 | -0.140 | -0.137 (5.4 orbits) |

Before the change the slope halved with the step, the signature of a first-order error; mirroring the position alone explained a third of it
(0.162 to 0.105), the velocity reversed alone the rest. After it the slope is zero within 1e-3 % per orbit at every step.
Other checks of the diagnosis: putting half of the old first-step kick back on the new scheme changes nothing (-0.141 and -0.139 % after 12 orbits at dt and
dt/2); the particle-mesh force without walls on the CPU (a one-off script, 20 000 particles, 64 x 64 grid) gives the same energy series at dt, dt/2 and dt/4
(3.03, 3.03, 3.04 % after one orbit): the scheme has no dependence on the step of its own; with the application's walls (restitution 0.5) K + U
falls by 5.2, 8.6, 12.8 and 17.3 % after 1, 3, 10 and 30 orbits, as before (5.1, 8.6, 13.0 %): the walls' physics, not the scheme's.

**Order, on the CPU** (`tests/leapfrog.test.ts`): Kepler orbit, energy error 1.13e-2, 2.87e-3 and 7.2e-4 at 100, 200 and 400 steps per
period (a factor 4 each time: second order), no drift over 100 periods; a harmonic well with a bouncing particle: the same factor 4.
**On the GPU** (`protostar.integration`): 4 steps of 20 000 particles with 591 bounces, worst error against the twin 1.2e-4 px and 9.1e-5 px/s,
no particle beyond 5e-4.

**The default cloud** (400 000 particles, 1 200 frames, seeds 20240611 to 20240613 and, for the statistics, to 20240618; "before" reproduces the P3b-1 table
to the digit, so the comparison is exact):

| 34 s, three seeds | before (`4dae91f`) | after |
|---|---|---|
| core T while H burns, median (MK) | 14.0, 14.9, 15.9 | 14.2, 14.7, 15.5 |
| highest core T (MK) | 247, 269, 170 | 162, 214, 115 |
| hydrogen left of 400 000 | 3 257, 60, 430 | 219, 51, 459 |
| helium / carbon at the end | 25 997 / 24 499, 2 510 / 32 664, 26 812 / 24 165 | 61 723 / 12 750, 1 505 / 32 558, 67 684 / 10 737 |
| peak fusions per second (at 2.83 s) | 637 000, 615 000, 683 000 | 509 000, 481 000, 550 000 |

The first collapse follows the old one (peak density 8.4 against 8.2 rho0 at 2.0 s, 26.4 against 25.7 at 2.55 s, within a few percent) and its burst of
the fusion rate at 2.8 s is 20 % lower in the three seeds. With the new first substep and the old walls (an ablation, not kept: the shaders of this
phase with the old bounce) the burst is the same to the digit (509 200, 481 460, 549 920 per second): it is the first substep that changed it,
the spare kick `a dt` that every particle got inward (0.7 % of its orbital speed) made the old collapse a little harder. Afterwards the history is
chaotic: eight seeds each give the same hydrogen plateau (14.4 against 13.9 MK, spread 1.1 and 1.2), the same time of the exhaustion of hydrogen
(22.1 and 21.8 s, medians) and of the carbon above 10 000 (26.4 and 26.7 s), carbon at 34 s of 27 300 and 26 200 on average. The helium flash's peak core T is
lower (250 MK, spread 60, against 183, spread 34: seven seeds out of eight), a reading of a short extreme; nothing runs away (33 600 carbons at most, last-quarter core T 54 to
209 MK).

**Cost** (`perf.protostar.400k` and `.1m`, 6 alternated pairs of fresh pages, the GPU at low clocks: read the ratios): 7.28 (6.82 to 7.40) against 7.11 (6.86 to 7.42)
ms/frame at 400 000 particles, paired ratio 0.98; 13.99 (13.08 to 14.21) against 14.36 (13.97 to 15.45) at 1 000 000, ratio 1.02: not measurable.

**Not P5a's**: `protostar.reduction-channels` fails by 4.9e-2 on the peak temperature against the twin of the grids on `4dae91f` already (3.9e-2 after): the lab's twin reads the
velocity dispersion where the reduction has read the temperature since phase P3b-1 (the factor mu / mu_H).

## What the next phases need to know

- **B5 (adaptive time step).** The time step can change between frames. The velocity pass takes both half kicks with the
  current `dt`: `v(n) = v(n-1) + (a(n-1) + a(n)) dt / 2`. With a time step that changes this must be the *previous* step's `dt` (both
  half kicks belong to the step that ended at `x(n)`), while the drift `x(n) + v(n) dt + a(n) dt^2 / 2` takes the current one. That
  needs one more uniform (`dtPrev`, shared by the velocity and position passes, kept by the model in `beforeSubstep()`, which must
  ignore the calls with `dt = 0` of the lab) and no more texture; the stored velocity after a bounce is then exact whatever the next
  `dt`. The speed slider already changes `dt` between frames, and the error it makes then is `a (dt - dt') / 2` once per change.
  The reduction of P1a gives the maxima for the criterion (`maxSpeed`, `maxAcceleration`); with the walls fixed the energy no longer
  depends on `dt` at the default one, so the criterion is the accuracy of the core (`omega dt`, 0.1 to 0.2 in the default cloud
  after the first collapse), not the energy of the whole cloud.
- **B3 (one pass per particle).** The three passes compute the same `a(n) = forceAt(x(n))` (three evaluations of the four-texel
  interpolation and the drawings' pull) and the same `next`; a single pass writes `x(n+1)`, `v(n)` and `a(n)` from one `a` and one `next`,
  and the agreement on which particles bounce is then automatic. It must keep the layout of the stored state (`x(n+1)`, `v(n)`, `a(n)`,
  and `z = 1` on the first substep) or `leapfrog.ts` and `protostar.integration` follow it: the scenario reads the acceleration texture
  as the force of the step.
- **Anything that adds a force** (A11, C1, C2...) enters through `forceAt()` at `x(n)` and nowhere else: a force that depends on the
  velocity, or an impulse applied between the half kicks, would break the second order (the reflection of the velocity at the walls is
  the one allowed exception, handled above). Cooling and heating are operator splitting after the half kick, first order in `dt` by
  construction and consistent in the rate (`exp(-k dt)`), as before.

## Reproduction

```
npx vite --port 5210
node scripts/run-lab.mjs --url http://localhost:5210/particle-simulator/lab.html --query "scenarios=protostar.integration"
node scripts/run-lab.mjs --url http://localhost:5210/particle-simulator/lab.html --query "scenarios=baseline.protostar.energy-drift-attribution"   # 12 orbits at dt, dt/2, dt/4: 7 minutes
node scripts/run-lab.mjs --url http://localhost:5210/particle-simulator/lab.html --query "scenarios=baseline.protostar.energy-drift"             # 100 orbits: 7.5 minutes
npx vitest run tests/leapfrog.test.ts
```

GTX 1060 (`ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)`), HeadlessChrome with the ANGLE
OpenGL backend, `EXT_float_blend` available, area 1024 x 768 px, seed 20240611, 100 000 particles for the energy runs. The
runs of the code before are those of commit `4dae91f` (the P1a figures and the intermediate variant of the attribution are those of `36ea02b`),
served from another directory in the same session; the new ones are the commits of this phase. The 100-orbit run takes 4 minutes of GPU for the default
cloud and 7 minutes for the whole scenario.
