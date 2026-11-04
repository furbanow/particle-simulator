import { describe, expect, it } from 'vitest';
import { MAX_SPECIES, REMOVED_PARTICLE_W } from '../src/config';
import type { ParticleType } from '../src/simulation/algorithm';
import type { InitialState } from '../src/simulation/gpuModel';
import { ALGORITHMS } from '../src/simulation/algorithms';
import { defaultParams } from '../src/simulation/params';
import {
    formatSmall, HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_PARAM, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES,
} from '../src/simulation/protostar/declaration';
import {
    circularSpeed, enclosedMassFractions, fillCloud, softenedPull,
} from '../src/simulation/protostar/initialConditions';
import {
    defectFraction, expectedMassAfter, fusionProbability, massDefect, reactionArrays, reactionTransitions,
    survivalProbability, type FusionReaction,
} from '../src/simulation/protostar/reactions';
import { countTypes } from '../src/simulation/typeCounts';

/** Deterministic pseudo-random numbers (mulberry32). */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const mass = (types: readonly ParticleType[]) => (rank: number) => types[rank].values.mass;

describe('protostar declaration', () => {
    it('is in the catalog', () => {
        expect(ALGORITHMS.protostar).toBe(PROTOSTAR);
    });

    it('declares the required parameters with their defaults', () => {
        const params = defaultParams(PROTOSTAR);
        for (const key of ['count', 'gravity', 'softening', 'rotation', 'cooling', 'fusionRate', 'fusionExponent', 'feedback']) {
            expect(params).toHaveProperty(key);
        }
        const byKey = Object.fromEntries(PROTOSTAR.params.map(p => [p.key, p]));
        expect(byKey.fusionRate.kind === 'number' && byKey.fusionRate.scale).toBe('log');
        expect(byKey.feedback.kind === 'number' && byKey.feedback.scale).toBe('log');
        expect(byKey.count.apply).toBe('restart');
        expect(byKey.rotation.apply).toBe('restart');
        for (const key of ['gravity', 'softening', 'cooling', 'fusionRate', 'fusionExponent', 'feedback']) {
            expect(byKey[key].apply).toBe('live');
        }
        // alpha roughly 2 to 4 by default
        expect(params.fusionExponent).toBeGreaterThanOrEqual(2);
        expect(params.fusionExponent).toBeLessThanOrEqual(4);
    });

    it('has hydrogen and helium, atomic masses in u, helium absent at first', () => {
        expect(PROTOSTAR_TYPES.map(t => [t.symbol, t.values.mass])).toEqual([['H', 1.008], ['He', 4.0026]]);
        expect(PROTOSTAR_TYPES[HYDROGEN].values.weight).toBeGreaterThan(0);
        expect(PROTOSTAR_TYPES[HELIUM].values.weight).toBe(0);
        expect(PROTOSTAR_TYPES[HELIUM].values.mass).toBeGreaterThan(PROTOSTAR_TYPES[HYDROGEN].values.mass);
    });

    it('shows the reactions as transitions', () => {
        expect(PROTOSTAR.particleTypes.transitions).toEqual(reactionTransitions(PROTOSTAR_REACTIONS));
        expect(PROTOSTAR.particleTypes.transitions).toEqual([{ from: HYDROGEN, to: HELIUM, label: 'Fusion (4 pour 1)' }]);
    });

    it('declares counts per type, core temperature and density', () => {
        expect(PROTOSTAR.stats?.map(s => s.kind === 'typeCounts' ? s.kind : s.key))
            .toEqual(['typeCounts', 'coreTemperature', 'coreDensity', 'fusionRate']);
    });

    it('reaction parameters exist', () => {
        const keys = new Set(PROTOSTAR.params.map(p => p.key));
        for (const r of PROTOSTAR_REACTIONS) {
            expect(keys.has(r.rateParam)).toBe(true);
            expect(keys.has(r.exponentParam)).toBe(true);
        }
    });

    it('formats small values', () => {
        expect(formatSmall(0.0001)).toBe('1,00e-4');
        expect(formatSmall(2.5)).toBe('2,5');
        expect(formatSmall(0)).toBe('0');
    });
});

