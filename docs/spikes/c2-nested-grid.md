# Spike C2: a nested grid on the protostar's core (phase P9)

Proposal C2 of the professor's document: a second 128² grid, eight times finer, centred on the density peak the reduction gives,
a = a_coarse(all) − a_coarse(inside) + a_fine(inside). This page holds the gate's measurements, the user's decisions, the implementation
and its lab results.

## Decisions (the user, 2026-11-23)

1. **Gravity and gas** are fine inside the box (density, temperature, fuel, heating, fusion law), not the gravity alone: without the fine
   gas the fusion stays capped by the main grid.
2. **A limited fine softening** instead of a mandatory adaptive step or block time steps. First ε/3; after `protostar.nested.cloud`
   showed omega dt 0.8 with it (0.24 off), **ε/2** (omega dt 0.5, the core 3 times denser) rather than ε/3 (0.8, 4.5 times) or ε (0.22,
   1.1 times).
3. **The box once a core dominates**, with hysteresis (not from the first reading: the peak jumps between clumps until ~20 s).
4. **Flag `nestedGrid`, off by default**, defaults not recalibrated.

## Step 1: the grid chain (done, no change of behavior)

`grids.ts` was split into `gridCommon.ts` (the shared defines, uniforms and the deposit pass), `gridChain.ts` (one level: the moments and
power deposits, the gas, the heat, the coarse grid and the gravity) and `ProtostarGrids` (one chain, the reductions, the potential
energy, the collisions). `protostar.grid-chain.parity` draws the refactored grids and a frozen copy of the old ones (`src/lab/legacy/`)
from the same particles in the same run: 0 differing floats over 12 targets (13 with the collisions), with the flags off, with TSC and the
collisions, and with the adaptive thickness; a state one frame later differs in 24 860 floats of the moments (the check is not blind).
The deposit takes a `gridOrigin` uniform ((0, 0) for the main grid) for the nested one.

## Measurements for the gate (`spike.c2.nested`, RTX 5070)

**The track of the peak** (the reduction's densest cell, read every 10 frames of the default cloud, 1 200 frames): before the star forms
(frame ~720, 20 s) the densest cell jumps between clumps (31 jumps of more than 4 cells at 400 000 particles, 38 at 1 000 000, up to 95
cells: the densities are all about 2 ρ0 after the first collapse); afterwards it stays within one cell of the centre.

**A prototype chain 8 times finer** (128² cells of cell/8, centred on the peak: 16 × 16 cells of the main grid), each pass rendered alone
(ms per substep):

| Case | mass inside | fine moments | fine power | fine gas + heat + coarse | fine gravity | fine chain | main moments | main gravity |
|---|---|---|---|---|---|---|---|---|
| 400k, frame 90 | 42 % | 0.17 | 0.11 | 0.01 | 0.050 | 0.34 | 1.00 | 0.049 |
| 400k, frame 1030 | 88 % | 0.82 | 0.13 | 0.00 | 0.048 | 1.00 | 1.24 | 0.051 |
| 1M, frame 90 | 40 % | 0.57 | 0.31 | 0.02 | 0.044 | 0.94 | 2.54 | 0.051 |
| 1M, frame 1030 | 88 % | 1.84 | 0.30 | 0.01 | 0.050 | 2.19 | 4.64 | 0.041 |

The fine gravity costs what the main one does (0.05 ms: it does not depend on N); the cost is the second deposit (17 to 66 % of the main
one), as P8 predicted. Reproduction: `--query "scenarios=spike.c2.nested"` (32 s).

## Design notes for the next session (NOT decided by the user)

These are the points the gate has to settle; they were drafted at the end of a session and **not yet presented in a simple form nor
decided**. Present them to the user as plain choices, one at a time, with a recommendation each.

- **Where the box goes.** The peak jumps between clumps until the star forms (~20 s): a box that follows it from the start would jump
  around. Lead: activate the nested level only once a core dominates (peak ≥ ~20 ρ0 over 3 readings), align the box on main cells
  (16 × 16 of them), move it only when the peak leaves the inner half (hysteresis), reset the fine level's temperature history on a move,
  nothing before the first reading.
- **What is fine.** The professor's text nests the gravity only; without the fine gas (density, T, fuel, heat, fusion law) the fusion
  stays capped by the main grid, and the test "central T independent of the cell" cannot pass. Lead: gravity and gas; the collisions (C1),
  the stability map and the Jeans floor stay on the main grid. Alternative: gravity alone first.
- **The junction** a = a_main(all) − a_main(inside) + a_fine(inside): every pair with one particle outside goes through the main grid,
  every pair inside through the fine one, both symmetric, so momentum is conserved at the main grid's level. a_main(inside) is a small
  pass over the 16 × 16 (+ margin) main cells, sources masked to the box. Precompute a fine correction a_fine − a_main(inside) so that
  forceAt() reads one more sampler (velocity pass 9 → 10 of 16).
- **Samplers.** The fine gas adds 2 samplers (velocity pass) to 4 (the passes that compute a fusion rate): the union reaches 15–16 of 16.
  Pack the fine gas and heat into one texture.
- **The time step is the main risk.** With the professor's ε/8 the core can get up to ~64 times denser, so ω up to ~8 times higher: the
  collapsed core already has ω dt 0.24–0.39 at the fixed step, it would go to ~2–3 (unstable). Options: (a) make the adaptive step
  mandatory with a higher cap (cost explodes in the core phase); (b) bound the fine softening so that ω dt ≤ 0.15 at the current step
  (ε/2 to ε/3 instead of ε/8: a real but limited gain); (c) extra substeps for the particles of the box only (block time steps: the real
  fix, a project of its own). Lead: (b) now, (c) later.
- **Elsewhere**: a reduction of the fine level (peak, core T, max |a|, smallest cell) for the stats and the adaptive step; the energies
  with the corrected potential inside the box; TSC on the fine level too; A11's floor becomes a fine cell.
- **B2 (FFT)** is not justified by these numbers: the fine gravity costs 0.05 ms; the cost of C2 is its second deposit.
- **Tests**: point mass across the boundary (force, anisotropy); momentum at G = 0 and G ≠ 0 with a fixed and a moving box; energy over
  100 orbits; central T and peak density against the cell (ratios 1, 2, 4, 8; no cap at ~300 ρ0); resolved Jeans length (≥ 4 cells) and
  number of fragments against the cell; ω dt in the resolved core; default cloud flag on; `cost.protostar.passes`.
