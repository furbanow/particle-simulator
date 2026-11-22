import { describe, expect, it } from 'vitest';
import {
    directEnergies, driftStatistics, gridGravity, gridPotentialSum, orbitalPeriod, reductionReference, type GridGravityOptions,
    type ReductionGrids,
} from '../src/lab/energyReference';
import { referenceDeposit } from '../src/lab/depositReference';
import { mulberry32 } from '../src/lab/random';
import { selfPotentialPerMassSquared } from '../src/simulation/protostar/reduction';
import type { DepositInputs } from '../src/simulation/protostar/grids';

const texel = (x: number, y: number, type = 0, w = 1): number[] => [x, y, type, w];

describe('lab: direct energies', () => {
    it('sums the kinetic energy and the Plummer energy of the pairs', () => {
        const positions = [...texel(0, 0), ...texel(3, 4), ...texel(100, 100, 0, -1)];     // the last one is removed
        const velocities = [1, 0, 0, 0, 0, 2, 0, 0, 50, 50, 0, 0];
        const e = directEnergies(positions, velocities, 3, [2], 10, 1);
        expect(e.particles).toBe(2);
        expect(e.kinetic).toBeCloseTo(0.5 * 2 * 1 + 0.5 * 2 * 4, 12);
        expect(e.potential).toBeCloseTo(-10 * 2 * 2 / Math.sqrt(25 + 1), 12);
    });

    it('takes the mass of each type', () => {
        const e = directEnergies([...texel(0, 0, 0), ...texel(0, 3, 1)], [0, 0, 0, 0, 0, 0, 0, 0], 2, [1, 4], 2, 0);
        expect(e.potential).toBeCloseTo(-2 * 1 * 4 / 3, 12);
    });
});

describe('lab: the grid gravity twin', () => {
    const options: GridGravityOptions = { resolution: 16, coarseFactor: 4, nearRadius: 1, cell: 1, softening: 0.5, gravityPerDeposit: 3 };
    const at = (x: number, y: number): number => y * options.resolution + x;

    it('gives a cell its own mass at distance 0: potential -G M / epsilon, no force', () => {
        const mass = new Float64Array(256);
        mass[at(5, 5)] = 2;
        const g = gridGravity(mass, options);
        expect(g.phi[at(5, 5)]).toBeCloseTo(-3 * 2 / 0.5, 12);
        expect(g.ax[at(5, 5)]).toBe(0);
        expect(g.ay[at(5, 5)]).toBe(0);
    });

    it('sums the near cells one by one: the Plummer potential and force of a point mass', () => {
        const mass = new Float64Array(256);
        mass[at(5, 5)] = 2;
        const g = gridGravity(mass, options);
        const r = 3, s = 1 / Math.sqrt(r * r + 0.25);
        expect(g.phi[at(8, 5)]).toBeCloseTo(-3 * 2 * s, 12);
        expect(g.ax[at(8, 5)]).toBeCloseTo(-3 * 2 * r * s ** 3, 12);          // pulled toward the mass, at lower x
        expect(g.ay[at(8, 5)]).toBeCloseTo(0, 12);
    });

    it('puts the far coarse cells at their center of mass', () => {
        const mass = new Float64Array(256);
        mass[at(1, 1)] = 1;
        mass[at(2, 2)] = 3;                                                   // both in coarse cell (0, 0): center of mass (2.25, 2.25) in cells
        const g = gridGravity(mass, options);
        const centre = 2.25 * options.cell;
        const rx = centre - 15.5, ry = centre - 15.5;
        expect(g.phi[at(15, 15)]).toBeCloseTo(-3 * 4 / Math.sqrt(rx * rx + ry * ry + 0.25), 12);
    });

    it('has a force that is the gradient of its potential, away from the mass distribution\'s discontinuities', () => {
        const mass = new Float64Array(256);
        mass[at(2, 2)] = 5;
        const g = gridGravity(mass, { ...options, nearRadius: 2 });
        // Central difference of the potential across a far cell (the whole map is one smooth monopole there).
        const dphi = (g.phi[at(13, 12)] - g.phi[at(11, 12)]) / 2;
        expect(dphi).toBeCloseTo(-g.ax[at(12, 12)], 2);
    });

    it('a particle\'s own potential energy is removed by the self term: the pair sum is recovered', () => {
        // 150 particles of mass 1 deposit unit, uniform in a disk of 40 cells, 2 cells of softening.
        const random = mulberry32(5);
        const res = 64;
        const eps = 2;
        const grid: GridGravityOptions = { resolution: res, coarseFactor: 4, nearRadius: 2, cell: 1, softening: eps, gravityPerDeposit: 1 };
        const texels: number[] = [];
        for (let i = 0; i < 150; i++) {
            const r = 20 * Math.sqrt(random()), a = 2 * Math.PI * random();
            texels.push(32 + r * Math.cos(a), 32 + r * Math.sin(a), 0, 1);
        }
        const inputs: DepositInputs = {
            gridResolution: res, gridCell: 1, depositMassScale: 1, splatMass: [1], inverseMolecularWeight: [1],
        };
        const deposit = referenceDeposit(texels, 150, inputs, 0);
        const field = gridGravity(deposit.mass, grid);
        const raw = gridPotentialSum(deposit.mass, field.phi);
        const corrected = raw - 0.5 * selfPotentialPerMassSquared(1, eps) * 150;           // sum m^2 = 150
        const direct = directEnergies(texels, new Array(600).fill(0), 150, [1], 1, eps).potential;
        const errorRaw = Math.abs(raw - direct) / Math.abs(direct);
        const errorCorrected = Math.abs(corrected - direct) / Math.abs(direct);
        expect(errorRaw).toBeGreaterThan(0.03);                  // the self-interaction is not negligible at this few particles
        expect(errorCorrected).toBeLessThan(0.02);
        expect(errorCorrected).toBeLessThan(errorRaw / 3);
    });
});

