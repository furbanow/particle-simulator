# Spike B4: the sticky dust's concentration on the GPU

Phase B4 of the improvement plan (option of P6). Every 12 frames the sticky dust used to read the whole position texture back (up
to 48 MB at 3 000 000 particles), loop over it on the CPU to find the densest disk of the detection radius and the share of the
mass inside, and upload a mask of the particles inside (3 MB) for the ejection. This document records what replaced it, how
close the GPU's answer is to the CPU's, what it did to the frame times and to the default cloud's supernovae.

## Verdict

- **The periodic read-back is gone.** Every 12 frames the dust used to read 6.4 MB (400 000 particles) to 48 MB (3 000 000) of positions and
  loop over them in JavaScript. It now queues three point passes over the particles and eight small passes and reads **two texels** (eight
  floats). The mask texture and its 3 MB upload are gone too: the velocity pass ejects what is inside the disk.
- **The GPU's answer is the CPU reference's.** Over 35 comparisons (built clouds, five stages of the default cloud's collapse, radii from 10 to 400 px,
  400 000 and 3 000 000 particles) the number of particles inside the disk is the same in all but one (one particle in 2 181 899), the center is
  within **5e-4 px** (the tolerance asked for was one cell, 16 px), the share of the mass within **4.4e-4 percentage points** (2 asked for) and the
  rms radius within 1e-4 px.
- **The supernova is the same.** The blast, homology and infall scenarios give the numbers of the A9 spike to the digit (slope ratios 1.000, front
  exponent 2.00, 13 054 kicks at 1.000 of the formula). At the application's pace (one frame per animation frame) the default cloud's history is the
  old build's: the first supernova at 2.75 s in all three clouds with the same share of the mass (0.976, 0.981, 0.959), then at 12 to 14 s, 19 to 20 s
  and 25 to 29 s, three or four events in 30 s with both builds, the ejecta at the same distances (6.2 against 6.3 zone radii after 2 s). The
  lab's usual loop does not give the old trigger's read-back the time it has in the application, so its timeline there (3.0 s, 9.0 s...) is not
  the application's (see "The supernova").
- **The hitches are gone** (GTX 1060, six alternated pairs, a frame followed by a wait for the GPU): the worst frame over 360 frames of a cloud whose read
  never stops goes from 69 to 20 ms at 400 000 particles, 74 to 32 ms at 1 000 000, 209 to 97 ms at 3 000 000; the p99 from 61 to 20, 64 to 28, 148 to 92 ms.
- **The cost is not higher**: simulation ms/frame, the two builds alternated, -2.6 % to -3.8 % in the windows that read nothing or read at 1 000 000
  particles (-9 % in the one that reads at 400 000, with outliers). A search costs 1.6 to 4 ms at 400 000 particles, 5 to 6 at 1 000 000
  and 14 to 17 at 3 000 000 on the GPU as it was clocked during the measurements, once every 12 frames while no supernova is waiting.

## What was built

| | |
|---|---|
| `src/simulation/stickyDust/concentrationReduction.ts` | The GPU search: three point passes over the particles and eight small grid passes (below), then one asynchronous read of two RGBA32F texels. |
| `src/shaders/concentration-deposit.vert/.frag` | The point passes (cells, center, members), additive float32 blending. |
| `src/shaders/concentration-disks.frag`, `-best.frag`, `-sum.frag` | The disk sums, the argmax and the total, the reductions of the bins. |
| `src/simulation/concentration.ts` | `analyzeConcentration` stays as the reference (the mask is gone), plus the pure parts the GPU shares with it: `concentrationGrid()` (cell size, grid, the integer `reachSquared` that makes the CPU and the GPU take the same cells) and `unpackConcentration()` (the eight floats to the same figures). |
| `src/simulation/stickyDust/gpuModel.ts` | Runs the reduction in `endFrame()` every `CLUSTER_CHECK_INTERVAL` frames; the result arms the supernova as the read-back's analysis did. On a device without `EXT_float_blend` it keeps the position read-back and the CPU reference. |
| `src/shaders/velocity-sticky-dust.frag` | The ejected particles are those inside the disk (`supernovaCenter`, new `supernovaRadius`): no mask texture. |
| `src/simulation/clusterProbe.ts` | Its 48 MB buffer is made at the first read: the dust never reads, so it no longer holds it. |
| Lab | `dust.concentration.parity` and `.parity-heavy` (GPU against CPU), `dust.supernova.seeds` (the history for three clouds), `perf.dustHitch.<count>` (frame times over the periodic read); `src/lab/concentrationParity.ts` (the synthetic clouds and the comparison, tested). |

