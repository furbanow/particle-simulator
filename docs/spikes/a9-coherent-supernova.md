# Spike A9: a coherent supernova

Phase P6b of the improvement plan. Proposal A9 asks the sticky dust's supernova to obey the same laws as the rest of the simulation:
gravity keeps acting on the ejecta (equivalence principle), the shock front slows down as `dR/dt ~ 1/R` (`R ~ t^(1/2)`, Sedov-Taylor
in two dimensions), the ejection is homologous (`v ~ r`) and stratified (heavy elements slower), and the trigger counts mass instead of
particles. This document records what was built, how exact it is, what it cost, and how the default cloud's supernova history changed
and was retuned.

## Verdict

- **The front follows `R^2 = R0^2 + 2 K t`.** On a cold uniform cloud (`dust.supernova.blast`, 300 000 particles, nothing else acting) the
  radius of the front, read from the particles it kicked, fits `R^2` linear in `t` with R^2 = 1.000, a slope of **0.9995 of `2 K`** and an
  intercept of 1.012 `R0^2`; the free fit of `R^q = a + b t` finds **q = 2.00 (exponent of time 0.500)**; the residual is 0.19 px against
  32.8 px for the constant-speed front it replaces. The observed front stays within 1.3 px of the radius the CPU hands the shader.
- **The ejection is homologous and stratified.** Ejecta speed against distance to the centre, species by species: slope 25.57, 12.83 and
  9.744 per second for hydrogen, helium and lithium, exactly the formula (ratio 1.000), R^2 = 1.000, intercept 3e-6 px/s; the slopes
  fall with the species' mass (1.99 : 1 : 0.76, `sqrt(mean mass / mass)`). The kicks the front gives (13 054 particles at 0.3 s) equal
  the formula to the float (median, minimum and maximum of the ratio 1.000). Net momentum of the ejecta: 0.12 % of the sum of their
  momenta.
- **Gravity acts on the ejecta from the first instant.** With and without gravity from the moment of ejection (same cloud, same
  ejection), the mean radial speed of the ejecta is 3.1 % lower with gravity 0.2 s after the blast (inside the 0.6 s ejection timer, which
  used to switch gravity off) at the default power, and at the lowest power the ejecta stop and **fall back to 0.11 zone radii** (the arm
  without gravity ends at 4.5). The deceleration of the three species in the same radial bin differs by a factor 1.03 to 1.38 (they are not at
  the same place any more after a fraction of a second: the pull varies over those few pixels), which is what an acceleration independent of the
  mass gives.
- **The trigger counts mass.** `analyzeConcentration` weighs each particle by its species' atomic mass; the concentration meter and the
  slider are shares of the total mass. No GM/R criterion (see below).
- **The default cloud's history**: the first supernova is still at 3.03 s (the whole cloud, 97.6 % of the mass, is inside one 65 px disk
  by then); over 30 s the build before had 4 to 5 supernovae (gaps 3 to 9.5 s), this one has 4 (gaps 6 to 10.5 s). To get there
  `SUPERNOVA_SPEED` went from 420 to 840 px/s and `SUPERNOVA_COOLDOWN` from 120 to 240 frames: with gravity acting on them the ejecta
  of the old constants fell back at once (see "Retuning").
- **Cost** (sim-only ms per frame, 6 alternating pairs): **+2 to +3 % in every window** (400 000 and 1 000 000 particles, before the collapse
  and after the first supernova), within the 5 % run-to-run noise.

## What was built

| | |
|---|---|
| `src/simulation/shockWave.ts` | `frontConstant`, `advanceFront`, `frontRadiusAt`, `frontSpeed`: the law `R dR/dt = K`, `K = speed x R0`, exact for any step (R^2 grows by `2 K dt`); the class uses them (the speed slider is read live, the stop conditions are unchanged). |
| `src/simulation/stickyDust/ejecta.ts` | The twin of the ejection formulas in the shader: `ejectScale` (`sqrt(mean mass / mass)`, bounded), `ejectaRadius` (rms size of the cluster, floored), `ejectionSpeed` (homologous, bounded by `MAX_SPEED`), `shockKick`. |
| `src/shaders/velocity-sticky-dust.frag` | `bound` is split: gravity and the drawings' pull always act, `contact` (the ejection timer) multiplies the pressure and the sticking only. The ejection block is `v = rms speed x species factor x r / ejectaRadius`. |
| `src/simulation/concentration.ts` | Mass-weighted disk search (coarse grid of masses, centre of mass), the share of the total mass, and the rms radius (`spread`) of the members. |
| `src/simulation/stickyDust/gpuModel.ts` | The species' masses for the weights, the `ejectaRadius` uniform set when a supernova is armed. |
| `src/config.ts` | `EJECTA_RADIUS_FLOOR` (0.1 of the detection radius), `SUPERNOVA_SPEED` 840, `SUPERNOVA_COOLDOWN` 240; comments of the others. |
| `src/i18n/locales/*` | The threshold, radius and power docs and the meter's title, in the five catalogs. No parameter was added. |
| Lab | `dust.supernova.blast`, `.infall`, `.history`, `.sweep`; `src/lab/blastFit.ts` (fits, tested). |

