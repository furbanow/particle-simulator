# Contributing to Particle Simulator

Thank you for your interest! Bug reports, ideas, translations, new algorithms and fixes are all welcome. By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License and CLA

The project is distributed under the [GNU AGPL v3 or later](LICENSE). The author also offers a **commercial license** to those who cannot use the AGPL (see the [README](README.md#license)). To make that possible, every contributor must sign the [Contributor License Agreement](CLA.md) once.

- You **keep your copyright**; the CLA only grants the project the right to redistribute your work, also under other licenses.
- A bot asks you to sign in your first pull request; it takes one comment.
- A pull request cannot be merged before the CLA is signed.
- If you contribute for an employer or a school that may own your work, contact furbanow@gmail.com first.

Only submit code you wrote yourself or whose license allows redistribution under these terms (state the source and license in the pull request). Do not paste code from Shadertoy, Stack Overflow, AI tools with unclear terms or any source without a compatible license.

## Getting started

```sh
make install   # npm dependencies
make dev       # development server at http://localhost:5173
make check     # type checking + tests: run it after every change
```

Node.js ≥ 18 and a WebGL2 browser are required. The architecture is described in [CLAUDE.md](CLAUDE.md) (organization of `src/`) and [docs/algorithms.md](docs/algorithms.md).

## Workflow

1. Open an issue first for anything bigger than a small fix, to agree on the approach.
2. Fork, then create a branch from `master`.
3. Make a focused change, with tests for pure logic (in `tests/`).
4. Run `make check`, and `make build` if you touched the build or the shaders.
5. Open a pull request using the template; describe what changes and why, with a screenshot or a short capture for visual changes.

## Conventions

- **Strict TypeScript**: no `any`.
- **No magic numbers**: constants live in `src/config.ts`; GLSL constants are injected with `withDefines()`, never copied by hand.
- **No user-visible text in the code**: add a key to **every** catalog in `src/i18n/locales/` (English first, then fr, de, pl, es) and use `t()`. Do not concatenate translated words; use placeholders. If you do not speak a language, provide your best attempt and say so in the pull request: a missing key fails `make check`.
- Code, comments, identifiers and error messages are in English.
- Physics code in `src/simulation/` does not touch the DOM.
- Each side-panel parameter declares its tab and a mandatory documentation (`doc`) shown on hover.
- Keep the shared uniform objects shared by reference (see `CLAUDE.md`).
- One CSS file per component in `src/styles/`.

## Reporting bugs and security issues

Use the issue templates. Include your browser, GPU and the algorithm and parameters involved. For a security problem, email furbanow@gmail.com instead of opening a public issue.

## What is likely to be accepted

- Fixes, performance improvements, accessibility and compatibility across browsers and GPUs.
- Translations (new languages included).
- New algorithms, presets and visual effects that fit the existing declaration system.

Large changes of direction, new dependencies or heavy refactors need an issue and agreement beforehand. The maintainer reviews on a best-effort basis.
