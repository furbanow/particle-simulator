import { describe, expect, it } from 'vitest';
import { PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_T0_KELVIN } from '../src/config';
import { defaultParams } from '../src/simulation/params';
import { PROTOSTAR, PROTOSTAR_PARAM, PROTOSTAR_REACTIONS } from '../src/simulation/protostar/declaration';
import {
    fusionLawOf, ignitionKelvins, ignitionRatio, ignitionTemperature, ignitionTemperatures,
} from '../src/simulation/protostar/ignition';
import { fusionRate, type FusionLaw } from '../src/simulation/protostar/reactions';

const params = defaultParams(PROTOSTAR);
const H = 0, HE = 1;

describe('ignition temperature', () => {
    it('reads the law of each reaction from the parameter values', () => {
        const hydrogen = fusionLawOf(PROTOSTAR_REACTIONS[H], params);
        expect(hydrogen.rate).toBe(params[PROTOSTAR_PARAM.fusionRate]);
        expect([hydrogen.densityExponent, hydrogen.reference, hydrogen.power, hydrogen.barrierPower]).toEqual([1, 1, 2 / 3, 1 / 3]);
        expect(hydrogen.barrier).toBeCloseTo(33.8 / Math.cbrt(15), 12);
        const helium = fusionLawOf(PROTOSTAR_REACTIONS[HE], params);
        expect(helium.densityExponent).toBe(2);
        expect(helium.reference).toBeCloseTo(1e8 / PROTOSTAR_T0_KELVIN, 12);
        expect(helium.rate).toBe(params[PROTOSTAR_PARAM.heFusionRate]);
        expect([helium.power, helium.barrier, helium.barrierPower]).toEqual([3, 44, 1]);
    });

    it('a missing parameter gives a law that never fires', () => {
        expect(fusionLawOf(PROTOSTAR_REACTIONS[H], {}).rate).toBe(0);
        expect(ignitionTemperature(fusionLawOf(PROTOSTAR_REACTIONS[H], {}), 100, 0.1)).toBe(Infinity);
    });

    it('is the inverse of the rate law (the twin of fusionRateOf in the shader)', () => {
        for (const reaction of PROTOSTAR_REACTIONS) {
            const law = fusionLawOf(reaction, params);
            for (const density of [1, 10, 100, 1e3]) {
                for (const rate of [1e-3, 0.1, 1, 50]) {
                    const t = ignitionTemperature(law, density, rate);
                    if (!Number.isFinite(t)) continue;       // a rate above the (very hot) maximum of the law
                    expect(fusionRate(law, density, t)).toBeCloseTo(rate, 6 - Math.ceil(Math.log10(Math.max(rate, 1))));
                }
            }
        }
    });

    it('solves the Gamow law: at the density and rate where lambda rho f(T) / f(T_ref) = rate', () => {
        // The hydrogen law at T = T_ref gives lambda rho: the rate wanted there is its own ignition at T_ref.
        const law = fusionLawOf(PROTOSTAR_REACTIONS[H], params);
        expect(ignitionTemperature(law, 100, law.rate * 100)).toBeCloseTo(1, 10);
        const helium = fusionLawOf(PROTOSTAR_REACTIONS[HE], params);
        expect(ignitionTemperature(helium, 100, helium.rate * 100 ** 2)).toBeCloseTo(helium.reference, 10);
    });

    it('rises when the density falls and falls when the law has a higher density exponent', () => {
        const law: FusionLaw = { rate: 1e-4, densityExponent: 1, reference: 1, power: 2 / 3, barrier: 13.7, barrierPower: 1 / 3 };
        expect(ignitionTemperature(law, 10, 0.1)).toBeGreaterThan(ignitionTemperature(law, 100, 0.1));
        expect(ignitionTemperature(law, 100, 1)).toBeGreaterThan(ignitionTemperature(law, 100, 0.1));
        const dense = { ...law, densityExponent: 2 };
        expect(ignitionTemperature(dense, 100, 0.1)).toBeLessThan(ignitionTemperature(law, 100, 0.1));
    });

    it('is infinite when no finite temperature gives the rate', () => {
        const law: FusionLaw = { rate: 1e-4, densityExponent: 1, reference: 1, power: 2 / 3, barrier: 13.7, barrierPower: 1 / 3 };
        expect(ignitionTemperature(law, 0, 0.1)).toBe(Infinity);
        expect(ignitionTemperature(law, 100, 0)).toBe(Infinity);
        expect(ignitionTemperature(law, 100, PROTOSTAR_FUSION_RATE_MAX)).toBe(Infinity);
        expect(ignitionTemperature({ ...law, rate: 0 }, 100, 0.1)).toBe(Infinity);
        expect(ignitionTemperature({ ...law, barrier: 0, power: 0 }, 100, 0.1)).toBe(Infinity);
    });

    it('lists every reaction in kelvins', () => {
        const t0 = ignitionTemperatures(PROTOSTAR_REACTIONS, params, 100, 0.1);
        expect(t0).toHaveLength(PROTOSTAR_REACTIONS.length);
        expect(ignitionKelvins(t0)[H]).toBeCloseTo(t0[H] * PROTOSTAR_T0_KELVIN, 3);
    });

    it('the ignition ratio He / H of the defaults at the lab\'s reference point is that of the two temperatures, and below the real 6.7 only by the calibration', () => {
        // 0.5 fusions per second per particle at 60 rho0: about what the core of the default cloud has once it burns. The ratio
        // depends on the point (the laws have different steepnesses and density exponents); the temperatures are those of the gas.
        const ratio = ignitionRatio(PROTOSTAR_REACTIONS, params, 60, 0.5, H, HE);
        const [hydrogen, helium] = ignitionTemperatures(PROTOSTAR_REACTIONS, params, 60, 0.5);
        expect(ratio).toBeCloseTo(helium / hydrogen, 12);
    });

    it('the ratio is NaN when a temperature is not finite', () => {
        expect(ignitionRatio(PROTOSTAR_REACTIONS, params, 0, 0.1, H, HE)).toBeNaN();
    });
});
