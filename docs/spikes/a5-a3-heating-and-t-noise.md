# Spike A5 and A3: heating by scaling, and the noise of the temperature

Phase P3a of the improvement plan. Two changes of the protostar's gas physics, both validated in the lab
([lab.md](../lab.md)) on gases of known temperature:

- **A5**, the fusion feedback heats by scaling the velocities' deviations from the local mean velocity
  instead of kicking every particle in a random direction;
- **A3**, the temperature that feeds the fusion rate is corrected for its noise: the rate is divided by
  the bias that the noise of T puts on a power of T, and T is averaged over time.

The physics of the default cloud changes (see "The default cloud"); no parameter, slider or text does.

## Verdict

| | Acceptance | Result |
|---|---|---|
| A5, energy | gained = q dt per cell to 1e-3 | **4.4e-6** per cell on isolated cells (hot: to float rounding; cold cells, which get the kick, 2.2e-3: the kick's cross term with their thermal velocity, bounded by 5e-3); **-3.2e-4** on a uniform gas of 1 400 particles per neighborhood, -1.6e-3 at 355 (a statistical error that falls as 1 / N) |
| A5, momentum | not changed beyond float noise | **1.7e-7** of the thermal momentum on isolated cells (rounding); 5e-6 of N sigma over a uniform gas (7.7e-5 with the kick: 15 times more), the residual of the interpolation between neighboring cells |
| A5, noise | none added | the energy gained per cell of a uniform gas scatters by 7.5 % (36 % with the kick): the 7.5 % is the sampling of T by the particles of the cell, not noise of the heating |
| A3, bias | mean rate within 5 % of the true rate, N = 100 to 6 400, alpha = 4 and 40 | **within 2.1 % in all 14 cases** (standard errors 0.07 to 1.8 %); uncorrected, the rate is up to 51 times too high |
| A3, smoothing | tau much below the cooling time, in seconds | **tau = 0.1 s** (cooling time 2 s at the lowest density, 24 s in the core); weight 1 - exp(-dt / tau), never per step |
| Cost | simulation ms per frame at 400 000 particles | **not measurable**: 8.62 against 8.57 ms (median of 6 alternated pairs, spread 0.9 ms); whole frame +0.6 ms, not shown to come from the change |

## A5: heating by scaling

### The change

`protostar-velocity.frag`, the "Fusion feedback" block. With `q = gas.heat T0` (the heating per unit mass,
px^2/s^3), twice the energy per unit mass added in a step is `E = min(2 q dt, vmax^2)`: energy per unit
mass is |v|^2 / 2. The dispersion of the neighborhood, `T = mean |v - u|^2` around its mean velocity `u`
(`gas.v`, the same that the cooling already uses), grows by exactly `E` if every deviation is multiplied
by `s = sqrt(1 + E / T)`, so the kinetic energy per unit mass grows by `E / 2 = q dt`: the unit check the
plan asked for, `T / 2` being the energy of the disordered motion. The mean velocity does not move. The
`T` used is the one left after the cooling of the same step (`gas.t exp(-2 k dt)`), so that the energy
added is q dt with the cooling on as well. A cell colder than `PROTOSTAR_HEATING_T_FLOOR` (1e-3 T0, about
15 kK) cannot be scaled (nothing to scale at T = 0) and gets the old kick: a random direction, magnitude
`sqrt(E)`, the same energy on average. The speed limit (`vmax`) bounds `E`, which keeps a saturated half-float
power grid finite, and still clamps the speed afterwards. `heating.ts` is the pure twin.

### Acceptance (lab, `protostar.heating`)

Gas set up directly (`debugInitialState`), gravity and cooling off, hydrogen that fuses at 0.5 per second and
per rho0 whatever its temperature (the exponent set to 0 below the slider's minimum), feedback 1, one
substep of 1/60 s, the velocities read before and after; the grids the substep read are read as well, so the
reference is the gas a particle really saw.

| | Scaling (shipped) | Random kick (before) |
|---|---|---|
| 768 blobs of 200 particles at the center of isolated cells, hot (T = 0.3 to 3 T0, bulk velocity up to 100 px/s): energy gained over q dt, worst blob | **4.4e-6** | 1.37 (137 %) |
| the same, momentum gained over the blob's thermal momentum n sigma, worst blob | **1.7e-7** | 0.155 |
| 64 cold blobs (T = 1e-5 T0): energy in the frame of the blob over q dt | 2.2e-3 | 2.2e-3 (the same path) |
| uniform gas, 400 000 particles (355 per 3 x 3 neighborhood): energy over sum q dt | -1.6e-3 | -1.0e-3 |
| uniform gas, 1 600 000 particles (1 419 per neighborhood): energy over sum q dt | **-3.2e-4** | -5.2e-3 |
| the same, standard deviation over the cells of the energy gained over q dt (cells of 8 x 8 px with at least 10 particles) | 0.075 | 0.36 |
| the same, net momentum gained over N sigma | 5.2e-6 | 7.7e-5 |
| the GPU velocity against the double-precision twin of the shader, over sigma | 7e-7 | |

Reading:

- A blob at the exact center of a cell reads that cell's gas state alone (the four bilinear weights are 1, 0,
  0, 0), and its 200 particles are standardized (exact sample mean and variance), so the energy gained must
  be q dt per particle: it is, to float32 rounding, and the momentum does not move. The old kick put in
  137 % too much or too little in a blob of 200, and moved its momentum by 15 % of its thermal momentum.
- The uniform gas has all the interpolation of the real thing (cloud-in-cell deposit, 3 x 3 sums, bilinear
  reading), where a particle's own deviation is not exactly the neighborhood's dispersion: the energy gained
  differs from q dt by a statistical -0.6 / N. At 1 400 particles per neighborhood that is -3e-4, inside the
  1e-3 target; at 355, -1.6e-3. The error is the same in the random kick (the kick's own scatter is larger).
- The residual momentum of the uniform gas, 5e-6 of N sigma, is not rounding: neighboring cells have slightly
  different temperatures, so the particles of one are scaled a little more than the particles of the other,
  and the deviations from a particle's interpolated mean do not sum to exactly zero. The random kick's
  net momentum (a random walk) is 15 times larger. The neighborhood's momentum is conserved exactly where the
  neighborhood is one cell (the blobs), and to this level where it is not.
- The cold cells' kick is the old behavior, kept as a fallback; the lab forces it everywhere (the floor raised
  to 1e30) to give the "kick" column.
- The same scenario passes on SwiftShader (blobs 3.7e-6, 1.5e-7; a uniform gas of 89 particles per
  neighborhood: -6.5e-3, the 1 / N error again).

## A3: the noise of the temperature

### The change

1. **Gas pass** (`protostar-gas.frag`) with a second attachment, `(T averaged over time, N, 0, 0)`. N is the
   effective number of particles of the 3 x 3 neighborhood, read from the m^2 channel of the composition
   deposit (the second deposit of [A1](a1-second-deposit.md)); two targets of two attachments take turns
   from one substep to the next, the previous averaged T being read from the other one. `common.gridGas`
   and the new `common.gridThermo` follow (shared by reference: the reduction's `gridGas` is the same
   uniform object). The averaged T and N are read only by the shaders that compute a fusion rate (the
   power deposit and the position pass, `GAS_THERMO`): the velocity pass keeps its eight samplers and
   reads the instantaneous T.
2. **Bias correction**: `fusionRateOf` subtracts `ln bias(N, alpha)` from the logarithm of the rate
   (`noiseBias.ts` and its GLSL twin).
3. **Average over time**: `T_avg += (1 - exp(-dt / tau)) (T - T_avg)` per cell, `tau = 0.1 s`
   (`PROTOSTAR_TEMPERATURE_TAU`). A cell that held no gas at the previous step, and the first substep of a
   run, take the instantaneous T.

### The bias, the effective number of particles, and what the lab measured

The plan's bias for N independent particles is `Gamma(N + alpha) / (Gamma(N) N^alpha)`, 6.6 for N = 400 and
alpha = 40. Three things stand between that formula and the gas pass, and the lab measured each:

- **N is not the count.** The estimate that a particle sees is a weighted mean: the cloud-in-cell weights
  of the deposit, the sum over 3 x 3 cells and the bilinear interpolation at the particle spread its weights,
  which makes it less noisy than the mean of as many independent particles. Its effective number of
  particles is `1 / sum w^2`: 1.27 times the count of a 3 x 3 neighborhood for a particle at a cell center,
  1.65 between four cells (computed for a uniform gas), and **1.5 fitted to the uncorrected bias**
  (`PROTOSTAR_NOISE_N_SHAPE`; the per-case fits are 1.5, 1.5, 1.5, 1.5, 1.4, 1.2 for N = 200 to 6 400 at alpha = 40,
  and the N = 6 400 value is the least certain: its bias is 1.10 +- 0.01). Where the particles have different masses,
  `(sum m)^2 / sum m^2` is the number of particles that carry the noise: that is the choice made, over
  `sum count`, which would count a helium in a hydrogen gas as much as the four times heavier mass that it is
  (they are equal for equal masses). The sum of m^2 is the second deposit's `z` channel, which is linear in the
  cloud-in-cell weight `w` and not `w^2`: the factor 1.5 absorbs the difference.
- **One degree of freedom goes to the mean.** T is the dispersion around the mean of the same particles, a
  Gamma law of shape N - 1 and mean T (N - 1) / N, which multiplies the rate by `(1 - 1/N)^alpha` (0.90 at
  N = 400 and alpha = 40, 0.67 at N = 100). It is in `logNoiseBias`. For a gentle exponent the net bias is
  below 1 (alpha (alpha - 3) / 2N): the rate of the default hydrogen law, alpha = 2.8, is corrected upward by
  0.3 / N.
- **The correction acts per cell** (the N of each particle's cell), so the mean of the corrected rates is not the
  uncorrected mean divided by the bias of the mean N: neighborhoods with fewer particles are corrected more.
  The lab measures the mean of the real thing.

### Acceptance (lab, `protostar.temperature-noise`)

A uniform gas of Maxwellian hydrogen at T = T_ref (15 MK), at rest, gravity, cooling and feedback off,
`lambda = 0.05` per second and per rho0: the true rate per particle is `lambda rho`. 7 densities (N = particles
per 3 x 3 neighborhood from 100 to 6 400, the box shrinking at the dense end to stay under 1.8 million
particles), alpha = 4 and 40 (set below the sliders' range of 6 and 45 for the first). Each reading draws a
new gas and deposits it twice from the same particles, with the correction off and on; the mean rate of the
particles of the interior cells over the true rate is averaged over readings until its standard error is
1 % (4 to 150 readings; the heavy tail of the rate at a large alpha and a small N needs the most, because
the mean is dominated by the rare hot neighborhoods: the spread of one neighborhood is
`sqrt(exp(alpha^2 / N) - 1)`, 54 at N = 200 and alpha = 40).

| N per 3 x 3 neighborhood | alpha | readings | uncorrected rate / true | the plan's bias for N independent particles | corrected rate / true |
|---|---|---|---|---|---|
| 100 | 4 | 4 | 1.011 +- 0.003 | 1.061 | 0.998 +- 0.003 |
| 200 | 4 | 4 | 1.011 +- 0.002 | 1.030 | 1.005 +- 0.002 |
| 400 | 4 | 4 | 1.005 +- 0.004 | 1.015 | 1.002 +- 0.004 |
| 800 | 4 | 4 | 1.002 +- 0.002 | 1.008 | 1.000 +- 0.002 |
| 1 600 | 4 | 4 | 1.002 +- 0.001 | 1.004 | 1.001 +- 0.001 |
| 3 200 | 4 | 4 | 1.002 +- 0.001 | 1.002 | 1.002 +- 0.001 |
| 6 400 | 4 | 4 | 1.002 +- 0.001 | 1.001 | 1.002 +- 0.001 |
| 100 | 40 | 828 | 50.7 +- 0.3 | 1 031 | **1.021 +- 0.018** |
| 200 | 40 | 518 | 10.45 +- 0.08 | 39.1 | **1.011 +- 0.010** |
| 400 | 40 | 87 | 3.34 +- 0.03 | 6.61 | **1.002 +- 0.010** |
| 800 | 40 | 21 | 1.82 +- 0.02 | 2.61 | 0.988 +- 0.010 |
| 1 600 | 40 | 4 | 1.37 +- 0.01 | 1.62 | 1.009 +- 0.007 |
| 3 200 | 40 | 4 | 1.18 +- 0.01 | 1.28 | 1.013 +- 0.009 |
| 6 400 | 40 | 4 | 1.10 +- 0.01 | 1.13 | 1.019 +- 0.010 |

The two cases with the fewest particles at alpha = 40 need hundreds of readings (the lab's defaults: 900 readings or 150 s per case); the others converge in a few.

The uncorrected bias is below the plan's figure for N independent particles at every N: 6.6 at N = 400
and alpha = 40 is 3.56 once N is the effective number of particles (601), and 3.34 once the degree of freedom
lost to the mean is counted too: the shipped model, and the measured 3.344 +- 0.033. Taking the plan's
bias for the plain count as it is would have over-corrected the rate by 2 at this N and by 20 at N = 100.

### The average over time (lab, `protostar.temperature-smoothing`)

A cool thermal gas that moves (400 000 particles, T = 0.25 T0, no gravity or cooling), the relative variance
of T over the interior cells with the instantaneous T and with the average, once it has settled:

| tau (s) | weight per step of 1/60 s | variance of T, instantaneous | variance of T, averaged | gain | mean of the average over the instantaneous |
|---|---|---|---|---|---|
| 0 | 1 | 1.69e-3 | 1.69e-3 | 1.00 | 1 |
| 0.05 | 0.284 | 1.71e-3 | 1.51e-3 | 1.13 | +0.14 % |
| 0.1 | 0.154 | 1.73e-3 | 1.29e-3 | 1.34 | +0.31 % |
| 0.2 | 0.080 | 1.77e-3 | 1.00e-3 | 1.77 | +0.68 % |
| 0.4 | 0.041 | 2.12e-3 | 7.7e-4 | 2.75 | +2.0 % |

The average removes noise only as fast as a neighborhood renews its particles. The autocorrelation of the
instantaneous T over time is 0.87 at 4 frames, 0.65 at 8, 0.35 at 16 (a correlation time of about 0.3 s at this
temperature, which scales as 1 / sqrt(T): about 0.08 s at the 50 MK of the default star), and the gain in variance
is `1 + tau / tau_c`: 1.34 at tau = 0.1 s here, about 2 at the temperature of the core. The correction does not
credit this gain (that would need tau_c, a function of the gas): it is a conservative choice, the rate a
little low where the average works. The lag is the price: the mean of the averaged T trails the
instantaneous one by tau times its slope (+0.3 % at tau = 0.1 s in a gas whose T falls slowly).

`tau = 0.1 s` is 3.5 frames of the default speed, and 4 % of the cooling time at the lowest density
(2 s: `1 / cooling`; 24 s at the core's density). The default cloud with other constants is in the next section.

## The default cloud

`baseline.protostar.default-cloud-variants` runs the default cloud (400 000 particles, 1200 frames) with each
part of the change switched on in turn, with three seeds. The first variant switches all of it off (kick,
no correction, no average) and reproduces the recorded baseline: the readings of the first 250 frames are
identical to the last digit (the later ones diverge as any two runs of the chaotic burn history do, through
the unpredictable frame at which the asynchronous read-back lands).

| Variant (3 seeds each) | highest T of the run (MK) | peak fusions per second | T in the last quarter (MK), mean (range) | H left at 34 s (of 400 000), mean |
|---|---|---|---|---|
| before P3a: kick, no correction, no average | 92, 105, 102 | 119 000, 141 000, 128 000 | 56.7 (56.5 to 57.1) | 72 000 |
| scaling only | 93, 105, 102 | 121 000, 116 000, 130 000 | 57.8 (54.8 to 63.1) | 87 000 |
| scaling + correction | 93, 105, 102 | 121 000, 116 000, 130 000 | 57.8 (53.8 to 63.3) | 87 000 |
| + average, tau = 0.05 s | 104, 88, 101 | 91 000, 59 000, 65 000 | 63.0 (52.6 to 77.4) | 74 000 |
| + average, tau = 0.1 s (shipped) | 119, 88, 101 | 66 000, 35 000, 36 000 | 61.9 (52.1 to 78.8) | 80 000 |
| + average, tau = 0.2 s | 90, 101, 100 | 42 000, 41 000, 29 000 | 64.2 (54.1 to 69.8) | 78 000 |

- The star **ignites as before**: its highest temperature is the first collapse's (at 2.27 s, 88 to 105 MK) in 13
  of the 18 runs; in the other five a later episode is hotter (at 8 to 21 s, 93 to 119 MK).
- **Heating by scaling** barely moves the plateau (57.8 against 56.7 MK in the last quarter, three seeds), and
  the correction does not move it at all: the default cloud's core holds thousands of particles per
  neighborhood, where the correction is a fraction of a percent (alpha = 2.8) to a few percent (alpha = 16 for
  helium).
- **The average over time** lowers the first burst's peak rate (121 000 fusions per second, then 35 000 to 66 000
  with tau = 0.1 s, 24 000 to 41 000 at 0.2 s): the first collapse's temperature spikes are real, fast
  and short, and the average takes the top off them. The plateau of one of the three seeds goes up to 79 MK
  (hydrogen exhausted at 34 s, 20 000 left of 400 000, against 90 000), the two others stay at 52 to 55 MK. With three
  seeds that is a wider spread, not a shift of the mean that can be told; no default was retuned.

## Cost

`perf.protostar.400k` (400 000 particles, two substeps per frame, GTX 1060), the simulation alone (`simulationMsPerFrame`,
the median of 4 chunks of 30 frames, the GPU waited for at the end of each) and the whole frame with the rendering layers,
on the commit this one comes from (`5ed76ae`) and on this branch, alternated, 6 pairs (the order swapped at each pair), the
same hour, each a fresh page:

| Pair | Simulation before | after | Whole frame before | after |
|---|---|---|---|---|
| 1 | 8.66 | 8.74 | 8.51 | 8.57 |
| 2 | 8.58 | 8.29 | 8.36 | 9.56 |
| 3 | 8.17 | 8.58 | 9.54 | 9.43 |
| 4 | 8.83 | 8.65 | 8.61 | 9.24 |
| 5 | 7.96 | 9.02 | 8.99 | 9.84 |
| 6 | 8.56 | 8.33 | 8.83 | 9.41 |
| **median** | **8.57** (7.96 to 8.83) | **8.62** (8.29 to 9.02) | **8.72** | **9.42** |

The simulation is not measurably slower: the paired median difference is -0.05 ms (from -0.29 to +1.06; the new code is
slower in 3 pairs of 6), the spread between runs (0.9 ms) is larger than the difference. That is what the passes predict: the
gas pass reads 9 more texels per cell on 128 x 128 cells and writes a second attachment, and the fusion rate adds about thirty
operations and two logarithms per fusing particle, twice per substep; the heating still costs one square root per
particle. The whole frame reads +0.6 ms (slower in 5 pairs of 6, from -0.1 to +1.2): the rendering layers were not touched, and
the cloud has a different history in the first 150 frames now (a different core), so this is read as a state of the cloud and
noise rather than a cost of the change, but it is not shown to be. Compare with a run of the code before taken the same hour, not
with a table recorded another day.

## Reproducing

    npx vite --port 5206 &
    LAB=http://localhost:5206/particle-simulator/lab.html
    # A5 (5 s), the bias (5 minutes), the average (25 s), the default cloud's variants (4 minutes)
    node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.heating,protostar.temperature-smoothing"
    node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.temperature-noise"
    node scripts/run-lab.mjs --url $LAB --query "scenarios=baseline.protostar.default-cloud-variants"
    # fewer readings per case (quick look; N = 100 and 200 at alpha = 40 are then not resolved)
    node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.temperature-noise&noiseReadings=150&noiseBudgetSeconds=40"

On a shared GPU, serialize every run with `flock` on a lock file that the other users take, and check first that
no headless Chrome is left over (`pgrep -fa -- --headless`). The cost is the `simulationMsPerFrame` of
`perf.protostar.400k` run on this branch and on the commit it comes from (`5ed76ae`, extracted with
`git archive` to a directory of its own and served by a second development server), alternated, 6 pairs.

## Limits and what P3b should know

- The correction models the temperature as the mean of independent exponential numbers (a Gamma law) with
  one effective number per cell. It knows nothing of correlated particles (a rotating or converging flow whose
  deviations from the 3 x 3 mean are not noise), and it is calibrated on a uniform gas. N = 100 at alpha = 40
  is where it is least certain.
- The rate's density factor is noisy too (Poisson counts): `rho^n` is biased by about `n (n - 1) / 2N`, 0.5 % for
  the three-body helium law at N = 100... not corrected.
- **For P3b (A1, A2).** A1: `gridComposition.x` (m / mu) is not read yet; the temperature in the shaders is still
  the dispersion in px^2/s^2 and `mu` multiplies it where A1 wants it: the effective number of particles is
  `(sum m)^2 / sum m^2` over the 3 x 3 sum and is already per cell, in `gridThermo.y`. A2: the correction takes the
  local exponent `alpha = d ln rate / d ln T` as an argument (`logNoiseBias(n, alpha)` in both languages): pass
  the Gamow exponent instead of `reactionExponent[k]` in `fusionRateOf`. The T that feeds the rate is `gridThermo.x`,
  the instantaneous one is `gridGas.y`; A1's mu goes into both. The average's time constant and
  N's shape factor are constants of `config.ts` to revisit with the recalibration.
- The lab's switches (`temperatureTau`, `common.noiseCorrection`, `heatingTFloor`) are given their values back at
  each restart; the ablation scenario sets only the ones a variant changes.
- The half-float path (no `EXT_float_blend`) sums m^2 in half floats, which stagnates in a dense cell (see A1's
  spike): N is then too large in the dense core, where the correction is small anyway.
