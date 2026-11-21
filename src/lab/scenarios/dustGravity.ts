// The sticky dust's gravity computed per density texel (DustGravityField) against the per-particle
// multi-scale loop it replaced (kept in gravityProbe.ts as the yardstick): parity of the pull on a real
// clumped cloud, and the pull of a point mass against the angle (docs/spikes/b1-dust-gravity.md).

import * as THREE from 'three';
import { DENSITY_RES, DUST_GRADIENT_CORNER_WEIGHT } from '../../config';
import { DustGravityField } from '../../simulation/stickyDust/gravityField';
import {
    ANISOTROPY_HARMONICS, DUST_GRAVITY_SEED, DUST_PARITY_FLOOR, DUST_PARITY_FRAMES, DUST_PARITY_LIMIT, DUST_PARITY_PARTICLES,
    DUST_PARITY_PROBES, DUST_PARITY_SNAPSHOT_GAP, DUST_PARITY_SNAPSHOTS, POINT_MASS, POINT_MASS_ANGLES, POINT_MASS_MIN_RADIUS,
    POINT_MASS_PHASES, POINT_MASS_RADII, POINT_MASS_STENCILS,
} from '../config';
import { restart, runFrames, stickyDustModel } from '../driver';
import { GravityProbe, PointMassDensity } from '../gravityProbe';
import { radialTangential, ringStats, vectorError, type RingStats } from '../gravityStats';
import { halton, quantile, significant } from '../numbers';
import { withSeededRandom } from '../random';
import type { JsonValue, Scenario, ScenarioOutcome } from '../types';

const DIGITS = 4;
const round = (v: number): number => significant(v, DIGITS);
const concat = (parts: readonly Float32Array[]): Float32Array => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};

function statsMetrics(rgba: Float32Array): Record<string, JsonValue> {
    const s = vectorError(rgba, rgba.length / 4, DUST_PARITY_FLOOR, DUST_PARITY_LIMIT);
    return {
        vectors: s.count, judgedRelatively: s.significant, rmsReference: round(s.rmsReference),
        medianRelativeError: round(s.median), p95RelativeError: round(s.p95), p99RelativeError: round(s.p99),
        maxRelativeError: round(s.max), fractionOverLimit: round(s.fractionOver),
        p99AbsoluteOverRms: round(s.absoluteP99), maxAbsoluteOverRms: round(s.absoluteMax), relativeL2: round(s.relativeL2),
    };
}

/** Root mean square of the vectors (x, y) held in the channels `at` and `at + 1` of an RGBA array. */
function rms(rgba: Float32Array, at: number): number {
    let sum = 0;
    for (let i = at; i < rgba.length; i += 4) sum += rgba[i] ** 2 + rgba[i + 1] ** 2;
    return Math.sqrt(sum / (rgba.length / 4));
}

/**
 * Field against reference at the positions of the particles of a clumped cloud, on the density and the
 * field of the substep that just ran. The reference is the loop with the field's stencil: nothing but the
 * rounding of the half floats and the one-texel footprint of the final read separates them. Also at the
 * center of the density texel under each particle, where reading the field needs no re-interpolation (what
 * is left there is the rounding alone), with the density read at exact interpolation weights (the hardware
 * rounds them to 8 bits, which the reference's many reads feel more than the field's single one), and against the loop of the original central difference (what the
 * stencil changes in the pull a cloud feels: its error, and the ratio of the RMS pulls).
 */
