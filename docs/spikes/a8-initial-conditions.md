# Spike A8: initial conditions consistent with the disc

Phase P5b of the improvement plan (proposal A8). The protostar's cloud is a flat disc, but its initial velocities were computed as for a sphere:
the tangential speed came from the mass enclosed by the radius, `v^2 = G M_enc(r) / r`, which for a disc is wrong at every radius. This document
records what the disc's own pull is, how the cloud is now built from it, what the new sliders mean, and what the lab measured. The numbers are in the
last sections; the code is `src/simulation/protostar/disc.ts`, `initialConditions.ts`, `turbulence.ts` and `toomre.ts`.

## The disc's pull

For a disc of radius R, total mass M and a surface density that depends on the radius alone, the in-plane pull on a particle at radius r under the
Plummer-softened force of the simulation (`G m d / (d^2 + eps^2)^(3/2)`) is the sum over rings of radius `a`:

    g(r) = G M integral_0^R p(a) g_ring(r, a) da          p(a) da = the share of the mass in the ring [a, a + da]
    g_ring(r, a) = [ (r^2 - a^2 - eps^2) I3 + I1 ] / (2 pi r)
    I1 = 2 K(m) / sqrt((r + a)^2 + eps^2)                  I3 = 2 E(m) / ( ((r - a)^2 + eps^2) sqrt((r + a)^2 + eps^2) )
    m  = 4 r a / ((r + a)^2 + eps^2)

(K and E are the complete elliptic integrals; the potential of a ring is `-G I1 / pi` per unit mass). The angular integral being closed, what is left
is one-dimensional: `buildDiscTable()` integrates over `a` with 8-point Gauss-Legendre rules on panels that are graded geometrically towards the
two places where the integrand is not smooth, `a = r` (a logarithmic peak of width eps) and, for the Maclaurin profile, the edge `a = R` (a square
root), at 257 nodes `r_j = R j / 256`: about 110 000 ring evaluations, 5 ms. The table gives the pull `g(r_j)` and the potential `Phi(r_j)`;
`U = (1/2) integral Phi dm` and the energy of circular motion `(1/2) integral r g dm` follow by Simpson's rule. The plan's "1.6 million evaluations" is
the same computation by a two-dimensional quadrature; the elliptic integral does the angular half exactly.

Closed forms the tests check it against: the uniform disc's potential `Phi = -4 G Sigma R E(r/R)` and pull `g = 4 G Sigma (K - E) / (r / R)` in the plane,
`U = -8 G M^2 / (3 pi R)`; the Maclaurin disc's linear pull `g = (3 pi / 4) G M r / R^3` and `U = -3 pi G M^2 / (10 R)`.

A property worth knowing: the pull at the edge of the uniform disc is infinite (logarithmically) without softening, so the circular speed of the
uniform disc near its rim is set by eps; a disc of Maclaurin's profile has none of it.

## The disc against the sphere formula

The cloud before this phase set the tangential speed to `0.44 v_sph(r)`, `v_sph^2 = G M_enc(r) r^2 / (r^2 + eps^2)^(3/2)`, with the mass inside r
taken from the rank of the particle. For the uniform disc the true pull is not the one of the enclosed mass: the disc's circular speed over the sphere's
(table of the default cloud, G = 9, L = 768 px, eps = 1.6 % L = 12.3 px, R = 0.38 L = 291.8 px) is

| r / R | 0.05 | 0.07 | 0.1 | 0.2 | 0.33 | 0.5 | 0.8 | 1 |
|---|---|---|---|---|---|---|---|---|
| v_disc / v_sphere | 0.33 | 0.33 | 0.36 | 0.47 | 0.59 | 0.75 | 1.07 | 1.44 |

so the sphere formula over-rotated the inner disc by up to 3 times (`1 / 0.333` near 0.07 R) and gave 0.69 of the true speed at the edge, which is the
professor's figure (`tests/disc.test.ts` pins both). The agitation was a fraction of `v_sph(R)`: the disc's circular speed at the edge is 1.44 times that
(so the temperature of the same slider would have been 2.07 times higher).

## The sliders

`rotation` and `agitation` are replaced by two energies, in units of |U| (the potential energy of the disc: -0.809 G M^2 / R for the uniform disc at the
default softening, -0.847 without, -3 pi / 10 = -0.942 for the Maclaurin disc):

