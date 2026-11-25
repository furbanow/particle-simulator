# Spike B3: one pass per particle (gate P8): not done

Proposal B3 of the professor's document merges the protostar's velocity, position and acceleration passes into one pass with three
outputs (MRT): `forceAt()` is evaluated three times and `gasAt()` twice at the same position (28 grid reads per particle and substep
against 12), and `drawingAccel()` three times. The plan made it conditional on a profile showing that the reads of the three particle
passes dominate. **They do not: B3 is dropped (the user's decision, 2026-11-23).** This page keeps the measurements, the design that was
proposed and what a later phase should know.

## Measurements (RTX 5070, Direct3D 11, headless Windows Chrome 157)

### Feasibility (`spike.b3.mrt`)

| Check | Result |
|---|---|
| Three unblended RGBA attachments of 1733² in ping-pong, five steps, every texel of the three read back | exact in float and in half float |
| `EXT_color_buffer_float`, `EXT_color_buffer_half_float`, `EXT_float_blend` | all available |
| `MAX_DRAW_BUFFERS`, `MAX_COLOR_ATTACHMENTS` | 8, 8 |
| Samplers of the merged pass (the union of the active samplers of the three compiled passes, TSC and collisions on) | 11 of `MAX_TEXTURE_IMAGE_UNITS` = 16 |

So B3 was feasible in three r169 (`WebGLRenderTarget({ count: 3 })`, `layout(location = k) out` next to `gl_FragColor`). The full-screen
pass timings of the spike (an empty pass 0.049 ms) are lower than any real bandwidth would allow: constant or cleared data compresses.
Read them as an order of magnitude only.

### Cost of each pass of a substep (`cost.protostar.passes`)

Each pass is rendered alone 100 times on a frozen state of the default cloud, then the GPU is waited for; the synchronization's own time is
taken off, and the median of 7 rounds is kept. Values below about 0.01 ms are within the noise. ms per substep (2 substeps per frame):

| Case | moments | power | collision | gravity | velocity | position | accel | 3 particle passes | substep | B3 bound |
|---|---|---|---|---|---|---|---|---|---|---|
| 400k, frame 90, flags off | 1.01 | 0.58 | – | 0.05 | 0.05 | 0.07 | 0.06 | 0.18 (10 %) | 1.84 | 0.13 (7.1 %) |
| 400k, frame 90, TSC + collisions | 1.93 | 1.11 | 0.22 | 0.05 | 0.06 | 0.08 | 0.05 | 0.19 | 3.51 | 0.13 (3.8 %) |
| 400k, frame 1030, flags off | 1.64 | 0.21 | – | 0.05 | 0.06 | 0.06 | 0.05 | 0.17 (8 %) | 2.10 | 0.11 (5.4 %) |
| 400k, frame 1030, TSC + collisions | 3.09 | 0.41 | 0.46 | 0.05 | 0.06 | 0.06 | 0.05 | 0.17 | 4.20 | 0.11 (2.6 %) |
| 1M, frame 90, flags off | 2.53 | 1.44 | – | 0.05 | 0.10 | 0.11 | 0.05 | 0.26 (6 %) | 4.32 | 0.16 (3.7 %) |
| 1M, frame 90, TSC + collisions | 4.89 | 2.76 | 0.55 | 0.06 | 0.11 | 0.11 | 0.07 | 0.28 | 8.56 | 0.18 (2.1 %) |
| 1M, frame 1030, flags off | 4.83 | 0.64 | – | 0.06 | 0.10 | 0.10 | 0.06 | 0.26 (4 %) | 5.81 | 0.15 (2.6 %) |
| 1M, frame 1030, TSC + collisions | 9.09 | 1.09 | 1.26 | 0.05 | 0.11 | 0.13 | 0.06 | 0.30 | 11.82 | 0.19 (1.6 %) |

The gas, heat and coarse passes are 0.01 to 0.02 ms each. The sum of the passes agrees with the simulation frame of the same windows
(4.0, 5.8, 9.4 and 12.6 ms flags off, two substeps plus the reductions). The scenario has the two other settings (TSC alone, collisions
alone) in its metrics.

**The bound of B3.** The merged pass does all the velocity pass does (and writes two more outputs), so it costs at least as much; B3 saves
at most the position and the acceleration passes: **0.11 to 0.19 ms per substep**, that is per frame −0.26 ms (−6.5 %) at 400 000 early,
−0.23 ms (−4 %) late, −0.32 ms (−3.4 %) and −0.30 ms (−2.4 %) at 1 000 000; −1.5 to −3.8 % with TSC and collisions on.

**Why so little.** The deposits are 85 to 95 % of a substep (the moments alone 55 to 85 %; TSC doubles them, the collapsed core makes the
blending contend). The particle passes are not bound by their grid reads: the acceleration pass, which reads almost nothing, costs what an
empty full-screen pass does. What they pay is the fill of all 1733² texels of the state textures (`GPUComputationRenderer` draws the whole
texture; 87 % of the texels are inactive at 400 000 particles and exit early).

**A cheaper lever of the same size (not done).** The same scenario draws the three passes over the rows of the active particles only (a
scissor, `ceil(count / TEX_SIZE)` rows: `GpuPipeline.debugRenderParticlePass(name, rows)`): it saves 0.13 to 0.18 ms per substep, as much as
B3, and B3 on top of it would save 0.02 to 0.07 ms more. It needs no shader change (the inactive texels of both ping-pong targets keep their
values from the restart), would be identical to the bit, and would speed the dust up too; a target written whole (the restart,
`debugSetState`) must drop the scissor while it writes.

## The design that was proposed (for the record)

- An engine abstraction in `GpuPipeline`: the dust stays on `GPUComputationRenderer`, the protostar steps one pair of three-attachment
  targets (attachment 0 the positions, so that the cluster probe, `readPositions` and the type count read them as before; 1 and 2 the
  velocities and accelerations, read through copies: `readRenderTargetPixels` reads attachment 0 only).
- The stored layout unchanged (x(n), v(n−1), a(n−1), `dtPrev`, z = 1 on the first substep), so the collision deposit (C1), drawn after the
  gravity, keeps kicking the velocities to the instant of the positions. Storing a(n) of the current substep to remove the `forceAt()` of
  the collision deposit's vertex shader was not worth it: a(n) would have to be computed before the deposit, by one more pass, while the
  4 (9 with TSC) fetches per particle are small next to its blending.
- The three-pass path kept behind a lab switch for the bit-for-bit parity on the same grids (two runs differ on Direct3D 11: the order of
  the additive blending), then removed.
- Effort: about two sessions, mostly the lab (13 scenarios read the velocity or acceleration targets, `debugSetState` writes the targets),
  for at most 2 to 7 % of the simulation.

## For later phases (A11, C2, C3)

- **The deposits are where the time is.** A phase that adds a deposit or a channel to one (A11's second channel of the near loop, C2's
  nested grid, C3) pays in the deposits' blending, not in the particle passes. Measure with `cost.protostar.passes` (each pass alone, the
  flags off and on) before and after.
- **The particle passes are cheap**: adding work to the velocity or position pass costs little, as long as it does not add a sampler
  beyond the budget (11 of 16 used by the union of the three passes; the velocity pass alone uses 9).
- **The active-rows scissor** above is the cheapest remaining saving of the particle passes, if one is ever wanted.

## Reproduction

    npx vite --port 5173
    LAB_CHROME=... LAB_TMPDIR=... flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --angle default \
        --query "scenarios=spike.b3.mrt,cost.protostar.passes" --out results.json

`spike.b3.mrt` takes 3 s, `cost.protostar.passes` 90 s. Code: commit `09b59c4` on `feat/single-pass`.