describe('fusion reactions', () => {
    const [hToHe] = PROTOSTAR_REACTIONS;
    const m = mass(PROTOSTAR_TYPES);

    it('4 H -> He: mass defect of 0.7 %', () => {
        expect(massDefect(hToHe, m)).toBeCloseTo(4 * 1.008 - 4.0026, 10);
        expect(defectFraction(hToHe, m)).toBeCloseTo(0.0294 / 4.032, 6);
    });

    it('mass bookkeeping: a fusing particle survives one time in four, as a helium atom', () => {
        expect(survivalProbability(hToHe)).toBe(0.25);
        // Per fused hydrogen atom, 1.00065 u is left on average: the mass defect is lost.
        expect(expectedMassAfter(hToHe, m)).toBeCloseTo(4.0026 / 4, 10);
        expect(expectedMassAfter(hToHe, m) / m(HYDROGEN)).toBeCloseTo(1 - defectFraction(hToHe, m), 10);
    });

    it('releases no energy when the product is heavier than the fused atoms', () => {
        const heavy = PROTOSTAR_TYPES.map((t, k) => ({ ...t, values: { ...t.values, mass: k === HELIUM ? 5 : t.values.mass } }));
        expect(massDefect(hToHe, mass(heavy))).toBeLessThan(0);
        expect(defectFraction(hToHe, mass(heavy))).toBe(0);
    });

    it('builds per-type uniform arrays from the table', () => {
        const params = { ...defaultParams(PROTOSTAR), fusionRate: 0.001, fusionExponent: 3 };
        const a = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES, params, 'mass', 1000, 2, MAX_SPECIES);
        expect(a.to).toEqual([HELIUM, ...new Array(MAX_SPECIES - 1).fill(-1)]);
        expect(a.keep[HYDROGEN]).toBe(0.25);
        expect(a.rate[HYDROGEN]).toBe(0.001);
        expect(a.exponent[HYDROGEN]).toBe(3);
        expect(a.energy[HYDROGEN]).toBeCloseTo(2 * defectFraction(hToHe, m) * 1000, 10);
        expect(a.energy.slice(1).every(e => e === 0)).toBe(true);
    });

    it('scales to more types: one more row is one more reaction', () => {
        const carbon: ParticleType = { name: 'Carbone', symbol: 'C', color: '#a8a8a8', values: { weight: 0, mass: 12, size: 3 } };   // carbon 12
        const types = [...PROTOSTAR_TYPES, carbon];
        const reactions: FusionReaction[] = [...PROTOSTAR_REACTIONS,
            { from: HELIUM, to: 2, consumed: 3, label: 'Triple alpha', rateParam: 'heRate', exponentParam: 'heExponent' }];
        const params = { ...defaultParams(PROTOSTAR), heRate: 1e-6, heExponent: 4 };
        const a = reactionArrays(reactions, types, params, 'mass', 1, 1, MAX_SPECIES);
        expect(a.to.slice(0, 3)).toEqual([HELIUM, 2, -1]);
        expect(a.keep[HELIUM]).toBeCloseTo(1 / 3, 12);
        expect(a.rate[HELIUM]).toBe(1e-6);
        expect(a.exponent[HELIUM]).toBe(4);
        expect(a.energy[HELIUM]).toBeCloseTo((3 * 4.0026 - 12) / (3 * 4.0026), 10);
        // Reactions with a missing type are left out.
        const b = reactionArrays(reactions, PROTOSTAR_TYPES, params, 'mass', 1, 1, MAX_SPECIES);
        expect(b.to.slice(0, 3)).toEqual([HELIUM, -1, -1]);
    });

    it('fusion probability: lambda0 rho T^alpha dt for small values, never above 1', () => {
        expect(fusionProbability(1e-4, 100, 1, 3, 1 / 60)).toBeCloseTo(1e-2 / 60, 6);
        expect(fusionProbability(1e-4, 100, 2, 3, 1 / 60) / fusionProbability(1e-4, 100, 1, 3, 1 / 60)).toBeCloseTo(8, 2);
        expect(fusionProbability(1e-4, 100, 0, 3, 1)).toBe(0);
        expect(fusionProbability(1e3, 1e3, 10, 4, 1)).toBeLessThanOrEqual(1);
    });
});

