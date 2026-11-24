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

(numbers below)