const parity: Scenario = {
    id: 'dust.gravity.parity',
    title: 'Sticky dust: per-texel gravity against the per-particle loop, at the particles of a clumped cloud',
    tags: ['dust', 'gravity', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { simulation, renderer } = context;
        await restart(context, { algorithm: 'stickyDust', count: DUST_PARITY_PARTICLES, seed: DUST_GRAVITY_SEED });
        const model = stickyDustModel(context);
        const density = model.debugDensity;
        await withSeededRandom(DUST_GRAVITY_SEED, () => runFrames(context, DUST_PARITY_FRAMES));
        const count = Math.min(DUST_PARITY_PROBES, simulation.activeCount);
        const probe = new GravityProbe(renderer, count);
        const original = new GravityProbe(renderer, count, 0);
        const exact: Float32Array[] = [];
        const snapped: Float32Array[] = [];
        const exactWeights: Float32Array[] = [];
        const versusOriginal: Float32Array[] = [];
        try {
            for (let k = 0; k < DUST_PARITY_SNAPSHOTS; k++) {
                await withSeededRandom(DUST_GRAVITY_SEED + 1 + k, () => runFrames(context, DUST_PARITY_SNAPSHOT_GAP));
                const input = {
                    positions: simulation.positionTexture, count, density: density.target.texture,
                    field: model.debugGravity.target.texture, domainOffset: density.domainOffset.value, domainSize: density.domainSize.value,
                };
                const here = (await probe.run(input)).rgba.slice(0, count * 4);
                exact.push(here);
                snapped.push((await probe.run({ ...input, snap: true })).rgba.slice(0, count * 4));
                exactWeights.push((await probe.run({ ...input, exact: true })).rgba.slice(0, count * 4));
                // The original loop (R, G) against the field of the stencil in use (B, A).
                const loop = (await original.run(input)).rgba.slice(0, count * 4);
                const pairs = new Float32Array(count * 4);
                for (let i = 0; i < count; i++) pairs.set([loop[i * 4], loop[i * 4 + 1], here[i * 4 + 2], here[i * 4 + 3]], i * 4);
                versusOriginal.push(pairs);
            }
        } finally {
            probe.dispose();
            original.dispose();
        }
        const atParticles = statsMetrics(concat(exact));
        const atTexelCenters = statsMetrics(concat(snapped));
        const withExactWeights = statsMetrics(concat(exactWeights));
        const originalPairs = concat(versusOriginal);
        const againstOriginalLoop: Record<string, JsonValue> = { ...statsMetrics(originalPairs), rmsPullOverOriginal: round(rms(originalPairs, 2) / rms(originalPairs, 0)) };
        const metrics = {
            particles: simulation.activeCount, comparedPerSnapshot: count, snapshots: DUST_PARITY_SNAPSHOTS, cornerWeight: DUST_GRADIENT_CORNER_WEIGHT,
            atParticles, atTexelCenters, withExactWeights, againstOriginalLoop,
        };
        const p95 = atParticles.p95RelativeError as number;
        const l2 = atParticles.relativeL2 as number;
        const ok = p95 <= DUST_PARITY_LIMIT && l2 <= DUST_PARITY_LIMIT;
        const pct = (v: JsonValue, digits: number): string => `${(100 * (v as number)).toFixed(digits)} %`;
        return {
            status: ok ? 'pass' : 'fail', metrics,
            details: `at the particles: median ${pct(atParticles.medianRelativeError, 3)}, p95 ${pct(p95, 3)}, p99 ${pct(atParticles.p99RelativeError, 3)}, relative L2 ${pct(l2, 3)}; `
                + `at texel centers (rounding only): median ${pct(atTexelCenters.medianRelativeError, 4)}, p99 ${pct(atTexelCenters.p99RelativeError, 4)}; `
                + `with exact interpolation weights in the reference: median ${pct(withExactWeights.medianRelativeError, 3)}, p95 ${pct(withExactWeights.p95RelativeError, 3)}, p99 ${pct(withExactWeights.p99RelativeError, 3)}; `
                + `against the original loop: relative L2 ${pct(againstOriginalLoop.relativeL2, 2)}, RMS pull ${pct(againstOriginalLoop.rmsPullOverOriginal, 1)} of it`,
        };
    },
};

/**
 * The pull of one point mass on rings around it, against the angle: the squareness of the kernel, for
 * each stencil of POINT_MASS_STENCILS, read by the per-particle loop and by the per-texel field.
 */
