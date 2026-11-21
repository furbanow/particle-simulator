import { describe, expect, it } from 'vitest';
import { fft2d, sampleField, solenoidalField, type TurbulenceOptions } from '../src/simulation/protostar/turbulence';

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

const OPTIONS: TurbulenceOptions = { size: 64, slope: 3, kMin: 1, kMax: 8 };

/** The power per mode of a field, |vx(k)|^2 + |vy(k)|^2, on the n x n grid of wave indices (row by row). */
function spectrum(vx: Float64Array, vy: Float64Array, n: number): { power: Float64Array; divergence: Float64Array } {
    const [rx, ix, ry, iy] = [Float64Array.from(vx), new Float64Array(n * n), Float64Array.from(vy), new Float64Array(n * n)];
    fft2d(rx, ix, n);
    fft2d(ry, iy, n);
    const power = new Float64Array(n * n), divergence = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const c = j * n + i, kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n;
            power[c] = rx[c] ** 2 + ix[c] ** 2 + ry[c] ** 2 + iy[c] ** 2;
            // k . v(k), real and imaginary parts
            divergence[c] = Math.hypot(kx * rx[c] + ky * ry[c], kx * ix[c] + ky * iy[c]);
        }
    }
    return { power, divergence };
}

describe('2D FFT', () => {
    it('puts a single wave in its two bins, and a forward then backward transform returns the grid', () => {
        const n = 16;
        const re = new Float64Array(n * n), im = new Float64Array(n * n);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) re[j * n + i] = Math.cos(2 * Math.PI * (3 * i + 2 * j) / n);
        const original = Float64Array.from(re);
        fft2d(re, im, n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const wave = (i === 3 && j === 2) || (i === n - 3 && j === n - 2);
                expect(Math.hypot(re[j * n + i], im[j * n + i])).toBeCloseTo(wave ? n * n / 2 : 0, 8);
            }
        }
        fft2d(re, im, n, true);
        for (let c = 0; c < n * n; c++) {
            expect(re[c]).toBeCloseTo(original[c], 10);
            expect(im[c]).toBeCloseTo(0, 10);
        }
    });
});

describe('solenoidal Gaussian field', () => {
    it('has unit rms per component and zero mean, and is replayable', () => {
        const field = solenoidalField(OPTIONS, seeded(1));
        const cells = 64 * 64;
        let sum = 0, squares = 0;
        for (let c = 0; c < cells; c++) { sum += field.vx[c] + field.vy[c]; squares += field.vx[c] ** 2 + field.vy[c] ** 2; }
        expect(sum / (2 * cells)).toBeCloseTo(0, 12);
        expect(Math.sqrt(squares / (2 * cells))).toBeCloseTo(1, 12);
        expect(solenoidalField(OPTIONS, seeded(1)).vx).toEqual(field.vx);
        expect(solenoidalField(OPTIONS, seeded(2)).vx).not.toEqual(field.vx);
    });

    it('is divergence-free and keeps only the wave numbers asked for', () => {
        const options = { ...OPTIONS, kMin: 2, kMax: 6 };
        const field = solenoidalField(options, seeded(3));
        const { power, divergence } = spectrum(field.vx, field.vy, 64);
        const peak = Math.max(...power);
        for (let j = 0; j < 64; j++) {
            for (let i = 0; i < 64; i++) {
                const c = j * 64 + i, k = Math.hypot(i <= 32 ? i : i - 64, j <= 32 ? j : j - 64);
                expect(divergence[c]).toBeLessThan(1e-9 * Math.sqrt(peak));
                if (k < 2 - 1e-9 || k > 6 + 1e-9) expect(power[c]).toBeLessThan(1e-18 * peak);
            }
        }
    });

    it('has the power law asked for: the mean power per mode falls as k^-slope', () => {
        for (const slope of [2, 3, 4]) {
            const n = 64, shells = 9;
            const sum = new Float64Array(shells), modes = new Float64Array(shells), kSum = new Float64Array(shells);
            for (let seed = 1; seed <= 30; seed++) {
                const field = solenoidalField({ ...OPTIONS, slope }, seeded(100 + seed));
                const { power } = spectrum(field.vx, field.vy, n);
                for (let j = 0; j < n; j++) {
                    for (let i = 0; i < n; i++) {
                        const k = Math.hypot(i <= n / 2 ? i : i - n, j <= n / 2 ? j : j - n), shell = Math.round(k);
                        if (k < 1 || k > 8 || shell >= shells) continue;
                        sum[shell] += power[j * n + i]; modes[shell]++; kSum[shell] += k;
                    }
                }
            }
            // least-squares slope of log(mean power) against log(mean k) over the shells 1..8
            const xs: number[] = [], ys: number[] = [];
            for (let shell = 1; shell <= 8; shell++) { xs.push(Math.log(kSum[shell] / modes[shell])); ys.push(Math.log(sum[shell] / modes[shell])); }
            const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
            const fitted = xs.reduce((a, x, q) => a + (x - mx) * (ys[q] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
            expect(Math.abs(fitted + slope)).toBeLessThan(0.1);
        }
    });

    it('rejects a grid that is not a power of two', () => {
        expect(() => solenoidalField({ ...OPTIONS, size: 48 }, seeded(1))).toThrow();
    });
});

describe('sampling the field', () => {
    const field = solenoidalField({ ...OPTIONS, size: 16, kMax: 4 }, seeded(7));

    it('reads a cell at its own corner and the mean of four at their center', () => {
        expect(sampleField(field, 5, 9).x).toBeCloseTo(field.vx[9 * 16 + 5], 12);
        expect(sampleField(field, 5, 9).y).toBeCloseTo(field.vy[9 * 16 + 5], 12);
        const mean = (field.vx[9 * 16 + 5] + field.vx[9 * 16 + 6] + field.vx[10 * 16 + 5] + field.vx[10 * 16 + 6]) / 4;
        expect(sampleField(field, 5.5, 9.5).x).toBeCloseTo(mean, 12);
    });

    it('is periodic: one grid further reads the same', () => {
        const a = sampleField(field, 3.3, 12.7), b = sampleField(field, 3.3 + 16, 12.7 - 16), c = sampleField(field, 16 + 0.25, 15.5);
        expect(b.x).toBeCloseTo(a.x, 12);
        expect(b.y).toBeCloseTo(a.y, 12);
        expect(c.x).toBeCloseTo(sampleField(field, 0.25, -0.5).x, 12);
    });

    it('is smooth: nearby points read nearly the same, far ones do not', () => {
        let near = 0, far = 0;
        const random = seeded(4);
        for (let k = 0; k < 400; k++) {
            const u = random() * 16, v = random() * 16;
            const a = sampleField(field, u, v), b = sampleField(field, u + 0.2, v), c = sampleField(field, u + 8, v + 8);
            near += (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
            far += (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
        }
        expect(near).toBeLessThan(0.1 * far);
    });
});
