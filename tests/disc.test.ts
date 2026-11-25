import { describe, expect, it } from 'vitest';
import {
    buildDiscTable, discAcceleration, ellipticIntegrals, gaussLegendre, massWithin, panelEdges, radiusFraction, ringDensity, ringField,
    surfaceDensity,
} from '../src/simulation/protostar/disc';

describe('complete elliptic integrals', () => {
    it('K and E at known parameters', () => {
        expect(ellipticIntegrals(0).k).toBeCloseTo(Math.PI / 2, 14);
        expect(ellipticIntegrals(0).e).toBeCloseTo(Math.PI / 2, 14);
        expect(ellipticIntegrals(0.5).k).toBeCloseTo(1.8540746773013719, 13);
        expect(ellipticIntegrals(0.5).e).toBeCloseTo(1.3506438810476755, 13);
        expect(ellipticIntegrals(0.99).k).toBeCloseTo(3.6956373629898747, 12);
        expect(ellipticIntegrals(1 - 1e-12).e).toBeCloseTo(1, 10);
    });

    it('obey Legendre\'s relation E(m) K(1 - m) + E(1 - m) K(m) - K(m) K(1 - m) = pi / 2', () => {
        for (const m of [0.05, 0.3, 0.77, 0.999]) {
            const a = ellipticIntegrals(m), b = ellipticIntegrals(1 - m);
            expect(a.e * b.k + b.e * a.k - a.k * b.k).toBeCloseTo(Math.PI / 2, 12);
        }
    });
});

describe('Gauss-Legendre rule', () => {
    it('integrates the polynomials up to degree 2n - 1 exactly', () => {
        const { nodes, weights } = gaussLegendre(8);
        expect([...weights].reduce((a, b) => a + b, 0)).toBeCloseTo(2, 14);
        for (let k = 0; k <= 15; k++) {
            let sum = 0;
            for (let i = 0; i < 8; i++) sum += weights[i] * nodes[i] ** k;
            expect(sum).toBeCloseTo(k % 2 ? 0 : 2 / (k + 1), 13);
        }
    });
});

describe('the field of a ring', () => {
    /** The same integrals by the midpoint rule over the angle: the pull toward the center and the potential of a unit ring at (a), seen from r. */
    function brute(r: number, a: number, eps: number, steps = 200000): { pull: number; potential: number } {
        let pull = 0, potential = 0;
        for (let k = 0; k < steps; k++) {
            const phi = (k + 0.5) / steps * 2 * Math.PI;
            const d2 = r * r + a * a - 2 * r * a * Math.cos(phi) + eps * eps;
            pull += (r - a * Math.cos(phi)) / d2 ** 1.5 / steps;
            potential -= 1 / Math.sqrt(d2) / steps;
        }
        return { pull, potential };
    }

    it('agrees with the angular integral, inside, outside and near the ring', () => {
        for (const [r, a, eps] of [[0.3, 0.8, 0.05], [0.9, 0.2, 0.05], [0.5, 0.52, 0.05], [0.7, 0.7, 0.01], [0.01, 0.5, 0.02]]) {
            const field = ringField(r, a, eps), reference = brute(r, a, eps);
            expect(field.pull).toBeCloseTo(reference.pull, 6);
            expect(field.potential).toBeCloseTo(reference.potential, 8);
        }
    });

    it('is the softened pull of a point mass when the ring is a point, and pulls nothing at the center', () => {
        const point = ringField(2, 1e-9, 0.3);
        expect(point.pull).toBeCloseTo(2 / (4 + 0.09) ** 1.5, 9);
        expect(point.potential).toBeCloseTo(-1 / Math.sqrt(4 + 0.09), 9);
        expect(ringField(0, 0.5, 0.1).pull).toBe(0);
    });
});

