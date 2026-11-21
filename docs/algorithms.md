# Simulation algorithms

The algorithm is chosen in the side panel, below the "Restart" button. Switching algorithm rebuilds the interface (parameters, element bar, statistics) from its declaration, then restarts the simulation. Each algorithm keeps its own values in memory: when you return to an algorithm, you find its sliders and elements as you left them.

| Name (interface) | Identifier | Status | Principle |
|---|---|---|---|
| Sticky dust | `stickyDust` | ✅ available | Gravity on a grid, granular dust: grains stick at a rate that grows with density and agitation (Haff's law) and resist compression by their agitation and, packed, by contact |
| Protostar (H → He → C) | `protostar` | ✅ available | Softened gravity, Verlet integration, cooling, H → He fusion whose heat slows the collapse |
| Gas | `gas` | 🕓 planned | Pressure everywhere, energy is conserved |
| Plasma | `plasma` | 🕓 planned | Positive and negative charges on the same grid |
| N-body | `nBody` | 🕓 planned | Gravity only, without collisions |

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
     - `physics` (Physics), `fusion` (Fusion), `supernova` (Supernova), `features` (Features: the optional parts of the algorithm, as boolean switches), `effects` (Visual effects): applied live.

     A tab appears only if a parameter is declared in it: an algorithm gets its Fusion or Supernova tab by declaring its parameters there. Three kinds of parameters:
     - `kind: 'number'` → slider: `min`, `max`, `step`, `default`, `format(v)`, and `scale: 'log'` for values spanning several orders of magnitude (λ₀ for example);
     - `kind: 'boolean'` → checkbox;
     - `kind: 'choice'` → drop-down list (`options`).

     The `count` parameter (`PARTICLE_COUNT_PARAM`), the number of particles, is mandatory and goes in the `initial` tab. Bounds and default values go in `src/config.ts`.
   - `particleTypes`, the particle type schema (`ParticleTypeSchema`):
     - a type (`ParticleType`) always has `name`, `symbol` and `color`. Its numeric properties are in `values`, by key;
     - `properties`: the chart tabs, in order. A numeric property (`kind: 'number'`) has its key, unit, range (`range`, which is also used to validate reloaded configurations), scale (`linearScale(range, step)` or a custom scale, such as the logarithmic mass scale), `live`, its "Default" / "Random" texts, `format` and an optional `randomize`. Only one may have `role: 'population'`: it is the distribution weight of particles at restart. `{ kind: 'color' }` adds the Color tab (hue, saturation, lightness);
     - `readouts`: computed values, displayed in the editor (for example the density);
     - `transitions`: transformations from one type to another (`{ from, to, label }`, by rank). The GPU model performs them; the declaration lets the editor display them (« Fusion → He »);
     - `defaults` (at most `MAX_SPECIES` types), optional `defaultCount`, `labels` (bar words: "Elements", "Element"…) and `builtinConfig` (identifier and name of the built-in configuration, read-only).
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
   - optional hooks: `updateSpecies` (derived per-type uniforms), `beforeSubstep(dt)` (extra GPU passes, before density deposition and the GPGPU pass), `afterSubstep`, `endFrame`, `wantsReadback` / `onReadback(positions, count)` (readback of positions every `CLUSTER_CHECK_INTERVAL` frames; the sticky dust no longer uses it except on a device that cannot blend float32 targets, see its supernova trigger);
   - `stat(key)` gives the value of each declared statistic (`null` while unknown); `liveTypeCounts()` gives the number of particles per type when types change during the run (otherwise it is the distribution from the last restart).
4. **Constants** in `src/config.ts`, **tests** of the pure logic in `tests/`, and switch the status in the table above to « available ».

### GPU contract

- One particle = one texel of the `TEX_SIZE × TEX_SIZE` textures. Position: `(x, y, type rank, w)`, with w = 1 for a living particle. Velocity: `(vx, vy, z, w)`, where `z` and `w` are free for the model (« Sticky dust » stores the remaining ejection time in `z`; with `glow: 'state'`, `w` is the brightness).
- **Removed particle**: a shader can remove a particle by writing a negative position w (`REMOVED_PARTICLE_W` = −1 in `config.ts`). It is no longer drawn, no longer deposits mass (density field, nebula) and `countTypes()` no longer counts it. This is how « Protostar » absorbs three of the four hydrogen atoms in a fusion.
- **The type of a particle is in the position texture** (z channel), not fixed by its index: a shader (position, or a variable) can rewrite it to turn H into He. Particle rendering, the nebula and mass deposition read this channel on every frame and therefore follow the change. At restart, the types fill contiguous blocks of indices, in rank order.
- Per-type uniforms (`speciesUniforms`: deposited mass, size, color) are arrays of `MAX_SPECIES` shared by reference between the pipeline, the particles and the nebula. They must be modified in place, never replaced.
- Statistics read from the GPU: `onReadback` receives the read-back positions (to count types, there is `countTypes()` in `src/simulation/typeCounts.ts`). For a lighter reduction (maximum temperature or density at the core), the model can render its own reduction pass in `beforeSubstep` and then read a few texels with `context.renderer.readRenderTargetPixelsAsync`.

- **Static drawings** (attractors and repellers): every model must be moved by them. Its velocity shader includes `drawing.glsl` (`drawingGlsl` and `DRAWING_DEFINES` from `src/simulation/drawing/DrawingField.ts`), merges `context.drawing.uniforms` into its own uniforms by reference and adds `drawingAccel(pos)` to the acceleration (« Protostar » adds it in `forceAt`, so the three passes of its Verlet integration see the same force).

### What is common today

`GpuPipeline` provides all models with the time step, the substeps, the density field (rendered before each substep, unless the model declares `usesDensityField: false`) and the readback of positions. `Simulation` owns the static drawings (`DrawingField`), which outlives the pipelines: restarts and algorithm changes keep it.

### Static drawings

Drawn in the panel's "Drawing" tab, in two kinds (attractor: pulls the matter, like dark matter; repeller: pushes it away), each with its own gravity and softening and its own opacity mask the size of the simulation area, from one of three sources: a drawing with the mouse (soft brush, right click or Shift to erase), an imported image (fitted without distortion; density = luminance × opacity, optionally inverted) or a multi-line text (font, size, weight, style, line height, alignment). A pixel of opacity 1 holds a unit of mass per px². The mask shows while it changes and fades `DRAWING_PREVIEW_MS` after the last change.

Each kind's mass is summed on a `DRAWING_GRID_RES²` grid of square cells over max(width, height) (`massGrid.ts`, pure), and its softened gravity is computed on the GPU on two levels with the same passes as « Protostar » (`grid-coarse.frag`, `grid-gravity.frag`), only when the mask or the softening change (at most every `DRAWING_UPDATE_MS` while drawing). The particles read it interpolated bilinearly: a = ± strength × `DRAWING_GRAVITY_UNIT` × L (− for repellers) × Σ m (r_j − r) / (|r_j − r|² + ε²)^{3/2}, with L = min(width, height) and ε the softening in % of L, so the pull does not depend on the screen size. Drawings never move and feel nothing. Their settings (and the texts) are saved in simulation configurations; what is drawn and imported is not. Supernovae, the shock wave and cluster detection belong to the « Sticky dust » model (`src/simulation/stickyDust/gpuModel.ts`); their GLSL code is in its shader. They will be shared if another algorithm needs them.

---

## Sticky dust (`stickyDust`), available

Technical name: **Dissipative Particle-Mesh**.

Declaration: `src/simulation/stickyDust/declaration.ts`. GPU model: `src/simulation/stickyDust/gpuModel.ts`. Shader: `src/shaders/velocity-sticky-dust.frag`.

Parameters: number of particles (at restart), gravity constant, stickiness, collision speed, threshold, concentration radius and supernova power. Particle types: the first ten elements, with distribution, atomic mass (in u), size and color; the editor displays the density. Statistics: number of supernovae and maximum concentration (the share of the total mass in the densest detection zone), with the threshold as a marker.

### What it does

1. **Multi-scale gravity.** The mass of each particle is deposited on a grid (*cloud-in-cell*). This grid is smoothed at several scales (mipmaps), and the pull is the sum, over the levels, of the slope of each level, weighted by 2^(level × `LONG_RANGE`). The acceleration does not depend on the particle's mass. The distance law is set by `LONG_RANGE`: 0 gives 1/r², 1 gives 1/r. The current value, 0.5, gives about 1/r^1.5, so that distant clusters attract each other.
   - **Per texel, not per particle** (`DustGravityField`, `src/simulation/stickyDust/gravityField.ts`). The slope of each coarse level (1 and up) is computed on that level's own grid, then one pass sums the levels at the corners of the density texels (a 513² half-float grid, only over the part the screen can read). A particle reads that sum with a single bilinear read and adds level 0 from the four density taps it already reads for the pressure: 5 reads instead of the 36 of a per-particle loop. The sum is exactly what the loop computed (the levels are bilinear between corners that are also corners of level 0), up to the rounding of the half floats: 0.13 % median, 0.5 % at the 95th percentile on a clumped cloud.
   - **Isotropic slope.** The slope of a level is the difference across a texel averaged over three rows with the weights w, 1 − 2w, w (`DUST_GRADIENT_CORNER_WEIGHT`, w = 0.21, close to the stencil of Scharr, 3/16). The plain central difference makes the pull of a point mass vary by about 40 % with the angle (the kernel is a square); with this stencil it varies by 4 % (median) to 5 % (worst radius). On a smooth field the slope is unchanged; on a clumped cloud the pull is weaker (84 % of the central difference's in RMS).
   - The measurements, and why the stencil stops at 4 % rather than 2 %, are in [spikes/b1-dust-gravity.md](spikes/b1-dust-gravity.md).
2. **Agitation.** The grid also holds the energy of the particles' motion (the alpha channel of the density: `m |v − v_ref|²`, `ENERGY_SCALE`). With the mean flow `u` of the momentum channels, the agitation of a texel is `T = ⟨|v|²⟩ − |u|²` (px²/s², at least 0): the energy of the motion around the mean flow. It is the same for a cloud at rest and a cloud flying at 1000 px/s. The grid is in half floats, where `⟨|v|²⟩ − |u|²` would subtract two large numbers, so the energy is deposited about a coarse reference velocity `v_ref` (the mean flow of a 16 × 16 level of the previous substep's density, `REFERENCE_LEVEL`, sampled at the particle): the two terms of the subtraction are then the size of the agitation, not of the speed. The velocity pass reads the same reference. A texel can hold at most about 128 mass units at 400 000 particles (the half floats lose a particle's contribution once the sum is large): the agitation of such a core is the one of the grains that were counted. See [spikes/a10-granular-dust.md](spikes/a10-granular-dust.md).
3. **Pressure.** Two parts, both divided by the relative density of the species (dense elements fall to the core of clusters and light ones stay at the edge): the **threshold pressure** `max(density − REST_DENSITY, 0)` as before, zero as long as the grains are not packed, and the **kinetic pressure** `P = ρT/2` (two degrees of freedom), whose push is `−∇P/ρ` where the grains are in contact (a ramp between 0.1 and 0.6 `REST_DENSITY`, `CONTACT_RANGE`). An agitated cloud resists compression; a cold one does not. The agitation is capped by what the grid can resolve in a substep (the sound speed crosses at most one texel, `PRESSURE_CFL`).
4. **Sticking (Haff).** Grains collide at a frequency proportional to `ρ√T` and stick, so each particle's velocity is pulled toward the local mean flow at `ν = STICK_RATE × stickiness × ρ × √T` (1/s): the denser and the more agitated, the faster. The agitation then falls as `T = T₀ / (1 + t/t₀)²`, Haff's law of the free cooling of a granular gas. Grains that meet faster than the **collision speed** (the velocity relative to the local mean flow, `v_coll`) bounce instead of sticking: the sticking fades out between half of it and all of it. This also keeps fast ejecta from sticking to the flow they leave. The default (100 % stickiness, 600 px/s) gives the clumps of the default cloud about the sticking frequency they had with the constant rate of 6 per second (4 to 7 per second in its clumps).
5. **Colour.** The glow of a particle follows the agitation of the grains around it (`√T` between `GLOW_AGITATION_RANGE`), not its speed: a cloud falling in coherently stays dark, a shell-crossing or a shock lights up. The velocity pass writes it in the free component of the velocity (`w`).
6. **Energy losses.** There is global friction (`GLOBAL_DRAG`), a maximum speed (`MAX_SPEED`), and walls return 80% of the velocity (`RESTITUTION`).
7. **Supernovae.** Pure formulas: `src/simulation/stickyDust/ejecta.ts` (the ejection and the kick) and `src/simulation/shockWave.ts` (the front); shader and model as above. The whole is written up in [spikes/a9-coherent-supernova.md](spikes/a9-coherent-supernova.md).
   - **Trigger on the mass, on the GPU.** Every `CLUSTER_CHECK_INTERVAL` (12) frames the GPU looks for the disk of radius `concentrationRadius` holding the most **mass** (every particle weighs the atomic mass of its species) and a few floats come back: no position is read back any more. The supernova fires when that disk holds at least the **threshold** (37 % by default) of the **total mass**, then a cooldown of `SUPERNOVA_COOLDOWN` frames (6 s at the default speed) follows. The concentration meter shows the same share. The steps are those of the CPU reference (`analyzeConcentration`, `src/simulation/concentration.ts`), in `ConcentrationReduction` (`src/simulation/stickyDust/concentrationReduction.ts`, shaders `concentration-*`): the particles' masses are summed into the cells of a coarse grid (a quarter of the radius a side) by a float32 point pass; each cell's disk of cells is summed; the densest one wins; its center moves to the center of mass of the particles inside the radius; the mass, the second moment and the number of particles inside the radius about that center are summed (the particles of these two passes go into 4096 bins, reduced in two stages). The grid's mass cannot be used for this (the density grid is in half floats, it saturates at about 128 a texel and the alpha channel no longer counts particles), hence a grid of its own in float32 (it needs `EXT_float_blend`; a device without it reads the positions back and runs the CPU reference, the rest unchanged). The share's denominator is the exact total mass (the species' masses times their counts), not the GPU's float32 sum. The ejection no longer uploads a mask of the particles: the velocity pass ejects those inside the disk (center and radius uniforms) at the substep the supernova fires. The compactness `GM/R` is not a separate criterion: the radius is fixed by the slider, so it would be the mass times a constant (and times the gravity slider, which would make the supernovae vanish at a low `G`). See [spikes/b4-gpu-concentration.md](spikes/b4-gpu-concentration.md).
   - **Homologous, stratified ejection.** The particles of the disk are ejected radially at `v = v₀ f(m) r / R`, `r` being the distance to the center of mass of the disk. `R` is the rms radius of the ejected mass (at least `EJECTA_RADIUS_FLOOR` of the detection radius), so that the rms speed of the ejecta is `v₀ f(m)` whatever the size of the clump: the explosion gives the same energy per unit of mass to a compact clump and to a diffuse one. `v₀` is the **ejection power** slider (a percentage of `SUPERNOVA_SPEED`); `f(m) = √(mean mass / m)` (bounded by `EJECT_SCALE_RANGE`) gives every species the same kinetic energy, so the heavy elements are slower than the light ones, and with the buoyancy that keeps them in the core they come out stratified. Matter does not overtake matter at first: the layers keep their order.
   - **Gravity stays on for the ejecta.** The acceleration does not depend on what a particle is doing (equivalence principle): gravity and the drawings' pull act from the first instant. Only the contact physics, the pressure and the sticking, waits for the ejection timer (`EJECT_TIME`, 0.6 s, fading back in): the ejecta are in free flight, they do not stick to the dust they leave nor feel the pressure of the clump they come out of. Ejecta that do not escape come back.
   - **Shock wave.** The front starts at the edge of the detection zone at the speed `v₀` and obeys `dR/dt = K / R` with `K = v₀ R₀` (Sedov–Taylor in two dimensions): `R² = R₀² + 2 K t`, `R ∝ t^(1/2)` once far from the start. It stops at the farthest corner of the screen or where the kick falls under `SHOCK_MIN_KICK`. When it sweeps a particle it raises its outward speed to at least the kick, `0.9 × (front speed) × f(m)` (`SHOCK_STRENGTH`), which falls off as `1/r`.
   - **Constants.** `SUPERNOVA_SPEED` is 840 px/s (the default power, 70 %, is 588 px/s of rms speed) and `SUPERNOVA_COOLDOWN` 240 frames: they were retuned when the ejecta started to feel gravity (the history of the default run is in the spike).

### Behavior

- **Low-density zones**: like dark matter or a cloud of stars. Particles do not touch and only feel gravity.
- **Clusters**: like wet dust. It resists being crushed, by contact and by its agitation, and sticks together while the grains meet slowly.
- **In short**: a granular gas that **cools by sticking**. Compression heats it (the infalling streams cross), the sticking dissipates the agitation faster the denser and hotter it is, hence a collapse into clumps.

### Differences from real physics

- The kinetic pressure acts only where the grains are in contact (a collisionless cloud has none, as it should), and only up to the agitation the grid resolves.
- Energy is not conserved: sticking dissipates it, walls return 80 % of the velocity, there is global friction.
- The sticking is a relaxation of each particle toward the mean flow of its texel, not a pairwise collision: grains of a texel that do not move together are made to.
- The gravity law is a compromise between 2D and 3D.
- The « hot » color is the agitation `√T` around the mean flow of a texel, as the grid sees it (a texel is 4 px wide at 1024 × 768): it is a temperature, but of the grid's resolution.
- Supernovae depend on the share of the mass inside a disk, not on temperature or energy. The ejection is a prescription (a homologous flow of a given rms speed), not the release of an energy that the dust has stored; the shock wave is a kick on the particles it sweeps, not a fluid.

---

## Protostar (`protostar`), available

Declaration: `src/simulation/protostar/declaration.ts`. GPU model: `src/simulation/protostar/gpuModel.ts` and `grids.ts`. Pure logic: `reactions.ts` (reaction table, rate law, mass balance), `drift.ts` (statistical drift) and `initialConditions.ts` (initial cloud). Shaders: `src/shaders/protostar-*.{vert,frag,glsl}`.

A hydrogen cloud contracts under its own gravity while it cools, and hydrogen fuses into helium (proton-proton chain). The released energy heats the core, which expands: fusion slows down, and cooling and gravity contract it again. The star settles into a self-regulated equilibrium. Once the hydrogen is exhausted, nothing supports the helium core any more: it contracts and heats up to about 100 MK, where helium fuses into carbon (triple alpha). Everything runs on the GPU; the CPU orchestrates the passes and reads back one small reduction of the grids (the statistics and the energy diagnostics), plus the positions to count the types and measure the drift.

### Units

Lengths are expressed relative to L, the short side of the simulation area, fixed at restart: the behavior does not depend on the screen size. The total mass of the cloud is `TOTAL_MASS`; times are in seconds.

- **ρ₀**: the initial mean density of the cloud. Densities (statistic, fusion law, opacity) are in ρ₀.
- **T₀** = `PROTOSTAR_FUSION_T_REF` · (L/s)²: the temperature unit, which stands for **15 MK** (`PROTOSTAR_T0_KELVIN`, the core of the Sun). Displayed temperatures are in MK.
- **G** (slider): G_eff = G · `PROTOSTAR_GRAVITY_UNIT` · L³ / `TOTAL_MASS`.
- **ε** (slider): in % of L.

### GPU passes, at each substep

Grid of `PROTOSTAR_GRID_RES`² = 128² square cells over max(width, height) (`grids.ts`):

1. **Moments**: *cloud-in-cell* deposit of each living particle, (m, m·v, m·|v|²). 32-bit float targets if `EXT_float_blend` is available, 16-bit otherwise (masses as mean particle mass, velocities in L/s, to stay within range). The same pass writes a second attachment, the *composition*, (m·(1+Z)/A, 1, m²): the mass over the mean molecular weight of a fully ionised element, the particle count and the sum of squared masses, with the same weights. The gas pass reads its m² (the effective number of particles behind the temperature, see [The noise of the temperature](#the-noise-of-the-temperature)); the rest is for the mean molecular weight (proposal A1, see [the spike](spikes/a1-second-deposit.md)).
2. **Gas**: for each cell, sums over its 3 × 3 neighbors → density ρ = mass / area, mean velocity v̄ = Σm·v / Σm, temperature T = Σm·|v|² / Σm − |v̄|². This is the **velocity dispersion around the local mean flow**, not the absolute velocity: overall rotation and coherent infall do not count as heat (at the scale of the neighborhood, about 3 cells). A second attachment holds what the fusion rate needs: the temperature averaged over time and the effective number of particles N behind it. The pass draws into one of two targets in turn, the other one holding the average of the previous substep; the shared references (`gridGas`, `gridThermo`) follow.
3. **Power**: each particle that can fuse deposits its *expected* fusion power (rate × energy per unit mass × mass) and its rate.
4. **Heating**: power of the 3 × 3 neighbors / their mass → heating per unit mass q.
5. **Gravity**, at two levels (see below): coarse grid (mass and center of mass of 4 × 4 cell blocks), then acceleration at the center of each cell, and in the same loops the Plummer potential (third channel, see [Energy diagnostics](#energy-diagnostics)).
6. **GPGPU pass** (`GpuPipeline`), three state textures: velocity (`protostar-velocity.frag`), position (`protostar-position.frag`) and the variable `textureAccel` (`protostar-accel.frag`). Particles read gravity by bilinear interpolation (consistent with the *cloud-in-cell* deposit: no self-force), and density, temperature, v̄ and q by mass-weighted interpolation (as well as, for the fusion rate, the averaged temperature and N).

Every `PROTOSTAR_STATS_INTERVAL` frames, a two-stage reduction (128² → 16² → 4 × 1 texels, `protostar-reduce.frag`) gives the maximum density, the temperature of the densest cell (the core) and the total expected number of fusions per second, together with the diagnostics of the next section; the four texels are read back in one `readRenderTargetPixelsAsync`. Particle counts per type come from the common position readback (`countTypes`).

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

### Energy diagnostics

Proposal A7. The energy of the cloud is measured on the GPU, with the same grids as the dynamics, and shown as two statistics. Code: `grid-gravity.frag` (potential), `protostar-reduce.frag` and `protostar-potential.frag` (reductions), `reduction.ts` (layout, unpacking), `energy.ts` (drift and virial ratio), `gpuModel.ts` (cadence, flag). The measure changes nothing in the dynamics: the default-cloud baseline of the lab reproduces the recorded one on all its values.

**Potential.** The loops of `grid-gravity.frag` already compute `inversesqrt(r² + ε²)` for every term of the force. With `GRAVITY_POTENTIAL` defined they also accumulate `−m·s` (fine cells of the near zone) and `−M·s` (coarse cells, monopoles at their center of mass): the Plummer potential Φ = −G Σ m / √(r² + ε²), of which the force is the gradient, goes to the third channel of the gravity grid (px²/s²). The define is set for the protostar only; the drawings' fields (`DrawingField`) build the same shader without it and keep a third channel of 0.

**Energies** (simulation units: mass × px²/s²; divide by `TOTAL_MASS` for a specific energy):

- K = ½ Σ m v², the sum of the fourth channel of the moments (m|v|², deposited anyway) over the grid: exact up to the footprints clipped at the edge of the grid.
- U = ½ Σ_cells M Φ − (self-interaction), see below.

**The self-interaction.** The potential of a cell includes its own mass at distance 0 (−G M / ε), which the force does not feel (r = 0 gives no pull). In ½ Σ M Φ every particle is therefore also counted against itself, about −G m² / ε (exactly that at the center of a cell, 0.84 times that at a corner for the default softening on the 128-cell grid). The composition deposit (second attachment of the moments) already holds Σ m², so the reduction removes G Σ m² / (2 ε): U = ½ Σ M Φ + G Σ m² / (2 ε). It is a correction of 0.23 to 0.29 % of U for 5 000 particles in the lab, and 6·10⁻⁵ at 400 000. It is the diagonal only: two particles of one cell are treated as being at distance 0, and the cloud-in-cell spread smooths the kernel; against the direct pair sum the grid's U is within 0.15 to 0.33 % at 5 000 particles (lab, `protostar.energy-reference`), with or without this term (the grid's other approximations, of the opposite sign, are of the same size).

**Time alignment.** In velocity Verlet the velocity texture lags the positions by one substep (above): the grids drawn at the beginning of substep n see the positions xₙ and the velocities vₙ₋₁. K from that deposit and U from that gravity would be the energy of no state, with an error of about Δt |dU/dt|. The model therefore keeps the potential of the previous grids before drawing the new ones (`stashPotential()`: two small passes, `protostar-potential.frag`, run in the substeps of the frames that are read), and the reduction pairs the new K with that potential: both belong to the state (xₙ₋₁, vₙ₋₁). The unsynchronized sum is also in the reduction (`energy.potentialNow`), to measure the lag.

**Statistics** (declared in `declaration.ts`, hover texts in the five catalogs):

- *Energy drift*: (E − E₀) / |E₀| in %, with E = K + U and E₀ the first reading of the run, taken at the end of the first frame (so it is the energy of the start, not of 10 frames of cooling later), or of the first usable reading after the diagnostics were switched on. Cooling lowers it and fusion heating raises it; with both off it measures the error of the integration. The drawings' forces are not in U.
- *Virial ratio* 2K / |U|: about 1 in equilibrium, below 1 for a cloud that falls in. Both tiles show "–" when unknown: with the diagnostics off, before the first reading, with a gravity of 0 (no potential), and when the potential or the total is negligible next to K + |U| (`PROTOSTAR_ENERGY_RATIO_FLOOR`: the quantity divided by is then noise).

**The `diagnostics` flag** (Features tab, on by default): when off the model skips the potential stash and the first-frame reading, and the two tiles show "–". The potential channel of the gravity pass and the reduction (needed by the core statistics) run anyway. Cost: see [lab-baseline.md](lab-baseline.md).

#### The multichannel reduction

One two-stage reduction (128² cells → 16² blocks of 8 × 8 → 4 × 1 texels) and one asynchronous read give everything below; it runs at the end of every `PROTOSTAR_STATS_INTERVAL`-th frame and of the first (diagnostics on). Stage 1 writes four attachments (the block's partial result), stage 2 one texel of the final RGBA32F target `reduce2` per attachment. The model unpacks the floats with `unpackReduction()` (`reduction.ts`, tested) and keeps the latest result:

| Texel | x | y | z | w |
|---|---|---|---|---|
| 0 core | max ρ (ρ₀) | T of the densest cell (T₀) | Σ fusions per s | Σ mass (deposit units) |
| 1 extremes | x of the densest cell (px) | y of the densest cell (px) | speed bound (px/s) | acceleration bound (px/s²) |
| 2 energy | Σ m\|v/L\|² | ½ Σ M Φ, grids just drawn | Σ m² | ½ Σ M Φ, previous substep |
| 3 moments | Σ M x | Σ M y | Σ m v_x / L | Σ m v_y / L |

Texel 0 keeps the layout the statistics always read (ρ, T, rate first; the constant 1 in w became the mass). The densest cell is the first one, in reading order, with a strictly greater density; the position goes with the density. What the numbers are:

- **Speed bound**: the maximum, over the cells that hold gas, of |mean velocity| + √T, the mean velocity and T (dispersion) being those of the cell's 3 × 3 neighborhood. It follows bulk flow and thermal spread and misses the far tail of a distribution; in the lab (100 000 particles, core formed) it is 1.12 times the fastest particle, with no particle above it. A proxy for the time-step criterion, not a bound in the strict sense.
- **Acceleration bound**: the maximum of |a| of the gravity grid over the cells that hold mass (the force on a particle is the bilinear interpolation of four cells, so it never exceeds it); the drawings' force is not in it.
- **Center of mass and momentum**: first moments of the cloud-in-cell deposit. The weights reproduce a particle's position exactly, so these are the particles' own sums (to 4·10⁻⁵ px and 10⁻⁸ in the lab), not a grid approximation, except for the footprints clipped at the edge.

Typed getters of `ProtostarModel`, for the phases that consume them: `reduction` (everything, `Reduction`), `maxSpeed`, `maxAcceleration`, `peakPosition`, `centerOfMass`, `energy` (`ProtostarEnergy`: K, U, total, drift, virial ratio; null with the diagnostics off). They hold the latest reading (every 10 frames, about 0.3 s of simulated time at the default speed), in px, px/s, px/s² and simulation mass units; `null` before the first.

#### What the current scheme does with it

The lab (`baseline.protostar.energy-drift`, numbers in [lab-baseline.md](lab-baseline.md)) runs the default cloud with cooling, feedback and fusion forced to 0 and elastic walls, for 100 orbits (the period of a circular orbit at the half-mass radius, 10.5 s, 372 frames). The initial virial ratio is 0.33: the cloud falls in, and virializes (2K/|U| close to 1) within about 3 orbits. K + U then **rises**, slowly at first (+0.2 % after 3 orbits, +1.3 % after 10) and faster as the core densifies (+5.5 % after 30, +39.5 % after 100 orbits): the plan's target of less than 1 % over 100 orbits is **not met** and the scenario is a documented known failure. The fast oscillation of the energy about this trend is negligible (±0.02 % at one reading per 10 frames).

Where it comes from (`baseline.protostar.energy-drift-attribution`, 12 orbits): the walls, which return half of the speed in the application, take 14 % (the energy of the particles that the collapse throws out and that hit them): that is not the scheme's. With elastic walls the drift rate after the first orbits is 0.16, 0.077 and 0.036 % per orbit at the default time step, half of it and a quarter of it: it scales with the step, so a shorter or adaptive step (phase P5) attacks the secular part, to the first power of the step, not the second of velocity Verlet. The lag of the velocities behind the positions, which the stash corrects, is small for a slowly evolving cloud: the synchronized and the unsynchronized sums differ by less than 0.1 percentage point of drift over the run (and by a factor 2 in the fast oscillation, ±0.016 % against ±0.033 %).

### Initial conditions

A uniform disk of radius 0.38 L (`PROTOSTAR_CLOUD_RADIUS`), centered on the screen (`initialConditions.ts`):

- **rotation**: tangential velocity = rotation × v_circ(r), with v_circ(r) = √(G·M_enc(r)·r² / (r² + ε²)^(3/2)), i.e. √(G·M_enc(r)/r) far from ε, zero at the center. M_enc(r) is the mass of the particles drawn inside r (rank / N × total mass: types are drawn independently of radius);
- **agitation**: Gaussian noise with standard deviation agitation × v_circ(R) on each component; the mean momentum is removed so the cloud does not drift. Together with the Poisson noise of positions, this is what fragments the cloud;
- the initial acceleration, for the first Verlet step, is that of the enclosed mass.

### Cooling

At each step, the disordered part of the velocity is damped: v ← v̄ + (v − v̄)·e^(−k_eff·Δt). Rotation and overall infall (carried by v̄) are preserved.

**Why cooling is slow by default**: the contraction must stay quasi-static. A faster cooling (or a cold cloud) makes the cloud fall in freely: the center reaches very high temperatures at once and all the hydrogen burns in one explosion.

**Opacity**: k_eff = k / (1 + ρ/ρ_opq). Without this term, the core, once smaller than ε, is no longer heated by its compression (the softened potential is harmonic there): cooling won, fusion went out and the whole cloud ended as a cold point. With it, dense gas keeps the heat of its compression, like a protostellar core that has become opaque to its own radiation. Heating by collapse comes from gravity alone: gravitational potential energy becomes agitation in the core.

### Fusion laws

A particle of a type that fuses does so per step with probability P = 1 − exp(−r · Δt), with a rate per particle

r = min(λ · ρⁿ · (T / T_ref)^α, `PROTOSTAR_FUSION_RATE_MAX`), ρ in ρ₀ (`fusionRateOf` in `protostar-common.glsl`, `fusionRate` in `reactions.ts`).

| | Proton-proton chain | Triple alpha |
|---|---|---|
| Reaction | 4 ¹H → ⁴He + 26.7 MeV | 3 ⁴He → ¹²C + 7.275 MeV |
| T_ref (`referenceTemperature`) | 15 MK, core of the Sun | 100 MK, real ignition |
| n (`densityExponent`) | 1: two bodies | 2: three bodies |
| α | 4 | 40 |
| Mass turned into energy | 0.71 % | 0.065 %, 11 times less |

These n and α are the real values around T_ref: the energy production goes as ρX²T⁴ and ρ²Y³T⁴⁰, so per fusing particle as ρXT⁴ and ρ²Y²T⁴⁰. The composition terms X and Y are left out: the law uses the total density.

With α = 40, 10 % hotter is about 45 times faster: ignition is almost a threshold, and changing λ moves the ignition temperature very little. The rate is computed from logarithms, as the powers alone would overflow a 32-bit float, and capped above 1 / Δt. The T it uses is the temperature averaged over time, and the rate is divided by the bias that the noise of T puts on a power of T: see below. The draw is made in the position pass (PCG generator per particle and per substep), which rewrites the type.

### The noise of the temperature

Proposal A3. The temperature of a neighborhood is estimated from N particles, with a relative noise of 1 / √N, and a rate that goes as T^α is convex in T: its mean over that noise is larger than the rate at the true temperature, by a factor that grows quickly with α. For Maxwellian particles, each |v − u|² is exponential, T follows a Gamma law and the factor is Γ(N + α) / (Γ(N)·N^α) ≈ exp(α(α − 1) / 2N): 6.6 for N = 400 and α = 40, and for the real exponents (about 4 at 15 MK for the proton-proton chain, 40 at 100 MK for the triple alpha) the noise is no longer something the sliders' small exponents hide. Two remedies, both on:

- **Bias correction** (`noiseBias.ts`, twin of `logNoiseBias` in `protostar-common.glsl`). The rate is divided by the bias, computed in logarithms from Stirling's series (the terms in ln N cancel, see the file). The temperature is a dispersion around the mean of the same particles, which costs one degree of freedom (T is low by 1 / N on average): the estimate is a Gamma law of shape N − 1, and the code uses that (a factor (1 − 1/N)^α on the rate). N is the effective number of particles of the neighborhood, the effective sample size of a mass-weighted mean, (Σm)² / Σm², from the m² channel of the composition deposit (`protostar-gas.frag`), times `PROTOSTAR_NOISE_N_SHAPE` = 1.5: the cloud-in-cell weights, the sum over 3 × 3 cells and the bilinear interpolation at the particle spread the weights of the particles, which makes the estimate less noisy than N independent particles (the shape factor was measured in the lab). Where a type with a larger mass dominates (hydrogen with a little helium), (Σm)² / Σm² is the number of particles that carry the noise, not their count. The exponent is the one of the reaction's law (`alpha` in `fusionRateOf`; with the Gamow rates of proposal A2 it will be the local exponent). A cell with two particles or fewer carries no information: its bias is the huge one of N = 2 and its rate nearly zero.
- **Averaging over time** (`PROTOSTAR_TEMPERATURE_TAU`, 0.1 s). The temperature that feeds the rate is averaged cell by cell, exponentially, with a weight 1 − e^(−Δt/τ) per step (in seconds, never per step: the substeps are ⌈speed⌉ per frame and their duration varies). A cell that held no gas at the previous step starts afresh, and so does a restart. The heating, the cooling and the glow use the instantaneous temperature: the heating adds exactly the energy it announces only if it scales the dispersion that is there. The average removes noise only as fast as a neighborhood renews its particles (a few tenths of a second at 4 MK, a tenth at 50 MK): the lab measures a gain of 1.3 in variance at τ = 0.1 s for a gas at 4 MK. The bias correction does not credit it (the rate is then a little low where the average works): conservative, and the delay it adds to the thermostat is τ, well below the cooling time.

Validation: [spike A5 and A3](spikes/a5-a3-heating-and-t-noise.md).

### Mass balance

**One particle = one atom.** 4 H → 1 He: a hydrogen particle that fuses becomes helium with probability 1/4, otherwise it is **removed** (absorbed by the reaction, w = −1). On average, four fused hydrogens leave one helium: the mean mass left per fused hydrogen is m_He / 4 = 1.00065 u instead of 1.00783 u. The difference, the **mass defect** (4 × 1.00783 − 4.0026 = 0.0287 u, i.e. 0.71%), becomes energy. In the same way, 3 He → 1 C: a helium that fuses becomes carbon with probability 1/3, and 3 × 4.0026 − 12 = 0.0078 u becomes energy.

- The number of particles decreases; mass is conserved on average, apart from the mass defect. In calibration, 30,000 hydrogens end up as 2,470 to 2,558 carbons, for 2,500 expected.
- **Masses are those of the isotopes that react**, as their differences give the energy: ¹H (`HYDROGEN_1_MASS`), ⁴He, ¹²C (`CARBON_12_MASS`). With the standard atomic weight of carbon (12.011 u, a mix with ¹³C), three heliums would weigh less than one carbon and triple alpha would release no energy.
- The masses of the types come from the editor (in u): they set the mass deposited on the gravity grid and the mass defect. If the product is made heavier than what it consumes, the reaction no longer releases energy (no feedback).

**Statistical drift** (`drift.ts`): momentum is conserved only on average, as a survivor carries its velocity with three or four times the mass. In a hot star, that noise made the star cross the screen at about 5 px/s with 30,000 particles (about 3 times slower with 10 times more, as expected for a noise). The GPU model measures the velocity of the center of mass on the read-back positions and takes half of it off every particle (`driftKick`, `PROTOSTAR_DRIFT_GAIN`): the center of mass now stays within about 10 px of its place. The correction is off while static drawings act: it would hold the star against the drawings's real pull.

### Feedback

The energy released per unit of fused mass is feedback × (mass defect / fused mass) × c², with c² = `PROTOSTAR_FUSION_C2` × T₀. We inject the **expected** power (rate × energy, pass 3), not the energy of the fusions actually drawn: heating is smooth instead of arriving in bursts, and the fusions drawn correspond to it on average. The heating adds q·Δt of kinetic energy per unit mass by **scaling the velocities' deviations from the local mean velocity**: v ← v̄ + (v − v̄)·√(1 + 2q·Δt / T), with T the dispersion |v − v̄|² of the neighborhood (energy per unit mass is T / 2, so the dispersion grows by exactly 2q·Δt: ΔK = q·Δt, and what is left of T after the cooling of the same step is the one that counts). Velocity dispersion (heat) increases, and with it the outward push, without noise and without moving the neighborhood's momentum (`heating.ts` is the pure twin; the lab checks the energy to 4·10⁻⁶ per cell and the momentum to rounding). A cell too cold for this (T below `PROTOSTAR_HEATING_T_FLOOR` of T₀: nothing to scale) gets the same energy as a kick √(2·q·Δt) in a random direction, which was the heating of every cell before.

The loop: fusion heats the core → it expands, its density drops (and its cooling rises, becoming less opaque) → fusion slows down → gravity and cooling contract it again. The energy added in a step is bounded by the square of the speed limit, which also keeps it finite if the power grid saturates in half floats.

### Transitions: extensible model

Reactions are a table (`PROTOSTAR_REACTIONS`, type `FusionReaction`): fusing type, product type, number of particles consumed, label, keys of the λ and α parameters, reference temperature and density exponent. The GPU model translates it into arrays of uniforms indexed by the fusing type (`reactionTo`, `reactionKeep`, `reactionRate`, `reactionExponent`, `reactionReference`, `reactionDensityExponent`, `reactionEnergy`; `reactionArrays()`), which the shaders read as they are. To add another reaction, it is enough to add its product to the default types, one line in the table and its two parameters: neither the shaders nor the model change. Limitation: a type fuses in only one reaction, so C + He → O could not coexist with a second helium reaction. The declaration derives `particleTypes.transitions` from it, which the editor displays ("Proton-proton chain").

### Rendering

The color comes from the type (editor). The model declares `glow: 'state'`: each particle's brightness is written in the w channel of velocity, based on the local temperature (from 1 to 7 T₀, i.e. 15 to 105 MK) and the local fusion heating. The core lights up and whitens as it burns; the helium formed, yellow, accumulates there, then the core turns to carbon, grey, and shines brightest. The « Chaleur » (Heat) slider of the visual effects adjusts this brightness.

### Parameters

| Parameter | Key | Default | Applied |
|---|---|---|---|
| Number of particles | `count` | 30,000 | restart |
| Initial rotation (× v_circ) | `rotation` | 0.2 | restart |
| Initial agitation (× v_circ(R)) | `agitation` | 0.7 | restart |
| Gravity constant G | `gravity` | 12 | live |
| Softening ε (% of L) | `softening` | 1% | live |
| Cooling k (/s) | `cooling` | 0.1 | live |
| Opacity density ρ_opq (ρ₀, log) | `opacity` | 15 | live |
| H → He rate λ₀ (/s, log) | `fusionRate` | 1.5e-4 | live |
| H → He temperature exponent α | `fusionExponent` | 4 | live |
| He → C rate λ (/s, log) | `heFusionRate` | 3e-6 | live |
| He → C temperature exponent α | `heFusionExponent` | 40 | live |
| Feedback (log) | `feedback` | 1 | live |
| Energy diagnostics | `diagnostics` | on | live (Features tab) |

Types: hydrogen (1.00783 u, cool blue-white, the entire initial population), helium (4.0026 u, yellow) and carbon (12 u, grey), none at the start; a share can be given to them. Statistics: particles per type, core temperature (densest cell, in MK), maximum density (in ρ₀), fusions per second, of both reactions together (expected, smoothed), and, with the diagnostics on, the energy drift and the virial ratio.

### Calibration (headless Chrome, GTX 1060, 1180 × 726 px area, 30,000 particles)

With default values. Times are simulated; they do not depend on the speed slider.

| t | H | He | C | T core | ρ max | Fusions / s | What we see |
|---|---|---|---|---|---|---|---|
| 2 s | 29,980 | 1 | 0 | 21 MK | 1.9 ρ₀ | 15 | blue-white cloud, contracting |
| 26 s | 23,570 | 1,594 | 0 | 51 MK | 6.7 ρ₀ | 258 | self-regulated hydrogen burning |
| 51 s | 16,603 | 3,347 | 0 | 47 MK | 7.3 ρ₀ | 276 | the star turns yellow |
| 76 s | 9,208 | 5,163 | 0 | 49 MK | 8.5 ρ₀ | 304 | |
| 102 s | 1,870 | 7,058 | 0 | 71 MK | 19 ρ₀ | 250 | hydrogen exhausted, the core contracts and heats up |
| 126 s | 5 | 4,069 | 1,167 | 117 MK | 75 ρ₀ | 730 | helium ignited, carbon forming |
| 151 s | 0 | 14 | 2,556 | 128 MK | 143 ρ₀ | 0.4 | carbon core |
| 276 s | 0 | 6 | 2,558 | 96 MK | 284 ρ₀ | ≈ 0 | end: the core stays hot and slowly cools |

The first carbons appear when the core passes about 105 MK. Hydrogen burns for about 100 s, helium for about 25 s. At 10 minutes, the simulation is still stable.

Robustness at default values:

| Run | Result |
|---|---|
| 100,000 and 300,000 particles | same temperatures, densities and times, within a few % |
| 5,000 particles | same sequence, with a noisier core: helium burning is slower and still incomplete at 240 s (355 C, 71 He) |
| Area 1920 × 913 px (coarser grid cells relative to L) | same sequence, T max 111 MK; about 590 He stay unburned |
| Area 780 × 913 px | same sequence, T max 141 MK, about 7 He left |
| Half-float grids (no `EXT_float_blend`) | same sequence, no invalid value |

Effect of settings, from the runs that led to these defaults. Unless stated otherwise, the other settings are the defaults:

| Setting | Result |
|---|---|
| λ₀ = 4e-4 | **explosion**: hydrogen and helium are gone by 20 s, in a dispersed cloud (ρ max 1.6 ρ₀). λ₀ = 2e-4 still works: the margin is less than a factor of 3 |
| G = 10, λ₀ = 1e-4, agitation 0.8, ρ_opq = 30 | T max 102 MK: helium burning stalls (5,694 He left, 627 C) |
| Former defaults: G = 1.5, k = 0.5, ρ_opq = 30, agitation 0.8, λ₀ = 1e-4, α = 3 | stable hydrogen burning around 15 MK, but T max 16 MK: **no carbon**. The core ends cold at ρ ≈ 310 ρ₀ |
| The same with G = 5 | T max 50 MK: **no carbon** |

**Why G = 12**: at the end of the contraction, all the mass sits in the 3 × 3 neighborhood (ρ max ≈ 300 ρ₀ is that limit, set by the grid). The core cannot get hotter than about 10 MK per unit of G, so 100 MK requires G ≥ 10 to 12.

### Differences from real physics

- 2D, with a 1/r² (3D) gravity law in the plane; softening at least equal to one cell.
- The « temperature » is measured over a 3 × 3 cell neighborhood: a convergent infall at this scale partly counts as heat.
- Cooling is a damping of agitation, with an ad hoc opacity; there is no radiative transfer.
- Feedback is isotropic (heat), without explicit radial push: pressure comes from agitation.
- There is no thermal pressure of a fluid: without agitation, nothing resists compression.
- The correction of the noise of T assumes independent particles with Maxwellian velocities, hence a Gamma law for T, with an effective number of particles calibrated on a uniform gas ([the lab measures it](spikes/a5-a3-heating-and-t-noise.md)); it knows nothing of correlations between neighborhoods or of collective motion. The average of T over time adds a delay of τ = 0.1 s to the thermostat and is not credited in the correction.
- **Hydrogen burns at about 50 MK, not 15 MK.** The law keeps its real reference, but the star cannot settle at 15 MK. To reach 100 MK at the end of the contraction, gravity must be so strong that the cloud itself is already at about 20 MK at the start. Real hydrogen burning spans about 4 to 40 MK depending on the mass of the star, so this is above the range of the most massive stars. The ratio of the two temperatures, 2 to 2.5 instead of 6.7, is the main approximation: a finer grid would be needed to widen it. As a consequence, there is no longer a cold collapse phase: fusion starts within seconds.
- The proton-proton law is kept at all temperatures; at 50 MK, a real star would burn hydrogen through the CNO cycle (around T¹⁷).
- The fusion laws use the total density, without the local fractions of hydrogen or helium. The sensitivity of triple alpha is kept at α = 40 at all temperatures, while it really falls with temperature (about 19 at 200 MK).
- Only ¹²C is formed: no C + He → O, no electron degeneracy, hence no helium flash.
- Momentum is conserved by a global correction (`drift.ts`), not reaction by reaction.
- Energy is not conserved: with the fixed time step K + U of a conservative run drifts (see [Energy diagnostics](#energy-diagnostics)), the grid force is the bilinear interpolation of cell accelerations and not exactly the gradient of the grid potential, and the walls return half of the speed.

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
