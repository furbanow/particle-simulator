# Simulation algorithms

The algorithm is chosen in the side panel, below the « Redémarrer » (Restart) button. Switching algorithm rebuilds the interface (parameters, element bar, statistics) from its declaration, then restarts the simulation. Each algorithm keeps its own values in memory: when you return to an algorithm, you find its sliders and elements as you left them.

| Name (interface) | Identifier | Status | Principle |
|---|---|---|---|
| Poussière collante (Sticky dust) | `stickyDust` | ✅ available | Gravity on a grid, pressure only inside clusters, viscosity that erases agitation |
| Protoétoile (H → He fusion) (Protostar) | `protostar` | ✅ available | Softened gravity, Verlet integration, cooling, H → He fusion whose heat slows the collapse |
| Gaz (Gas) | `gas` | 🕓 planned | Pressure everywhere, energy is conserved |
| Plasma | `plasma` | 🕓 planned | Positive and negative charges on the same grid |
| N-corps (N-body) | `nBody` | 🕓 planned | Gravity only, without collisions |

## Architecture

An algorithm has two halves, registered under the same identifier:

| Half | Role | Where | Type |
|---|---|---|---|
| **Declaration** | What the interface displays: parameters, particle type schema, statistics. Pure data and functions, without GPU or DOM, tested. | `src/simulation/<algo>/declaration.ts`, catalog `src/simulation/algorithms.ts` | `AlgorithmDeclaration` (`src/simulation/algorithm.ts`) |
| **GPU model** | The physics: shaders, uniforms, passes, computed statistics. | `src/simulation/<algo>/gpuModel.ts`, registry `src/simulation/gpuModels.ts` | `GpuModel` (`src/simulation/gpuModel.ts`) |

Around them, the common code knows no particular algorithm:

- **`Simulation`** (`src/simulation/Simulation.ts`) is the object seen by the interface and the rendering. It owns what is shared with the rendering layers (geometry, `screenSize`, `speciesUniforms`), keeps per algorithm the particle types (`simulation.species`) and the parameter values, and rebuilds the GPU pipeline when the algorithm changes.
- **`GpuPipeline`** (`src/simulation/GpuPipeline.ts`) runs a GPU model. It owns the state textures (`GPUComputationRenderer`), the density field (gravity), the time step and substeps, the initial state (default ring), the uniforms per type (mass deposited on the grid, size, color) and the periodic readback of positions.
- **The interface** is built from the declaration: `ParamPanel` (`src/ui/paramPanel.ts`) for parameters, `ElementBar` / `ElementChart` / `ElementEditor` for particle types (via `buildMetrics()` from `src/elementMetrics.ts`), `Stats` (`src/ui/stats.ts`) for statistics. Saved configurations (`src/elementConfigs.ts`) each belong to one algorithm.

Settings common to all algorithms remain in the HTML: simulation speed, visual effects, FPS, active particles and elements.

## Adding an algorithm

Just write its two halves and register them. **The interface is not touched.**

