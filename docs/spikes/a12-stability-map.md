# A12: the stability map (Toomre's Q and t_cool·Ω)

Phase P1b of the improvement plan. The professor's proposal: from the gas grid, which already holds ρ, T and u, one more pass gives the
epicyclic frequency from the vorticity, κ² = 2Ωζ with Ω = u_t/r about the center of mass, then Q = σκ/(3.36 GΣ) and β = t_cool·Ω; the cells
where Q < 1 and β < 3 are drawn over the animation, since that is where the disc fragments. Test asked: at the start, with the default
settings, Q from 0.19 to 0.56 and β about 0.6 at 0.2 R.

Code: `src/simulation/protostar/stability.ts` (twin, pure, `tests/stability.test.ts`), `src/shaders/protostar-stability.frag` and
`stabilityPass.ts` (the pass), `ProtostarModel.overlay()`, `GpuModel.overlay` / `GridOverlay`, `src/render/stabilityLayer.ts` with
`stability-overlay.vert|frag` (the layer), `src/lab/scenarios/stabilityMap.ts` (lab).

## Design

- **What the pass reads.** The gas pass of the latest substep: Σ (ρ/ρ₀), the dispersion t = ⟨|v − u|²⟩ and the mean velocity u of each 3 × 3
  neighborhood, and the factor μ/μ_H of its second attachment. It writes (Q, β, ρ/ρ₀, κ²) to a 128² RGBA32F target. Unbounded values (no
  gas, no cooling) are written as `PROTOSTAR_STABILITY_CAP` = 2¹⁰⁰, exact in float32 so the twin and the GPU agree bit for bit on it.
- **Ω** = (dx u_y − dy u_x)/max(r², Δx²) about the center of mass of the latest reduction (`ProtostarModel.centerOfMass`, read every 10
  frames; the middle of the area before the first reading).
- **ζ** = ∂_x u_y − ∂_y u_x by central differences over the neighbouring cells, one-sided where a neighbour holds no gas, 0 where neither
  does (an empty cell's u = 0 would put a spurious shear on the cloud's edge). On a linear field (solid rotation) both are exact, edge included.
- **κ² = 2Ωζ.** For a rotation curve v(r) it is (1/r³) d(r²v²)/dr, the formula of `toomre.ts`. Where it is negative (the angular momentum
  falls outwards: no epicyclic support) κ = 0, so Q = 0.
- **Q** = σκ/(3.36 GΣ) with σ = √(t/2), the radial dispersion of an isotropic plane, and the stellar 3.36 of `toomre.ts` (the particles are
  collisionless). G Σ = G_eff ρ₀ · ρ.
- **β = t_cool·|Ω|** with Gammie's (2001) cooling time t_cool = E/|dE/dt| = 1/|d ln T/dt|, the rate of the thin-disc law of P4
  (`coolingLogRate()`) at the cell's temperature μt/T₀. Note: the status file suggested 1/(3|rate|), which is the time for T⁻³ to double
  under the T⁴ law, not the cooling time of Gammie's criterion; the threshold β < 3 is stated for Gammie's definition, so that one is used.
- **A choice of its own, not the `diagnostics` flag.** The flag is on by default and the map is red over most of the cloud for most of its
  history (below): it would cover the animation on every visit. `stabilityMap` (off, fragmentation, Toomre Q, cooling β) sits in the
  Features tab, off by default, live. The pass runs only while the map is shown, at most once per frame (`overlay()` draws it when the grids
  changed since the last call), so off costs nothing.
- **The layer** is drawn after the post-processing, straight onto the canvas (neither bloomed nor tone mapped: a diagnostic, not part of the
  picture), with the visual zoom (the projection of `particle.vert`). Each cell's colour is decided from its own values and the colours of
  the four nearest cells are blended: interpolating Q itself would draw values no cell holds across empty cells and across the threshold.
  Fragmentation: red (both criteria) at 0.45 opacity, orange (Q only) and blue (β only) at 0.45 × 0.45. The continuous maps: red below the
  threshold, blue above, the opacity growing over one decade.

## Numbers (headless Chrome, GTX 1060, 1024 × 768 px area, 400,000 particles, seed 20240611)

**Parity** (`protostar.stability-map`): over the 4,531 cells of at least 0.05 ρ₀ of the default cloud at t = 0, the 99th percentile of the
relative difference between the GPU map and the twin run on the grids read back is **2.2e-7** for Q and **4.3e-7** for β; no cell is
classified differently.

**At the start** (the same scenario): the map's medians over rings of ±0.05 R, against Q measured on the particles in 40 rings.

| Radius | Q (map) | Q (particles) | β (map) |
|---|---|---|---|
| 0.1 R | 0.187 | 0.188 | 14.9 |
| 0.2 R | 0.203 | 0.188 | 16.0 |
| 0.25 R | 0.207 | 0.188 | 17.0 |
| 0.5 R | 0.216 | 0.217 | 16.8 |
| 0.75 R | 0.252 | 0.252 | 18.7 |
| 0.9 R | 0.322 | 0.328 | 20.8 |