No parameter and no statistic was added or changed, so the five catalogs are untouched.

## The design

**The same algorithm, on float32 sums.** `analyzeConcentration` has four steps: sum the masses into a coarse grid (cells of a quarter of the
radius), sum the cells of each cell's disk and keep the densest (the first in reading order on a tie), move the center to the center of mass of
the particles inside the radius of that cell's center, and take the mass and the second moment of the particles inside the radius of the new
center. The GPU does the same four steps, so it can be compared with the CPU's figure by figure, not only as a "similar" answer:

| Pass | What it draws | Where |
|---|---|---|
| 1. cells | one point per particle, its mass into its cell of one of up to 16 copies of the grid chosen by the particle's index (float32, additive blending), then a pass that folds the copies | `replicas` (4 x 4 tiles of the grid), `cells`: columns x rows of the coarse grid (64 x 48 at the defaults) |
| 2. disks | for each non-empty cell, the mass of the cells with `dx^2 + dy^2 <= reachSquared` around it (49 reads) | `disks` |
| 3. best | the cell with the most mass in its disk, in two stages (16 x 16 cells per texel, then one texel); the first in reading order on a tie | `blocks`, `best` |
| 4. center | the particles inside the radius of that cell's center, culled by the vertex shader, `(m, m dx, m dy, 1)` into one of 64 x 64 bins by particle index | `bins`, then `sums` (16 x 16 bins per texel), `center` (one texel: the center of mass) |
| 5. members | the same inside the radius of the new center: `(m, m d^2, 1)` | `bins`, `sums`, `result` (two texels) |

Two texels come back (`unpackConcentration`): the center, the mass inside, the second moment `sum m d^2`, the number of particles inside
(their rms radius is `sqrt(moment / mass)`), and the mass of the densest disk of cells. The grids are rebuilt when the radius or the area
change (`setSize`, lazily, at the next measure): the cell is `radius / 4`, so the radius slider (10 to 400 px) gives 1536 x 864 cells
at the most on a 4K screen.

**Why not a mip level, or the density grid.** The professor's text suggests reading the level of the mipmap that matches the radius.
The density grid cannot do it: it is in half floats, a texel saturates at about 128 mass units and its alpha channel holds the
agitation (A10); and a mip level is a box average on a grid shifted at random at every substep, not a disk about the best center.
The cells of the new grid are float32 and aligned to the screen; the radius sets their size, which is what makes the disk of cells
the same set of cells the CPU takes.

**Why bins, and copies of the grid.** All the particles of a clump fall in a handful of texels; blending three million float32 additions into one texel
serializes in the ROP (the first version of the cells' pass took 11 ms of the 15 of a search at 3 000 000 particles: the grid is now drawn in up to 16 copies, `CONCENTRATION_REPLICAS`, folded by a pass, within a budget of a million texels). The particles inside the disk are spread over 4096 bins by their index (a hash of nothing: the index of a
particle is independent of where it is), which are then reduced in two stages of 16 x 16 and 4 x 4. The bins also keep the sums small
(a few thousand units a bin), where the float32 sum of a cell of the coarse grid can be millions.

