# C4: the TSC deposit, measured

Phase C4 of the improvement plan. The professor's proposal: deposit each particle on 3 × 3 cells (triangular-shaped cloud, TSC) instead of
2 × 2 (cloud-in-cell, CIC), to reduce the aliasing and the grid heating; in the protostar that heating is literally temperature (the noise of
T that A3 corrects depends on it). About 2.25 times the deposit fragments, a gain to measure before adopting it. Test asked: the dispersion
of T in a thermal gas at rest, before and after.

**Decision: shipped behind the `tscDeposit` switch (Features tab, both algorithms), off by default.** The gain is real but small where the
professor expected it (−5 % of noise on T, no change of the energy drift), large only in the near field of the protostar's gravity
(aliasing 4.7 % → 0.7 % at 1.5 cells), and the cost is not small: +44 % per frame for the protostar at 400,000 particles, +68 % at
1,000,000, +16 % for the dust.

Code: `src/shaders/deposit-kernel.glsl` (the kernels, `DEPOSIT_TSC`), `protostar-deposit.*` and `splat.*` (use it),
`src/simulation/depositKernel.ts` (the CPU twin and the noise-shape theory, `tests/depositKernel.test.ts`), `ProtostarGrids.setTscDeposit()`
and `DensityField.setTsc()` (one material per kernel, the TSC one built on first use), `forceAt()` in `protostar-common.glsl` (the matched
read), `src/lab/scenarios/tscDeposit.ts` (lab), `referenceDeposit()` and `referenceDustDeposit()` (a `kernel` argument).

## Design

- **The kernel.** Along each axis, a cell whose center is d cells from the particle gets 3/4 − d² for |d| < 1/2, (3/2 − |d|)²/2 for
  1/2 ≤ |d| < 3/2, else 0 (Hockney & Eastwood). The sprite is 3 texels wide, centered on the center of the cell that holds the particle
  (`floor(p) + 0.5`), against 2 texels centered on the nearest corner for CIC. The weights sum to 1 and keep the centroid (tested).
- **One switch for every deposit of an algorithm.** The protostar's moments with the composition, and the fusion power, use the same kernel
  (the gas pass divides channels of both: their weights must match). The dust's density splat (mass, momentum, agitation energy) is one
  pass. The switch is live: the deposit pass swaps materials, nothing is rebuilt.
