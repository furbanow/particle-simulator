# Spike B1 and A14: the sticky dust's gravity per density texel, with an isotropic stencil

Phase P2 of the improvement plan. Proposal B1 computes the multi-scale gravity of the sticky dust per
texel of the density pyramid instead of per particle; proposal A14 replaces the central difference
of each level by an isotropic stencil, which is cheap once the gradient is computed per texel. This
document records what was built, what it costs, how exact it is and what it did not achieve.

## Verdict

- **B1: GO.** The criterion was set before measuring: the simulation must gain at least 15 % at
  1 000 000 particles and lose at most 5 % at 400 000. Measured on the lab's GPU (GTX 1060), shipped
  code against the code before, 5 alternated pairs: **19.4 %** faster at 400 000 particles, **18.7 %** at
  1 000 000, 4.0 % at 3 000 000 (7.3 % in the side-by-side runs, which have 9 pairs there). The gain is
  real but far below the plan's estimate (a 7-fold and 54-fold reduction of the gravity cost at
  400 000 and 3 000 000 particles): the new gravity still costs about 0.55 ns per particle and substep
  at every count, so it stays 48 to 78 % of the old gravity's cost instead of vanishing. The reads
  were not the whole price of the old loop, and the one that remains is a random read in a texture
  (see "Where the time goes").
- **The force is the old one.** At the same stencil, the pull of the per-texel field equals the
  per-particle loop's to **0.13 % (median), 0.47 % (95th percentile), 1.0 % (99th)** on a clumped
  cloud of 400 000 particles, and to rounding (0.06 % median, 0.24 % at the 99th percentile) at the
  centers of the density texels. The plan allowed 1 %, "apart from smoothing": there is none (see
  "The design").
- **A14: done, the target is not reached.** Without it, the pull of a point mass varies by **38 %
  (median) and 42 % (worst radius)** with the angle: the kernel is a square. Scharr's stencil
  brings that to 5.7 % and 9.3 %. A stencil of the same family with the corner weight tuned on the
  data (0.21 instead of 3/16) brings it to **3.9 % and 4.9 %**, and that is what ships. The plan's
  target of 2 % is out of reach of a 3 x 3 stencil on these mip levels (see "Anisotropy").
- **It changes the dynamics.** The isotropic stencil weakens the pull of small structures: the RMS
  pull felt by the particles of a clumped cloud is **84 %** of the old one. K_GRAVITY was not
  touched; see "Risks for the next phases".

## What was built

| | |
|---|---|
| `src/simulation/stickyDust/gravityField.ts` | `DustGravityField`: one `GridPass` per coarse level (1 to 8) writing that level's gradient at its own resolution, weighted `2^(level x LONG_RANGE)`, then a pass summing the levels into a 513 x 513 half-float grid at the **corners** of the density texels. |
| `src/shaders/dust-gradient.glsl`, `dust-gravity-level.frag`, `dust-gravity-sum.frag` | The gradient of one level (the three-row stencil), the level pass, the sum pass. |
| `src/shaders/dust-gravity-lattice.glsl` | `gravityFieldUv()`: where a position sits in the sum. |
| `src/shaders/velocity-sticky-dust.frag` | Level 0 from the four density taps already read for the pressure, plus one bilinear read of the sum: 5 reads instead of 36. The loop and its `maxLod` / `longRange` uniforms are gone. |
| `src/simulation/stickyDust/gravityWindow.ts` | Pure, tested: the passes are scissored to the part of the field the screen can read (the density domain is twice the screen), margin `GRAVITY_WINDOW_MARGIN`. |
| `src/config.ts` | `DENSITY_TOP_LEVEL`, `GRAVITY_WINDOW_MARGIN`, `DUST_GRADIENT_CORNER_WEIGHT`. |
| Lab | `dust.gravity.parity`, `dust.gravity.point-mass`, `perf.stickyDust.3m`; `GravityProbe` (the old loop kept as the yardstick), `dustGravityModel.ts` (a CPU twin, tested), `gravityStats.ts`. |

## The design

Each level of the pyramid has its gradient, weighted, summed: `g(x) = sum over L of 2^(L x LONG_RANGE) x
(D_L(x + o_L) - D_L(x - o_L))` (central difference, `o_L` = one texel of level L), where `D_L` is the
bilinear read of the level. The old shader evaluated that at every particle (9 levels, 4 reads).

