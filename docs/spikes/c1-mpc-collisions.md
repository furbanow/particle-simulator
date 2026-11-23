# C1: collisions of the protostar's gas (MPC/SRD), measured

Phase C1 (P7) of the improvement plan. The professor's proposal: make the protostar a real gas with multiparticle collision dynamics
(Malevanets & Kapral 1999, "stochastic rotation dynamics"): at every step, shift the grid at random as the dust does, take the exact mean
velocity u_c of each cell (nearest-grid-point deposit), and turn every velocity relative to it, v ← u_c + R(±θ)(v − u_c), with one sign
per cell and a collision probability 1 − e^(−ν_c dt), ν_c ∝ ρ√T. Mass, momentum and energy are conserved in every cell; the gas relaxes to
Maxwell–Boltzmann, its pressure becomes isotropic, sound and shocks appear. Tests asked: Sod's shock tube, the sound speed
c_s = √(γP/ρ), equipartition between H and He.

**Decision: shipped behind the `collisions` flag (Features tab), off by default** (the user's choice, 2026-11-23). It costs +14 % (400,000
particles) to +18 % (1,000,000) of the simulation frame while the cloud is still diffuse, more once the gas has collapsed (+31 to +63 %
late in the run), above the plan's 10 % rule for a default-on flag. The physics is validated (below); the defaults are **not** recalibrated
for it, and with them the collisional cloud collapses to the scale of the grid (see [The default cloud](#the-default-cloud-with-the-collisions)).

Code: `src/simulation/protostar/collisions.ts` (twin: the shifted grid, the cells' random numbers, the probability, the rotation, a CPU
collision step; `tests/collisions.test.ts`), `src/shaders/protostar-collision.{vert,frag}` (the deposit), the collision block at the end
of `protostar-common.glsl` (`collisionAt()`, `collide()`), `protostar-velocity.frag` and `protostar-position.frag` (the rotation, and the
scalings about the cell's mean), `CollisionDeposit` and `ProtostarGrids.setCollisions()` in `grids.ts`, the flag in `gpuModel.ts` and
`declaration.ts`. Lab: `src/lab/scenarios/collisions.ts`, `src/lab/riemann.ts` (Toro's exact Riemann solver), `src/lab/shockTube.ts`,
`src/lab/oscillation.ts` (all three pure and tested).

## The choice of gamma: 2

The professor asked for the choice to be written down. A gas whose particles carry only their two velocity components in the plane is a
strictly planar ideal gas with two degrees of freedom: γ = (d + 2)/d = **2**, P = ρ t/2 with t = ⟨|v − u|²⟩ the dispersion of the model,
and c_s = √(γP/ρ) = √t = √2 σ (σ the dispersion per component). Under adiabatic compression T ∝ Σ^(γ−1) = Σ.

The alternatives presented to the user before the implementation, and why γ = 2 was kept:

| γ | How | c_s | Adiabatic T | Consequences |
|---|---|---|---|---|
| **2** | plain planar MPC, no new state | √t = 1.41 σ | ∝ Σ | heating, cooling, Jeans floor, K and T unchanged (they already assume two degrees of freedom); only the collisions change the dynamics |
| 5/3 | one internal degree of freedom per parcel in `vel.z`, exchanged at every collision | 1.29 σ | ∝ Σ^(2/3) | heat capacity × 1.5: heating, cooling (c ÷ 1.5 for the same emissivity), Jeans, K, the initial conditions and the stability map must count it; a second deposit attachment; `vel.z` taken from C3 |
| ≤ 3/2 | two internal degrees or more | ≤ 1.22 σ | ≤ ∝ Σ^(1/2) | a thin disc with a 1/r² gravity stops its adiabatic contraction only above γ = 3/2: not recommended |

For reference, the effective 2D index of a real disc integrated over its thickness (Gammie 2001) is 3 − 2/γ₃ for a self-gravitating sheet
and (3γ₃ − 1)/(γ₃ + 1) for one held by a central mass: 1.8 and 1.5 for a monatomic gas, 1.57 and 1.33 for H₂. γ = 2 sits above both,
well above the 3/2 threshold. `vel.z` stays free, so γ = 5/3 by an internal energy can be added later behind the same flag.

## Design

- **The grid.** The protostar's own cells (`PROTOSTAR_GRID_RES` = 128 over max(width, height)), shifted at every substep by a vector of
  [0, cell)² drawn on the CPU from the substep's seed (`collisionShift()`): `GRID_RES + 1` = 129 cells per axis cover the area whatever the
  shift. Without the shift (Ihle & Kroll 2001), a gas at rest and the same gas moving would not collide alike.
- **The deposit.** One point per particle, one texel (nearest grid point), additive: (1, Σv, Σ|v|²), the velocities in L/s like the
  moments, so that a half-float target stays in range. The parcels all weigh the same (A4), so the cell's mean and the rotation conserve
  momentum and kinetic energy exactly; with parcels of different masses the deposit would need the masses.
- **The cell's random numbers.** A PCG hash of the cell's index and of the substep's seed (with a salt that keeps them apart from the
  particles' own streams): the deposit, the velocity pass and the position pass agree on what every cell does without storing it
  (`cellRandom()` in TypeScript, `collisionRandom()` in GLSL; the lab compares them bit for bit through the parity scenario).
- **The probability.** A cell collides with probability 1 − e^(−ν dt), ν = `PROTOSTAR_COLLISION_RATE` × ρ × √t, ρ in ρ₀ (the cell's count
  times one parcel's mass over the cell's area) and t in T₀, dt the time since the last collision (the previous substep's length,
  `dtPrev`, as the adaptive step may change it). The rate, 1000 /s at ρ₀ and T₀, makes the cloud collisional where it matters: a cell of
  0.5 ρ₀ at 0.6 T₀ collides with probability 0.996 per substep of the default speed (14.2 ms), one of 0.08 ρ₀ at 0.5 T₀ with 0.55. A cell of fewer than
  `PROTOSTAR_COLLISION_MIN_PARTICLES` = 2 particles does not collide.
- **The angle: ±90°.** The traceless part of the pressure tensor, ((Pxx − Pyy)/2, Pxy), turns by 2θ in a cell; with the sign drawn per
  cell it is multiplied by cos 2θ on average (tested: −1 at 90°, 0 at 45°, −½ at 60°). At 90° the two normal pressures trade places at every
  collision, so the pressure is isotropic over two substeps, far shorter than any sound period of the grid, and the kinetic viscosity of the
  planar rotation, which goes as 1/sin²θ, is the smallest. (A first version of the twin's tests expected 90° to make an anisotropic gas
  isotropic in a few collisions; it only swaps the components.)
- **Where in the scheme, and at which instant.** At the start of the substep that sees the positions x(n), the textures hold x(n), v(n−1)
  and a(n−1): velocity Verlet on lagged storage (`leapfrog.ts`), the state after the drift of the step that ended. The collision must turn
  the velocities of one instant, so the deposit sums **v(n) = v(n−1) + ½(a(n−1) + a(n)) dtPrev**, the velocity at x(n), with the same
  expression as the velocity pass (hence it is drawn after the substep's gravity grid, and reads `textureAccel` and `dtPrev`). The velocity
  pass computes the same v(n), turns it, and the position pass turns it the same way for the drift. This is the plan's "deposit and rotation
  after Verlet" with no pass of its own over the particle textures: `GPUComputationRenderer` swaps every variable's targets together, so a
  separate rotation pass would have cost a target of its own and a copy, two more passes of 1733² texels per substep.
  - **The first version turned v(n−1) and kicked it afterwards.** It conserved the momentum and the energy of a gas without gravity to
    3·10⁻⁷, but not with gravity: a particle's kick is correlated with its velocity within the cell (through the position it reached), and
    the rotation breaks that correlation. A conservative cloud lost **13 times |E₀|** of K + U over 100 orbits (−1321 %), and the default
    cloud collapsed into 3 × 3 cells at 20–60 MK. With v(n) the drift is +0.27 % (below).
- **The cooling, the Jeans floor and the heating** (A5, A6, A13) scale the velocities' deviations about a mean. With the collisions on, the
  mean and the dispersion they scale are those of the particle's collision cell, u_c and t_c (the plan: "u becomes the mean of the cell"):
  every scaling then keeps the cell's momentum exactly and changes its energy by exactly what the law asks. The laws themselves still read
  the 3 × 3 neighborhood's temperature (smoother: ~9 times the particles). Off, nothing changes (the 3 × 3 mean and dispersion).
- **The flag** is live: `setCollisions()` builds the deposit on first use; off, the deposit is skipped and the particle passes take one
  uniform branch (`collisionsOn`). No `#define`.

## Numbers (headless Windows Chrome 157, Direct3D 11, RTX 5070, 1024 × 768 px area)

### Conservation

| Scenario | Result |
|---|---|
| `protostar.collisions.parity`: 200,000 particles moving at (25, −10) px/s, σ = 60 px/s, one substep in the collisional limit, GPU against the twin | 199,840 velocities turned; worst difference 4.2·10⁻⁷ σ; momentum 1.1·10⁻⁸ N σ, energy 5.4·10⁻⁹ |
| `protostar.collisions.conservation`: the same gas, 30 substeps, G = 0 | collisional limit: momentum 3.5·10⁻⁷ N σ, energy 2.7·10⁻⁷; application rate: 3.4·10⁻⁷, 2.4·10⁻⁷; no collisions: 0 and 0; **half floats**: 4.7·10⁻³ and −3.2·10⁻³ (the cell's mean rounded to 11 bits) |
| `baseline.protostar.energy-drift` with `params={"collisions":true}`: 100,000 particles, cooling, feedback and fusion off, elastic walls, 100 orbits | default cloud: **+0.27 %** (largest excursion 0.67 %; without the collisions −0.17 %, 0.80 %); circular orbits −0.04 % (0.17 %; without +0.24 %); with the application's walls (restitution 0.5) −184 % in 78 orbits, against −20 % without: the gas now has a pressure, and its envelope reaches the walls, which dissipate |

### Sod's shock tube (`protostar.collisions.sod`)

600,000 particles fill the area; the left half holds 8 times as many as the right, at 10 times the pressure (σ_L = 60 px/s, σ_R = σ_L
√0.8), at rest; elastic walls; 2 s. Columns of 16 px, density in units of the left state, velocity in σ_L, pressure ρ(Pxx + Pyy)/2 in
units of P_L; the mean absolute difference from the exact solution (Toro) over the columns but two at each wall:

| Run | ρ error for γ = 1.4 / 5/3 / **2** / 2.5 / 3 | best γ | shock (exact 747 px) | ⟨\|Pxx − Pyy\|/(Pxx + Pyy)⟩ |
|---|---|---|---|---|
| collisional limit | 0.035 / 0.021 / **0.014** / 0.021 / 0.030 | **2** | 752 px | 1.0 % |
| application rate | 0.034 / 0.021 / **0.014** / 0.022 / 0.031 | **2** | 752 px | 1.2 % |
| no collisions | 0.039 / 0.036 / 0.036 / 0.038 / 0.043 | (5/3) | 720 px | 11 % |

With collisions the profiles fit γ = 2 best, and the velocity and pressure errors agree (0.024 and 0.016 at γ = 2, twice as much at 5/3 or
2.5); the shock is within one column of the exact one. Without collisions the gas streams through itself: no γ fits, and its pressure is
anisotropic.

### The speed of sound (`protostar.collisions.sound-speed`)

400,000 particles, σ = 60 px/s, a standing wave of 4 wavelengths across the width (256 px, density antinodes at the walls), amplitude 8 %;
its amplitude on the density grid for 7 s, fitted by a damped cosine; c_s from the undamped frequency √(ω² + β²) / k:

| Run | c_s (px/s) | c_s / √2 σ | γ_eff = (c_s/σ)² | damping (1/s) |
|---|---|---|---|---|
| collisional limit | 85.8 | 1.011 | **2.04** | 0.15 |
| application rate | 85.9 | 1.012 | **2.05** | 0.11 |
| no collisions | 89.4 | 1.054 | (2.22) | 1.68 |

Without collisions the wave is a free-streaming (Landau-damped) one, gone within a period: its "speed" is a fit to two wiggles.

### Equipartition (`protostar.collisions.equipartition`)

Hydrogen and helium parcels mixed over the area, the helium with a dispersion 4 times smaller; the ratio of the two dispersions:

| Particles (per cell) | collisional limit | application rate | no collisions |
|---|---|---|---|
| 50,000 (4.1) | 0.998 at 300 substeps; e-folding 2.5 substeps | 1.007; 2.5 substeps | 3.95 |
| 400,000 (33) | 0.998; 20.6 substeps | 1.003; 20.9 substeps | 3.99 |

The ratio reaches 1, so the parcels share one dispersion. **But the exchange of energy between particles is slow: about 0.6 N substeps
with N particles per cell** (CPU twin, positions drawn anew at every step: about N/4 collisions). A rotation keeps every |v − u_c| of the
cell; particles trade energy only through the change of their cell's mean from one collision to the next, of order σ/√N. The pressure's
isotropy and the ideal gas law (what Sod and the sound test) do not need that exchange; the Maxwellian shape and the equipartition do. In
the default cloud (about 100 particles per cell at ρ₀, thousands in the core) it takes 60 substeps (1 s) to many seconds; a helium parcel
is born from a hydrogen one with its velocity, so the composition barely needs it. An Andersen-type collision (new relative velocities
drawn per particle and scaled to the cell's energy: Allahyarov & Gompper 2002, Noguchi & Gompper 2008) would relax in one collision
whatever N, with a second deposit attachment for the drawn velocities; not done.

**What equipartition means here.** The parcels all weigh the same (A4), so the collisions equalize the dispersion, the thermal energy
per unit mass, not the temperature per atom (a helium gas in equilibrium with hydrogen would have a dispersion μ_H/μ_He times smaller). The
temperature of a cell, μ_mean/μ_H times its dispersion, is still the temperature of the mixture in equilibrium (A1 stays consistent); what is
lost is the sedimentation of the heavier ions towards the center.

### The default cloud with the collisions

`baseline.protostar.default-cloud-tuning`, 400,000 particles, the defaults, 34 s, three seeds:

| | without collisions | with collisions |
|---|---|---|
| hydrogen burnt in the first collapse (by 6 s) | 33.5 % | 39.8 % |
| burst | 503,000 to 532,000 fusions/s | 289,000 to 296,000 /s |
| after the bounce | a lull, burning again from ~9 s | the core falls back at once: 76 ρ₀ at 7 s, 212 at 8 s |
| helium flash (carbon jumps) | ~23 s | **7.4 s** |
| peak density | 193 to 365 ρ₀ | 433 to 450 ρ₀ (the whole star in 3 × 3 cells is 464) |
| at 34 s, H / He / C | 9–11 / 6–29 / 62–86 % | 0.1 / 0.1 / 99.8 % |
| core temperature, last quarter | 118 to 143 MK | 126 MK |

The collisional gas is dissipative where the collisionless one was not: infalling streams that cross no longer pass through each other
but shock, their energy becomes heat, and the cooling radiates it. With the defaults calibrated on the collisionless model, nothing holds the
core up after the first collapse until it reaches the resolution of the grid and the softening. This is physics, not a leak: the
conservative run above keeps its energy to 0.3 %.

**A first look at a calibration with the collisions** (two seeds each, 34 s unless stated):

| Variant | Peak ρ | Hydrogen burns at (median, MK) | At the end |
|---|---|---|---|
| c = 1 | 307–310 ρ₀ | 55 | all carbon, 232 MK |
| **c = 0.1** | 15 ρ₀ | 31 | H 49 %, He 44 %, C 6.5 %; 85 s: helium flash at ~50 s, carbon core at 260 MK |
| feedback 1 | 445–448 ρ₀ | 108 | all carbon |
| G = 6 | 362–391 ρ₀ | 40 | all carbon, flash at 21 s |
| **G = 6, c = 1** | 15 ρ₀ | **15.5** | H 68 %, He 32 %, no flash; 85 s: first collapse burns 23 %, a lull of ~15 s, hydrogen burning from 20 to 50 MK, **helium flash at ~60 s**, carbon core at 170 MK |
| c = 1, feedback 1 | 251–256 ρ₀ | 52 | all carbon |

G = 6 with c = 1 gives the whole sequence, about three times slower than the collisionless defaults, with the hydrogen burning in the real
10–20 MK window at first. It is a starting point if the flag is ever turned on by default, not a calibration (two seeds, no λ or κ scan).

### Cost

`perf.protostar.*` (after 1.5 s of warm-up, the GPU waited for), alternated on and off, four pages each, ms per frame (median of the pages):

| | 400,000: simulation | whole frame | 1,000,000: simulation | whole frame |
|---|---|---|---|---|
| off | 3.17 | 5.01 | 5.74 | 8.62 |
| on | 4.55 (+44 %) | 7.47 (+49 %) | 9.64 (+68 %) | 15.96 (+85 %) |

`perf.protostarPhases.*` separates the passes from the dynamics (two pages each):

| Window | 400,000 off → on | 1,000,000 off → on |
|---|---|---|
| frames 10 to 50 (the cloud still diffuse, the same in both) | 3.50 → 3.99 ms (**+14 %**) | 6.64 → 7.85 ms (**+18 %**) |
| frames 1000 to 1040 | 6.12 → 8.01 ms (+31 %) | 11.0 → 17.9 ms (+63 %) |

The deposit itself (one fragment per particle, but a vertex shader that reads the gravity grid for the kick) and two texel fetches in the
particle passes cost the early +14 to +18 %, as estimated at gate G1 (+15 to +30 %). The rest is the collapsed core: every additive pass
(the moments, the power, the collision deposit, the particles' own blending) serializes in the few texels that then hold the whole star.

## For B3 (single particle pass)

What the second pass needs, and what B3 must keep:

- The collision deposit is a grid pass like the moments, drawn **after the gravity grid** and before the particle pass: it reads x(n),
  v(n−1), a(n−1) and the substep's force. B3 can keep it as it is; its single particle pass reads the collision grid with one `texelFetch`
  (plus the cell's two hashes), exactly as the velocity pass does now, and turns v(n) before the drift.
- If B3 changes the stored layout (for instance a synchronous v(n) instead of v(n−1)), the deposit's kick must follow: it must sum the
  velocities **of the instant of the positions**, or the conservation breaks (−1321 % of K + U over 100 orbits, above).
- The random numbers are a hash of the cell's index and of the substep's seed, not stored: any pass that needs a cell's decision
  recomputes it. The shift is a uniform set from the seed on the CPU.
- The scalings of the cooling, the Jeans floor and the heating read the cell's u_c and t_c from the same texel: no other state.
- The kick in the deposit's vertex shader repeats `forceAt()` (4 fetches, 9 with TSC): a B3 that stored a(n) of the current substep
  before the deposit would save it.

## Not done, open

- Defaults not recalibrated (flag off). The G = 6, c = 1 lead above.
- The energy exchange between particles is slow at many particles per cell (≈ 0.6 N substeps): an Andersen-type rule, or a finer
  collision grid (fewer particles per cell, sharper shocks), would speed it up.
- The relation of dispersion of a ripple (ω² = c_s²k² − 2πGΣ k e^(−kε), shared with A11) is not measured.
- Half-float devices conserve the momentum of a cell to about 10⁻³ (the rounding of the mean); not seen on a real device without
  `EXT_float_blend`.
- Not looked at by a human in the application (the Features tab now has six entries).
