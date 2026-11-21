# Spike A1: the mean molecular weight in the temperature

Phase P3b-1 of the improvement plan. The protostar's temperature was a pure velocity dispersion, with no
molecular weight in it: at equal dispersion a helium core (mu = 1.334) and a hydrogen core (mu = 0.504) read
the same value, although a thermometer would give the helium one 2.65 times more. This phase defines

    T = (mu_mean / mu_H) * <|v - u|^2>,        1 / mu_mean = sum_k X_k (1 + Z_k) / A_k

and moves what means a temperature to it; what means an energy stays on the dispersion. It consumes the
composition deposit of [phase P0c](a1-second-deposit.md), which until then fed only the effective number of
particles. Validated in the lab ([lab.md](../lab.md)) on thermal gases of known composition and on the default cloud.

## Verdict

| | Acceptance | Result |
|---|---|---|
| Equal dispersion | a helium gas reads mu_He / mu_H = 2.6477 times a hydrogen gas, a mixture in between, pure hydrogen unchanged | **2.6477, error 3e-8** (float32); mixture (20 % helium by number) 1.448, its factor within **1e-6** of a CPU deposit of its particles; hydrogen's factor within **8e-7** of 1; the dispersion is identical for the two pure gases. Half-float path: 1.3e-3 on the ratio, 1.3e-2 on the mixture's factor |
| Ignition ratio He/H on pure thermal gases | the professor's target 6.7, expected 5.3 to 6.6 from A1 alone | **A1 alone does not move it** (see below): the physical ratio is that of the rate laws, 1.7 at the lab's reference point (0.5 per second, 60 rho0), 1.3 to 4.2 on the gases at 20 rho0. After the minimal recalibration of the defaults: **5.57** at the reference point (6.9 at 0.1 per second and 20 rho0), measured on the GPU to 0.3 % |
| Default cloud | burns hydrogen near 15 MK and helium near 100 MK | with the old defaults the star runs away on helium (core 170 to 300 MK, 28 000 to 33 000 carbons by 34 s). **After G 13.85 -> 9 and lambda_0 1.5e-4 -> 4e-3: hydrogen burns at a core temperature of 14.5 to 15.8 MK (median of the burning plateau, 3 seeds), helium at 59 to 114 MK (median of the temperature weighted by the carbon made; 70 to 123 MK over 56 s)** |
| Cost | simulation ms per frame at 400 000 particles | **not measurable** on the same physics (paired median -0.25 ms of 25, 18 pairs, spread of +-8 ms); the new defaults make the probe's cloud **13 % cheaper** (8.51 to 7.21 ms, 6 pairs of 6) |

## What T is, and what reads which

Two quantities, kept apart in the shaders and named alike in the comments:

| | Name in the shaders | Meaning | Read by |
|---|---|---|---|
| dispersion | `t`, `gridGas.y` | the mean squared deviation from the mean velocity, `(v - u)^2`, over the 3 x 3 neighborhood: the kinetic energy of the disordered motion is `t / 2` per unit mass | the heating by scaling (A5), the cooling (it damps the deviations from the mean velocity), the speed bound of the reduction, the energy diagnostics (they sum the moments, not `t`) |
| temperature | `tRate` (averaged over time), `mu * t` (instantaneous) | `T = (mu_mean / mu_H) t`: what a thermometer reads | the fusion rate (the smoothed one, with the bias correction of A3 unchanged), the glow, the core temperature of the statistics |

- **The factor** `mu_mean / mu_H` is computed once per cell by the gas pass from its 3 x 3 sums,
  `(1 / mu_H) * sum(m) / sum(m / mu)` with `1 / mu_H = (1 + 1) / 1.00783 = 1.984` per u
  (`PROTOSTAR_REFERENCE_INVERSE_MU`): 1 for pure hydrogen, 2.6477 for pure helium, 3.4019 for pure carbon 12.
  It goes to the third channel of the gas pass's second attachment (`gridThermo.z`), and the heat pass copies it
  to the second channel of the heat grid, which the velocity pass samples already: the velocity pass has eight
  samplers and no room for a ninth (see the second-deposit spike). `gasAt()` interpolates it with the mass weights
  like the other fields (`Gas.mu`). The reduction reads `gridThermo.z` of the densest cell for the core
  temperature. Twin and tests: `composition.ts` (`molecularWeightFactor()`, `tests/molecularWeight.test.ts`).
