# Improvement plan: status and how to resume

State of the work that implements the professor's "Améliorations des algorithmes v3" document
(23 proposals A1–A14, B1–B5, C1–C4 for the protostar and the sticky dust). Written when the
session was stopped on 2026-11-22. Everything described as done is committed on the local branch
`feat/improvements`; **nothing was pushed and `master` was not touched** (a push to `master`
deploys the live site).

## Where things are

| What | Where |
|---|---|
| Integration branch | `feat/improvements` (local only, 75+ commits ahead of `master` at `bbfda02`) |
| One branch per finished phase | `feat/features-tab`, `lab`, `second-deposit`, `dust-gravity`, `energy-diagnostics`, `granular-dust`, `heating-temperature`, `coherent-supernova`, `mean-molecular-weight`, `gpu-concentration`, `integrator-order`, `initial-conditions`, `gamow-rates`, `adaptive-dt`, `constant-mass-fusion`, `thin-disc-cooling`, `stability-map`, `tsc-deposit` (all already contained in `feat/improvements`) |
| Spike documents (design, numbers, how to reproduce) | `docs/spikes/*.md` |
| GPU lab (dev-only acceptance scenarios) | `docs/lab.md`, `docs/lab-baseline.md`, `lab.html`, `src/lab/`, `scripts/run-lab.mjs` |
| The reference document and the detailed (French) plan | the professor's artifact `claude.ai/artifact/6Txa6P6gDU4AbjdxHdhPTa`; the plan `~/.claude/plans/fait-un-plan-de-cheerful-sphinx.md` |
| Old agent worktrees | `.claude/worktrees/agent-*` (git-ignored through `.git/info/exclude`; safe to remove, see the end) |

`make check` (628 tests) and `make build` (with the `check-dist` guard) pass on the head of
`feat/improvements`.

## Done (all merged in `feat/improvements`)