- `alphaVir` = 2K/|U| (0 to 3, step 0.01, default 0.33): the whole kinetic energy, K = (alpha / 2) |U|;
- `betaRot` = E_rot/|U| (0 to 0.5, step 0.01, default 0.08): the rotation, `E_rot = (1/2) sum m v_t^2`, `v_t = f v_circ(r)` with one `f` for every radius,
  `f = sqrt(beta |U| / K_circ)`. A cloud on circular orbits has `beta = K_circ / |U|` = 0.477 at the default softening (0.5 for a force with no scale): the
  slider's maximum is 0.5, and 0.48 is 1.003 times the circular speed.

The agitation has the energy `(alpha / 2 - beta) |U|`, `sigma^2 = (alpha / 2 - beta) |U| / M` per component. If `beta > alpha / 2` the rotation takes all the
energy and the virial ratio becomes `2 beta` (the doc of the slider says so). Both energies are those of the particles drawn: the noise is rescaled to its
exact variance, and has no part along the rotation's pattern (the projection on `v_circ(r) t` is taken off), so the two energies add with no cross term.
`|U|` is the continuous disc's, from the table; the cloud's own differs from it by the Poisson noise of the positions, 1/N.

**The old defaults on the disc.** The old recipe (`rotation` 0.44, `agitation` 0.26, sphere formulas) evaluated against the disc's table gives
`alpha = 0.325`, `beta = 0.079` (the professor's 0.33 and 0.08: a rounding, 0.325 sits on the edge of 0.32 and 0.33); the defaults are 0.33 and 0.08. At 400 000
particles, seed 20240611 (G = 9, L = 768 px, mass units of the simulation, `|U|` = 2.261e8 mass px^2/s^2):

| | K | E_rot | agitation K - E_rot | 2K/\|U\| | E_rot/\|U\| |
|---|---|---|---|---|---|
| before (sphere formulas) | 3.681e7 | 1.788e7 | 1.893e7 | 0.326 | 0.079 |
| after (alpha 0.33, beta 0.08) | 3.731e7 | 1.809e7 | 1.922e7 | 0.330 | 0.080 |
| ratio | 1.014 | 1.012 | 1.015 | | |

The distribution over the radius is not the same: the rotation of the new cloud is solid-body in the center (f v_circ ~ r) and the agitation is the same at
every radius in both (a constant sigma: 31.0 px/s). The initial Toomre Q, measured on the particles in 40 rings with the stellar criterion 3.36
(`measureToomre`): the default cloud has Q = 0.19 to 0.25 from 0.25 R to 0.75 R and about 0.35 at 0.94 R, the cloud before 0.33 at 0.3 R falling to 0.18 at 0.94 R: the sphere
formula made Q 1.6 times too high at 0.3 R, 1.3 times at 0.43 R and 0.5 times as high at 0.94 R (the professor: 1.5 to 3 times too high in the inner third; the ring
nearest the center is too noisy to say). The cloud is Toomre-unstable at every radius (Q < 1), by a factor 3 to 5, with either formula: that is the instability
that fragments it.

## The Maclaurin profile and its cold collapse

`profile = maclaurin` draws the radii from `1 - (1 - r^2/R^2)^(3/2)` (the mass inside r) and the surface density falls as `sqrt(1 - r^2/R^2)`. Its in-plane
pull is linear up to the edge, `g = (3 pi / 4) G M r / R^3` (the table reproduces it to 0.5 % at a softening of 2e-4 R, `tests/disc.test.ts`), so a cold disc falls in
homologously: its radius obeys `a'' = -(3 pi / 4) G M / a^2`, the radial fall onto a point of mass `3 pi M / 4` from rest at R, whence

    t_ff = (pi / 2) sqrt(2 R^3 / (3 pi G M)),        t(a) = (2 t_ff / pi) [ arccos sqrt(x) + sqrt(x (1 - x)) ],   x = a / R

(`maclaurinFreeFallTime`, `maclaurinFallShare`, tested against a Verlet integration of the ODE). With `G M = G_slider * 0.001 * L^3` (the units of the
simulation: `G_eff = G_slider * PROTOSTAR_GRAVITY_UNIT * L^3 / TOTAL_MASS` and the cloud's mass is `TOTAL_MASS`) and L = 768 px, R = 291.84 px, G = 9:
`G M = 4.0769e6 px^3/s^2` and `t_ff = 1.787 s`.

**The lab** (`protostar.maclaurin-collapse`): 400 000 particles, `alphaVir = betaRot = 0`, cooling, feedback and fusion off, a softening of 0.1 % L (0.77 px, a
tenth of a cell of the gravity grid), no `endFrame` (no drift correction), the half-mass radius (the median distance to the centre of mass) read
back every frame. The time at which it falls to a fraction x of its initial value gives an estimate of the free-fall time through the analytic
trajectory, `t_est = t(x) / share(x)`:

| fraction x of the initial half-mass radius | 0.75 | 0.5 | 0.25 | 0.1 |
|---|---|---|---|---|
| time of the crossing (s) | 1.102 | 1.487 | 1.723 | 1.806 |
| t_est / t_ff | **1.0125** | **1.0169** | 1.0233 | 1.0251 |
| the softening of the slider alone (CPU, table of the softened disc) | 1.0022 | 1.0024 | 1.0026 | 1.0028 |
| with the grid's own smoothing (2.4 px, below) | 1.0069 | 1.0074 | 1.0080 | 1.0087 |
| residual of the run over that prediction | +0.55 % | +0.94 % | +1.5 % | +1.6 % |

The runs at two time steps (14.2 ms substeps, 2 per frame; and 1 per frame at speed 0.85) give the same estimates to 1e-4 (1.0233, 1.0233 at 0.25): the step is
not what is left. **The 2 % target is met for the first half of the fall (1.25 % and 1.7 % at x = 0.75 and 0.5) and missed after it (2.3 % and 2.5 % at 0.25
and 0.1); the collapse is always slower than the analytic one**, by an amount that grows as the cloud shrinks. What enters:

- **Units of G and M**: none, `G M` is exact (the grid's pull at t = 0 matches the table's to 0.5 % on average, `protostar.initial-grid-force`).
- **The slider's softening** (0.77 px here; 12.3 px at the default 1.6 %) weakens the pull of the disc near its edge (a Plummer softening of a flat disc takes `2 pi G eps Sigma'(r)` off the
  pull): +0.22 to 0.28 % of time, negligible next to the rest. At the default softening it would be 6 % on the pull at R/2 (1.105 against 1.178 G M / R^2) and 3 % in time.
- **The grid**: the gravity grid (cells of 8 px, the loop of two levels, bilinear interpolation of the cells' accelerations) smooths the force by about a cell and
  does not know the slider's softening below it. Its pull at t = 0 over the linear one is 1.066 at 0.13 R, 1.018 at 0.25 R, 1.00 from 0.33 to 0.45 R, 0.98 from
  0.5 to 0.9 R and 0.966 at 0.94 R; the Plummer length at which the table of the disc best fits it (0.1 to 0.95 R) is 2.4 px, and the free fall of the half-mass
  radius under that softened disc is 0.7 to 0.9 % slower than the analytic one. That leaves **+0.55 % at the start of the fall and +1.6 % at the end**
  unexplained; they grow when the half-mass radius is less than about 6 cells (x < 0.3), where the grid's smoothing is no longer a Plummer length (the pull at
  the inner rings is above the table's, then below it); the particles' own discreteness (Poisson noise, which seeds clumps in a cold collapse) was not isolated.
- A finer gravity grid, or the refinement of the core that the plan assigns to a later phase, is what would take the late residual away; nothing in the
  initial conditions can, since the cloud is exactly the profile the formula is for (the positions are drawn from its radial law and the energies from its table).

## The grid's pull against the table at t = 0

`protostar.initial-grid-force`: the acceleration texture after the first substep (it holds `a(x_0)`, the pull at the positions of the start) of 400 000 particles at
the default softening, in 60 rings of equal numbers of particles, against `discAcceleration()` at the same particles. Between 0.1 and 0.95 R:

| | mean ratio | median ring error | worst ring | tangential part of the pull |
|---|---|---|---|---|
| uniform disc | 1.005 | 0.5 % | 5.1 % (the ring at 0.16 R: 1.051; 0.987 R: 0.983) | 0.1 % |
| Maclaurin disc | 1.001 | 0.5 % | 3.5 % (the ring at 0.13 R: 1.035) | 0.1 % |

so the table that fixes the circular speed is the pull the grid gives, to the grid's accuracy: 1 to 2 % from 0.2 to 0.95 R, up to 5 % in the inner 0.2 R (the
grid's 8 px cell against `r = 0.15 R = 44 px`; the tolerance of the scenario is 6 %). A cold cloud given exactly the circular speed of the table therefore
rotates at the circular speed of the grid to about 1 %.

## The energies the sliders ask for

`protostar.initial-conditions`: ten clouds of 400 000 particles, the energies read at t = 0 (the reduction of the grids: `K` of the velocity texture, `U` of the gravity grid with the
self term removed; `drawAndReduce`), against the slider and the table (`2K/|U|` from the grid, from the table; `E_rot` along the pattern `v_circ(r)` and as the mean tangential speed in 60 rings):

| cloud | alpha, beta asked | 2K/\|U\| (grid) | E_rot/\|U\| (pattern; rings) | U grid / table |
|---|---|---|---|---|
| default | 0.33, 0.08 | 0.330 | 0.0800; 0.0800 | 0.999 |
| circular orbits | 0.96, 0.48 | 0.961 | 0.4800; 0.4798 | 0.999 |
| virial 1, no rotation | 1, 0 | 1.001 | 0; 0 | 0.999 |
| virial 1, rotation 0.25 | 1, 0.25 | 1.001 | 0.2500; 0.2499 | 0.999 |
| hot | 2, 0.1 | 2.002 | 0.1000; 0.1001 | 0.999 |
| default, correlated | 0.33, 0.08 | 0.330 | 0.0800; 0.0932 | 0.999 |
| virial 1, correlated | 1, 0.25 | 1.001 | 0.2500; 0.2889 | 0.999 |
| Maclaurin | 0.33, 0.08 | 0.330 | 0.0800; 0.0800 | 0.999 |
| Maclaurin, correlated | 0.33, 0.08 | 0.330 | 0.0800; 0.0972 | 0.999 |
| cold | 0, 0 | 0 | 0; 0 | 0.999 |

The virial ratio the reduction reads matches the slider to 0.2 % (the gravity grid's `|U|` is 0.1 % under the table's: the grid does not resolve the pairs closer than a cell,
the self term is subtracted, and the table is a continuum), the tolerance of the scenario is 1 %. The rotation along the pattern is exact; the *mean tangential
speed in rings* of a correlated cloud is 16 to 18 % higher in energy, because the turbulence has its own swirl at each radius (the pattern's part is removed, the
rings' is not: it is what a few large eddies are).

## The correlated agitation

**Design.** A Gaussian, periodic, solenoidal velocity field on a 64 x 64 grid that spans the cloud's diameter (cells of R / 32 = 9 px), made at restart by FFT
(`turbulence.ts`): white noise in real space (so that the field is real), filtered in Fourier space by `k^-(n+2)/2` for the stream function, and `v = (d psi / dy, -d psi / dx)`, so
that the power per mode is `P(k) = <|v(k)|^2> ~ k^-n` with **n = 3** for the wave numbers `1 <= |k| <= 8` (in units of the box's fundamental one; wavelengths from the diameter to
8 cells: the bilinear sampling keeps the shortest to 8 % of the amplitude) and zero outside. The decisions:

- **Solenoidal, not compressive**: a divergence-free flow adds no radial infall or expansion, so it does not rearrange the density at t = 0 and its energy stays "agitation"; a compressive part
  would be a radial flow the slider `betaRot`/`alphaVir` would not describe. Real turbulence has both; the curl is the simpler.
- **n = 3 per Fourier mode of the plane**, i.e. `E(k) = 2 pi k P(k) ~ k^-2` per wave number: the supersonic, shock-dominated turbulence of molecular clouds (Larson's `v ~ l^(1/2)`);
  Kolmogorov's `E ~ k^(-5/3)` would be `n = 8/3` (`PROTOSTAR_TURBULENCE_SLOPE`).
- **Normalisation**: the field is sampled at the particles, its mean taken off, the part along the rotation's pattern taken off, and it is scaled so that its rms per component is exactly the
  `sigma` the virial ratio asks for. Deterministic given the `random` stream (the same one that draws the positions, called after them), so the lab's seed replays it.
- **Tested** (`tests/turbulence.test.ts`): the realised power per mode, averaged over 30 fields, falls as `k^-n` to 0.1 in the exponent for n = 2, 3, 4 (a single field fluctuates: a few modes carry most of
  it); unit rms and zero mean; zero divergence and no power outside the band to 1e-9; the 2D FFT; periodic bilinear sampling. In `fillCloud`: neighbours' velocities correlate to > 0.9 (white: < 0.1),
  rms and momentum.

**Default.** White noise stays the default. The correlated cloud at the same energies is not the same cloud: the gas pass reads the temperature as the dispersion about the mean velocity of a
3 x 3 neighbourhood of cells of 8 px (24 px), and a flow whose shortest wavelength is 73 px is a mean velocity, not a temperature; the initial gas has next to no pressure and falls in
harder (table below: the first collapse's burst is 3 to 10 times that of the white cloud, at 48 to 116 MK, and in seed 11 the helium flash, 3 000 carbons, comes at 3.1 s, during the first collapse). Making it the default
would need its virial ratio and cooling re-tuned (phase A2 recalibrates the fusion laws and is the place), so the option is offered and the default keeps today's behaviour.

## The default cloud, before and after

`baseline.protostar.default-cloud-tuning`, 400 000 particles, 1 200 frames (34 s), seeds 20240611 to 20240613, the GPU above. "before" is `da1473c` (the build of the improvements branch before this
phase) served from another directory; it reproduces the P5a table of [lab-baseline.md](../lab-baseline.md) to the digit (hydrogen left 219, 51, 459; helium / carbon 61 723 / 12 750, 1 505 / 32 558, 67 684 / 10 737).
The series have 60 points (0.57 s each).

| three seeds | before | **after, white (the default)** | correlated |
|---|---|---|---|
| peak density of the first collapse (rho0) | 25.7, 25.8, 26.7 | **30.2, 28.3, 31.5** | 21.6, 26.8, 29.5 |
| peak fusion rate of the first burst (per s), time | 43 000, 43 900, 43 400 at 3.1 s | **32 000, 30 400, 33 500** at 2.55 s | 200 000, 297 500, 104 700 at 3.1 s |
| core T at that burst (MK) | 19, 19, 21 | **23, 22, 26** | 116, 71, 48 |
| hydrogen burnt by 4.5 s | 30, 29, 31 % | **37, 36, 37 %** | 58, 44, 36 % |
| core T, 8 to 12 s (MK) | 14.2, 16.5, 19.8 | **10.2, 13.8, 19.6** | 38.7, 25.3, 15.1 |
| hydrogen below 20 000 at (s) | 21.5, 18.7, 22.1 | **24.4, 22.7, 18.7** | 19.8, 18.1, 18.1 |
| carbon above 10 000 at (s) | 34.0, 27.8, 31.7 | **27.8, 24.9, not reached (8 236 at 34 s)** | 15.0, 21.5, not reached |
| highest core T (MK) | 114, 214, 114 | **219, 259, 147** | 229, 128, 149 |
| hydrogen / helium / carbon at 34 s | 219 / 61 723 / 12 750; 51 / 1 505 / 32 558; 459 / 67 684 / 10 737 | **62 / 196 / 33 443; 210 / 3 638 / 32 056; 1 096 / 75 082 / 8 236** | 101 / 637 / 33 137; 146 / 43 699 / 18 926; 527 / 76 489 / 7 976 |

The shift of the default (white) is in the first collapse and it is the same in three seeds out of three: the cloud is 10 to 20 % denser at its first peak, burns earlier (the burst at 2.55 s, not 3.1 s)
and 25 % lower (32 000 against 43 000 per second), at a core 3 to 5 MK hotter, and has burnt more of its hydrogen by 4.5 s (37 % against 30 %). The likely cause, not isolated by a run of its own, is the new rotation profile (the inner disc rotates less than a third as fast at 0.07 R, 0.55 as fast at 0.33 R, 1.0 at 0.8 R and 1.34 times as fast at the edge: less centrifugal support in the
center) and a 1.5 % larger agitation; the energies are within 1.4 % of the old ones. After the first collapse the history is the chaotic one of before (hydrogen
exhausted at 19 to 24 s against 19 to 22 s, carbon of the same order, last-quarter temperatures 58 to 161 MK against 52 to 148): the star behaves, hydrogen burns at 10 to 20 MK, helium ignites at 100 to
260 MK and turns to carbon, no runaway; nothing was retuned.

## The other lab scenarios on the new cloud

On the new default cloud (the same session, the GPU shared with other runs): `lab.selftest` passes (9 checks); `protostar.integration` passes (worst error 1.2e-4 px and 9.1e-5 px/s);
`protostar.energy-reference` passes (K 2.4e-7, U to the twin 1.7e-7, to the pair sum 0.15 %); `baseline.protostar.energy-drift` is a `skip` only because 95 of the 100 orbits fit its
wall-clock budget (the GPU was shared): the default cloud's K + U drifts by -0.17 % at 95 orbits (largest excursion 0.80 % in the first collapse, no slope after settling) against -0.13 % and
0.71 % before; the cold cloud on circular orbits (`alphaVir 0.96`, `betaRot 0.48`) 0.09 % after 19 orbits (largest 0.52 %, against 0.72 %); the application's walls take 13.8 % in 16 orbits (15.3 % before).

## What it costs at restart

The plan feared a slower restart (table and field); it is faster, because the cloud no longer sorts the particles by radius (the rank gave the enclosed mass).

| ms | 400 000 | 1 000 000 | 2 000 000 |
|---|---|---|---|
| `fillCloud` before (Node, the old module) | 368 | 1 063 | 2 221 |
| `fillCloud` now, white, uniform (Node) | 202 | 459 | 907 |
| `fillCloud` now, correlated (Node) | 145 | 325 | 631 |
| `fillCloud` now, Maclaurin, white (Node) | 208 | 487 | 964 |
| `fillCloud` now, white, in the browser (`protostar.initial-cost`) | 194 | 499 | 987 |
| `fillCloud` now, correlated, in the browser | 144 | 326 | 680 |
| the whole restart, `Simulation.reset`, before (`perf.protostar.restart`, median of 5, `da1473c`) | 487 | 1 154 | 2 388 |
| the whole restart, now (the same scenario, default parameters) | **305** | **629** | **1 047** |

The table is 4.4 ms (uniform) and 7.1 ms (Maclaurin) in the browser (4.9 and 6.5 ms in Node), the FFTs of the correlated field about a millisecond; both are paid once per restart and do not
depend on the number of particles. The Node figures are from a machine whose CPU the lab's browser was sharing (read the ratios); the whole restart includes the upload of the state to the GPU.

## Parameters, tests

- Removed `rotation` and `agitation`; added, in the `initial` tab (the only one that waits for a restart), `alphaVir` (0 to 3, default 0.33), `betaRot` (0 to 0.5, default 0.08), `profile`
  (`uniform` | `maclaurin`) and `turbulence` (`white` | `correlated`), each with its `doc` and a label in the five catalogs. A configuration saved before loses `rotation` and
  `agitation` and gets the defaults of the four new ones (`sanitizeSimulationConfig` builds the parameters from the declaration: tested in `tests/simulationConfigs.test.ts`); an
  invalid choice or an out-of-range number falls back to the default or the nearest bound.
- `enclosedMassFractions`, `circularSpeed` and `softenedPull` (the sphere formulas) are gone from `initialConditions.ts`; the lab keeps the point-mass law only as its unit of time
  (`orbitalPeriod`, the orbit at the half-mass radius of the energy runs: the 100 orbits are the same 13.08 s as before).
- The lab's cold cloud on circular orbits is `{ alphaVir: 0.96, betaRot: 0.48 }` (1.003 times the circular speed of the disc) where it was `{ rotation: 1, agitation: 0 }` (the sphere formula
  at the edge was 0.69 of the circular speed: not circular).
- Tests: `tests/disc.test.ts` (elliptic integrals, the rule, closed forms of the uniform and Maclaurin discs, scaling, the professor's ratios), `tests/turbulence.test.ts` (FFT, spectrum slope and variance,
  divergence, band, replay, sampling), `tests/toomre.test.ts`, `tests/labInitial.test.ts` (the collapse formulas against an integration of the ODE, profiles, energies, the fit of a softening), and the
  `initial cloud` block of `tests/protostar.test.ts` rewritten (energies to 1e-4 for the two kinds of agitation, circular orbits, cold cloud, neighbours' correlation, replay, the old defaults on the disc are
  alpha 0.325 and beta 0.079); the pinned lists of parameters in `tests/protostar.test.ts` and `tests/algorithms.test.ts` follow.

## Not what the plan said

- The table is made by elliptic integrals of the rings, not by a two-dimensional quadrature of 1.6 million evaluations: 110 000 evaluations, 5 ms, and exact in the angle.
- The initial acceleration of the first half step is not in the state: since phase P5a the first substep owes no half kick. The table gives it (`discAcceleration`) and the lab checks the gravity grid against it.
- The 2 % of the cold Maclaurin collapse holds for the first half of the fall only (see above), and the cause is the gravity grid, not the initial conditions.
- Correlated turbulence is not the default (see above).
- The old defaults on the disc are alpha 0.325 and beta 0.079; 0.33 and 0.08 (the plan's) were kept: +1.4 % on the kinetic energy.
- No UI readout of Q (phase A12's).

## What the next phases need to know

- **B5 (adaptive time step).** The cloud's time scales at t = 0: the free fall of the default disc is about 1.8 s and the substep is 14.2 ms (`omega dt` of the order of 0.01 in the disc, much more in the core later).
  The cold Maclaurin collapse gives the same estimate at the default step and at half of it to 1e-4 down to a tenth of the radius, so the step is not what limits an accurate fall before the grid's own resolution does. The initial
  state is unchanged in its layout (positions, velocities at the positions, `z = 1` in the acceleration texture); nothing stored depends on the step, so `dtPrev` of the plan needs no initial value.
  `discAcceleration` and `table.pull` give the largest pull of the start (`max g`) for a first estimate of the criterion; the reduction's `maxAcceleration` is what to use afterwards.
- **A12 (Q maps).** `toomre.ts` holds the pure formulas: `toomreQ(kappa, sigma, surface, gravity)` with the stellar 3.36, `epicyclicFrequency(speed, r)` from a rotation curve and `measureToomre` from particles. The default
  cloud's Q is 0.19 to 0.25 between 0.25 and 0.75 R, about 0.35 at the edge: a map of it would be red nearly everywhere at the start, as it should (the cloud fragments). The `sigma` of Q is the radial dispersion about a ring's
  mean; the gas pass's temperature is the dispersion about the mean of 3 x 3 cells, which leaves out a correlated agitation (a live map from the grids would read a correlated cloud as colder than its energy says).
  The finest scale the live Q can resolve is the grid's: the pull is smoothed over about a cell (2.4 px as a Plummer length, 8 px cells) and the inner 0.2 R is up to 5 % off the table.
- **Anything that changes the cloud** (A6's temperature floor, A11's thickness, ...) should keep the two energies as the contract: `alphaVir` and `betaRot` are what a restart sets, in units of the disc's own |U|.

## Reproduction

```
npx vite --port 5214
node scripts/run-lab.mjs --url http://localhost:5214/particle-simulator/lab.html --query "scenarios=protostar.initial-conditions,protostar.initial-grid-force,protostar.maclaurin-collapse,protostar.initial-cost,perf.protostar.restart"
node scripts/run-lab.mjs --url http://localhost:5214/particle-simulator/lab.html --query 'scenarios=baseline.protostar.default-cloud-tuning&cloudSeeds=3&cloudVariants=[{"name":"white (default)"},{"name":"correlated","params":{"turbulence":"correlated"}}]'
npx vitest run tests/disc.test.ts tests/turbulence.test.ts tests/toomre.test.ts tests/labInitial.test.ts tests/protostar.test.ts
```

"before" is the commit `da1473c` served from another directory (`git worktree add --detach <dir> da1473c`, a symbolic link to `node_modules`, `npx vite --port 5215`, the scenario `perf.protostar.restart` copied
into its registry for the restart cost). GTX 1060 (`ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2, OpenGL 4.5.0)`), HeadlessChrome with the ANGLE OpenGL backend, `EXT_float_blend` available, area 1024 x 768 px,
seed 20240611, 400 000 particles. The restart costs are medians of five restarts.