- **Normalisation.** `T0 = 15 MK` stands for a hydrogen gas of dispersion `T0`, so a gas of pure hydrogen has
  `T = t` exactly (the factor reads 1 within 1e-6 in float32): its physics, and every number measured on it before,
  are unchanged (`protostar.heating` and `protostar.temperature-noise` give their numbers of P3a). The reference
  does not follow the mass of the hydrogen type in the element editor: editing it changes that type's own mu (a
  hydrogen of 2 u reads twice as hot at the same dispersion).
- **The average over time** (A3) is the average of `T`, not of `t`: `gridThermo.x` is the smoothed temperature.
  The correction of its noise is unchanged: the factor is a ratio of sums whose own noise (the composition of
  the neighborhood, sampled by its particles) is not corrected, see the limits.
- **Empty cells and custom elements.** A cell with no mass writes zeros, as before; a neighborhood with mass but
  no composition (every type there has a mass of 0) has a factor of 1: the dispersion is the temperature, the
  neutral choice. A type whose symbol is not one of the ten `ELEMENTS` takes `Z = A / 2` (`PROTONS_PER_NUCLEON`,
  the valley of stability: about as many neutrons as protons), so `1 / mu = (1 + A / 2) / A`, which tends to
  1/2 for a heavy atom (a factor of 3.97 at the limit); a type of mass 0 has `1 / mu = 0` and no composition.
- **A switch for the lab** (`ProtostarGrids.molecularWeightEnabled`, a uniform `molecularWeight` of the gas pass,
  on at every restart): off, the factor is 1 and the model is the one before A1, in the same build.

## Acceptance 1: the ignition ratio He/H

`protostar.ignition-gas` (lab): a pure hydrogen gas and a pure helium gas of 1 000 000 particles in a square of
14 cells that holds all the mass (20 rho0, the densest uniform gas that leaves interior cells), drawn at ten
temperatures from 6 to 195 MK, gravity, cooling and feedback off, the grids drawn from the particles as they are.
The helium gas is drawn at the dispersion that gives the temperature (2.65 times lower). The mean expected
fusion rate of the particles is read from the power grid and compared with the twin of the law
(`fusionRate()`, with the noise correction at the gas's own effective number of particles): **within 0.26 %** at
every point and both laws; the temperature at a reference rate is interpolated log-log between the two readings
that bracket it, and agrees with the law's closed form (`ignitionTemperature()`) to 6e-5.

| Reference rate, at 20 rho0 | H, MK | He, MK | He/H, temperature | He/H, dispersion |
|---|---|---|---|---|
| **Old defaults** (lambda_0 = 1.5e-4), A1 alone | | | | |
| 0.01 / s | 23.05 | 97.48 | 4.23 | 1.60 |
| 0.1 / s | 52.46 | 112.6 | 2.15 | 0.81 |
| 0.5 / s | 93.22 | 124.5 | 1.34 | 0.50 |
| **New defaults** (lambda_0 = 4e-3) | | | | |
| 0.01 / s | 7.14 | 97.48 | 13.66 | 5.16 |
| 0.1 / s | 16.24 | 112.6 | 6.93 | 2.62 |
| 0.5 / s | 28.85 | 124.5 | 4.31 | 1.63 |

At the lab's reference point (0.5 per second at 60 rho0, about what the core of the default cloud has once it
burns), from the laws (`ignition.ts`, the same to 6e-5 as the gases at 20 rho0): 1.72 with the old defaults
(H 63.0 MK, He 108.5 MK), **5.57 with the new ones (H 19.5 MK, He 108.5 MK)**, and 6.3 at 100 rho0.

What this says about the plan's figure:

- **A1 alone does not change the physical ratio.** The fusion law reads the temperature `T`, and its parameters
  (lambda, alpha, T_ref) stay what they were: a gas ignites at the same temperature as before, whatever it is made
  of. What A1 changes is the dispersion at which a helium gas gets there: 2.65 times lower. The professor's 5.3 to 6.6
  (the current 2 to 2.5, times mu_He / mu_H) holds the ratio **of dispersions** fixed at its old value and multiplies
  by 2.65 the temperature the helium reads; with the law reading `T`, the dispersions' ratio is what falls instead
  (from 1.7 to 0.65 at the reference point, with the old defaults: helium would ignite colder than hydrogen).
