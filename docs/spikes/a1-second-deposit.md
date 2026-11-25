# Spike A1: a second deposit per cell on the protostar grid

Phase P0c of the improvement plan. Proposal A1 puts the mean molecular weight mu in the temperature
(`T_phys ~ mu_mean x <|v - u|^2>`), which needs, per cell of the 128 x 128 moments grid, sums that
the four channels of the current deposit (m, m vx, m vy, m |v|^2) cannot hold. This spike decides
how to deposit them, ships the deposit and validates it. **Nothing reads the new grid yet and the
physics is unchanged**: the default-cloud baseline of the lab reproduces the recorded one to the
last printed digit (see "Behaviour is unchanged").

## Verdict

**The composition is deposited on a second color attachment of the moments pass** (technique T2: one
draw of the particles, two outputs), not by a separate third pass (T1).

- Per cell it holds `(sum w m (1+Z)/A, sum w, sum w m^2, 0)`: the `m/mu` term, the particle count, the
  sum of the squared masses (for an effective number of particles in A3) and a spare channel. `w` is
  the cloud-in-cell weight, as for every channel of the moments.
- Cost on the lab's GPU (GTX 1060), 400 000 particles, two substeps per frame: **+1.08 ms per
  simulation frame** (median of 108 paired chunks from 9 runs; quartiles 0.78 to 1.47; medians of
  the runs 0.58 to 1.80), that is 19 % of the 5.6 ms the frame costs without it. In the grid passes
  alone it is +1.05 ms per substep at frame 55, before the core forms (53 % of the passes), and
  +0.39 ms at about frame 970, with a dense core (30 %). The extra is real (the composition made the
  frame slower in 105 of the 108 pairs) but a whole-frame measurement is noisy; the grid-pass
  figures are the tight ones.
- It is equal to a CPU reference to 3e-7 (relative) in float32 and to 2.4e-3 in the forced half-float
  path, on a cloud of 20 000 particles with several particles per cell. In float32 it still holds
  with 1 358 particles in one cell (a collapsed core). In half floats a collapsed core loses
  accuracy (5 % of the particles are missing from the sum, cells off by up to 15 %), as the existing
  half-float moments do: see "Correctness".
- The interface P3b consumes is at the end of this document.

T1, a third deposit pass writing its own target, was implemented first (the plan's order of
preference: the simplest) and works. It was dropped for cost only: it runs the whole vertex stage
(400 000 vertices, a position fetch, the per-type tables), the point set-up and the 4 fragments per
particle a second time, and the experiment below shows that this is most of what a second deposit
costs. Should a device ever misbehave with two attachments, T1 is the fallback: a third
`DepositPass` whose shaders write the composition alone (`vValue2`, the same values) to a
single-attachment target of its own, and a `gridComposition` uniform pointing at that target
instead of `moments.textures[1]`. The experiment code (both techniques behind a run-time switch)
is not kept in the history.

## What was built

| | |
|---|---|
| `src/simulation/protostar/composition.ts` | Pure, tested: `atomicNumber(symbol)` (rank in `ELEMENTS` + 1), `inverseMeanMolecularWeight(Z, A)` = (1 + Z)/A, `inverseMolecularWeights(types, 'mass', MAX_SPECIES)`. |
| `src/shaders/protostar-deposit.vert/.frag` | `DEPOSIT_KIND` (moments, power, moments and composition): the moments pass writes the moments to attachment 0 and the composition to attachment 1 (`layout(location = 1) out`). |
| `src/simulation/protostar/grids.ts` | The moments target has two attachments (`gridTarget(res, blendType, 2)`); the uniform array `speciesInverseMu` is shared by reference by the deposit materials and updated in place by `ProtostarGrids.setInverseMolecularWeights()`, which `ProtostarModel.updateSpecies()` calls whenever the types change (the masses are editable). |
| Dev-only, for the lab | `ProtostarGrids.compositionEnabled` (false: the moments pass deposits the moments alone, as it did before, into a target of its own built on first use), `debugGrids`, `debugDepositInputs`, `GpuPipeline.debugPositionTarget`. |
| Lab | Scenarios `protostar.second-deposit`, `protostar.second-deposit-load` and `cost.protostar.second-deposit`; `src/lab/depositReference.ts` (the CPU reference, tested); `readAttachment()` and `readPositions()` in `src/lab/readback.ts`. |

