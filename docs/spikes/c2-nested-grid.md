# Spike C2: a nested grid on the protostar's core (phase P9)

Proposal C2 of the professor's document: a second 128² grid, eight times finer, centred on the density peak the reduction gives,
a = a_coarse(all) − a_coarse(inside) + a_fine(inside). This page holds the gate's measurements, the user's decisions, the implementation
and its lab results.

## Decisions (the user, 2026-11-23)

1. **Gravity and gas** are fine inside the box (density, temperature, fuel, heating, fusion law), not the gravity alone: without the fine
   gas the fusion stays capped by the main grid.
2. **A limited fine softening** instead of a mandatory adaptive step or block time steps. First ε/3; after `protostar.nested.cloud`
   showed omega dt 0.8 with it (0.24 off), ε/2 (omega dt 0.5, the core 3 times denser). Then `protostar.nested.conservation` showed that
   any softening shorter than the main one heats the cloud (below), and the user chose **the main softening ε on the fine level**: the
   gas, the temperature and the fusion are fine, the gravity is the same law sampled on finer cells.
3. **The box once a core dominates**, with hysteresis (not from the first reading: the peak jumps between clumps until ~20 s).
4. **Flag `nestedGrid`, off by default**, defaults not recalibrated.

## Implementation

- `nestedBox.ts` (pure, `tests/nestedBox.test.ts`): the controller of the box (on once the main grid's peak is at 8 ρ0 or more and within 2
  main cells of the previous reading for 3 stats readings; recentred when the fine peak leaves the middle half; off under 4 ρ0 for 3
  readings), its origin on the main cells, the read region (the box less 2 fine cells), and the twins of the gather weight and of the
  bilinear read of the combine pass.
- `nestedLevel.ts`: the fine `GridChain` (its own cell, origin, density scale, softening and temperature weight; it publishes its gas,
  thermo, fuel and heat straight to the `grid*Fine` uniforms the particle passes hold), the join (`protostar-nested-gather.frag`: the fine
  mass onto the main cells with the cloud-in-cell tent; the main coarse and gravity passes of it over the box and one cell around it,
  `GRAVITY_REGION`; `protostar-nested-combine.frag`: a_fine + B[a_main(all) − a_main(inside)] and Δφ = φ_fine − B[φ_main(inside)]), and
  the fine level's first stages of the reduction and of the potential (`NESTED_LEVEL`).
- `ProtostarGrids.update()`: main gas, fine gas, main power (its rates read the level each particle is in), fine power, heat and gravity,
  join. The reduction's second stage writes three nested texels (`reduction.ts`, tested). `protostar-common.glsl`: `forceAt()` and `gasAt()`
  read the fine level inside the read region (`forceFrom()`, `gasFrom()` take the level's samplers), with a fade of the force over one main
  cell inside it; `GAS_HEAT` spares the heat samplers of the passes that only compute a rate (position pass 14 samplers of 16 with the
  fine ones, velocity pass 12). The deposits skip the particles off their grid. The Jeans floor uses the cell of the level read.
- Dev-only: `forceNestedRatio()`, `debugNestedSofteningDivisor`, `debugForceNestedBox()`, `debugNestedBox`, `NestedLevel.debugBandCells`.
- The frozen copy of the old grids (`src/lab/legacy/`) and `protostar.grid-chain.parity` are removed now that C2 is settled (the parity
  held to 0 floats over the whole implementation; its first case failed once in a while on the first run of a page, on the code before
  C2 too).

## Results (RTX 5070, whole lab on the frozen head)

- **Point mass across the edge** (`protostar.nested.point-mass`): inside the box the law within 0.75 % and the anisotropy 0.18 % from 0.5
  to 7 main cells (at ε/3: 1.75 % and 0.34 %); a point 3 cells outside the box: its pull on the probes inside changes by 0.01 % rms
  against the flag off; no self-force.
- **Conservation, 100 orbits of the conservative cloud** (`protostar.nested.conservation`, 100 000 particles): flag off −0.16 % (max 0.80 %),
  |P| / (M v_rms) up to 7.9e-3; box fixed at the center +0.81 % (max 1.67 %), 4.0e-2; box moved every 50 frames +1.60 %, 3.6e-2; at ε/2
  +43 to +54 % and 0.17. **Why ε/2 heats** (`protostar.nested.net-force`, 3 000 frames): K + U +12.8 % at ε/2 against +0.47 % at ε and
  +0.11 % off, the same at a quarter of the step (+13.0 %: not the integrator), barely less with a fade of the force at the edge (+14.5 %
  without it, +11.6 % with 3 cells): the law of a pair changes (ε/2 inside, ε outside) whenever a particle crosses the box's edge, and the
  conservative cloud crosses it all the time (the box is 16 main cells, the cloud 72). A conservative junction (a softening varying
  smoothly between the levels, with the grad terms A11 lacks too) is not done.
- **The default cloud** (`protostar.nested.cloud`, 400 000 particles, 34 s): the box switches on at 17.6 s (21.8 s at ratio 4), once the star
  has formed, and never moved off. Final peak / core T / burning T: off 193 ρ0 / 113 MK / 52 MK; ratio 2: 207 / 101.5 / 47.8; ratio 4:
  208 / 96.4 / 49.0; ratio 8: 204 / 92.1 / 48.9. The **burning temperature no longer depends on the cell** (48 to 49 MK at ratios 2 to 8);
  the densest cell's temperature falls with the cell (a smaller cell holds the ash at the very center). omega dt up to 0.21 to 0.23 (0.24
  off). With the dropped softenings: ε/2 up to 550 to 1 700 ρ0 (two runs) and omega dt 0.52 to 0.68; ε/3 860 ρ0 and 0.62 to 0.80. The
  Jeans length is under 4 cells for 73 to 85 % of the mass late in the run at every ratio (the core is a star, not a fragmenting cloud);
  one fragment in the fine box once the core holds.
- **Cost** (`cost.protostar.nested`, frame 1030, box on): the fine level and the join 0.65 ms per substep at 400 000 (main grid 1.98 ms),
  1.98 ms at 1 000 000 (3.54 ms); whole frame +33 % (8.45 against 6.33 ms) at 400 000, +22 % (16.06 against 13.12 ms) at 1 000 000. Nothing
  runs while the flag is off or the box is not placed.
- **B2 (FFT)** stays unjustified: the gravity passes of both levels are 0.05 ms each; the cost is the second deposit.

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

## Design notes written at the gate (settled above)

Kept as they were drafted before the decisions.

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