1. **Declaration** (`src/simulation/<algo>/declaration.ts`), an `AlgorithmDeclaration` object:
   - `id`, `label`, `description`;
   - `params`: the global parameters, in display order within each tab. Each has a `key` (letters, digits, `_`), a `label`, a `doc` (concise explanation shown on hover: what it is and what it does in the algorithm) and a `tab`, the panel tab among `PANEL_TABS`:
     - `initial` (Initial conditions): everything that applies only at restart, and only that;
     - `physics` (Physics), `fusion` (Fusion), `supernova` (Supernova), `effects` (Visual effects): applied live.

     A tab appears only if a parameter is declared in it: an algorithm gets its Fusion or Supernova tab by declaring its parameters there. Three kinds of parameters:
     - `kind: 'number'` → slider: `min`, `max`, `step`, `default`, `format(v)`, and `scale: 'log'` for values spanning several orders of magnitude (λ₀ for example);
     - `kind: 'boolean'` → checkbox;
     - `kind: 'choice'` → drop-down list (`options`).

     The `count` parameter (`PARTICLE_COUNT_PARAM`), the number of particles, is mandatory and goes in the `initial` tab. Bounds and default values go in `src/config.ts`.
   - `particleTypes`, the particle type schema (`ParticleTypeSchema`):
     - a type (`ParticleType`) always has `name`, `symbol` and `color`. Its numeric properties are in `values`, by key;
     - `properties`: the chart tabs, in order. A numeric property (`kind: 'number'`) has its key, unit, range (`range`, which is also used to validate reloaded configurations), scale (`linearScale(range, step)` or a custom scale, such as the logarithmic mass scale), `live`, its « Par défaut » (Default) / « Aléatoire » (Random) texts, `format` and an optional `randomize`. Only one may have `role: 'population'`: it is the distribution weight of particles at restart. `{ kind: 'color' }` adds the Color tab (hue, saturation, lightness);
     - `readouts`: computed values, displayed in the editor (for example the density);
     - `transitions`: transformations from one type to another (`{ from, to, label }`, by rank). The GPU model performs them; the declaration lets the editor display them (« Fusion → He »);
     - `defaults` (at most `MAX_SPECIES` types), optional `defaultCount`, `labels` (bar words: « Éléments », « Élément »…) and `builtinConfig` (identifier and name of the built-in configuration, read-only).
   - `stats`: live statistics. `kind: 'value'` (a number; `flash` makes the tile blink when it increases), `kind: 'meter'` (a 0..1 fraction shown as a bar, with an optional marker placed at the position of a slider), `kind: 'typeCounts'` (number of particles per type).
2. **Add the identifier** to `ALGORITHM_IDS` and the declaration to `ALGORITHMS` in `src/simulation/algorithms.ts`. The tests in `tests/algorithms.test.ts` check the consistency of each declaration (unique keys, existing tabs, documented parameters, default values within their bounds, complete default types, valid transitions and markers).
3. **GPU model** (`src/simulation/<algo>/gpuModel.ts`), a `GpuModel` object, registered in `GPU_MODELS` (`src/simulation/gpuModels.ts`). The `Record<AlgorithmId, GpuModelFactory>` type prevents forgetting this step. The factory receives a `GpuModelContext`: renderer, geometry, `screenSize`, `speciesUniforms`, density field, and access to the current state textures.
   - `velocityShader` (mandatory) and `positionShader` (optional; the default one integrates x += v·dt and keeps the type in z). The velocity shader declares by itself `texturePosition`, `textureVelocity` and the common uniforms it uses (`textureDensity`, `screenSize`, `domainOffset`, `domainSize`, `densityRes`, `maxLod`, `dt`, `activeCount`, `momentumScale`); `GpuPipeline` connects them;
   - `velocityUniforms` / `positionUniforms`: its own uniforms. They are merged by reference into the uniform object of the pass, so their names must not conflict with the common uniforms;
   - `variables`: additional per-particle state textures (temperature, age…). Each has its own shader, computed in the same GPGPU pass; its initial state is given by `init()`. `GPUComputationRenderer` injects into its shader (and into the position shader) a sampler per state texture, under the variable's name; the velocity shader declares it by itself. « Protostar » uses this for the acceleration of the previous step (`textureAccel`);
   - `usesDensityField` (true by default): `false` if the model does not read `textureDensity`, and the pipeline then no longer renders the density field;
   - `glow`: where the particle layer takes its brightness (whitening and highlight). `'speed'` (default): from velocity, like « Sticky dust ». `'state'`: from the value the model writes in the w channel of velocity (0 to 2), for example the local temperature;
   - `typeMass(t)` and `typeSize(t)`: mass deposited on the gravity grid (only ratios matter, the total mass remains `TOTAL_MASS`) and rendered diameter;
   - `setParam(key, value)` receives each parameter when the model is created, then the `live` parameters on every change. `reset(params)` receives all values at restart. `initialize(state)` replaces the initial ring (for example for an initial rotation);
   - optional hooks: `updateSpecies` (derived per-type uniforms), `beforeSubstep(dt)` (extra GPU passes, before density deposition and the GPGPU pass), `afterSubstep`, `endFrame`, `wantsReadback` / `onReadback(positions, count)` (readback of positions every `CLUSTER_CHECK_INTERVAL` frames);
   - `stat(key)` gives the value of each declared statistic (`null` while unknown); `liveTypeCounts()` gives the number of particles per type when types change during the run (otherwise it is the distribution from the last restart).
