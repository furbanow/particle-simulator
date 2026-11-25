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
- **`GpuPipeline`** (`src/simulation/GpuPipeline.ts`) runs a GPU model. It owns the state textures (`GPUComputationRenderer`), the density field (gravity), the time step and substeps, the initial state (default ring), the uniforms per type (mass deposited on the grid, size, color) and the periodic readback of positions (for the models that ask for it).
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
   - `stats`: live statistics. `kind: 'value'` (a number; `flash` makes the tile blink when it increases), `kind: 'meter'` (a 0..1 fraction shown as a bar, with an optional marker placed at the position of a slider), `kind: 'typeMasses'` (the share of the total mass held by each type, from `Simulation.liveTypeMasses()`: the particles of each type, `GpuModel.liveTypeCounts()`, times the mass of one).
2. **Add the identifier** to `ALGORITHM_IDS` and the declaration to `ALGORITHMS` in `src/simulation/algorithms.ts`. The tests in `tests/algorithms.test.ts` check the consistency of each declaration (unique keys, existing tabs, documented parameters, default values within their bounds, complete default types, valid transitions and markers).
3. **GPU model** (`src/simulation/<algo>/gpuModel.ts`), a `GpuModel` object, registered in `GPU_MODELS` (`src/simulation/gpuModels.ts`). The `Record<AlgorithmId, GpuModelFactory>` type prevents forgetting this step. The factory receives a `GpuModelContext`: renderer, geometry, `screenSize`, `speciesUniforms`, density field, and access to the current state textures.
   - `velocityShader` (mandatory) and `positionShader` (optional; the default one integrates x += v·dt and keeps the type in z). The velocity shader declares by itself `texturePosition`, `textureVelocity` and the common uniforms it uses (`textureDensity`, `screenSize`, `domainOffset`, `domainSize`, `densityRes`, `maxLod`, `dt`, `activeCount`, `momentumScale`); `GpuPipeline` connects them;
   - `velocityUniforms` / `positionUniforms`: its own uniforms. They are merged by reference into the uniform object of the pass, so their names must not conflict with the common uniforms;
   - `variables`: additional per-particle state textures (temperature, age…). Each has its own shader, computed in the same GPGPU pass; its initial state is given by `init()`. `GPUComputationRenderer` injects into its shader (and into the position shader) a sampler per state texture, under the variable's name; the velocity shader declares it by itself. « Protostar » uses this for the acceleration of the previous step (`textureAccel`);
   - `usesDensityField` (true by default): `false` if the model does not read `textureDensity`, and the pipeline then no longer renders the density field;
   - `glow`: where the particle layer takes its brightness (whitening and highlight). `'speed'` (default): from velocity, like « Sticky dust ». `'state'`: from the value the model writes in the w channel of velocity (0 to 2), for example the local temperature;
   - `typeMass(t)` and `typeSize(t)`: mass deposited on the gravity grid (only ratios matter, the total mass remains `TOTAL_MASS`; the model may then overwrite `speciesUniforms.splatMass`, as « Protostar » does: its particles all weigh the same, see [Mass balance](#mass-balance)) and rendered diameter;
   - `setParam(key, value)` receives each parameter when the model is created, then the `live` parameters on every change. `reset(params)` receives all values at restart. `initialize(state)` replaces the initial ring (for example for an initial rotation);
   - optional hooks: `updateSpecies` (derived per-type uniforms), `beforeSubstep(dt)` (extra GPU passes, before density deposition and the GPGPU pass), `afterSubstep`, `endFrame`, `wantsReadback` / `onReadback(positions, count)` (readback of positions every `CLUSTER_CHECK_INTERVAL` frames; the sticky dust no longer uses it except on a device that cannot blend float32 targets, see its supernova trigger; « Protostar » does not use it any more: it counts its types on the GPU);
   - `stat(key)` gives the value of each declared statistic (`null` while unknown); `liveTypeCounts()` gives the number of particles per type when types change during the run (otherwise it is the distribution from the last restart); `Simulation.liveTypeMasses()` turns it into the mass of each type for the `typeMasses` statistic.
4. **Constants** in `src/config.ts`, **tests** of the pure logic in `tests/`, and switch the status in the table above to « available ».

### GPU contract

- One particle = one texel of the `TEX_SIZE × TEX_SIZE` textures. Position: `(x, y, type rank, w)`, with w = 1 for a living particle. Velocity: `(vx, vy, z, w)`, where `z` and `w` are free for the model (« Sticky dust » stores the remaining ejection time in `z`; with `glow: 'state'`, `w` is the brightness).
- **Removed particle**: a shader can remove a particle by writing a negative position w (`REMOVED_PARTICLE_W` = −1 in `config.ts`). It is no longer drawn and no longer deposits mass in the density field and the nebula. No algorithm uses it now: « Protostar » removed three of four fusing hydrogens until phase A4 and changes the type of a parcel of constant mass instead (the grids of the protostar and its type count no longer test w).
- **The type of a particle is in the position texture** (z channel), not fixed by its index: a shader (position, or a variable) can rewrite it to turn H into He. Particle rendering, the nebula and mass deposition read this channel on every frame and therefore follow the change. At restart, the types fill contiguous blocks of indices, in rank order.
- Per-type uniforms (`speciesUniforms`: deposited mass, size, color) are arrays of `MAX_SPECIES` shared by reference between the pipeline, the particles and the nebula. They must be modified in place, never replaced.
- Statistics read from the GPU: `onReadback` receives the read-back positions (6 to 48 MB: the sticky dust's fallback, and what `src/lab/typeCounts.ts` counts for the lab). For a lighter reduction (maximum temperature or density at the core, the particles of each type), the model renders its own reduction passes and then reads a few texels with `context.renderer.readRenderTargetPixelsAsync`.

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

1. **Multi-scale gravity.** The mass of each particle is deposited on a grid (*cloud-in-cell*; *TSC*, 3 × 3 texels, behind the `tscDeposit` switch of the Features tab, on by default in the protostar since the calibration, off in the dust: [spike](spikes/c4-tsc-deposit.md)). This grid is smoothed at several scales (mipmaps), and the pull is the sum, over the levels, of the slope of each level, weighted by 2^(level × `LONG_RANGE`). The acceleration does not depend on the particle's mass. The distance law is set by `LONG_RANGE`: 0 gives 1/r², 1 gives 1/r. The current value, 0.5, gives about 1/r^1.5, so that distant clusters attract each other.
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

Declaration: `src/simulation/protostar/declaration.ts`. GPU model: `src/simulation/protostar/gpuModel.ts` and `grids.ts`. Pure logic: `reactions.ts` (reaction table, rate law, what a fusion does to a parcel), `typeReduction.ts` (the type count on the GPU), `initialConditions.ts` (initial cloud), `disc.ts`, `turbulence.ts` and `toomre.ts` (what it is made of). Shaders: `src/shaders/protostar-*.{vert,frag,glsl}`.

A hydrogen cloud contracts under its own gravity while it cools, and hydrogen fuses into helium (proton-proton chain). The released energy heats the core, which expands: fusion slows down, and cooling and gravity contract it again. The star settles into a self-regulated equilibrium. Once the hydrogen is exhausted, nothing supports the helium core any more: it contracts and heats up to about 100 MK, where helium fuses into carbon (triple alpha). Everything runs on the GPU; the CPU orchestrates the passes and reads back one small reduction of the grids (the statistics and the energy diagnostics), plus the positions to count the types and measure the drift.

### Units

Lengths are expressed relative to L, the short side of the simulation area, fixed at restart: the behavior does not depend on the screen size. The total mass of the cloud is `TOTAL_MASS`; times are in seconds.

- **ρ₀**: the initial mean density of the cloud. Densities (statistic, fusion law, opacity) are in ρ₀.
- **T₀** = `PROTOSTAR_FUSION_T_REF` · (L/s)²: the temperature unit, which stands for **15 MK** (`PROTOSTAR_T0_KELVIN`, the core of the Sun): the temperature of a **hydrogen** gas whose velocity dispersion is T₀. Displayed temperatures are in MK.
- **Two temperatures**. The *dispersion* t = ⟨|v − v̄|²⟩ of a neighborhood is what the motion holds: the energy per unit mass of the disordered motion is t / 2, and the heating and the cooling work on it. The *temperature* T = (μ / μ_H) · t, with μ the mean molecular weight of the neighborhood's gas and μ_H that of pure hydrogen, is what a thermometer reads at that dispersion (proposal A1): at the same dispersion a helium gas (μ = 1.334, fully ionised, one nucleus and two electrons for 4.0026 u) is μ_He / μ_H = 2.65 times hotter than a hydrogen one (μ = 0.504), a carbon one 3.40 times, and a mixture is in between. Pure hydrogen has T = t, so T₀ keeps meaning what it did. The fusion rate, the glow and the core temperature of the statistics read T; the heating, the cooling and the energy bookkeeping read t.
- **G** (slider): G_eff = G · `PROTOSTAR_GRAVITY_UNIT` · L³ / `TOTAL_MASS`.
- **ε** (slider): in % of L.

### GPU passes, at each substep

Grid of `PROTOSTAR_GRID_RES`² = 128² square cells over max(width, height) (`grids.ts`):

1. **Moments**: *cloud-in-cell* deposit of each living particle (*TSC*, 3 × 3 cells with quadratic weights, behind the `tscDeposit` switch, on by default; the power deposit follows the same switch: [spike](spikes/c4-tsc-deposit.md)), (m, m·v, m·|v|²). 32-bit float targets if `EXT_float_blend` is available, 16-bit otherwise (masses as mean particle mass, velocities in L/s, to stay within range). Every type deposits the same mass (a parcel of constant mass, see [Mass balance](#mass-balance)). The same pass writes a second attachment, the *composition*, (m·(1+Z)/A, m·[hydrogen], m², m·[helium]): the mass over the mean molecular weight of a fully ionised element (the parcel's mass times the type's (1+Z)/A: the atomic mass of the editor only enters through A), the masses of the two fuels and the sum of squared masses, with the same weights. The gas pass reads its first channel (the mean molecular weight of the neighborhood, so the temperature: proposal A1, see [the spike](spikes/a1-mean-molecular-weight.md)) and its m² (the effective number of particles behind the temperature, see [The noise of the temperature](#the-noise-of-the-temperature)). The deposit itself is described in [its spike](spikes/a1-second-deposit.md).
2. **Gas**: for each cell, sums over its 3 × 3 neighbors → density ρ = mass / area, mean velocity v̄ = Σm·v / Σm, dispersion t = Σm·|v|² / Σm − |v̄|². This is the **velocity dispersion around the local mean flow**, not the absolute velocity: overall rotation and coherent infall do not count as heat (at the scale of the neighborhood, about 3 cells). The mean 1/μ of the neighborhood is the ratio of two sums of the deposits, Σ m·(1+Z)/A over Σ m (the mass-weighted mean of (1+Z)/A, that is Σ_k X_k (1+Z_k)/A_k), and the factor μ / μ_H = (1/μ_H) / (1/μ) multiplies t into the temperature T; a neighborhood with mass but no composition (types of mass 0) has a factor of 1. A second attachment holds what the fusion rate needs: the temperature T averaged over time, the effective number of particles N behind it and the factor μ / μ_H. The pass draws into one of two targets in turn, the other one holding the average of the previous substep; the shared references (`gridGas`, `gridThermo`) follow.
3. **Power**: each particle that can fuse deposits its *expected* fusion power (rate × energy per unit mass × mass) and its rate.
4. **Heating**: power of the 3 × 3 neighbors / their mass → heating per unit mass q; its second channel carries the factor μ / μ_H to the velocity pass (which already samples this grid; it has no sampler to spare).
5. **Gravity**, at two levels (see below): coarse grid (mass and center of mass of 4 × 4 cell blocks), then acceleration at the center of each cell, and in the same loops the Plummer potential (third channel, see [Energy diagnostics](#energy-diagnostics)).
6. **Collisions** (behind the `collisions` flag, on by default; see [Collisions of the gas](#collisions-of-the-gas)): every particle's velocity, kicked to the instant of its position with the force of step 5, is deposited at the nearest cell of the grid shifted at random, (1, v, |v|²) on 129² cells.
7. **GPGPU pass** (`GpuPipeline`), three state textures: velocity (`protostar-velocity.frag`), position (`protostar-position.frag`) and the variable `textureAccel` (`protostar-accel.frag`). Particles read gravity by bilinear interpolation (consistent with the *cloud-in-cell* deposit: no self-force; with the TSC deposit, with the TSC weights over 3 × 3 cells, for the same reason), and density, dispersion, v̄, q and μ / μ_H by mass-weighted interpolation (as well as, for the fusion rate, the averaged temperature and N).

Every `PROTOSTAR_STATS_INTERVAL` frames, a two-stage reduction (128² → 16² → 4 × 1 texels, `protostar-reduce.frag`) gives the maximum density, the temperature T of the densest cell (the core: the dispersion times its μ / μ_H) and the total expected number of fusions per second, together with the diagnostics of the next section; the four texels are read back in one `readRenderTargetPixelsAsync`. The particles of each type are counted on the GPU on the same frames (`protostar-types.frag`: one pass of 32 × 32 texels of the position texture per texel, one pass that adds them) and `MAX_SPECIES` texels are read back: there is no periodic readback of the positions any more.

### Softened gravity, retained approximation

The force is the one from the specification, F = G·mᵢ·mⱼ·(rⱼ − rᵢ) / (|rⱼ − rᵢ|² + ε²)^(3/2) (1/r² law in the plane), but computed **cell by cell** (particle-mesh) instead of particle by particle:

- mass is deposited at cell centers (*cloud-in-cell*, or *TSC* behind `tscDeposit`: it cuts the near-field aliasing at 1.5 cells from 4.7 % to 0.7 % and the anisotropy from 4.5 % to 1.2 %, softens the pull there by 10 %, and costs +44 % per frame at 400,000 particles);
- for each cell, the fine cells of coarse blocks within 2 blocks or less of its own (20 × 20 cells) are summed one by one; the other blocks (4 × 4 cells) count as a point mass placed at their **center of mass** (monopole approximation; the dipole error vanishes);
- cost: 128² × (32² + 20²) ≈ 23 million texture reads per substep, **independent of the number of particles** (no O(N²)).

Consequences: the effective softening is about max(ε, one cell); below one cell, the force is that of the grid. Total mass is conserved; the force between two cells is antisymmetric in the near zone, approximately so in the far zone.

### Adaptive thickness

Behind the `adaptiveThickness` flag (Features tab, on by default since the [calibration](spikes/calibration.md); proposal A11, [spike](spikes/a11-adaptive-thickness.md)). The fixed ε gives way to the scale height of a self-gravitating sheet, h = σ_z² / (π G Σ) with σ_z² = t / 2, computed by the gas pass in every cell from its 3 × 3 neighborhood, between one cell and 0.4 times the initial cloud radius. The gas pass writes the gravity's *source*, (m, h²) per cell, on a fourth attachment; a pair of cells is softened by ε_ij² = (h_i² + h_j²) / 2 (symmetric: action and reaction stay exact in the near sum), a far block by the mass-weighted mean h² of its cells. With the flag off every h² is ε² and the gravity is the fixed softening's to the bit. Hot gas swells and weighs less in the plane; a cold dense core is thin. The response of the gravity to a ripple is e^(−kh)(1 + kh/2) instead of e^(−kε) (denser crests are thinner), measured within 1 %. The fusion law reads the volume density Σ / 2h as Σ · h_ref / h with h_ref the default softening (1.6 % L); the stability map multiplies Q by 1.5; the adaptive time step takes the thinnest layer for its length; the initial cloud's table is softened by the thickness it will have (αvir and βrot stay the contract). The cooling does not change (its column is Σ). The softening slider does not act while the flag is on. It costs within the noise of a substep. **Energy**: the softening depends on the state (in time, in space and on the velocities through t) and no force pays for it, so the conservative default cloud gains 41 % of |E0| in its first collapse with the flag on (−0.15 % off over 100 orbits); a conservative scheme (grad-h terms) is not done. The default cloud is not recalibrated for it: its first-collapse burst burns 12 % of the hydrogen instead of 33.5 %.

### Nested grid

Behind the `nestedGrid` flag (Features tab, on by default since the [calibration](spikes/calibration.md); proposal C2, [spike](spikes/c2-nested-grid.md)). A second grid chain of 128² cells 8 times smaller (a box of 16 × 16 main cells, aligned on them) is laid over the core once one dominates: the main grid's peak at 8 ρ0 or more within 2 cells of the previous reading for 3 readings of the stats in a row (before the star forms the densest cell jumps between clumps); the box is recentred when the peak (the fine level's) leaves its middle half, and goes off when the main peak stays under 4 ρ0 (`nestedBox.ts`, tested). In the default cloud it switches on at about 17.6 s. Inside it (less a margin of 2 fine cells) the particles read the fine level: its density, dispersion, temperature, fuel, heating and fusion law (`gasAt()`), and its force a = a_fine(inside) + a_main(all) − a_main(inside) (`forceAt()`): the fine deposit holds only the mass inside the box; its mass is gathered onto the main cells with the cloud-in-cell weights (which keep its total and its center) and summed by the main grid's own two-level pass over the box and one cell around it (a_main(inside)); a combine pass adds the main fields' difference, read bilinearly at the fine centers, to the fine gravity. Pairs inside the box go through the fine level, pairs with one particle outside through the main grid. The force fades from the main grid's to the fine level's over one main cell inside the box. Both levels' gas is drawn before either's fusion power (each particle's rate reads the level it is in). The Jeans floor uses the cell of the level read. The reduction gains three texels (the fine level's peak, maxima, smallest softening and its potential gain ½ Σ m (φ_fine − φ_main) with the self-interaction moved to its softening): the stats show the finer peak, the adaptive step takes the larger maxima. **The fine level keeps the main softening ε** (the user's choice): ε/2 made the core 3 times denser (ε/3: 4.5 times) but with ω·dt 0.5 (0.8) and, above all, it heats the cloud: the law of a pair changes whenever a particle crosses the box's edge, and the conservative cloud gained 54 % of |E0| over 100 orbits at ε/2 whatever the time step (+1 % at ε, −0.15 % off). With ε the gain is the gas's: the core's temperature and burning are those of cells 8 times smaller; the peak density moves little (215 ρ0 instead of 192 at 34 s). It costs +33 % (400k) to +56 % (1M) of a substep's grid passes while the box is on, +33 % and +22 % per frame. The defaults are not recalibrated for it.

### Integration: velocity Verlet

The `GPUComputationRenderer` computes the three state textures of a substep (velocity, position and `textureAccel`) from the ones of the previous substep: no pass reads what another writes in the same substep. At the start of the substep that sees the positions xₙ, they hold xₙ, vₙ₋₁ (the velocity lags the position by one substep) and aₙ₋₁. The grids were drawn from xₙ, so every pass can compute aₙ = a(xₙ) (gravity by bilinear interpolation of the grid, plus the drawings' pull), and:

- velocity pass: vₙ = vₙ₋₁ + ½ (aₙ₋₁ + aₙ) Δt, the second half kick of the previous step and the first one of this step; with the `collisions` flag, its cell's collision turns vₙ (the position pass turns it alike before the drift); then cooling, the Jeans floor (when on), heating, the speed limit and the walls act on this value, and it is what is stored;
- position pass: xₙ₊₁ = xₙ + vₙ Δt + ½ aₙ Δt², from the same inputs (it recomputes vₙ: the two passes use the same expression, so that they agree on which particles leave the area);
- `textureAccel` ← aₙ.

The positions then obey xₙ₊₁ = 2 xₙ − xₙ₋₁ + aₙ Δt², the sequence of the kick-drift-kick leapfrog, with one force evaluation per substep and no extra grid pass. The scheme is of the second order and symplectic for a force that depends on positions alone, and `src/simulation/protostar/leapfrog.ts` is its pure twin (a Kepler orbit: the energy error falls 4 times when the step is halved and does not drift, `tests/leapfrog.test.ts`). Reading the old textures in all three passes is therefore not a first-order scheme, as it can look: it is the same recurrence written on lagged storage ([spike P5a](spikes/p5a-integrator-order.md)).

- **First substep of a run.** The initial velocities are those at the initial positions, so nothing is owed for the missing half kick: the acceleration texture starts with z = 1, which switches the kick off in both passes for that substep (the acceleration pass writes 0 there afterwards). Before P5a the first substep gave every particle a full kick `a Δt` too many.
- **Walls.** A particle whose step ends outside the area bounces: the position pass mirrors the end of the step about the wall, and the velocity pass stores the velocity that makes the next substep's kicks give the speed the particle has after bouncing at the instant it reaches the wall, `−e (v + a s Δt) − a s Δt` (s the share of the step before the wall, e the restitution, 0.5 in the application). Before P5a the velocity vₙ alone was reversed and the position clamped on the wall, which gave every bounce about 1.5 u a Δt of energy (u the normal speed, a the pull towards the inside): first order in Δt and always positive.
- **Operator splitting.** Cooling, the Jeans floor and heating modify the velocity after the half kick; they act on the next displacement and use the current Δt. The cooling is the exact solution of its law over Δt (unconditionally stable: it needs no bound of the time step, however stiff), the heating adds exactly q·Δt.
- **A time step that changes.** The two half kicks of vₙ belong to the step that ended at xₙ, so they take *its* length Δtₚ (the `dtPrev` uniform, kept by the model in `beforeSubstep()`, which ignores the calls with Δt = 0 of the lab); the drift takes the length Δt of the step that starts at xₙ: vₙ = vₙ₋₁ + ½ (aₙ₋₁ + aₙ) Δtₚ, xₙ₊₁ = xₙ + vₙ Δt + ½ aₙ Δt². Written as the map (xₙ, vₙ) → (xₙ₊₁, vₙ₊₁), that is velocity Verlet with a step of any length at each step: of the second order whatever the sequence of steps (and symplectic as long as the sequence does not depend on the state), and the velocity stored after a bounce is exact whatever the next step. Before phase B5 both kicks took the current Δt, which makes an error of ½ a (Δt − Δt′) at every change of the time step (the speed slider's, now the adaptive step's). The twin takes `dtPrev` too: on a Kepler orbit with a step cut into 1 to 4 substeps from one frame to the next the energy error falls by 4 when the step is halved and does not drift, where the kicks over the current Δt are of the first order (`tests/leapfrog.test.ts`); on the GPU, ten steps of 20 000 particles, six of them of changing lengths, 1 131 bounces, agree with the twin to 1.2·10⁻⁴ px and 1.6·10⁻⁴ px/s (`protostar.integration`).

### Adaptive time step

Proposal B5, the `adaptiveTimeStep` flag (Features tab). The frame still simulates `BASE_DT` × the speed slider; what adapts is the number of substeps it is cut into (`Simulation.step()` asks the model, `ProtostarModel.substepCount()`), between frames only: the substep is the same within a frame. On by default since the [calibration](spikes/calibration.md) (it was off before: the default cloud's run costs a fifth more with it on). Off, the count is ⌈speed⌉ as it has always been.

The criterion (`timeStep.ts`, pure and tested) is the accuracy of the dense core, from the two maxima of the multichannel reduction (the speed and the acceleration bounds, [above](#the-multichannel-reduction)):

    dt_crit = min( COURANT · cell / |v|max , OMEGA · sqrt( max(ε, cell) / |a|max ) )

(with the adaptive thickness, ε is the thinnest layer of a cell holding mass, from the reduction).

For a core of oscillation frequency ω the pull is at most ω² ε, so the second term is OMEGA / ω at the end of its range: it keeps ω Δt near `PROTOSTAR_STEP_OMEGA`; the first keeps the gas from crossing more than `PROTOSTAR_STEP_COURANT` cells of the grid in a substep. The count is the smallest one that keeps every substep within dt_crit, between the fixed count (`PROTOSTAR_MIN_SUBSTEP_RATIO` = 1: a coarser substep in the calm phases delays the first burst, so the step only refines) and ⌈`PROTOSTAR_MAX_SUBSTEP_RATIO` × the fixed count⌉: the work of a frame is bounded by that ratio of what the fixed count (and the GPU benchmark) costs. It goes up at once and comes down one count at a time, and only when the lower count keeps `PROTOSTAR_STEP_RELEASE` of dt_crit: the count of the default cloud changes about ten times in 34 s. The maxima are read every `PROTOSTAR_STEP_READ_INTERVAL` frames while the flag is on (the other readings of the reduction stay at the stats' cadence), with the lag of an asynchronous read (zero to three frames): the constants carry the margin for it. While a drawing or the point force acts the count is at least the fixed one (their pull is not in the maxima). The velocity caps (`PROTOSTAR_MAX_SPEED`) are kept. Numbers, constants and what they cost: [spike B5](spikes/b5-adaptive-time-step.md).

The GPU benchmark runs with the flag off (`BENCHMARK_PARAMS`): it times the calm first frames of a restart, where the adaptive step would run fewer substeps than it does later, and its count depends on the instant the asynchronous reads land; the fixed count is a deterministic load.

### Energy diagnostics

Proposal A7. The energy of the cloud is measured on the GPU, with the same grids as the dynamics, and shown as two statistics. Code: `grid-gravity.frag` (potential), `protostar-reduce.frag` and `protostar-potential.frag` (reductions), `reduction.ts` (layout, unpacking), `energy.ts` (drift and virial ratio), `gpuModel.ts` (cadence, flag). The measure changes nothing in the dynamics: the default-cloud baseline of the lab reproduces the recorded one on all its values.

**Potential.** The loops of `grid-gravity.frag` already compute `inversesqrt(r² + ε²)` for every term of the force. With `GRAVITY_POTENTIAL` defined they also accumulate `−m·s` (fine cells of the near zone) and `−M·s` (coarse cells, monopoles at their center of mass): the Plummer potential Φ = −G Σ m / √(r² + ε²), of which the force is the gradient, goes to the third channel of the gravity grid (px²/s²). The define is set for the protostar only; the drawings' fields (`DrawingField`) build the same shader without it and keep a third channel of 0.

**Energies** (simulation units: mass × px²/s²; divide by `TOTAL_MASS` for a specific energy):

- K = ½ Σ m v², the sum of the fourth channel of the moments (m|v|², deposited anyway) over the grid: exact up to the footprints clipped at the edge of the grid.
- U = ½ Σ_cells M Φ − (self-interaction), see below.

**The self-interaction.** The potential of a cell includes its own mass at distance 0 (−G M / ε), which the force does not feel (r = 0 gives no pull). In ½ Σ M Φ every particle is therefore also counted against itself, about −G m² / ε (exactly that at the center of a cell, 0.84 times that at a corner for the default softening on the 128-cell grid). The composition deposit (second attachment of the moments) already holds Σ m² per cell, so the reductions remove G (Σ m²)_c / (2 h_c) cell by cell on the GPU, h_c the softening of the cell (ε, or its thickness with `adaptiveThickness`): U = ½ Σ M Φ + Σ_c G (Σ m²)_c / (2 h_c). It is a correction of 0.23 to 0.29 % of U for 5 000 particles in the lab, and 6·10⁻⁵ at 400 000. It is the diagonal only: two particles of one cell are treated as being at distance 0, and the cloud-in-cell spread smooths the kernel; against the direct pair sum the grid's U is within 0.15 to 0.33 % at 5 000 particles (lab, `protostar.energy-reference`), with or without this term (the grid's other approximations, of the opposite sign, are of the same size).

**Time alignment.** In velocity Verlet the velocity texture lags the positions by one substep (above): the grids drawn at the beginning of substep n see the positions xₙ and the velocities vₙ₋₁. K from that deposit and U from that gravity would be the energy of no state, with an error of about Δt |dU/dt|. The model therefore keeps the potential of the previous grids before drawing the new ones (`stashPotential()`: two small passes, `protostar-potential.frag`, run in the substeps of the frames that are read), and the reduction pairs the new K with that potential: both belong to the state (xₙ₋₁, vₙ₋₁). The unsynchronized sum is also in the reduction (`energy.potentialNow`), to measure the lag.

**Statistics** (declared in `declaration.ts`, hover texts in the five catalogs):

- *Energy drift*: (E − E₀) / |E₀| in %, with E = K + U and E₀ the first reading of the run, taken at the end of the first frame (so it is the energy of the start, not of 10 frames of cooling later), or of the first usable reading after the diagnostics were switched on. Cooling lowers it and fusion heating raises it; with both off it measures the error of the integration. The drawings' forces are not in U.
- *Virial ratio* 2K / |U|: about 1 in equilibrium, below 1 for a cloud that falls in. Both tiles show "–" when unknown: with the diagnostics off, before the first reading, with a gravity of 0 (no potential), and when the potential or the total is negligible next to K + |U| (`PROTOSTAR_ENERGY_RATIO_FLOOR`: the quantity divided by is then noise).

**The `diagnostics` flag** (Features tab, on by default): when off the model skips the potential stash and the first-frame reading, and the two tiles show "–". The potential channel of the gravity pass and the reduction (needed by the core statistics) run anyway. Cost: see [lab-baseline.md](lab-baseline.md).

#### The multichannel reduction

One two-stage reduction (128² cells → 16² blocks of 8 × 8 → 4 × 1 texels) and one asynchronous read give everything below; it runs at the end of every `PROTOSTAR_STATS_INTERVAL`-th frame and of the first (diagnostics on), and of every `PROTOSTAR_STEP_READ_INTERVAL`-th while the adaptive time step is on. Stage 1 writes four attachments (the block's partial result), stage 2 one texel of the final RGBA32F target `reduce2` per attachment. The model unpacks the floats with `unpackReduction()` (`reduction.ts`, tested) and keeps the latest result:

| Texel | x | y | z | w |
|---|---|---|---|---|
| 0 core | max ρ (ρ₀) | T of the densest cell (T₀) | Σ fusions per s | Σ mass (deposit units) |
| 1 extremes | x of the densest cell (px) | y of the densest cell (px) | speed bound (px/s) | acceleration bound (px/s²) |
| 2 energy | Σ m\|v/L\|² | U, grids just drawn (self-interaction removed) | smallest softening of a cell with mass (px) | U, previous substep |
| 3 moments | Σ M x | Σ M y | Σ m v_x / L | Σ m v_y / L |

Texel 0 keeps the layout the statistics always read (ρ, T, rate first; the constant 1 in w became the mass). The densest cell is the first one, in reading order, with a strictly greater density; the position goes with the density. What the numbers are:

- **Speed bound**: the maximum, over the cells that hold gas, of |mean velocity| + √t, the mean velocity and t (the dispersion, a speed, not the temperature) being those of the cell's 3 × 3 neighborhood. It follows bulk flow and thermal spread and misses the far tail of a distribution; in the lab (100 000 particles, core formed) it is 1.12 times the fastest particle, with no particle above it. A proxy for the time-step criterion, not a bound in the strict sense.
- **Acceleration bound**: the maximum of |a| of the gravity grid over the cells that hold mass (the force on a particle is the bilinear interpolation of four cells, so it never exceeds it); the drawings' force is not in it.
- **Center of mass and momentum**: first moments of the cloud-in-cell deposit. The weights reproduce a particle's position exactly, so these are the particles' own sums (to 4·10⁻⁵ px and 10⁻⁸ in the lab), not a grid approximation, except for the footprints clipped at the edge.

Typed getters of `ProtostarModel`, for the phases that consume them: `reduction` (everything, `Reduction`), `maxSpeed`, `maxAcceleration`, `peakPosition`, `centerOfMass`, `energy` (`ProtostarEnergy`: K, U, total, drift, virial ratio; null with the diagnostics off). They hold the latest reading (every 10 frames, about 0.3 s of simulated time at the default speed; every 3 with the adaptive time step), in px, px/s, px/s² and simulation mass units; `null` before the first.

#### What the scheme does with it

The lab (`baseline.protostar.energy-drift`, numbers in [lab-baseline.md](lab-baseline.md)) runs the default cloud with cooling, feedback and fusion forced to 0 and elastic walls, for 100 orbits (the period of a circular orbit at the half-mass radius, 13.1 s, 462 frames). The initial virial ratio is 0.33: the cloud falls in, and virializes (2K/|U| close to 1) within about 3 orbits. K + U then stays where the collapse left it: **-0.14 %** from the first orbit on, with a largest excursion of 0.7 % during the first collapse, a secular rate of 0.00007 % per orbit and an oscillation of ±0.006 % (one reading per 10 frames): the plan's target of less than 1 % over 100 orbits is met. The same run before phase P5a drifted by +1.3 % after 10 orbits and +39.5 % after 100, at a rate proportional to the time step; the cause was not the order of the passes but the walls (see [Integration](#integration-velocity-verlet) and [the spike](spikes/p5a-integrator-order.md)).

What is left is not the scheme's: with the time step divided by 1, 2 and 4 the drift after 12 orbits is -0.144, -0.140 and -0.137 % (the largest excursion 0.78, 0.70 and 0.69 %), the secular rate -0.0008, -0.0008 and +0.00007 % per orbit (0.127, 0.061 and 0.029 before), so no dependence on the step shows. The -0.14 % is set during the first collapse and does not grow afterwards; the likely source (not isolated by a run of its own) is the grid force, the bilinear interpolation of cell accelerations, which is not exactly the gradient of the grid potential U is computed from, in the densest moment of the collapse. The walls of the application, which return half of the speed, take 14 % of the energy within 12 orbits (the particles that the collapse throws out): that is the boundary's, not the scheme's. The lag of the velocities behind the positions, which the stash corrects, is small for a slowly evolving cloud: the synchronized and the unsynchronized sums agree to 0.2 % after the first orbits (4.9 % against 0.7 % in the first collapse, where the energy changes fastest).

### Initial conditions

A disc of radius 0.38 L (`PROTOSTAR_CLOUD_RADIUS`), centered on the screen, whose velocities are set by two energies in units of the disc's own potential energy |U|, not by fractions of a circular speed ([the spike](spikes/a8-initial-conditions.md) has the derivations and the measurements). Code: `initialConditions.ts` (the cloud), `disc.ts` (the disc's self-gravity), `turbulence.ts` (the correlated agitation), `toomre.ts` (Toomre's Q).

- **Density profile** (`profile`): *uniform* (default: the same density up to the edge) or *Maclaurin*, Σ ∝ √(1 − r²/R²), whose in-plane pull grows linearly with r up to the edge (g = (3π/4)·G·M·r/R³): a cold Maclaurin disc falls in homologously, its radius a(t) obeying a″ = −(3π/4)·G·M/a², hence the free-fall time t_ff = (π/2)·√(2R³/(3π·G·M)).
- **The disc's pull**: at each restart `buildDiscTable()` tabulates the pull g(r), the potential Φ(r), the potential energy U and the energy of circular motion of the softened (Plummer ε) disc by quadrature over rings (the angular integral of a ring is a pair of complete elliptic integrals; 257 nodes, about 5 ms). The circular speed is v_circ(r) = √(r·g(r)), not the sphere's √(G·M_enc/r): against the sphere's formula, which the cloud used before, the disc's is 0.33× at 0.07 R (the sphere over-rotated the inner disc 3 times), 0.75× at R/2 and 1.44× at the edge (ε = 1.6 % L).
- **Rotation energy** (`betaRot`, β = E_rot/|U|, default 0.08): the tangential speed is the same fraction f of v_circ(r) at every radius, counterclockwise, and f is chosen so that the rotation has the energy β·|U| to the particle: f = √(β·|U|/K_circ), K_circ = ½∫ v_circ² dm being the energy of the disc on circular orbits (K_circ/|U| ≈ 0.48 with the default softening, 0.5 without). A cloud on exactly circular orbits has β = K_circ/|U| (the lab uses 0.48, 1.003 × v_circ).
- **Virial ratio** (`alphaVir`, α = 2K/|U|, default 0.33): the whole kinetic energy, rotation and agitation. The agitation has the energy (α/2 − β)·|U| (nothing if the rotation takes it all: α is then raised to 2β), spread over the two components with a dispersion σ per component, K_agit = M·σ². It has the mean momentum and the part along the rotation's pattern taken off (so the cloud does not drift and the two energies add), and is scaled to the particle: the sliders' energies are the ones of the cloud drawn, up to the Poisson noise of the positions in |U|.
- **Structure of the agitation** (`turbulence`): *white* noise (default: a Gaussian of its own for each particle, which the temperature of the gas reads in full as heat) or *correlated*: a Gaussian, solenoidal (divergence-free) random field of power spectrum P(k) ∝ k⁻³ per Fourier mode of the plane (E(k) ∝ k⁻² per wave number, Larson's supersonic turbulence) for wave numbers 1 to 8 across the diameter (`PROTOSTAR_TURBULENCE_*`), made by FFT on a 64 × 64 grid at restart and sampled bilinearly at the particles. Neighbors move alike, so the gas pass (which subtracts the mean velocity of a 3 × 3 cell neighborhood) reads it as bulk motion, not as heat, until flows collide.
- **Toomre's Q** = κσ/(3.36·G·Σ) (the criterion of a stellar disc; the gas's π would read 7 % higher), κ² = (1/r³)·d(r²v²)/dr from the initial rotation: `measureToomre()` gives it from the velocity field of the particles (the lab's `protostar.initial-conditions`). The default cloud has Q ≈ 0.2 to 0.35 from the center to 0.9 R: it is unstable at every scale, which is what fragments it. With the sphere's formula it was 1.6 × higher at 0.3 R and 0.5 × as high at 0.94 R.
- **No initial acceleration** is stored: the first substep of the integration owes no half kick (see [Integration](#integration-velocity-verlet)). The table gives it anyway (`discAcceleration()`), which the lab uses to check the gravity grid at t = 0 (`protostar.initial-grid-force`).

### Cooling

Radiative cooling of a thin disc (proposal A6, Johnson & Gammie 2003; twin `src/simulation/protostar/cooling.ts`, [spike](spikes/a6-a13-cooling-and-jeans.md)). The density of the grid is the surface density Σ of the model, so a column of gas has the optical depth τ = κΣ/2 from its mid-plane to either face, whatever its thickness, and radiates through the effective depth τ_eff = 3τ/8 + √3/4 + 1/(4τ), which joins the optically thick and thin limits:

dT/dt = −c μ T⁴ / (Σ τ_eff), with T in T₀, Σ in ρ₀, μ = μ_mean / μ_H, down to the floor T_min.

T is the temperature (the thermometer's: the radiation goes as T⁴), while the energy per unit mass is the dispersion t = T/μ: at the same temperature a gas of heavier ions holds less heat and cools μ times faster. Over a step Σ and μ are frozen and the law integrates exactly, T′ = T (1 + 3cμT³Δt/(Στ_eff))^(−1/3), floored at T_min (a gas already below the floor is left alone); the deviations from the local mean velocity are scaled by √(T′/T), so rotation and infall are kept. The scheme is unconditionally stable. Σ τ_eff is computed as 3κΣ²/16 + √3Σ/4 + 1/(2κ), finite when Σ → 0.

- **A thermostat**: the loss grows as T⁴ (a gas twice as hot cools 16 times faster), where the old damping v ← v̄ + (v − v̄) e^(−kΔt), k/(1 + ρ/ρ_opq), was independent of T and strongest in the thinnest gas.
- **Opacity**: dense gas is optically thick (τ ≫ 1) and cools as T⁴/(κΣ²): it keeps the heat of its compression. In that limit only c/κ matters; κ sets where a column becomes thick (Σ ≈ 2/κ ρ₀) and how fast the thin gas cools (2cκμT⁴ whatever Σ).
- **What changes in the cloud's history**: the cold envelope (2 MK) barely radiates any more (T³ is small), so after the first collapse's bounce the cloud stays warm and falls back after a lull of about 5 s. c/κ cannot be large: the helium core (μ = 2.65, dense) must keep enough heat to reach its ignition; above c/κ ≈ 1 it settles at 75 to 85 MK and never flashes.

### Jeans floor

Behind the `jeansFloor` switch (Features tab, on by default since the [calibration](spikes/calibration.md); proposal A13). On a grid of cell Δx a thin sheet's Jeans length λ_J = c_s²/(GΣ) must span at least N_J = 4 cells (Truelove et al. 1997), or the gas fragments at the scale of the grid. With t = 2c_s², the dispersion of each neighborhood is kept at t_J = 2 N_J Δx G Σ or more, by scaling the deviations from the local mean by √(t_J/t) after the cooling (a cold neighborhood, with nothing to scale, gets the missing dispersion as a kick). It is an artificial pressure: it adds energy where the grid no longer resolves the collapse. In the default cloud it rarely acts (the measured dispersion of a 3 × 3 neighborhood includes the infall and the shear): the smallest Jeans length over the cells above 1 ρ₀ goes from 2.1 to 3.5 cells and the worst share of their mass under 4 cells from 24 % to 10 %; the history is the same. The floor is applied by particle from the interpolated neighborhood, the census by cell after the particles moved, hence a minimum a little under 4.

### Stability map

Behind the `stabilityMap` choice (Features tab, off by default; proposal A12): Toomre's Q and the cooling parameter β = t_cool·Ω of every cell of the gas grid, drawn over the animation. One 128² pass (`protostar-stability.frag`, twin `stability.ts`) reads the gas pass (Σ, the dispersion t and the mean velocity u of each 3 × 3 neighborhood) and the molecular weight's factor:

- Ω = (dx u_y − dy u_x)/r² about the center of mass of the latest reduction; the vorticity ζ = ∂_x u_y − ∂_y u_x by central differences (one-sided next to an empty cell); κ² = 2Ωζ (0 where the angular momentum falls outwards);
- Q = σκ/(3.36 GΣ), the stellar criterion of `toomre.ts`, with σ² = t/2;
- β = |Ω|·t_cool with Gammie's t_cool = E/|dE/dt| = 1/|d ln T/dt| of the thin-disc law ([Cooling](#cooling)); unbounded at or below T_min.

A disc fragments where Q < 1 and β < 3 (Gammie 2001). The layer (`render/stabilityLayer.ts`) is drawn after the post-processing, with the visual zoom: *Fragmentation* tints red the cells where both hold, orange where only Q < 1, blue where only β < 3; *Toomre Q* and *Cooling β* tint red below the threshold and blue above, over one decade. Cells under 0.05 ρ₀ are left out; the colours of the four nearest cells are blended. The pass runs only while the map is shown, once per frame whose grids changed.

What it shows on the default cloud (lab `protostar.stability-map` and `protostar.stability-evolution`, 400,000 particles): at t = 0 the map's Q is 0.19 at 0.1 R, 0.20 to 0.22 from 0.2 to 0.5 R, 0.25 at 0.75 R and 0.32 at 0.9 R, within 1 to 8 % of Q measured on the particles (the professor: 0.19 to 0.56); β is 15 to 21, so the start is not in the fragmentation regime by cooling (the professor's β ≈ 0.6 at 0.2 R was for the cooling before A6). After the first collapse 60 to 95 % of the gas is in it (Q < 1 and β < 3) until the star forms, then 4 %; Q stays below 1 on 80 % of the mass. See [the spike](spikes/a12-stability-map.md).

### Collisions of the gas

Behind the `collisions` flag (Features tab, on by default since the [calibration](spikes/calibration.md); proposal C1, [spike](spikes/c1-mpc-collisions.md)): multiparticle collision dynamics (Malevanets & Kapral 1999) turn the collisionless particles into a gas. Twin: `collisions.ts`.

- At every substep the grid of the protostar's cells is shifted by a random vector of [0, cell)² (from the substep's seed), and every particle is deposited at the cell that holds it (nearest grid point: the exact count, Σv and Σ|v|² of the cell). The velocity deposited is v(n) = v(n−1) + ½(a(n−1) + a(n))Δt, the velocity at the instant of the positions: the texture lags them by one substep ([Integration](#integration-velocity-verlet)), and turning the lagged one breaks the conservation (a conservative cloud lost 13 times its energy in 100 orbits that way).
- A cell of two particles or more collides with probability 1 − e^(−νΔt), ν = `PROTOSTAR_COLLISION_RATE` × ρ × √t (ρ in ρ₀, its dispersion t in T₀; 1000 /s: the gas of the cloud collides at nearly every substep, its thin edge about every other one), and then every velocity of the cell turns about the cell's mean by ±90° (one sign per cell, from a hash of the cell and the seed: the passes agree without storing it). The cell's mass, momentum and kinetic energy are conserved exactly (the parcels all weigh the same). The velocity pass and the position pass turn the same v(n) before the drift: no pass of its own over the particles.
- With the flag on, the cooling, the Jeans floor and the heating scale the deviations about the collision cell's mean and with its own dispersion, so that they too keep the cell's momentum exactly; the laws still read the 3 × 3 neighborhood's temperature.
- **γ = 2** (the user's choice): the particles carry two velocity components and no internal energy, so the gas is a strictly planar ideal gas, P = ρt/2, c_s = √(γP/ρ) = √t, T ∝ Σ under adiabatic compression; a 3D disc integrated over its thickness would have 1.5 to 1.8 (the spike has the alternatives).
- **Validation** (lab, RTX 5070): the GPU against the twin to 4·10⁻⁷ σ; momentum and energy of a gas without gravity to 3·10⁻⁷ over 30 substeps; the conservative cloud's K + U to +0.27 % over 100 orbits (−0.17 % without); Sod's shock tube fits γ = 2 better than 1.4, 5/3, 2.5 or 3, its shock within a column of the exact one; a standing sound wave gives γ_eff = 2.04; hydrogen and helium parcels of dispersions 4 : 1 reach one dispersion. The pressure is isotropic over two substeps (at ±90° the normal pressures trade places at every collision), but particles trade energy only through the change of their cell's mean: the speeds relax to Maxwell–Boltzmann and the species to one dispersion in about 0.6 N substeps with N particles per cell.
- **What it does to the default cloud** (three seeds): the first collapse burns 40 % of the hydrogen (33.5 % without), the core falls back at once instead of after a lull, the helium flashes at 7.4 s (about 23 s without) and the whole star is carbon at 34 s, gathered in 3 × 3 cells. The defaults were calibrated on the collisionless model; a collisional gas dissipates its infall in shocks, which the cooling radiates. G = 6 with c = 1 gives the whole sequence about three times slower (hydrogen first burning at 15 MK, the helium flash at about 60 s): a lead, not a calibration.
- **Cost**: +14 % (400,000 particles) to +18 % (1,000,000) of the simulation frame while the cloud is diffuse, +31 to +63 % once it has collapsed into a few cells (every additive pass then serializes there); nothing while off (the deposit is skipped, one uniform branch).

### Fusion laws

A particle of a type that fuses does so per step with probability P = 1 − exp(−r · Δt), with a rate per fusing particle (proposal A2: Gamow's laws, normalised at a reference temperature, with the composition of the neighborhood in them)

r = min(λ · (ρ X)ⁿ · f(T) / f(T_ref), `PROTOSTAR_FUSION_RATE_MAX`), f(T) = T^−p · exp(−b · (T / unit)^−q)

with ρ in ρ₀ (`fusionRateOf` in `protostar-common.glsl`, `fusionRate` in `reactions.ts`) and X the mass fraction of the fusing type (the fuel: hydrogen for the proton-proton chain, helium for the triple alpha) in the 3 × 3 neighborhood.

| | Proton-proton chain | Triple alpha |
|---|---|---|
| Reaction | 4 ¹H → ⁴He + 26.7 MeV | 3 ⁴He → ¹²C + 7.275 MeV |
| T_ref (`referenceTemperature`) | 15 MK, core of the Sun | 100 MK, real ignition |
| n (`densityExponent`) | 1: two bodies, so r ∝ ρX per nucleus | 2: three bodies, r ∝ (ρY)² per nucleus |
| f(T) (`law`: p, b, q, unit) | T₆^−2/3 · exp(−33.8 · T₆^−1/3), T₆ = T / 1 MK (non-resonant: Gamow's peak) | T₈^−3 · exp(−44.0 / T₈), T₈ = T / 10⁸ K (resonant) |
| Local exponent d ln r / d ln T = q·b·(T/unit)^−q − p | 3.9 at 15 MK, 3.0 at 30 MK, 5.1 at 7.5 MK | 41 at 100 MK, 19 at 200 MK, 60 at 70 MK |
| Mass turned into energy | 0.71 % | 0.065 %, 11 times less |

The exponents are no longer parameters: they follow from the law and change with the temperature (a Gamow rate steepens as the gas cools), as in the real reactions. One λ remains per reaction: the rate of one fusing particle at the reference temperature and density ρ₀, in pure fuel (the old slider semantics, in the same units). The rate is computed from logarithms, as the law's exponential underflows far below T_ref and the helium law reaches 10⁴⁰ above it, and capped above 1 / Δt. The T it uses is the temperature of the gas (the dispersion times μ / μ_H, see [Units](#units)) averaged over time, and the rate is divided by the bias that the noise of T puts on the law: see below. The laws' T_ref are therefore temperatures a thermometer would read: a hydrogen gas fuses at 15 MK whatever its dispersion is made of, and a helium gas at 100 MK, 2.65 times less dispersed than the same temperature in hydrogen. The draw is made in the position pass (PCG generator per particle and per substep), which rewrites the type.

**What λ does.** The ignition temperature (the T at which a particle reaches a given rate) is a logarithmic function of λ alone: d ln T_ign / d ln λ = −1 / α, α being the local exponent where the gas ignites. A decade of λ divides it by 10^(1/α): 1.8 for the proton-proton chain at 15 MK (45 % lower), 1.06 for the triple alpha at 100 MK (6 % lower: helium ignition is almost a threshold, and λ barely moves it). The temperature at which a star burns is set by what holds the star up (G, the virial temperature of its collapse), not by λ, which only has to be large enough for hydrogen to burn there.

**The fuel fractions X and Y** come from the composition deposit (`protostar-deposit.vert`): its channels are (Σ m(1 + Z)/A, Σ m·[type is the fuel of the first reaction], Σ m², Σ m·[type is the fuel of the second reaction]), the cloud-in-cell sums over the particles. The gas pass divides the 3 × 3 sums of the second and fourth channels by that of the mass (the same ratio pattern as the factor μ / μ_H, which keeps a half-float deposit usable) and writes X and Y to a third attachment (`gridFuel`); `gasAt()` interpolates them like the other fields. Carbon, the products of any other reaction and the custom elements of the element editor are the fuel of no reaction (`reactionArrays().fuel` is −1): they are in neither X nor Y, they fuse into nothing and they do dilute the fuel (X is the share of the mass). The channel of a type is the rank of its reaction in the table (two reactions at most: `PROTOSTAR_FUEL_CHANNELS`). **The density of the law is volumetric in the real reactions; with the fixed thickness of the cloud, ρ is the surface density Σ** (with `adaptiveThickness`, A11, the law reads Σ / (2h) as Σ · h_ref / h, see [Adaptive thickness](#adaptive-thickness)): the ρ^n of the table is the grid's `rho`, times that factor.

### The noise of the temperature

Proposal A3. The temperature of a neighborhood is estimated from N particles, with a relative noise of 1 / √N, and a rate that goes as T^α is convex in T: its mean over that noise is larger than the rate at the true temperature, by a factor that grows quickly with α. For Maxwellian particles, each |v − u|² is exponential, T follows a Gamma law and the factor is Γ(N + α) / (Γ(N)·N^α) ≈ exp(α(α − 1) / 2N): 6.6 for N = 400 and α = 40, and for the real exponents (about 4 at 15 MK for the proton-proton chain, 40 at 100 MK for the triple alpha) the noise is no longer something the sliders' small exponents hide. Two remedies, both on:

- **Bias correction** (`noiseBias.ts`, twin of `logNoiseBias` in `protostar-common.glsl`). The rate is divided by the bias, computed in logarithms from Stirling's series (the terms in ln N cancel, see the file). The temperature is a dispersion around the mean of the same particles, which costs one degree of freedom (T is low by 1 / N on average): the estimate is a Gamma law of shape N − 1, and the code uses that (a factor (1 − 1/N)^α on the rate). N is the effective number of particles of the neighborhood, the effective sample size of a mass-weighted mean, (Σm)² / Σm², from the m² channel of the composition deposit (`protostar-gas.frag`), times `PROTOSTAR_NOISE_N_SHAPE` = 1.5: the cloud-in-cell weights, the sum over 3 × 3 cells and the bilinear interpolation at the particle spread the weights of the particles, which makes the estimate less noisy than N independent particles (the shape factor was measured in the lab, and `neighborhoodNoiseShape()` of `depositKernel.ts` computes it: 1.51 averaged over the place of the particle). With the TSC deposit it is `PROTOSTAR_NOISE_N_SHAPE_TSC` = 1.63 (the temperature's noise is 5 % lower). Where a type with a larger mass dominates (hydrogen with a little helium), (Σm)² / Σm² is the number of particles that carry the noise, not their count. The exponent is the local exponent of the reaction's Gamow law at the cell's averaged temperature (`alpha` in `fusionRateOf`: 3.9 at 15 MK for hydrogen, 41 at 100 MK for helium). A power law of that exponent is not enough for helium: the exponent falls as T rises (d α / d ln T = −b·q²·(T/unit)^−q), so the noise sees a curved law and the plain bias over-corrects the rate by 20 % at N = 400 and by 50 % at N = 200 at 100 MK. `logNoiseBiasCurved()` adds the curvature by Laplace's method around the saddle point of the power law with one Newton step (accurate to 0.2 % of the bias for N ≥ 100 against the exact integral over the Gamma law; the terms are written as a difference so that nothing large cancels, n being up to 10⁵). It is what the proton-proton chain uses (the lab measures its corrected mean rate within 0.4 % of the true one at every N).
  **Dividing by the bias is not enough for the triple alpha either**: the bias is evaluated at the estimate and not at the true temperature, and with an exponent of 41 that leaves the corrected mean rate 16 % high at N = 600 and a factor 3.5 high at N = 150 (measured). A resonant law (q = 1) has an exact unbiased estimate instead, the uniformly minimum variance one: with S = N·T_est/T_ref (a Gamma variable of shape N − 1, whatever T is) and G the barrier term at the reference, `Γ(n)/Γ(n−p) · (S − G)^(n−p−1) / S^(n−1)` has the expectation θ^p exp(−Gθ), θ = T_ref/T, the law itself. `logUnbiasedResonant()` (both languages, Stirling's series and log1p so that nothing large cancels) replaces the rate for q = 1 when n > p + 2; below it, or for any other law, the bias is divided out. The corrected mean rate of a triple-alpha gas at 100 MK is then within 2 % of the true one from 200 particles per neighborhood (1.053 ± 0.019 at 100). A cell too cold for it (S ≤ G, T_est below 44/N of the reference) has no rate. A cell with two particles or fewer carries no information: its bias is the huge one of N = 2 and its rate nearly zero.
- **Averaging over time** (`PROTOSTAR_TEMPERATURE_TAU`, 0.1 s). The temperature that feeds the rate is averaged cell by cell, exponentially, with a weight 1 − e^(−Δt/τ) per step (in seconds, never per step: the substeps are ⌈speed⌉ per frame and their duration varies). A cell that held no gas at the previous step starts afresh, and so does a restart. The heating and the cooling use the instantaneous dispersion, and the glow the instantaneous temperature: the heating adds exactly the energy it announces only if it scales the dispersion that is there. The average removes noise only as fast as a neighborhood renews its particles (a few tenths of a second at 4 MK, a tenth at 50 MK): the lab measures a gain of 1.3 in variance at τ = 0.1 s for a gas at 4 MK. The bias correction does not credit it (the rate is then a little low where the average works): conservative, and the delay it adds to the thermostat is τ, well below the cooling time.

Validation: [spike A5 and A3](spikes/a5-a3-heating-and-t-noise.md).

### Mass balance

**One particle is a parcel of constant mass** (proposal A4, [the spike](spikes/a4-constant-mass-fusion.md)). Every particle weighs `TOTAL_MASS / count`, whatever its type, and keeps that mass for the whole run. A fusing hydrogen does not disappear: the whole parcel changes type, with probability p = 1 − e^(−rate·Δt) per step (the rate is the share of the fuel that fuses per second), and keeps its position, its velocity and its mass. The mass defect of the reaction (4 × 1.00783 − 4.0026 = 0.0287 u, i.e. 0.71 % of the fused mass for 4 H → He; 3 × 4.0026 − 12 = 0.0078 u, 0.065 % for 3 He → C) is not taken off the parcel: it leaves only as the energy of the heating (see [Feedback](#feedback)), so the mass of the cloud is exactly constant.

- No particle is removed: the number of particles and the population of the core are constant (before A4, four hydrogens left one helium and a 400,000-particle cloud ended with about 30,000 carbons). The momentum is conserved exactly by the fusions, so the statistical drift correction (`drift.ts`) is gone.
- **The editor's atomic mass is not the mass of a particle any more.** It is the A of the type: it sets the mean molecular weight μ (the temperature, see above), through (1+Z)/A, and the mass defect δ of the reactions, hence the energy of a fusion. The weights of the initial distribution split the particles, so, since they all weigh the same, they are the **shares of the mass** of the initial cloud (pure hydrogen by default: nothing changes; a mixture of 60 % hydrogen and 40 % helium is now 60 and 40 % of the mass, where it was 60 and 40 % of the atoms).
- **Masses are those of the isotopes that react**, as their differences give the energy: ¹H (`HYDROGEN_1_MASS`), ⁴He, ¹²C (`CARBON_12_MASS`). With the standard atomic weight of carbon (12.011 u, a mix with ¹³C), three heliums would weigh less than one carbon and triple alpha would release no energy. If the product is made heavier than what it consumes, the reaction no longer releases energy (no feedback).
- The mass of a particle is in the per-type array `speciesDepositMass` of the grid passes (`ProtostarGrids.setDepositMasses()`) and in `speciesUniforms.splatMass`, which the nebula layer reads: the model sets both to the parcel mass, so that the nebula, which weighs its colour and its brightness by mass, does not brighten as the parcels turn into heavier atoms (weighed by atomic mass, a cloud of carbon would splat up to 12 times the mass it started with).
- The tile of the statistics shows the **share of the mass** of each element (a particle is a parcel: it counts atoms no more).

### Feedback

The energy released per unit of fused mass is feedback × (mass defect / fused mass) × c², with c² = `PROTOSTAR_FUSION_C2` × T₀. We inject the **expected** power (rate × energy, pass 3), not the energy of the fusions actually drawn: heating is smooth instead of arriving in bursts, and the fusions drawn correspond to it on average. The heating adds q·Δt of kinetic energy per unit mass by **scaling the velocities' deviations from the local mean velocity**: v ← v̄ + (v − v̄)·√(1 + 2q·Δt / T), with T the dispersion |v − v̄|² of the neighborhood (energy per unit mass is T / 2, so the dispersion grows by exactly 2q·Δt: ΔK = q·Δt, and what is left of T after the cooling of the same step is the one that counts). Velocity dispersion (heat) increases, and with it the outward push, without noise and without moving the neighborhood's momentum (`heating.ts` is the pure twin; the lab checks the energy to 4·10⁻⁶ per cell and the momentum to rounding). A cell too cold for this (T below `PROTOSTAR_HEATING_T_FLOOR` of T₀: nothing to scale) gets the same energy as a kick √(2·q·Δt) in a random direction, which was the heating of every cell before.

The loop: fusion heats the core → it expands, its density drops (and it radiates more, becoming less opaque) → fusion slows down → gravity and cooling contract it again. The energy added in a step is bounded by the square of the speed limit, which also keeps it finite if the power grid saturates in half floats.

### Transitions: extensible model

Reactions are a table (`PROTOSTAR_REACTIONS`, type `FusionReaction`): fusing type, product type, number of atoms consumed (for the mass defect and the label: the particles are parcels), label, key of the λ parameter, temperature law (Gamow's: `RateLaw`), reference temperature and density exponent. The GPU model translates it into arrays of uniforms indexed by the fusing type (`reactionTo`, `reactionRate`, `reactionPower`, `reactionBarrier`, `reactionBarrierPower`, `reactionReference`, `reactionDensityExponent`, `reactionEnergy`, `reactionFuel`; `reactionArrays()`), which the shaders read as they are. To add another reaction, it is enough to add its product to the default types, one line in the table (its law, its reference) and its λ parameter: neither the shaders nor the model change, as long as at most `PROTOSTAR_FUEL_CHANNELS` reactions have a fuel fraction (the composition deposit has two fuel channels). Limitation: a type fuses in only one reaction, so C + He → O could not coexist with a second helium reaction. The declaration derives `particleTypes.transitions` from it, which the editor displays ("Proton-proton chain").

### Rendering

The color comes from the type (editor). The model declares `glow: 'state'`: each particle's brightness is written in the w channel of velocity, based on the local temperature (from 1 to 15 T₀, i.e. 15 to 225 MK) and the local fusion heating. The core lights up and whitens as it burns; the helium formed, yellow, accumulates there, then the core turns to carbon, grey, and shines brightest. The « Chaleur » (Heat) slider of the visual effects adjusts this brightness.

### Parameters

| Parameter | Key | Default | Applied |
|---|---|---|---|
| Number of particles | `count` | 400,000 | restart |
| Initial virial ratio 2K/\|U\| | `alphaVir` | 0.33 | restart |
| Initial rotation energy E_rot/\|U\| | `betaRot` | 0.08 | restart |
| Density profile (uniform, Maclaurin) | `profile` | uniform | restart |
| Structure of the agitation (white, correlated) | `turbulence` | white | restart |
| Gravity constant G | `gravity` | 6 | live |
| Softening ε (% of L) | `softening` | 1.6% | live |
| Radiative cooling c (/s, log) | `radiation` | 5 | live |
| Opacity κ (per ρ₀, log) | `kappa` | 20 | live |
| Minimum temperature T_min (T₀, shown in MK) | `minTemperature` | 0.05 (0.75 MK) | live |
| H → He rate λ₀ (/s, log) | `fusionRate` | 6e-3 | live |
| He → C rate λ (/s, log) | `heFusionRate` | 2.5e-4 | live |
| Feedback (log) | `feedback` | 1 | live |
| Energy diagnostics | `diagnostics` | off | live (Features tab) |
| Adaptive time step | `adaptiveTimeStep` | off | live (Features tab) |
| Jeans floor | `jeansFloor` | on | live (Features tab) |
| Stability map (off, fragmentation, Toomre Q, cooling β) | `stabilityMap` | off | live (Features tab) |
| TSC deposit | `tscDeposit` | off | live (Features tab) |
| Gas collisions | `collisions` | on | live (Features tab) |
| Adaptive thickness | `adaptiveThickness` | on | live (Features tab) |
| Nested grid | `nestedGrid` | off | live (Features tab) |

Types: hydrogen (1.00783 u, cool blue-white, the entire initial population), helium (4.0026 u, yellow) and carbon (12 u, grey), none at the start; a share of the initial mass can be given to them. Statistics: the share of the mass of each element, core temperature (densest cell, in MK), maximum density (in ρ₀), fusions per second, of both reactions together (expected, smoothed), and, with the diagnostics on, the energy drift and the virial ratio.

### Calibration for the molecular weight (headless Chrome, GTX 1060, 1024 × 768 px area, 400,000 particles)

With the temperature of proposal A1 (the dispersion times μ / μ_H), G = 9 and λ₀ = 4e-3 are a *minimal* recalibration of the defaults: the core of a hydrogen star settles at about 1.6 MK per unit of G, and λ₀ only has to let hydrogen burn there. The default cloud then burns hydrogen at a core temperature of 14.5 to 15.8 MK for about 15 s, uses it all up within 34 s, and its helium core ignites in a flash at 60 to 120 MK (the carbon it leaves reads 3.4 times its dispersion: 140 to 160 MK at the end); the figures, three seeds, with the old defaults and with the factor off for comparison, are in [the spike](spikes/a1-mean-molecular-weight.md) and [lab-baseline.md](lab-baseline.md). The fine recalibration (the Gamow rates) is the next section.

### Calibration for the Gamow rates (headless Chrome, GTX 1060, 1024 × 768 px area, 400,000 particles)

The defaults of proposal A2 (the evidence, with the six-seed tables and what was scanned and left alone, is in [the spike](spikes/a2-gamow-rates.md)): G = 9 (the core of a hydrogen star settles at about 1.6 MK per unit of G, [A1](spikes/a1-mean-molecular-weight.md)), λ₀ = 4e-3 (A1) and **λ_He = 2.5e-4** (3.75e-5 before): with λ_He · 20² = 0.1, a pure helium gas of 20 ρ₀ fuses 0.1 times per second per particle at exactly 100 MK, its real ignition (hydrogen: 15.9 MK at the same density and rate, a ratio of 6.3 against the real 6.67). The cooling (0.51), the opacity (5.32), the feedback (0.146) and G were scanned around those values, before and after the initial conditions of A8 landed, and left where they were; the glow range was widened to 1 to 15 T₀ (15 to 225 MK) for the carbon ash.

The default cloud (twelve seeds, 34 s): the hydrogen burns on a plateau at 18.2 MK (median; nine seeds in twelve within 10 to 20 MK, the others up to 39 MK), ten seeds in twelve have their helium flash within 34 s (median 22.9 s), and the star has 25,000 hydrogens left at 34 s (4,600 to 13,000 at 56 s). The carbon ash, which nothing burns (carbon burns at 600 MK in a real star, out of reach here), reads 33 to 160 MK as 3.4 times its dispersion. The first collapse of the cold cloud burns 35 % of the hydrogen in a burst of 780,000 fusions per second (37 % in a 3 s burn at 32,000 per second with the old power laws): the steep Gamow law below 10 MK turns it into a flash. Those figures are the reference for the later phases: [lab-baseline.md](lab-baseline.md).

### Calibration for the fusion of parcels of constant mass (headless Chrome, GTX 1060, 1024 × 768 px area, 400,000 particles)

Phase A4 changed no default ([the spike](spikes/a4-constant-mass-fusion.md)). On the six seeds of the Gamow calibration, the first collapse burns 35 % of the hydrogen as before (a burst of 891,000 fusions per second, 783,000 before), the plateau is at 18.7 MK (17.9 MK over twelve seeds, nine in twelve within 10 to 20 MK, as before), and the helium flash comes in every seed (twelve in twelve within 34 s, median 25.5 s; ten in twelve and 22.9 s before). The helium burns further: at 34 s the carbon holds 70 % of the mass in the median (33 % before) and the helium 24 % (56 %), and the last 15 % of the run reads 102 MK in the median (79 MK). The particles are no longer removed, so the figures that counted them mean something else: the "hydrogen left" is a share of the mass. The momentum of a fusing gas without gravity is conserved to 5e-9 of its thermal momentum over 10,000 substeps (5e-3 before, with half of the particles gone), and the energy the fusions release equals the power the heating deposits to 0.25 % (the Poisson noise of the events). The cost: the late phase of a run is about 50 % dearer (all the particles stay live: 15.6 to 23.3 ms per frame at 400,000 particles, 27.0 to 41.8 ms at 1,000,000, on a GPU in its P5 state), the worst frame of the periodic readings is five to eight times shorter (65 to 8 ms over the median at 400,000 particles, 135 to 26 ms at 2,000,000), and the first-visit benchmark's cap is the same (580,000 particles) when the early frames cost the same, [the spike](spikes/a4-constant-mass-fusion.md) says what it would be if they did not.

### Calibration for the thin-disc cooling (headless Chrome, GTX 1060, 1024 × 768 px area, 400,000 particles)

Phase P4 ([the spike](spikes/a6-a13-cooling-and-jeans.md)): c = 10 /s and κ = 20 (c/κ = 0.5), T_min = 0.05 T₀ (inert in the default cloud), and **λ₀ 4e-3 → 2e-3, feedback 0.146 → 0.3**, which keep the first collapse's burn where it was (46 % of the hydrogen with λ₀ at 4e-3). Twelve seeds, 34 s: the first collapse burns 33.5 % of the hydrogen (35 % before) in a burst of 510,000 fusions per second (870,000), burning resumes at 10.3 s after the bounce (5.2 s before), the hydrogen burns at 27 MK (weighted by the heating; 20 MK before), the helium flash comes in twelve seeds of twelve at 20.5 s (19.1 s), and carbon holds 76 % of the mass at the end (69 %). The He/H ignition ratio of the A2 reference (20 ρ₀, 0.1 per second) is 5.2 (6.3 with λ₀ = 4e-3; real 6.67). A decade of λ₀ moves the burning temperature by +95 % / +5 % around the default (old law: −37 % / +16 %): the plan's "a few percent" is not met by either. The cost is not measurable (whole frame 9.46 ms against 9.59 ms at 400,000 particles).

### Calibration before the grids (headless Chrome, GTX 1060, 1180 × 726 px area, 30,000 particles)

Historical: the calibration of the earlier model (other defaults, temperature as a dispersion alone), kept for what it says of the roles of the parameters. Times are simulated; they do not depend on the speed slider.

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

- 2D, with a 1/r² (3D) gravity law in the plane; softening at least equal to one cell (with `adaptiveThickness`, the layer's thickness, which assumes a vertical dispersion equal to the planar one and holds no vertical energy).
- The « temperature » is measured over a 3 × 3 cell neighborhood: a convergent infall at this scale partly counts as heat.
- Cooling is the thin-disc law of each column (local Σ, constant opacity κ, no Kramers term), not a radiative transfer; there is no line cooling, so a cold envelope barely radiates.
- Feedback is isotropic (heat), without explicit radial push: pressure comes from agitation.
- Without the `collisions` flag there is no thermal pressure of a fluid: the particles stream through each other (no shock, an anisotropic pressure), and without agitation nothing resists compression. With it the gas is an ideal gas of γ = 2 (strictly planar), its particles of equal mass share one dispersion rather than one temperature per atom (no sedimentation of the heavier ions), and its velocity distribution relaxes slowly where cells hold many particles.
- The correction of the noise of T assumes independent particles with Maxwellian velocities, hence a Gamma law for T, with an effective number of particles calibrated on a uniform gas ([the lab measures it](spikes/a5-a3-heating-and-t-noise.md)); it knows nothing of correlations between neighborhoods or of collective motion. The average of T over time adds a delay of τ = 0.1 s to the thermostat and is not credited in the correction.
- **The ratio of the two ignition temperatures depends on where it is read.** With the Gamow laws and the calibrated λ, two pure gases of 20 ρ₀ fuse 0.1 times per second at 15.9 MK (hydrogen) and 100 MK (helium): 6.3, the real ratio being 6.67. At another density or rate it moves, because the two laws differ in steepness and in density exponent (1 and 2): 7.25 at 40 ρ₀ (the density of a settled core), 4.1 to 10.9 over 20 to 100 ρ₀ and 0.03 to 0.5 per second. The real ratio is a property of the real densities and rates, which the model does not have.
- The proton-proton law is kept at all temperatures; at 50 MK, a real star would burn hydrogen through the CNO cycle (around T¹⁷).
- The density of the laws is the surface density Σ (the cloud has a fixed thickness), where the real rates are volumetric (a later phase, A11, will use Σ / (2h)). Carbon burning (about 600 MK) is out of scope: nothing burns the carbon here, and the ash simply reads 3.4 times its dispersion, 100 to 160 MK in the default cloud.
- Only ¹²C is formed: no C + He → O, no electron degeneracy, hence no helium flash.
- A parcel fuses all at once (a Bernoulli draw of probability p per step), where a real gas converts a continuous share of its atoms: the number of events per step is Poisson, and the composition of the cloud follows the draws, not a smooth law. The energy, on the other hand, is deposited at the expected rate, and agrees with the mass that changes type to the first order in rate·Δt ([the spike](spikes/a4-constant-mass-fusion.md)).
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