Which mu: a fully ionised element, `1/mu = (1 + Z)/A`: one nucleus and Z electrons for A atomic mass
units. Hydrogen 1.984 (mu = 0.504), helium 0.7495 (mu = 1.334), carbon 12 0.5833: the plan's
mu(He)/mu(H) = 2.65. A is the **current mass of the type** (it is editable in the element editor, in
u); Z is read from the type's symbol in `ELEMENTS` (the first ten elements in order, Z = rank + 1). A
symbol that is not in the table gets Z = A/2 (`PROTONS_PER_NUCLEON`). The deposit mass `m` of a
particle is proportional to A (mean particle mass = 1), so `sum(m/mu) / sum(m)` is the mean `1/mu` in
units of 1/u, whatever the cloud's mass scale. This is the mass-weighted mean of `(1 + Z)/A`, hence
the number of free particles (nuclei and electrons) per atomic mass unit of gas.

## Evidence

### The two techniques, side by side

An experiment build held both in one binary, selected at run time (`off`, `pass` = T1, `mrt` = T2),
with a lab scenario timing the three alternated in all six orders. A check in the same build showed
that attachment 0 of T2 equals the moments pass and attachment 1 the separate pass of T1, with a
difference of exactly 0.

Median of the extra cost over the runs, with the spread (min to max over the runs) in brackets; each
run is one fresh page with 12 rounds of each mode, 10 clean runs (two more runs, with a second
browser drawing on the GPU, were discarded):

| Extra cost | Without | T1 (third pass) | T2 (two attachments) | T2 - T1, paired |
|---|---|---|---|---|
| Simulation frame (ms, 2 substeps) | 6.50 | +1.23 (1.01 to 1.73) | **+0.75** (0.33 to 1.60) | median -0.54, T2 cheaper in 9/10 runs |
| Grid passes, early cloud (ms per substep) | 2.59 | +0.86 (0.72 to 1.28) | +0.66 (0.24 to 1.27) | -0.37, 8/10 |
| Grid passes, late cloud (ms per substep) | 1.59 | +0.47 (0.36 to 0.72) | +0.14 (-0.01 to 0.71) | -0.34, 9/10 |

### The shipped technique, measured alone

The shipped code, with and without the second attachment (`ProtostarGrids.compositionEnabled`),
the two alternated chunk after chunk in one page, 9 fresh pages (runs) of 12 rounds, each round a
chunk of 30 frames per mode in swapped order; none discarded. Without = the moments pass alone, the
code of the baseline. The early grid-pass state is exactly frame 55 of the seeded cloud, the late one
frame 955 to 985 (the runs differ by one warm-up chunk), the timed whole frames run from about frame
250 to about frame 970 (the rebound after the first collapse, then the dense core).

| 400 000 particles | Without | Extra with the composition | Over without | Pairs where with > without |
|---|---|---|---|---|
| Simulation frame (ms, 2 substeps) | 5.58 (runs: 5.38 to 6.61) | **+1.08** (quartiles 0.78 to 1.47; run medians 0.58 to 1.80; extremes -0.55 and +3.38) | 19 % | 105 / 108 |
| Grid passes, frame 55, before the core forms (ms per substep) | 2.00 (1.91 to 2.59) | **+1.05** (quartiles 0.97 to 1.25; run medians 0.93 to 1.52) | 53 % | 108 / 108 |
| Grid passes, about frame 970, dense core (ms per substep) | 1.28 (1.17 to 1.70) | **+0.39** (quartiles 0.31 to 0.54; run medians 0.12 to 0.77) | 30 % | 108 / 108 |

Reading:

- The extra is the deposit's: the second attachment is the only thing that changed in the passes. It
  is largest before the core forms, when the 400 000 particles spread over many cells, and falls to
  a third once they pile up in a few cells. The likely reason, not isolated here, is that the
  second blended RGBA32F target adds 16 bytes of read-modify-write per fragment, which counts
  while fragments are spread out, whereas the serialization of the blending of many particles into
  one cell dominates in a dense core whichever targets there are.
- The whole-frame figure is noisy: its 30-frame chunks move by 0.5 ms with the clocks and with the
  cloud, so single pairs go from -0.55 to +3.38 ms and the runs' medians from 0.58 to 1.80. It
  averages the evolution of the cloud: two substeps of the late grid cost (0.78) and of the early
  one (2.10) bracket it. Run 4 had a slower baseline than the others (6.61 ms, and 2.59 ms for the
  early passes against 1.9 to 2.0), probably contention; without it the medians are +0.98 ms,
  +1.07 and +0.35, so it was kept.
