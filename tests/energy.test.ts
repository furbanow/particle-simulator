import { describe, expect, it } from 'vitest';
import { PROTOSTAR_ENERGY_RATIO_FLOOR } from '../src/config';
import { EnergyBalance, relativeDrift, virialRatio } from '../src/simulation/protostar/energy';
import {
    REDUCTION_FLOATS, REDUCTION_NO_THICKNESS, REDUCTION_TEXEL, REDUCTION_TEXELS, selfPotentialPerMassSquared, unpackReduction, type ReductionScales,
} from '../src/simulation/protostar/reduction';

describe('virial ratio 2K / |U|', () => {
    it('is 1 in virial equilibrium, below it for a cloud that falls in, above it for one that expands', () => {
        expect(virialRatio(1, -2)).toBe(1);
        expect(virialRatio(0.5, -2)).toBe(0.5);
        expect(virialRatio(3, -2)).toBe(3);
        expect(virialRatio(0, -2)).toBe(0);
    });

    it('uses the magnitude of the potential, whatever its sign', () => {
        expect(virialRatio(1, 2)).toBe(1);
    });

    it('is not defined without a potential: no gravity, or a potential lost in the kinetic energy', () => {
        expect(virialRatio(1, 0)).toBeNull();
        expect(virialRatio(0, 0)).toBeNull();
        expect(virialRatio(1, -PROTOSTAR_ENERGY_RATIO_FLOOR / 10)).toBeNull();
        expect(virialRatio(1, -PROTOSTAR_ENERGY_RATIO_FLOOR * 100)).not.toBeNull();
    });

    it('is not defined for numbers that are not numbers', () => {
        expect(virialRatio(NaN, -1)).toBeNull();
        expect(virialRatio(1, -Infinity)).toBeNull();
    });
});

describe('relative drift of the total energy', () => {
    it('is the change over the magnitude of the initial energy', () => {
        expect(relativeDrift(-0.99, -1)).toBeCloseTo(0.01, 12);        // energy gained: less bound
        expect(relativeDrift(-1.02, -1)).toBeCloseTo(-0.02, 12);       // energy lost
        expect(relativeDrift(-1, -1)).toBe(0);
    });

    it('divides by the magnitude, so a positive initial energy has the same sign convention', () => {
        expect(relativeDrift(2.2, 2)).toBeCloseTo(0.1, 12);
        expect(relativeDrift(1.8, 2)).toBeCloseTo(-0.1, 12);
    });

    it('is not defined from an initial energy of 0 or that is not a number', () => {
        expect(relativeDrift(1, 0)).toBeNull();
        expect(relativeDrift(1, NaN)).toBeNull();
        expect(relativeDrift(Infinity, -1)).toBeNull();
    });
});

describe('energy bookkeeping of a run', () => {
    it('takes the first reading as the initial energy and then follows the drift', () => {
        const balance = new EnergyBalance();
        expect(balance.initialEnergy).toBeNull();
        const first = balance.record(1, -3);
        expect(first).toEqual({ total: -2, drift: 0, virial: 2 / 3 });
        expect(balance.initialEnergy).toBe(-2);
        const later = balance.record(1.5, -3.5);                        // total -2 again: no drift
        expect(later?.drift).toBe(0);
        const lost = balance.record(1, -3.1);                           // -2.1: 5 % lost
        expect(lost?.drift).toBeCloseTo(-0.05, 12);
        expect(lost?.total).toBeCloseTo(-2.1, 12);
        expect(balance.initialEnergy).toBe(-2);
    });

    it('starts again after a restart: the next reading is the new initial energy', () => {
        const balance = new EnergyBalance();
        balance.record(1, -3);
        balance.record(1, -3.5);
        balance.reset();
        expect(balance.initialEnergy).toBeNull();
        const restarted = balance.record(2, -5);
        expect(restarted?.drift).toBe(0);
        expect(balance.initialEnergy).toBe(-3);
    });

    it('waits for a usable initial energy: a total lost in its parts has no scale to measure a drift against', () => {
        const balance = new EnergyBalance();
        const marginal = balance.record(1, -1);                         // K + U = 0: marginally bound
        expect(marginal).toEqual({ total: 0, drift: null, virial: 2 });
        expect(balance.initialEnergy).toBeNull();
        expect(balance.record(1, -1.5)?.drift).toBe(0);                 // this one becomes the initial energy
        expect(balance.initialEnergy).toBe(-0.5);
    });

    it('ignores a reading that is not finite, and keeps the initial energy it had', () => {
        const balance = new EnergyBalance();
        balance.record(1, -3);
        expect(balance.record(NaN, -3)).toBeNull();
        expect(balance.record(1, Infinity)).toBeNull();
        expect(balance.initialEnergy).toBe(-2);
        expect(new EnergyBalance().record(NaN, 1)).toBeNull();
    });

    it('measures a drift without gravity too (no potential: the virial ratio is blank, the energy is the kinetic one)', () => {
        const balance = new EnergyBalance();
        const first = balance.record(4, 0);
        expect(first).toEqual({ total: 4, drift: 0, virial: null });
        expect(balance.record(3, 0)?.drift).toBe(-0.25);
    });

    it('gives nothing for an empty reading', () => {
        const balance = new EnergyBalance();
        expect(balance.record(0, 0)).toEqual({ total: 0, drift: null, virial: null });
        expect(balance.initialEnergy).toBeNull();
    });
});