4. **Constants** in `src/config.ts`, **tests** of the pure logic in `tests/`, and switch the status in the table above to « available ».

### GPU contract

- One particle = one texel of the `TEX_SIZE × TEX_SIZE` textures. Position: `(x, y, type rank, w)`, with w = 1 for a living particle. Velocity: `(vx, vy, z, w)`, where `z` and `w` are free for the model (« Sticky dust » stores the remaining ejection time in `z`; with `glow: 'state'`, `w` is the brightness).
- **Removed particle**: a shader can remove a particle by writing a negative position w (`REMOVED_PARTICLE_W` = −1 in `config.ts`). It is no longer drawn, no longer deposits mass (density field, nebula) and `countTypes()` no longer counts it. This is how « Protostar » absorbs three of the four hydrogen atoms in a fusion.
- **The type of a particle is in the position texture** (z channel), not fixed by its index: a shader (position, or a variable) can rewrite it to turn H into He. Particle rendering, the nebula and mass deposition read this channel on every frame and therefore follow the change. At restart, the types fill contiguous blocks of indices, in rank order.
- Per-type uniforms (`speciesUniforms`: deposited mass, size, color) are arrays of `MAX_SPECIES` shared by reference between the pipeline, the particles and the nebula. They must be modified in place, never replaced.
- Statistics read from the GPU: `onReadback` receives the read-back positions (to count types, there is `countTypes()` in `src/simulation/typeCounts.ts`). For a lighter reduction (maximum temperature or density at the core), the model can render its own reduction pass in `beforeSubstep` and then read a few texels with `context.renderer.readRenderTargetPixelsAsync`.

### What is common today

`GpuPipeline` provides all models with the time step, the substeps, the density field (rendered before each substep, unless the model declares `usesDensityField: false`) and the readback of positions. Supernovae, the shock wave and cluster detection belong to the « Sticky dust » model (`src/simulation/stickyDust/gpuModel.ts`); their GLSL code is in its shader. They will be shared if another algorithm needs them.

---

## Sticky dust (`stickyDust`), available

Technical name: **Dissipative Particle-Mesh**.

Declaration: `src/simulation/stickyDust/declaration.ts`. GPU model: `src/simulation/stickyDust/gpuModel.ts`. Shader: `src/shaders/velocity-sticky-dust.frag`.

Parameters: number of particles (at restart), gravity constant, threshold, concentration radius and supernova power. Particle types: the first ten elements, with distribution, atomic mass (in u), size and color; the editor displays the density. Statistics: number of supernovae and maximum concentration, with the threshold as a marker.

### What it does

1. **Multi-scale gravity.** The mass of each particle is deposited on a grid (*cloud-in-cell*). This grid is smoothed at several scales (mipmaps), and each particle reads the slope of the field. The acceleration does not depend on the particle's mass. The distance law is set by `LONG_RANGE`: 0 gives 1/r², 1 gives 1/r. The current value, 0.5, gives about 1/r^1.5, so that distant clusters attract each other.
2. **Threshold pressure.** Pressure equals `max(density − REST_DENSITY, 0)`. It is zero as long as particles are not packed. The push is divided by the relative density of the species: dense elements fall to the core of clusters and light ones stay at the edge.
3. **Sticky viscosity.** In dense zones, each particle's velocity is pulled back toward the local mean flow (`VISCOSITY_RATE`). Disordered agitation is erased.
4. **Energy losses.** There is global friction (`GLOBAL_DRAG`), a maximum speed (`MAX_SPEED`), and walls return 80% of the velocity (`RESTITUTION`).
5. **Supernovae.** They trigger on a geometric criterion: a share of particles (60% by default) inside a disk. All species receive the same kinetic energy (v ∝ 1/√m). A shock wave then pushes the surrounding medium.

### Behavior

- **Low-density zones**: like dark matter or a cloud of stars. Particles do not touch and only feel gravity.
- **Clusters**: like wet dust. It resists being crushed but sticks together and does not bounce.
- **In short**: a cloud that **cools instantly**. Compression does not heat it; it dissipates energy, hence a collapse into clumps.