| Phase | Proposal | Result |
|---|---|---|
| P0a | feature-flag plumbing | `features` panel tab, boolean/choice params in algorithm declarations, `afterDensity` hook, debug accessors |
| P0b | dev-only GPU lab | `lab.html`, scenario registry, headless Chrome runner, dist guard, recorded baseline (GTX 1060) |
| P0c | second deposit (for A1) | composition on a second attachment of the moments pass: +1.08 ms/frame at 400k (19 % of the simulation frame) |
| P1a | A7 + multichannel reduction | potential in the gravity z channel, energy and virial stats, one async reduction (peak, centre of mass, maxima), flag `diagnostics` (ON) |
| P2 | B1 + A14 (dust) | gravity per density texel: −19 % at 400k and 1M, −4 % at 3M; anisotropy 38 % → 3.9 % |
| P6a | A10 (dust) | granular dust: Haff cooling exponent −2.00, kinetic pressure, collision-speed barrier, colour by agitation; `K_GRAVITY` replaced by `DUST_GRAVITY_GAIN` = 1.2 |
| P3a | A5 + A3 | heating by velocity scaling (ΔK = q·dt to 4e-6), temperature-noise bias correction and smoothing (τ = 0.1 s) |
| P6b | A9 (dust) | coherent supernova: front R ∝ t^0.5 exactly, homologous stratified ejecta, trigger on mass, retuned constants |
| B4 | GPU reductions (dust) | concentration search on the GPU, no more 48 MB readback: worst frame 209 → 97 ms at 3M |
| P3b-1 | A1 | T = (μ/μ_H)·dispersion (He reads 2.6477× H, pure H unchanged); G 13.85 → 9, λ₀ 1.5e-4 → 4e-3 |
| P5a | integrator | the energy drift came from the wall bounce (not the pass order): flat −0.14 % over 100 orbits, independent of dt |
| P5b | A8 | initial conditions by αvir = 0.33 and βrot = 0.08, disc circular-speed table, Maclaurin profile, correlated turbulence (option; `white` stays default) |
| P3b-2 | A2 | Gamow laws, local exponents within 0.023 % of theory, exact unbiased estimator for the triple alpha, He/H ignition ratio 6.3 (real 6.67); λ_He 2.5e-4, glow range 1–15 T0 |
| P5c | B5 | adaptive time step, flag `adaptiveTimeStep`, ships **OFF** (+30 % work when on; ω·dt max 0.17 → 0.12–0.14) |
| P3c | A4 | fusion changes the type of constant-mass parcels (nothing is removed): momentum conserved to 4.5e-9, `drift.ts` removed, per-type counts on the GPU, stats tile now "Mass per element" |
| P4 | A6 + A13 | thin-disc cooling `dT/dt = -c mu T^4 / (Sigma tau_eff)` integrated exactly (lab: exact law to 5.6e-7), `cooling`/`opacity` replaced by c, kappa, T_min; Jeans floor behind `jeansFloor` (OFF; blobs at t_J to 2e-7, the cloud's smallest Jeans length 2.1 -> 3.5 cells); recalibrated c 10, kappa 20, **lambda_0 2e-3, feedback 0.3** (user's choice): first collapse 33.5 %, helium flash 12 of 12 at 20.5 s, H burns at 27 MK after a ~5 s lull; cost not measurable |
| P1b | A12 | stability map: Q and beta = t_cool Omega per cell of the gas grid (one 128² pass, twin `stability.ts`; GPU vs twin 2.2e-7), drawn over the animation after the post-processing; choice `stabilityMap` in the Features tab (off, fragmentation, Toomre Q, cooling beta), **off** by default, nothing runs while off. At t = 0 Q = 0.19 to 0.32 (particles agree within 1 to 8 %) but beta = 15 to 21 (the professor's 0.6 was for the cooling before A6); after the first collapse 60 to 95 % of the gas has Q < 1 and beta < 3 until the star forms (~22 s), then 4 % |
| C4 | TSC deposit | switch `tscDeposit` in the Features tab of **both** algorithms, **off** by default ([spike](spikes/c4-tsc-deposit.md)): kernel `deposit-kernel.glsl` and twin `depositKernel.ts`; the protostar reads its gravity with matched TSC weights (read bilinearly, TSC gives a particle a self-force up to 1.8 % of its pull at 1.5 cells); noise shape 1.63 (theory: CIC's averages 1.51, the measured 1.5). Thermal gas at rest: T noise −5 % (variance ÷ 1.11, theory 1.108); near-field gravity aliasing 4.7 → 0.7 %, anisotropy 4.5 → 1.2 % at 1.5 cells, pull −10 % there; energy drift unchanged (−0.19 vs −0.17 %); default cloud and dust timeline unchanged; cost +44 % (400k) and +68 % (1M) per protostar frame, +16 % dust. Lab option `params=` runs any scenario with a switch |

## Remaining

Order matters: the protostar phases are sequential (each recalibrates the same dynamics).

1. **Gate G1**, then the heavy chantiers, each only if measurements justify it: **C1** MPC/SRD collisions (flag `collisions`; γ = 2, the native 2D value, is a PROVISIONAL choice to confirm; deposit and rotate passes after Verlet), **B3** single pass per particle (keep the stored layout x(n+1), v(n), a(n), `dtPrev`; design it with C1's second pass), **A11** adaptive thickness (flag) then **C2** nested grid (flag; decide the gravity channel budget; **B2** FFT only if C2 doubles the gravity cost), **C3** continuous composition (only if the draw noise is visible after A4).

## Known issues and open decisions

- **First-collapse fusion burst** is not tamed: since P4, 33.5 % of the hydrogen at ~510 000 fusions/s (35 % at ~870 000 before; it comes from the Gamow steepness at 5–9 MK). **After P4** the T^4 cooling no longer cools the cold envelope: burning resumes ~5 s after the bounce (10.3 s instead of 5.2 s), and the hydrogen burns at 27 MK (heat-weighted; 20 MK before) in a core of ~12 rho0 (35 before), outside the 10–20 MK window. A line-cooling term for the thin gas would be the lever (not in the proposals). The plan's thermostat test (a few % per decade of lambda) is met by neither law ([spike](spikes/a6-a13-cooling-and-jeans.md)).
- **A4 cost**: nothing is removed any more, so the late-phase frame is about +50 % (15.6 → 23.3 ms at 400k) and the whole frame +13–15 %. The early-window A/B (25.4 vs 10.8 ms in 6 pairs, 10.9 vs 11.0 on a clocked pair) is **inconclusive**: re-measure on a rested GPU. The first-visit benchmark cap could drop (replayed offline: 580k vs 280k if the 25.4 ms were real); re-check it in a real browser.
- **Dust**: +14 % at 1M particles in late phases after A10, cause not found (absent at 400k). Particle-cap ratio of the dust vs the protostar is still 1.25 while the measurements support 1.3–1.7: decide. Saved dust configs with `supernovaPower` 70 % now mean 588 px/s rms instead of 294.
- **Saved configs** keep their old protostar G, λ₀ (4e-3, with which the first collapse now burns 46 %) and feedback, and lose removed keys (exponent sliders, `rotation`, `agitation`, `cooling`, `opacity`): defaults are applied silently.
- **Not visually checked by a human**: the lab and the tests validate the physics, but nobody looked at the real UI (the `features` tab with 7–8 tabs in 280 px, the dust's own Features tab since C4 (one switch: TSC deposit) and its stability-map select (seen only in headless screenshots), the new stat tiles, the glow after the range change, the nebula after A4). Do a visual pass with `make dev` before any merge to `master`.
- **Timings**: the dev GPU (GTX 1060) often sat in a low-clock state (P5, 734 MHz) during long campaigns; read ratios, not absolute milliseconds.
- `docs/algorithms.md` is updated by each phase; `CLAUDE.md` mentions the lab in one line.

## How to resume

1. `feat/improvements` is currently checked out in the worktree `.claude/worktrees/integration` (created to commit this file; it has an untracked `node_modules` symlink to the main one). Either work there, or free the branch with `git worktree remove --force .claude/worktrees/integration` and then `git checkout feat/improvements` in the main directory. Run `make check` (use `make -o node_modules check` in a worktree whose `node_modules` is a symlink).
2. Pick the next phase above. Delegate each phase to ONE agent in its own worktree: `git checkout -b feat/<name> feat/improvements`. Give it: the proposal's text from the professor's document, the relevant spike documents, the rules below, and the acceptance tests of the plan. Commit as you go (usage-limit cuts happen).
3. Land a finished phase with `git fetch . feat/<name>:feat/improvements` (fast-forward only; the branch must first be rebased onto `feat/improvements`). If `feat/improvements` is checked out in a worktree use `git merge --ff-only` there instead.
4. GPU runs (`node scripts/run-lab.mjs ...`, see `docs/lab.md`): run them one at a time, e.g. `flock /tmp/particle-sim-gpu.lock node scripts/run-lab.mjs ...`, never with another browser tab running the simulator (a stray tab corrupted earlier timings), and read ratios when the GPU is clocked down.
5. Rules: commit messages and docs in English, no `Co-Authored-By`, strict TypeScript without `any`, constants in `src/config.ts`, texts through `t()` in the five catalogs (en first), shared uniform objects stay shared by reference. Do not merge into `master` or push without an explicit decision: the push deploys the site.
6. To publish, once reviewed: `git checkout master && git merge --ff-only feat/improvements && git push` (deploys GitHub Pages).

## Cleaning up the old worktrees (optional)

`git worktree list` shows the agent worktrees. Every phase branch is merged in `feat/improvements`, so
`git worktree remove --force .claude/worktrees/agent-<id>` loses nothing (each holds an untracked `HANDOFF.md` that
is obsolete). The phase branches themselves can be deleted with `git branch -d`.
