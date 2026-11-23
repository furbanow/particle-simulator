import { describe, expect, it } from 'vitest';
import {
    MAX_SPECIES, PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_HE_IGNITION_KELVIN, PROTOSTAR_T0_KELVIN,
} from '../src/config';
import { appliesOnRestart, tabsOf, type ParticleType } from '../src/simulation/algorithm';
import type { InitialState } from '../src/simulation/gpuModel';
import { ALGORITHMS } from '../src/simulation/algorithms';
import { defaultParams } from '../src/simulation/params';
import {
    CARBON, formatEnergyDrift, formatSmall, HELIUM, HYDROGEN, PROTOSTAR, PROTOSTAR_PARAM, PROTOSTAR_REACTIONS, PROTOSTAR_TYPES,
} from '../src/simulation/protostar/declaration';
import {
    atomicNumber, inverseMeanMolecularWeight, inverseMolecularWeights,
} from '../src/simulation/protostar/composition';
import { logNoiseBiasCurved, logUnbiasedResonant } from '../src/simulation/protostar/noiseBias';
import { fusionLawOf } from '../src/simulation/protostar/ignition';
import { fillCloud, type CloudOptions } from '../src/simulation/protostar/initialConditions';
import {
    defectFraction, fusionExpectation, fusionProbability, fusionRate, lawAt, massDefect, reactionArrays, reactionTransitions,
    type FusionLaw,
} from '../src/simulation/protostar/reactions';

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
        for (const key of ['count', 'gravity', 'softening', 'alphaVir', 'betaRot', 'profile', 'turbulence', 'radiation', 'kappa', 'minTemperature', 'fusionRate', 'heFusionRate', 'feedback']) {
            expect(params).toHaveProperty(key);
        }
        const byKey = Object.fromEntries(PROTOSTAR.params.map(p => [p.key, p]));
        expect(byKey.fusionRate.kind === 'number' && byKey.fusionRate.scale).toBe('log');
        expect(byKey.feedback.kind === 'number' && byKey.feedback.scale).toBe('log');
        expect(byKey.heFusionRate.kind === 'number' && byKey.heFusionRate.scale).toBe('log');
        expect(tabsOf(PROTOSTAR.params).map(t => t.id)).toEqual(['initial', 'physics', 'fusion', 'features']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'initial').map(p => p.key)).toEqual(['count', 'alphaVir', 'betaRot', 'profile', 'turbulence']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'physics').map(p => p.key)).toEqual(['gravity', 'softening', 'radiation', 'kappa', 'minTemperature']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'fusion').map(p => p.key)).toEqual(['fusionRate', 'heFusionRate', 'feedback']);
        expect(PROTOSTAR.params.filter(p => p.tab === 'features').map(p => p.key)).toEqual(['diagnostics', 'adaptiveTimeStep', 'jeansFloor', 'stabilityMap', 'tscDeposit', 'collisions', 'adaptiveThickness', 'nestedGrid']);
        // the temperature exponents are not parameters any more: they are Gamow's (3.9 at 15 MK for pp, 41 at 100 MK for the triple alpha)
        expect(params).not.toHaveProperty('fusionExponent');
        expect(params).not.toHaveProperty('heFusionExponent');
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

    it('declares the mass per element, core temperature and density, fusion rate and the two energy diagnostics', () => {
        expect(PROTOSTAR.stats?.map(s => s.kind === 'typeMasses' ? s.kind : s.key))
            .toEqual(['typeMasses', 'coreTemperature', 'coreDensity', 'fusionRate', 'energyDrift', 'virialRatio']);
    });

    it('explains the mass per element: the particles are parcels of constant mass that change element', () => {
        const tile = PROTOSTAR.stats?.find(s => s.kind === 'typeMasses');
        expect(tile?.kind === 'typeMasses' && tile.title?.length).toBeGreaterThan(tile?.label.length ?? 0);
    });

    it('has the energy diagnostics switch on, in the features tab', () => {
        const flag = PROTOSTAR.params.find(p => p.key === PROTOSTAR_PARAM.diagnostics);
        expect(flag?.kind).toBe('boolean');
        expect(flag?.tab).toBe('features');
        expect(flag?.kind === 'boolean' && flag.default).toBe(true);
        expect(defaultParams(PROTOSTAR).diagnostics).toBe(true);
    });

    it('has the adaptive time step switch in the features tab, applied live', () => {
        const flag = PROTOSTAR.params.find(p => p.key === PROTOSTAR_PARAM.adaptiveTimeStep);
        expect(flag?.kind).toBe('boolean');
        expect(flag?.tab).toBe('features');
        expect(flag?.doc.length).toBeGreaterThan(flag?.label.length ?? 0);
        // off by default: the measured cost (a fifth more substeps over the default cloud's run) is above the plan's tenth of a frame
        expect(flag?.kind === 'boolean' && flag.default).toBe(false);
        expect(defaultParams(PROTOSTAR).adaptiveTimeStep).toBe(false);
    });

    it('has the Jeans floor switch in the features tab, applied live and off by default', () => {
        const flag = PROTOSTAR.params.find(p => p.key === PROTOSTAR_PARAM.jeansFloor);
        expect(flag?.kind).toBe('boolean');
        expect(flag?.tab).toBe('features');
        expect(flag && appliesOnRestart(flag)).toBe(false);
        expect(flag?.doc.length).toBeGreaterThan(flag?.label.length ?? 0);
        // an artificial pressure that heats the dense core (docs/spikes/a6-a13-cooling-and-jeans.md): optional, as the proposal asks
        expect(defaultParams(PROTOSTAR).jeansFloor).toBe(false);
    });

    it('replaces the linear cooling by the thin-disc law: c, kappa and T_min, with no trace of the old keys', () => {
        const keys = PROTOSTAR.params.map(p => p.key);
        for (const key of [PROTOSTAR_PARAM.radiation, PROTOSTAR_PARAM.kappa, PROTOSTAR_PARAM.minTemperature]) expect(keys).toContain(key);
        expect(keys).not.toContain('cooling');
        expect(keys).not.toContain('opacity');
    });

    it('explains the two energy tiles', () => {
        for (const s of PROTOSTAR.stats ?? []) {
            if (s.kind === 'value' && (s.key === 'energyDrift' || s.key === 'virialRatio')) expect(s.title?.length).toBeGreaterThan(s.label.length);
        }
    });

    it('formats the energy drift as a signed percentage', () => {
        expect(formatEnergyDrift(0.0031)).toBe('+0.31 %');
        expect(formatEnergyDrift(-0.0125)).toBe('-1.25 %');
        expect(formatEnergyDrift(-0.2)).toBe('-20.0 %');
        expect(formatEnergyDrift(0)).toBe('0.00 %');
    });

    it('reaction parameters exist', () => {
        const keys = new Set(PROTOSTAR.params.map(p => p.key));
        for (const r of PROTOSTAR_REACTIONS) {
            expect(keys.has(r.rateParam)).toBe(true);
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

    it('a fusing parcel keeps its mass: the mass defect only leaves as the energy of the heating', () => {
        // Per unit of fused mass, the share that is released is the defect fraction (0.71 %), times c^2 and the feedback.
        const energy = 3 * defectFraction(hToHe, m) * 2000;
        const step = fusionExpectation(0.05, 2, 1 / 120, energy);
        expect(step.fusedMass).toBeCloseTo(0.05 * (1 - Math.exp(-2 / 120)), 14);
        expect(step.releasedEnergy).toBeCloseTo(step.fusedMass * energy, 14);
        // The power deposit (m rate energy, per second) agrees with the fused mass to the first order in rate dt...
        expect(step.depositedEnergy / step.releasedEnergy).toBeCloseTo(1 + 2 / 120 / 2, 3);
        // ...and a parcel that fuses in the whole step (rate dt large) has released all its mass's worth, not more.
        const burst = fusionExpectation(1, 50, 1, energy);
        expect(burst.releasedEnergy).toBeCloseTo(energy, 10);
        expect(burst.releasedEnergy).toBeLessThan(burst.depositedEnergy);
        expect(fusionExpectation(1, 0, 1, energy)).toEqual({ fusedMass: 0, releasedEnergy: 0, depositedEnergy: 0 });
    });

    it('releases no energy when the product is heavier than the fused atoms', () => {
        const heavy = PROTOSTAR_TYPES.map((t, k) => ({ ...t, values: { ...t.values, mass: k === HELIUM ? 5 : t.values.mass } }));
        expect(massDefect(hToHe, mass(heavy))).toBeLessThan(0);
        expect(defectFraction(hToHe, mass(heavy))).toBe(0);
    });

    it('3 He -> C: mass defect of 0.065 %', () => {
        expect(massDefect(tripleAlpha, m)).toBeCloseTo(3 * 4.0026 - 12, 10);
        expect(defectFraction(tripleAlpha, m)).toBeCloseTo(0.0078 / 12.0078, 6);
        expect(defectFraction(tripleAlpha, m)).toBeGreaterThan(0);
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
        const params = { ...defaultParams(PROTOSTAR), fusionRate: 0.001, heFusionRate: 1e-6 };
        const a = reactionArrays(PROTOSTAR_REACTIONS, PROTOSTAR_TYPES, params, 'mass', 1000, 2, MAX_SPECIES);
        expect(a.to).toEqual([HELIUM, CARBON, ...new Array(MAX_SPECIES - 2).fill(-1)]);
        expect(a.rate[HYDROGEN]).toBe(0.001);
        expect(a.power[HYDROGEN]).toBeCloseTo(2 / 3, 12);
        expect(a.barrierPower[HYDROGEN]).toBeCloseTo(1 / 3, 12);
        expect(a.fuel[HYDROGEN]).toBe(0);
        expect(a.energy[HYDROGEN]).toBeCloseTo(2 * defectFraction(hToHe, m) * 1000, 10);
        expect(a.reference[HYDROGEN]).toBe(1);
        expect(a.densityExponent[HYDROGEN]).toBe(1);
        expect(a.rate[HELIUM]).toBe(1e-6);
        expect(a.power[HELIUM]).toBe(3);
        expect(a.barrier[HELIUM]).toBeCloseTo(44, 12);
        expect(a.fuel[HELIUM]).toBe(1);
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

    // The laws of the table at lambda = 1e-4 (hydrogen) and 1e-6 (helium): Gamow's, normalised at 15 and 100 MK.
    const hydrogenLaw: FusionLaw = fusionLawOf(hToHe, { fusionRate: 1e-4 });
    const heliumLaw: FusionLaw = fusionLawOf(tripleAlpha, { heFusionRate: 1e-6 });

    it('hydrogen law: lambda0 rho dt at the reference temperature for small values, steeper than a power law of 3 below it, never above 1', () => {
        expect(fusionProbability(hydrogenLaw, 100, 1, 1 / 60)).toBeCloseTo(1e-2 / 60, 6);
        // 3.9 at 15 MK, 3.0 at 30 MK: doubling T multiplies the rate by 2^3.4 or so
        const double = fusionProbability(hydrogenLaw, 100, 2, 1 / 60) / fusionProbability(hydrogenLaw, 100, 1, 1 / 60);
        expect(double).toBeGreaterThan(2 ** 3);
        expect(double).toBeLessThan(2 ** 3.9);
        expect(fusionProbability(hydrogenLaw, 100, 0, 1)).toBe(0);
        expect(fusionProbability({ ...hydrogenLaw, rate: 1e3 }, 1e3, 10, 1)).toBeLessThanOrEqual(1);
    });

    it('general law: the rate is lambda at the reference temperature and rho = 1', () => {
        expect(fusionRate(heliumLaw, 1, heliumLaw.reference)).toBeCloseTo(1e-6, 12);
    });

    it('three-body law: doubling the density multiplies the rate by 4', () => {
        expect(fusionRate(heliumLaw, 200, heliumLaw.reference) / fusionRate(heliumLaw, 100, heliumLaw.reference)).toBeCloseTo(4, 6);
    });

    it('helium burning is very sensitive: a 10 % hotter gas fuses about 40 times faster (exponent 41 at 100 MK, falling as it heats)', () => {
        const t = heliumLaw.reference;
        const ratio = fusionRate(heliumLaw, 100, 1.1 * t) / fusionRate(heliumLaw, 100, t);
        expect(ratio).toBeGreaterThan(1.1 ** 36);
        expect(ratio).toBeLessThan(1.1 ** 41);
        expect(fusionRate(heliumLaw, 100, 0.5 * t)).toBeLessThan(1e-9);
    });

    it('corrects the rate for the noise of the temperature when the number of particles is given: divided by the bias for the proton-proton chain, replaced by its exact unbiased estimate for the triple alpha', () => {
        const t = heliumLaw.reference;
        const plain = fusionRate(heliumLaw, 100, t);
        const point = lawAt(hydrogenLaw, hydrogenLaw.reference);
        const plainHydrogen = fusionRate(hydrogenLaw, 100, hydrogenLaw.reference);
        expect(fusionRate(heliumLaw, 100, t, Infinity)).toBe(plain);
        expect(fusionRate(hydrogenLaw, 100, hydrogenLaw.reference, 400)).toBeCloseTo(
            plainHydrogen / Math.exp(logNoiseBiasCurved(400, point.exponent, point.barrier, hydrogenLaw.barrierPower)), 12);
        const exact = logUnbiasedResonant(400, 1, heliumLaw.power, heliumLaw.barrier)!;
        expect(fusionRate(heliumLaw, 100, t, 400)).toBeCloseTo(Math.exp(Math.log(heliumLaw.rate * 100 ** 2) + exact), 12);
        expect(fusionRate(heliumLaw, 100, t, 400)).toBeLessThan(plain / 1.5);
        expect(fusionRate(heliumLaw, 100, t, 6400)).toBeGreaterThan(plain / 1.2);
        // a neighborhood with next to no particles tells nothing of T: its rate is nearly zero, not infinite or NaN
        expect(fusionRate(heliumLaw, 100, t, 1)).toBeLessThan(1e-9);
        expect(fusionRate(heliumLaw, 100, t, 1)).toBeGreaterThan(0);
        // the cap holds
        expect(fusionRate(heliumLaw, 1e4, 15, 400)).toBe(PROTOSTAR_FUSION_RATE_MAX);
    });

    it('the rate is capped and finite far above the reference temperature, and nil without gas', () => {
        for (const t of [15, 30, 100]) {
            const rate = fusionRate(heliumLaw, 1e4, t);
            expect(rate).toBe(PROTOSTAR_FUSION_RATE_MAX);
        }
        // far above the maximum of the law (1.5 GK for the triple alpha) the barrier is gone and the prefactor T^-3 takes it down, to nothing, not to NaN
        expect(fusionRate(heliumLaw, 1e4, 1e30)).toBeLessThan(1e-30);
        expect(fusionRate(heliumLaw, 0, 1e30)).toBe(0);
        expect(fusionRate(heliumLaw, 1e4, 0)).toBe(0);
        expect(fusionRate({ ...heliumLaw, rate: 0 }, 1e4, 1e30)).toBe(0);
    });
});

describe('initial cloud', () => {
    const makeState = (count: number, typeCounts: number[]): InitialState => ({
        positions: new Float32Array(count * 4), velocities: new Float32Array(count * 4),
        count, typeCounts, width: 800, height: 600, params: {},
    });
    const options: CloudOptions = {
        radius: 200, gravity: 3, totalMass: 1000, softening: 5, profile: 'uniform', virial: 0.6, rotation: 0.2, turbulence: 'white',
    };
    /** Per-particle statistics of a filled cloud: radius, the speed along and across it, and the energies (every particle weighs M / N). */
    function measure(state: InitialState, totalMass: number) {
        const { positions: p, velocities: v, count } = state;
        let kinetic = 0, rotation = 0, momentumX = 0, momentumY = 0;
        const radii: number[] = [], tangential: number[] = [], radial: number[] = [];
        for (let i = 0; i < count; i++) {
            const dx = p[i * 4] - 400, dy = p[i * 4 + 1] - 300, r = Math.hypot(dx, dy);
            const vx = v[i * 4], vy = v[i * 4 + 1];
            radii.push(r); tangential.push((dx * vy - dy * vx) / r); radial.push((dx * vx + dy * vy) / r);
            kinetic += 0.5 * (totalMass / count) * (vx * vx + vy * vy);
            momentumX += vx; momentumY += vy;
        }
        // The rotation is the mean tangential speed at each radius: bins of 200 particles by radius.
        const order = radii.map((_, i) => i).sort((a, b) => radii[a] - radii[b]);
        for (let b = 0; b + 200 <= count; b += 200) {
            const bin = order.slice(b, b + 200);
            const mean = bin.reduce((sum, i) => sum + tangential[i], 0) / bin.length;
            rotation += 0.5 * (totalMass / count) * bin.length * mean * mean;
        }
        return { radii, tangential, radial, kinetic, rotation, momentum: [momentumX / count, momentumY / count] };
    }

    it('fills a rotating disk centered on the area, types in contiguous blocks', () => {
        const state = makeState(2000, [1500, 500]);
        fillCloud(state, { ...options, virial: 0.4, rotation: 0.2 }, seeded(1));       // all the energy in rotation: no noise
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

    it('spreads the mass as the profile says: the same seed gives the uniform positions of before, Maclaurin\'s are more central', () => {
        const count = 20000;
        const share = (profile: 'uniform' | 'maclaurin', x: number): number => {
            const state = makeState(count, [count]);
            fillCloud(state, { ...options, profile }, seeded(5));
            let inside = 0;
            for (let i = 0; i < count; i++) if (Math.hypot(state.positions[i * 4] - 400, state.positions[i * 4 + 1] - 300) < x * 200) inside++;
            return inside / count;
        };
        expect(share('uniform', 0.5)).toBeCloseTo(0.25, 1);
        expect(share('maclaurin', 0.5)).toBeCloseTo(1 - 0.75 ** 1.5, 1);
        // the first particle of the seed, as the code before this phase drew it: r = R sqrt(u1), angle = 2 pi u2
        const reference = seeded(5), first = makeState(1, [1]);
        fillCloud(first, options, seeded(5));
        const r = 200 * Math.sqrt(reference()), angle = reference() * 2 * Math.PI;
        expect(first.positions[0]).toBeCloseTo(400 + r * Math.cos(angle), 3);
        expect(first.positions[1]).toBeCloseTo(300 + r * Math.sin(angle), 3);
    });

    it('rotates at one fraction of the circular speed of the disc, whatever the radius', () => {
        const count = 5000;
        const state = makeState(count, [count]);
        const summary = fillCloud(state, { ...options, virial: 0.4, rotation: 0.2 }, seeded(2));
        const { positions: p, velocities: v } = state;
        expect(summary.rotationFactor).toBeGreaterThan(0.3);
        for (let i = 0; i < count; i += 37) {
            const r = Math.hypot(p[i * 4] - 400, p[i * 4 + 1] - 300);
            expect(Math.hypot(v[i * 4], v[i * 4 + 1])).toBeCloseTo(summary.rotationFactor * summary.table.circularSpeedAt(r), 3);
        }
        // the disc is not a sphere: its pull is not the one of the mass inside (4/pi times it near the edge, more with a thin disc's edge)
        const sphere = Math.sqrt(options.gravity * options.totalMass / 200);
        expect(summary.table.circularSpeedAt(190)).toBeGreaterThan(1.2 * sphere);
    });

    it('sets the energies the sliders ask for: E_rot = beta |U|, K = alpha |U| / 2', () => {
        const count = 40000;
        for (const turbulence of ['white', 'correlated'] as const) {
            const state = makeState(count, [count]);
            const summary = fillCloud(state, { ...options, virial: 0.9, rotation: 0.15, turbulence }, seeded(3));
            const { kinetic, rotation } = measure(state, options.totalMass);
            expect(summary.potentialEnergy).toBeGreaterThan(0);
            expect(summary.rotationEnergy).toBeCloseTo(0.15 * summary.potentialEnergy, 8);
            expect(summary.randomEnergy).toBeCloseTo(0.3 * summary.potentialEnergy, 8);
            // the realised rotation (the mean tangential speed in bins) and the whole kinetic energy; what is left is the sampling's
            expect(rotation / summary.potentialEnergy).toBeCloseTo(0.15, 1);
            expect(Math.abs(2 * kinetic / summary.potentialEnergy / 0.9 - 1)).toBeLessThan(1e-4);
        }
    });

    it('circular orbits: the rotation that equals the circular energy runs at exactly the circular speed', () => {
        const state = makeState(4000, [4000]);
        const probe = fillCloud(makeState(10, [10]), options, seeded(1));
        const beta = probe.table.circularEnergy / -probe.table.potentialEnergy;
        expect(beta).toBeGreaterThan(0.4);
        expect(beta).toBeLessThan(0.52);
        const summary = fillCloud(state, { ...options, virial: 2 * beta, rotation: beta }, seeded(4));
        expect(summary.rotationFactor).toBeCloseTo(1, 1);
        expect(summary.randomEnergy).toBeCloseTo(0, 8);
    });

    it('a cold cloud has no velocities; a rotation larger than the kinetic energy raises it', () => {
        const state = makeState(500, [500]);
        fillCloud(state, { ...options, virial: 0, rotation: 0 }, seeded(1));
        expect(state.velocities.every(x => x === 0)).toBe(true);
        const hot = makeState(500, [500]);
        const summary = fillCloud(hot, { ...options, virial: 0.1, rotation: 0.2 }, seeded(1));
        expect(summary.randomEnergy).toBe(0);
        expect(summary.rotationEnergy).toBeCloseTo(0.2 * summary.potentialEnergy, 8);
    });

    it('agitation of either kind has the dispersion the energy gives and no net momentum', () => {
        const count = 20000;
        for (const turbulence of ['white', 'correlated'] as const) {
            const state = makeState(count, [count]);
            const summary = fillCloud(state, { ...options, virial: 0.5, rotation: 0, turbulence }, seeded(4));
            const { velocities: v } = state;
            let sx = 0, sy = 0, s2 = 0;
            for (let i = 0; i < count; i++) { sx += v[i * 4]; sy += v[i * 4 + 1]; s2 += v[i * 4] ** 2 + v[i * 4 + 1] ** 2; }
            expect(summary.dispersion).toBeCloseTo(Math.sqrt(0.25 * summary.potentialEnergy / options.totalMass), 8);
            expect(Math.abs(sx / count)).toBeLessThan(1e-4 * summary.dispersion);
            expect(Math.abs(sy / count)).toBeLessThan(1e-4 * summary.dispersion);
            expect(Math.sqrt(s2 / (2 * count))).toBeCloseTo(summary.dispersion, 4);
        }
    });

    it('correlated agitation is alike between neighbors; white noise is not', () => {
        const count = 20000;
        const neighborCorrelation = (turbulence: 'white' | 'correlated'): number => {
            const state = makeState(count, [count]);
            fillCloud(state, { ...options, virial: 0.5, rotation: 0, turbulence }, seeded(6));
            const { positions: p, velocities: v } = state;
            // pair each particle with its next one in a sort by x then y on a coarse grid: neighbors within about 10 px
            const cells = new Map<number, number[]>();
            for (let i = 0; i < count; i++) {
                const key = Math.floor(p[i * 4] / 10) * 1000 + Math.floor(p[i * 4 + 1] / 10);
                cells.set(key, [...(cells.get(key) ?? []), i]);
            }
            let dot = 0, norm = 0;
            for (const members of cells.values()) {
                for (let k = 0; k + 1 < members.length; k += 2) {
                    const a = members[k], b = members[k + 1];
                    dot += v[a * 4] * v[b * 4] + v[a * 4 + 1] * v[b * 4 + 1];
                    norm += 0.5 * (v[a * 4] ** 2 + v[a * 4 + 1] ** 2 + v[b * 4] ** 2 + v[b * 4 + 1] ** 2);
                }
            }
            return dot / norm;
        };
        expect(Math.abs(neighborCorrelation('white'))).toBeLessThan(0.1);
        expect(neighborCorrelation('correlated')).toBeGreaterThan(0.9);
    });

    it('is replayable: the same stream gives the same cloud', () => {
        const a = makeState(300, [300]), b = makeState(300, [300]);
        fillCloud(a, { ...options, turbulence: 'correlated' }, seeded(9));
        fillCloud(b, { ...options, turbulence: 'correlated' }, seeded(9));
        expect(a.velocities).toEqual(b.velocities);
        expect(a.positions).toEqual(b.positions);
    });

    it('the defaults keep the energies of the old cloud: the old recipe on the disc is alpha 0.33 and beta 0.08', () => {
        // The cloud before this phase: tangential speed 0.44 v_circ of the sphere inside r (the mass inside r is the share x^2 of the
        // cloud's), white noise of 0.26 v_circ(R) of the sphere per component; its energies against the potential energy of the disc.
        const gravity = 3, totalMass = 1000, radius = 200, softening = 0.016 * 768 * 200 / (0.38 * 768);
        const sphere = (enclosed: number, r: number): number => Math.sqrt(gravity * enclosed * r * r / (r * r + softening * softening) ** 1.5);
        let rotation = 0;
        const n = 20000;
        for (let i = 0; i < n; i++) {
            const share = (i + 0.5) / n, speed = 0.44 * sphere(share * totalMass, radius * Math.sqrt(share));
            rotation += 0.5 * (totalMass / n) * speed * speed;
        }
        const random = totalMass * (0.26 * sphere(totalMass, radius)) ** 2;
        const probe = fillCloud(makeState(10, [10]), { ...options, gravity, totalMass, radius, softening }, seeded(1));
        const virial = 2 * (rotation + random) / probe.potentialEnergy, beta = rotation / probe.potentialEnergy;
        const sliders = defaultParams(PROTOSTAR);
        expect(virial).toBeGreaterThan(0.31);
        expect(virial).toBeLessThan(0.34);
        expect(beta).toBeGreaterThan(0.075);
        expect(beta).toBeLessThan(0.085);
        expect(Math.abs(sliders.alphaVir as number - virial) / virial).toBeLessThan(0.03);
        expect(Math.abs(sliders.betaRot as number - beta) / beta).toBeLessThan(0.03);
    });
});

describe('protostar declaration: the particle count', () => {
    it('the population parameter key of the declaration is a parameter', () => {
        expect(PROTOSTAR.params.some(p => p.key === PROTOSTAR_PARAM.count)).toBe(true);
    });
});

describe('protostar composition: mean molecular weight', () => {
    const factors = inverseMolecularWeights(PROTOSTAR_TYPES, 'mass', MAX_SPECIES);

    it('reads the atomic number from the element table by symbol', () => {
        expect(['H', 'He', 'C', 'Ne'].map(atomicNumber)).toEqual([1, 2, 6, 10]);
        expect(atomicNumber('Xx')).toBeNull();
    });

    it('is (1 + Z) / A for a fully ionised element', () => {
        expect(inverseMeanMolecularWeight(1, 1.00783)).toBeCloseTo(2 / 1.00783, 12);
        expect(inverseMeanMolecularWeight(2, 4.0026)).toBeCloseTo(3 / 4.0026, 12);
        expect(inverseMeanMolecularWeight(6, 12)).toBeCloseTo(7 / 12, 12);
        expect(inverseMeanMolecularWeight(1, 0)).toBe(0);
    });

    it('gives the molecular weights of the plan: mu(H) = 0.504, mu(He) = 1.334, a ratio of 2.65', () => {
        const [h, he, c] = factors;
        expect(1 / h).toBeCloseTo(0.504, 3);
        expect(1 / he).toBeCloseTo(1.334, 3);
        expect(h / he).toBeCloseTo(2.65, 2);
        expect(1 / c).toBeCloseTo(12 / 7, 12);
    });

    it('is the pair of the deposit sums: sum(m / mu) / sum(m) is the mean 1 / mu of the gas', () => {
        // 3 H and 1 He by number, deposited with their masses: X_H = 3.02349 / 7.02609.
        const masses = PROTOSTAR_TYPES.map(t => t.values.mass);
        const mass = 3 * masses[HYDROGEN] + masses[HELIUM];
        const deposited = (3 * masses[HYDROGEN] * factors[HYDROGEN] + masses[HELIUM] * factors[HELIUM]) / mass;
        // Atoms and electrons per u: 3 H -> 6 particles, 1 He -> 3 particles.
        expect(deposited).toBeCloseTo((3 * 2 + 3) / mass, 12);
    });

    it('follows the edited mass of a type and pads to the array size with 0', () => {
        const heavy: ParticleType[] = [{ ...PROTOSTAR_TYPES[HYDROGEN], values: { ...PROTOSTAR_TYPES[HYDROGEN].values, mass: 2 } }];
        const [first, ...rest] = inverseMolecularWeights(heavy, 'mass', MAX_SPECIES);
        expect(first).toBeCloseTo(1, 12);
        expect(rest).toHaveLength(MAX_SPECIES - 1);
        expect(rest.every(v => v === 0)).toBe(true);
        expect(inverseMolecularWeights(PROTOSTAR_TYPES, 'mass', 2)).toHaveLength(2);
    });

    it('takes Z = A / 2 for a symbol that is not an element', () => {
        const unknown: ParticleType = { name: 'x', symbol: 'Xx', color: '#fff', values: { mass: 16 } };
        expect(inverseMolecularWeights([unknown], 'mass', 1)[0]).toBeCloseTo((1 + 8) / 16, 12);
    });
});