## The design

**The trigger.** The CPU already reads the positions back every 12 frames (`ClusterProbe`); the texel's z holds the species, so the weights
cost nothing. The grid's mass could not be used (it saturates at about 128 a texel, A10), nor its alpha channel (energy, not a count). The
fraction is the mass inside the disk over the total mass. With the default elements (hydrogen, helium, lithium: 1.008, 4.003, 6.94 u) the
heavy ones count seven times a hydrogen atom, and as they sink to the core of the clumps the mass share of a clump is higher than its
particle share (second event of the default run: 62 % of the particles, 77 % of the mass).

*Compactness `GM/R` was not implemented.* `R` is the detection radius, fixed by a slider, so `GM/R` is the mass in the disk times a
constant, that is the mass criterion with a threshold in arbitrary units; and `G` is the gravity slider, so a threshold on it would make
the supernovae vanish at a low `G`, a coupling nobody asked for. A criterion that mattered (binding energy against the ejecta's energy,
or a radius that is not fixed) would need a measured cluster size, which the rms radius now gives: it is there if a later phase wants it.

**Gravity for the ejecta.** `bound` multiplied gravity, the drawings' pull, the pressure and the viscosity together, for 0.6 s after an ejection
or a kick. Now `contact = 1 - clamp(eject / EJECT_TIME)` multiplies the pressure (threshold and kinetic) and the sticking (Haff) only. The
drawings stay on the always-on side: attractors and repellers are accelerations, like gravity, and a particle in flight is pulled by an
attractor as ever. The pressure stays gated because it is a contact force of the clump the ejecta come out of (at the instant of the blast
the density gradient is the pre-blast clump's, an unphysical double push), and the sticking because A10 left slow ejecta (heavy species at
the lowest factor, 90 px/s) free to stick to the flow they leave; the barrier of the collision speed alone does not keep them apart. A particle the shock wave kicked gets the same
treatment for `ejectTime x min(kick/ejection speed, 1)`.

**The ejection.** Inside the detection disk the speed is `v = v0 f(m) r / R`, radial (with the 0.125 rad angular jitter of before; the
speed jitter of 0.8 to 1.2 is gone: a homologous flow has none), `f(m) = sqrt(mean mass / mass)` bounded to [0.3, 3] (the old
`speciesEjectScale`: the same kinetic energy for every species, so heavy elements are slower), and `R` the **rms distance of the
ejected mass to the centre of mass**, at least a tenth of the detection radius. That choice is a deviation from the plan's wording
(`r / R_cluster`) and is explained in the next section: with `R` the fixed detection radius, the explosion's energy per unit of mass
falls as the square of the clump's size, and the default cloud, whose clumps are 28 px (rms) wide in a 65 px disk, would not
disperse at any sensible speed. With the rms radius `<v^2> = v0^2 f^2` whatever the size (0.92 of the old flat ejection's energy in the
lab disc, the difference being the 3 px guard band left out of the sums), and the slider keeps the meaning it had: the speed of the
ejecta. The speed is bounded by `MAX_SPEED` as every speed is (4777 of the 136 672 ejecta of the lab disc, the light species at its
edge, hit the bound). The `shockStrength x shockRef / r` of the kick is unchanged, but it now reads as the strength times the front's own speed,
`K / R`, since the front slows down as `1/R`.

**The front.** `R^2 = R0^2 + 2 K t` with `K = v0 R0`, `R0 = concentrationRadius` and `v0` the ejection power: the slider's meaning (the initial
speed of the front at `R0`) is kept. It takes `t = (R^2 - R0^2) / 2 K` to reach `R`: the farthest corner of a screen it started in the middle of
(640 px) takes 10.5 s at the old power and 5.3 s now, where the front used to need 2 s (it then stops, as before).

**Particles stay on screen.** The position pass clamps to the screen and the velocity pass reflects at the walls, as before; the ejecta's speed is bounded
(19 px a substep at most). The blast scenario reads the positions at the end and finds no particle outside the screen (0 of 300 000), so
B1's scissored gravity passes (`gravityWindow.ts`) still see every particle.