**The precision.** The cells' sums round to the unit once a cell holds more than 8 million units (the spacing of float32 there is 1: adding a
hydrogen atom, 1.008 u, adds exactly 1). It biases the *total* the cells add up to by a fraction of a percent (the first version, which
divided by that total, was 0.17 points off on a cloud where 90 % of the particles are in one clump, 0.0001 points once the denominator
was the exact total), and it cannot move the center, which comes from the bins. The share's denominator is therefore the total mass
the model knows exactly: the species' masses times their counts (`updateSpecies`). (The copies of the grid added afterwards for speed cut that rounding too, each copy holding a sixteenth of the mass of a cell, but the
exact denominator costs nothing and does not depend on how the cells are laid out.) What the cells' rounding can still do is to pick
another cell when two disks hold masses within a percent of each other, which is a tie to the cell's size, then refined away by the
center of mass (the `twin-blobs` row below).

**The ejection.** The mask (3 MB of bytes, uploaded when a supernova is armed, one texture read per particle in the velocity pass)
is gone: the pass ejects the particles inside `supernovaRadius` of `supernovaCenter`. The set is the disk at the substep the supernova
fires, not the particles that were inside it when the positions were read back, a few frames earlier: the ejecta are what is in the
disk when the shock goes off, as the center, still the measured one, is the clump's.

**The devices without `EXT_float_blend`.** The mass sums need float32 blending. Without the extension (`ConcentrationReduction.supported`
is false) the model keeps the old path: `wantsReadback()` asks the pipeline for the positions every 12 frames and `onReadback` runs
`analyzeConcentration`, then arms the same uniforms. The reference is thus not dead code, it is the fallback; the tests run it (their fake
renderer has no extensions) and the lab compares it to the GPU's.

**Timing.** The reduction is issued in `endFrame()` every `CLUSTER_CHECK_INTERVAL` frames while the cooldown and a pending supernova allow
it, as the position read-back was; the two texels arrive through `readRenderTargetPixelsAsync` a frame or two later (the passes cost 2 to 4 ms of GPU at 400 000 particles, 7 to 17 at 3 000 000, see "What a search costs"), and a restart drops a result in flight.

## Evidence

### The supernova (`dust.supernova.blast`, `.infall`, `.seeds`, `.paced`)

`dust.supernova.blast` and `.infall` give the A9 spike's figures exactly: ejecta speed against distance slope 1.000 of the formula, R^2 1.000 for the three
species; the front R^2 = 1.000, slope 76 403 against `2 K` = 76 440, best exponent q = 2.00, RMS 0.19 px against 32.8 px for a front at constant speed; 13 054
kicks at 1.000 of the formula; the infall (-3 % and -110 % of the mean radial speed against the arm without gravity, deceleration max/min 1.38 and 1.03, mean distance
of the ejecta 5.85 farthest, 2.24 closest, 5.32 at the end, 0.11 at the lowest power).

The history of the default cloud over 30 s for three clouds (400 000 particles, seeds from 20240613), the times of the supernovae in seconds, `/` between the clouds:

| Loop | Build | Events | Times |
|---|---|---|---|
| Paced (`.paced`: one frame per animation frame, as the application runs) | before | 4, 4, 3 | 2.75, 14.13, 20.13, 27.35 / 2.75, 12.35, 18.63, 24.65 / 2.73, 13.53, 19.53 |
| | after | 3, 4, 4 | 2.75, 13.53, 19.53 / 2.75, 12.65, 18.95, 27.35 / 2.75, 12.65, 18.95, 26.75 |
| Unpaced (`.seeds`: the lab's loop, a synchronization every 10 frames), twice identical | before | 4, 4, 4 | 3.03, 9.03, 18.53, 25.03 / 3.03, 9.03, 21.53, 28.03 / 3.03, 9.03, 17.03, 26.03 |
| | after | 4, 4, 4 | 2.78, 15.53, 22.03, 29.03 / 2.78, 16.03, 22.28, 28.53 / 2.78, 13.53, 19.53, 27.53 |

At the application's pace both builds fire the first supernova at 2.73 to 2.75 s with the same share of the mass in the disk at that moment (before 0.9755, 0.9816, 0.9589;
after 0.9756, 0.9814, 0.9594), and the ejecta of every event, followed for four seconds, are where they were: mean distance in zone radii after 0.5 / 1 / 2 / 4 s,
before 2.68 / 4.62 / 6.31 / 7.52, after 2.58 / 4.51 / 6.15 / 7.52, the share of their mass still inside the zone 0.09 / 0.03 / 0.01 / 0.01 against 0.10 / 0.03 / 0.01 / 0.01.