describe('the multichannel reduction', () => {
    const scales: ReductionScales = { massPerDeposit: 0.05, depositVelScale: 1 / 500, gravityPerDeposit: 4, softening: 10 };

    /** The texels of a reduction, from the sums a made-up cloud would give. */
    function texels(values: Partial<Record<keyof typeof REDUCTION_TEXEL, number[]>>): number[] {
        const out = new Array<number>(REDUCTION_FLOATS).fill(0);
        for (const [name, channels] of Object.entries(values)) {
            channels.forEach((v, c) => { out[REDUCTION_TEXEL[name as keyof typeof REDUCTION_TEXEL] * 4 + c] = v; });
        }
        return out;
    }

    it('lays out four texels of four floats, each in its own place', () => {
        expect(REDUCTION_TEXELS).toBe(4);
        expect(REDUCTION_FLOATS).toBe(16);
        expect(new Set(Object.values(REDUCTION_TEXEL)).size).toBe(REDUCTION_TEXELS);
        expect(Math.max(...Object.values(REDUCTION_TEXEL))).toBe(REDUCTION_TEXELS - 1);
    });

    it('keeps the layout of the original stats in the first three floats (density, temperature, fusion rate)', () => {
        const reduction = unpackReduction(texels({ core: [60, 7.5, 1234, 2000] }), scales, true);
        expect([reduction.peakDensity, reduction.peakTemperature, reduction.fusionRate]).toEqual([60, 7.5, 1234]);
        expect(reduction.mass).toBeCloseTo(2000 * 0.05, 12);
    });

    it('reads the densest cell, the extreme speed and the extreme acceleration as they are', () => {
        const reduction = unpackReduction(texels({ core: [1, 1, 0, 10], extremes: [512.5, 300.5, 123, 456] }), scales, true);
        expect(reduction.peak).toEqual({ x: 512.5, y: 300.5 });
        expect(reduction.maxSpeed).toBe(123);
        expect(reduction.maxAcceleration).toBe(456);
    });

    it('divides the first moments of the mass by the mass for the center of mass, and has none without mass', () => {
        const reduction = unpackReduction(texels({ core: [0, 0, 0, 4], moments: [4 * 100, 4 * 250, 0, 0] }), scales, true);
        expect(reduction.centerOfMass).toEqual({ x: 100, y: 250 });
        expect(unpackReduction(texels({}), scales, true).centerOfMass).toBeNull();
    });

    it('converts the momentum to mass x px/s: the deposit stores v / L', () => {
        const reduction = unpackReduction(texels({ core: [0, 0, 0, 10], moments: [0, 0, 0.2, -0.1] }), scales, true);
        // 0.2 deposit units x (1 / (1/500)) px/s x 0.05 mass per deposit unit
        expect(reduction.momentum.x).toBeCloseTo(0.2 * 500 * 0.05, 12);
        expect(reduction.momentum.y).toBeCloseTo(-0.1 * 500 * 0.05, 12);
    });

    it('converts the kinetic energy: half of the sum m |v / L|^2, back to px/s, in simulation mass', () => {
        const reduction = unpackReduction(texels({ energy: [8, 0, 0, 0] }), scales, true);
        expect(reduction.energy.kinetic).toBeCloseTo(0.5 * 8 * 500 * 500 * 0.05, 9);
    });

    it('takes the potential synchronized with the kinetic energy from the previous substep, and the other as "now"', () => {
        const synchronized = unpackReduction(texels({ energy: [0, -300, 0, -280] }), scales, true);
        expect(synchronized.energy.potential).toBeCloseTo(-280 * 0.05, 12);
        expect(synchronized.energy.potentialNow).toBeCloseTo(-300 * 0.05, 12);
        const alone = unpackReduction(texels({ energy: [0, -300, 0, -280] }), scales, false);
        expect(alone.energy.potential).toBeNull();                      // no stash was made: nothing to pair with the velocities
        expect(alone.energy.potentialNow).toBeCloseTo(-300 * 0.05, 12);
    });

    it('keeps the self-interaction G m^2 / epsilon as the per-unit kernel of the GPU correction', () => {
        expect(selfPotentialPerMassSquared(4, 10)).toBe(-0.4);
        expect(selfPotentialPerMassSquared(4, 0)).toBe(0);
    });

    it('takes the potential as the GPU corrected it (the self-interaction is removed cell by cell there)', () => {
        const reduction = unpackReduction(texels({ core: [0, 0, 0, 10], energy: [0, -280, 12, -260] }), scales, true);
        expect(reduction.energy.potentialNow).toBeCloseTo(-280 * 0.05, 12);
        expect(reduction.energy.potential).toBeCloseTo(-260 * 0.05, 12);
    });

    it('reads the smallest softening, and none without mass or with the marker of no cell', () => {
        expect(unpackReduction(texels({ core: [0, 0, 0, 10], energy: [0, 0, 7.5, 0] }), scales, true).minSoftening).toBe(7.5);
        expect(unpackReduction(texels({ core: [0, 0, 0, 10], energy: [0, 0, REDUCTION_NO_THICKNESS, 0] }), scales, true).minSoftening).toBeNull();
        expect(unpackReduction(texels({ energy: [0, 0, 7.5, 0] }), scales, true).minSoftening).toBeNull();
    });
});
