# Spike C2: a nested grid on the protostar's core (phase P9), gate

Proposal C2 of the professor's document: a second 128² grid, eight times finer, centred on the density peak the reduction gives,
a = a_coarse(all) − a_coarse(inside) + a_fine(inside). This page holds the gate's measurements; the design awaits the user's decision.

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