describe('lab: the reduction twin', () => {
    // A 4 x 4 grid in blocks of 2 x 2; cells are 10 px.
    const res = 4;
    const zeros = (): number[] => new Array<number>(res * res * 4).fill(0);
    const cellOf = (x: number, y: number): number => (y * res + x) * 4;

    function grids(): ReductionGrids & { gas: number[] } {
        const gas = zeros(), thermo = zeros(), moments = zeros(), composition = zeros(), force = zeros(), power = zeros();
        // cell (1, 0) in block (0, 0): density 3, temperature 8 (fusionTRef 2: T0 units 4), mean velocity (3, 4)
        gas.splice(cellOf(1, 0), 4, 3, 8, 3, 4);
        moments.splice(cellOf(1, 0), 4, 2, 0.5, -0.25, 6);
        composition[cellOf(1, 0) + 2] = 4;
        force.splice(cellOf(1, 0), 4, -3, 4, -7, 0);
        // cell (2, 3) in block (1, 1): a denser one
        gas.splice(cellOf(2, 3), 4, 9, 2, 0, 0);
        thermo.splice(cellOf(2, 3), 4, 2, 100, 1.5, 0);     // the factor mu / mu_H of that cell: z
        moments.splice(cellOf(2, 3), 4, 1, 1, 1, 1);
        composition[cellOf(2, 3) + 2] = 1;
        force.splice(cellOf(2, 3), 4, 6, 8, -1, 0);
        power[cellOf(2, 3) + 1] = 5;
        power[cellOf(1, 0) + 1] = 2;
        return { gas, thermo, moments, composition, force, power, resolution: res, block: 2, cell: 10, fusionTRef: 2 };
    }

    it('finds the densest cell, with its temperature and position', () => {
        const r = reductionReference(grids());
        expect(r.peakDensity).toBe(9);
        expect(r.peakTemperature).toBe(1.5);      // the dispersion 2 times the factor 1.5, over fusionTRef 2
        expect(r.peak).toEqual({ x: 25, y: 35 });
    });

    it('sums mass, fusions, momentum, first moments and energies over the cells', () => {
        const r = reductionReference(grids());
        expect(r.mass).toBe(3);
        expect(r.fusionRate).toBe(7);
        expect(r.momentum).toEqual({ x: 1.5, y: 0.75 });
        expect(r.massPosition).toEqual({ x: 2 * 15 + 1 * 25, y: 2 * 5 + 1 * 35 });
        expect(r.doubleKinetic).toBe(7);
        expect(r.potential).toBe(0.5 * 2 * -7 + 0.5 * 1 * -1);
        expect(r.massSquared).toBe(5);
    });

    it('bounds the speed by |mean velocity| + sqrt(T) and the acceleration by |a|, over the cells that hold something', () => {
        const r = reductionReference(grids());
        expect(r.maxSpeed).toBeCloseTo(5 + Math.sqrt(8), 12);
        expect(r.maxAcceleration).toBe(10);
    });

    it('keeps the first of two equal densities in the reduction\'s scan order: blocks first, then cells', () => {
        const g = grids();
        g.gas[cellOf(0, 2)] = 9;                      // block (0, 1): after block (0, 0) and (1, 0) and before (1, 1)
        g.gas[cellOf(0, 2) + 1] = 100;
        expect(reductionReference(g).peak).toEqual({ x: 5, y: 25 });
    });
});