- An earlier batch of 8 runs of the same code, whose early state came from a warm-up duration
  rather than from a frame count (the scenario was corrected afterwards), gave +0.97 ms per frame
  (quartiles 0.47 to 1.49; run medians 0.41 to 1.52; 6.24 ms without it). The experiment's T2 gave
  +0.75 (0.33 to 1.60). Over the three batches: about **+1 ms per frame, 15 to 20 %**. The advantage of
  T2 over T1 rests on the paired comparison of the experiment; the shipped technique has not been
  timed against T1 again.
- For scale: the simulation without the composition is 5.6 ms per frame at 400 000 particles on this
  machine, so the budget of 16.7 ms per frame is not threatened; but the recorded `perf` table of
  [lab-baseline.md](../lab-baseline.md) (20.2 ms, where `perf.protostar.400k` now reads 8.2 to 8.6 ms
  with the composition on) was measured with the GPU in another state.

### Correctness

`protostar.second-deposit` (20 000 particles, hydrogen, helium and carbon at 60 / 30 / 10 %, 6
frames: 4 541 occupied cells, 4.4 particles per occupied cell on average, the busiest cell has a
weight of 11.8) and `protostar.second-deposit-load` (400 000 particles, 100 frames: 3 078 occupied
cells, 1 358 in the busiest). The GPU grid is read back (`readAttachment`) and compared, cell by
cell and channel by channel, with a CPU deposit of the positions read from the position texture,
within a tolerance computed from the unit roundoff of the path (float32 or half float), the number
of contributions of the cell and the error of the cloud-in-cell weight itself
(`src/lab/depositReference.ts`). Figures are "worst error over tolerance" (must be at most 1) and
the maximum relative error of any cell.

| Cloud | Path | Worst error / tolerance | Max relative error | Sum of the count channel (GPU / CPU) | Mean 1/mu, worst cell / 3x3 |
|---|---|---|---|---|---|
| 20 000, 6 frames | float32 | 0.0023 | 3.1e-7 | 20 000 / 20 000 | 3.1e-7 / 1.5e-7 |
| 20 000, 6 frames | half float (forced) | 0.456 | 2.4e-3 | 19 993 / 20 000 | 2.7e-3 / 1.0e-3 |
| 400 000, 100 frames | float32 | 0.0045 | 2.3e-6 | 383 617.01 / 383 617 | 3.1e-6 / 1.2e-6 |
| 400 000, 100 frames | half float (forced) | 0.47 (not judged) | 0.149 (count) | 373 553 / 392 885 (95.1 %) | 4.3e-2 / 3.5e-2 |

- The spare channel is exactly 0 everywhere. The same scenarios pass on SwiftShader (float32 0.0021,
  half float 0.21).
- The ratio the gas pass will compute, the mean 1/mu = (channel x of the composition) / (channel x
  of the moments), is checked on cells with at least one mean particle mass and on 3 x 3 sums.
- **Half floats under load are not accurate.** On a GPU without `EXT_float_blend` (the 16-bit path
  of the moments, already in the application) the sums stagnate once a cell holds some hundreds of
  contributions: a half float has an 11-bit mantissa, and adding a contribution smaller than half a
  unit in the last place of the running sum loses it. At 400 000 particles that loses 5 % of the
  count and up to 15 % of it in a cell, and the ratio of the two sums, the mean 1/mu, is off by 4 %
  per cell and 3.5 % over 3 x 3 (the moments in the denominator are half floats too). The
  half-float moments have the same flaw; it is not new. P3b should use the 3 x 3 sums, and not a
  per-cell count or effective number, where the cloud is dense and the device lacks float
  blending.

### Behaviour is unchanged

The default-cloud baseline of the lab (`baseline.protostar.default-cloud`: 400 000 particles, seed
20240611, 1200 frames) and `lab.selftest` were run back to back on the same GPU on this branch and on
the commit it comes from (`a83a556`, extracted to a directory of its own and served by a second
development server). The two JSON results are identical on all 428 values (all 60 readings of the
4 series, peaks, final composition, `depositedMassOverCount`, the replay and read-back checks of the
self-test), once the wall-clock durations are left out. They also reproduce every row of the table of
[lab-baseline.md](../lab-baseline.md) at its printed precision (core T 3.2, 5.1, 30.7, 15.7, 51.5,
57.7, 58.6, 58.7, 55.1 MK; peak density 1.1 to 109.0 rho0; final fusion rate 2 810 per second; 93 345 H,
75 491 He, 407 C; peak 91.682 MK; deposited mass 0.99503).