### Differences from real physics

- Pressure exists only inside clusters.
- Energy is not conserved.
- The gravity law is a compromise between 2D and 3D.
- The « hot » color depends on absolute velocity, not on agitation around the mean motion. It is not a real temperature.
- Supernovae depend on concentration, not on mass or temperature.

---

## Protostar (`protostar`), available

Declaration: `src/simulation/protostar/declaration.ts`. GPU model: `src/simulation/protostar/gpuModel.ts` and `grids.ts`. Pure logic: `reactions.ts` (reaction table, mass balance) and `initialConditions.ts` (initial cloud). Shaders: `src/shaders/protostar-*.{vert,frag,glsl}`.

A hydrogen cloud cools and collapses under its own gravity. Its core becomes dense and hot until it ignites hydrogen fusion into helium. The released energy heats the core, which expands: fusion slows down, and cooling and gravity contract it again. The star settles into a self-regulated equilibrium. Everything runs on the GPU; the CPU orchestrates the passes and reads back three numbers for the statistics.

### Units

Lengths are expressed relative to L, the short side of the simulation area, fixed at restart: the behavior does not depend on the screen size. The total mass of the cloud is `TOTAL_MASS`; times are in seconds.

- **ρ₀**: the initial mean density of the cloud. Densities (statistic, fusion law, opacity) are in ρ₀.
- **T₀** = `PROTOSTAR_FUSION_T_REF` · (L/s)²: the reference temperature of the fusion law. Displayed temperatures are in T₀.
- **G** (slider): G_eff = G · `PROTOSTAR_GRAVITY_UNIT` · L³ / `TOTAL_MASS`.
- **ε** (slider): in % of L.

### GPU passes, at each substep

Grid of `PROTOSTAR_GRID_RES`² = 128² square cells over max(width, height) (`grids.ts`):

1. **Moments**: *cloud-in-cell* deposit of each living particle, (m, m·v, m·|v|²). 32-bit float targets if `EXT_float_blend` is available, 16-bit otherwise (masses as mean particle mass, velocities in L/s, to stay within range).
2. **Gas**: for each cell, sums over its 3 × 3 neighbors → density ρ = mass / area, mean velocity v̄ = Σm·v / Σm, temperature T = Σm·|v|² / Σm − |v̄|². This is the **velocity dispersion around the local mean flow**, not the absolute velocity: overall rotation and coherent infall do not count as heat (at the scale of the neighborhood, about 3 cells).
3. **Power**: each particle that can fuse deposits its *expected* fusion power (rate × energy per unit mass × mass) and its rate.
4. **Heating**: power of the 3 × 3 neighbors / their mass → heating per unit mass q.
5. **Gravity**, at two levels (see below): coarse grid (mass and center of mass of 4 × 4 cell blocks), then acceleration at the center of each cell.
6. **GPGPU pass** (`GpuPipeline`), three state textures: velocity (`protostar-velocity.frag`), position (`protostar-position.frag`) and the variable `textureAccel` (`protostar-accel.frag`). Particles read gravity by bilinear interpolation (consistent with the *cloud-in-cell* deposit: no self-force), and density, temperature, v̄ and q by mass-weighted interpolation.

Every `PROTOSTAR_STATS_INTERVAL` frames, a two-stage reduction (128² → 16² → 1) gives the maximum density, the temperature of the densest cell (the core) and the total expected number of fusions per second; a single texel is read back (`readRenderTargetPixelsAsync`). Particle counts per type come from the common position readback (`countTypes`).

### Softened gravity, retained approximation

The force is the one from the specification, F = G·mᵢ·mⱼ·(rⱼ − rᵢ) / (|rⱼ − rᵢ|² + ε²)^(3/2) (1/r² law in the plane), but computed **cell by cell** (particle-mesh) instead of particle by particle:

