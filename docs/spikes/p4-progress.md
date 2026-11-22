# P4 (A6 thin-disc cooling, A13 Jeans floor): work in progress

Branch `feat/thin-disc-cooling` (from `feat/improvements` at `6f615b5`), not merged. Stopped on request on 2026-11-22 in the middle of the
recalibration. This file is the handoff; it becomes the spike `a6-a13-cooling-and-jeans.md` once the phase is finished.

## Done (committed)

- `src/simulation/protostar/cooling.ts`: the twin of the cooling (Johnson & Gammie: `tau = kappa Sigma / 2`,
  `tau_eff = 3 tau / 8 + sqrt(3) / 4 + 1 / (4 tau)`, `dT/dt = -c mu T^4 / (Sigma tau_eff)` integrated exactly, floor `T_min`) and of the Jeans floor
  (`t_J = 2 N_J dx G Sigma` on the dispersion, N_J = `PROTOSTAR_JEANS_CELLS` = 4). Tests: `tests/cooling.test.ts` (exact against RK4, composition of steps,
  stiff steps, floor, mu, thick/thin limits, twin of the shader).
- `protostar-velocity.frag`: the "Radiative cooling" block replaced, a "Jeans floor" block after it (scaling, or a kick in a cold cell, stream 3),
  the heating scales the dispersion left by both. `mu` multiplies the rate (heat capacity per unit mass goes as 1 / mu: physically right; dropping
  it was tried and changes little, see below).
- Parameters: `cooling` and `opacity` removed; `radiation` (c, 1/s, log), `kappa` (per rho0, log), `minTemperature` (T0, shown in MK) in the physics
  tab; flag `jeansFloor` (features tab, OFF). i18n in the 5 catalogs. The lab's overrides `cooling: 0` became `radiation: 0`.
- Lab: the default cloud's series now has `burnTemperatureMK` (temperature weighted by the fusion heating: where the hydrogen really burns; the
  densest cell's reading is often the helium ash). `scripts/cloud-tuning-summary.mjs` and `scripts/cloud-tuning-series.mjs` summarize the runs.
- `make check`: 612 tests pass. **The slider defaults (c = 50, kappa = 2, T_min = 0.05) are placeholders, NOT calibrated** (the test
  `gamowRates.test.ts` pins them for now).

## What the measurements say (400 000 particles, speed 1.7, 34 s, seeds 20240611+, `baseline.protostar.default-cloud-tuning`)

Before (old linear cooling, 6 seeds): first collapse burns 35 % of H, burning resumes at 5.2 s, H burns at 19.7 MK (heat-weighted, 3 seeds;
core plateau 16.6 MK at 35 rho0), helium flash 6/6 at 19.1 s, carbon 69 % at the end.

With the T^4 law the history changes, whatever the setting:
- The cold envelope (2 MK) no longer cools (T^3 factor): after the first-collapse bounce the cloud stays warm and only falls back after
  a lull (burning resumes at 8–13 s instead of 5 s). No setting can cool the envelope without also over-cooling the helium core.
- In the thick limit only r = c / kappa matters. r >= 1: the helium core (mu = 2.65, dense) is cooling-limited at ~75–85 MK and never flashes.
  r <= 0.1: weak, disrupted plateau. r ~ 0.3–0.7 (kappa 20, c 6–14): flash 6/6 within 34 s.
- lambda_0 drives the first-collapse burst: 4e-3 gives 46–48 %, 2e-3 gives 33 %. Lower G or a warmer start (alphaVir 0.5) did not help.

Best candidate so far, **B: c = 10, kappa = 20, lambda_0 = 2e-3, feedback 0.3** (6 seeds): burn 33.5 %, burning again at 10.3 s, H burns at
27.8 MK (20–33; 1 of 6 in 10–20), helium flash 6/6 at 20.4 s, carbon 76 %. Variant B2 (lambda_0 1.5e-3, feedback 0.4): burn 28 %, 28.8 MK,
flash 6/6 at 20.8 s, carbon 88 %. With lambda_0 = 4e-3 (A2's value, c = 10): burn 46 %, H at 34 MK.

**Open decision for the user**: B halves lambda_0, which moves the He/H ignition ratio of the A2 reference (20 rho0, 0.1/s) from 6.3 to about 5.2
(real 6.67) and breaks the A2 test "hydrogen within 6 % of 15 MK". Keeping lambda_0 = 4e-3 keeps the ratio but makes the first-collapse burst worse
(46 % vs 35 %). In both, hydrogen burns ~8 MK hotter than before and the post-collapse lull appears.

Thermostat test (the professor's criterion: the central temperature moves by a few percent for a decade of lambda), 3 seeds each, the
temperature of the burning gas (median over the plateau):

| lambda_0 | / 3.16 | x 1 | x 3.16 |
|---|---|---|---|
| old law (lambda_0 = 4e-3 x factor) | 31.4 MK (burst 14 %) | 19.7 MK (35 %) | 22.9 MK (67 %) |
| candidate B (lambda_0 = 2e-3 x factor) | 54.2 MK (13 %, flash 2 of 3) | 27.8 MK (33 %, 6 seeds) | 29.2 MK (58 %, flash at 10 s) |

Neither meets "a few percent": the old law moves by -37 % / +16 % around the center, B by +95 % / +5 %. Above the default lambda B is the
flatter one (the T^4 thermostat holds once the plateau is reached), below it the core burns much hotter (too little fuel per degree:
the plateau is then helium-rich). The criterion assumes an equilibrium that this cloud, with its first-collapse burst and its softened core,
never quite reaches; report it as measured. To redo: `cloudVariants` lambda x {1/3.16, 1, 3.16} on both builds (old build: `git archive 6f615b5`,
its lab needs `src/lab/core.ts` and `src/lab/scenarios/baseline.ts` of this branch for the burn temperature).

## Left to do

1. Decide lambda_0 (above), set the defaults in `src/config.ts` (and its calibration comment), update `tests/gamowRates.test.ts`.
2. 12 seeds of the chosen defaults; thermostat test; check that the first-visit benchmark still runs.
3. Lab acceptance scenarios: blobs of known T, Sigma, mu after one substep against `coolingRatio()` (and a uniform gas over many stiff steps
   against the exact law, the floor T_min); Jeans floor: blobs under the floor raised to exactly t_J, and the default cloud with the flag on/off
   (fraction of mass in cells with lambda_J < 4 cells, min over the run). "Fragments independent of the cell size" cannot be tested (GRID_RES
   is a compile-time define): say so.
4. Cost: `perf.protostar.400k` old vs new (a pow and a few products per particle; expected negligible).
5. Docs: spike `a6-a13-cooling-and-jeans.md`, `docs/algorithms.md` (Cooling section, parameter table, defaults), `docs/lab.md`,
   `docs/improvement-plan-status.md`, the memory. No `criticalStep()` change: the cooling is integrated exactly (unconditionally stable).
6. Land with `git merge --ff-only feat/thin-disc-cooling` on `feat/improvements`.