- So the physical ratio is a property of the rate laws, and it is moved by the laws: it is 5.57 at the reference
  point since lambda_0 was raised for the cloud's sake (below), whose hydrogen then ignites at 19.5 MK there. It
  depends strongly on the point (the laws differ in steepness, 2.8 against 16, and in density exponent, 1 against
  2): 4.3 to 13.7 on the gases above. The lab's reference point is a convention; Gamow's laws (A2) change the
  steepnesses and the recalibration will fix the point again.

## Acceptance 2: equal dispersion

`protostar.molecular-weight` (lab): the same 400 000 particles at the same places with the same velocities
(dispersion T0, 4 rho0, 3 440 particles per neighborhood), as pure hydrogen, pure helium, and 80 / 20 hydrogen and
helium by number (the helium atom weighing 3.97 times the hydrogen one: half of the mass is helium).

| | Hydrogen | Helium | Mixture |
|---|---|---|---|
| dispersion (T0) | 0.99674 | 0.99674 | 0.99481 (fewer effective particles: 3 319 against 5 163) |
| factor mu / mu_H | 1 (error 8e-7) | 2.6477 (error 9e-7) | 1.4507 (against the CPU deposit of its particles, 1e-6) |
| temperature (T0, MK) | 0.99674, 14.95 | 2.639, 39.59 | 1.443, 21.65 |

The temperature ratio helium over hydrogen is 2.6477, mu_He / mu_H to 3e-8; the mixture lies between. The core
temperature of the stats is 1.4977 T0 for the densest cell of the last gas, the product of its dispersion and its
factor (1e-5), and differs from its dispersion. With the deposit forced to half floats (the path of the devices
without `EXT_float_blend`): the ratio is 2.6443 (1.3e-3 off), the factors are within 2.4e-3 (hydrogen), 7.7e-3
(helium) and 1.3e-2 (the mixture) of their references at 400 particles per cell; the sums of a dense cell stagnate in
half floats (see the second-deposit spike), which is where a larger error would come from, amplified by the
exponent of the law.

## Acceptance 3: the default cloud