- mass is deposited at cell centers (*cloud-in-cell*);
- for each cell, the fine cells of coarse blocks within 2 blocks or less of its own (20 × 20 cells) are summed one by one; the other blocks (4 × 4 cells) count as a point mass placed at their **center of mass** (monopole approximation; the dipole error vanishes);
- cost: 128² × (32² + 20²) ≈ 23 million texture reads per substep, **independent of the number of particles** (no O(N²)).

Consequences: the effective softening is about max(ε, one cell); below one cell, the force is that of the grid. Total mass is conserved; the force between two cells is antisymmetric in the near zone, approximately so in the far zone.

### Integration: velocity Verlet

The `GPUComputationRenderer` computes all textures of a step from the previous state. We therefore keep the acceleration of the previous step in `textureAccel`, and at step k we use a(k), read from the grid computed for positions x(k):

- velocity: v(k) = v(k−1) + ½ (a(k−1) + a(k)) Δt;
- position: x(k+1) = x(k) + v(k) Δt + ½ a(k) Δt², recomputed identically in the position pass;
- `textureAccel` ← a(k).

This is exactly the velocity Verlet scheme; the stored velocity lags the position by one step. Cooling and heating modify velocity after the Verlet half-step (operator splitting); they act on the next displacement. Walls return 50% of the velocity.

### Initial conditions

A uniform disk of radius 0.38 L (`PROTOSTAR_CLOUD_RADIUS`), centered on the screen (`initialConditions.ts`):

- **rotation**: tangential velocity = rotation × v_circ(r), with v_circ(r) = √(G·M_enc(r)·r² / (r² + ε²)^(3/2)), i.e. √(G·M_enc(r)/r) far from ε, zero at the center. M_enc(r) is the mass of the particles drawn inside r (rank / N × total mass: types are drawn independently of radius);
- **agitation**: Gaussian noise with standard deviation agitation × v_circ(R) on each component; the mean momentum is removed so the cloud does not drift. Together with the Poisson noise of positions, this is what fragments the cloud;
- the initial acceleration, for the first Verlet step, is that of the enclosed mass.

### Cooling

At each step, the disordered part of the velocity is damped: v ← v̄ + (v − v̄)·e^(−k_eff·Δt). Rotation and overall infall (carried by v̄) are preserved.

**Opacity**: k_eff = k / (1 + ρ/ρ_opq). Without this term, the core, once smaller than ε, is no longer heated by its compression (the softened potential is harmonic there): cooling won, fusion went out and the whole cloud ended as a cold point. With it, dense gas keeps the heat of its compression, like a protostellar core that has become opaque to its own radiation. Heating by collapse comes from gravity alone: gravitational potential energy becomes agitation in the core.

### Fusion H → He

Per step, a hydrogen particle fuses with probability P = 1 − exp(−λ₀ · ρ · T^α · Δt) ≈ λ₀ · ρ · T^α · Δt (ρ in ρ₀, T in T₀; `fusionRateOf` in `protostar-common.glsl`, `fusionProbability` in `reactions.ts`). With α = 3, ignition behaves almost like a threshold and stays confined to the core. The draw is made in the position pass (PCG generator per particle and per substep), which rewrites the type.

### Mass balance

**One particle = one atom.** 4 H → 1 He: a hydrogen particle that fuses becomes helium with probability 1/4, otherwise it is **removed** (absorbed by the reaction, w = −1). On average, four fused hydrogens leave one helium: the mean mass left per fused hydrogen is m_He / 4 = 1.00065 u instead of 1.008 u. The difference, the **mass defect** (4 × 1.008 − 4.0026 = 0.0294 u, i.e. 0.73%), becomes energy.

- The number of particles decreases (three out of four fused ones disappear); mass is conserved on average, apart from the mass defect. In calibration, (30,000 − remaining H) / 4 matches the number of helium formed to within 1 or 2% (random draws).
- Momentum is conserved on average (the helium keeps the velocity of the hydrogen that survives).
- The masses of the types come from the editor (in u): they set the mass deposited on the gravity grid and the mass defect. If helium is made heavier than four hydrogens, the reaction no longer releases energy (no feedback).

### Feedback