Q is the professor's 0.19 at the center but lower at the edge (0.32 against 0.56); the particles say the same (0.33, and 0.35 at 0.94 R in the
A8 spike), so the difference is in the cloud the professor computed from, not in the map. The map agrees with the particles within 1 % except at 0.2 to 0.25 R (8 %), where the particle rings
are wide. **β is 15 to 21**, not 0.6: since P4 the cold gas (2 MK) radiates as T⁴ and barely cools. 99.5 % of the mass has Q < 1, 0.9 % has
β < 3 and 0.4 % both: by Gammie's criterion the start is not fragmenting through cooling, yet the cloud is so far below Q = 1 (by a factor 3
to 5) that it collapses and fragments gravitationally anyway (the criterion β < 3 is about a disc held at Q ≈ 1 by its own heating).

**As it collapses** (`protostar.stability-evolution`, the map every 1.5 s): the shares of the mass of the cells of at least 0.05 ρ₀.

| t (s) | Q < 1 and β < 3 | Q < 1 | β < 3 | densest cell: ρ (ρ₀), Q, β, T (MK) |
|---|---|---|---|---|
| 1.5 | 0.6 % | 97 % | 2.9 % | 2.1, 0.26, 26, 4 |
| 3.0 | 28 % | 35 % | 81 % | 21, 0.60, 0.29, 115 (the first collapse's burst) |
| 6.0 | 76 % | 99 % | 77 % | 1.3, 0.13, 0.68, 6 |
| 7.5 | 95 % | 99 % | 96 % | 2.0, 0.05, 2.7, 5 |
| 12.0 | 78 % | 98 % | 80 % | 9.4, 0, 2.6, 16 |
| 16.5 | 81 % | 96 % | 83 % | 13, 0.03, 0.94, 35 |
| 21.0 | 61 % | 91 % | 68 % | 28, 0.20, 1.4, 70 |
| 22.5 | 29 % | 80 % | 35 % | 52, 0.13, 0.97, 99 |
| 25.5 | 0.2 % | 82 % | 1.8 % | 106, 0.19, 5.0, 129 |
| 30.0 | 4.3 % | 83 % | 6.0 % | 165, 0, 0.98, 118 |

After the bounce of the first collapse the whole cloud sits in the fragmentation regime for about 15 s (the lull of P4: a cold envelope with
nothing burning); the clumps merge into the star between 20 and 25 s and the share falls to a few %. The densest cell keeps Q < 1 all along: its
3 × 3 dispersion is small next to its G Σ (12 to 165 ρ₀), and κ² often comes out negative there, being the center of mass's own cell
(Ω with r² ≥ Δx², ζ from the core's internal flow). In the star Q is not meaningful (no disc); β ≈ 1 to 5 at 100 to 130 MK.

**Seen in a browser** (screenshots of the application over CDP, headless Chrome, 1400 × 900): the map lies on the gas at every zoom; the β map
shows the filaments and the clumps in red and the gas between them in blue; the Q map is red almost everywhere, as the numbers say.

**Cost:** not measured. One 128² pass of 6 fetches per cell and one full-screen quad of 4 fetches per pixel, only while the map is shown.

## Limits

- The dispersion of a 3 × 3 neighborhood leaves out the correlated agitation and includes the shear and the infall across 3 cells
  (see the A8 spike): Q from the grid reads the gas as it is seen by the cooling and the fusion, not by the particles' own rings.
- Ω and ζ come from the mean velocity of 3 × 3 neighborhoods: features smaller than about 4 cells (32 px) are smoothed out. The center of
  mass lags by up to 10 frames.
- Q around the densest cell (the star) is not a disc's Q; read it as "unsupported by rotation".
- The professor's β ≈ 0.6 at 0.2 R cannot be reproduced: it belonged to the linear cooling replaced in P4.

## What the next phases should know

- **C4 (TSC deposit)**: the map reads the gas pass; a smoother deposit changes t and ζ, so the parity scenario must still pass and
  `protostar.stability-evolution` gives a before/after of the fragmentation regime.
- **C1 (collisions)**: a real pressure raises t, so Q; the map shows whether the cloud leaves Q < 1.
- **A11 (adaptive thickness)**: the effective Q is multiplied by about 0.8 + 0.7 σ_z/σ_R (Romeo and Falstad); the twin and the shader would take
  that factor.
- **C2 (nested grid)**: the map is per cell of the coarse grid; a nested grid would need its own pass or a resampling.

## Reproducing

    S=...                                         # a scratch directory; serialize the GPU runs with flock
    npx vite --port 5231 &
    LAB=http://localhost:5231/particle-simulator/lab.html
    flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.stability-map" --out $S/start.json
    flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.stability-evolution" --out $S/evolution.json
