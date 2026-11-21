// A correlated random velocity field with a power-law spectrum, for the initial agitation of the protostar's cloud (the
// alternative to white noise: each particle's own, independent of its neighbors'). Pure functions (tested).
//
// The field is Gaussian, periodic and solenoidal: it is the curl of a random stream function, v = (d psi / dy, -d psi / dx),
// built in Fourier space on a coarse square grid. Its power per Fourier mode is P(k) = <|v(k)|^2> proportional to
// k^-slope for kMin <= |k| <= kMax (k in units of the box's fundamental wave number) and zero elsewhere. Sampling it at
// the particles' positions (bilinear) gives them velocities that are alike where they are close.

import { gaussian } from '../../util/math';

/** In-place radix-2 FFT of the n values (re, im) found at offset + i * stride, i = 0..n-1 (n a power of two); `sign` is -1 forward, +1 backward (unnormalized). */
function fft1d(re: Float64Array, im: Float64Array, offset: number, stride: number, n: number, sign: number): void {
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const a = offset + i * stride, b = offset + j * stride;
            [re[a], re[b]] = [re[b], re[a]];
            [im[a], im[b]] = [im[b], im[a]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = sign * 2 * Math.PI / len;
        const wr = Math.cos(angle), wi = Math.sin(angle);
        for (let start = 0; start < n; start += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = offset + (start + k) * stride, b = offset + (start + k + len / 2) * stride;
                const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
                const next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
        }
    }
}

/** In-place 2D FFT of an n x n grid stored row by row; backward is divided by n^2, so a forward and a backward transform return the grid. */
export function fft2d(re: Float64Array, im: Float64Array, n: number, backward = false): void {
    const sign = backward ? 1 : -1;
    for (let i = 0; i < n; i++) fft1d(re, im, i * n, 1, n, sign);
    for (let j = 0; j < n; j++) fft1d(re, im, j, n, n, sign);
    if (backward) for (let i = 0; i < n * n; i++) { re[i] /= n * n; im[i] /= n * n; }
}

export interface TurbulenceOptions {
    /** Cells per side of the grid (a power of two). */
    size: number;
    /** Exponent n of the spectrum of the velocity, P(k) ~ k^-n per Fourier mode. */
    slope: number;
    /** Smallest and largest wave numbers kept, in units of the fundamental one (1 is one wavelength across the box). */
    kMin: number;
    kMax: number;
}

/** A grid of velocities (row by row: cell (ix, iy) at iy * size + ix) of unit rms per component and no mean. */
export interface TurbulenceField {
    readonly size: number;
    readonly vx: Float64Array;
    readonly vy: Float64Array;
}

/** The signed wave index of a bin of an n-point transform. */
const waveIndex = (i: number, n: number): number => i <= n / 2 ? i : i - n;

/**
 * A solenoidal Gaussian random velocity field of power spectrum k^-slope on [kMin, kMax], normalized to an rms of 1 per
 * component. The same random stream gives the same field.
 */
export function solenoidalField(options: TurbulenceOptions, random: () => number): TurbulenceField {
    const { size: n, slope, kMin, kMax } = options;
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error(`The turbulence grid needs a power-of-two size, not ${n}`);
    const cells = n * n;
    // White noise in real space (so that the field is real), filtered in Fourier space.
    const re = new Float64Array(cells), im = new Float64Array(cells);
    for (let i = 0; i < cells; i++) re[i] = gaussian(random);
    fft2d(re, im, n);
    const ux = { re: new Float64Array(cells), im: new Float64Array(cells) };
    const uy = { re: new Float64Array(cells), im: new Float64Array(cells) };
    for (let iy = 0; iy < n; iy++) {
        const ky = waveIndex(iy, n);
        for (let ix = 0; ix < n; ix++) {
            const kx = waveIndex(ix, n);
            const k = Math.hypot(kx, ky);
            if (k < kMin || k > kMax) continue;
            const c = iy * n + ix;
            // |v|^2 = k^2 |psi|^2 must go as k^-slope, with the white noise's flat power: psi = noise k^-(slope + 2) / 2.
            const amplitude = k ** (-(slope + 2) / 2);
            const pr = re[c] * amplitude, pi = im[c] * amplitude;
            // v = (i ky psi, -i kx psi)
            ux.re[c] = -ky * pi; ux.im[c] = ky * pr;
            uy.re[c] = kx * pi; uy.im[c] = -kx * pr;
        }
    }
    fft2d(ux.re, ux.im, n, true);
    fft2d(uy.re, uy.im, n, true);
    const vx = ux.re, vy = uy.re;
    let sum = 0, sumSquares = 0;
    for (let i = 0; i < cells; i++) { sum += vx[i] + vy[i]; sumSquares += vx[i] * vx[i] + vy[i] * vy[i]; }
    const mean = sum / (2 * cells);
    const rms = Math.sqrt(sumSquares / (2 * cells) - mean * mean) || 1;
    for (let i = 0; i < cells; i++) { vx[i] = (vx[i] - mean) / rms; vy[i] = (vy[i] - mean) / rms; }
    return { size: n, vx, vy };
}

/**
 * The field's velocity at the point (u, v) of the grid, in cells (0 <= u, v < size is one period; outside it wraps):
 * the bilinear interpolation of the four surrounding cells. Writes into `out` (which a loop over many points reuses).
 */
export function sampleField(field: TurbulenceField, u: number, v: number, out = { x: 0, y: 0 }): { x: number; y: number } {
    const n = field.size;
    const fu = Math.floor(u), fv = Math.floor(v);
    const tu = u - fu, tv = v - fv;
    const i0 = ((fu % n) + n) % n, i1 = (i0 + 1) % n;
    const j0 = ((fv % n) + n) % n, j1 = (j0 + 1) % n;
    const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
    const at = (f: Float64Array): number => w00 * f[j0 * n + i0] + w10 * f[j0 * n + i1] + w01 * f[j1 * n + i0] + w11 * f[j1 * n + i1];
    out.x = at(field.vx);
    out.y = at(field.vy);
    return out;
}
