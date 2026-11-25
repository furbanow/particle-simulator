# Spike P4: thin-disc cooling (A6) and Jeans floor (A13)

Phase P4 of the improvement plan (proposals A6 and A13 of the professor's document, "Améliorations des algorithmes v3"), on the branch
`feat/thin-disc-cooling` from `feat/improvements` at `6f615b5`.

**In short.** The protostar's cooling is now the radiative law of a thin disc, `dT/dt = -c mu T^4 / (Sigma tau_eff)` (Johnson & Gammie 2003),
integrated exactly over each step, with an opacity kappa and a floor T_min; it replaces the damping `k / (1 + rho / rho_opq)`, which did not
depend on T and was strongest in the thinnest gas. The lab finds the exact law on blobs of known T, Sigma and mu to 5.6e-7, stiff steps
included. A Jeans floor (`t_J = 2 N_J dx G Sigma`, N_J = 4) is behind the `jeansFloor` switch, off: blobs end at the floor to 2e-7; in the
default cloud it lifts the smallest Jeans length from 2.1 to 3.5 cells. The T^4 law changes the cloud's history (the cold envelope no longer
radiates, the helium core must not radiate too much): the defaults were recalibrated to c = 10, kappa = 20, T_min = 0.05 T0, and, the
user's choice, **lambda_0 4e-3 -> 2e-3 and feedback 0.146 -> 0.3**. Over twelve seeds the first collapse burns 33.5 % of the hydrogen (35 %
before), the helium flash comes in twelve of twelve at 20.5 s (19.1 s), the hydrogen burns at 27 MK (20 MK) after a lull of about 5 s that
the old cooling did not have. The plan's thermostat test (a few percent per decade of lambda) is met by neither law. The cost is not
measurable.

## What was built

