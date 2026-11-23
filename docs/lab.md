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
| `params=` | Panel parameters (a URL-encoded JSON object) set on every restart of an algorithm that declares them, after its defaults and before the scenario's own: `params=%7B%22tscDeposit%22%3Atrue%7D` runs any scenario with the TSC deposit. |
| `noiseReadings=`, `noiseBudgetSeconds=` | The most gases drawn, and the seconds, per case of `protostar.temperature-noise` (900 and 150). |
| `cloudVariants=`, `cloudSeeds=` | The variants (a URL-encoded JSON array, see below) and the number of seeds (3) of `baseline.protostar.default-cloud-tuning`. |
| `stepSeeds=`, `stepFrames=`, `stepReferenceFrames=`, `stepParticles=`, `stepPaced=0`, `stepDump=1`, `stepVariants=` | The adaptive step's scenarios (`baseline.protostar.adaptive-step`, `protostar.adaptive-maclaurin`): seeds (3), frames (1200) and of the references (330), particles (400 000), frames not paced to the animation frames, every frame of every run in the results, other constants of the adaptive step (a URL-encoded JSON array of `{"omega":0.12,"courant":1,"minRatio":1,"ratio":1.5,"readInterval":3}`), `stepOverrides=` (protostar parameters for every run, `{"radiation":0}`). `costPairs=`, `costFrames=`, `costCounts=`, `costSchedule=` for `cost.protostar.adaptive-step` (5, 1200, 400 000 and 1 000 000, the replayed substeps as run lengths). `energyStep=fixed`, `adaptive` or `varying` (1 to 4 substeps, changing every frame) for `baseline.protostar.energy-drift`. |

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

Under WSL2, the Windows Chrome runs on the real GPU (a Linux Chrome in WSL would go through Mesa's
D3D12 layer). With `networkingMode=mirrored` in `.wslconfig` it reaches the dev server on
`localhost`; give it its `chrome.exe` and a Windows-visible directory for its throwaway profile:

    LAB_CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
    LAB_TMPDIR=/mnt/c/Users/<you>/AppData/Local/Temp \
    node scripts/run-lab.mjs --angle default --query "scenarios=lab.selftest"

The script converts the profile path with `wslpath -w`, reads the DevTools endpoint from the
profile's `DevToolsActivePort` (a Windows Chrome prints nothing on the WSL side) and closes the
browser through the protocol. `--angle default` is Chrome's own backend on Windows (Direct3D 11),
the one a visitor gets; the recorded GTX 1060 numbers used `gl` on Linux.

## What is in it