## Method

- All timings are the lab's synchronized simulation-only figures (`Simulation.step()` + `endFrame()`, the
  GPU waited for at the end of every chunk of 30 frames); the animation-frame intervals mean nothing in
  headless Chrome (docs/lab.md).
- Inside a run, the modes alternate chunk after chunk in changing orders, so that the drift of the
  clocks and of the cloud (the core forms, particles are absorbed: the frame goes from about 7 to 5 ms
  over the run) hits all of them alike; the difference is taken between the chunks of the same round. A run
  is a fresh headless page with a warm-up of at least 1.5 s.
- Between runs the figures move by more than within a run: one run is not a measurement, hence 9 runs
  and the pooled pairs. The GPU is shared with other work on the machine: every run went through a
  `flock` on a lock file that the other users of the GPU also take, so no two lab runs overlapped,
  and no run was discarded. (In the experiment, two runs during which another browser drew on the
  GPU were discarded.)
- The "grid passes only" figures repeat the grid update (`beforeSubstep(0)`) on a frozen cloud (40
  substeps per chunk, after a warm-up of 1.5 s on that state), early (exactly frame 55, before the
  collapse at about frame 80) and late (frame 955 to 985, a dense core and absorbed particles). The
  scenario records the frame numbers (`framesAtEarlyCloud`, `framesAtFirstTimedChunk`,
  `framesAtLateCloud`).
- The figures to quote are medians of the paired differences (the same round, the two modes), with
  quartiles and the spread of the runs' medians; a mean would be driven by the extremes.

## Pitfalls found

- **Only attachment 0 of a render target can be read back** in three r169
  (`readRenderTargetPixels` has no attachment index). `readAttachment()` (lab) copies an attachment by
  a pass into a single-attachment target of the same type and reads that. The application never reads
  the composition on the CPU.
- **Blending is one state for the whole draw.** WebGL2 has no per-attachment blend state, so both
  attachments blend additively. A float32 attachment can only be blended with `EXT_float_blend`, so
  the two attachments have the same type: float32 where the extension exists, half float otherwise
  (`gridTarget(res, blendType, 2)`).
- **The fragment shader declares the second output itself**: `layout(location = 1) out highp vec4`
  in the `ShaderMaterial` source works next to `gl_FragColor` (three declares `pc_fragColor` at
  location 0 and defines `gl_FragColor` as it, and leaves the explicit declaration alone). The
  fourth channel is written as 0, not left undefined, so that a read back is exactly 0.
- **The channels are linear in the cloud-in-cell weight**, like the moments, and the four weights of
  a particle add up to 1. So the total over the grid of the count channel is the number of
  deposited particles and of the `m^2` channel the sum of the squared masses (checked above), and
  any ratio of two channels summed over a neighborhood is a weighted mean with the same weights.
  The part of a footprint that leaves the grid is clipped.
- **A is the type's current mass and Z comes from the symbol.** Editing the mass in the element
  editor changes 1/mu: `updateSpecies()` refreshes the uniform array in place (it must stay the same
  array, shared by reference with the deposit materials). An unknown symbol gets Z = A/2, and a type
  of mass 0 gets a factor of 0: a cell holding only such particles has composition x = 0 while its
  mass x is not, so a consumer must test `c.x > 0` before dividing.
- **`compositionEnabled = false` leaves the composition stale.** It exists for the cost comparison
  only. Once a pass reads the composition, the switch changes the physics of the "without" mode and
  the cost scenario has to be redefined (for instance by making the consumer read a constant mu).
- **Do not add a texture to the velocity pass.** It samples 8 textures already (positions,
  velocities, acceleration, gravity, gas, heat and the two drawing fields). The composition is for
  the gas pass, which already has the moments, and reaches the particles through the gas grid.
- **Timing a whole frame needs many pairs.** 30-frame chunks of the simulation move by 0.5 ms with
  the clocks and the cloud; a run of 12 rounds gave anything from +0.6 to +1.8 ms. Use the grid
  passes on a frozen cloud when a tight number is needed.

## The interface P3b consumes

- **Target**: `ProtostarGrids.moments` (`ProtostarGridTargets.moments`), a `WebGLRenderTarget` with two
  attachments. The composition is **`moments.textures[1]`** (`moments.texture` is attachment 0, the
  moments). It is a 128 x 128 `RGBAFormat` texture, float32 or half float with the moments, nearest
  filtering, redrawn at the start of every substep by `ProtostarGrids.render()` together with the
  moments.