describe('the mass profiles', () => {
    it('the share within a radius and its inverse', () => {
        for (const profile of ['uniform', 'maclaurin'] as const) {
            expect(massWithin(profile, 0)).toBe(0);
            expect(massWithin(profile, 1)).toBeCloseTo(1, 14);
            for (const m of [0.05, 0.3, 0.5, 0.9]) expect(massWithin(profile, radiusFraction(profile, m))).toBeCloseTo(m, 12);
        }
        expect(massWithin('uniform', 0.5)).toBe(0.25);
        expect(massWithin('maclaurin', 0.5)).toBeCloseTo(1 - 0.75 ** 1.5, 14);
    });

    it('the ring density integrates to one and is the derivative of the share within', () => {
        for (const profile of ['uniform', 'maclaurin'] as const) {
            const steps = 20000;
            let total = 0;
            for (let k = 0; k < steps; k++) total += ringDensity(profile, (k + 0.5) / steps) / steps;
            expect(total).toBeCloseTo(1, 4);
            const x = 0.4, h = 1e-6;
            expect(ringDensity(profile, x)).toBeCloseTo((massWithin(profile, x + h) - massWithin(profile, x - h)) / (2 * h), 6);
        }
    });

    it('the surface density is the mass over the area: pi R^2 Sigma = M for the uniform disc, 3/2 of it at the center of the Maclaurin one', () => {
        expect(surfaceDensity('uniform', 10, 5, 3) * Math.PI * 100).toBeCloseTo(5, 12);
        expect(surfaceDensity('maclaurin', 10, 5, 0) * Math.PI * 100).toBeCloseTo(7.5, 12);
        expect(surfaceDensity('maclaurin', 10, 5, 10)).toBeCloseTo(0, 12);
        expect(surfaceDensity('uniform', 10, 5, 11)).toBe(0);
    });
});

describe('the quadrature\'s panels', () => {
    it('are sorted, inside the disc, with an edge at the field point and a graded cut towards the edge of the Maclaurin disc', () => {
        const edges = panelEdges('maclaurin', 1, 0.4, 0.02, 16, 16);
        expect(edges[0]).toBe(0);
        expect(edges[edges.length - 1]).toBe(1);
        for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
        expect(edges).toContain(0.4);
        expect(edges.some(e => Math.abs(e - 0.41) < 1e-12)).toBe(true);                    // r + eps / 2
        expect(edges.filter(e => e > 0.999).length).toBeGreaterThan(1);
        expect(panelEdges('uniform', 1, 0.4, 0.02, 16, 16).filter(e => e > 0.999).length).toBe(1);
    });
});

