# Spike A2: Gamow rates with the composition

Phase P3b-2 of the improvement plan. The protostar's fusion rate was a power law with an adjustable exponent,
`lambda * rho^n * (T / T_ref)^alpha`, on the total density. This phase replaces it with the temperature laws of the real
reactions, per nucleus and normalised at a reference temperature, with the mass fractions of the fuel in them, and
recalibrates the defaults that A1 and A2 invalidated. Validated in the lab ([lab.md](../lab.md)) on thermal gases of known
composition and on the default cloud.

**Verdict.** The rates are Gamow's, the fuel fractions are in them, the exponents are no longer parameters and the lab measures
them where the theory puts them (within 0.02 %). Two things that the plan did not foresee came out of the lab: the ignition
temperature of hydrogen is *not* "almost independent of lambda" (a decade of lambda divides it by 1.7 to 2.6; only helium's is
nearly a threshold, 1.06 per decade), and dividing a triple-alpha rate by the bias of the noise of T leaves a factor of 3.5 at 150
particles (16 % at 600), because the bias is taken at the estimate: the rate is now replaced by its exact unbiased estimate, which the
lab finds within 2 % of the truth from 200 particles per neighborhood. The recalibration of the defaults, on the combined code (the
Gamow laws, the integration of P5a and the initial conditions of A8), is small: **only lambda_He moves, 3.75e-5 -> 2.5e-4** (a pure
helium gas of 20 rho0 ignites at 0.1 fusions per second at exactly 100 MK; hydrogen at 15.9 MK; a ratio of 6.3 against the real 6.67), and the
glow range widens for the carbon ash. Over twelve seeds of the default cloud the hydrogen plateau sits at 18.2 MK (median; 9 seeds of 12 within
10 to 20 MK, the target) and ten seeds have their helium flash within 34 s (A1's defaults on the Gamow laws: 5 of 6, 28 s against 23 s). What
the recalibration could not do: the first collapse still burns 35 % of the hydrogen in a burst of 780 000 fusions per second (37 % and 32 000
per second with the power laws: the steeper Gamow law at 5 to 9 MK turns the same burn into a flash), the plateau of one seed in six runs hot
(39 MK), and the helium flash reads 150 to 350 MK for a reading or two. Every other parameter scanned (G, lambda_0, feedback, cooling, opacity,
the time constant of T) either did not beat these values within the spread of six seeds, or broke something (below). The carbon ash reads 60 to
220 MK and nothing burns it (carbon ignites at 600 MK).

## The laws

Per fusing particle, with `rho` in rho0 (the density of the grid: the surface density while the cloud has a fixed thickness; a
later phase, A11, will use `Sigma / (2 h)`), `X` the mass fraction of the fusing type in the 3 x 3 neighborhood and `T` the
temperature of A1 (the dispersion times mu / mu_H, averaged over time):

    r = lambda (rho X)^n f(T) / f(T_ref),        f(T) = T^-p exp(-b (T / unit)^-q)

| | Proton-proton chain | Triple alpha |
|---|---|---|
| f(T) | `T6^(-2/3) exp(-33.8 T6^(-1/3))`, `T6 = T / 1 MK` | `T8^(-3) exp(-44.0 / T8)`, `T8 = T / 10^8 K` |
| (p, b, q, unit) | (2/3, 33.8, 1/3, 1 MK): non-resonant, Gamow's peak | (3, 44.0, 1, 10^8 K): resonant (8Be, 12C) |
| `T_ref` (where `r = lambda (rho X)^n`) | 15 MK | 100 MK |
| n, fuel | 1, hydrogen: `r` per proton goes as `rho X` | 2, helium: `r` per alpha goes as `(rho Y)^2` |
| exponent `d ln r / d ln T = q b (T/unit)^-q - p` | **3.90 at 15 MK**, 5.0 at 8 MK, 3.0 at 30 MK | **41.0 at 100 MK**, 60 at 70 MK, 19.0 at 200 MK |

`lambda` is the old slider, in the same units and with the same reference (the rate of one particle at `T_ref` and `rho0`), now
in pure fuel: `lambda_0` (`fusionRate`, per second, log slider) and `lambda` (`heFusionRate`). The exponent sliders
(`fusionExponent`, `heFusionExponent`) are gone from the declaration, the five catalogs, the tests and the lab; a saved
configuration that has them keeps working (`sanitizeConfig()` ignores unknown keys, so they are dropped) but with the new law
(see the limits). CNO is not in the table (it needs a third fuel channel); a row `{ from, to, law, ... }` and a third entry of
`PROTOSTAR_FUEL_CHANNELS` would add it.

The shader (`fusionRateOf`) computes `tau = T / T_ref`, `tau^-q = exp(-q ln tau)` (one more exponential than the power law: the
cube root of the plan is `exp(-ln(tau) / 3)`), `ln f(T) / f(T_ref) = -p ln tau - G (tau^-q - 1)` with `G = b (T_ref / unit)^-q`
(13.71 for the proton-proton chain, 44 for the triple alpha: `reactionBarrier`), the local exponent `q G tau^-q - p` for free,
and the noise correction at that exponent. `reactions.ts` (`lawAt()`, `fusionRate()`) is the twin; `ignition.ts` inverts it by
bisection on `ln T` (there is no closed form any more).

## The fuel fractions

The composition deposit (second attachment of the moments pass, [A1](a1-second-deposit.md)) had the channels
`(sum m (1+Z)/A, sum count, sum m^2, 0)`. The gas pass reads `m/mu` (the temperature's factor of [A1](a1-mean-molecular-weight.md))
and `m^2` (the effective number of particles of [A3](a5-a3-heating-and-t-noise.md)); **nothing read the count**. The channels are
now `(sum m (1+Z)/A, sum m [fuel of the first reaction], sum m^2, sum m [fuel of the second reaction])`: the hydrogen mass and
the helium mass, `speciesFuel[k]` being (1, 0), (0, 1) or (0, 0) from the reaction table (`reactionArrays().fuel`: a type's
channel is the rank of its reaction). The unread count is dropped (the lab keeps the weighted number of particles in the CPU
reference, `DepositReference.occupancy`).

- The gas pass divides the 3 x 3 sums of the hydrogen and helium channels by that of the mass, **the same ratio pattern as the
  factor mu / mu_H**: a half-float deposit errs alike in numerator and denominator. `X` and `Y` go to a **third attachment of the
  gas pass** (`gridFuel`, `(X, Y, 0, 0)`: the second attachment has only one spare channel and the heat pass needs the factor), and
  `gasAt()` interpolates them with the mass weights like `T` (`Gas.fuel`; read only where a rate is computed, `GAS_THERMO`).
- **Custom elements** of the element editor, carbon and any other product are the fuel of nothing: their `speciesFuel` is (0, 0),
  they are in neither X nor Y, and they dilute the fuel (X is a share of the mass). A type that is the `from` of no reaction has
  no rate. The rate of a type reads *its own* fraction: a hydrogen in a gas of 20 % hydrogen fuses at 20 % of the pure rate (and a
  helium at 4 %: `Y^2`).
- Pure hydrogen has `X = 1` to the bit (the same deposit value divided by itself), so the clouds of the lab that were pure
  hydrogen read the same law as before in this respect.


## The noise correction at the real exponents

[A3](a5-a3-heating-and-t-noise.md) corrects the rate by the bias that the noise of `T` puts on a power law `T^alpha`. A2 asked to feed
it the local exponent. **That is not enough for helium, in two steps.**

**1. The curvature.** The exponent of the triple alpha falls as the gas heats (`d alpha / d ln T = -44 / tau`, -44 at 100 MK), so the
noise of `T` sees a curved law. The exact expectation over the Gamma law of the estimate (numerical integration,
`tests/gamowRates.test.ts`) against the power law of the local exponent, for helium at 100 MK:

| N (effective particles) | 100 | 200 | 400 | 800 | 1 600 | 6 400 |
|---|---|---|---|---|---|---|
| plain correction, corrected rate / true | 0.16 | 0.52 | 0.80 | 0.93 | 0.975 | 0.996 |
| with the curvature, corrected rate / true | 0.999 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |

`logNoiseBiasCurved()` (both languages) adds the curvature by **Laplace's method around the saddle point of the power law with one
Newton step**; 0.2 % of the bias for N >= 100 against the exact integral, for hydrogen and helium at 80 to 120 MK. It is what the
proton-proton chain uses, and the lab measures its corrected mean rate within 0.4 % of the true one at every N (below).

**2. The bias is taken at the estimate, not at the truth (found by the lab, not by the test above).** `rate(T_est) / bias(T_est)` is
not unbiased: the bias itself depends on `T_est` (through the exponent and the barrier term), and the neighborhoods that overestimate
`T` are the ones that dominate the mean rate and get the smallest bias. On a triple-alpha gas at 100 MK the corrected mean rate
was 3.54 (N = 100 particles per neighborhood, 150 effective), 1.60 (200), 1.16 (400), 1.03 (800), 1.02 (1 600 and more) times the true one
(`protostar.temperature-noise`, `gam1`). The unit test did not see it: it divided by the bias at the *true* temperature. A resonant
law (`q = 1`) has an exact unbiased estimate instead of a correction factor. With `S = N T_est / T_ref` (a Gamma variable of shape
`n = N - 1` and scale `T / T_ref`, whatever `T` is: the dispersion around the mean of N particles has N - 1 degrees of freedom),
`G = b / T_ref` the barrier term at the reference (44 for the triple alpha), and `theta = T_ref / T`, the Laplace transform of the
Gamma density gives

    E[ Gamma(n) / Gamma(n - p) * (S - G)^(n-p-1) / S^(n-1) ] = theta^p exp(-G theta)        (S > G; the estimate is nil below)

so `f(T) / f(T_ref) = e^G` times that is estimated without bias, for every `T` and every `N > p + 3` (it is the uniformly minimum
variance unbiased estimate: nothing unbiased has less spread). `logUnbiasedResonant()` (`noiseBias.ts`, twin of the shader's)
computes its logarithm with Stirling's series and `log1p`, so that nothing large cancels at n = 10^5. It replaces the rate of a law
with `q = 1` where `n > p + PROTOSTAR_NOISE_EXACT_MARGIN`; for the other laws and below, the curved bias is divided out. Checked
against the integral over the Gamma law at 70, 100 and 130 MK and N = 20 to 6 400: the mean is the true rate to 0.1 %
(`tests/gamowRates.test.ts`), where the plug-in correction is 10 % high or more at N = 600. A cell whose `T_est` is below `G / N`
of the reference has no rate at all (a hydrogen-free statement: a helium gas colder than 0.07 T_ref has none anyway).

## Acceptance

All on the real GPU simulation, `protostar.*` scenarios of the lab ([lab.md](../lab.md)), 1 000 000-particle gases unless stated.

**1. The ignition temperature is a logarithmic function of lambda only** (`protostar.ignition-gas`: 36 temperatures of each pure gas; the
plan's "almost independent of lambda" is not what it measures). At a given density a decade of lambda is a decade of the rate: the
ignition temperature of a pure gas of 20 rho0 moves by

| decade of lambda (rate, per second) | 0.01 to 0.1 | 0.1 to 1 | 1 to 10 |
|---|---|---|---|
| hydrogen, T(10 lambda) / T(lambda) | 0.581 (9.2 to 15.9 MK) | 0.502 (15.9 to 31.7 MK) | 0.379 (31.7 to 83.6 MK) |
| helium | 0.947 | 0.944 | 0.939 |

which is `10^(-1 / alpha)` of the local exponent where the gas ignites (5.0 at 9 MK down to 2.4 at 80 MK for hydrogen, 40 for helium), as the law
says (`tests/gamowRates.test.ts` checks it to 1e-8): **1.7 to 2.6 per decade for the proton-proton chain, 1.06 for the triple alpha**. Hydrogen's
ignition is a logarithm of lambda with a slope of 1/4 to 1/3: lambda still sets *where* hydrogen burns, and what keeps the star near 15 MK is
its structure (G), which sets the temperature at which lambda only has to be large enough.

**2. The local exponents are the theory's** (`protostar.local-exponent`): two gases of the same million particles at the same places
5 % above and below each temperature, the rate constant chosen to give 0.2 per second there:

| point | 8 MK (H) | 15 MK (H) | 30 MK (H) | 70 MK (He) | 100 MK (He) | 200 MK (He) |
|---|---|---|---|---|---|---|
| theory, between the two gases | 4.970 | 3.904 | 2.961 | 59.97 | 41.08 | 19.04 |
| measured | 4.969 | 3.904 | 2.961 | 59.96 | 41.07 | 19.04 |

within 0.023 % (tolerance 5 %); the gases' mean rates equal the law (its own twin) within 2.1 % over all the readings and the ignitions
within 0.12 %.

**3. The ratio of the ignition temperatures He/H on pure gases** (`protostar.ignition-gas`, `baseline.protostar.ignition-ratio`; the
real ratio is 100 MK / 15 MK = 6.67), with the calibrated lambda, on the GPU gases of 20 rho0 (the laws' value in brackets): 6.297 (6.293) at 0.1
per second (hydrogen 15.89 MK, helium 100.1 MK), 10.26 at 0.01/s, 4.13 at 0.5/s, 3.35 at 1/s, 1.35 at 10/s; at the lab's old reference point (0.5/s, 60 rho0)
5.41; at 40 rho0 and 0.1/s, 7.25 (a settled core). The two laws differ in steepness and in density exponent (1 and 2), so the ratio is a property
of the point, not of the model: 4.1 to 10.9 over 20 to 100 rho0 and 0.03 to 0.5/s. In dispersion (what a simulation without a molecular weight would
see) the helium gas ignites at 2.38 of the hydrogen's, the 2.65 of A1 taken out.

**4. The corrected mean rate at the real exponents** (`protostar.temperature-noise`, the A3 scenario with the Gamow gases: hydrogen at
15 MK, exponent 3.9; helium at 100 MK, exponent 41; a thermal gas of 100 to 6 400 particles per 3 x 3 neighborhood drawn again for each
reading, the correction off then on):

| particles per neighborhood | 100 | 200 | 400 | 800 | 1 600 | 3 200 | 6 400 |
|---|---|---|---|---|---|---|---|
| H, uncorrected / true | 1.004 | 1.008 | 1.004 | 1.001 | 1.002 | 1.002 | 1.002 |
| H, **corrected / true** | 0.998 | 1.005 | 1.002 | 1.000 | 1.001 | 1.002 | 1.002 |
| He, uncorrected / true | 35.98 | 8.46 | 3.17 | 1.80 | 1.37 | 1.18 | 1.10 |
| He, plain correction at the estimate (before the exact estimate) | 3.54 | 1.60 | 1.16 | 1.03 | 1.02 | 1.02 | 1.02 |
| He, **corrected / true** | **1.053 +- 0.019** | 1.015 +- 0.010 | 1.003 +- 0.010 | 0.987 +- 0.010 | 1.01 +- 0.007 | 1.014 +- 0.009 | 1.019 +- 0.010 |

Within 5 % for every case that the lab judges (a standard error under 0.015; the 100 particles of helium, 800 readings and 150 s, stay
reported, not judged: +5.3 +- 1.9 %, the effective number there is 160 where the shader says 151, the shape factor 1.5 of A3 being
1.6 at the smallest size). The uncorrected helium rate is 36 times too high at 100 particles per neighborhood (the Gamma law's
bias at the exponent of 41), 3.2 times at 400: the correction is not an option at the real exponents.

**5. The fuel fractions** (`protostar.fuel-fractions`, a gas of 60 % hydrogen, 30 % helium and 10 % carbon by number): X and Y cell
by cell within 8.3e-7 and 6.8e-7 of the CPU deposit (float32), within 2.4e-2 and 2.9e-2 on the forced half-float path; their means over the
cells 0.2018 and 0.3988 against the mass shares 0.2012 and 0.3995 (the cells draw their particles at random); the carbon is in neither.

**6. The rest of the lab** (all pass): `lab.selftest` (bit-for-bit replay), `protostar.heating`, `protostar.second-deposit`,
`protostar.half-float-deposit`, `protostar.molecular-weight`, and `protostar.reduction-channels`, which failed on `feat/improvements`
since A1: its CPU twin divided the dispersion where the GPU reduction reads the temperature (times mu / mu_H), and it read the gas grid
of the substep before the one the reduction used (the gas pass has two targets that take turns); the twin now reads both from the right
place and the worst channel is 3.4e-7.

## Calibration of the defaults

What A1 and the new laws invalidated: **the old power law gave a hydrogen particle at 2 MK 3e-3 of its rate at 15 MK, the Gamow law gives 7e-6** (the
default cloud at 0.28 s makes 0.02 fusions per second, against 6), and it is far steeper below 10 MK (exponent 5 to 9, against 2.8): the same cloud
burns the same third of its hydrogen in its first collapse, but in a flash.

The method: the default cloud of the lab (400 000 particles, speed 1.7, seeds 20240611 and the five after, 1 200 frames = 34 s,
`baseline.protostar.default-cloud-tuning`), 3 to 12 seeds per setting. The history of a seed is chaotic, so the figures below are medians over the seeds and only
differences larger than their spread are read. The columns: the share of the hydrogen burnt before 4.5 s (the first collapse) and the peak rate of that burst; the
median core temperature over the readings that burn between 6 s and the helium flash (the "plateau", target 10 to 20 MK), its spread and the number of seeds in the target;
the seeds that have their helium flash within 34 s (carbon above its 6 s value + 3 000) and when; the hydrogen left; and the median core temperature of the last 15 %.

**The recalibration was done twice.** The first campaign (on `da1473c`, the integration of P5a) chose lambda_0 5e-3 and lambda_He 2.5e-4, the values that put two pure gases of 20 rho0 at
0.1 fusions per second at exactly 15 MK and 100 MK: plateau 15.6 MK (5 seeds of 6 in the target), helium flash in 6 seeds of 6 at 22 s. Then the initial conditions of A8 landed (a denser,
hotter first collapse: 37 % of the hydrogen burnt by 4.5 s instead of 30 %) and the same values gave a first collapse burning 41 % in a burst of
a million fusions per second and a flash in 4 seeds of 6: the second campaign, below, is the one of the final code.

| Setting, combined code (seeds) | first collapse: burn, peak | plateau, MK (spread; seeds in 10 to 20) | helium flash within 34 s | H left | core T, last 15 % |
|---|---|---|---|---|---|
| **before: power laws, A1 defaults** (3) | 37 %, 32 000/s | 16.3 (10.2 to 20.6; 2 of 3) | 3 of 3, 24.9 s | 210 | 176 |
| A1 defaults on the Gamow laws (6) | 35 %, 756 000/s | 19.9 (15.7 to 27.2; 4 of 6) | 5 of 6, 28.3 s | 33 655 | 61 |
| **lambda_He 2.5e-4: the new defaults** (6) | 35 %, 783 000/s | **18.2** (14.8 to 38.7; **5 of 6**) | **5 of 6, 22.9 s** | 25 754 | 79 |
| lambda_0 5e-3, lambda_He 2.5e-4 (6) | 41 %, 1 015 000/s | 18.5 (11.3 to 29.1; 5 of 6) | 4 of 6, 19.8 s | 23 239 | 90 |
| lambda_0 5e-3, lambda_He 1e-3 (6) | 41 %, 1 042 000/s | 19.9 (11.4 to 29.9; 4 of 6) | 5 of 6, 23.5 s | 33 342 | 70 |
| lambda_0 3e-3, lambda_He 2.5e-4 (6) | 28 %, 638 000/s | 19.4 (11.4 to 29.6; 5 of 6) | 5 of 6, 24.6 s | 30 345 | 91 |
| lambda_0 2e-3, lambda_He 2.5e-4 (6) | 20 %, 471 000/s | 22.7 (8.6 to 35.2; 1 of 6) | 5 of 6, 31.4 s | 47 815 | 83 |
| lambda_0 5e-3, lambda_He 2.5e-4, G 9.5 (6) | 44 %, 278 000/s | 20.4 (16.1 to 22.0; 3 of 6) | 5 of 6, 21.0 s | 10 021 | 141 |
| lambda_0 5e-3, lambda_He 2.5e-4, G 8.5 (6) | 38 %, 588 000/s | 16.3 (11.0 to 24.9; 4 of 6) | 4 of 6, 28.9 s | 36 270 | 99 |
| lambda_0 5e-3, lambda_He 2.5e-4, cooling 0.7 (6) | 37 %, 757 000/s | 18.6 (14.2 to 33.6; 4 of 6) | 4 of 6, 26.4 s | 26 525 | 137 |
| lambda_0 3e-3, lambda_He 2.5e-4, G 9.5 (6) | 31 %, 303 000/s | 18.1 (11.5 to 20.5; 4 of 6) | 6 of 6, 19.8 s | 19 686 | 131 |

The last row looked best, with a helium flash in all six seeds. Twelve seeds (the six above and 20240617 to 20240622) of it and of the new defaults:

| seeds 11 to 16 / 17 to 22 | plateau, MK (spread; in 10 to 20) | helium flash within 34 s | first collapse | core T, last 15 % |
|---|---|---|---|---|
| **new defaults** | 18.2 (14.8 to 38.7; 5 of 6) / 18.3 (12.9 to 26.1; 4 of 6) | 5 of 6, 22.9 s / 5 of 6, 26.9 s | 35 % | 79 / 77 |
| lambda_0 3e-3, G 9.5 | 18.1 (11.5 to 20.5; 4 of 6) / 24.5 (14.2 to 30.3; 3 of 6) | 6 of 6, 19.8 s / 5 of 6, 22.1 s | 30 to 31 % | 131 / 138 |

It was the best of eleven settings on the first six seeds and regressed on the next six (a plateau at 24.5 MK, a flash in 5 of 6): the choice among settings is at the
limit of what six seeds can resolve. The new defaults change one parameter and hold the plateau, which is the quantity the plan asks for.

Settings tried on the first campaign's base (P5a, three to six seeds each; the numbers are of that base and are not repeated in the table above): G 7 (no helium flash in 34 s; the star
settles at about 1.6 MK per unit of G), 8.5 and 9.5 (equivalent to 9 within the spread), 12 (burns hydrogen at 22 to 41 MK); lambda_0 4e-4 and 1e-3 (the plateau at 40 to 70 MK in most seeds:
too little to burn at 15 MK), 2e-3, 3e-3; feedback 0.044 and 0.1 (a plateau at 20 to 45 MK in half the seeds), 0.2 (a first collapse burning 40 %), 0.44 (46 %, a flash
of 1.2 million per second reading 340 MK); cooling 0.25 (a first collapse of 39 %), 0.7, 1.0; opacity 10 and 20, alone or with a cooling of 1.0
(the star goes out at 4 to 7 MK, 300 to 1 100 fusions per second against 9 000); a time constant of the average of T of 0.15, 0.3 and 1 s: it hides the heating of the first collapse (the burn falls from 29 %
to 9 % at 0.3 s) **and breaks the plateau** (50 to 56 MK in two seeds of three at 0.3 s, 61 to 87 MK in all three at 1 s: the rate of a fluctuating T is convex, its average underestimates it, the
star must run hotter). None improved on the settings kept.

### The new defaults, old to new

| Parameter | A1 | A2 | Why |
|---|---|---|---|
| lambda_He (`heFusionRate`) | 3.75e-5 | **2.5e-4** | Normalisation: `lambda_He * 20^2 = 0.1`, a helium gas of 20 rho0 fuses 0.1 times per second at exactly 100 MK (A1's value: 105 MK; hydrogen 15.9 MK there, He/H 6.3). Helium's ignition is almost a threshold (1.06 per decade of lambda), so this moves the flash from 28.3 s to 22.9 s in the median (5 seeds of 6 within 34 s in both) |
| lambda_0 (`fusionRate`) | 4e-3 | 4e-3 | scanned 4e-4 to 5e-3 on two bases: the plateau needs lambda_0 of 3e-3 or more, a larger one makes the first collapse burn more (41 % at 5e-3, 28 % at 3e-3) for no better plateau |
| G (`gravity`) | 9 | 9 | scanned 7 to 12: 8.5 and 9.5 are equivalent within the spread (the one at 9.5 with 3e-3 did not hold on twelve seeds) |
| feedback | 0.146 | 0.146 | scanned 0.044 to 0.44: the plateau needs lambda x feedback to be what it is; more makes a bigger first flash, less a hotter plateau |
| cooling (`cooling`) | 0.51 | 0.51 | scanned 0.25 to 1.0: weaker keeps the first collapse (39 %), stronger starves the plateau |
| opacity (`opacity`) | 5.32 | 5.32 | scanned 10 and 20: the core cools too fast; the plateau goes out with 20 |
| glow range (`PROTOSTAR_GLOW_T_RANGE`) | 1 to 7 T0 (15 to 105 MK) | **1 to 15 T0 (15 to 225 MK)** | the carbon ash, which nothing burns, reads 3.4 times its dispersion: up to 230 MK in the runs, above the old range's top, where it all saturated |
| noise N shape, time constant (`PROTOSTAR_NOISE_N_SHAPE`, `PROTOSTAR_TEMPERATURE_TAU`) | 1.5, 0.1 s | 1.5, 0.1 s | the lab's effective number is 1.5 times the nominal one to within 7 % from 200 particles (1.6 at 100); a longer time constant breaks the plateau (above) |

**What the new defaults do** (three seeds, 20240611 to 20240613, 34 s: the build before this phase, A1's defaults on the Gamow laws, and the new defaults; then 56 s). The core temperatures
are the stats' (the densest cell, read every 10 frames); the plateau is the median over the readings that burn between 6 s and the helium flash, the weighted temperature the median over the hydrogen burnt after the first collapse.

| 34 s, three seeds | before (power laws, A1 defaults) | A1 defaults on the Gamow laws | **new defaults** |
|---|---|---|---|
| hydrogen burnt before 4.5 s (the first collapse) | 37 %, 36 %, 37 % | 35 %, 35 %, 35 % | 35 %, 35 %, 35 % |
| peak fusions per second of that burst | 32 000, 30 400, 33 500 | 738 000, 773 000, 757 000 | 783 000, 807 000, 771 000 |
| core T on the plateau, median (MK) | 10.2, 16.3, 20.6 | 19.9, 16.2, 15.7 | 38.7, 17.7, 19.2 |
| core T weighted by the hydrogen burnt after (MK) | 9.6, 18.8, 24.3 | 19.9, 14.8, 24.6 | 16.7, 17.5, 23.7 |
| highest core T (MK) | 219, 259, 147 | 205, 223, 268 | 205, 213, 168 |
| core T in the last quarter (MK) | 133, 164, 58 | 51, 57, 87 | 72, 77, 55 |
| hydrogen left of 400 000 | 62, 210, 1 096 | 47 601, 33 655, 22 408 | 47 291, 24 551, 24 246 |
| helium / carbon at the end | 196 / 33 443, 3 638 / 32 056, 75 082 / 8 236 | 72 021 / 5 544, 39 809 / 17 171, 24 151 / 23 365 | 79 371 / 3 030, 17 238 / 25 456, 64 162 / 10 057 |
| first helium flash, s | 27.8, 24.9, 17.6 | none, 28.3, 23.2 | none, 24.6, 17.6 |

| 56 s, three seeds | before | **new defaults** |
|---|---|---|
| core T on the plateau, median (MK) | 10.2, 17.9, 19.6 | 51.2, 17.7, 20.2 |
| core T in the last 15 % (MK) | 219, 229, 52 | 86, 157, 91 |
| hydrogen left | 0, 61, 579 | 13 314, 4 615, 8 349 |
| helium / carbon at the end | 0 / 33 438, 271 / 33 457, 47 185 / 17 486 | 15 135 / 27 181, 1 168 / 32 426, 67 285 / 10 291 |
| first helium flash, s | 26.1, 25.2, 17.6 | 48.7, 24.9, 17.9 |

- **Hydrogen burns at 15 to 20 MK** on the plateau in two seeds out of three at 34 s, and in 9 seeds out of 12 (median 18.2 MK); the third seed is the weak one, whose plateau runs at 39 to 51 MK and whose helium flash comes at 49 s (a colder start
  that the cloud only slowly leaves: 47 000 hydrogens left at 34 s). Weighted by what is burnt it is 17 to 24 MK, as in the power-law build.
- **The helium flash** comes in 5 of 6 seeds within 34 s (5 s earlier in the median than with A1's values, 22.9 s against 28.3 s) and in 10 of 12; in the three seeds at 56 s it comes at 17.9, 24.9 and 48.7 s.
- **The first collapse burns 35 % of the hydrogen in a burst of 780 000 fusions per second**, against 37 % and 32 000 with the power laws: it is about the same burn (probably set by the energy that unbinds the cloud of the first fusions, not by the law),
  and the steeper Gamow law at 5 to 9 MK makes a flash of what was a 3 s burn. The recalibration did not remove it (a smaller lambda_0 lowers it, 20 % at 2e-3, but leaves the plateau scattered: see the table), and the cooling of A6 or the
  initial conditions would be the levers.
- **The hydrogen lasts longer**: 25 000 left at 34 s and 4 600 to 13 000 at 56 s, against 200 and 0 to 600: the flash is the same, the plateau burns slower than the power law's.
- The peak core temperature after 6 s, 64 to 196 MK in the new defaults (median 150 over six seeds; 158 for A1's defaults on the Gamow laws; 147 to 259 for the power-law build), is the helium flash, which burns half of the
  helium in 0.3 s on a core collapsing to 100 rho0 and above.

### The carbon ash

Decision: **keep the honest reading and say so**. A carbon gas reads 3.4 times its dispersion (A1) and nothing burns it here: real carbon burning starts near 600 MK, which no state of this model reaches (the highest
reading in all the runs of this spike is about 410 MK, one reading in a helium flash). The ash of the default cloud reads 33 to 95 MK at 34 s (median 79 over six seeds) and 86 to 157 MK in the last 15 % of the
runs of 56 s (up to 230 MK in the power-law build's): the virial dispersion of the dense core times 3.4, slowly falling with the cooling of the core (about 0.03 per second at 100 rho0 and above); it is a reading, not a runaway, and the star does not
go further because the cloud is out of fuel. Three alternatives were not taken: a cap on the reading would put a lie in the stats and the glow; stopping the simulation at the first carbon would end the show before the ash has done
anything; a burning stage for carbon is a new reaction (a row in `PROTOSTAR_REACTIONS` and a third fuel channel) and belongs to a later phase. The glow range was widened to 15 T0 (225 MK) so that the ash shows as a hot, bright core without
saturating at once (the stats and the glow read the temperature, the energy does not).

### Cost and the benchmark

**Cost.** The particle passes gain, per particle, one more exponential (the barrier term `tau^-q`), one logarithm, a few more for the helium's exact estimate (Stirling's series, three `log1p`) in the position
pass and in the power deposit (both call `fusionRateOf`), and a read of the third attachment's fuel fractions; the grid passes gain a third attachment on the gas pass. `perf.protostar.400k` (400 000 particles, two substeps per frame; the
simulation alone, the median of 4 chunks of 30 frames, the GPU waited for at the end of each, and the whole frame), the build before (`9215ab1`) and this one alternated, six pairs each time, the order swapped at each pair, each run a fresh page under the GPU lock.
The GPU sat in its P5 state (734 MHz) for the whole campaign: 20 to 25 ms per frame instead of 7 to 9 on an idle GPU, with steps of clock between runs that make the simulation-only figure unreadable (11 to 22 ms for the same build);
the whole frame, which the display's synchronization keeps steady, is the figure to read.

| | build before | this build | paired difference (new - old) |
|---|---|---|---|
| **A**, each build with its own defaults, whole frame, ms | 24.34 (23.86 to 24.82) | 24.81 (24.07 to 24.96) | **+0.12** (-0.47 to +1.10), +0.5 %; new slower in 3 of 6 |
| the same, simulation only, ms | 20.52 (18.41 to 21.95) | 21.58 (12.79 to 21.98) | -0.02 (-7.1 to +2.6): not measurable at this noise |
| **B**, the same dynamics (`?perfVariant` with gravity, cooling and feedback at 0: the cloud only expands, nothing fuses), whole frame, ms | 25.42 (25.09 to 25.96) | 25.94 (25.53 to 27.08) | **+0.80** (+0.11 to +1.43), **+3.2 %**; new slower in 6 of 6 |
| the same, simulation only, ms | 18.71 (11.28 to 20.57) | 21.24 (17.73 to 21.71) | +2.3 (-1.5 to +10.4), clock steps: not readable |

The shaders cost about 3 % of a whole frame at 400 000 particles (B: the same dynamics in both builds, a rate computed for every particle whether or not anything fuses), and the difference of the defaults' dynamics
(A) is under the noise. **The benchmark of the first visit** (`src/benchmark`: the frames of the default cloud at its default parameters, one per animation frame, `capFromProbes`) is the whole frame at the first counts:
replaying it with a clock of 60 Hz and a frame time proportional to the count gives a cap of 700 000 particles for any cost from 5 to 9 ms per 400 000 particles (7.34 and 7.56 ms, the build before and 3 % more, on the idle GTX 1060), 490 000 at 12 ms and 190 000 at 24 to 25 ms
(this campaign's clocks), the same before and after the change: a cost of 3 % does not move a step of the search (350 000, 700 000, 1 400 000 within a factor of 1.25).

## Reproducing

    S=...                                   # a scratch directory; the GPU is shared: serialize every run with flock on a lock the other users take
    npx vite --port 5211 &                  # this branch; the build before (git archive 9215ab1) on 5212
    LAB=http://localhost:5211/particle-simulator/lab.html
    # acceptance 1 to 3, 5, 6 (about 1 minute)
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.fuel-fractions,protostar.local-exponent,protostar.ignition-gas,baseline.protostar.ignition-ratio,protostar.reduction-channels,lab.selftest"
    # acceptance 4 (5 minutes)
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.temperature-noise"
    # the default cloud, six seeds, 34 s, and a variant (13 to 40 s per run, depending on the GPU's clocks)
    V='[{"name":"new defaults"},{"name":"G 8.5","overrides":{"gravity":8.5}}]'
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=baseline.protostar.default-cloud-tuning&cloudSeeds=6&cloudVariants=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$V")"

The cost: `perf.protostar.400k` of the build before (port 5212) and of this one alternated, six pairs, the order swapped at each pair, each run a
fresh page and each under the lock, with no other headless Chrome on the machine (`ps -eo args | grep -- --headless`); `?perfVariant={"overrides":{"gravity":0,"cooling":0,"feedback":0}}`
runs both builds on dynamics where the fusion is nil and the cloud only expands, so that the difference is the shaders'.
Renderer string of every number above: `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)`, headless Chrome,
`EXT_float_blend` available, area 1024 x 768 px, GPU in the P5 state (734 MHz) for the whole campaign: ms per frame are 3 times those of an idle GPU; read the ratios.

## Limits and what P3c and P4 should know

- **P3c (A4, fusion without deleting particles)**: the cloud's history depends on the first collapse burning a third of the
  hydrogen in a flash (above), and that burn is what A4 changes (a fused hydrogen would stay as a heavier particle instead of
  being deleted): re-run the six-seed table, the plateau and the helium flash are the quantities to hold; the rates already read the
  mass fractions X and Y, which A4's product particles will change (a helium in a hydrogen gas is not fuel for the proton-proton chain
  and counts in `Y^2` for the triple alpha).
- **P4 (A6 thin-disc cooling, A13 Jeans floor)**: the plateau's temperature is set by G and by the cooling (the plateau needs `lambda x feedback x rate
  = cooling x structure`), so a change of the cooling law moves everything; G, lambda_0 and lambda_He are calibrated with the linear damping
  `k / (1 + rho / rho_opq)`. The first-collapse flash is the part of the history that is most sensitive to the cooling and to the initial
  agitation. The six-seed medians of this spike are the figures to compare with; the plateau's 10 to 20 MK window and the helium flash within
  34 s are the targets that held.
- **The density of the law is the surface density** (A11 will change it: `rho^n` of the table becomes `(Sigma / 2h)^n`, which moves
  every calibration, lambda included, by the thickness).
- **A saved configuration** that has `fusionExponent`/`heFusionExponent` keeps working (the keys are dropped) with the new laws and
  the old lambda_He (3.75e-5: the helium flash then comes 5 s later, see the table); the benchmark of the first visit
  times the default cloud, whose shaders now compute one exponential, one logarithm and, for helium, a few more per particle in the
  position pass and in the power deposit (see Cost).
- **The noise correction knows nothing of the time average**: the rate is computed from the temperature averaged over time (tau = 0.1 s),
  which is less noisy than the instantaneous estimate; the exact estimate assumes the noise of one estimate, so it over-corrects a
  little where the average works (conservative, as in A3); and it assumes Maxwellian particles that are independent, with the effective
  number of the mass-weighted sum times 1.5 (1.6 at 100 particles: the 5.3 % of acceptance 4).
- **CNO and the non-resonant correction**: the proton-proton chain's rate is divided by its curved bias (0.4 % in the lab); an exact
  estimate also exists for hydrogen's law, in the form of a numerical inversion that was not worth it at 0.4 %. The CNO cycle (`exp(-152.3 T6^(-1/3))`,
  exponent about 18 at 20 MK) would need a third fuel channel and is not in the table.
- **Carbon burning** is out of scope (above): the ash reads 33 to 160 MK (up to 230 MK in the power-law build) and nothing makes it hotter.
