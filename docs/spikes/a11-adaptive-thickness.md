# Spike A11: adaptive thickness of the protostar's gas layer (phase P9)

Proposal A11 of the professor's document replaces the fixed softening ε of the protostar's gravity by the scale height of a
self-gravitating sheet, computed in every cell. Done behind the `adaptiveThickness` flag (Features tab), **off by default**, with no
recalibration (the user's decisions at the gate, 2026-11-23). Twin: `src/simulation/protostar/thickness.ts`; lab:
`src/lab/scenarios/thickness.ts`.

## What it does

- **h per cell.** The gas pass, which already sums the 3 × 3 neighborhood, computes h = σ_z² / (π G Σ) with σ_z² = t / 2 (t the dispersion
  of the two components about the neighborhood's mean: isotropy, the convention of the stability map's Q), bounded by one cell
  (`PROTOSTAR_THICKNESS_FLOOR_CELLS`) and 0.4 times the initial cloud radius (`PROTOSTAR_THICKNESS_CEILING`); an empty cell takes the
  ceiling. It writes a fourth attachment, the *source* of the gravity, (m of the cell, h², 0, 0). Flag off: h² = ε² everywhere.
- **The gravity** (`grid-gravity.frag` with `GRAVITY_SOURCE`, the protostar's variant) reads the masses and the h² from the source, one
  fetch per term as before, and softens a pair by ε_ij² = (h_i² + h_j²) / 2: symmetric, so action and reaction stay exact in the near
  sum. The far monopoles use the mass-weighted mean h² of their coarse cell (the coarse pass's free fourth channel, `COARSE_THICKNESS`).
  With the flag off (ε² + ε²) / 2 = ε² exactly: **the gravity grid is the fixed softening's to the bit** (lab). The drawings' fields keep
  the plain variants (no define), untouched.
- **The fusion law** reads the volume density Σ / (2h) as Σ · h_ref / h, h_ref = `PROTOSTAR_THICKNESS_REFERENCE` = 1.6 % L (the default
  softening): λ keeps its calibration where the layer is as thick as the old softening. The factor h_ref / h is the fourth channel of the
  gas pass's second attachment (exactly 1 with the flag off), read by the passes that compute a rate only (no new sampler).
- **The self-interaction** of the potential energy, −G m² / h per particle with h its cell's softening, is now taken off cell by cell on
  the GPU (`protostar-reduce.frag`, `protostar-potential.frag`); the CPU no longer corrects. Its channel in the reduction (Σ m²) became
  the **smallest softening** of a cell with mass, which the adaptive time step uses for its length (`max(h_min, cell)` instead of
  `max(ε, cell)`) when the flag is on.
- **The stability map** multiplies Q by 0.8 + 0.7 σ_z/σ_R = 1.5 (Romeo & Falstad, σ_z = σ_R) with the flag on.
- **The initial cloud** builds its disc's table with the thickness it will have, solved by a fixed point (`initialThickness()`: σ² =
  (α/2 − β)|U(h)|/M, h = σ² R² / (G M), 3 iterations for the default cloud, about 10 for a virial one), so αvir and βrot stay the energies of
  the gravity the cloud feels.
- **Not changed**: the cooling (its column is Σ, and τ = κΣ/2 does not depend on the thickness: a thicker layer of the same column radiates
  the same; the note of the A6 spike was moot), the collisions (C1), the TSC deposit, the particle passes (the force still enters through
  `forceAt()`), the drawings.
- The softening slider does nothing while the flag is on (its tooltip says so).

## Measurements (RTX 5070, Direct3D 11)

| Check (`protostar.thickness.*`) | Result |
|---|---|
| Flag off: gravity grid (force and potential) against the drawings' pass on the same grids | 0 of 49 152 floats differ |
| Flag on: h of every cell / the fusion factor / the gravity grid against the twins | 1.9e-7 / 2.6e-7 / 1.4e-6 |
| h of the default cloud at t = 0 (median within 0.8 R) | 0.0255 L = 2.5 cells (twin 0.0255 L; the professor's 0.026 L) |
| h of a virial disc (αvir = 1, βrot = 0) | 0.311 R (twin 0.311 R); the professor's 0.4 R takes the thin disc's \|U\| (0.42 R): a layer that thick softens its own \|U\| |
| Loop T → h → gravity, conservative virial disc, 30 s | rms change of h between readings 11.7 % early (the noise of t at 200 000 particles), 6.7 % late; nothing out of bounds: it does not ring up |
| Momentum of the conservative default cloud before any wall contact | off 2.8e-5, on 1.9e-4 of M σ |
| Energy, `baseline.protostar.energy-drift` (100 orbits) | off −0.15 % (circular +0.24 %); **on +56 % (circular +66 %)**: see below |

**The response of the gravity to a ripple** (`protostar.thickness.kernel`): a gas filling the area at rest, Σ0 (1 + A cos kx), the sin kx
part of a_x in the middle half, less that of the same particles without the ripple. Theory (`kernelResponse()`): a_x = −2π G Σ0 A K(k) sin kx
with K = S e^(−kε) for a fixed softening and, with the adaptive thickness, **K = S e^(−kh) (1 + B kh / 2)**: the crests are denser, so
thinner (h ∝ 1/Σ at a fixed dispersion), and a thinner pair pulls harder (S = sinc²(k dx/2) the cloud-in-cell factor, B = (1 + 2 cos k dx)/3
the 3 × 3 neighborhood's). Measured within 0.5 % (off, ε = 12.3 px), 0.8 % (h = 20 px) and 1.1 % (h = 40 px) for every mode with K ≥ 0.1,
k h up to 3; the plain e^(−kh) would be 20 to 60 % off. So the ripple's relation of dispersion is ω² = c_s² k² − 2π G Σ k e^(−kh) (1 + kh/2)
(grid factors aside), with c_s from C1 (γ_eff 2.04). A time-domain ripple in an isolated uniform disc cannot be measured: the disc collapses
as a whole on the time of one oscillation, a ratio set by the geometry alone (√(k d) for a displacement d tolerated).

**Cost** (`cost.protostar.passes`, setting `thickness`, ms per substep): gas pass +0.01 to +0.03, coarse +0.005, gravity −0.005 to +0.01,
substep +0.015 to +0.11 (1.865 → 1.88, 1.676 → 1.716, 4.267 → 4.319, 6.378 → 6.487): within the noise of a substep, below 2 %.
`perf.protostarPhases` flag on: 400k 3.49 ms early (3.42 off), 5.20 late (5.97 off, another physics), 1M 6.50 (6.78) and 10.38 (11.1).

## Energy: what is not conserved

With the flag on, the conservative default cloud gains 41 % of |E0| in its first collapse (1.7 orbits) and +0.1 %/orbit afterwards (+56 %
over 100 orbits; the circular cloud +66 %). The integrator is not the cause (the flag off gives −0.15 %). The potential energy depends on the
softening, the softening on the state, and no force pays for that dependence:

- h changes in time at a cell (the gas heats or compresses);
- h changes in space, so a parcel moving from a thin region into a thick one changes U at no cost;
- and h depends on the **velocities** (through t): U is velocity-dependent.

A bookkeeping of the first term alone (W = (G/4) Σ m_i S_i Δh_i², S_i = Σ_j m_j/(r²+ε_ij²)^(3/2), accumulated on the GPU and taken off
K + U) made the drift worse (+68 %, circular +148 %): it was reverted (commits `156aa6e` and its revert). A conservative scheme would need the
grad-h forces of Price & Monaghan (2007) adapted to a grid, with velocity-dependent terms through t: a change of the professor's design, not
done. The professor expected "a slow drift, acceptable for a dynamics that is dissipative anyway"; it is a jump during the collapse. With
the flag on, the energy-drift stat therefore shows the cloud's real non-conservation, not the integrator's.

## The default cloud with the flag on (not recalibrated)

One run, seed of the lab (`baseline.protostar.default-cloud`, params `adaptiveThickness`), against the reference of the RTX 5070:

| t (s) | core T (MK) on / ref | peak ρ (ρ0) on / ref | H, He, C on | H, He, C ref |
|---|---|---|---|---|
| 2.27 | 9.8 / 10.7 | 5.7 / 6.2 | 399 982, 18, 0 | 399 967, 33, 0 |
| 4.25 | 4.6 / 5.8 | 2.1 / 2.2 | 351 589, 48 411, 0 | 265 535, 119 698, 14 767 |
| 14.5 | 11.0 / 19.4 | 5.8 / 10.4 | 351 429, 48 571, 0 | 263 235, 121 998, 14 767 |
| 20.4 | 40.8 / 51.3 | 13.3 / 20.0 | 326 482, 73 518, 0 | 161 915, 223 106, 14 979 |
| 25.5 | 49.3 / 128.4 | 15.6 / 104.9 | 275 835, 124 165, 0 | 54 546, 107 210, 238 244 |
| 34 | 204 / 113 | 291 / 193 | 60 749, 22 414, 316 837 | 35 717, 116 730, 247 553 |

The first-collapse burst burns **12 % of the hydrogen instead of 33.5 %** (the layer heated by the burst thickens, and Σ/2h falls: a
thermostat), no carbon is made before 25 s, and the core ends at the grid's density cap (291 ρ0) at 204 MK. The thick start (h0 = 1.6 ε)
weakens the small-scale gravity, the thin core (h at the floor, 0.65 ε) strengthens it.

## For later phases

- **C2** (nested grid): h follows the resolution (the floor is one cell of the grid that holds the cell); the thickness's factor of the
  fusion law and the source attachment would be per level.
- **Recalibration** (open, the user's decision): λ is calibrated at h = h_ref; the burst and the timeline above move with it.
- **Energy**: a conservative formulation (grad-h terms) is open.

## Reproduction

    npx vite --port 5199                      # a frozen worktree
    LAB_CHROME=... LAB_TMPDIR=... flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --angle default \
        --url http://localhost:5199/particle-simulator/lab.html --query "scenarios=protostar.thickness,cost.protostar.passes" --out a11.json
    # with the flag on any scenario: --query "scenarios=baseline.protostar.energy-drift&params=%7B%22adaptiveThickness%22%3Atrue%7D"