describe('the table of a disc', () => {
    const GM = 1000, R = 1;
    const options = { radius: R, gravity: GM, totalMass: 1, softening: 2e-4 };

    it('the uniform disc matches the closed forms: Phi = -4 G Sigma R E(r/R), g = 4 G Sigma (K - E) / (r/R)', () => {
        const table = buildDiscTable({ ...options, profile: 'uniform' });
        const sigma = GM / (Math.PI * R * R);
        for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
            const { k, e } = ellipticIntegrals(x * x);       // the modulus is x: m = x^2
            expect(table.pullAt(x * R) / (4 * sigma * (k - e) / x)).toBeCloseTo(1, 2);
            const j = Math.round(x * table.nodes);
            expect(table.potential[j] / (-4 * sigma * R * ellipticIntegrals((j / table.nodes) ** 2).e)).toBeCloseTo(1, 3);
        }
        // the energy of a thin uniform disc: U = -8 G M^2 / (3 pi R)
        expect(table.potentialEnergy / (-8 * GM / (3 * Math.PI))).toBeCloseTo(1, 3);
        // and a disc held up by rotation alone has half of |U| in motion (the virial theorem of a force without a scale)
        expect(table.circularEnergy / -table.potentialEnergy).toBeCloseTo(0.5, 2);
    });

    it('the Maclaurin disc\'s pull is linear: g = (3 pi / 4) G M r / R^3, its energy U = -3 pi G M^2 / (10 R)', () => {
        const table = buildDiscTable({ ...options, profile: 'maclaurin' });
        for (const x of [0.05, 0.2, 0.5, 0.8, 0.9]) {
            expect(table.pullAt(x * R) / (0.75 * Math.PI * GM * x)).toBeCloseTo(1, 2);
        }
        expect(table.potentialEnergy / (-0.3 * Math.PI * GM)).toBeCloseTo(1, 3);
        expect(table.circularEnergy / -table.potentialEnergy).toBeCloseTo(0.5, 3);
        expect(table.potential[0] / (-0.75 * Math.PI * GM)).toBeCloseTo(1, 3);              // Phi(0) = -(3 pi / 4) G M / R ... x 1.0
    });

    it('is the same at twice the nodes, and scales as G M and as 1 / R^2', () => {
        const fine = buildDiscTable({ ...options, softening: 0.04, profile: 'uniform', nodes: 512 });
        const coarse = buildDiscTable({ ...options, softening: 0.04, profile: 'uniform', nodes: 128 });
        for (const x of [0.07, 0.3, 0.77, 0.95]) expect(coarse.pullAt(x) / fine.pullAt(x)).toBeCloseTo(1, 3);
        expect(coarse.potentialEnergy / fine.potentialEnergy).toBeCloseTo(1, 4);
        const doubled = buildDiscTable({ radius: 2, gravity: GM, totalMass: 2, softening: 0.08, profile: 'uniform', nodes: 128 });
        expect(doubled.pullAt(0.6) / coarse.pullAt(0.3)).toBeCloseTo(2 / 4, 6);            // g ~ G M / R^2 at the same x
        expect(doubled.potentialEnergy / coarse.potentialEnergy).toBeCloseTo(4 / 2, 6);    // U ~ G M^2 / R
    });

    it('softening weakens the pull and the binding, most at the edge of the uniform disc, where the pull would be infinite', () => {
        const sharp = buildDiscTable({ ...options, softening: 0.002, profile: 'uniform' });
        const soft = buildDiscTable({ ...options, softening: 0.05, profile: 'uniform' });
        expect(soft.pullAt(R)).toBeLessThan(0.5 * sharp.pullAt(R));
        expect(soft.pullAt(0.5)).toBeLessThan(sharp.pullAt(0.5));
        expect(-soft.potentialEnergy).toBeLessThan(-sharp.potentialEnergy);
        expect(sharp.pullAt(R)).toBeGreaterThan(sharp.pullAt(0.9) * 1.2);                   // the log divergence of a disc's edge
    });

    it('the circular speed is sqrt(r g), zero at the center, and the acceleration points at the center', () => {
        const table = buildDiscTable({ ...options, softening: 0.04, profile: 'uniform', nodes: 128 });
        expect(table.circularSpeedAt(0)).toBe(0);
        expect(table.circularSpeedAt(0.5)).toBeCloseTo(Math.sqrt(0.5 * table.pullAt(0.5)), 12);
        const a = discAcceleration(table, 0.3, -0.4);
        expect(Math.hypot(a.x, a.y)).toBeCloseTo(table.pullAt(0.5), 12);
        expect(a.x).toBeLessThan(0);
        expect(a.y).toBeGreaterThan(0);
        expect(a.x * -0.4 - a.y * 0.3).toBeCloseTo(0, 12);                                  // along the radius
        expect(discAcceleration(table, 0, 0)).toEqual({ x: 0, y: 0 });
    });

    it('rejects an odd number of intervals', () => {
        expect(() => buildDiscTable({ ...options, profile: 'uniform', nodes: 7 })).toThrow();
    });

    it('the sphere formula would over-rotate the inner disc and under-rotate the edge of the uniform disc (the professor\'s figures)', () => {
        const softening = 0.016 / 0.38;                     // the default cloud: 1.6 % of L over 38 % of L, in units of R
        const table = buildDiscTable({ ...options, softening, profile: 'uniform' });
        const sphere = (x: number): number => Math.sqrt(GM * x * x * x * x * R * R / (x * x * R * R + softening * softening * R * R) ** 1.5);
        const ratio = (x: number): number => table.circularSpeedAt(x * R) / sphere(x);
        expect(1 / ratio(0.07)).toBeCloseTo(3, 1);          // the sphere's rotation is up to 3 times too fast near 0.07 R...
        expect(1 / ratio(0.5)).toBeGreaterThan(1.2);
        expect(1 / ratio(1)).toBeCloseTo(0.694, 2);         // ...and 0.69 of the disc's at the edge (the disc's is 1.44 times the sphere's)
        expect(ratio(1)).toBeCloseTo(1.44, 2);
    });
});