**Why the sum is exact.** `D_L` is bilinear between the *centers* of the texels of level L, and a level-L
texel is 2^L texels wide, so those centers are *corners* of level-0 texels for every L >= 1. The
gradient `D_L(x + o_L) - D_L(x - o_L)` with `o_L` exactly one texel is therefore the bilinear
interpolation of the differences computed at the nodes: it can be computed per texel, on the level's
own grid. The sum of the levels is bilinear between the corners of level-0 texels, so it can be stored
at those corners and one bilinear read gives the sum of the levels' reads at any position. The
plan's text said "interpolate the gradient"; done naively (the sum sampled at the texel centers) this
interpolates across the kinks of the coarse levels and differed from the old loop by 1.6 % (median)
and 9 % (95th percentile) in a first attempt. At the corners there is nothing left to smooth. Level 0 is the one level
whose nodes are not corners, so it stays in the particle, which reads its four taps anyway for the
pressure; the pressure is unchanged.

**The apron.** Beyond the first node of a level (the outer half texel of the field) the old loop
interpolates the *density* toward its clamped edge value, which is not the clamp of the gradient.
Each level's grid has one texel of apron on every side holding the gradient of the level continued by
repeating its edge texels, and then the equality holds up to the field's edge too. Without it, the
agreement at the particles was 1.7 % (95th percentile) and 3.8 % (99th) for the stencil in use,
all of it in the outer half texel of the coarse levels (for the top level, the outer quarter of the
field's width on each side), which the screen reaches when the grid is shifted.

## Evidence

### Timing

Simulation time per frame (`Simulation.step()` and `endFrame()`, two substeps, the GPU waited for every 30
frames), ms, default parameters, 1024 x 768. Median over the runs, [min, max] in brackets.

**The shipped code against the code before B1** (`a83a556`), `perf.stickyDust.<count>`, runs of the two
builds alternated, 5 pairs (the old build's 3 000 000 row has 4 runs):

| Particles | Before (a83a556) | After (this branch) | Simulation | Whole frame (simulation, particles, nebula, bloom) |
|---|---|---|---|---|
| 400 000 | 3.242 [3.133, 3.427] | 2.613 [2.510, 2.680] | **19.4 % faster** | 5.515 to 4.728 ms: 14.3 % |
| 1 000 000 | 5.745 [5.663, 5.803] | 4.670 [4.582, 4.820] | **18.7 % faster** | 9.845 to 9.370 ms: 4.8 % |
| 3 000 000 | 12.185 [12.080, 12.320] | 11.700 [10.630, 14.100] | 4.0 % faster (noisy) | 31.62 to 30.91 ms: 2.2 % |

**The two paths side by side in one build**, before the stencil and the apron (a lab-only switch, not kept;
the central-difference field against the old loop, and a third arm with no gravity at all, whose cost is
the floor), `perf.dustGravity.<count>`: 9 rounds per run, the arms alternated and their order reversed
every round, each arm restarted and warmed up; 3 runs at 400 000 and 1 000 000, 1 at 3 000 000. All the
paired rounds pooled:

| Particles | Pairs | Old loop | Per-texel field | No gravity | Gain (medians) | Gain (median of the pairs) | Worst and best pair |
|---|---|---|---|---|---|---|---|
| 400 000 | 27 | 3.203 [3.082, 3.423] | 2.715 [2.525, 3.172] | 2.268 | **15.2 %** | 15.8 % | 2.9 % to 25.9 % |
| 1 000 000 | 27 | 5.883 [5.180, 6.338] | 4.932 [4.095, 5.310] | 3.917 | **16.2 %** | 17.4 % | -2.5 % to 30.0 % |
| 3 000 000 | 9 | 13.490 [12.240, 15.120] | 12.510 [11.780, 13.290] | 9.053 | 7.3 % | 9.2 % | -5.7 % to 19.7 % |

Gain of each of the three runs: 17.5, 14.7 and 15.7 % at 400 000; 12.5, 18.4 and 17.3 % at 1 000 000. The
pairs themselves vary widely (the best gain 30 %, the worst a loss of 2.5 % at 1 000 000), which is why the
figures are medians over many pairs and not single runs.

**GO.** The criterion (at least 15 % at 1 000 000, at most 5 % lost at 400 000) is met by both
measurements: the field is 15 to 19 % faster at 400 000 and 16 to 19 % at 1 000 000. The two sets of runs
(an hour apart) agree on what the old loop costs, within 2.4 % (3.20 and 3.24 ms at 400 000, 5.88 and 5.75
at 1 000 000), which also says that the lab-only switch of the first build cost nothing.

### Where the time goes

From the same runs: the old gravity (the loop minus the no-gravity arm) was 0.93, 1.97 and 4.44 ms, that is
29, 33 and 33 % of the frame at 400 000, 1 000 000 and 3 000 000 particles. The gravity that is left (the
field arm minus the same floor) is 0.45, 1.02 and 3.46 ms: **0.56, 0.51 and 0.58 ns per particle and
substep, the same at every count**. So the per-texel passes are not what remains (they cost about 0.1 ms
per frame in the first build, where they ran and nothing read them), and the cost of the old loop was
not proportional to its reads either: it spent 0.74 ns per particle and substep at 3 000 000 on 32 reads of
the coarse levels, 0.02 ns each, because those are small textures that stay in the caches, while the one
read of the field costs 0.5 to 0.6 ns. The plan counted reads; what is left is the cost of one random
access into a 513 x 513 texture from a pass that runs over the particles in index order. It is the same
for every particle, hence the same per particle at every count, and it is what limits the gain at
3 000 000. (This is the explanation the experiments of the first build pointed to; it was not isolated
further.) (The reads fell from 36 to 5 per particle and substep, as built; the time did not follow.)

### Parity with the old loop

`dust.gravity.parity`: 400 000 particles, default parameters, seed 7771, 150 frames (the clumps have formed),
then four snapshots five frames apart (the grid is shifted differently each time), 262 144 particles
compared in each. The reference is the old per-particle loop, kept in `src/lab/gravityProbe.ts`, with the
same stencil as the field; both read the density pyramid of the substep that just ran. The relative error
is judged on the particles whose reference pull is at least 10 % of the RMS pull (99.4 % of them; where the
levels nearly cancel a relative error means nothing, and the absolute error is reported next to it: its
largest value is 0.8 % of the RMS pull, its 99th percentile 0.4 %; the largest relative error is 5.1 %).

| | Median | 95th percentile | 99th percentile | Relative L2 |
|---|---|---|---|---|
| At the particles | 0.127 % | 0.469 % | 1.011 % | 0.155 % |
| At the centers of the density texels (no re-interpolation) | 0.063 % | 0.167 % | 0.243 % | 0.058 % |
| At the particles, the density read with exact interpolation weights | 0.076 % | 0.212 % | 0.450 % | 0.083 % |

What is left is the rounding: the half floats of the stored gradients, and the 8-bit interpolation weights
of the hardware filter, which the reference (up to 72 reads per particle) feels more than the field
(one read): reading the density with exact weights halves the error. Replay noise (the loop against the loop, same
seed) is 0. (A run with float32 targets in place of half floats, made when the apron was missing and the
error at the 99th percentile was 3.8 %, left that error unchanged at 3.6 %: it was not the storage.
The twelve worst particles were all in the outer half texel of the top level.)

Against the *original* loop (the central difference), the stencil in use changes the pull of this cloud
by a relative L2 of **22.0 %** and its RMS value is **83.7 %** of the original: that is A14's price, not
B1's. B1 alone (`DUST_GRADIENT_CORNER_WEIGHT = 0`) reproduces the original loop with a median of 0.165 %, a 95th
percentile of 0.58 %, a 99th of 1.10 % and a relative L2 of 0.19 % (RMS pull 99.9 % of the original): the
plan's "1 %". Before the apron it was 0.18 %, 0.83 %, 1.95 % and 0.21 %, and its tail was the field's
edge.

## Anisotropy

The pull of a point mass (1000 units, deposited cloud-in-cell as a particle is) on rings of radius 2 to
96 density texels around it, 360 angles per ring. The grid is shifted at random at every substep in the
application, so the pull a particle feels is the average over the positions of the mass relative to the
grid: 256 Halton positions here. Anisotropy is (max - min) / (max + min) of the pull toward the mass over
the angle, read on the harmonics 4, 8, 12 and 16 of the angle only (the ones a square kernel produces;
the rest of a profile is noise and inflated the raw figure, which is also recorded). Rings of 4 texels and
more are judged: below, the 2 x 2 deposit of the mass itself is the kernel.

`dust.gravity.point-mass`, per ring (the field and the per-particle loop agree to 0.03 points):

| Ring (texels) | 4 | 6 | 8 | 12 | 16 | 24 | 32 | 48 | 64 | 96 | Median | Worst |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Central difference | 35.0 | 37.9 | 37.4 | 38.4 | 38.1 | 38.6 | 38.4 | 39.2 | 39.7 | 41.9 | **38.4** | 41.9 |
| Scharr, w = 3/16 | 1.9 | 8.3 | 2.6 | 8.5 | 2.9 | 8.6 | 2.9 | 8.8 | 3.1 | 9.3 | **5.7** | 9.3 |
| Shipped, w = 0.21 | 2.4 | 4.2 | 3.2 | 4.5 | 3.5 | 4.5 | 3.6 | 4.6 | 3.6 | 4.9 | **3.9** | 4.9 |

(All three rows are the GPU's, from the scenario's JSON, `stencils.<name>.fieldRings`; the CPU twin in
`src/lab/dustGravityModel.ts` gives the same figures to about a point.)

- The central difference is a square: 38 to 42 %, whatever the radius.
- Scharr's stencil, which is exactly isotropic for a smooth field, leaves 2 to 3 % at the radii that are
  powers of two times 4 and 8 to 9 % at those times 6: the box-filtered mip levels have a squareness of
  their own, of a sign that flips with the ratio of the radius to the level's texel, and no stencil
  weight cancels it at every radius. A sweep of the weight w with the CPU twin (23 radii, 160 Halton positions) gives, for the worst ring
  and the median: 9.3 and 4.3 % at 0.1875, 6.9 and 2.3 % at 0.20, 5.9 and 2.5 % at 0.205, 4.9 and 2.8 % at
  0.21, 4.5 and 3.4 % at 0.215, 5.5 and 3.0 % at 0.22. The worst ring is lowest at 0.215 and the median at
  0.20; **0.21** balances them and ships, rather than Scharr's 3/16: same cost, about half the worst case.
- **The plan's 2 % is not reached**, and not reachable with a 3 x 3 stencil of this family, which has one
  free weight. The next candidates are a stencil that alternates between the axis-aligned and the
  diagonal orientation from one level to the next (the squares' signatures would partly cancel between
  neighbouring levels), a 5 x 5 stencil, or a mip filter that is not a box. None was tried. The cost of
  A14 was not isolated, but the shipped build (8 reads per texel and level in place of 4, and the apron)
  is not slower than the first one in the runs above (2.61 against 2.72 ms at 400 000, 4.67 against 4.93
  at 1 000 000, from different runs): the passes are too small to show.
- **Strength.** The pull is weaker: the median ring feels 0.88 of the central difference's pull (0.85 to
  0.91), and a clumped cloud 0.84 in RMS. A smooth field is not affected (the three rows sum to one):
  the loss is in the small structures, at the scale of a level's texel.

## The particle cap ratio of the sticky dust

`STICKY_DUST_CAP_RATIO` (1.25) makes the dust's slider cap 1.25 times the protostar's, which the GPU
benchmark measures at 60 FPS. The ratio that matches the two costs is the one at which the dust, at
`ratio x N`, takes as long per frame as the protostar does at `N`, its cap. From the whole frames
of the lab (simulation, particles, nebula, bloom; 1024 x 768) on a line through 400 000 and
1 000 000 particles for each algorithm (median of 5 runs of the dust, 4 of the protostar, the same
hour, ms): protostar 7.34 and 16.40, dust after B1 4.73 and 9.37, dust before B1 5.52 and 9.85.

| Protostar's cap `N` | 200 000 | 350 000 | 500 000 | 750 000 | 1 000 000 |
|---|---|---|---|---|---|
| Ratio, dust after B1 | 1.74 | 1.83 | 1.87 | 1.89 | 1.91 |
| Ratio, dust before B1 | 1.17 | 1.57 | 1.72 | 1.85 | 1.91 |

The same calculation on the figures of [lab-baseline.md](../lab-baseline.md), which the GPU produced in
another state (the dust before B1: 18.7 and 33.4 ms; protostar 24.1 and 50.2): 1.18 at 150 000, 1.39 at
230 000, 1.52 at 350 000, and 1.44 at the 60 FPS limit (18.3 ms, 1.1 x 16.7).

**Not changed.** B1 raises the ratio (most when the protostar's cap is low: +0.6 at 200 000) and the
figures of the day are all above 1.25 once B1 is in; but the ratio depends on the protostar's cap (1.17 to 1.91 for the dust
before B1), hence on the GPU, and this is one GPU, in headless Chrome at a fixed canvas; and the dust
changes its cost again with P6a (A10). Every estimate for the dust after B1 stays above 1.3 (about 1.35 in
the least favourable case, the baseline's state with B1's 14 % on the whole frame added), so any ratio
from 1.3 to about 1.7 is supported and 1.25 sits under all of them; the choice is left to the owner, with
the numbers above.

## Method

All the numbers come from the lab ([lab.md](../lab.md)) on one machine.

| | |
|---|---|
| Renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)` |
| Browser | HeadlessChrome 155, ANGLE OpenGL backend, 1024 x 768, `--angle gl` |
| Dates | 2026-11-21 |
| Code | this branch for the new build, `a83a556` (the commit this work started from) for the old one |

The GPU was shared with another job; every run was serialized behind a lock (all but the very first
also waited for any other headless browser to leave). The absolute times of the day are 2 to 3 times lower than the ones recorded
in [lab-baseline.md](../lab-baseline.md) (see the note there: the GPU was in another state); compare
within a session, not with that table.

Reproduce:

    npx vite --port 5202                                       # this code
    git archive a83a556 | tar -x -C /tmp/old && ln -s "$PWD/node_modules" /tmp/old/node_modules
    (cd /tmp/old && npx vite --port 5203)                      # the code before B1
    node scripts/run-lab.mjs --url http://localhost:5202/particle-simulator/lab.html --query scenarios=dust.gravity
    # timing: alternate the two servers, one run each, as many pairs as wanted
    node scripts/run-lab.mjs --url http://localhost:5203/particle-simulator/lab.html --query scenarios=perf.stickyDust.1m
    node scripts/run-lab.mjs --url http://localhost:5202/particle-simulator/lab.html --query scenarios=perf.stickyDust.1m

(The old build has no 3 000 000 scenario: add the count to `PERF_COUNTS` in its `src/lab/config.ts`.)
`dust.gravity.parity` takes 15 s and `dust.gravity.point-mass` 8 s. `perf.stickyDust.<count>` reports the
simulation alone (`simulationMsPerFrame`: `Simulation.step()` and `endFrame()`, the GPU waited for after
every chunk of 30 frames, the median of four chunks after a 1.5 s warm-up) and the whole frame.

## Deviations from the plan

- **The sum is stored at the corners of the density texels, not accumulated from the coarse levels to
  the fine one** (see "The design"): the plan's accumulation chain would have interpolated across the
  kinks; the corner lattice makes the sum exact. Level 0 stays in the particle.
- **No smoothing**, where the plan expected "a bit smoother" and a test "apart from smoothing".
- **The gain is smaller than estimated** (see the verdict), because the plan counted reads and the
  cost is not proportional to them.
- **A14 ships a tuned weight (0.21), not Scharr's 3/16, and misses its 2 % target** (4 to 5 %).
- **The sum is computed only where the screen can read it** (`gravityWindow.ts`), which the plan did not
  mention: the density domain is twice the screen in each direction.
- The particle cap ratio of the sticky dust was re-derived and left at 1.25 (see above).

## Risks for the next phases

- **Particles must stay on the screen.** The passes are scissored to the part of the density field the
  screen can read (plus `GRAVITY_WINDOW_MARGIN`); the rest of the field holds stale values. The walls
  keep every particle on the screen today. A phase that lets particles leave it (a bigger domain,
  panning, an ejection past the walls) must widen the window first, or the particles outside would feel
  garbage.
- **P6a (A10, granular dust, `m |v|^2` in the alpha channel of the density).** The gravity passes
  read the R channel only, so an alpha channel is free; but the levels must stay the hardware's mip chain
  (box filter, texel centers of level L at corners of level 0): the exactness of the sum depends on it.
  A gradient of another channel at the coarse scales would need the passes to carry it (RGBA16F
  instead of RG16F). The pressure cannot move to the passes: `max(density - REST_DENSITY, 0)` is taken
  *after* the interpolation, so it is not bilinear between nodes. The cost that remains of the new
  gravity is one random read per particle and substep (about 0.55 ns); a second one was not measured
  but should be expected to cost the same order.
- **P6b (A9, coherent supernova).** The field is recomputed from the deposit at every substep, so
  a sudden displacement of mass is followed at once; nothing in the shock wave or the ejection reads
  it. The gravity the particles feel is 16 % weaker (RMS) than before A14, and the supernova threshold
  and the strength of the shock were tuned against the old pull: retune them after this phase, not before.
- **K_GRAVITY.** To get the old strength back in a clumped cloud, multiply it by about 1.2 (84 % RMS
  pull); it would also strengthen the smooth, large-scale pull by 20 %, which A14 did not change, so it
  is a trade, and it was not made. (Made in P6a, as a gain of 1.2 on the gravity slider's value: `K_GRAVITY` was dead code, the slider's default
  overwrote it; see [a10-granular-dust.md](a10-granular-dust.md).)
- **The 3 000 000-particle gain is small (7 to 9 % in the first measurement)**: the cost that
  remains is per particle (see "Where the time goes"). Nothing was tried to lower it.
