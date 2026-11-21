# The lab

A development-only page that runs acceptance scenarios on the real GPU simulation and publishes
the results as a table and as JSON. It exists because the physics lives in shaders, which the unit
tests (Vitest, in Node) cannot run. It is never part of the application: `vite.config.ts` has no
`input`, so `make build` ignores `lab.html`, and `make check-dist` (run by `make build` and by CI)
fails if anything of the lab reaches `dist/`.

## Running it

In a browser, with the development server (`make dev`):

    http://localhost:5173/particle-simulator/lab.html

The scenarios start by themselves; the table fills in as they finish. Query string:

| Parameter | Effect |
|---|---|
| `scenarios=a,b` | Only these: ids, groups (`baseline` selects `baseline.*`) or tags (`fast`, `slow`, `perf`...). |
| `autorun=0` | Wait for the Run button. |
| `baselineFrames=`, `baselineParticles=`, `perfFrames=` | Shorter or longer runs, for experiments. |
| `noiseReadings=`, `noiseBudgetSeconds=` | The most gases drawn, and the seconds, per case of `protostar.temperature-noise` (900 and 150). |
| `cloudVariants=`, `cloudSeeds=` | The variants (a URL-encoded JSON array, see below) and the number of seeds (3) of `baseline.protostar.default-cloud-tuning`. |

From the console, `await __lab.run('lab,baseline')` starts a run.

For an agent or a script, `window.__labDone` becomes `true` when the run is over and
`window.__labResults` then holds the JSON (it is also printed in `<pre id="lab-json">`):

    {
      "renderer": "<UNMASKED_RENDERER string>", "software": false, "floatBlend": true,
      "userAgent": "...", "startedAt": "...", "totalMs": 123456,
      "scenarios": [
        { "id": "lab.selftest", "title": "...", "status": "pass" | "fail" | "skip" | "known-failure",
          "metrics": { ... }, "details": "...", "durationMs": 1269 }
      ]
    }

Non-finite numbers appear as the strings `"NaN"`, `"Infinity"`. `pass` means the scenario ran and
its checks, if it has any, held; most baseline scenarios record numbers and judge nothing.
`skip` always says why in `details`. `known-failure` means a check missed its target and the miss is
documented: `details` names the phase that fixes it, and the run does not fail on it (exit code 0).

