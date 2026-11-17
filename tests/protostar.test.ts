import { describe, expect, it } from 'vitest';
import {
    MAX_SPECIES, PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_HE_IGNITION_KELVIN, PROTOSTAR_T0_KELVIN, REMOVED_PARTICLE_W,
} from '../src/config';
import { tabsOf, type ParticleType } from '../src/simulation/algorithm';
import type { InitialState } from '../src/simulation/gpuModel';
import { ALGORITHMS } from '../src/simulation/algorithms';
import { defaultParams } from '../src/simulation/params';
import {
    CARBON, formatSmall, HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_PARAM, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES,
} from '../src/simulation/protostar/declaration';
import { centerOfMass, driftCorrection } from '../src/simulation/protostar/drift';
import {
    circularSpeed, enclosedMassFractions, fillCloud, softenedPull,
} from '../src/simulation/protostar/initialConditions';
import {
    defectFraction, expectedMassAfter, fusionProbability, fusionRate, massDefect, reactionArrays, reactionTransitions,
    survivalProbability, type FusionLaw,
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
        for (const key of ['count', 'gravity', 'softening', 'rotation', 'cooling', 'fusionRate', 'fusionExponent', 'heFusionRate', 'heFusionExponent', 'feedback']) {
            expect(params).toHaveProperty(key);
        }
        const byKey = Object.fromEntries(PROTOSTAR.params.map(p => [p.key, p]));
        expect(byKey.fusionRate.kind === 'number' && byKey.fusionRate.scale).toBe('log');
        expect(byKey.feedback.kind === 'number' && byKey.feedback.scale).toBe('log');
        expect(byKey.heFusionRate.kind === 'number' && byKey.heFusionRate.scale).toBe('log');
        expect(tabsOf(PROTOSTAR.params).map(t => t.id)).toEqual(['initial', 'physics', 'fusion']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'initial').map(p => p.key)).toEqual(['count', 'rotation', 'agitation']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'physics').map(p => p.key)).toEqual(['gravity', 'softening', 'cooling', 'opacity']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'fusion').map(p => p.key)).toEqual(['fusionRate', 'fusionExponent', 'heFusionRate', 'heFusionExponent', 'feedback']);
        expect(params.fusionExponent).toBe(2.8);
        expect(params.heFusionExponent).toBe(16);
    });

    it('has hydrogen, helium and carbon 12, atomic masses in u, only hydrogen at first', () => {
        expect(PROTOSTAR_TYPES.map(t => [t.symbol, t.values.mass])).toEqual([['H', 1.00783], ['He', 4.0026], ['C', 12]]);
        expect(PROTOSTAR_TYPES[CARBON].values.weight).toBe(0);
        expect(PROTOSTAR_TYPES[HYDROGEN].values.weight).toBeGreaterThan(0);
        expect(PROTOSTAR_TYPES[HELIUM].values.weight).toBe(0);
        expect(PROTOSTAR_TYPES[HELIUM].values.mass).toBeGreaterThan(PROTOSTAR_TYPES[HYDROGEN].values.mass);
    });

    it('shows the reactions as transitions', () => {
        expect(PROTOSTAR.particleTypes.transitions).toEqual(reactionTransitions(PROTOSTAR_REACTIONS));
        expect(PROTOSTAR.particleTypes.transitions).toEqual([
            { from: HYDROGEN, to: HELIUM, label: 'Proton-proton chain (4 for 1)' },
            { from: HELIUM, to: CARBON, label: 'Triple-alpha (3 for 1)' },
        ]);
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
        expect(formatSmall(0.0001)).toBe('1.00e-4');
        expect(formatSmall(2.5)).toBe('2.5');
        expect(formatSmall(0)).toBe('0');
    });
});