The energy released per unit of fused mass is feedback × (mass defect / fused mass) × c², with c² = `PROTOSTAR_FUSION_C2` × T₀. We inject the **expected** power (rate × energy, pass 3), not the energy of the fusions actually drawn: heating is smooth instead of arriving in bursts, and the fusions drawn correspond to it on average. Each particle in the neighborhood receives q·Δt of energy per unit mass as a velocity kick √(2·q·Δt) in a random direction: velocity dispersion (heat) increases, and with it the outward push.

The loop: fusion heats the core → it expands, its density drops (and its cooling rises, becoming less opaque) → fusion slows down → gravity and cooling contract it again.

### Transitions: extensible model

Reactions are a table (`PROTOSTAR_REACTIONS`, type `FusionReaction`): fusing type, product type, number of particles consumed, label, and keys of the λ₀ and α parameters. The GPU model translates it into arrays of uniforms indexed by the fusing type (`reactionTo`, `reactionKeep`, `reactionRate`, `reactionExponent`, `reactionEnergy`; `reactionArrays()`), which the shaders read as they are. To add He → C (triple alpha), it is enough to add type C to the default types, one line `{ from: He, to: C, consumed: 3, … }` and its two parameters: neither the shaders nor the model change. Limitation: a type fuses in only one reaction. The declaration derives `particleTypes.transitions` from it, which the editor displays (« Fusion (4 pour 1) → He »).

### Rendering

The color comes from the type (editor). The model declares `glow: 'state'`: each particle's brightness is written in the w channel of velocity, based on the local temperature (from 0.25 to 1.5 T₀) and the local fusion heating. The core lights up and whitens at ignition; the helium formed, yellow, accumulates there. The « Chaleur » (Heat) slider of the visual effects adjusts this brightness.

### Parameters

| Parameter | Key | Default | Applied |
|---|---|---|---|
| Number of particles | `count` | 30,000 | restart |
| Initial rotation (× v_circ) | `rotation` | 0.2 | restart |
| Initial agitation (× v_circ(R)) | `agitation` | 0.8 | restart |
| Gravity constant G | `gravity` | 1.5 | live |
| Softening ε (% of L) | `softening` | 1% | live |
| Cooling k (/s) | `cooling` | 0.5 | live |
| Opacity density ρ_opq (ρ₀, log) | `opacity` | 30 | live |
| Fusion rate λ₀ (/s, log) | `fusionRate` | 1e-4 | live |
| Temperature exponent α | `fusionExponent` | 3 | live |
| Feedback (log) | `feedback` | 1 | live |

Types: hydrogen (1.008 u, cool blue-white, the entire initial population) and helium (4.0026 u, yellow, none at the start; a share can be given to it for primordial helium). Statistics: particles per type, core temperature (densest cell, in T₀), maximum density (in ρ₀), fusions per second (expected, smoothed).

### Calibration (Chrome, GTX 1060, 1080 × 813 px area, 30,000 particles, speed 1×)

With default values (read every 4 s, then every 15 s):

| t | H | He | T core | ρ max | Fusions / s | What we see |
|---|---|---|---|---|---|---|
| 4 s | 30,000 | 0 | 0.02 T₀ | 2.6 ρ₀ | 0 | blue cloud cooling and contracting |
| 12 s | 29,718 | 71 | 0.61 T₀ | 113 ρ₀ | 18 | collapsed core igniting (filaments, fragments) |
| 24 s | 28,857 | 275 | 0.91 T₀ | 183 ρ₀ | 125 | the core whitens, helium appears |
| 40 s | 26,298 | 927 | 1.07 T₀ | 161 ρ₀ | 188 | equilibrium |
| 60 s | 25,391 | 1,178 | 1.11 T₀ | 163 ρ₀ | 193 | equilibrium |
| 75 s | 23,336 | 1,680 | 1.10 T₀ | 162 ρ₀ | 199 | equilibrium |

Two other runs give the same values to within a few %. The equilibrium (T ≈ 1.1 T₀, ρ ≈ 160 ρ₀) does not depend on the number of particles (5,000 and 100,000: same T and ρ, and about 0.65% of the hydrogen fused per second). It lasts as long as the core has hydrogen: at 3×, the equilibrium holds until about 2 min 30 simulated (ρ ≈ 165 → 270 ρ₀ as helium accumulates), then fusion dies down (6.5 fusions/s at 4 min, 1,338 H and 7,072 He remaining, i.e. (30,000 − 1,338) / 4 ≈ 7,166 He expected) and the helium core contracts and cools. Lowering ρ_opq or the feedback extends the star's life.