- **Channels**, per cell, the cloud-in-cell sums over the particles (weight `w` = the four bilinear
  weights of a particle, adding up to 1):

  | | Content | Unit |
  |---|---|---|
  | x | `sum w m (1+Z)/A` | deposit mass per u (m in mean particle masses) |
  | y | `sum w` | particles |
  | z | `sum w m^2` | deposit mass squared |
  | w | 0, spare | |

  The first channel of the moments (`gridMoments.x`) is `sum w m`, so `1/mu_mean = c.x / s.x` is in
  1/u, `mu_mean = s.x / c.x` in u.
- **Per-type factor**: the uniform array `speciesInverseMu` (`MAX_SPECIES` floats, 1/u, `(1+Z)/A` of
  each type) in `ProtostarGrids.u`, shared by reference with the deposit materials, written by
  `ProtostarGrids.setInverseMolecularWeights()` from `ProtostarModel.updateSpecies()`. It is the
  only place where mu comes from. If P3b wants a mu that depends on the temperature (partial
  ionisation), the deposit cannot know it (it runs before the gas pass): deposit the neutral and the
  ionised parts, or correct the ratio in the gas pass.
- **Reading it in the gas shader** (`src/shaders/protostar-gas.frag`), in the loop that already sums
  the 3 x 3 neighborhood of the moments:

  1. In `grids.ts`, add to the uniforms of the gas `GridPass`
     `gridComposition: { value: this.moments.target.textures[1] }` (a texture of the target that
     already exists; unlike `gridMoments`, which goes through `momentsTexture` for the lab's switch,
     nothing reassigns it).
  2. In the shader, declare `uniform sampler2D gridComposition;` and sum it with the moments:

     ```glsl
     vec4 s = vec4(0.0), c = vec4(0.0);
     // in the 3 x 3 loop, next to s += texelFetch(gridMoments, cell, 0):
     c += texelFetch(gridComposition, cell, 0);
     // after it:
     // Illustration, the constants and the exact use are P3b's and A3's:
     float inverseMu = c.x > 0.0 ? c.x / s.x : FALLBACK_INVERSE_MU;   // mean 1/mu of the neighborhood, per u
     float mu = 1.0 / inverseMu;
     float temperature = mu * t;                                      // t: the velocity dispersion already computed
     float particles = c.y;                                           // CIC-weighted count of the neighborhood
     float effective = s.x * s.x / c.z;                               // (sum m)^2 / sum m^2
     ```

  The out-of-grid test and the `s.x <= 0` early return stay as they are.
- **Does not change**: the moments channels, the gas pass output layout, the order of the passes
  (the composition is deposited with the moments, before the gas pass). The lab's validation
  (`protostar.second-deposit*`) keeps checking the deposit whatever consumes it.

## Reproducing

The development server serves the lab; run the scenarios in headless Chrome (docs/lab.md). On a
shared GPU, serialize every run with `flock` on a common lock file, and check first that no headless
Chrome is left over (`pgrep -fa -- --headless`).

    npx vite --port 5201 &
    LAB=http://localhost:5201/particle-simulator/lab.html

    # Correctness (float32 and forced half float; 20 s)
    node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.second-deposit,protostar.second-deposit-load" --out validation.json
    node scripts/run-lab.mjs --angle swiftshader --url $LAB --query "scenarios=protostar.second-deposit"

    # Cost: one fresh page per run, at least 8 runs (17 s each)
    for i in 1 2 3 4 5 6 7 8 9; do
        flock /tmp/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=cost.protostar.second-deposit" --out cost-$i.json
    done

    # Behaviour unchanged: the same on the commit before the branch, in a directory of its own
    node scripts/run-lab.mjs --url $LAB --query "scenarios=baseline.protostar.default-cloud,lab.selftest" --out baseline-new.json
    git archive a83a556 | tar -x -C /tmp/base && ln -s $PWD/node_modules /tmp/base/node_modules
    (cd /tmp/base && npx vite --port 5206 &)
    node scripts/run-lab.mjs --url http://localhost:5206/particle-simulator/lab.html --query "scenarios=baseline.protostar.default-cloud,lab.selftest" --out baseline-old.json
    # then compare the two JSON files, leaving out the wall-clock fields (wallSeconds, durationMs)

The cost figures are the `simulationFrames`, `gridPassesEarlyCloud` and `gridPassesLateCloud`
entries of each result: pool their `differencesPerRound` over the runs for the median and the
quartiles, and take the median of each run's `medianDifference` for the spread between runs.