describe('fusion reactions', () => {
    const [hToHe, tripleAlpha] = PROTOSTAR_REACTIONS;
    const m = mass(PROTOSTAR_TYPES);

    it('4 H -> He: mass defect of 0.71 %, the real 26.7 MeV', () => {
        expect(massDefect(hToHe, m)).toBeCloseTo(4 * 1.00783 - 4.0026, 10);
        expect(defectFraction(hToHe, m)).toBeCloseTo(0.02872 / 4.03132, 6);
        const MEV_PER_U = 931.494;
        expect(massDefect(hToHe, m) * MEV_PER_U).toBeCloseTo(26.75, 1);
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

    it('3 He -> C: mass defect of 0.065 %, one fusing helium in three survives as carbon', () => {
        expect(massDefect(tripleAlpha, m)).toBeCloseTo(3 * 4.0026 - 12, 10);
        expect(defectFraction(tripleAlpha, m)).toBeCloseTo(0.0078 / 12.0078, 6);
        expect(defectFraction(tripleAlpha, m)).toBeGreaterThan(0);
        expect(survivalProbability(tripleAlpha)).toBeCloseTo(1 / 3, 12);
        expect(expectedMassAfter(tripleAlpha, m)).toBeCloseTo(4, 10);
    });

    it('helium burning releases about 11 times less energy per unit mass than hydrogen burning', () => {
        expect(defectFraction(hToHe, m) / defectFraction(tripleAlpha, m)).toBeCloseTo(11, 0);
    });

    it('triple alpha is a three-body reaction referenced to its real ignition temperature', () => {
        expect(tripleAlpha.referenceTemperature).toBe(1e8);
        expect(PROTOSTAR_HE_IGNITION_KELVIN / PROTOSTAR_T0_KELVIN).toBeCloseTo(6.67, 2);
        expect(tripleAlpha.densityExponent).toBe(2);
        expect(tripleAlpha.label).toBe('Triple-alpha');
        expect(hToHe.label).toBe('Proton-proton chain');
        expect(hToHe.referenceTemperature).toBe(PROTOSTAR_T0_KELVIN);
        expect(hToHe.densityExponent).toBe(1);
    });

    it('builds per-type uniform arrays from the table', () => {
        const params = { ...defaultParams(PROTOSTAR), fusionRate: 0.001, fusionExponent: 3, heFusionRate: 1e-6, heFusionExponent: 40 };
        const a = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES, params, 'mass', 1000, 2, MAX_SPECIES);
        expect(a.to).toEqual([HELIUM, CARBON, ...new Array(MAX_SPECIES - 2).fill(-1)]);
        expect(a.keep[HYDROGEN]).toBe(0.25);
        expect(a.rate[HYDROGEN]).toBe(0.001);
        expect(a.exponent[HYDROGEN]).toBe(3);
        expect(a.energy[HYDROGEN]).toBeCloseTo(2 * defectFraction(hToHe, m) * 1000, 10);
        expect(a.reference[HYDROGEN]).toBe(1);
        expect(a.densityExponent[HYDROGEN]).toBe(1);
        expect(a.keep[HELIUM]).toBeCloseTo(1 / 3, 12);
        expect(a.rate[HELIUM]).toBe(1e-6);
        expect(a.exponent[HELIUM]).toBe(40);
        expect(a.energy[HELIUM]).toBeCloseTo(2 * defectFraction(tripleAlpha, m) * 1000, 10);
        expect(a.reference[HELIUM]).toBeCloseTo(1e8 / PROTOSTAR_T0_KELVIN, 10);
        expect(a.densityExponent[HELIUM]).toBe(2);
        expect(a.energy.slice(2).every(e => e === 0)).toBe(true);
    });

    it('leaves out the reactions of a missing type', () => {
        const params = defaultParams(PROTOSTAR);
        const a = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES.slice(0, 2), params, 'mass', 1, 1, MAX_SPECIES);
        expect(a.to.slice(0, 3)).toEqual([HELIUM, -1, -1]);
    });

    const hydrogenLaw: FusionLaw = { rate: 1e-4, densityExponent: 1, reference: 1, exponent: 3 };
    const heliumLaw: FusionLaw = { rate: 1e-6, densityExponent: 2, reference: 1e8 / PROTOSTAR_T0_KELVIN, exponent: 40 };

    it('hydrogen law: lambda0 rho T^alpha dt for small values, never above 1', () => {
        expect(fusionProbability(hydrogenLaw, 100, 1, 1 / 60)).toBeCloseTo(1e-2 / 60, 6);
        expect(fusionProbability(hydrogenLaw, 100, 2, 1 / 60) / fusionProbability(hydrogenLaw, 100, 1, 1 / 60)).toBeCloseTo(8, 2);
        expect(fusionProbability(hydrogenLaw, 100, 0, 1)).toBe(0);
        expect(fusionProbability({ rate: 1e3, densityExponent: 1, reference: 1, exponent: 4 }, 1e3, 10, 1)).toBeLessThanOrEqual(1);
    });

    it('general law: the rate is lambda at the reference temperature and rho = 1', () => {
        expect(fusionRate(heliumLaw, 1, heliumLaw.reference)).toBeCloseTo(1e-6, 12);
    });

    it('three-body law: doubling the density multiplies the rate by 4', () => {
        expect(fusionRate(heliumLaw, 200, heliumLaw.reference) / fusionRate(heliumLaw, 100, heliumLaw.reference)).toBeCloseTo(4, 6);
    });

    it('helium burning is very sensitive: 10 % hotter is about 45 times faster', () => {
        const t = heliumLaw.reference;
        expect(fusionRate(heliumLaw, 100, 1.1 * t) / fusionRate(heliumLaw, 100, t)).toBeCloseTo(1.1 ** 40, 3);
        expect(fusionRate(heliumLaw, 100, 0.5 * t)).toBeLessThan(1e-9);
    });

    it('the rate is capped and finite far above the reference temperature', () => {
        for (const t of [1e3, 1e30, Infinity]) {
            const rate = fusionRate(heliumLaw, 1e4, t);
            expect(rate).toBe(PROTOSTAR_FUSION_RATE_MAX);
        }
        expect(fusionRate(heliumLaw, 0, 1e30)).toBe(0);
        expect(fusionRate(heliumLaw, 1e4, 0)).toBe(0);
        expect(fusionRate({ ...heliumLaw, rate: 0 }, 1e4, 1e30)).toBe(0);
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

describe('statistical drift', () => {
    const texels = (rows: number[][]) => Float32Array.from(rows.flat());

    it('center of mass: weighted by the masses of the types, without the removed particles', () => {
        const p = texels([[0, 0, 0, 1], [10, 4, 1, 1], [100, 100, 1, REMOVED_PARTICLE_W]]);
        expect(centerOfMass(p, 3, [1, 3])).toEqual({ x: 7.5, y: 3 });
        expect(centerOfMass(p, 1, [0, 3])).toBeNull();
    });

    it('correction: the velocity of the center of mass, scaled by the gain', () => {
        expect(driftCorrection({ x: 0, y: 10 }, { x: 4, y: 8 }, 2, 0.5)).toEqual({ x: 1, y: -0.5 });
    });

    it('no correction when no time has passed', () => {
        expect(driftCorrection({ x: 0, y: 0 }, { x: 4, y: 8 }, 0, 0.5)).toEqual({ x: 0, y: 0 });
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
