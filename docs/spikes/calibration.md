# Calibration: the default cloud with every flag on

Branch `feat/calibration` from `feat/improvements` at `09331ce`, after every proposal of the professor's document was done or decided.

**The user's choices (2026-11-24).** Every feature flag of the protostar is turned on in the defaults: `adaptiveTimeStep` (B5),
`jeansFloor` (A13), `tscDeposit` (C4), `collisions` (C1), `adaptiveThickness` (A11), `nestedGrid` (C2) (`diagnostics` was already
on; the stability map is a display choice and stays off). The defaults are calibrated for that model. The target: **the hydrogen burns at
10 to 20 MK**; how long the star lives before its helium flash does not matter ("peu importe": the flash may come after several minutes).

## Method

`baseline.protostar.default-cloud-tuning` (400 000 particles, speed 1.7, 1 200 frames = 34 s unless stated), the flags set through
`params`, the physics through `overrides`; summaries by `scripts/cloud-tuning-summary.mjs` (definitions in the
[A6/A13 spike](a6-a13-cooling-and-jeans.md#recalibration)). The quantity of the target is the temperature of the burning gas (`burnT`:
the cells' temperature weighted by their fusion heating, median over the readings that burn between 6 s and the flash).

**Seeds.** With the collisions on, the runs of different seeds are almost the same: over four seeds of the old defaults with every flag on,
the first burst is 6.5 % in all four, the helium flash at 14.7 s in all four, the burning temperature 34.7 to 34.9 MK (flags off, the same
four seeds: flash 19.3 to 22.9 s, carbon 62 to 86 %). The collisions make the gas a fluid: the noise of the initial draw is damped within
the first second. Settings were nevertheless compared on two to three seeds while exploring and on six for the final choice.

## The old defaults with every flag on

Four seeds (20240611 to 20240614), 34 s:

| | first collapse | burning again | H burns at | core plateau | helium flash | at 34 s |
|---|---|---|---|---|---|---|
| flags off (the shipped defaults) | 33.5 % of H, 506 000 /s | 10.1 s | 26.9 MK | 32.3 MK at 12 ρ₀ | 4 of 4, 21.1 s | H 8.9 %, C 76 % |
| every flag on | **6.5 %**, 40 000 /s | 6.2 s | 34.7 MK | 44.9 MK at 12.5 ρ₀ | 4 of 4, 14.7 s | **all carbon**, core 354 MK at 370 ρ₀ |

Every flag on, the first-collapse burst is tamed by itself (6.5 % of the hydrogen instead of 33.5 %) and there is no lull, but after the
helium flash nothing holds the core up: it falls to the grid's scale (as with C1 alone, [spike](c1-mpc-collisions.md)).

## Exploration

Every flag on, 34 s, two or three seeds each (the seeds agree within 1 to 2 %). `burnT` is the summary's (time-weighted median over the
readings that burn between 6 s and the flash); "H-weighted" is the median temperature at which the hydrogen burnt after 4.5 s burnt (each
reading's burning temperature weighted by the hydrogen it consumed), and the share of that hydrogen burnt at 10 to 20 MK
(`hburn.mjs`, below).

| G | c | λ₀ | first collapse | burnT | H-weighted (share at 10–20 MK) | H burnt 4.5–34 s | helium flash |
|---|---|---|---|---|---|---|---|
| 9 | 10 | 2e-3 | 6.5 % | 34.7 MK | 123 MK (0 %) | 93 % | 14.7 s, then all carbon |
| 9 | 1 | 2e-3 | 5.6 % | 19.4 | 21.1 (31 %) | 4 % | none |
| 9 | 3 | 2e-3 | 5.8 % | 29.5 | 51.6 (1 %) | 56 % | 31.7 s |
| 9 | 10, feedback 1 | 2e-3 | 5.7 % | 30.3 | 93.5 (0 %) | 88 % | 28.9 s |
| 7 | 10 | 2e-3 | 3.3 % | 26.1 | 72.6 (1 %) | 88 % | 28.6 s |
| 7 | 10 | 6e-3 / 1e-2 | 9.0 / 13.8 % | 24.9 / 24.0 | 78 (2 %) | 85 / 82 % | 27.5 / 26.6 s |
| 7 | 3 | 2e-3 | 3.1 % | 18.0 | 19.6 (56 %) | 6 % | none |
| 7 | 3 | 6e-3 | 8.6 % | 16.1 | 17.7 (100 %) | 4 % | none |
| 7 | 3 | 1e-2 | 13.3 % | 17.8 | 18.5 (76 %) | 5 % | none |
| 6 | 10 | 2e-3 | 2.1 % | 20.7 | 23.9 (19 %) | 18 % | none |
| 6 | 10 | 6e-3 | 6.0 % | 18.1 | 21.2 (31 %) | 17 % | none |
| 6 | 10 | 1e-2 | 9.6 % | 17.8 | 21.5 (43 %) | 15 % | none |
| 6 | 3 | 2e-3 | 2.0 % | 14.1 | 15.0 (99 %) | 2 % | none |
| 6 | 3 | 6e-3 | 5.8 % | 11.6 | 13.2 (92 %) | 1 % | none |
| 6 | 3 | 1e-2 | 9.3 % | 11.6 | 12.6 (91 %) | 1 % | none |
| 6 | 1 | 2e-3 | 2.0 % | 12.3 | 12.0 (93 %) | 0.4 % | none |

What sets what, every flag on:

- **The first collapse** is small in every setting (2 to 14 % of the hydrogen against 33.5 % with the flags off) and burning never stops
  after it: no lull. λ₀ sets its size (2 % at 2e-3, 6 % at 6e-3, 9 to 14 % at 1e-2), as with the flags off.
- **The rate of the hydrogen burning is set by G and c**, not by λ₀: in the thermostat the fusion power matches what the core radiates. G 9 or
  c 10 at G 7 burn the hydrogen within 34 s, hot (25 to 35 MK), and the core then falls to the grid's scale after the helium flash.
- **λ₀ sets the temperature**: the thermostat. At G 6, c 10 the burning temperature goes from 20.7 to 18.1 to 17.8 MK for λ₀ 2e-3, 6e-3,
  1e-2 (−14 % over a factor 5), at G 6, c 3 from 14.1 to 11.6 to 11.6 MK. With the flags off the same test moved the temperature by +95 % / +5 %
  around the default ([A6 spike](a6-a13-cooling-and-jeans.md)).
- So the 10 to 20 MK window comes with a slow burn: a few percent of the hydrogen in 34 s. The user's target allows it.

**Long runs** (6 000 frames = 170 s, two seeds, λ₀ 6e-3): the whole life of the star.

| G, c | burnT | H-weighted (share at 10–20 MK) | helium flash | at the end |
|---|---|---|---|---|
| 6, 10 | 21.1 MK | 47 MK (11 %) | 43.1 s | all carbon, core 241 MK |
| 6.5, 6 | 21.4 | 49 (11 %) | 50.1 s | all carbon, 261 MK |
| 7, 5 | 22.5 | 52 (4 %) | 45.9 s | all carbon, 280 MK |
| 7, 3 | 22.5 | 48 (5 %) | 64.6 s | all carbon, 281 MK |

The hydrogen starts burning at 14 to 18 MK, then the burning heats as the hydrogen runs out and the helium ash makes the core contract (G 7, c 3,
burning temperature every 11 s: 14, 20, 25, 38, 122 MK; hydrogen left 91, 87, 79, 61, 23 %): the last half of the hydrogen burns in the run-up to
the helium flash, at 40 to 200 MK. Real stars heat their core too as the hydrogen runs out, but by tens of percent, not by a factor 10.

**Slower burns** (12 000 frames = 340 s, two seeds, λ₀ 6e-3): a slower burn does not cool it.

| G, c | burnT | H-weighted (share at 10–20 MK) | helium flash |
|---|---|---|---|
| 6, 5 | 20.2 MK | 47 MK (15 %) | 74.5 s |
| 6.5, 3 | 20.6 | 48 (15 %) | 83.0 s |
| 6.5, 4 | 21.0 | 61 (14 %) | 66.0 s |

**The feedback is the lever** (6 000 frames = 170 s, two seeds, G 6, c 5). The heat a fusion gives the gas holds the core up: with more of
it the core contracts less as the hydrogen runs out, and the hydrogen burns slower and colder (the luminosity, set by G and c, is paid with
fewer fusions).

| λ₀ | feedback | first collapse | burnT | H-weighted (share at 10–20 MK) | H burnt 4.5–170 s | helium flash |
|---|---|---|---|---|---|---|
| 1e-2 | 0.3 | 9.4 % | 19.8 MK | 40.5 MK (18 %) | 100 % | 66.0 s |
| 6e-3 | 1 | 5.7 % | 18.8 | 24.2 (32 %) | 67 % | none |
| 2e-3 | 1 | 2.0 % | 18.8 | 20.9 (41 %) | 38 % | none |
| 2e-3 | 3 | 1.9 % | 15.9 | 15.9 (99 %) | 10 % | none |

**The whole life at feedback 1 to 3** (14 000 frames = 400 s, two seeds, G 6):

| c | λ₀ | feedback | first collapse | burnT | H-weighted (share at 10–20 MK) | helium flash |
|---|---|---|---|---|---|---|
| 5 | 6e-3 | 1 | 5.7 % | 17.4 MK | 35 MK (22 %) | 172 s |
| 5 | 4e-3 | 1.5 | 3.8 % | 18.0 | 33 (27 %) | 267 s |
| 5 | 2e-3 | 2 | 2.0 % | 18.9 | 25 (36 %) | 390 s |
| 10 | 2e-3 | 2 | 2.0 % | 19.8 | 37 (25 %) | 203 s |
| 10 | 2e-3 | 3 | 2.0 % | 20.3 | 28 (28 %) | 317 s |

All of them burn at 10 to 20 MK over most of the hydrogen phase (G 6, c 5, λ₀ 6e-3, feedback 1, burning temperature every 20 s: 7, 17,
17, 16, 24, 17, 24, 37 MK, then the flash), and all heat up in the last third of the hydrogen, before the flash: the hydrogen-weighted
median stays at 25 to 37 MK. A larger feedback shifts it down but makes the star live longer (390 s at feedback 2, c 5).

## The new defaults

**G 9 → 6, c 10 → 5, λ₀ 2e-3 → 6e-3, feedback 0.3 → 1**, κ 20, T_min 0.05 T₀ and λ_He 2.5e-4 unchanged, every flag on. Chosen as the setting
whose hydrogen burns coolest over the time a visitor watches it, with the shortest life of those (the flash under 3 minutes).

Six seeds (20240611 to 20240616), 7 000 frames = 198 s, on the frozen worktree with the shipped defaults (no override):

| | median | spread |
|---|---|---|
| first collapse | 5.7 % of the hydrogen, 38 400 fusions/s | 5.6 to 5.7 % |
| burning again (100 fusions/s or more) | 23.5 s | the same in all six |
| **H burns at** (burnT) | **18.9 MK** | 18.4 to 19.0 MK, **6 of 6 in 10–20** |
| core plateau (densest cell) | 23.4 MK at 4.9 ρ₀ | 23.1 to 23.8 MK |
| hydrogen-weighted burning temperature | 36 MK, 17 % of the hydrogen at 10–20 MK | |
| **helium flash** | **6 of 6, 171.7 s** | 170.0 to 171.7 s |
| at 198 s | carbon 99.5 %, hydrogen 0.5 %, core 215 MK | |

The run (seed 20240611): the first collapse at 3.7 s (34 MK, 9 ρ₀) burns 5.7 % of the hydrogen, its heat bounces the cloud, which cools to
1.5 MK and falls back; the hydrogen lights again at 22 s and burns at 10 to 20 MK, the core breathing between 8 and 18 MK, for about 120 s
(92 % of the hydrogen left at 47 s, 73 % at 120 s), then heats as the hydrogen runs out (24 to 37 MK from 140 s), and the helium flash turns
everything to carbon at 172 s. **The lull is longer** (18 s against about 5 s with the flags off): the feedback of 1 bounces the core
harder, and G 6 makes the fall back slower.

**The thermostat test** (the plan: "the central temperature varies by a few percent when λ varies by a decade"), three seeds each, 198 s:

| λ₀ | 1.9e-3 (÷ 3.16) | 6e-3 (the default) | 1.9e-2 (× 3.16) |
|---|---|---|---|
| burning temperature (burnT) | 20.1 MK (+6 %) | 18.9 MK | 19.4 MK (+3 %) |
| first collapse | 1.9 % | 5.7 % | 15.2 % |
| helium flash | none in 198 s (38 % of H left) | 171.7 s | 140.0 s |

**Met for the first time**: +6 % / +3 % across a decade of λ₀ (+95 % / +5 % with the flags off and the P4 defaults, −37 % / +16 % with the
old cooling). The burning temperature is set by the thermostat (G, c and the feedback), not by λ₀, which now mostly sets the first burst.

**The A2 reference** moves back towards the real ratio: at 20 ρ₀ and 0.1 fusions per second per particle hydrogen ignites at 14.3 MK
(19.2 MK with λ₀ 2e-3), so the He/H ignition ratio there is 6.98 (5.2; real 6.67); over 20 to 100 ρ₀ and 0.03 to 0.5 per second it runs
from 4.7 to 11.8 (`tests/gamowRates.test.ts`).

## What changed in the code

| Piece | Where |
|---|---|
| The six flags default to on | `src/simulation/protostar/declaration.ts`; the docs of five of them say "On by default" in the five catalogs |
| G, c, λ₀, feedback | `src/config.ts` (the sliders' defaults, with the history in the comment above them) |
| The lab's reference model: `restart()` turns every flag off (`LAB_REFERENCE_FLAGS`) unless the scenario passes `shippedFlags: true` (the default cloud's baselines and the protostar's performance probes) | `src/lab/config.ts`, `src/lab/driver.ts`, `src/lab/scenarios/baseline.ts`, `perf.ts`, `perfProtostar.ts` |
| Tests: the flags' defaults, the calibration values and the A2 reference | `tests/protostar.test.ts`, `tests/gamowRates.test.ts` |

The lab's physics scenarios were written for each part alone and recorded with every flag off: with the flags now on by default they would
all have changed (A11 does not conserve the energy, C1 changes the cold collapse and the Sod tube's reference...). `restart()` keeps them on that
reference model; a scenario that tests a flag already sets it.

**Saved configurations** keep their stored values: every flag off and G 9, c 10, λ₀ 2e-3, feedback 0.3 (the built-in "Default" configuration
comes from the code and gets the new values). A saved configuration therefore runs the model it was saved with.

## Limits

- **The last third of the hydrogen burns hot** (25 to 40 MK, then up to 200 MK in the flash): as the hydrogen runs out the helium core
  contracts and heats. Every setting tried does it; a larger feedback softens it at the price of a longer life.
- **The lull after the first collapse** is 18 s.
- **After the helium flash the core falls to the grid's scale**: carbon at 239 MK and 345 to 365 ρ₀ at 198 s in all six seeds (ω·dt 0.23 in
  the core), the end state of every setting with the flags on: nothing burns the carbon and nothing holds it up.
- **Cost**: every flag on costs what their spikes measured, together (below, from the lab's performance probes); the first-visit benchmark
  times the flags on (the adaptive step off, `BENCHMARK_PARAMS`), so its cap drops accordingly.

## Reproducing

    S=...   # scratch directory
    # serve the frozen worktree: cd ~/src/ps-frozen && npx vite --port 5199
    V='[{"name":"new defaults","frames":7000}]'
    flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs --url http://localhost:5199/particle-simulator/lab.html --timeout 3600 --out $S/c1.json \
        --query "scenarios=baseline.protostar.default-cloud-tuning&cloudSeeds=6&cloudVariants=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$V")"
    node scripts/cloud-tuning-summary.mjs $S/c1.json
    node scripts/cloud-tuning-series.mjs $S/c1.json "new defaults" 20240611 1

A variant with `"params":{"collisions":false,...}` turns flags off; `"overrides":{"gravity":9,"radiation":10,"fusionRate":0.002,"feedback":0.3}`
gives the old physics values. The hydrogen-weighted temperature was computed by a scratch script over the same series (the hydrogen burnt between
two readings, weighted by their mean `burnTemperatureMK`).