## Retuning

The default cloud's supernova (`dust.supernova.history`, 400 000 particles, seed 20240613, 1200 frames = 30 s). All the figures are from the
GTX 1060; the history is chaotic (the read-back lands a frame earlier or later from one run to the next), so the sweeps run three clouds.
Times of the supernovae in seconds, `/` between the seeds:

| Build | Supernovae in 30 s | Times (3 seeds) |
|---|---|---|
| Before A9 (`d2c1dac`, speed 294 px/s flat, cooldown 3 s) | 4, 5, 5 | 3, 12.5, 18.5, 27.5 / 3, 12.5, 16.5, 19.5, 27 / 3, 11, 17, 25.5, 29 |
| First version of A9 (the zone's radius as `R`, 294, 3 s) | 9 | 3, 6, 9, 12, ..., 27 (every cooldown) |
| Rms radius, 294 px/s, cooldown 3 s | 6, 7, 7 | 3, 6, 9, 20.5, 24, 27 / 3, 6, 9, 16, 19.5, 22.5, 27 / 3, 6, 9, 19.5, 22.5, 25.5, 29.5 |
| Rms radius, 588 px/s, cooldown 3 s | 5, 4, 5 | 3, 6, 14, 18.5, 24.5 / 3, 6, 17.5, 27.5 / 3, 6, 17, 25.5, 29.5 |
| Rms radius, 735 px/s, cooldown 3 s | 5, 6, 4 | 3, 6, 14, 23, 27 / 3, 6, 13.5, 18, 22.5, 27.5 / 3, 6, 20.5, 28.5 |
| **Rms radius, 588 px/s, cooldown 6 s (shipped)** | **4, 4, 4** | **3, 9, 18.5, 25 / 3, 9, 19.5, 25.5 / 3, 9, 19.5, 25.5** |
| Rms radius, 735 px/s, cooldown 6 s | 3, 4, 4 | 3, 9, 18.5 / 2.8, 14, 20.5, 27.5 / 3, 9, 23, 29.5 |
| Rms radius, 294 px/s, cooldown 6 s | 5, 5, 5 | 3, 9, 15, 21, 27 (every cooldown) |

What happens: at 3 s the donut has collapsed and 97.6 % of the mass is inside one 65 px disk (rms 28 px: 4 / 15 / 39 / 80 % of the mass within
5 / 10 / 20 / 40 px). Gravity of that core is strong (the infall test measures 70 to 100 px/s^2 on the ejecta in the first 0.2 s), and it now acts during the 0.6 s the ejecta used to
fly free (the old model gave them about 180 px of head start before it switched on). At the old speed the explosion barely disperses it: 45 % of the
mass is still in the zone after 0.5 s and 37 % after 1 s at 588 px/s; at 294 px/s (the old power) 87 % after 0.5 s, and every cooldown the
cloud is as concentrated as it was, 9 supernovae in a row with the zone's radius and 6 to 7 with the rms one. Doubling the speed
(`SUPERNOVA_SPEED` 420 to 840, so 70 % is 588 px/s of rms speed) disperses the cloud (2.7 zone radii of mean distance after 2 s, 4.0 after 4,
none inside the zone after 2 s) but the cloud still falls back within a cooldown: the second supernova comes at the first moment it is
allowed in every seed (3 s after the first, at the old cooldown). The cooldown was doubled to 6 s, the smallest gap of the old history,
so that no two supernovae are closer than the old ones were. Speeds above 588 change little (735: the same events, one fewer on
average): not worth the energy.

The default run of the shipped constants, event by event (`dust.supernova.history`), the ejecta followed from the event
(mean distance to the centre in zone radii, share of their mass still inside the zone) after 0.5 / 1 / 2 / 4 s:

| Event | Trigger (share of the mass) | Ejecta |
|---|---|---|
| 3.03 s | 0.976 | 1.5, 2.1, 2.7, 4.0 zones; 0.45, 0.37, 0.00, 0.00 inside |
| 9.03 s | 0.77 | 2.4, 3.6, 4.8, 5.3; 0.29, 0.05, 0.02, 0.02 |
| 18.03 s | 0.39 | 3.0, 5.2, 7.5, 9.9; 0.10, 0.04, 0.02, 0.01 |
| 24.03 s | 0.64 | 2.2, 3.5, 5.5, 7.7; 0.50, 0.46, 0.00, 0.00 |

Before A9 the first event's ejecta were at 2.3, 4.1, 6.6, 6.6 zones and none were inside the zone after 0.5 s: they left at once, at a speed
nothing slowed down for 0.6 s. The shipped explosion is gentler at the first instants and as far a few seconds later, and its ejecta
decelerate and fall back as they should. At the end (30 s) 24 % of the mass is in dense texels in two clumps (before: 26.5 %, 2).

## Evidence

All with `scripts/run-lab.mjs` (below). `dust.supernova.blast` takes 3.4 s, `.infall` 11 s, `.history` 12 s, `.sweep` 116 s.

### The blast (`dust.supernova.blast`)

A disc of the detection radius (65 px) at the centre of the 1024 x 768 area holds half of the 300 000 particles (uniform), the rest is uniform
outside it; gravity, pressure, sticking and drag are off, so nothing moves until the supernova fires (frame 21).

| Species | Mass (relative) | Species factor | Slope of the ejecta's speed against distance (1/s) | Formula | R^2 |
|---|---|---|---|---|---|
| Hydrogen | 0.0169 | 1.988 | 25.57 | 25.57 | 1.000 |
| Helium | 0.0670 | 0.998 | 12.83 | 12.83 | 1.000 |
| Lithium | 0.1161 | 0.758 | 9.744 | 9.744 | 1.000 |

(The hydrogen fit leaves out the 4 777 particles whose speed the velocity pass bounds at `MAX_SPEED`; the formula is `v0 f / R`, with
`R` = 45.7 px the rms distance and `v0` = 588 px/s.) The worst error of any ejecta's speed against `ejectionSpeed()` is 5.7e-4 px/s. The
front: 59 samples over 5.3 s, the radius of the farthest kicked particle of the uniform part against the time since the ejection:

| Fit | Result |
|---|---|
| `R^2` against `t` | R^2 = 1.000, slope / `2 K` = 0.9995, intercept / `R0^2` = 1.012 |
| Free exponent, `R^q = a + b t` (q from 0.5 to 4) | best q = 2.00, exponent of time 0.500 |
| RMS error of that fit / of a constant-speed front | 0.19 px / 32.8 px |
| Worst gap between the particles' front and the CPU's radius | 1.3 px |

### The infall (`dust.supernova.infall`)

The same cloud ejected four times: highest (70 %) and lowest (5 %) power, with gravity off or on from the instant of the ejection (kGravity
set when the supernova fires, pressure and sticking off throughout).

| | Power 70 % | Power 5 % |
|---|---|---|
| Mean radial speed of the ejecta at 0.2 s, with gravity against without | -3.1 % (484 against 500 px/s) | -110 % (-3.4 against 35.7) |
| Deceleration of the species in the radial bin (median, min to max), px/s^2 | -71.8 (-92.3 to -67.1), max/min 1.38 | -99.0 (-101.5 to -98.2), max/min 1.03 |
| Drift of the mean radial speed without gravity, 0.2 s | 0.06 % | 0.05 % |
| Mean distance of the ejecta, farthest / closest after / end, zone radii (end without gravity) | 5.85 / 2.24 / 5.32 (5.43) | 2.57 / 0.11 / 2.57 (4.52) |

At the highest power the ejecta spread to the walls (a mean distance of 5.9 zones at most, 5.3 at the end; 5.4 without gravity) and the
mean radial speed turns negative only once they have bounced; at the lowest it turns negative within 0.2 s and the cloud falls to 0.11 zone radii.

### Timing

Simulation time per frame (`Simulation.step()` and `endFrame()`, two substeps, GPU waited for), ms, default parameters, 1024 x 768: median over
6 runs of each build, alternated pair by pair with the order swapped every pair (the build of `d2c1dac`, then this branch), [min, max] in
brackets, and the median of the six pair ratios. No other headless browser ran during a measurement (the lock).

| Window | Particles | Before | After | Median of the pairs (range) |
|---|---|---|---|---|
| Frames 10 to 50 (`perf.dustEarly`) | 400 000 | 3.508 [3.475, 3.705] | 3.678 [3.210, 3.915] | +3.2 % (-10.8 to +12.2: noise) |
| | 1 000 000 | 4.755 [4.610, 6.150] | 4.830 [4.795, 4.880] | +1.7 % (-20.7, one outlier, to +4.0) |
| Frames 150 to 190 (`perf.dustLate`, after the first supernova) | 400 000 | 2.833 [2.810, 2.970] | 2.895 [2.870, 2.965] | +2.4 % (-2.7 to +3.4) |
| | 1 000 000 | 4.928 [4.795, 5.155] | 5.055 [4.915, 5.195] | +2.6 % (-4.2 to +8.3) |

The velocity pass has a few more operations (the ejection's division, two multiplications by `contact`); the density, the gravity passes and
the position pass are the same. The CPU analysis of the read-back (every 12 frames) has the same loops as before with a lookup of the
species' mass; it was not timed apart.

## What it does not do

- **The explosion is a prescription.** The ejecta's rms speed is a slider; the energy is not stored in the dust, so a heavier cloud is not
  blown harder. The front is a kick on the particles it sweeps, not a fluid.
- **The cloud still falls back.** With one collapsed cloud holding most of the mass, the ejecta of the first supernova return within a few
  seconds (the second supernova comes at the first moment the cooldown allows it). That is gravity doing what it should; a longer cooldown
  would hide it, a different design (a remnant that stays, a feedback that expels mass for good) would change it.
- **A compact clump gets a handful of ejecta at the speed bound.** `MAX_SPEED` caps them (3.5 % of the ejecta of the lab disc): the explosion
  of a clump much smaller than the detection disk does not add the energy it would otherwise.
- **The history is chaotic.** The numbers of events and their times vary by seconds from one run to the next; the cooldown pins the second
  event. Read the pattern (first at 3 s, second at the cooldown, then a gap of 6 to 10 s), not a time.

## Method

| | |
|---|---|
| Renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)` |
| Browser | HeadlessChrome, ANGLE OpenGL backend, 1024 x 768, `--angle gl` |
| Date | 2026-11-21 |
| Code | `feat/coherent-supernova` on top of `d2c1dac` (A10); `d2c1dac` for the "before" builds |

The GPU was shared with other jobs; every run went through a lock and waited for any other headless browser to leave.

    npx vite --port 5207                                          # this code
    git archive d2c1dac | tar -x -C /tmp/before && ln -s "$PWD/node_modules" /tmp/before/node_modules
    # copy src/lab/scenarios/dustSupernovaHistory.ts and src/lab/config.ts there, list the scenarios in its src/lab/registry.ts
    (cd /tmp/before && npx vite --port 5208)                      # the code before A9
    node scripts/run-lab.mjs --url http://localhost:5207/particle-simulator/lab.html --query scenarios=dust.supernova.blast,dust.supernova.infall
    node scripts/run-lab.mjs --url http://localhost:5207/particle-simulator/lab.html --query scenarios=dust.supernova.history,dust.supernova.sweep
    # timing: alternate the two servers, one run each, as many pairs as wanted
    node scripts/run-lab.mjs --url http://localhost:5208/particle-simulator/lab.html --query scenarios=perf.dustEarly,perf.dustLate
    node scripts/run-lab.mjs --url http://localhost:5207/particle-simulator/lab.html --query scenarios=perf.dustEarly,perf.dustLate

`dust.supernova.history` and `.sweep` read only the application's public surface, so they run on the build before (set `SUPERNOVA_SWEEP_SPEEDS` to
`[294]` there: the speed uniform of that build is the flat ejection speed).

## Deviations from the plan

- **`R_cluster` is the rms radius of the ejected mass**, not the detection radius (see "The design"): the plan's formula, taken with the fixed radius, does not
  disperse a compact cloud at any speed the slider offers (9 supernovae in 30 s at the old speed, 5 with the speed tripled).
- **No compactness criterion** (see "The trigger").
- **Two constants retuned**, `SUPERNOVA_SPEED` and `SUPERNOVA_COOLDOWN`; a saved configuration's power slider (70 %) now means 588 px/s of rms speed, not 294.
- **The sticking is gated by the ejection timer** as well as by the barrier of A10 (the plan says "only the sticking is lifted"; the pressure is lifted too, for the reason above).
- **The speed jitter of the ejection is removed** (a homologous flow has none); the angular jitter stays.

## What the later dust phases should know

- **B4 (GPU reductions replacing the position read-back).** The trigger now needs, per read-back: the species mass of each particle (the texel's z),
  the densest disk by mass, its centre of mass, the mass share and the rms radius of its members. A GPU version has to
  produce the same five numbers (a mass grid in float32, a second moment, then a small read-back); the mask of the ejected
  particles (255 inside the disk) is still a CPU texture upload.
- **C4 (a better deposit).** Nothing in the supernova reads the density grid: the trigger, the centre and the radius are from the particles. The ejecta
  feel the grid only through gravity, whose passes are scissored to the screen's part of the field (no particle left it in the lab blast).
- **`MAX_SPEED` is now part of the explosion.** Any change of the bound (A10's note on 1500 px/s) changes how a compact clump explodes.
- **The cooldown, not the physics, pins the second supernova** of the default cloud (3 s at the old constants, 6 s now): a later phase that removes the
  cooldown or makes the cloud less bound will change the cadence.