The default cloud (`baseline.protostar.default-cloud-tuning`, 400 000 particles, seeds 20240611 to 20240613,
1200 frames: 34 s) in three states. "A1 off" is the same build with the factor forced to 1: the physics of P3a (the
three seeds of the lab baseline's "after P3a" table are reproduced). The burning temperatures are the core
temperature of the stats in the readings (every 10 frames), the median over those of the burning plateau.

| 34 s, three seeds | P3a physics (A1 off), old defaults | A1 on, old defaults | **A1 on, new defaults** |
|---|---|---|---|
| core T while H burns, median (MK) | 58.3, 52.3, 53.6 | 22.1, 45.4, 30.5 | **14.5, 15.7, 15.8** |
| highest core T (MK) | 119, 88, 101 | 300, 209, 213 | 247, 269, 170 |
| core T in the last quarter (MK) | 78.8, 52.1, 54.8 | 259, 171, 172 | 101, 155, 47.5 |
| hydrogen left of 400 000 | 20 153, 121 539, 99 669 | 3 921, 47 926, 41 089 | 3 257, 60, 430 |
| helium / carbon at the end | 92 948 / 544, 69 815 / 0, 75 628 / 4 | 486 / 32 567, 3 059 / 28 366, 1 892 / 29 348 | 25 997 / 24 499, 2 510 / 32 664, 26 812 / 24 165 |
| peak fusions per second | 66 000, 35 000, 36 000 | 107 000, 100 000, 115 000 | 637 000, 615 000, 683 000 |

- **A1 alone runs away.** With the old G and lambda_0 the star burns hydrogen at 22 to 45 MK (the helium it makes
  lowers the dispersion at which the rate is the same), then the carbon and the helium read 2.65 and 3.4 times their
  dispersion, so the core of the star is read at 170 to 300 MK for the last 15 s.
- **Burning temperatures after the minimal recalibration** (the same runs, 1200 frames, and the three seeds again for
  2000 frames, 56 s):

  | | seed 1 | seed 2 | seed 3 |
  |---|---|---|---|
  | H, core T while it burns (MK), 34 s / 56 s | 14.5 / 14.5 | 15.7 / 14.9 | 15.8 / 15.7 |
  | H, weighted median over the hydrogen consumed (MK) | 17.7 / 18.0 | 18.6 / 19.0 | 18.0 / 18.0 |
  | He, weighted median over the carbon made (MK), 34 s / 56 s | 59 / 101 | 114 / 123 | 66 / 70 |
  | first helium flash (C + 3 000), seconds | 27.8 | 24.9 | 21.0 |

  The hydrogen burns at 15 MK as the core reads it, and at 18 MK weighted by what is burnt (the envelope that falls
  in burns a little hotter than the plateau). The helium flash is violent and short and its temperature varies a lot
  from seed to seed (59 to 123 MK for the weighted median, up to 170 to 260 MK at the peak: the carbon it leaves
  reads 3.4 times its dispersion and carbon does not burn here, so the ash stays "hot"): ignition near 100 MK is the
  typical value, not a tight one. The star burns all its hydrogen within 34 s (0.0 to 0.8 % left, against 5 to 30 % in P3a).
- **How G and lambda_0 were chosen.** 2 or 3 seeds of 1200 to 2000 frames per setting
  (`baseline.protostar.default-cloud-tuning`): the core of a hydrogen star settles at about 1.6 MK per unit of G (with
  lambda_0 = 4e-3, G 5: 7 to 10 MK, 8: 13, 8.5: 14 to 16, 9: 14.5 to 15.7, 9.5: 14 to 15.5, 13.85: 21 to 25), set by the virial temperature of the
  collapse and not by lambda_0, which only has to be large enough for hydrogen to burn at that temperature (lambda_0
  = 4e-3 and 7e-3 give the same plateau, 12 to 13 MK at G = 8; 1.5e-4 needs 55 MK). G = 9 sits at 14.5 to 15.8 MK, and
  the helium ignites, in two or three of the seeds, within the 34 s of the baseline (G 8: not within 56 s in one
  seed). The helium law, the feedback, the cooling and the opacity were left alone.

## Cost

The passes changed little: the gas pass reads the same nine texels of the composition (it kept `.x` next to the `.z` it
already took), computes one division and a mix per cell; the heat pass reads one more texel per cell; `gasAt()` takes
the factor from the heat texel it fetched already (no extra fetch per particle, and no ninth sampler in the velocity
pass); the reduction reads one texel per block when it finds a denser cell. All of it is per cell of a 128 x 128 grid, a
few hundred thousand operations per substep against the 400 000 particles of the deposits and of the particle passes.

`perf.protostar.400k` (400 000 particles, two substeps per frame; the simulation alone, the median of 4 chunks of 30 frames,
the GPU waited for at the end of each), the commit before the change (`9109727`) and this branch alternated, 6 pairs each
time, the order swapped at each pair, each run a fresh page, under the GPU lock:

| | old build | new build | paired difference (new - old) |
|---|---|---|---|
| **A**, each build with its own defaults (the new ones are G = 9, lambda_0 = 4e-3), simulation, ms | 8.51 (8.32 to 9.46) | 7.21 (7.00 to 7.73) | **-1.14** (-2.37 to -0.71), new slower in 0 of 6 |
| the same, whole frame, ms | 9.33 (8.79 to 10.00) | 7.34 (7.00 to 7.62) | -2.00 (-2.38 to -1.46) |
| **B, C and D**, the same physics (`?perfVariant` gives the new build G = 13.85, lambda_0 = 1.5e-4 and the factor off), simulation, ms, 3 x 6 pairs | 25.14 (17.2 to 26.1) | 24.12 (17.0 to 25.5) | **-0.25** (-8.9 to +7.0), new slower in 6 of 18 |
| the same, whole frame, ms | 30.00 | 29.34 | +0.06 |

- **A** is the cost of what the user gets: the new defaults make a colder, less crushed core in the window the probe times (1.5 s of
  warm-up then 4 x 30 frames), so the frame is cheaper (the deposit of many particles into a few cells serializes in the blending
  hardware: see the baseline). It says nothing of the shaders, and the benchmark of the first visit, which times the default
  cloud, will find a little more room.
- **B, C and D** are the cost of the shaders alone, on the same dynamics. They ran while the GPU sat at 734 MHz (P5, 25 ms per frame
  instead of 8: another user of the machine, or the driver; the same old build gave 8.5 ms an hour before in A; D, run on an idle
  machine afterwards, was in the same state), which makes every figure three times larger and the spread wider than in A: the paired difference is -0.25 ms with a spread of +-8 ms,
  so the change is not measurable at this noise, and is under 3 % at most. What the passes do predicts less than that.
  The `nvidia-smi` state at the time was P5 with the SM clock at 734 MHz of 1949.

## Reproducing

    npx vite --port 5208 &
    LAB=http://localhost:5208/particle-simulator/lab.html
    # Acceptance 2 (4 s) and 1 (10 s)
    node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.molecular-weight,protostar.ignition-gas,baseline.protostar.ignition-ratio"
    # Acceptance 3: the default cloud under variants, three seeds (about 30 s per run of 1200 frames)
    V='[{"name":"A1 off, old defaults","molecularWeight":false,"overrides":{"gravity":13.85,"fusionRate":0.00015}},
        {"name":"A1 on, old defaults","overrides":{"gravity":13.85,"fusionRate":0.00015}},{"name":"A1 on, new defaults"}]'
    node scripts/run-lab.mjs --url $LAB --query "scenarios=baseline.protostar.default-cloud-tuning&cloudVariants=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$V")"