**Why the unpaced timeline moved, and why the A9 timeline (3.0 s, 9.0 s) was not the application's.** The collapse of the default donut is sudden: the share of the mass in the
densest disk is 18 % at frame 84, 26 % at frame 96 and 98 % at frame 108 (the reads that see them), so which of the reads every 12 frames is the first above the threshold depends on which reads are made.
A request is skipped while the previous one has not been delivered. The lab's loop yields to the event loop only every 10 frames (`LAB_SYNC_EVERY`), so an asynchronous read is delivered at
the next synchronization, not a frame or two after its request as in the application, and the 6.4 MB read of the old trigger often misses the one that follows it: the read of frame 96
was delivered at frame 110, the request of frame 108 was skipped, and the first event came with the read of frame 120 (3.03 s, then the cooldown to 9.03 s). Forcing the CPU path onto the new
build (`debugForceCpu`) in the same loop gives first events at frames 121, 131, 121; the GPU path, whose two texels are delivered sooner, takes the request of frame 108 in some runs and not
in others (frames 111 or 121 in the runs made). With the application's pace (the `.paced` scenario, 20 s of wall time a cloud) every read is delivered within a frame or two and both builds fire at frame 109 or 110.
The A9 spike's "3.0 s, 9.0 s, 18.5 s, 25 s" are therefore a property of the lab's loop: the cloud is as concentrated at 2.7 s, and the old trigger fires then in the application.

### The GPU against the CPU (`dust.concentration.parity`, `.parity-heavy`)

