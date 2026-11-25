# Spike C3: continuous composition per particle (the gate)

Proposal C3 of the professor's document: X_H, X_He and X_C per particle, dX = −r·X·dt integrated exactly, the mass lowered by the mass
defect, the energy injected equal to Δm·c² exactly, no draw. The plan makes it conditional: **only if the noise of the draw is still visible
after A4** (fusion of parcels of constant mass by a Bernoulli draw, [spike](a4-constant-mass-fusion.md)). This document is the gate's
measurement.

## What the draw changes

Since A4 the **energy** has no draw noise: the power deposit puts the expected `m rate energy` into the grid and the heating scales the
velocities by it; nothing reads the draw. The draw decides only **which parcels change type**, so it acts through the composition: the fuel
share X that the rate laws read, the molecular weight in T, the colours of the particles and the "Mass per element" tile.

## The measurement: `spike.c3.draw-noise`

The default cloud (400 000 particles, seed 20240611, 1 200 frames = 34 s, speed 1.7, RTX 5070, D3D11) run seven times from the same
initial state:

- **4 draws**: the random stream of the substeps started at 0, 1e6, 2e6, 3e6 (`ProtostarModel.debugStartRandomStream()`, dev only). The stream
  is the fusion draw (and the kicks of the rare cells too cold to scale, and the collision grid, off by default): everything else is the same;
- **the first draw again** (determinism);
- **2 nudges**: the first draw with the gravity times 1 ± 1e-6, a deterministic perturbation of the size of a float's rounding, which shows
  how much the cloud's own chaos amplifies a tiny difference.

Read every 10 frames (the stats' reduction: fusions per second) and every 40 frames (positions and grids read back: the shares of the mass,
the core within 40 px of the densest cell, the binomial noise of the fuel where the gas burns).

### The replay is not exact to the bit

The same run twice ends with 3 603 parcels of 400 000 of another type (shares of the mass within 2e-4): the order of the blended float
additions of the deposits varies on this GPU. At 120 frames the replay was identical. The scenario passes when the replay's final shares are
within 0.2 % of the first run's.

### Spread of the outcomes

| outcome | 4 draws: mean, std (relative) | nudges (draw 0 and ±1e-6): std (relative) |
|---|---|---|
| hydrogen burnt in the first burst (before 4.5 s) | 33.5 %, ±0.10 pt (0.3 %) | 9e-6 |
| peak fusions per second (at 2.83 s in all) | 533 200, ±800 (0.15 %) | 1e-5 |
| helium flash (A2's reading: carbon +0.75 % of the mass after 6 s) | 22.7 s, ±0.93 s (21.5 to 23.8 s) | 0 (23.8 s in all three) |
| hydrogen at 34 s | 8.8 %, ±0.39 pt (4.4 %) | 0.14 % |
| helium at 34 s | 24.9 %, ±3.5 pt (14 %) | 0.23 % |
| carbon at 34 s | 66.4 %, ±3.6 pt (5.4 %) | 0.09 % |
| core: hydrogen at 34 s | 2.3 %, ±0.35 pt (15 %) | 0.14 % |
| core: carbon at 34 s | 75.4 %, ±4.3 pt (5.7 %) | 0.10 % |
| burning T, last quarter (MK) | 59.9, ±2.0 (3.3 %) | 0.06 % |

First time the shares of the mass of a run differ from draw 0's by more than 1 point: 17 to 22.7 s for the draws; never for the nudges and the
replay (by 0.1 point: 3.4 to 15.9 s for the draws, 23.8 s for one nudge).

The cloud is **not** chaotic enough for a rounding-sized perturbation to grow within 34 s (0.1 to 0.2 % at the end); the draw's own
fluctuations do grow: the **first collapse is the same to 0.3 %** whatever the draw, the **helium phase differs by about ±1 s and ±4 points
of carbon (±14 % of the helium left)**. For scale, the six cloud seeds of the A4 spike give carbon from 30 to 98 % and flashes from 18.7 to
32 s: the draw is a small part of the run-to-run variety, but it is the only part a given cloud has.

### Instantaneous noise

- The fuel share X of the 3 × 3 neighborhoods where the gas burns has a binomial noise sqrt((1 − X)/(X N)) of **1 to 3 %** (hydrogen, median
  1.7 %; 700 to 31 000 parcels in those neighborhoods), helium 1.6 % median. The temperature's noise, which the rates see to the power 4
  (hydrogen) to 40 (helium), is far larger than this (A3's correction is for it).
- The fusions of one reading of the stats (0.28 s) are Poisson: 0.26 % at the peak, 1.2 % median over the readings that burn, 2.4 % at worst.
  The fusion-rate stat shows the expected rate anyway (from the grid), not the count of draws.

## Cost of one more state texture (estimate)

From `cost.protostar.passes` ([B3 spike](b3-single-pass.md)): a particle pass costs what filling the 1733² texels costs, **0.05 to 0.07 ms
per substep at 400 000, 0.10 to 0.13 ms at 1 000 000**, whatever it reads. A composition texture (X_H, X_He, the parcel's mass) written by
its own pass, or by the position pass as a second attachment, would cost about one such pass: **+2.5 to 3.5 % of a substep at 400 000, +1 to
2.5 % at 1 000 000** (flags off; less with TSC or collisions). Memory: one more RGBA32F ping-pong pair of 1733², 2 × 48 MB = 96 MB. Samplers:
the position pass is at 14 of 16 since C2; the composition makes it 15, and the deposit (which would weigh the mass and the fuels by X) one
more. The free channels (`vel.z`, `accel.w`) could hold two numbers without a new texture, at the price of the velocity or the acceleration
pass also writing the composition (and `vel.z` was kept for a later γ = 5/3).

Other costs of C3: the stats switch from counts to masses (the tile already shows masses since A4), the colour of a particle becomes a
blend of the three element colours instead of one, and the mass per particle changes with the defect (the deposits read it).

## Verdict

**C3 is not done** (the user's decision, 2026-11-24). The draw of A4 leaves the first collapse unchanged (0.3 %) and shows only in the
helium phase (flash ±1 s, carbon ±4 points at 34 s), well inside the variety of the cloud seeds; the energy has no draw noise at all. C3
would cost about 3 % of a substep, 96 MB and a large change of the shaders, the deposits and the stats, and would lose the picture of parcels
changing one by one. The scenario stays in the lab to re-measure the noise if the fusion changes.
