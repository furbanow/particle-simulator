# particle-simulator

Local TypeScript web application (Vite + Three.js 0.169, WebGL2): a multi-species GPGPU particle simulator with gravity, supernovae and HDR rendering.

Currently deployed at https://furbanow.github.io/particle-simulator/

## Commands

- `make dev`: development server at http://localhost:5173
- `make check`: type checking and tests. Run after every change.
- `make build`: production build in `dist/`

## Organization

- `src/config.ts`: all constants. No magic numbers in the rest of the code.
- `src/i18n/`: internationalization (en, fr, pl, de, es). `locales/en.ts` is the source catalog and defines `MessageKey`; the other catalogs are `Record<MessageKey, string>`, so a key missing from a language fails `make check`. Texts come from `t(key, params)` (`{name}` placeholders), numbers from `formatNumber()`. The language (saved preference, else browser language, else English) is fixed at load, so declarations call `t()` at import time; changing it in the settings dialog reloads the page. The static page uses `data-i18n*` attributes (`applyStaticTranslations()`), with English fallback text in `index.html`. Tests run in English (`tests/setup.ts`).
- `src/simulation/`: physics (GPGPU, density field, cluster detection, shock wave). No DOM access.
- `src/render/`: rendering layers and post-processing.
- `src/ui/`: side panel, element editors (`elementsQuickPanel.ts`: simple editor in the panel's Elements tab, with number of elements, color, atomic mass and size of each; `elementBar.ts`: advanced editor with one chart per property, configs and element editor, shown in the large semi-transparent modal `#elements-modal` opened by the "Advanced…" button; `modal.ts`: overlay closed by the cross, a click outside or Escape) and statistics overlaid on the animation at the top right (`stats.ts`); the author overlay sits at the bottom left (`index.html`, `author.css`). They communicate with the simulation through its public properties and through the `onSupernova` / `onConcentration` callbacks.
- `src/elementConfigs.ts`: element configurations in `localStorage`. A configuration is applied by mutating in place the objects of `simulation.species` (they are shared by reference with the UI); any JSON read back goes through `sanitizeConfig()`.
- `src/simulationConfigs.ts`: whole-simulation configurations in `localStorage` (algorithm, parameters, elements, shared sliders, drawing settings). Elements read back also go through `sanitizeConfig()`. Values are kept as the panel rounds them (`panelParamValue`); otherwise a configuration would appear modified as soon as it is loaded. The shared sliders are speed (`index.html`) and visual effects.
- Side panel: each parameter declares its tab (`tab`, one of `PANEL_TABS` in `src/simulation/algorithm.ts`) and its documentation shown on hover (`doc`, mandatory). `ParamPanel` builds everything from these declarations: a tab appears only if it contains a parameter (or extra content, such as the drawing tab), and only the `initial` tab waits for a restart (`appliesOnRestart`). Visual effects, common to all algorithms, are declared the same way in `src/visualEffects.ts` and applied to rendering in `src/ui/controls.ts`.
- Static drawings (attractors and repellers), common to every algorithm: settings declared in `src/drawing.ts` (tab `drawing`; each kind has its own parameters, keys prefixed `attractor.` / `repeller.`; the old `darkMatter` config key is read as the attractor), pure mask helpers in `src/drawingMask.ts`, mass grids and GPU fields in `src/simulation/drawing/` (owned by `Simulation`, it outlives the pipelines), tab and mouse drawing in `src/ui/drawingPanel.ts` and `src/ui/drawing/maskCanvas.ts` (one mask per kind). Every GPU model's velocity shader must include `drawing.glsl` and add `drawingAccel(pos)` (see `GpuModelContext.drawing`). The full-grid passes (`GridPass`) are in `src/gl/gridPass.ts`, shared with the protostar.
- GPU benchmark: on the first visit (no `particleCap` in the display settings, `src/displaySettings.ts`; it then replaces the initial restart) or from the settings dialog, `src/benchmark/runner.ts` runs the frames of `BENCHMARK_ALGORITHM` at its default parameters and speed (`Simulation.borrowAlgorithm()`), one per animation frame as the frame loop does, and times the intervals between animation frames (no GPU synchronization is reliable across browsers). `src/benchmark/estimate.ts` (pure, tested) picks the counts to try (geometric search; above the running count, frames are repeated instead of restarting) and the cap: the largest count keeping `BENCHMARK_TARGET_FPS`, all within `BENCHMARK_DURATION_MS`. The cap (`Simulation.setParticleCap()`) bounds the count parameter of every algorithm through `Simulation.paramDefs`, which the panel reads instead of the declaration; the user may raise it in the settings up to `PARTICLE_CAP_RANGE`.
- `src/ui/configPicker.ts`: tools for a list of configurations (load, new, duplicate, rename, delete, save), shared by the element bar and the panel.
- `src/shaders/*.vert|.frag`: GLSL imported with `?raw`. Constants come from `config.ts` and are injected by `withDefines()` (`src/gl/withDefines.ts`); do not copy them by hand into the shaders.
- Several materials share the same uniform object (`screenSize`, `speciesUniforms`, `texturePosition`, …). This sharing by reference must be kept, because it is what keeps the density splat, the particles and the nebula in sync.
- `src/styles/`: one CSS file per component; theme variables are in `tokens.css`.
- Pure logic (concentration, masses, colors, distribution, configurations) is separated from the DOM and tested in `tests/`.

## Conventions

- No user-visible text in the code: add a key to every catalog in `src/i18n/locales/` (English first, then fr, de, pl, es) and use `t()`. Do not lowercase or concatenate translated words: use a message with placeholders.
- Code, comments, identifiers and internal error messages in English, as in the existing code.
- Strict TypeScript: no `any`.