Effect of settings (75 s each):

| Setting | Result |
|---|---|
| Cooling 0 | **no ignition**: the cloud virializes (ρ max ≈ 1.5 ρ₀, T ≈ 0.2 T₀, 0 fusion) |
| Cooling 0.02 /s | slow contraction, late and weak ignition (5 fusions/s at 75 s) |
| Feedback × 2 | stable star, cooler and slower (≈ 105 fusions/s) |
| Feedback × 4 | the first ignition blows the core apart (ρ max 2.8 ρ₀ at 15 s), then cycles of collapse and bursts |
| Feedback × 20 | **runaway**: nearly all the hydrogen burns in a few seconds, the cloud is dispersed |
| Feedback × 0.01 | collapse without brake (ρ ≈ 460 ρ₀), rapid burning, then the core cools |
| ρ_opq = 15 | longer-lived star (≈ 125 fusions/s) |
| Without opacity (first version) | the core ignites then ends as a cold point: hence the opacity term |


### Differences from real physics

- 2D, with a 1/r² (3D) gravity law in the plane; softening at least equal to one cell.
- The « temperature » is measured over a 3 × 3 cell neighborhood: a convergent infall at this scale partly counts as heat.
- Cooling is a damping of agitation, with an ad hoc opacity; there is no radiative transfer.
- Feedback is isotropic (heat), without explicit radial push: pressure comes from agitation.
- There is no thermal pressure of a fluid: without agitation, nothing resists compression.
- Once the core's hydrogen is exhausted, the star contracts and cools: helium fusion does not exist yet.

---

## Gas (`gas`), planned

### Idea

A real compressible fluid. Pressure exists everywhere and depends on density and temperature (P = nkT, with n the particle density and T the temperature). Compression **heats** the gas instead of dissipating energy.

### Differences from « Sticky dust »

- Pressure without threshold: particles repel each other even in low-density zones.
- No viscosity that erases agitation. Agitation becomes a temperature that is conserved, except for explicit and adjustable cooling.
- Expected behaviors: sound waves, rebounds of collapsing clouds, balance between gravity and pressure (stable stars), collapse only beyond a critical mass (Jeans instability).

### Ideas

- SPH (*Smoothed Particle Hydrodynamics*): each particle carries its share of the fluid.
- Simpler variant on the existing grid: a threshold-free equation of state, for example P = K·ρ^γ (with ρ the density and γ the adiabatic exponent), and an internal energy per particle stored in a free channel of the texture.
- The color could show the true temperature: agitation around the local flow.

---

## Plasma (`plasma`), planned

### Idea

A gas of charged particles. Opposite charges attract and like charges repel.

### Differences from « Sticky dust »

- Two signs of charge, whereas mass has only one.
- A charge overdensity **repels** instead of attracting. Collective oscillations are expected instead of a collapse.
- Debye screening: each charge is surrounded by a cloud of opposite charges that masks its field at long range.

### Ideas

- This is the **PIC** method (*Particle-In-Cell*), which the density grid already uses. It suffices to deposit the charge (with its sign) instead of the mass and to invert the sign of the force.
- Assign a charge to each species, as a mass is assigned to it.
- Later, possibly: a magnetic field (Lorentz force, spiral motions).

---

## N-body (`nBody`), planned

### Idea

Gravity only, without collisions: neither pressure nor viscosity. This is the model of galaxies and dark matter.

### Differences from « Sticky dust »

- No pressure, viscosity or global friction. Energy is conserved, up to numerical error.
- Clusters do not compact: they form halos that oscillate and then settle (violent relaxation), with orbits and tidal streams.

### Ideas

- Reuse the current multi-scale gravity and remove the other terms. This is the simplest of the three to add.
- Option: set `LONG_RANGE` for a true 1/r law (2D gravity) or 1/r² law (3D gravity).
- Do supernovae make sense here? To be decided.