The same particles, once on the GPU and once read back and analysed by `analyzeConcentration` (the model's species masses, the same radius). Differences, GPU minus CPU, worst over the rows:

| | 400 000 particles (24 comparisons) | 3 000 000 particles (11) |
|---|---|---|
| Particles inside the disk | identical in all | identical in 10, one of 2 181 899 in one |
| Center, px (a cell is 16.25 px at the default radius) | 6e-5 | 5e-4 |
| Share of the total mass, percentage points | 7e-5 | 4.4e-4 |
| rms radius, px | 4e-5 | 1e-4 |

Rows (400 000 particles, default radius 65 px unless said; the "tie" row is reported, not judged): a uniform cloud (share 1.8 %), a gaussian clump of 25 px with 40 % of the particles at the radii 10, 30, 65, 150
and 400, two clumps of 15 px with the same species (a near tie: the GPU picks the clump the CPU does, the center agrees to 1e-5 px), a clump of 20 px in the corner of the area half of which is off it, one on the far corner with
particles exactly on the far edges, a collapsed clump of 3 px with 90 % of the particles at five radii (share 0.896 to 0.964), a ring of 70 px, and the default cloud at frames 0, 60, 120, 180 and 300
(shares 0.051, 0.109, 0.988, 0.355, 0.379; at frame 300 also the radii 10 to 400). At 3 000 000: the same built clouds (a clump of 3 px with 2 705 316 particles inside the disk) and the default
cloud at frames 0 and 150 (0.998).

**Why 2 points and a cell were generous.** The two use the same grid, the same cells for a disk (the integer `reachSquared`), the same first-in-reading-order tie rule and
the same refinement on the particles, so the center is the same set of particles summed in float32, not a neighbouring cell's center: the differences are the rounding of float32 sums
of up to a few million units. The one place where they could part is a tie between two disks of cells within a part in 1e6 of each other, which is a coin flip for the CPU too (the order of
the float32 blending is not fixed on the GPU); a near-tie of two equal clumps resolved the same way here.

The first version divided the member mass by the total the cells add up to and was 0.17 points off on the clump of 3 px at the radius 400: a float32 cell holding more than 8.4 million units
rounds each addition (a hydrogen atom, 1.008 u, adds 1 beyond 8.4 million, a lithium atom 6.94 adds 7), so the total is off by a fraction of a percent when the clump falls in few cells. The denominator is
now the exact total (the species' masses times their counts, `updateSpecies`); the cells' sums are only used to rank the disks.

### What a search costs

`perf.dustConcentration.<count>`: ten searches queued back to back on the same particles, GPU time of one, the median of five batches. The GPU was clocked low during the
measurements (see "Method"); a search on the GPU at its high clock was about 2.3 times faster (the figures below that mention a high clock were taken in that state):

| Particles | Uniform | Default cloud after its collapse | Clump of 3 px |
|---|---|---|---|
| 400 000 | 1.6 ms | 4.1 ms | 3.9 ms |
| 1 000 000 | 5.3 ms | 5.3 ms | 5.8 ms |
| 3 000 000 | 13.5 ms | 16.6 ms | 15.4 ms |

The cost that mattered was the blending of the first point pass. Measured with a temporary probe that skipped passes (high clock, 3 000 000 particles, collapsed cloud): the whole search took 14.8 ms,
11.3 ms of them the pass that sums the masses into the cells (millions of float32 additions to a handful of texels serialize in the ROP); the 16 copies of the grid, folded afterwards, bring the whole
search to 6.9 ms (3.3 for the pass, 2.9 for the two passes over the particles inside the disk, 1.1 for the eight small ones). On a clump of 3 px: 19.7 ms before, 7.3 after.

### Frame times

`perf.dustHitch.<count>`: 360 frames of the default cloud after 30 warm-up frames, no supernova (the search repeats every 12 frames), each frame followed by a wait for the GPU, the time between
the starts of two frames. Medians over six pairs of runs of the old build and the new, in ms, [min, max] in brackets; "the 4 frames after a request" are the ones in which the old read-back lands and the
old analysis runs, or the new passes queue and complete:

| Particles | Figure (ms) | Before | After |
|---|---|---|---|
| 400 000 | mean frame | 19.15 [18.97, 19.34] | 15.86 [15.66, 15.98] |
|  | p99 frame | 61.2 [60.4, 62.4] | 19.6 [19.4, 19.7] |
|  | worst frame | 68.5 [62.2, 76.2] | 20.1 [19.5, 23.4] |
|  | mean of the 4 frames after a request | 28.62 [27.79, 28.96] | 16.15 [16.00, 16.32] |
|  | mean of the other frames | 14.44 [14.32, 14.55] | 15.73 [15.42, 15.80] |
|  | worst frame minus the mean of the other frames | 54.1 [47.9, 61.8] | 4.4 [3.8, 7.7] |
| 1 000 000 | mean frame | 27.25 [26.77, 27.49] | 22.63 [22.48, 22.84] |
|  | p99 frame | 63.7 [61.8, 65.5] | 27.9 [27.7, 28.0] |
|  | worst frame | 74.3 [64.5, 108.7] | 31.6 [31.5, 31.8] |
|  | mean of the 4 frames after a request | 38.21 [37.41, 38.55] | 23.52 [23.29, 23.79] |
|  | mean of the other frames | 21.72 [21.45, 21.95] | 22.21 [22.06, 22.36] |
|  | worst frame minus the mean of the other frames | 52.6 [42.7, 87.0] | 9.4 [9.1, 9.7] |
| 3 000 000 | mean frame | 70.63 [69.81, 71.99] | 62.48 [60.30, 64.11] |
|  | p99 frame | 147.9 [146.2, 151.7] | 92.3 [87.4, 97.4] |
|  | worst frame | 209.2 [160.7, 245.2] | 96.7 [90.6, 112.6] |
|  | mean of the 4 frames after a request | 91.06 [90.04, 91.66] | 65.20 [63.25, 67.05] |
|  | mean of the other frames | 60.48 [59.69, 62.26] | 61.13 [58.83, 62.68] |
|  | worst frame minus the mean of the other frames | 149.2 [98.4, 184.6] | 35.4 [31.4, 50.2] |

Reading the table: the worst frame and the p99 are the hitches. The old build's are the CPU loop over the positions (about 60 ms at 400 000 particles, 100 at 1 000 000, 150 to 200 at 3 000 000: the three
loops of `analyzeConcentration` and the read-back), the new build's the GPU time of the search in the frame that queues it, plus the wait for it. The other frames cost the same (within 0.5 to 1.3 ms in this
probe, whose per-frame distribution is bimodal: the synchronization read polls every 4 ms, so a frame time sits near 12 or near 17 ms at 400 000 particles and the median flips from one run to the next, which is why
the table gives means; the same build forced onto the CPU path, `debugForceCpu`, gives the old build's hitches in the same probe).

### Simulation cost

`perf.dustEarly` and `perf.dustLate` (the sticky dust's simulation ms/frame, step and `endFrame`, the GPU waited for after each chunk of 10 frames, 5 restarts of 4 chunks each): six runs of each build, alternated pair by pair with the
order swapped every pair, the old build then the new in the odd pairs. Frames 10 to 50 are the window where the old build reads back four times (frames 12, 24, 36, 48), frames 150 to 190 the one after the first supernova, where
nothing is read (the cooldown), so the second window measures the velocity pass alone: it no longer reads the mask texture.

| Window | Particles | Before | After | Median of the pairs (range) |
|---|---|---|---|---|
| Frames 10 to 50 | 400 000 | 3.482 [3.270, 4.905] | 3.202 [3.070, 4.490] | -9.2 % (-36.4 to 37.3) |
|  | 1 000 000 | 14.900 [14.700, 15.070] | 14.445 [14.110, 14.480] | -3.8 % (-5.8 to -1.5) |
| Frames 150 to 190 | 400 000 | 9.762 [9.635, 9.835] | 9.505 [9.405, 9.585] | -2.6 % (-3.4 to -0.6) |
|  | 1 000 000 | 17.380 [17.020, 17.650] | 16.940 [16.550, 17.340] | -2.6 % (-4.6 to 0.3) |

The absolute numbers are about three times those of the A9 spike's timing (3.5 ms at 400 000 particles in the early window): the GPU was clocked low (734 MHz, P5, 11 W, while `nvidia-smi` reported 97 % use) for the whole
campaign, by the machine's power management, not by the runs: every pair sees it, and the ratios are what is read. The pairs run on the GPU at its high clock (two pairs of an earlier version of the code,
before the cells were replicated: early 3.45 to 2.66 ms at 400 000 particles, 4.89 to 4.20 at 1 000 000; late 2.86 to 2.77, 4.96 to 4.76) go the same way.

## What it does not do

- **A search is a few milliseconds of GPU, once per 12 frames.** At 3 000 000 particles it is 7 to 17 ms depending on the clock, in one frame: the hitch is a third of the old one, not zero. It could be spread over three frames
  (cells, center, members), at the price of the center and the members being measured on three successive states; nothing needed it yet.
- **A device without `EXT_float_blend` keeps the old hitches.** It reads the positions back and runs `analyzeConcentration` as before (the mask is no longer built).
- **The disk is the one at the substep the supernova fires**, not at the read: the clump can have moved by a few pixels, its center is the measured one.
- **The sums are float32.** The share is exact to about 1e-6 of the total and the members' count to a particle, which the comparisons show; a cloud of tens of millions of particles (the slider stops at 3 000 000) would need the
  bins to be larger.

## Deviations from the plan and the professor's text

- **No mipmap level.** The text suggests reading the level of the mip pyramid that matches the radius. The density grid is half floats that saturate, and its mips are box averages of a grid shifted every substep: the
  search has a float32 grid of its own, with cells a quarter of the radius, which is also what the CPU reference does.
- **The ejection is by disk, not by mask** (the plan said "selection in the shader from uniforms").
- **The reference is not dead code**: `analyzeConcentration` is the fallback of the devices without float32 blending as well as the lab's yardstick. `ClusterProbe` stays for the protostar's read-back.
- **A scenario at the application's pace** (`dust.supernova.paced`) was added to compare the histories: the unpaced one cannot.

## What the later phases should know

- **C4 (the deposit).** The search reads the position texture, the species' atomic masses and the radius: not the density grid, so a change of the deposit (a TSC kernel, a flag, a float32 grid) does not touch it. If C4 gives the
  dust a float32 mass grid of its own, the coarse cells could be taken from it (a quarter of the radius is a mip level of a grid of the right size only by luck), and the first point pass, 1 to 3 ms at 3 000 000 particles, would go.
- **`speciesMass` is the atomic mass (u), not `splatMass`.** The share is a share of the atomic mass, as P6b made it; the model hands the reduction the array it already kept for the CPU analysis, by reference.
- **The trigger's timing is now the application's.** The first supernova of the default cloud fires at about 2.75 s with the cloud still wide (rms 45 px, not 28), which is what the application already did: the gentler ejecta and the
  cooldown retuned in A9 on the unpaced timeline were then tested at a cloud 28 px wide. The paced history is the data to retune with, if a later phase touches the ejection.
- **`GpuModel.wantsReadback`/`onReadback` stay** (the protostar uses them); a model with its own reduction does what this one does: issue it in `endFrame()`, read a few texels with `readRenderTargetPixelsAsync`, drop the result when `reset()` ran meanwhile.

## Method

| | |
|---|---|
| Renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)` |
| Browser | HeadlessChrome, ANGLE OpenGL backend, 1024 x 768, `--angle gl` |
| Date | 2026-11-21 |
| Code | `feat/gpu-concentration` on top of `11a7a7a` (A9); `11a7a7a` for the "before" builds |
| GPU state | clocked at 734 MHz (P5) during the campaign of the timing tables, 97 % use reported; shared with another job, every run went through a lock |

    npx vite --port 5209                                           # this code
    git archive 11a7a7a | tar -x -C /tmp/before && ln -s "$PWD/node_modules" /tmp/before/node_modules
    # copy src/lab/scenarios/dustHitches.ts, dustSupernovaHistory.ts and src/lab/config.ts there, list dustHitchScenarios in its src/lab/registry.ts
    (cd /tmp/before && npx vite --port 5210)                       # the code before B4
    node scripts/run-lab.mjs --url http://localhost:5209/particle-simulator/lab.html --query scenarios=dust.concentration,dust.supernova.blast,dust.supernova.infall
    node scripts/run-lab.mjs --url http://localhost:5209/particle-simulator/lab.html --query scenarios=perf.dustConcentration
    # the history, on both builds (the paced one takes 90 s):
    node scripts/run-lab.mjs --url http://localhost:5210/particle-simulator/lab.html --query scenarios=dust.supernova.seeds,dust.supernova.paced
    # timing and hitches: alternate the two servers, one run each, as many pairs as wanted, the order swapped every pair
    node scripts/run-lab.mjs --url http://localhost:5210/particle-simulator/lab.html --query scenarios=perf.dustHitch,perf.dustEarly,perf.dustLate
    node scripts/run-lab.mjs --url http://localhost:5209/particle-simulator/lab.html --query scenarios=perf.dustHitch,perf.dustEarly,perf.dustLate

`dust.supernova.seeds`, `.paced` and `perf.dustHitch` read only the application's public surface, so they run on the build before.