Cost: the commit before the change (`9109727`) extracted with `git archive` to a directory of its own, served by a
second development server, and `perf.protostar.400k` alternated between the two builds, the order swapped at each
pair; the page takes `?perfVariant={"molecularWeight":false,"overrides":{"gravity":13.85,"fusionRate":0.00015}}` to run the
new build with the old physics. On a shared GPU, serialize every run with `flock` on a lock file that the other users
take, and check first that no headless Chrome is left over (`pgrep -fa -- --headless`).
Renderer string of every number above: `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)`,
headless Chrome, `EXT_float_blend` available, area 1024 x 768 px.

## Limits and what P3b-2 should know

- **The factor's own noise is not corrected.** A neighborhood's composition is sampled by its particles: with a
  few percent of helium among hydrogen the share of helium in a cell is a Poisson number and `T` carries it, times
  the exponent of the law. The correction of A3 is that of the dispersion's Gamma law only.
- **The stats' core temperature and the glow are `T`, the energy diagnostics are not**: nothing in the energy
  bookkeeping (kinetic energy from the moments, the heating by scaling, the cooling) reads the molecular weight; the
  virial ratio and the energy drift are unchanged by A1.
- **Carbon ash reads hot.** Nothing burns carbon, and its factor is 3.4: the core of the default cloud ends at 140
  to 160 MK. That is the model's honest reading of a carbon gas of a dispersion of 40 to 45 MK-equivalent; the glow
  range (1 to 7 T0) saturates there. A2 or later may want a carbon-burning stop or a glow range of its own.
- **The default recalibration is minimal on purpose**: G and lambda_0 only. The helium law (lambda 3.75e-5, alpha 16),
  the feedback (0.146), the cooling (0.51), the opacity (5.32), the alpha of hydrogen (2.8) and `T_ref` are as
  before. For A2: the temperatures of the laws are now thermometer temperatures, so `T_ref` = 15 MK for the
  proton-proton chain means what it says; the gas at 1 T0 hydrogen burns at 0.12 per second per rho0 = 4e-3 x 30 rho0,
  which is why the plateau sits at T0 and no longer at 3.7 T0. The local exponent for the noise correction is still
  the law's `alpha` (`reactionExponent[k]` in `fusionRateOf`); with Gamow it is the local one. The plateau's
  temperature is set by G (about 1.6 MK per unit), the helium ignition by the helium law at the density the core
  reaches (100 rho0 and above): changing the helium steepness moves the second, not the first.
- **Half-float devices** carry the error of their sums into `T` (above, 1e-3 to 1e-2 at 400 particles per cell, more
  in a dense core), amplified by the exponent: 1 % of T is 16 % of the helium rate. A GPU without `EXT_float_blend` was
  not available to run the cloud; the forced half-float path of the lab was.
- **Saved configurations and the first-visit benchmark** keep their own values: a configuration saved with the old
  G and lambda_0 runs on the new physics with the old defaults (the star then burns hot, see the table), and the
  benchmark's cap measures the default cloud, whose cost the change moves a little (see Cost).
