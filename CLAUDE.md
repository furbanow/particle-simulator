# particle-simulator

Local TypeScript web application (Vite + Three.js 0.169, WebGL2): a multi-species GPGPU particle simulator with gravity, supernovae and HDR rendering. It originates from the POC `particule-system.0005.html`.

## Commands

- `make dev`: development server at http://localhost:5173
- `make check`: type checking and tests. Run after every change.
- `make build`: production build in `dist/`

## Organization

- `src/config.ts`: all constants. No magic numbers in the rest of the code.
- `src/simulation/`: physics (GPGPU, density field, cluster detection, shock wave). No DOM access.
- `src/render/`: rendering layers and post-processing.
- `src/ui/`: side panel, element bar at the top of the page (`elementBar.ts`) and statistics overlaid on the animation at the bottom right (`stats.ts`). They communicate with the simulation through its public properties and through the `onSupernova` / `onConcentration` callbacks.
- `src/elementConfigs.ts`: element configurations in `localStorage`. A configuration is applied by mutating in place the objects of `simulation.species` (they are shared by reference with the UI); any JSON read back goes through `sanitizeConfig()`.
- `src/simulationConfigs.ts`: whole-simulation configurations in `localStorage` (algorithm, parameters, elements, shared sliders). Elements read back also go through `sanitizeConfig()`. Values are kept as the panel rounds them (`panelParamValue`); otherwise a configuration would appear modified as soon as it is loaded. The shared sliders are speed (`index.html`) and visual effects.
- Side panel: each parameter declares its tab (`tab`, one of `PANEL_TABS` in `src/simulation/algorithm.ts`) and its documentation shown on hover (`doc`, mandatory). `ParamPanel` builds everything from these declarations: a tab appears only if it contains a parameter, and only the `initial` tab waits for a restart (`appliesOnRestart`). Visual effects, common to all algorithms, are declared the same way in `src/visualEffects.ts` and applied to rendering in `src/ui/controls.ts`.
- `src/ui/configPicker.ts`: tools for a list of configurations (load, new, duplicate, rename, delete, save), shared by the element bar and the panel.
- `src/shaders/*.vert|.frag`: GLSL imported with `?raw`. Constants come from `config.ts` and are injected by `withDefines()` (`src/gl/withDefines.ts`); do not copy them by hand into the shaders.
- Several materials share the same uniform object (`screenSize`, `speciesUniforms`, `texturePosition`, …). This sharing by reference must be kept, because it is what keeps the density splat, the particles and the nebula in sync.
- `src/styles/`: one CSS file per component; theme variables are in `tokens.css`.
- Pure logic (concentration, masses, colors, distribution, configurations) is separated from the DOM and tested in `tests/`.

## Conventions

- UI texts in French.
- Code comments in English, as in the existing code.
- Strict TypeScript: no `any`.