| Piece | Where |
|---|---|
| The twin: `effectiveDepth`, `columnDepth`, `coolingRatio` (exact solution with the floor), `coolingLogRate`, `jeansPerDensity`, `jeansDispersion`, `jeansCells`, `cooledVelocity` (the shader's two blocks) | `src/simulation/protostar/cooling.ts`, tests `tests/cooling.test.ts` (15) |
| The "Radiative cooling" block replaced, a "Jeans floor" block after it (scaling; a kick, stream 3, in a cold cell); the heating scales the dispersion they leave | `src/shaders/protostar-velocity.frag` |
| Uniforms `radiation`, `opacityKappa`, `minTemperature`, `jeansPerDensity` (set each substep: it has the cell and G in it, 0 with the switch off) | `src/simulation/protostar/gpuModel.ts` |
| Parameters `radiation` (c, 1/s, log), `kappa` (per rho0, log), `minTemperature` (T0, shown in MK) in the physics tab, `cooling` and `opacity` removed; the switch `jeansFloor` (features tab, off); five catalogs | `declaration.ts`, `src/config.ts`, `src/i18n/locales/*` |
| Lab: `protostar.thin-disc-cooling`, `protostar.jeans-floor`; the default cloud's series gets `burnTemperatureMK`; `scripts/cloud-tuning-summary.mjs` and `cloud-tuning-series.mjs` summarize the tuning runs | `src/lab/scenarios/cooling.ts`, `src/lab/core.ts`, `scripts/` |

Choices:

- **mu in the rate.** The energy per unit mass is the dispersion t = T / mu (heat capacity per unit mass ~ 1 / mu), the radiation goes as T^4: so
  dT/dt = -c mu T^4 / (Sigma tau_eff), and at the same temperature helium cools 2.65 times faster than hydrogen. The professor's formula has no mu
  (it is written for hydrogen). Dropping it was tried on the default cloud (four settings, three seeds each): it changes little (the
  same helium flash threshold within the spread), so the physical form was kept.
- **No bound of the time step.** The law is integrated exactly over the step, so however stiff (the lab goes to 3 c mu T^3 dt / (Sigma tau_eff) =
  7e5) it cannot overshoot: `criticalStep()` (B5) needs no cooling term.
- **The floor on the dispersion**, not on T: the Jeans length is set by the pressure, which is the dispersion (c_s^2 = t / 2 in the plane); it
  is applied after the cooling and before the heating, so that the heating still adds exactly q dt.
- **T_min** stops the cooling at that temperature and leaves a gas below it alone. In the default cloud it is inert (the T^4 law no longer cools
  the cold gas anyway): 0.05 T0 = 0.75 MK.

## Acceptance (lab, GTX 1060, headless Chrome)

| Test | Result |
|---|---|
| `protostar.thin-disc-cooling`: 660 blobs at cell centers (hydrogen and helium, 50/200/800 particles, dispersions 0.1 to 10 T0), c = 30, kappa = 20, T_min = 0.3, one substep, no gravity or fusion | dispersion ratio = `coolingRatio()` within **5.6e-7** (440 blobs cooled by the law, stiffness up to 6.9e5; 88 stopped at T_min; 132 below it unchanged, exactly), mean velocity moved 3.4e-7 sigma. **pass** |
| `protostar.jeans-floor`, blobs at the default G with the switch on | 256 raised to t_J within **2.1e-7**, 358 above it untouched (exactly), 154 cold blobs kicked to t_J within 6.7 % (a kick of random direction per particle), the model's floor per rho0 equal to the formula's (0.0827 T0 per rho0). **pass** |
| `protostar.jeans-floor`, default cloud, 600 frames (17 s), cells of 1 rho0 and more | smallest Jeans length over the run **2.1 cells off, 3.5 on** (median of the readings' minima 4.3 and 4.9); the worst reading's share of mass under 4 cells **24 % off, 10 % on** (median 0 in both); the same history (peak core 118 MK, the same mass fractions at 17 s) |
| "lambda_J >= 4 cells at all times" | not quite: 3.5. The floor acts per particle on the interpolated 3 x 3 neighborhood before the particles move; the census reads the cells after. |
| "number of fragments independent of the cell size" | not testable here: `GRID_RES` is a compile-time define of the shaders. |
| Cost, `perf.protostar.400k`, four alternated pairs on an idle GPU (1 544 MHz) | defaults: whole frame 9.46 ms (new) against 9.59 (old); the same dynamics (`perfVariant` gravity and feedback 0): 8.64 against 8.83. Not measurable: a `pow` and a few products per particle. The first-visit benchmark times the same frames: its cap does not move. |

## Recalibration

The method of the A2 spike: the default cloud (`baseline.protostar.default-cloud-tuning`, 400 000 particles, speed 1.7, 1 200 frames = 34 s,
seeds 20240611 and after). Summaries by `scripts/cloud-tuning-summary.mjs`: the hydrogen burnt before 4.5 s (the first collapse) and its peak rate;
when burning resumes (the first reading after 4.5 s at 100 fusions per second or more); **the temperature of the burning gas** (new: the cells'
temperature weighted by their fusion heating, the median over the plateau's readings; the densest cell's reading is often the helium ash at the
center while the hydrogen burns around it); the core plateau (the densest cell, readings at 100 fusions per second or more between 6 s and the flash);
the helium flash (carbon above its 6 s value + 0.75 % of the mass); what is left at the end. These definitions differ a little from the A2 spike's: the
old build was re-run with them.

**What the T^4 law does to the cloud** (about 120 runs, 3 seeds per setting unless said):

- **The envelope no longer cools.** The cold gas (2 MK) radiates as T^3 times less than the core: no setting of c and kappa can cool it without
  over-cooling the core. After the first collapse's bounce the cloud stays warm and falls back on its own time: burning resumes at 8 to 13 s
  (5.2 s with the old cooling).
- **Only c / kappa matters** in the optically thick limit, where all of the cloud's dense gas is (kappa 20 and 200 with the same ratio give the same
  runs). c / kappa >= 1: the dense helium core (mu = 2.65) cools as fast as compression heats it, settles at 75 to 85 MK and never reaches the triple
  alpha (0 or 1 flash in 3; with c / kappa = 25, the first guess, the core contracted to 370 rho0 and cooled). c / kappa <= 0.1: a weak, disrupted
  plateau. c / kappa = 0.3 to 0.7: a flash in every seed.
- **lambda_0 sets the first collapse's burn**: 46 to 48 % with 4e-3, 33 % with 2e-3, 28 % with 1.5e-3. A warmer start (alphaVir 0.5 or 0.6) halves the
  burst but leaves the hydrogen burning at 60 to 80 MK and delays or loses the flash; a lower G (5, 6.5) loses the flash; the feedback alone does not
  move the burst.
- The hydrogen burns at 25 to 35 MK in every setting with a flash (20 MK with the old law): it was not brought into the 10 to 20 MK window.

| Setting (c, kappa = 20) | seeds | first collapse | burning again | H burns at | helium flash | carbon at 34 s |
|---|---|---|---|---|---|---|
| **old cooling (k 0.51, rho_opq 5.32), lambda_0 4e-3, feedback 0.146** | 6 (burn T: 3) | 35.1 % | 5.2 s | 19.7 MK | 6 of 6, 19.1 s | 69 % |
| c 10, lambda_0 4e-3, feedback 0.146 | 6 | 46.3 % | 7.2 s | 33.9 MK | 6 of 6, 10.5 s | 20 % |
| **c 10, lambda_0 2e-3, feedback 0.3: the new defaults** | 12 | **33.5 %** | 10.3 s | **26.9 MK** (1 of 12 in 10–20) | **12 of 12, 20.5 s** | 76 % |
| c 10, lambda_0 1.5e-3, feedback 0.4 | 6 | 28.4 % | 11.3 s | 28.8 MK | 6 of 6, 20.8 s | 88 % |
| c 20, lambda_0 4e-3 | 3 | 44.5 % | 5.7 s | 37.4 MK | 0 of 3 | 3 % |
| c 6, lambda_0 4e-3 | 3 | 47.6 % | 8.5 s | 24.2 MK | 3 of 3, 13.3 s | 47 % |

The new defaults, twelve seeds: first collapse 33.3 to 33.6 %, burst 485 000 to 544 000 per second (870 000 before); burning again at 9.9 to 11.3 s;
hydrogen burning at 19.9 to 32.8 MK (median 26.9); core plateau 23.7 to 39.4 MK at 11 to 14 rho0 (35 rho0 before: the core is less dense); helium
flash at 19.3 to 22.9 s in every seed; hydrogen left 7.6 to 11.7 %; carbon 62 to 86 %; core in the last 15 % 116 to 142 MK.

**lambda_0.** The user chose 2e-3 (asked with the trade-off): the first collapse's burn stays where it was, at the price of the A2 reference
ratio. At 20 rho0 and 0.1 fusions per second per particle hydrogen now ignites at 19.2 MK (15.9 MK before), so the He/H ratio there is 5.2 (6.3
before; real 6.67); at 40 rho0 it is 6.1 (7.25), and over 20 to 100 rho0 and 0.03 to 0.5 per second it runs from 3.3 to 9.4 (4.1 to 10.9). The
tests of `tests/gamowRates.test.ts` say so.

**The thermostat test** (the plan: "the central temperature varies by a few percent when lambda varies by a decade"), three seeds each, the temperature
of the burning gas:

| lambda_0 | / 3.16 | x 1 | x 3.16 |
|---|---|---|---|
| old law (around 4e-3) | 31.4 MK (burst 14 %) | 19.7 MK (35 %) | 22.9 MK (67 %) |
| new defaults (around 2e-3) | 54.2 MK (13 %, flash 2 of 3) | 27.8 MK (33 %) | 29.2 MK (58 %, flash at 10 s) |

Neither: the old law moves by -37 % / +16 % around the default, the new one by +95 % / +5 %. Above the default the new law is the flatter (the T^4
thermostat holds once the plateau is reached); below it the hydrogen burns late, in a core already rich in helium, much hotter. The criterion
assumes an equilibrium that this cloud, with its burst and its softened core, does not reach.

## Limits and what the next phases should know

- **The lull.** About 5 s after the first collapse with nothing burning, which the old cooling did not have: the envelope's cooling was what
  brought the gas back at once. A cold envelope radiates through lines, not as a black body; a line-cooling term (thin gas cooled towards T_min at
  a rate that does not go as T^3) would restore it, and is not in the proposal.
- **The first-collapse burst** is the same size (33.5 % of the hydrogen) and gentler (510 000 fusions per second against 870 000), still not tamed.
- **The hydrogen burns at 27 MK**, above the 10 to 20 MK window, in a core less dense (12 rho0 against 35). P1b (A12) will show Q and t_cool Omega
  of that core.
- **A11 (adaptive thickness)** will change the density of the fusion law and the column of the cooling: recalibrate both.
- **C1 (collisions)** gives the gas a real pressure: the Jeans floor's t_J will apply to it.
- **Saved configurations** lose `cooling` and `opacity` (dropped) and get the new defaults; an old configuration keeps its lambda_0 4e-3 and feedback
  0.146, with which the first collapse burns 46 % (see the table).

## Reproducing

    S=...                                         # a scratch directory; serialize the GPU runs with flock
    npx vite --port 5211 &                        # this branch; the build before (git archive 6f615b5) on 5212, with this branch's
                                                  # src/lab/core.ts and src/lab/scenarios/baseline.ts copied in for the burn temperature
    LAB=http://localhost:5211/particle-simulator/lab.html
    flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.thin-disc-cooling,protostar.jeans-floor"
    V='[{"name":"defaults"}]'
    flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --url $LAB --out $S/twelve.json \
        --query "scenarios=baseline.protostar.default-cloud-tuning&cloudSeeds=12&cloudVariants=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$V")"
    node scripts/cloud-tuning-summary.mjs $S/twelve.json
    node scripts/cloud-tuning-series.mjs $S/twelve.json defaults 20240612 4

Cost: `perf.protostar.400k` on both builds alternated (four pairs, order swapped at each), with and without
`perfVariant={"overrides":{"gravity":0,"feedback":0}}`.
