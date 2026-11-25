# Spike A4: fusion of parcels of constant mass

Phase P3c of the improvement plan. A fusing particle of the protostar used to be removed with probability 3/4 (hydrogen) or 2/3 (helium) and
otherwise to become the product, so that four hydrogens left one helium and three heliums one carbon: the cloud ended with about twelve times fewer
particles, the momentum was conserved only on average (a survivor carries its velocity with three or twelve times the mass) and a correction of the
centre of mass had to be measured on a read-back of the positions and taken off every particle. This phase makes every particle a **parcel of constant
mass**: a fusing parcel changes type and keeps everything else. Validated in the lab ([lab.md](../lab.md)) and on the default cloud of the A2 spike.

**Verdict.** The fusion conserves the momentum, loses no particle and keeps the energy; nothing was retuned. Every particle is a parcel of mass `TOTAL_MASS / count`
whatever its type; a fusing parcel changes type and keeps its velocity. With no gravity the momentum of a fusing gas moves by **4.5e-9 of its thermal momentum over 10 000
substeps** (5.3e-3 before, with half of the particles gone: the target was 1e-6); the 400 000 particles of the default cloud are 400 000 at the end (54 360 before) and its core keeps 193 632 of them (21 771 before); the
fusions that happen and the energy they release equal the expected ones and the power the heating deposits to 0.25 % (the Poisson noise). On the six seeds of the A2 spike the first collapse still burns 35 % of the
hydrogen, the plateau is at 18.7 MK (18.2 before; 17.9 MK and nine seeds in twelve in 10 to 20 MK over twelve) and the helium flash comes in every seed within 34 s (twelve in twelve); the helium burns further than it did
(carbon 70 % of the mass at 34 s, 33 % before: partly the noise correction's effective number of particles, partly unexplained). The statistics' tile now says "Mass per element". The periodic read-back of the positions (6 to 48 MB every 12
frames, with the CPU loops of the type count and of the drift correction) is gone, replaced by a GPU count of 2 to 6 ms every 10 frames: **the worst frame over the median falls from 65, 68 and 135 ms to 8, 14 and 26 ms** at
400 000, 1 000 000 and 2 000 000 particles. What it costs: **the late phase of the run is about 50 % dearer** (15.6 to 23.3 ms/frame at 400 000 particles, 27 to 42 ms at 1 000 000) because no particle is removed, and an early-window
slowdown that the six alternated pairs showed at 400 000 particles (25 against 11 ms) is a state of the GPU in all likelihood (the same code gave 10.9 ms in a clocked pair) but could not be proved. Two decisions differ from the plan:
the nebula weighs the parcels' one mass instead of keeping the atomic masses (it would brighten 9 times as the cloud burns), and the initial distribution of a mixture is now shares of the mass.

## The design

**The type change.** The position pass draws `p = 1 - exp(-rate dt)` for a particle that can fuse and, on success, rewrites the type in the z channel of the
position (`reactionTo[type]`): nothing else, no second draw (the `reactionKeep` array and its random stream are gone), no `w = -1`, the velocity is not
touched. The rate is the one of A2 (`lambda (rho X)^n f(T) / f(T_ref)`, the fraction of the fuel that fuses per second), so `p` is the share of the parcel's
mass that fuses in the step and the expected mass that changes type per step is `p m`.

**The energy stays the expected power.** The power deposit still puts `m rate energy` into the grid (`energy` = feedback x defect fraction x c^2 per unit of
fused mass, `reactionArrays()`), and the heating adds `q dt` of kinetic energy per unit mass by scaling the deviations from the local mean: nothing in it
reads the draw. The fused mass and the energy agree in expectation to the first order in `rate dt`: `p m energy = m rate dt energy (1 - rate dt / 2 + ...)`,
0.3 % at the rates the lab draws and the default cloud's (`fusionExpectation()` in `reactions.ts` is the twin the tests use; `protostar.constant-mass.energy` measures it).
Where the rate times the step is not small (the cap `PROTOSTAR_FUSION_RATE_MAX` is 100 per second and a step lasts 14 ms) the power is above what the converted mass would give by up to `rate dt / 2`; the lab measures 0.25 % on its gases and the calibration was left alone.

**The masses.** The mass of a particle is `TOTAL_MASS / count` for every type, from `ProtostarModel.updateSpecies()`: it is the per-type array
`speciesDepositMass` of the grid passes (`ProtostarGrids.setDepositMasses()`, read by `protostar-deposit.vert` for the moments, the composition and the
power: gravity, density, the temperature's weights, the effective number of particles and the fusion power all see parcels of one mass) and the shared
`speciesUniforms.splatMass`, which the nebula layer reads. The atomic mass of the editor is now only **A**: it enters `1/mu = (1 + Z)/A` of the composition
deposit (the parcel's mass times the type's `(1 + Z)/A`: a parcel of helium is `0.7495 m` of free particles, one of hydrogen `1.984 m`) and the mass defect
of the reactions. The weights of the initial distribution split the particles, which all weigh the same, so they are the shares of the **mass** of the
initial cloud: the default (pure hydrogen) is unchanged, a mixture of 60 % hydrogen and 40 % helium is 60 and 40 % of the mass where it was of the
atoms (weighed by the atomic masses it was 27 % hydrogen). Custom elements of the editor keep working: any type whose symbol is in the table of elements has its
Z, the others `0.5 A`; one that is the `from` of no reaction never fuses.

**The nebula.** The plan asked to keep the atomic-mass `splatMass` for the nebula "so that it keeps its look". It weighs its colour and its brightness by the mass
of each particle (`(colour x m, m)` into a texel, the lens and the glow read the mass), and with parcels that change type a weight proportional to the atomic
mass would multiply the mass a parcel splats by 4 when it turns into helium and by 12 when it turns into carbon: the cloud would brighten as it burns. Parcels of
one mass keep the mass of the nebula what it was (the old build's sum of atomic masses was conserved on average), with the colours following the types.
`protostar.constant-mass.nebula` gives the numbers. The array of the grids is kept distinct from `splatMass` all the same (a later phase can weigh the
two differently); the model sets both.

**The counters.** A parcel is not an atom, so the tile that said "Particles per type" counted something that no longer means anything: it is now **Mass per
element**, the share of the total mass of each type (`typeMasses` stat kind, `Simulation.liveTypeMasses()`: the live count per type times the mass of one), with
a hover text that says what a parcel is, in the five catalogs. A share under 0.1 % reads `<0.1%`, so that the first helium does not read 0 (`formatTraceShare()`).
The shares come from physical mass, not from atoms: the atomic masses of the editor can be edited live and change nothing of them.

**The read-back.** Counting the types needed a read-back of the whole position texture every 12 frames (6.4 MB at 400 000 particles, 48 MB at the
3 003 289 slots) and a loop over the particles on the CPU, and the same read-back fed the drift correction. Neither is needed: `drift.ts`, `driftKick`,
`pendingKick`, `PROTOSTAR_DRIFT_GAIN` and the whole `onReadback` of the model are gone, and the particles of each type are counted on the GPU
(`typeReduction.ts`, `protostar-types.frag`): a first pass of `32 x 32` texels of the position texture per texel, written as the number of live particles of each type
(four types per attachment, three attachments), a second pass that adds them into one texel per type, and one read of `MAX_SPECIES` texels on the stats' frames (every
`PROTOSTAR_STATS_INTERVAL` = 10 frames, with the reduction of the grids). Float32 sums of integers are exact up to 2^24 particles of a type; the passes use no
blending, so there is no device without `EXT_float_blend` to fall back for (the dust's `ConcentrationReduction` needed one). `src/lab/typeCounts.ts` keeps the CPU
counter as the reference of the lab's parity scenario.

**Dead code removed.** `drift.ts` and its tests, the `keep` array and `survivalProbability()`/`expectedMassAfter()`, `reactionKeep`, the `REMOVED_W` define and the
`w < 0` tests of the protostar's four shaders (the position, velocity and acceleration passes and the deposit): nothing writes a negative `w` any more. The
shared render layers (`particle.vert`, `nebula.vert`, `splat.vert`) and `REMOVED_PARTICLE_W` keep the contract: the sticky dust's files and the layers they share are not
this phase's to change, and a future algorithm may remove particles.

## Acceptance

All on the real GPU simulation (`protostar.constant-mass.*` and `perf.protostar*` of the lab, [lab.md](../lab.md)); "the build before" is `0e4fc9c` (the A2 phase), served from an archive of it
with the same scenarios copied over (the ones that read only the application's public surface run on both). Renderer string and protocol at the end.

### 1. The momentum is conserved by the fusions

`protostar.constant-mass.momentum`: 100 000 particles of hydrogen and 20 % helium (by particles; by mass since A4) at 2 rho0, drawn cold (2 px/s per component) and
moving as a whole (3, 1.5 px/s), gravity off, a rate of fusion that does not depend on the temperature (lambda 0.2 and 0.3, per second and per rho0) so that it all
fuses, **10 000 substeps** of 0.83 ms (8.3 s) one per frame, no drawings. The velocities, positions and the mass of each type are read back at ten instants and the
momentum summed in **double precision** from them. The scale is the thermal momentum **M sigma = 62 260** (mass x px/s) with `sigma = sqrt(sum m |v|^2 / (2 M))`, the
speed per component the gas has (bulk motion included); it is also given against the sum of `m |v|`.

| | build before | this build |
|---|---|---|
| particles alive at the start, at the end | 100 000, **50 249** | 100 000, **100 000** |
| types (H / He / C) at the start, at the end | 80 000 / 20 000 / 0, 31 522 / 11 999 / 6 728 | 80 000 / 20 000 / 0, 23 263 / 32 422 / 44 315 |
| fusion only (cooling and feedback off): change of the momentum, worst of ten checkpoints, in thermal momenta | **5.3e-3** (1.9e-3 to 5.3e-3) | **4.5e-9** (0.9e-9 to 4.5e-9) |
| the same, against the sum of m abs(v) | 4.1e-3 | 3.5e-9 |
| mass held by the live particles | 20 090 to 19 982 (the defect) | 20 000, exactly |

The target (1e-6) holds by a factor of 220. What is left, 1e-9, is not the fusion's: the velocity pass rewrites every velocity as `u + (v - u) e^(-k dt)` around the local mean
`u` even with `k = 0`, which is not the identity in float32, and its rounding errors walk at random (the change grows from 1e-9 at 1 000 substeps to 4.5e-9 at 10 000, the
shape of a random walk). Nothing removes momentum any more: the build before lost 5e-3 of it at the first checkpoint, with 11 % of its particles gone.

With the cooling at its default and a feedback of 0.01 (the sliders' minimum), the same gas moves by **2.0e-3 to 2.3e-3** of the thermal momentum over the first six checkpoints
(6 000 substeps), the build before by 5e-3 to 1.1e-2; then both grow when the heated gas reaches a wall (83 particles at the end in this build, 12 in the other), which a
bounce changes by definition. That 2e-3 is the cooling and the heating, not the fusion: they act on the deviation from a local mean that a particle reads by bilinear
interpolation of a 3 x 3 neighborhood, and `sum m (v - u(x))` is not zero for a gas that is not uniform (the A5 spike measures the energy of the heating, and the
momentum of its blobs to 1.7e-7 where the mean is the blob's own). The velocity-block physics of the next phases inherits this: **the momentum is exact for the fusion and good to
a few thousandths for the cooling and the heating of a drifting gas**. With the gravity grid on, the monopole force is not momentum-conserving either (the plan said so: the test is at
G = 0).

### 2. No particle disappears, and the core keeps its population

`protostar.constant-mass.population`, the default cloud (400 000 particles, 1 200 frames, 34 s), a snapshot every 100 frames:

| | build before | this build |
|---|---|---|
| live particles at the end | **54 360** (13.6 %) | **400 000**, at all 13 snapshots |
| types at the end (H / He / C) | 20 110 / 3 974 / 30 276 | 25 272 / 100 799 / 273 929 |
| particles within 40 px of the densest cell: largest, at the end | 136 360, **21 771** | 197 968, **193 632** |

The type count of the GPU equals the CPU's count of the read-back positions at all 13 snapshots (exact integers); the statistic's own reading (every 10 frames, a few frames late) follows it,
and its shares of the mass add up to 1. The core population of this build is not constant in time (the cloud collapses and clumps: 40 783 particles in the core at frame 200, 197 968 at
frame 100 when the whole cloud is still one blob): what is constant is that fusion never changes it, where the build before lost seven of eight particles of it by the end.

### 3. The energy the fusions release is the one the heating deposits

`protostar.constant-mass.energy`: pure hydrogen and pure helium gases of 400 000 particles at 2 rho0, a rate of fusion independent of the temperature (0.3 and 0.1), the feedback at 1, no gravity or
cooling, **100 single substeps of 16.7 ms**. At each step the position texture is read back and the particles that changed type counted one by one (`typeChanges()`); the power grid is read back and its
fusion-rate channel summed (the expected number of fusions per second, `sum_i rate_i`) and its power channel (`sum_i m_i rate_i energy`, in deposit units).

| | hydrogen | helium |
|---|---|---|
| fusions that happened, expected (power grid x dt), ratio | 133 625, 133 957, **0.9975** | 109 850, 109 843, **1.0001** |
| Poisson noise of the count | 0.27 % | 0.30 % |
| energy released (changed parcels x mass x energy per unit of fused mass), deposited (power grid x dt), ratio | 1.904e6, 1.909e6, **0.9975** | 1.427e5, 1.427e5, **1.0001** |
| particles lost | 0 | 0 |

Within 0.25 % of the expectation, which is the Poisson noise (tolerance 2 %); the 0.25 % under 1 for the hydrogen (initial rate 0.6 per second: `rate dt` = 1 %) is the saturation of
`1 - exp(-rate dt)` that `fusionExpectation()` predicts (`rate dt / 2`, and the rate falls as the hydrogen is used). The units agree: the position pass converts `p m` and the power
deposit puts `m rate energy`, with the same `m` (one parcel) and the same rate.

### 4. The default cloud (the A2 spike's six seeds, and twelve)

The same protocol as the A2 spike (400 000 particles, speed 1.7, 1 200 frames = 34 s, seeds 20240611 to 20240616 and to 22): `baseline.protostar.default-cloud-tuning`. The build before **reproduces
the A2 table to the digit** (same GPU, same seeds), which is the check that the comparison is fair. Amounts of matter are in **percent of the mass** (the build before counts particles of
different masses: H + 4 He + 12 C = 400 000 hydrogen atoms; here the particles are parcels of one mass).

| 34 s, six seeds | before (A2) | after (A4) |
|---|---|---|
| hydrogen burnt before 4.5 s | 35 %, 35 %, 35 %, 35 %, 34 %, 36 % | 35 %, 35 %, 36 %, 35 %, 34 %, 36 % |
| peak fusions per second of that burst | 783 k, 807 k, 771 k, 779 k, 759 k, 785 k | 946 k, 891 k, 842 k, 856 k, 809 k, 994 k |
| core T on the plateau, median (MK) | 38.7, 17.7, 19.2, 18.2, 14.8, 16.4 | 11.9, 18.7, 17.1, 20.9, 25.2, 11.6 |
| core T weighted by the hydrogen burnt after (MK) | 16.7, 17.5, 23.7, 24.4, 11.9, 29.5 | 23.8, 41.6, 20.0, 33.7, 27.6, 12.1 |
| highest core T after 6 s (MK) | 99, 196, 150, 151, 64, 114 | 285, 144, 211, 162, 113, 233 |
| core T in the last 15 % (MK) | 79, 86, 33, 95, 41, 67 | 86, 102, 181, 123, 47, 77 |
| hydrogen left (% of the mass) | 11.8, 6.1, 6.1, 5.8, 16.1, 6.4 | 6.3, 5.7, 1.8, 2.9, 10.2, 6.0 |
| helium left (% of the mass) | 79, 17, 64, 33, 50, 62 | 25, 27, 1, 2, 60, 23 |
| carbon (% of the mass) | 9, 76, 30, 61, 33, 32 | 68, 67, 98, 95, 30, 71 |
| first helium flash (s) | none, 24.6, 17.6, 15.3, 22.9, 25.2 | 26.4, 23.2, 18.7, 24.4, 32.0, 25.5 |

Six seeds, medians: **the first collapse burns 35 % of the hydrogen in both** (a burst of 891 000 fusions per second against 783 000 in the median: +14 %, seed by seed +7 to +27 %);
**the plateau is at 18.7 MK against 18.2** (11.6 to 25.2; four seeds in six in 10 to 20 MK, against five of six: the sixth and the second are one seed at 20.9 and one at 25.2); **the helium flash
comes in six seeds of six within 34 s** (median 25.5 s) against five of six (22.9 s: its seed that never flashed, 20240611, flashes at 26.4 s). Twelve seeds: plateau **17.9 MK, nine in twelve
in the target** (the A2 spike: 18.2 and 18.3, nine in twelve), helium flash **twelve in twelve** (A2: ten), median 25.5 s.

What changed, honestly:

- **The helium burns much further.** At 34 s the carbon holds **70 %** of the mass in the median (33 % before) and the helium 24 % (56 %): two of the six seeds end with 95 % of carbon or more and
  three with 67 to 71 % (before, two were above 60 %: 76 and 61 %). Up to 20 s the history is the same (median shares of the mass in H / He / C at 5, 10, 15 and 20 s: 65/26/8, 58/33/8, 44/47/8, 28/60/9 before;
  65/27/8, 59/33/8, 46/46/8, 28/59/12 after); the flash then starts within the spread of the seeds and burns further, so that the peak temperature after 6 s is higher (211 MK against 150 in the median,
  285 at most) and so is the temperature of the last 15 % (102 against 79 MK: the ash reads 3.4 times its dispersion). The cause is not isolated by this phase; the likely one is the effective number of particles
  of the noise correction, which the build before computed from particles whose masses differ by a factor of 12 (carbon and helium particles are few and heavy, so the number of independent particles behind
  a core temperature is small, and the exact unbiased estimate of the triple-alpha rate is nil where the temperature estimate is below `G / N` of the reference): the correction now sees the real count.
  The variants with the correction off (below) test it.
- **The first-collapse burst is 14 % more intense** (+7 % to +27 % per seed) and the burn-weighted temperature of the hydrogen is higher (27 against 24 MK): the core of the cloud is better resolved
  (400 000 parcels instead of the thinned cloud), which the burst probes.
- Nothing was retuned: the plateau and the flash are inside their targets and `src/config.ts` is untouched. A longer carbon ash is a new thing to look at (the stats' temperature reads 47 to 181 MK in the last
  15 %, and one seed reads 342 MK for a reading after 6 s), not a failure: carbon does not burn here.

**With the correction of the noise of T off** (`uncorrected`, six seeds each; the rate is then biased high at the real exponents, A3): the build before has a plateau at 16.7 MK, a helium flash in 5 seeds of 6 (22.1 s) and carbon at
44 % of the mass at 34 s in the median (95, 87, 55, 25, 9 and 33 % per seed; 33 % with the correction); this build has a plateau at 18.7 MK, a flash in 5 of 6 (24.4 s) and carbon at 69 % (68, 70, 98, 96, 14 and 67 %; 70 % with it). So
the correction cost the build before a part of its helium burn (33 to 44 %), which supports the explanation for part of the difference, and does nothing in this build (70 to 69 %), whose helium burn does not depend on it; the rest of
the difference (44 against 69 %) is not explained here. The run on the code rebased on B5 (adaptive step off, its default) gives the same six seeds to the digit.

### 5. What it looks like

The default cloud drawn by the whole rendering stack at frames 100, 300, 700 and 1 200 (`protostar.constant-mass.appearance`, JPEGs of the canvas, both builds) and the application itself in a headless Chrome at 8, 16 and 26 s
of wall time (screenshots of both builds). A described check, not a measure:

- The particles, their glow (white where the gas is hot, yellow for the helium, the carbon's grey-white in the cores) and the nebula (a warm halo round each clump, coloured by the types in it) look as in the build before:
  round clumps of the same size and brightness, the same halos, the same hues for the same types. The chaotic history puts the clumps elsewhere, so the frames are not comparable pixel by pixel.
- What changes is what the plan foresaw: **no particle disappears**, so the late frames keep all their 400 000 particles (the build before draws 54 000 at the end): the diffuse scatter round the clumps is denser and the
  halo of a helium-rich clump is a stronger yellow.
- **The nebula's weight is the cloud's mass** (`protostar.constant-mass.nebula`): 20 000 (`TOTAL_MASS`) at all four snapshots, the layer's own sum within 0.23 % of it at the start (1.9 % at worst: the half-float sums of the dense core saturate, as they
  did). Weighed by atomic mass as the plan proposed, the same positions would splat **2.95, 3.87 and 9.2 times** more at frames 400, 800 and 1 200 (the carbon is twelve times heavier than the hydrogen it came from): the nebula would
  have brightened as the cloud burned, which is why the parcels share the one mass.
- The statistics' tile reads "Mass per element, H 31 %, He 61 %, C 8.1 %" where it read "Particles per type, H 130 592, He 59 641, C 2 580"; it follows the GPU count (a few frames late) and its shares add up to 100 %.

### 6. The cost

**What was measured.** `perf.protostarPhases.<count>` (the simulation ms/frame, medians of chunks of 10 frames, one restart per run: frames 10 to 50 and frames 1 000 to 1 040), `perf.protostar.<count>` (the usual probe: simulation and
whole frame after at least 1.5 s of warm-up) and `perf.protostarHitch.<count>` (360 frames each followed by a wait for the GPU) at 400 000, 1 000 000 and 2 000 000 particles; the build before and this one **alternated, six pairs**, the
order swapped at each pair, each run a fresh page under the lock, nothing else on the GPU. The GPU sat in its P5 state (734 to 911 MHz, memory 810 MHz) with brief returns to P2: **the same code takes 10.9 or 25 ms for the same
frames depending on the state it finds the GPU in** (below), so only what repeats in all pairs is read. These runs were made on the commit before the rebase on B5 (`0e4fc9c` + this phase); the rebase changes
the velocity shader's step (the flag of the adaptive step is off by default) and not the passes this table is about.

| ms per frame, medians of six runs (range) | build before | this build | paired difference, new slower in |
|---|---|---|---|
| **late window (frames 1 000 to 1 040), 400 000 particles** | 15.64 (15.27 to 16.46) | **23.29** (22.98 to 25.81) | **+7.7**, x1.49, 6 of 6 |
| **late window, 1 000 000 particles** | 26.97 (23.90 to 29.65) | **41.80** (40.80 to 45.78) | **+16.4**, x1.55, 6 of 6 |
| early window (frames 10 to 50), 1 000 000 | 51.06 (48.82 to 52.49) | 49.99 (49.22 to 52.44) | -0.3, x0.98, 2 of 6 |
| early window, 400 000 | 10.82 (10.16 to 12.64) | 25.39 (24.88 to 26.20) | +14.4, 6 of 6: **a state of the GPU, not of the code** (below) |
| probe, 400 000, simulation | 21.11 (20.53 to 22.26) | 15.39 (11.46 to 23.61) | -5.7, x0.73, 2 of 6 |
| probe, 400 000, whole frame | 23.88 (23.21 to 24.02) | 27.36 (26.98 to 27.88) | +3.4, x1.15, 6 of 6 |
| probe, 1 000 000, simulation | 45.64 (42.86 to 49.31) | 49.36 (46.83 to 55.08) | +3.6, x1.08, 5 of 6 |
| probe, 1 000 000, whole frame | 46.00 (45.00 to 47.30) | 51.79 (50.58 to 53.06) | +5.6, x1.13, 6 of 6 |

- **The late window costs 50 % more**: with nothing removed the late phase runs all its particles (the build before has 103 000 of its 400 000 left at frame 1 000 and 54 000 at the end), and the passes that skip
  a removed particle (the position, velocity and acceleration passes, the deposit's point clipped outside the clip volume) no longer do. The late cost is now the early one's: the ratio late / early is 0.93 at 400 000 particles and
  0.84 at 1 000 000 in this build (the cloud's core is cheaper than its first collapse), 1.46 and 0.53 in the build before (where it fell with the particles). **This is the price of the plan's "no particle is removed"**, and is
  the same figure whatever clock: a cloud that ends with its 400 000 particles costs what it cost at the start.
- **The early window is the same load in both builds** (same dynamics until the first fusions: the rows of the baseline are identical to the digit up to frame 70). At 1 000 000 particles it measures the same (50.0 and 51.1 ms);
  at 400 000 the six pairs gave 25.4 for this build and 10.8 for the build before, every time. That cannot be the code (the two builds run the same shaders on the same state, the count pass costs 2 ms every ten frames): a run
  that finds the GPU in P5 with its memory at 810 MHz has the whole window at 25 ms, one that finds it boosted has it at 10 to 11 (the first chunk of every run of the build before is 25 to 26 ms, then it drops to 10). A pair of runs
  of the two builds on the rebased code with the GPU's clock sampled twice a second (`clk-old`, `clk-new`) gave **10.9 ms for this build** (chunks 10.9, 11.9, 10.9, 11.0) and 11.0, 12.2, 18.3 for the build before, after a first chunk of 26.4 ms:
  the same. The six pairs are therefore not evidence of a slowdown of the early frames, nor of the absence of one: they are inconclusive, and the benchmark replay below says what it would cost if it were real.
- The whole frame, with the rendering layers, costs 13 to 15 % more in the probe's window (+3.4 ms at 400 000 particles, +5.6 ms at 1 000 000): the same effect as the late window (the probe's window is late in the cloud's life) and
  the particle layer and the nebula drawing all of the particles. The simulation-only figure of the probe at 400 000 is not readable (the range of this build is 11.5 to 23.6 ms: the states of the clock).
- The GPU count of the types costs **2.1, 4.2 and 5.9 ms** per count at 400 000, 1 000 000 and 2 000 000 particles (`cost.protostar.type-count.<count>`, ten counts queued back to back, GPU in P5), once every 10 frames: 0.2 to 0.6 ms per frame.

**The hitch the read-back made** (`perf.protostarHitch`, each frame followed by a wait for the GPU, 360 frames of the default cloud, six pairs): the build before read the whole position texture back every 12 frames (6.4, 16 and 32 MB) and counted the
types on the CPU; the worst frame was **65, 68 and 135 ms above the median** (400 000, 1 000 000 and 2 000 000 particles; ranges 52 to 71, 58 to 94, 107 to 156) against **7.9, 14 and 26 ms** now (7 to 11, 11 to 24, 19 to 44): five to eight times less, in all
six pairs. The 99th percentile over the median goes from 2.2, 2.1 and 2.1 to 1.25, 1.20 and 1.21; in milliseconds the p99 is 60, 96 and 165 before and 36, 61 and 112 now although the median frame is 8 to 16 % higher here (+2.2, +6.4 and
+12.7 ms: the late-phase effect, the frames being the first 390 of the cloud's life). **Decision: the per-type counts stay on the GPU, `typeCounts.ts` and the position read-back are dropped** for the protostar; what is left of the
spike every 10 frames is the grid reduction the stats already had and the count pass above.

**The first-visit benchmark.** `runBenchmark()` replayed with a fake 60 Hz clock and a frame time proportional to the count (the method of the A2 spike; the benchmark times the first frames after a restart, then repeats frames
for the larger counts), for a cost in ms per 400 000 particles of: 5 -> 1 400 000; 8 -> 700 000; **10.8 or 12 -> 580 000**; 15.4 -> 410 000; **21.1 to 25.4 -> 280 000**; 27.4 -> 210 000; 29 -> 220 000; 40 -> 180 000.
If the early window costs what it costs in both builds when the clock is the same (10.9 and 10.8 ms), **the cap is 580 000 for both**; the six pairs' 25.4 against 10.8 would be 280 000 against 580 000, and the whole-frame figures of the probe
(23.9 against 27.4) 280 000 against 210 000. The cap is a staircase (350 000, then 495 000, 700 000...): a cost that moves by 15 % moves it by one step when it sits near one. Not re-run in a browser: the benchmark's one-shot timing on a
GPU in an unknown state would be one more of the inconclusive runs above.



## Reproducing

    S=...                                   # a scratch directory; the GPU is shared: serialize every run with flock on a lock the other users take
    npx vite --port 5236 &                  # this branch; the build before (git archive 0e4fc9c, the lab scenarios of this phase copied over) on 5237
    LAB=http://localhost:5236/particle-simulator/lab.html
    # momentum, energy, population, nebula (4 minutes), then what the application draws
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=protostar.constant-mass.momentum,protostar.constant-mass.energy,protostar.constant-mass.population,protostar.constant-mass.nebula,protostar.constant-mass.appearance"
    # the default cloud, six seeds, 34 s (about 3 minutes); both builds
    V='[{"name":"after"}]'
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=baseline.protostar.default-cloud-tuning&cloudSeeds=6&cloudVariants=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$V")"
    # the cost and the hitches, the two builds alternated (the order swapped at each pair), each run a fresh page under the lock
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=perf.protostarPhases.400k,perf.protostarPhases.1m,perf.protostar.400k,perf.protostar.1m,perf.protostarHitch.400k,perf.protostarHitch.1m,perf.protostarHitch.2m"
    flock $S/gpu.lock node scripts/run-lab.mjs --url $LAB --query "scenarios=cost.protostar.type-count.400k,cost.protostar.type-count.1m,cost.protostar.type-count.2m"

Renderer string of every number above: `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)`, headless Chrome, `EXT_float_blend` available, area 1024 x 768 px, the GPU in its P5 state
(759 MHz) while the runs were sampled: ms per frame are about three times those of an idle GPU; read the ratios.

## Limits, and what the next phases should know

- **A6 (thin-disc cooling) and A13 (Jeans floor)**, the new velocity-block physics: every particle weighs the same, so a per-particle quantity is a per-mass one (no `m_k` factor to carry) and the grids' `sum m` is `count x parcel`.
  The momentum is exact only for the fusion: the cooling and the heating act around a local mean read by interpolation and move the momentum of a drifting gas by 2e-3 of its thermal momentum
  (section 1): a cooling that is to conserve it would have to take the mean at the particle's own cell weights. The velocity pass has no `w < 0` branch and no `driftKick`; the position pass owes the type change to
  `fusionRateOf()`, which reads the fuel fractions of the neighborhood, so a hot gas of freshly fused helium shows up as `Y` at once.
- **A12 (maps)**: a map per element is the type count's pattern (`typeReduction.ts`: a pass of the position texture into partial counts, a pass that adds them, a read of a few texels) with the cell as the key, and the mass of
  a particle is `speciesDepositMass[type]`, which the model sets to the parcel mass (the one place to give types different masses later). The nebula weighs the same array's twin `splatMass`, so a map and the nebula agree.
- **The hydrogen's share is a share of mass.** The initial distribution of a mixture is the shares of the mass (it was of the atoms: saved configurations with a mixture of elements are the same numbers with another meaning,
  the default pure hydrogen is untouched), and the statistic says "Mass per element".
- **The energy deposit is the expected power, not the fusions drawn**, and agrees with the mass that changes type to the first order in `rate dt` (section 3). A phase that raises the rate cap or the step (the adaptive step of B5 divides
  `dt`, which only helps) should keep `rate dt` small, or the power deposit should take `(1 - exp(-rate dt)) / dt` instead of `rate`.
- **The type count is the only GPU readback of the particles**: the position texture is no longer read periodically, so a model that needs the CPU copy of the positions (the sticky dust on a device without float blending) still has `onReadback`.
- **Not done**: the cause of the helium burning further is only partly identified (section 4); `PROTOSTAR_TYPES_BLOCK` = 32 gives the count pass a low parallelism (3 025 threads of 1 024 reads), a three-stage version would cost
  a third of its 2 ms per 400 000 particles; the benchmark of the first visit was replayed, not re-run in a browser.