Headless, with the development server running (`npx vite --port 5173`), a Chrome or Chromium
installed and nothing else (Node's own `fetch` and `WebSocket`):

    node scripts/run-lab.mjs --query "scenarios=lab,baseline" --out results.json
    node scripts/run-lab.mjs --angle swiftshader            # a software rasterizer (timings invalid)

`--angle` is the ANGLE backend (`gl` by default, `vulkan`, `swiftshader`, `default`), `--chrome`
(or `LAB_CHROME`) the browser, `--url` the page. It prints the JSON (or writes `--out`) and one
line per scenario on stderr; the exit code is 1 when a scenario failed and 2 when the lab could
not run. Set `LAB_NO_SANDBOX=1` where Chrome refuses to start without `--no-sandbox` (containers).

## What is in it

| Id | What it does |
|---|---|
| `lab.selftest` | The infrastructure: seeded random numbers, slider bypass, grid read-back, bit-for-bit replay of a run. |
| `protostar.half-float-deposit` | The deposit grids in half floats (the path of the GPUs without `EXT_float_blend`) against float32. |
| `protostar.second-deposit` | The composition deposit (second attachment of the moments pass: m/mu, count, m^2) against a CPU reference computed from the position texture, in float32 and in the forced half-float path ([spike](spikes/a1-second-deposit.md)). |
| `protostar.second-deposit-load` | The same on the 400 000-particle cloud once its core has formed (thousands of particles in a cell); the half-float path is measured, not judged. |
| `protostar.molecular-weight` | The mean molecular weight in the temperature (A1): thermal gases of pure hydrogen, pure helium and a mixture with the same particles at the same places with the same velocities. The helium gas must read mu_He / mu_H = 2.65 times the temperature of the hydrogen gas, the mixture in between (its factor, cell by cell, against a CPU deposit of its particles), pure hydrogen unchanged, the dispersion (the energy) not touched, and the core temperature of the stats must be the temperature, not the dispersion; then the same with the deposit forced to half floats (the factors judged to 6 %, they come out within 1.3 %). [Spike](spikes/a1-mean-molecular-weight.md). |
| `protostar.ignition-gas` | The ignition temperatures on pure thermal gases (A1): a hydrogen gas and a helium gas of 1 000 000 particles at 20 rho0, drawn at ten temperatures each, gravity, cooling and feedback off. The mean fusion rate of the particles against the temperature of the gas, compared with the rate laws' twin; the temperature at which each gas reaches a few reference rates and the ratio He/H, in temperature and in dispersion. |
| `baseline.protostar.ignition-ratio` | Ignition temperatures of H and He from the current rate laws, and their ratio, in temperature and in velocity dispersion (pure TypeScript). |
| `baseline.protostar.default-cloud` | The default cloud: core temperature, peak density, fusion rate and omega.dt in the core over time. |
| `protostar.energy-reference` | The energy diagnostics (A7) against a CPU reference computed from a read-back of the positions and velocities of a 5 000-particle cloud: K against the direct sum, U against a CPU twin of the two-level grid scheme and against the direct O(N^2) Plummer sum, the grid gravity (force and potential) against the twin, and the potential kept from the previous substep. |
| `protostar.reduction-channels` | Every channel of the multichannel reduction (peak, extremes, energies, center of mass, momentum) against a CPU sum of the grids read back, and the exact ones against sums over the particles; reports how good the speed bound is. |
| `baseline.protostar.energy-drift` | K + U of a conservative run (cooling, feedback and fusion forced to 0 below the sliders' minima) over 100 orbits, for the default cloud and for a cold cloud on circular orbits; drift, slope and oscillation, with the plan's 1 % criterion, judged on the default cloud's largest drift (`fail` above it, `skip` if the wall-clock budget stops the run before 100 orbits). It was a `known-failure` until phase P5a, which found and removed the first-order error ([spike](spikes/p5a-integrator-order.md)). |
| `baseline.protostar.energy-drift-attribution` | Where that energy goes: the same run of the default cloud for 12 orbits with the time step divided by 1, 2 and 4, and with the walls as they are (they return half of the speed) and elastic. With the scheme of phase P5a the secular rate is 0 at every step. |
| `protostar.integration` | The velocity and position passes against the CPU twin of the integration (`src/simulation/protostar/leapfrog.ts`): 20 000 particles of a gas that fills the area, a substep at a time, each step compared with the twin fed with the acceleration the GPU's own acceleration pass stored. Hundreds of the particles bounce on the walls; the first step owes no half kick. Worst error 1e-4 px and 1e-4 px/s. |
| `protostar.heating` | The fusion heating by velocity scaling (A5) on gases of known temperature, gravity and cooling off, one substep: blobs of 200 particles exactly at the center of isolated cells (each reads its cell alone: the energy gained is `q dt` per particle to rounding, the momentum does not move, cold blobs get the kick of the cold cells), and a uniform gas of 400 000 and 1 600 000 particles with the real interpolation, against the random kick it replaces (the same gas with the kick forced). [Spike](spikes/a5-a3-heating-and-t-noise.md). |
| `protostar.temperature-noise` | The noise of the temperature (A3): the mean fusion rate of a thermal gas of dispersion T_ref against the true rate, for 100 to 6 400 particles per 3 x 3 neighborhood and the real exponents 4 and 40, with the bias correction switched off (the bias the plan predicts) and on, the gas drawn again for each reading until the standard error is small. Also fits the effective number of particles from the uncorrected bias. Slow (5 minutes: the cases of few particles at alpha = 40 need hundreds of readings). |
| `protostar.temperature-smoothing` | What the exponential average of T over time buys: the noise of T from cell to cell of a gas that moves, instantaneous and averaged, for several time constants, and the autocorrelation of T. |
| `baseline.protostar.default-cloud-tuning` | The default cloud under the variants of the `cloudVariants` option, each with `cloudSeeds` seeds, with the whole series (core temperature, density, fusion rate, particles of each type): `[{"name":"A1 off","molecularWeight":false},{"name":"G 8","overrides":{"gravity":8,"fusionRate":0.004},"frames":600}]`. `molecularWeight: false` is the temperature of the code before A1 (the dispersion), `overrides` set protostar parameters directly (below the sliders' minima too), `kick`, `uncorrected` and `tau` the switches of P3a. A tool for tuning the defaults; skips with no variant. |
| `baseline.protostar.default-cloud-variants` | The default cloud with the parts of phase P3a switched on one by one (the kick instead of the scaling, no correction, no average, several time constants), three seeds each; the first variant is the physics before P3a. Slow (4 minutes). |
| `dust.gravity.parity` | The sticky dust's per-texel gravity against the per-particle loop it replaced (the yardstick kept in `src/lab/gravityProbe.ts`), at the particles of a clumped cloud; also against the original central-difference loop. |
| `dust.gravity.point-mass` | The pull of a point mass on rings around it against the angle: anisotropy of the central difference, of Scharr's stencil and of the stencil in use ([spikes/b1-dust-gravity.md](spikes/b1-dust-gravity.md)). |
| `dust.default-cloud` | The default sticky dust cloud forming its clumps: every 10 frames the density grid is read and the share of the mass in dense texels (at or above `REST_DENSITY`), the peak density, the number of clumps and the heaviest one are recorded; the time to reach a few shares and the time of the first supernova summarize it. The scenario that compares the builds before and after a change of the dust's physics. |
| `dust.recalibration` | The same cloud under the original stencil of the coarse gravity and under the isotropic one with a few gains on the pull (`DUST_GRAVITY_GAIN`): which gain restores the timeline of the original ([spikes/a10-granular-dust.md](spikes/a10-granular-dust.md)). |
| `dust.deposit` | The sticky dust's density grid (mass, momentum, agitation energy in the alpha channel) against a CPU reference computed from the positions and velocities read back: judged on a sparse cloud against the tolerance model of a half-float deposit, measured on the default cloud once its clumps have formed; the agitation T the velocity pass derives from the grid against the exact variance of the particles in each texel, with the energy deposited about a reference velocity and about zero ([spikes/a10-granular-dust.md](spikes/a10-granular-dust.md)). |
| `dust.haff` | Free cooling of a uniform cloud of grains (no gravity, no pressure, no drag, elastic walls): `T^(-1/2)` must grow linearly with time, `T = T0 / (1 + t / t0)^2` (Haff's law); fit on the density grid and on the particles read back, slope against the sticking rate times the density the particles feel. |
| `dust.granular-sweep` | The default cloud under other stickiness, kinetic pressure and collision speed (tuning of the defaults). |
| `dust.concentration.parity` | The sticky dust's GPU search of the densest disk (`ConcentrationReduction`) against its CPU reference (`analyzeConcentration`) on the same particles: clouds built to be hard (a clump at the corner or on the far edge of the area, two clumps of the same mass, a collapsed clump of 3 px, a ring), several radii, and the default cloud at five stages of its collapse, 400 000 particles. Judged: the center within one cell of the coarse grid, the share of the total mass within 2 points; reports the difference of the centers, shares, rms radii and member counts ([spike](spikes/b4-gpu-concentration.md)). |
| `dust.concentration.parity-heavy` | The same at 3 000 000 particles (a million particles in a few texels of float32 sums). Slow. |
| `dust.supernova.blast` | A supernova in a cold uniform cloud (a disc of the detection zone's radius holding half of the particles, the rest uniform; no gravity, pressure, sticking or drag): the ejecta's speed against their distance to the center, species by species (slope against the formula, R^2, intercept, heavier species slower), and the radius of the shock front against time (R^2 linear in t, best exponent of the free fit `R^q = a + b t`, error against a front at constant speed), the kicks against the formula ([spike](spikes/a9-coherent-supernova.md)). |
| `dust.supernova.infall` | The same cloud ejected with and without gravity from the instant of the ejection, at the highest and the lowest power: the ejecta are slowed during the ejection timer (gravity acts on them), the same for every species in a radial bin (equivalence principle), and at the lowest power they fall back to the center. |
| `dust.supernova.history` | The default cloud for 30 s: when its supernovae fire, what triggers them (the concentration meter, the share of the mass within a few radii of the center), and what becomes of the ejecta (mean distance in zones and share still inside the zone after 0.5 to 8 s). Reads only the application's public surface, so it also runs on a build from before a change of the supernova. |
| `dust.supernova.sweep` | The same history for several ejection speeds, three clouds (seeds) each: the data that tuned `SUPERNOVA_SPEED` and `SUPERNOVA_COOLDOWN` (the history is chaotic: one run says little). |
| `dust.supernova.seeds` | The same history at the default power for three clouds (seeds): the times and the count of the supernovae, the check that a change of the trigger left them where they were ([spikes/b4-gpu-concentration.md](spikes/b4-gpu-concentration.md)). |
| `dust.supernova.paced` | The same, one frame per animation frame (20 s of wall time a cloud): the application's pace. The loop of the other scenarios yields to the event loop only every 10 frames, which delays the asynchronous read of the old trigger (6 MB at 400 000 particles) by up to ten frames and the two texels of the GPU's less: the first supernova of the default cloud fires at frame 121 or 131 there and at 111 or 121 with the GPU search, whereas at the application's pace both fire at about frame 110. |
| `perf.<algorithm>.<count>` | ms per frame of protostar (400 000 and 1 000 000 particles) and sticky dust (400 000, 1 000 000 and 3 000 000). |
| `perf.dustEarly.<count>`, `perf.dustLate.<count>` | The sticky dust's simulation ms/frame at 400 000 and 1 000 000 particles in two windows of the default cloud's life: frames 10 to 50 after a restart (the donut has barely collapsed: the same load in every build) and frames 150 to 190 (after the first supernova, clumps forming again); median of 20 chunks of 10 frames over 5 restarts. The performance probe above times whatever follows a warm-up of 1.5 s of wall time, hundreds of frames at these speeds, so its window is late and depends on the build (a less crushed clump is cheaper to deposit and to draw, a second supernova costs a read-back): for comparing two builds of the physics, use these. |
| `perf.dustHitch.<count>` | The sticky dust's frame times over its periodic concentration read at 400 000, 1 000 000 and 3 000 000 particles: 360 frames of the default cloud with no supernova (the read repeats every 12 frames), each followed by a wait for the GPU, the time between the starts of two frames; median, p95, p99 and worst, for all the frames, the frames of a read and the quiet ones. It reads only the public surface, so it runs on the build before the GPU search too ([spike](spikes/b4-gpu-concentration.md)). |
| `perf.dustConcentration.<count>` | What one GPU search of the densest disk costs at 400 000, 1 000 000 and 3 000 000 particles: ten searches queued back to back on the same particles, the GPU waited for at the end (the GPU time of one, not the latency of the read-back), on a uniform cloud, on a clump of 3 px and on the default cloud after 150 frames of its collapse ([spike](spikes/b4-gpu-concentration.md)). |
| `cost.protostar.second-deposit` | Simulation ms/frame at 400 000 particles with and without the composition on the moments pass, the two alternated chunk after chunk in one run, and the grid passes alone on a frozen early (frame 55) and late (about frame 970) cloud; the frame numbers are in the metrics. One run is not a measurement: repeat it (see the spike). |
| `cost.protostar.diagnostics` | Simulation ms/frame at 400 000 particles with the gravity pass without its potential channel (as before the energy diagnostics), with it and the flag off, and with the flag on (the default), alternated chunk after chunk in all six orders; the gravity and the other grid passes alone on a frozen early and late cloud; and the cost of one call of the reduction and of the potential stash. The data that decides the default of `diagnostics`. |

The recorded numbers are in [lab-baseline.md](lab-baseline.md).

## Adding a scenario

1. Write a `Scenario` (`src/lab/types.ts`) in `src/lab/scenarios/`: an `id` (dotted; a prefix up to
   a dot selects the group), a `title`, `tags`, and `run(context)` returning
   `{ status, metrics, details }`. An exception thrown by `run` is reported as a failure.
2. List it in `src/lab/registry.ts`.
3. Put pure logic (formulas, reductions) in a module with no GPU or DOM import and test it in
   `tests/`: that is where the TypeScript twins of the shader formulas are checked, the scenario
   only runs the GPU side. Tuning constants of the lab go in `src/lab/config.ts`.

The tools a scenario gets (`src/lab/driver.ts`, `readback.ts`):

- `context.simulation` is the real `Simulation`, already resized. `restart(context, { algorithm,
  count, overrides, seed })` restarts it the way the Start button does: default parameters and
  speed, seeded cloud.
- **Slider bypass.** `overrides` sets protostar parameters directly on the GPU model, below the
  sliders' minima (gravity 0.1, feedback 0.01...): `{ gravity: 0, feedback: 0 }` for a
  conservative run. `Simulation.reset()` hands the model the slider-validated values back, so
  `restart` sets them before (the initial cloud reads the gravity) and after the reset.
  `weights: [0.6, 0.3, 0.1]` sets the population weights of the first types for that restart (a
  cloud of hydrogen, helium and carbon instead of hydrogen alone). `params: { rotation: 1,
  agitation: 0 }` sets panel parameters through the `Simulation` (so within the sliders' ranges)
  before the restart: the initial conditions.
- **Half-float deposit.** `forceHalfFloatDeposit(true)` (`src/simulation/protostar/grids.ts`)
  makes the grids created from then on deposit in half floats; `rebuildPipeline(context)` creates
  them again, and `restart` must follow. The runner switches it off after every scenario.
- **Grids.** `protostarGrids(context)` gives the render targets of the grid passes (`moments`,
  `gas`, `power`, `heat`, `coarse`, `gravity`, `reduce1`, `reduce2`), `readTarget(renderer,
  target)` reads one back as RGBA floats (half floats decoded), row by row from the bottom.
  `moments` has two attachments: `readTarget` reads attachment 0 (m, m v, m |v|^2), `readAttachment(
  renderer, target, 1)` the composition. `gas` has two as well (rho, T, mean v; then the temperature
  averaged over time and the effective number of particles); two targets take turns from one substep
  to the next and `protostarGrids()` gives the latest drawn, so read right after stepping. `readPositions()` reads the first particles of the position
  texture (`readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, n)` the
  velocities), and `referenceDeposit()` (`depositReference.ts`) deposits them again on the CPU.
  `energyReference.ts` holds the other CPU references: the direct energies, the twin of the grid
  gravity and of the reduction, and the statistics of an energy series.
  `protostarModel(context).debugGrids.compositionEnabled = false` makes the moments pass deposit the
  moments alone, as it did before the composition (for the cost comparison only).
- **The reduction.** `protostarModel(context).reduction` (and `energy`, `maxSpeed`, `centerOfMass`...)
  hold the latest reading of the model's reduction, which `model.endFrame()` starts every 10 frames
  (and at the first); `await model.debugReading` waits for the one in flight. Call `model.endFrame()`
  rather than `Simulation.endFrame()` when only the reduction is wanted: the latter also reads the
  positions back, whose drift correction kicks the particles. `model.debugReductionScales` gives the
  scales that turn the raw sums into simulation units, and `debugGrids.reduceStats()` /
  `stashPotential()` run the passes by hand (`unpackReduction()`, `src/simulation/protostar/reduction.ts`,
  reads the texels back).
- **The sticky dust.** `stickyDustModel(context)` gives the model, `.debugDensity` its density field (`target`,
  `debugReferenceTarget`, `referenceEnabled = false` deposits the energy about zero, `render()` deposits the
  state as it now stands), `.velocityUniforms` the uniforms of its velocity pass (set `kGravity`, `kPressure`,
  `kineticPressure`, `globalDrag`, `restitution`, `stickRate`, `collisionSpeed` directly, below the sliders'
  ranges; restore the ones the sliders do not own afterwards), `.debugUseCornerWeight()` the stencil of the
  coarse gravity. `.debugMeasure(onGpu, positions?)` runs the concentration search on the GPU or, from the positions read back, on the CPU reference (`analyzeConcentration`) without arming a supernova, and `.debugForceCpu(true)`
  makes the model read the positions back and analyse them on the CPU, as a device without float32 blending does. `simulation.debugPipeline.debugSetState(positions, velocities)` overwrites the state of the
  particles (after a `restart()` that made their count and types), `debugVelocityTarget` reads them back with
  `readPositions()`. `dustDeposit.ts` is the CPU reference of the dust's deposit, `haffFit.ts` the fit of Haff's law.
- **Gases of known temperature.** `protostarModel(context).debugInitialState = state => ...` replaces the
  initial cloud of the next restart (no initial acceleration): `fillThermalGas()` (a uniform gas of
  Maxwellian velocities in a box, of any types: `typeOf`, with the population weights of `restart` to match) and `fillBlobs()` (groups of particles exactly at the center of a
  cell, with standardized velocities, which read one cell's gas state alone) in `src/lab/thermalGas.ts`,
  the CPU twin of what a particle reads in `heatingReference.ts`; set it to `null` after the restart.
  `model.debugGrids.temperatureTau` (time constant of the average of T, 0: none),
  `model.debugGrids.common.noiseCorrection.value` (0: the fusion rate is not divided by the bias of the
  noise of T), `model.velocityUniforms.heatingTFloor.value` (a huge value: the random kick for every
  particle) and `model.debugGrids.molecularWeightEnabled = false` (the temperature is the dispersion, as before A1)
  switch parts of the physics of P3a and P3b off; a restart gives them their values back. `boxForDensity()`
  (`src/lab/ignitionScan.ts`) gives the square that holds all the mass at a given density, the densest uniform gas.
- `runFrames(context, n, { endFrame, onFrame, step })` steps the simulation and synchronizes with
  the GPU every few frames; `GpuSync` (`context.sync`) waits for the GPU on demand.

## Caveats

- **Software renderers.** Under SwiftShader or llvmpipe (`software: true`) the timings mean
  nothing: the performance probe runs a couple of frames to exercise its code, reports `skip` and
  `valid: false`, and the baseline shrinks to 20 000 particles and 200 frames. Budgets are only
  validated on a real GPU. The renderer string is in every result.
- **Animation-frame timings.** The probe reports two synchronized figures (simulation only, and a
  whole frame with the rendering layers; the GPU is waited for every few frames and at the end)
  and the intervals between animation frames, as the application's own benchmark measures. In
  headless Chrome the latter follow a fixed 60 Hz timer and ignore the GPU load
  (`animationFramesIgnoreGpu: true`): read the synchronized figures.
- **Determinism.** The scenarios run under a seeded `Math.random` (`random.ts`), which drives the
  initial cloud and the density grid shifts. The GPU random numbers hash the particle index and the
  model's substep counter, which `reset()` now rewinds, so a restart with the same seed replays
  bit for bit on the same GPU (`lab.selftest` checks it). Two limits: a run that calls
  `Simulation.endFrame()` (stats, drift correction of the star) is reproducible only up to the
  frame at which the asynchronous position read-back lands, and results can differ at the last
  bits from one GPU or driver to another. The scenarios that compare runs bit for bit step without
  `endFrame()`.
- **Read-back.** Only the first color attachment of a render target can be read directly (three r169
  has no attachment index in `readRenderTargetPixels`): `readAttachment()` copies the others by a pass. The protostar
  grids are overwritten at every substep: step, then read right away, before stepping again; what
  is read is the grid of the last substep's beginning. A read-back waits for the GPU, so the
  timed loops of the performance probe never read inside their measured part.
- **One simulation.** All the scenarios share one `Simulation`, hence one set of GPU buffers; each
  starts with `restart()`. A scenario that rebuilds the pipeline recompiles its shaders.