| Id | What it does |
|---|---|
| `lab.selftest` | The infrastructure: seeded random numbers, slider bypass, grid read-back, bit-for-bit replay of a run. |
| `protostar.half-float-deposit` | The deposit grids in half floats (the path of the GPUs without `EXT_float_blend`) against float32. |
| `protostar.second-deposit` | The composition deposit (second attachment of the moments pass: m/mu, the hydrogen mass, m^2, the helium mass: the first channels were m/mu, count, m^2, 0 until A2) against a CPU reference computed from the position texture, in float32 and in the forced half-float path ([spike](spikes/a1-second-deposit.md)). |
| `protostar.second-deposit-load` | The same on the 400 000-particle cloud once its core has formed (thousands of particles in a cell); the half-float path is measured, not judged. |
| `protostar.molecular-weight` | The mean molecular weight in the temperature (A1): thermal gases of pure hydrogen, pure helium and a mixture with the same particles at the same places with the same velocities. The helium gas must read mu_He / mu_H = 2.65 times the temperature of the hydrogen gas, the mixture in between (its factor, cell by cell, against a CPU deposit of its particles), pure hydrogen unchanged, the dispersion (the energy) not touched, and the core temperature of the stats must be the temperature, not the dispersion; then the same with the deposit forced to half floats (the factors judged to 6 %, they come out within 1.3 %). [Spike](spikes/a1-mean-molecular-weight.md). |
| `protostar.ignition-gas` | The ignition temperatures on pure thermal gases (A1): a hydrogen gas and a helium gas of 1 000 000 particles at 20 rho0, drawn at 36 temperatures each (10 % apart: the triple alpha goes from 1 to 100 fusions per second in a factor of 1.2), gravity, cooling and feedback off. The mean fusion rate of the particles against the temperature of the gas, compared with the rate laws' twin; the temperature at which each gas reaches a few reference rates and the ratio He/H, in temperature and in dispersion, and how much the ignition temperature moves per decade of the rate (of lambda, which scales the rate). |
| `protostar.fuel-fractions` | The mass fractions X (hydrogen) and Y (helium) that the gas pass writes to its third attachment, against a CPU deposit of the particles of a gas of hydrogen, helium and carbon (60 : 30 : 10 by particles, which weigh the same since A4: by mass too): cell by cell, their means against the mass shares, and the carbon in neither; float32 and forced half floats ([spike](spikes/a2-gamow-rates.md)). |
| `protostar.local-exponent` | The exponent d ln rate / d ln T measured on pure gases (A2): for each of six points (hydrogen at 8, 15 and 30 MK, helium at 70, 100 and 200 MK) two gases of the same million particles at the same places at 5 % below and 5 % above the temperature, the rate constant chosen to give 0.2 fusions per second there; the exponent between them against the law's, within 5 %. |
| `protostar.constant-mass.momentum` | The total momentum of a fusing gas with no gravity (A4): 100 000 particles of hydrogen and 20 % helium, drawn cold and moving as a whole, a fusion rate that does not depend on the temperature so that it all fuses, 10 000 substeps. Summed in double precision from a read-back of the velocities and types (the mass of each type read from the deposit inputs; a removed particle counts for nothing), at ten instants, against the thermal momentum `M sigma` and against `sum m v`: the fusion alone (cooling and feedback off) must leave it unchanged to 1e-6, none of the particles may disappear; the same run with the default cooling and a feedback of 0.01 is reported, not judged. Reads only what the build before A4 also has, so it runs there too and shows what removal loses ([spike](spikes/a4-constant-mass-fusion.md)). |
| `protostar.constant-mass.energy` | The fusions that happen against the expected ones and the energy they release against the power the heating deposits (A4): pure hydrogen and pure helium gases of 400 000 particles, a fusion rate independent of the temperature, the feedback at 1, 100 single substeps; each step the changes of type (read back, particle by particle) against the fusion rate of the power grid times dt, and the energy per unit fused mass of the type times the mass that changed against the grid's power times dt. Judged to 2 % (the Poisson noise of the events is 0.3 %, the saturation of 1 - exp(-rate dt) 0.3 %). |
| `protostar.constant-mass.population` | The default cloud, snapshots every 100 frames (A4): the live particles, the particles of the core (within 40 px of the densest cell), the counts per type read back and counted on the CPU against the GPU's count (`ProtostarModel.debugCountTypes()`, which must be equal) and the statistic's own shares of the mass. Runs on the build before A4 too (without the GPU count): its core population falls as the hydrogen is removed. |
| `protostar.constant-mass.nebula` | The mass the nebula layer splats as the cloud fuses, from the positions, against what it would weigh if every type kept its atomic mass; the layer itself drawn and its target read back (judged at the start; the half-float sums of the dense core saturate). |
| `perf.protostarPhases.<count>` | The protostar's simulation ms/frame at 400 000 and 1 000 000 particles in two windows of one restart of the default cloud: frames 10 to 50 (the same load in every build) and frames 1 000 to 1 040 (the hydrogen is mostly burnt: a build that removes the fused particles has about a quarter of them left); chunks of 10 frames, median, min and max. It reads only the public surface and runs on the build before A4. |
| `perf.protostarHitch.<count>` | The protostar's frame times over its periodic readings at 400 000, 1 000 000 and 2 000 000 particles: 360 frames of the default cloud, each followed by a wait for the GPU, the time between the starts of two frames; median, p95, p99 and the worst. Runs on the build before A4 too (it read the positions back every 12 frames: [spike](spikes/a4-constant-mass-fusion.md)). |
| `cost.protostar.type-count.<count>` | What one GPU count of the types costs (A4) at 400 000, 1 000 000, 2 000 000 and 3 000 000 particles (capped by the lab's particle cap): ten counts queued back to back, the GPU waited for at the end, median of five batches (`ProtostarModel.debugRenderTypeCount()`). 2.1, 4.2 and 5.9 ms on the lab's GPU in its P5 state. |
| `baseline.protostar.ignition-ratio` | Ignition temperatures of H and He from the current rate laws, and their ratio, in temperature and in velocity dispersion (pure TypeScript). |
| `baseline.protostar.default-cloud` | The default cloud: core temperature, peak density, fusion rate and omega.dt in the core over time. |
| `protostar.energy-reference` | The energy diagnostics (A7) against a CPU reference computed from a read-back of the positions and velocities of a 5 000-particle cloud: K against the direct sum, U against a CPU twin of the two-level grid scheme and against the direct O(N^2) Plummer sum, the grid gravity (force and potential) against the twin, and the potential kept from the previous substep. |
| `protostar.reduction-channels` | Every channel of the multichannel reduction (peak, extremes, energies, center of mass, momentum) against a CPU sum of the grids read back, and the exact ones against sums over the particles; reports how good the speed bound is. |
| `baseline.protostar.energy-drift` | K + U of a conservative run (cooling, feedback and fusion forced to 0 below the sliders' minima) over 100 orbits, for the default cloud and for a cold cloud on circular orbits; drift, slope and oscillation, with the plan's 1 % criterion, judged on the default cloud's largest drift (`fail` above it, `skip` if the wall-clock budget stops the run before 100 orbits). It was a `known-failure` until phase P5a, which found and removed the first-order error ([spike](spikes/p5a-integrator-order.md)). |
| `baseline.protostar.energy-drift-attribution` | Where that energy goes: the same run of the default cloud for 12 orbits with the time step divided by 1, 2 and 4, and with the walls as they are (they return half of the speed) and elastic. With the scheme of phase P5a the secular rate is 0 at every step. |
| `protostar.integration` | The velocity and position passes against the CPU twin of the integration (`src/simulation/protostar/leapfrog.ts`): 20 000 particles of a gas that fills the area, a substep at a time, each step compared with the twin fed with the acceleration the GPU's own acceleration pass stored. Hundreds of the particles bounce on the walls; the first step owes no half kick. Worst error 1e-4 px and 1e-4 px/s. |
| `protostar.initial-conditions` | The initial cloud's energies (A8) as the sliders set them, ten clouds of 400 000 particles (default, cold, circular orbits, virial 1 with and without rotation, hot, correlated agitation, Maclaurin): the virial ratio 2K/\|U\| the multichannel reduction reads at t = 0 (K of the velocity texture over the potential energy of the gravity grid) and the one against the disc table's \|U\|, the rotation energy along the pattern of the circular speed and in rings, and Toomre's Q (3.36) measured on the velocity field. Judged: K against alpha \|U\| / 2 to 0.2 %, the grid's virial ratio to 1 %, the rotation to 0.2 %. [Spike](spikes/a8-initial-conditions.md). |
| `protostar.initial-grid-force` | The acceleration the gravity grid gives the particles at t = 0 (the acceleration texture after the first substep, at the positions of the start) against the table of the disc (`discAcceleration`), in 60 rings of equal numbers of particles, for the uniform and the Maclaurin disc; judged between 0.1 and 0.95 R to 6 % per ring. |
| `protostar.maclaurin-collapse` | The cold Maclaurin disc (alpha_vir = beta_rot = 0; cooling, feedback and fusion off; a softening of 0.1 % L) against its analytic free-fall time t_ff = (pi/2) sqrt(2 R^3 / (3 pi G M)): the half-mass radius against time, the time at which it falls to 0.75, 0.5, 0.25 and 0.1 of its initial value turned into an estimate of t_ff through the analytic trajectory, at two time steps, and what the softening alone (the table of the softened disc at each radius) would do. Judged at 0.25 to 2 %. |
| `protostar.initial-cost`, `perf.protostar.restart` | What the table and the initial cloud cost at restart (ms, in the browser), and the whole restart (`Simulation.reset`) at 400 000, 1 000 000 and 2 000 000 particles; the second reads only the public surface, so it runs on a build from before the change too. |
| `protostar.heating` | The fusion heating by velocity scaling (A5) on gases of known temperature, gravity and cooling off, one substep: blobs of 200 particles exactly at the center of isolated cells (each reads its cell alone: the energy gained is `q dt` per particle to rounding, the momentum does not move, cold blobs get the kick of the cold cells), and a uniform gas of 400 000 and 1 600 000 particles with the real interpolation, against the random kick it replaces (the same gas with the kick forced). [Spike](spikes/a5-a3-heating-and-t-noise.md). |
| `protostar.thin-disc-cooling` | The thin-disc radiative cooling (A6) on blobs of 50 to 800 particles at the centers of isolated cells (hydrogen and helium, dispersions 0.1 to 10 T0), c = 30, kappa = 20, T_min = 0.3 T0, one substep with no gravity or fusion: each blob's dispersion must be multiplied by the exact solution of the T^4 law (`coolingRatio()` of `cooling.ts`, from the cell's own rho, dispersion and mu), stop at T_min, or stay put below it, and its mean velocity must not move, to 3e-4. The blobs keep 4 cells from the walls. [Spike](spikes/a6-a13-cooling-and-jeans.md). |
| `protostar.jeans-floor` | The Jeans floor (A13) at the default gravity with the switch on: blobs under the floor must end at `t_J = 2 N_J dx G Sigma` (to 3e-4), the others be left alone, the cold ones kicked to it (reported); then the default cloud for 600 frames with the switch off and on: the Jeans length of the cells of 1 rho0 and more, in cells (its minimum and the share of their mass under 4 cells, per reading), and the history's peaks. Judged on the blobs. |
| `protostar.stability-map` | The stability map (A12) of the default cloud at t = 0, 400,000 particles: the GPU map against the TypeScript twin (`stabilityMap()` of `stability.ts`) on the gas grids read back (99th percentile of the relative difference of Q and of beta within 1e-3, the cells' classes the same), then the map's medians over rings at 0.1 to 0.9 R against Q measured on the particles (`measureToomre`), and the shares of the mass where Q < 1, beta < 3 and both. Judged on the parity. [Spike](spikes/a12-stability-map.md). |
| `protostar.stability-evolution` | The same cloud run for 30 s, the map read every 1.5 s: the shares of the mass where Q < 1, beta < 3 and both, and the densest cell's Q, beta, temperature and radius. Reported, not judged. |
| `protostar.temperature-noise` | The noise of the temperature (A3, with the Gamow laws of A2): the mean fusion rate of a pure thermal gas at the reference temperature of its law (hydrogen at 15 MK: local exponent 3.9; helium at 100 MK: 41) against the true rate, for 100 to 6 400 particles per 3 x 3 neighborhood, with the bias correction switched off (the bias the plan predicts) and on (for the triple alpha the exact unbiased estimate of the rate, for the proton-proton chain the rate divided by its curved bias), the gas drawn again for each reading until the standard error is small; a case whose standard error stays above 0.015 (the helium gas of 100 particles per neighborhood) is reported, not judged. Also fits the effective number of particles from the uncorrected bias. Slow (5 minutes: the cases of few particles at alpha = 40 need hundreds of readings). |
| `protostar.temperature-smoothing` | What the exponential average of T over time buys: the noise of T from cell to cell of a gas that moves, instantaneous and averaged, for several time constants, and the autocorrelation of T. |
| `baseline.protostar.default-cloud-tuning` | The default cloud under the variants of the `cloudVariants` option, each with `cloudSeeds` seeds, with the whole series (core temperature, density, fusion rate, particles of each type): `[{"name":"A1 off","molecularWeight":false},{"name":"G 8","overrides":{"gravity":8,"fusionRate":0.004},"frames":600}]`. `molecularWeight: false` is the temperature of the code before A1 (the dispersion), `overrides` set protostar parameters directly (below the sliders' minima too; the cooling is `radiation`, `kappa`, `minTemperature`), `params` panel parameters through the sliders' validation (`{"turbulence":"correlated"}`, `{"alphaVir":1}`: the initial conditions), `kick`, `uncorrected` and `tau` the switches of P3a. A tool for tuning the defaults; skips with no variant. Each run's series has the temperature of the burning gas (`burnTemperatureMK`: the cells' temperature weighted by their fusion heating) besides the densest cell's; `scripts/cloud-tuning-summary.mjs` summarizes the runs per variant (first-collapse burn, when burning resumes, burning temperature, plateau, helium flash), `scripts/cloud-tuning-series.mjs` prints one run's series. |
| `baseline.protostar.default-cloud-variants` | The default cloud with the parts of phase P3a switched on one by one (the kick instead of the scaling, no correction, no average, several time constants), three seeds each; the first variant is the physics before P3a. Slow (4 minutes). |
| `baseline.protostar.adaptive-step` | The adaptive time step ([spike](spikes/b5-adaptive-time-step.md)): the default cloud (400 000 particles, 3 seeds) at the fixed count of substeps, with the adaptive step, and at 1/4 and 1/8 of the substep as references; every frame the core is read from the reduction (peak density, temperature, fusion rate) with the substeps run and what the criterion saw (maxima, critical step, age of the reading), every fifth frame the core's omega (`probeCore`) times the substep that frame ran. Reported: the histogram of the substeps, the omega dt history, and how close each run's core is to the dt/8 reference's (density rms in log, peak, burst time and height, fusions made by a few times). Judged: the largest omega dt of the adaptive run under 0.15. The adaptive runs are paced to the animation frames (the reads land with the lag they have in the application). |
| `protostar.adaptive-maclaurin` | The cold Maclaurin disc's fall ([phase A8](spikes/a8-initial-conditions.md)) at the fixed count, adaptive, and at 1/4 and 1/8 of the substep: the free-fall time estimated at four radii against the analytic one, and the substeps run. Judged at 2 % on the fixed and the adaptive runs. |
| `cost.protostar.adaptive-step` | What the adaptive step costs: the default cloud's whole run (1200 frames, the application's loop) at 400 000 and 1 000 000 particles, the fixed count and the adaptive step alternated run after run (5 pairs): ms per frame, per phase of the run, substeps per simulated second, ms per substep, and the ratio of each pair. The adaptive runs have the flag on (the reads of the reduction, the criterion) but replay the substeps the adaptive step chose in the paced run (`costSchedule`): an unpaced loop yields to the event loop only at its GPU waits, the asynchronous reads land late, and the live decisions would not be the application's. |
| `deposit.tsc.parity` | The TSC deposit (C4, the `tscDeposit` switch): the protostar's composition deposit and the dust's density grid drawn with each kernel against the CPU reference of each kernel (`referenceDeposit()`, `referenceDustDeposit()` with a kernel): within the tolerance of its own kernel, far outside the other's ([spike](spikes/c4-tsc-deposit.md)). |
| `protostar.tsc.noise` | The professor's test of C4: a thermal gas at rest (100 000 to 1 600 000 particles, four draws, the same particles for both kernels), the relative variance of the temperature and of the density from cell to cell, the effective number of particles it implies against the gas pass's, and the noise shape at the cell centers against the theory of `depositKernel.ts`. |
| `protostar.tsc.aliasing` | A blob of 4 096 particles at one point, at eight places along the diagonal of its cell, and massless probes on rings of 1.5 to 24 cells: per kernel, how the rings' mean pull moves with the blob's place (aliasing), how it varies around a ring (anisotropy), the tangential part, and the blob's force on itself (zero when the deposit and the read of the force have the same weights). |
| `dust.tsc.noise` | A uniform cloud of dust grains (100 000 to 1 000 000): the relative variance of the mass of the density texels and of the 2x2 to 16x16 blocks (the coarser levels the gravity reads), per kernel. |
| `cost.tsc-deposit` | Simulation ms per frame with each kernel, alternated chunk after chunk, for the protostar at 400 000 and 1 000 000 particles and the dust at 400 000 to 3 000 000, after 55 frames of the default cloud; and the deposit passes alone on that frozen state (the protostar's whole grid update). |
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

| `protostar.collisions.parity` | The collisions of the gas (C1): one substep of a moving thermal gas in the collisional limit (every cell collides), the GPU velocities against the CPU twin (`collisionStep()` of `collisions.ts`) within 10⁻⁴ σ, momentum and energy within 10⁻⁵ ([spikes/c1-mpc-collisions.md](spikes/c1-mpc-collisions.md)). |
| `protostar.collisions.conservation` | The same gas over 30 substeps in the collisional limit, at the application's rate, without collisions, and (recorded, not judged) with the grids in half floats: total momentum and kinetic energy. |
| `protostar.collisions.sod` | Sod's shock tube across the area (density 8 : 1, pressure 10 : 1, 600 000 particles, 2 s): the column profiles against the exact Riemann solution (`riemann.ts`) for γ = 1.4, 5/3, 2, 2.5, 3; passes when γ = 2 fits best in the collisional limit. |
| `protostar.collisions.sound-speed` | A standing sound wave (4 wavelengths across the width) fitted by a damped cosine (`oscillation.ts`): c_s against √(γP/ρ) = √2 σ; passes within 10 % of γ = 2 in the collisional limit. |
| `protostar.collisions.equipartition` | Hydrogen and helium parcels of dispersions 4 : 1 mixed, at 50 000 and 400 000 particles: the ratio of the dispersions against time and its e-folding time in substeps. |

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
  cloud of hydrogen, helium and carbon instead of hydrogen alone). `flatRates: true` makes every
  rate law independent of the temperature, lambda (rho X)^n (`ProtostarModel.debugFlatRates`), for the
  gases whose heating must be known whatever their temperature (`protostar.heating`); the exponent
  sliders that did this before the Gamow rates (A2) are gone. `params: { alphaVir: 0.96,
  betaRot: 0.48 }` sets panel parameters through the `Simulation` (so within the sliders' ranges)
  before the restart: the initial conditions.
- **Half-float deposit.** `forceHalfFloatDeposit(true)` (`src/simulation/protostar/grids.ts`)
  makes the grids created from then on deposit in half floats; `rebuildPipeline(context)` creates
  them again, and `restart` must follow. The runner switches it off after every scenario.
- **Grids.** `protostarGrids(context)` gives the render targets of the grid passes (`moments`,
  `gas`, `power`, `heat`, `coarse`, `gravity`, `reduce1`, `reduce2`), `readTarget(renderer,
  target)` reads one back as RGBA floats (half floats decoded), row by row from the bottom.
  `moments` has two attachments: `readTarget` reads attachment 0 (m, m v, m |v|^2), `readAttachment(
  renderer, target, 1)` the composition (m/mu, hydrogen mass, m^2, helium mass). `gas` has three (rho, T, mean v; then the temperature
  averaged over time, the effective number of particles and the factor mu / mu_H; then the mass fractions X and Y of the fuels); two targets take turns from one substep
  to the next and `protostarGrids()` gives the latest drawn, so read right after stepping. `readPositions()` reads the first particles of the position
  texture (`readPositions(renderer, simulation.debugPipeline.debugVelocityTarget, n)` the
  velocities), and `referenceDeposit()` (`depositReference.ts`) deposits them again on the CPU.
  `energyReference.ts` holds the other CPU references: the direct energies, the twin of the grid
  gravity and of the reduction, and the statistics of an energy series.
  `protostarModel(context).debugGrids.compositionEnabled = false` makes the moments pass deposit the
  moments alone, as it did before the composition (for the cost comparison only).
- **The reduction.** `protostarModel(context).reduction` (and `energy`, `maxSpeed`, `centerOfMass`...)
  hold the latest reading of the model's reduction, which `model.endFrame()` starts every 10 frames
  (and at the first; every 3 frames while the adaptive time step is on, which is the application's
  default unless a scenario sets the flag: `restart()` gives it its default back);
  `await model.debugReading` waits for the one in flight. Call `model.endFrame()`
  rather than `Simulation.endFrame()` when only the reduction is wanted: for the protostar the latter also counts the types on
  the GPU, and nothing else since the statistical drift correction is gone (A4). `model.debugReductionScales` gives the
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

- **Editing the sources during a run restarts it.** Vite reloads the lab page on any change of a module it serves, and the page starts
  its scenarios over (the log shows `running N scenario(s)` a second time). For a long run, serve a frozen copy of the code from
  a worktree on another port (`git worktree add --detach <dir> <commit>`, a `node_modules` symlink, `npx vite --port 5199` in it)
  and give the runner `--url http://localhost:5199/particle-simulator/lab.html`.
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
  bit for bit on the same GPU (`lab.selftest` checks it). Two limits: a run of the
  sticky dust that calls `Simulation.endFrame()` is reproducible only up to the frame at which its
  asynchronous supernova trigger lands (the protostar's read-backs only read, so its runs replay
  bit for bit with `endFrame()`), and results can differ at the last
  bits from one GPU or driver to another. The scenarios that compare runs bit for bit step without
  `endFrame()`.
- **Read-back.** Only the first color attachment of a render target can be read directly (three r169
  has no attachment index in `readRenderTargetPixels`): `readAttachment()` copies the others by a pass. The protostar
  grids are overwritten at every substep: step, then read right away, before stepping again; what
  is read is the grid of the last substep's beginning. A read-back waits for the GPU, so the
  timed loops of the performance probe never read inside their measured part.
- **One simulation.** All the scenarios share one `Simulation`, hence one set of GPU buffers; each
  starts with `restart()`. A scenario that rebuilds the pipeline recompiles its shaders.