- **A matched read of the protostar's gravity.** The first measurement deposited with TSC and kept the bilinear read of the gravity grid:
  each particle then pulls itself, up to 1.8 % of the pull it exerts at 1.5 cells (the blob's self-force below). With a force between cells
  that is odd in their offset, the self-force vanishes only when the read uses the deposit's weights. So with the switch on, `forceAt()`
  reads the 3 × 3 cells with the TSC weights (9 fetches instead of 4, a uniform branch, `tscForce`): the self-force is 0 again. The gas
  fields (`gasAt()`) stay bilinear: they exert no force, and their 5 textures × 9 fetches would cost more. The dust's gravity is summed
  over its mip levels with its own stencil and read bilinearly; its grid is shifted at random every substep, so a self-force there averages
  out as noise; it is left as it is.
- **The effective number of particles.** The gas pass multiplies (Σm)²/Σm² by a shape factor to get the N of the bias correction (A3):
  `PROTOSTAR_NOISE_N_SHAPE` = 1.5 was measured for CIC. `neighborhoodNoiseShape()` computes it: for a uniform gas, a particle's weight in the
  estimate a particle reads is its kernel weights summed over the 3 × 3 cells of a neighborhood, interpolated bilinearly between the centers
  of the neighborhoods; the ratio (Σw)²/Σw² over Σw is separable. CIC gives 81/64 = 1.27 at a cell center and 1.65 between four cells (the
  two numbers of `config.ts`), **1.51 averaged over the place of the reader**: the lab's 1.5. TSC gives 1.40, 1.76 and **1.63**
  (`PROTOSTAR_NOISE_N_SHAPE_TSC`, a uniform of the gas pass set by the switch).

## Numbers (headless Chrome, GTX 1060, 1024 × 768 px area; the user's own Chrome was open, so timings are alternated pairs)

**Parity** (`deposit.tsc.parity`): the protostar's composition deposit of 20,000 particles with TSC is within 0.0014 of the float32
tolerance of the CPU TSC reference (0.0032 for CIC against CIC); against the other kernel's reference it is off by thousands of times the
tolerance. The dust's half-float grid: 0.57 of the tolerance (CIC 0.73), and off by hundreds against the other kernel.

**Noise of a thermal gas at rest** (`protostar.tsc.noise`, the professor's test; four draws, the same particles for both kernels):

| Particles | relative variance of T, CIC | TSC | gain (variance) | noise of T | N fitted / N of the gas pass, CIC | TSC |
|---|---|---|---|---|---|---|
| 100,000 | 0.00908 | 0.00817 | 1.112 | −5.2 % | 0.83 | 0.85 |
| 400,000 | 0.00224 | 0.00202 | 1.109 | −5.1 % | 0.84 | 0.86 |
| 1,600,000 | 0.000552 | 0.000498 | 1.110 | −5.1 % | 0.85 | 0.87 |

The theory at the cell centers predicts a gain of 1.108; the shape the cells' noise implies is 1.24–1.28 for CIC and 1.38–1.42 for TSC
(theory 1.27 and 1.40). The density's variance gains the same, 1.105–1.108. The 3 × 3 sum of the gas pass already smooths the CIC deposit
over 4 cells: TSC widens that to 5, hence the small gain. The N fitted is about 0.85 of the gas pass's N for both kernels because the gas pass's factor is the
average over the readers (1.5 and 1.63), while the cells are read at their centers (1.27 and 1.40): the same ratio, which says the TSC
factor is right. With the CIC factor of 1.5 the TSC column read 0.92 to 0.94.

**Gravity of a point mass** (`protostar.tsc.aliasing`): a blob at eight places along the diagonal of its cell, probes on rings. "Aliasing"
is how the ring's mean pull moves with the blob's place (rms), "anisotropy" how the pull varies around the ring (rms, mean over the
places), the self-force is the blob's pull on itself over its pull at 1.5 cells.

| Ring (cells) | aliasing CIC | TSC | anisotropy CIC | TSC | pull TSC / CIC | tangential / pull CIC | TSC |
|---|---|---|---|---|---|---|---|
| 1.5 | 4.72 % | 0.68 % | 4.51 % | 1.21 % | 0.904 | 2.2 % | 0.88 % |
| 3 | 0.04 % | 0.15 % | 0.94 % | 0.23 % | 0.991 | 0.94 % | 0.28 % |
| 6 | 0.35 % | 0.01 % | 0.42 % | 0.04 % | 1.005 | 0.30 % | 0.05 % |
| 12 | 0.02 % | 0.04 % | 0.11 % | 0.08 % | 1.001 | 0.06 % | 0.006 % |
| 24 | 0.01 % | 0.01 % | 0.03 % | 0.00 % | 1.001 | 0.02 % | 0.001 % |

Self-force: 0 with CIC, **up to 1.79 % with TSC read bilinearly**, 0 with the matched read. The near field is much cleaner, at the price of
a pull 10 % weaker at 1.5 cells (the wider kernel softens the core: a slight extra softening at the scale of a cell).

**Energy drift** (`baseline.protostar.energy-drift`, 100 orbits, run with `params={"tscDeposit":true}`): default cloud −0.19 % with TSC,
−0.17 % with CIC (largest excursion 0.80 % both); circular orbits −0.07 % against +0.11 %. Since P5a the scheme does not heat: the grid
heating TSC would cure is not visible in the energy.

**Dust density noise** (`dust.tsc.noise`, uniform cloud): the variance of the mass of a texel is 1.48 to 1.50 times lower with TSC (the
theory: (∫w_CIC² / ∫w_TSC²)² = (2/3 ÷ 0.55)² = 1.47), but only 1.19 for 2 × 2 blocks, 1.08–1.10 for 4 × 4 and 1.02–1.07 for 8 × 8 and
16 × 16: the coarse levels, where most of the dust's pull comes from, barely change.

**Cost** (`cost.tsc-deposit`, simulation ms per frame, 12 alternated pairs of 30 frames after 55 frames of the default cloud):

| | CIC | TSC | difference |
|---|---|---|---|
| protostar 400,000 | 8.94 ms | 12.63 ms | **+3.9 ms (+44 %)** |
| protostar 1,000,000 | 16.5 ms | 27.9 ms | **+11.2 ms (+68 %)** |
| dust 400,000 | 2.71 ms | 3.15 ms | +0.46 ms (+17 %) |
| dust 1,000,000 | 4.82 ms | 5.78 ms | +0.79 ms (+16 %) |
| dust 3,000,000 | 13.1 ms | 14.8 ms | +2.2 ms (+16 %) |

The protostar's grid update alone goes from 2.95 to 4.68 ms per substep at 400,000 particles and from 6.46 to 10.8 ms at 1,000,000: its
two deposits are most of it, and 2.25 times the fragments of a blended float32 target cost nearly that. (The dust's frozen deposit timed
+0.06 ms only, against +0.46 ms per frame: that measurement is not trustworthy, the per-frame one is.)

**The default protostar cloud** (`baseline.protostar.default-cloud-tuning`, variants CIC and TSC, seeds 20240611 to 20240613, 400,000
particles; `scripts/cloud-tuning-summary.mjs`), medians:

| | first collapse burns | burning again | burst | burning T | core plateau | helium flash | H left | C at the end |
|---|---|---|---|---|---|---|---|---|
| CIC | 33.5 % | 9.9 s | 509,000 /s | 27.2 MK | 33.5 MK | 3 of 3, 21.5 s | 8.9 % | 74.9 % |
| TSC | 33.4 % | 10.5 s | 506,000 /s | 29.2 MK | 34.3 MK | 3 of 3, 22.1 s | 9.2 % | 72.3 % |

The differences are within the seed-to-seed spread: TSC does not tame the first-collapse burst (it comes from the steepness of the Gamow
law at 5–9 MK, not from the noise of T) and does not bring the hydrogen's burning temperature into 10–20 MK. No default needs recalibrating.

**The default dust cloud** (`dust.default-cloud`, `dust.supernova.seeds`): the same timeline (30 % of the mass dense at 2.48 s with CIC,
2.51 s with TSC; first supernova at 2.78 s in both), a lower peak density at 15 s (65 against 76), and 4 to 5 supernovae in 30 s for each
seed in both.

## Why off by default

The professor's test (the noise of T at rest) gains 5 %, the energy does not drift less, the default runs of both algorithms do not change,
and the protostar pays 44 to 68 % per frame: at the first-visit benchmark's target, that would cut the particle cap by about a third for an
effect nobody would see. What TSC does buy is a clean near field of the protostar's gravity (aliasing, anisotropy and the tangential force
divided by 3 to 7 within 6 cells): worth having when the core is resolved by a few cells only, which is the business of A11 and C2 (the
nested grid). The switch stays, off, for that and for comparisons.

## Limits

- The gas fields are still read bilinearly with the TSC deposit: the read of T is smoothed by the deposit and the 3 × 3 sum, not by the read.
- The dust's gravity read is not matched to the TSC splat (see above).
- The first-visit benchmark (`BENCHMARK_ALGORITHM`) runs with the switch off: someone who turns it on with a cap tuned for CIC may drop
  under the target frame rate.
- Saved configurations gain the key `tscDeposit` (false when absent).

## Reproducing

    npx vite --port 5174 &
    flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --url http://localhost:5174/particle-simulator/lab.html \
        --query "scenarios=deposit.tsc.parity,protostar.tsc.noise,protostar.tsc.aliasing,dust.tsc.noise,cost.tsc-deposit"
    # any scenario with the TSC deposit:
    ... --query 'scenarios=baseline.protostar.energy-drift&params=%7B%22tscDeposit%22%3Atrue%7D'
