import { describe, expect, it } from 'vitest';
import {
    PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_GRAVITY_SLIDER, PROTOSTAR_GRAVITY_UNIT, PROTOSTAR_ROTATION_ENERGY_SLIDER, PROTOSTAR_SOFTENING_SLIDER,
    PROTOSTAR_THICKNESS_CEILING, PROTOSTAR_THICKNESS_Q_FACTOR, PROTOSTAR_THICKNESS_REFERENCE, PROTOSTAR_VIRIAL_SLIDER, TOTAL_MASS,
} from '../src/config';
import {
    initialThickness, lawDensityFactor, layerThickness, meanThickness2, pairSoftening2, softenedGravityAt, thicknessPerDispersion,
    type ThicknessGrid,
} from '../src/simulation/protostar/thickness';
import { cellToomre } from '../src/simulation/protostar/stability';

const L = 768;
const G = PROTOSTAR_GRAVITY_SLIDER.default * PROTOSTAR_GRAVITY_UNIT * L ** 3 / TOTAL_MASS;
const R = PROTOSTAR_CLOUD_RADIUS * L;
const rho0 = TOTAL_MASS / (Math.PI * R * R);
const bounds = { floor: 8, ceiling: PROTOSTAR_THICKNESS_CEILING * R };

describe('adaptive thickness (A11)', () => {
    it('is the scale height sigma_z^2 / (pi G Sigma) of a sheet, sigma_z^2 = t / 2', () => {
        const per = thicknessPerDispersion(G, rho0);
        const t = 400, sigma = 3;
        expect(layerThickness(t, sigma, per, { floor: 0, ceiling: Infinity })).toBeCloseTo((t / 2) / (Math.PI * G * rho0 * sigma), 9);
    });

    it('is bounded by a cell below and by the ceiling above; an empty cell takes the ceiling', () => {
        const per = thicknessPerDispersion(G, rho0);
        expect(layerThickness(0, 5, per, bounds)).toBe(bounds.floor);
        expect(layerThickness(1e9, 0.01, per, bounds)).toBe(bounds.ceiling);
        expect(layerThickness(10, 0, per, bounds)).toBe(bounds.ceiling);
    });

    it('softens a pair symmetrically, and gives the fixed softening back exactly when every cell has it', () => {
        expect(pairSoftening2(4, 16)).toBe(pairSoftening2(16, 4));
        for (const eps of [12.288, 0.1 + 0.2, 7.3e-3, 1e5 / 3]) {
            const e2 = Math.fround(eps * eps);
            expect(Math.fround(pairSoftening2(e2, e2))).toBe(e2);
        }
    });

    it('has the default softening as the law\'s reference thickness, so a layer that thick reads the surface density', () => {
        expect(PROTOSTAR_THICKNESS_REFERENCE).toBeCloseTo(PROTOSTAR_SOFTENING_SLIDER.default / 100, 12);
        expect(lawDensityFactor(5, 5)).toBe(1);
        expect(lawDensityFactor(2.5, 5)).toBe(2);   // twice thinner: twice the volume density
    });

    it('softens a monopole with the mass-weighted mean of h^2', () => {
        expect(meanThickness2([1, 3], [4, 8], 99)).toBe(7);
        expect(meanThickness2([0, 0], [4, 8], 99)).toBe(99);
    });

    it('starts the default cloud at about 0.026 L (the professor\'s figure); a virial cloud at 0.42 R with |U| unsoftened, 0.31 R self-consistently', () => {
        const common = { radius: R, gravity: G, totalMass: TOTAL_MASS, profile: 'uniform' as const, softening: 0.016 * L, bounds };
        const h0 = initialThickness({ ...common, virial: PROTOSTAR_VIRIAL_SLIDER.default, rotation: PROTOSTAR_ROTATION_ENERGY_SLIDER.default });
        expect(h0 / L).toBeGreaterThan(0.024);
        expect(h0 / L).toBeLessThan(0.028);
        // The professor's h / R = 0.4 of an isotropic virial core takes |U| of a thin disc (0.847 G M^2 / R): one step from no softening.
        const open = { ...common, virial: 1, rotation: 0, bounds: { floor: 0, ceiling: Infinity } };
        expect(initialThickness({ ...open, softening: 1e-6 * R, iterations: 1 }) / R).toBeCloseTo(0.847 / 2, 2);
        // A layer that thick softens its own |U|: the fixed point is lower.
        const virial = initialThickness({ ...open, iterations: 12 });
        expect(virial / R).toBeGreaterThan(0.29);
        expect(virial / R).toBeLessThan(0.33);
        expect(initialThickness({ ...common, virial: 0, rotation: 0 })).toBe(bounds.floor);      // a cold cloud: the floor
    });

    it('multiplies Q by 0.8 + 0.7 sigma_z / sigma_R = 1.5 for an isotropic layer', () => {
        expect(PROTOSTAR_THICKNESS_Q_FACTOR).toBeCloseTo(1.5, 12);
        expect(cellToomre(2, 100, 4, 3, PROTOSTAR_THICKNESS_Q_FACTOR)).toBeCloseTo(1.5 * cellToomre(2, 100, 4, 3), 12);
    });

    describe('the two-level sum with a softening per cell', () => {
        const res = 16, factor = 4, near = 1, cell = 8;
        const random = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const grid = (rand: () => number): ThicknessGrid => {
            const mass = new Float64Array(res * res), h2 = new Float64Array(res * res);
            for (let k = 0; k < res * res; k++) { mass[k] = rand() < 0.7 ? rand() : 0; h2[k] = (cell * (1 + 3 * rand())) ** 2; }
            return { res, cell, mass, h2 };
        };

        it('keeps action and reaction exact between the cells summed one by one', () => {
            // Two cells only, in the same coarse cell: the force of each on the other, per unit of mass, times its own mass, cancel.
            const g = grid(random(7));
            g.mass = new Float64Array(res * res);
            const a = 5 * res + 4, b = 6 * res + 6;
            (g.mass as Float64Array)[a] = 2; (g.mass as Float64Array)[b] = 5;
            const fa = softenedGravityAt(g, factor, near, 4, 5), fb = softenedGravityAt(g, factor, near, 6, 6);
            expect(2 * fa[0] + 5 * fb[0]).toBeCloseTo(0, 12);
            expect(2 * fa[1] + 5 * fb[1]).toBeCloseTo(0, 12);
        });

        it('is the fixed softening\'s sum when every cell has the same thickness', () => {
            const g = grid(random(11));
            const eps2 = 150;
            const fixed = { ...g, h2: new Float64Array(res * res).fill(eps2) };
            // The fixed-softening sum, written out.
            const [ax, ay] = softenedGravityAt(fixed, factor, near, 9, 3);
            let bx = 0, by = 0;
            const x = 9.5 * cell, y = 3.5 * cell;
            for (let cj = 0; cj < res / factor; cj++) for (let ci = 0; ci < res / factor; ci++) {
                const isNear = Math.max(Math.abs(ci - 2), Math.abs(cj - 0)) <= near;
                let m = 0, mx = 0, my = 0;
                for (let dj = 0; dj < factor; dj++) for (let di = 0; di < factor; di++) {
                    const fi = ci * factor + di, fj = cj * factor + dj, mk = g.mass[fj * res + fi];
                    const cx = (fi + 0.5) * cell, cy = (fj + 0.5) * cell;
                    if (isNear) {
                        const s = 1 / Math.sqrt((cx - x) ** 2 + (cy - y) ** 2 + eps2);
                        bx += mk * (cx - x) * s ** 3; by += mk * (cy - y) * s ** 3;
                    } else { m += mk; mx += mk * cx; my += mk * cy; }
                }
                if (!isNear && m > 0) {
                    const s = 1 / Math.sqrt((mx / m - x) ** 2 + (my / m - y) ** 2 + eps2);
                    bx += m * (mx / m - x) * s ** 3; by += m * (my / m - y) * s ** 3;
                }
            }
            expect(ax).toBeCloseTo(bx, 12);
            expect(ay).toBeCloseTo(by, 12);
        });

        it('pulls less where the layer is thicker', () => {
            const g = grid(random(3));
            const thin = { ...g, h2: new Float64Array(res * res).fill(cell * cell) };
            const thick = { ...g, h2: new Float64Array(res * res).fill(16 * cell * cell) };
            const pull = (gg: ThicknessGrid): number => Math.hypot(...softenedGravityAt(gg, factor, near, 2, 2).slice(0, 2));
            expect(pull(thick)).toBeLessThan(pull(thin));
        });
    });
});