const pointMass: Scenario = {
    id: 'dust.gravity.point-mass',
    title: 'Sticky dust: pull of a point mass against the angle (anisotropy), per stencil, per-texel field and per-particle loop',
    tags: ['dust', 'gravity', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer } = context;
        const rings = POINT_MASS_RADII.length;
        const probes = rings * POINT_MASS_ANGLES;
        const positions = new Float32Array(probes * 4);
        const texture = new THREE.DataTexture(positions, POINT_MASS_ANGLES, rings, THREE.RGBAFormat, THREE.FloatType);
        const mass = new PointMassDensity(renderer);
        const full = { x0: 0, y0: 0, x1: DENSITY_RES, y1: DENSITY_RES };
        const angles = Array.from({ length: POINT_MASS_ANGLES }, (_, k) => (k + 0.5) / POINT_MASS_ANGLES * 2 * Math.PI);
        const sources = ['loop', 'field'] as const;
        const stencils = POINT_MASS_STENCILS.map(([name, weight]) => ({
            name, weight,
            field: new DustGravityField(renderer, mass.target.texture, weight),
            probe: new GravityProbe(renderer, probes, weight),
            // radial[source][ring][angle]: the pull toward the mass, summed over the phases; tangential: the same across.
            radial: sources.map(() => POINT_MASS_RADII.map(() => new Float64Array(POINT_MASS_ANGLES))),
            tangential: sources.map(() => POINT_MASS_RADII.map(() => new Float64Array(POINT_MASS_ANGLES))),
            single: {} as Record<string, RingStats[]>,
        }));
        try {
            for (let phase = 0; phase < POINT_MASS_PHASES; phase++) {
                // The mass, anywhere in a texel of the coarsest levels' cells (the grid shift covers all of them);
                // low-discrepancy positions average the pull out faster than random ones.
                const cx = DENSITY_RES / 4 + halton(phase + 1, 2) * DENSITY_RES / 2;
                const cy = DENSITY_RES / 4 + halton(phase + 1, 3) * DENSITY_RES / 2;
                mass.place(cx, cy, POINT_MASS);
                POINT_MASS_RADII.forEach((r, i) => angles.forEach((a, k) => {
                    const at = (i * POINT_MASS_ANGLES + k) * 4;
                    positions[at] = cx + r * Math.cos(a);
                    positions[at + 1] = cy + r * Math.sin(a);
                }));
                texture.needsUpdate = true;
                for (const stencil of stencils) {
                    stencil.field.render(full);
                    const { rgba } = await stencil.probe.run({
                        positions: texture, count: probes, density: mass.target.texture, field: stencil.field.target.texture,
                        domainOffset: new THREE.Vector2(0, 0), domainSize: DENSITY_RES,
                    });
                    sources.forEach((_, s) => POINT_MASS_RADII.forEach((__, i) => angles.forEach((a, k) => {
                        const at = (i * POINT_MASS_ANGLES + k) * 4 + 2 * s;
                        const { radial, tangential } = radialTangential(rgba[at], rgba[at + 1], a);
                        stencil.radial[s][i][k] += radial;
                        stencil.tangential[s][i][k] += tangential;
                    })));
                    if (phase === 0) {
                        sources.forEach((source, s) => {
                            stencil.single[source] = POINT_MASS_RADII.map((_, i) => ringStats(
                                Array.from(stencil.radial[s][i]), Array.from(stencil.tangential[s][i]), ANISOTROPY_HARMONICS));
                        });
                    }
                }
            }
        } finally {
            for (const stencil of stencils) {
                stencil.probe.dispose();
                stencil.field.dispose();
            }
            mass.dispose();
            texture.dispose();
        }
        const judged = (_: unknown, i: number): boolean => POINT_MASS_RADII[i] >= POINT_MASS_MIN_RADIUS;
        const averageOf = (stencil: (typeof stencils)[number], s: number): RingStats[] => POINT_MASS_RADII.map((_, i) => ringStats(
            Array.from(stencil.radial[s][i], v => v / POINT_MASS_PHASES), Array.from(stencil.tangential[s][i], v => v / POINT_MASS_PHASES),
            ANISOTROPY_HARMONICS));
        const results = stencils.map(stencil => ({ stencil, loop: averageOf(stencil, 0), field: averageOf(stencil, 1) }));
        const cross = results.find(r => r.stencil.weight === 0);
        const smooth = (rings: RingStats[]): number[] => rings.filter(judged).map(r => r.smoothAnisotropy);
        const summary = (rings: RingStats[]) => ({ median: round(quantile(smooth(rings), 0.5)), worst: round(Math.max(...smooth(rings))) });
        const table = (rings: RingStats[], reference: RingStats[] | undefined): JsonValue[] => POINT_MASS_RADII.map((radius, i) => ({
            radius, pull: round(rings[i].mean), anisotropy: round(rings[i].smoothAnisotropy), rawAnisotropy: round(rings[i].anisotropy),
            relativeStd: round(rings[i].relativeStd), offDirection: round(rings[i].tangential),
            ...(reference ? { pullOverCross: round(rings[i].mean / reference[i].mean) } : {}),
        }));
        const perStencil: Record<string, JsonValue> = {};
        let disagreement = 0;
        for (const { stencil, loop, field } of results) {
            const pullOverCross = cross ? field.filter(judged).map((r, k) => r.mean / cross.field.filter(judged)[k].mean) : [];
            disagreement = Math.max(disagreement, ...smooth(field).map((v, k) => Math.abs(v - smooth(loop)[k])));
            perStencil[stencil.name] = {
                cornerWeight: stencil.weight, field: summary(field), loop: summary(loop),
                singlePositionWorst: round(Math.max(...stencil.single.field.filter(judged).map(r => r.smoothAnisotropy))),
                medianPullOverCross: pullOverCross.length > 0 ? round(quantile(pullOverCross, 0.5)) : null,
                fieldRings: table(field, cross?.field), loopRings: table(loop, cross?.loop),
            };
        }
        const line = ({ stencil, field }: (typeof results)[number]): string => {
            const { median, worst } = summary(field);
            return `${stencil.name} (w = ${stencil.weight.toFixed(4)}): median ${(100 * median).toFixed(2)} %, worst ring ${(100 * worst).toFixed(2)} %`;
        };
        return {
            status: disagreement <= DUST_PARITY_LIMIT ? 'pass' : 'fail',
            metrics: {
                phases: POINT_MASS_PHASES, angles: POINT_MASS_ANGLES, harmonics: [...ANISOTROPY_HARMONICS], minimumRadius: POINT_MASS_MIN_RADIUS,
                fieldAgainstLoopWorstDifference: round(disagreement), stencils: perStencil,
            },
            details: `anisotropy (max-min)/(max+min) of the field's pull toward a point mass (harmonics ${ANISOTROPY_HARMONICS.join(', ')} of the angle, `
                + `rings of ${POINT_MASS_MIN_RADIUS} texels and more, ${POINT_MASS_PHASES} positions of the mass): ${results.map(line).join('; ')}; `
                + `the per-particle loop agrees with the field to ${(100 * disagreement).toFixed(2)} points`,
        };
    },
};

export const dustGravityScenarios: Scenario[] = [parity, pointMass];