describe('initial cloud', () => {
    it('enclosed mass: fraction of the particles inside each radius', () => {
        const f = enclosedMassFractions([3, 1, 2, 4]);
        expect([...f]).toEqual([2.5 / 4, 0.5 / 4, 1.5 / 4, 3.5 / 4]);
    });

    it('circular speed: sqrt(G M_enc / r) far from the softening length, 0 at the center', () => {
        expect(circularSpeed(2, 50, 100, 0)).toBeCloseTo(Math.sqrt(2 * 50 / 100), 12);
        expect(circularSpeed(2, 50, 100, 1)).toBeCloseTo(Math.sqrt(2 * 50 / 100), 3);
        expect(circularSpeed(2, 50, 0, 1)).toBe(0);
        expect(softenedPull(2, 50, 3, 4)).toBeCloseTo(2 * 50 * 3 / 125, 12);
    });

    const makeState = (count: number, typeCounts: number[]): InitialState => ({
        positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4),
        count, typeCounts, width: 800, height: 600, params: {},
    });
    const options = { radius: 200, gravity: 3, totalMass: 1000, softening: 5, rotation: 0.3, agitation: 0 };

    it('fills a rotating disk centered on the area, types in contiguous blocks', () => {
        const state = makeState(2000, [1500, 500]);
        fillCloud(state, options, seeded(1));
        const { positions: p, velocities: v } = state;
        for (let i = 0; i < 2000; i++) {
            const dx = p[i * 4] - 400, dy = p[i * 4 + 1] - 300;
            const r = Math.hypot(dx, dy);
            expect(r).toBeLessThanOrEqual(200 + 1e-3);
            expect(p[i * 4 + 2]).toBe(i < 1500 ? 0 : 1);
            expect(p[i * 4 + 3]).toBe(1);
            // Counterclockwise: angular momentum > 0; no agitation: purely tangential.
            const lz = dx * v[i * 4 + 1] - dy * v[i * 4];
            expect(lz).toBeGreaterThanOrEqual(0);
            expect(Math.abs(dx * v[i * 4] + dy * v[i * 4 + 1])).toBeLessThan(1e-2 * Math.max(1, r));
        }
    });

    it('tangential speed is the rotation fraction of v_circ(r) from the enclosed mass', () => {
        const state = makeState(1000, [1000]);
        fillCloud(state, options, seeded(2));
        const { positions: p, velocities: v } = state;
        const radii = Array.from({ length: 1000 }, (_, i) => Math.hypot(p[i * 4] - 400, p[i * 4 + 1] - 300));
        const enclosed = enclosedMassFractions(radii);
        for (let i = 0; i < 1000; i += 37) {
            const expected = 0.3 * circularSpeed(3, enclosed[i] * 1000, radii[i], 5);
            expect(Math.hypot(v[i * 4], v[i * 4 + 1])).toBeCloseTo(expected, 3);
        }
    });

    it('initial accelerations point to the center, from the enclosed mass', () => {
        const state = makeState(500, [500]);
        const accel = fillCloud(state, options, seeded(3));
        const { positions: p } = state;
        const radii = Array.from({ length: 500 }, (_, i) => Math.hypot(p[i * 4] - 400, p[i * 4 + 1] - 300));
        const enclosed = enclosedMassFractions(radii);
        for (let i = 0; i < 500; i += 13) {
            const dx = p[i * 4] - 400, dy = p[i * 4 + 1] - 300;
            expect(accel[i * 4] * dx + accel[i * 4 + 1] * dy).toBeLessThanOrEqual(0);
            expect(Math.hypot(accel[i * 4], accel[i * 4 + 1])).toBeCloseTo(softenedPull(3, enclosed[i] * 1000, radii[i], 5), 3);
        }
    });

    it('agitation has the requested spread and no net momentum', () => {
        const state = makeState(20000, [20000]);
        fillCloud(state, { ...options, rotation: 0, agitation: 0.5 }, seeded(4));
        const { velocities: v } = state;
        let sx = 0, sy = 0, s2 = 0;
        for (let i = 0; i < 20000; i++) { sx += v[i * 4]; sy += v[i * 4 + 1]; s2 += v[i * 4] ** 2; }
        expect(Math.abs(sx / 20000)).toBeLessThan(1e-4);
        expect(Math.abs(sy / 20000)).toBeLessThan(1e-4);
        const sigma = 0.5 * circularSpeed(3, 1000, 200, 5);
        expect(Math.sqrt(s2 / 20000)).toBeCloseTo(sigma, 1);
    });
});

describe('removed particles', () => {
    it('are not counted', () => {
        const data = new Float32Array(4 * 4);
        [[0, 1], [1, 1], [0, REMOVED_PARTICLE_W], [1, 1]].forEach(([z, w], i) => { data[i * 4 + 2] = z; data[i * 4 + 3] = w; });
        expect(countTypes(data, 4, 2)).toEqual([1, 2]);
    });

    it('the population parameter key of the declaration is a parameter', () => {
        expect(PROTOSTAR.params.some(p => p.key === PROTOSTAR_PARAM.count)).toBe(true);
    });
});