describe('lab: orbits', () => {
    it('has the Kepler period without softening', () => {
        const G = 4, M = 100, r = 7;
        expect(orbitalPeriod(G, M, r, 0)).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / (G * M)), 12);
    });

    it('is longer inside the softening length than the Kepler value (the pull is weaker)', () => {
        expect(orbitalPeriod(4, 100, 1, 2)).toBeGreaterThan(orbitalPeriod(4, 100, 1, 0));
    });
});

describe('lab: drift statistics', () => {
    const orbits = Array.from({ length: 200 }, (_, i) => i * 0.5);

    it('recovers the slope and the amplitude of the oscillation about it', () => {
        // Readings every 0.05 orbit, an oscillation of half an orbit (four of its periods in the 2-orbit window of the trend).
        const fine = Array.from({ length: 400 }, (_, i) => i * 0.05);
        const drifts = fine.map(o => -0.001 * o + 0.004 * Math.sin(o * 4 * Math.PI));
        const s = driftStatistics(fine, drifts)!;
        expect(s.count).toBe(400);
        expect(s.slopePerOrbit).toBeCloseTo(-0.001, 4);
        expect(s.oscillation).toBeGreaterThan(0.0036);
        expect(s.oscillation).toBeLessThan(0.0042);
        expect(s.final).toBe(drifts[399]);
        expect(s.maxAbs).toBeGreaterThan(0.019);
    });

    it('does not take the curvature of a drift that speeds up for an oscillation', () => {
        const curved = orbits.map(o => 0.00002 * o * o);
        const s = driftStatistics(orbits, curved)!;
        expect(s.oscillation).toBeLessThan(0.0001);
        expect(s.maxAbs).toBeCloseTo(0.00002 * 99.5 ** 2, 9);
    });

    it('starts from a given time: the settling is left out', () => {
        const drifts = orbits.map(o => o < 10 ? 0.5 : 0.001);
        const all = driftStatistics(orbits, drifts)!;
        const settled = driftStatistics(orbits, drifts, 10)!;
        expect(all.maxAbs).toBe(0.5);
        expect(settled.maxAbs).toBe(0.001);
        expect(settled.count).toBe(180);
        expect(settled.oscillation).toBeCloseTo(0, 12);
    });

    it('has nothing to say about fewer than three readings, nor about readings that are not numbers', () => {
        expect(driftStatistics([0, 1], [0, 0.1])).toBeNull();
        expect(driftStatistics([0, 1, 2], [NaN, NaN, 0.1])).toBeNull();
        expect(driftStatistics([], [])).toBeNull();
    });
});
