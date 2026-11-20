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

From the console, `await __lab.run('lab,baseline')` starts a run.

For an agent or a script, `window.__labDone` becomes `true` when the run is over and
`window.__labResults` then holds the JSON (it is also printed in `<pre id="lab-json">`):

    {
      "renderer": "<UNMASKED_RENDERER string>", "software": false, "floatBlend": true,
      "userAgent": "...", "startedAt": "...", "totalMs": 123456,
      "scenarios": [
        { "id": "lab.selftest", "title": "...", "status": "pass" | "fail" | "skip",
          "metrics": { ... }, "details": "...", "durationMs": 1269 }
      ]
    }

Non-finite numbers appear as the strings `"NaN"`, `"Infinity"`. `pass` means the scenario ran and
its checks, if it has any, held; the baseline scenarios record numbers and judge nothing yet.
`skip` always says why in `details`.

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
| `baseline.protostar.ignition-ratio` | Ignition temperatures of H and He from the current rate laws, and their ratio (pure TypeScript). |
| `baseline.protostar.default-cloud` | The default cloud: core temperature, peak density, fusion rate and omega.dt in the core over time. |
| `baseline.protostar.energy-drift` | `skip`: needs A7 (phase P1a). |
| `perf.<algorithm>.<count>` | ms per frame of protostar and sticky dust at 400 000 and 1 000 000 particles. |

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
- **Half-float deposit.** `forceHalfFloatDeposit(true)` (`src/simulation/protostar/grids.ts`)
  makes the grids created from then on deposit in half floats; `rebuildPipeline(context)` creates
  them again, and `restart` must follow. The runner switches it off after every scenario.
- **Grids.** `protostarGrids(context)` gives the render targets of the grid passes (`moments`,
  `gas`, `power`, `heat`, `coarse`, `gravity`, `reduce1`, `reduce2`), `readTarget(renderer,
  target)` reads one back as RGBA floats (half floats decoded), row by row from the bottom.
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
- **Read-back.** Only the first color attachment of a render target can be read. The protostar
  grids are overwritten at every substep: step, then read right away, before stepping again; what
  is read is the grid of the last substep's beginning. A read-back waits for the GPU, so the
  timed loops of the performance probe never read inside their measured part.
- **One simulation.** All the scenarios share one `Simulation`, hence one set of GPU buffers; each
  starts with `restart()`. A scenario that rebuilds the pipeline recompiles its shaders.
