// The sticky dust's deposit (splat.vert / splat.frag: cloud-in-cell, or TSC behind the tscDeposit switch) computed on the CPU in double
// precision from the positions and velocities read back: the reference the density grid is compared with.
// Pure (tested in tests/dustLab.test.ts): no GPU, no DOM.

import { MAX_SPECIES } from '../config';
import { kernelFirstCell, kernelWeight, kernelWidth, type DepositKernel } from '../simulation/depositKernel';
import { agitation, peculiarEnergy, type Moments, type MomentScales } from '../simulation/stickyDust/granular';

/** Channels of a density texel. */
export const DUST_CHANNELS = 4;

export interface DustDepositInputs {
    /** Texels a side of the density grid. */
    resolution: number;
    domainOffset: readonly [number, number];
    domainSize: number;
    /** Deposit mass of each type. */
    splatMass: readonly number[];
    scales: MomentScales;
    /** The reference velocity at a world position (px) and how far it can be off (px/s) because the hardware filter rounds its weights. */
    reference(x: number, y: number): { velocity: readonly [number, number]; uncertainty: number };
}

export interface DustDepositReference {
    /** RGBA per texel, row by row from the bottom: the mass, the momentum and the energy about the reference, scaled as on the grid. */
    grid: Float64Array;
    /**
     * The sum of the absolute values of the weighted contributions, per channel: what a partial sum can reach when
     * contributions of both signs (the momentum) cancel, which is what the rounding of the additions is relative to.
     */
    magnitude: Float64Array;
    /** Particles whose cloud reaches the texel, counting those within `weightMargin` of the edge of their footprint. */
    contributions: Uint32Array;
    /** Largest unweighted contribution of a particle to each channel. */
    payloadMax: number[];
    /**
     * Per texel, how far the energy channel can be off because the reference velocity the GPU used is only known to the
     * precision of the hardware filter: sum over the contributions of 2 m w |v - v_ref| S_E x uncertainty.
     */
    energySlack: Float64Array;
    /** Live particles whose cloud lands on the grid. */
    deposited: number;
}

/**
 * Deposits `count` particles, read from `positions` (x, y, type, w per texel; a negative w is a removed particle) and
 * `velocities` (vx, vy, ..), the way the splat shaders do with `kernel`: cloud-in-cell, the particle covers the 2 x 2 texels
 * around it with the weights max(1 - |distance between centers|, 0) per axis; TSC, the 3 x 3 texels around the one that holds it
 * with quadratic weights (depositKernel.ts).
 */
export function referenceDustDeposit(positions: ArrayLike<number>, velocities: ArrayLike<number>, count: number,
                                     inputs: DustDepositInputs, weightMargin: number, kernel: DepositKernel = 'cic'): DustDepositReference {
    const res = inputs.resolution;
    const grid = new Float64Array(res * res * DUST_CHANNELS);
    const magnitude = new Float64Array(res * res * DUST_CHANNELS);
    const contributions = new Uint32Array(res * res);
    const energySlack = new Float64Array(res * res);
    const payloadMax = new Array<number>(DUST_CHANNELS).fill(0);
    const width = kernelWidth(kernel);
    const reach = width / 2 + weightMargin;
    const centerMax = kernel === 'cic' ? res : res - 1;
    let deposited = 0;
    for (let i = 0; i < count; i++) {
        const [x, y, z, w] = [positions[i * 4], positions[i * 4 + 1], positions[i * 4 + 2], positions[i * 4 + 3]];
        if (!(w >= 0)) continue;
        const type = Math.min(Math.max(Math.trunc(z + 0.5), 0), MAX_SPECIES - 1);
        const m = inputs.splatMass[type];
        const vx = velocities[i * 4], vy = velocities[i * 4 + 1];
        const ref = inputs.reference(x, y);
        const dx = vx - ref.velocity[0], dy = vy - ref.velocity[1];
        const payload = [m, m * vx * inputs.scales.momentum, m * vy * inputs.scales.momentum, m * (dx * dx + dy * dy) * inputs.scales.energy];
        const slackPerWeight = 2 * m * Math.hypot(dx, dy) * inputs.scales.energy * ref.uncertainty;
        const px = (x + inputs.domainOffset[0]) / inputs.domainSize * res;
        const py = (y + inputs.domainOffset[1]) / inputs.domainSize * res;
        const fx = kernelFirstCell(kernel, px);
        const fy = kernelFirstCell(kernel, py);
        if (!(fx + 1 >= 0 && fx + 1 <= centerMax && fy + 1 >= 0 && fy + 1 <= centerMax)) continue;
        deposited++;
        payload.forEach((v, c) => { payloadMax[c] = Math.max(payloadMax[c], Math.abs(v)); });
        // A block one texel wider on each side covers the GPU's and the texels at its margin.
        for (let iy = fy - 1; iy <= fy + width; iy++) {
            const oy = iy + 0.5 - py;
            if (iy < 0 || iy >= res || Math.abs(oy) >= reach) continue;
            for (let ix = fx - 1; ix <= fx + width; ix++) {
                const ox = ix + 0.5 - px;
                if (ix < 0 || ix >= res || Math.abs(ox) >= reach) continue;
                const texel = iy * res + ix;
                contributions[texel]++;
                const weight = kernelWeight(kernel, ox) * kernelWeight(kernel, oy);
                if (weight === 0) continue;
                for (let c = 0; c < DUST_CHANNELS; c++) {
                    grid[texel * DUST_CHANNELS + c] += payload[c] * weight;
                    magnitude[texel * DUST_CHANNELS + c] += Math.abs(payload[c]) * weight;
                }
                energySlack[texel] += slackPerWeight * weight;
            }
        }
    }
    return { grid, magnitude, contributions, payloadMax, energySlack, deposited };
}

/**
 * How much error a half-float deposit may make (the model of depositReference.ts): each contribution suffers `roundings`
 * roundings of relative size `roundoff`, and its weight is off by up to `weightError`.
 */
export interface DustTolerance {
    roundoff: number;
    roundings: number;
    weightError: number;
}

export interface DustChannelComparison {
    channel: number;
    /** Largest |gpu - reference| / allowed error over the texels: the deposit holds when it is at most 1. */
    maxExcess: number;
    maxRelativeError: number;
    texelsOverTolerance: number;
    sumGpu: number;
    sumReference: number;
}

/** Compares a read-back RGBA grid (`gpu`) with the reference, channel by channel, against the tolerance model. */
export function compareDustDeposit(gpu: ArrayLike<number>, reference: DustDepositReference, tolerance: DustTolerance): DustChannelComparison[] {
    const texels = reference.contributions.length;
    return Array.from({ length: DUST_CHANNELS }, (_, channel): DustChannelComparison => {
        const result: DustChannelComparison = { channel, maxExcess: 0, maxRelativeError: 0, texelsOverTolerance: 0, sumGpu: 0, sumReference: 0 };
        for (let texel = 0; texel < texels; texel++) {
            const g = gpu[texel * DUST_CHANNELS + channel];
            const r = reference.grid[texel * DUST_CHANNELS + channel];
            const slack = channel === 3 ? reference.energySlack[texel] : 0;
            const allowed = reference.contributions[texel]
                * (tolerance.roundings * tolerance.roundoff * reference.magnitude[texel * DUST_CHANNELS + channel]
                    + tolerance.weightError * reference.payloadMax[channel]) + slack;
            const error = Math.abs(g - r);
            const excess = error === 0 ? 0 : error / allowed;
            result.sumGpu += g;
            result.sumReference += r;
            if (Number.isNaN(excess)) { result.maxExcess = NaN; continue; }
            if (excess > result.maxExcess) result.maxExcess = excess;
            if (excess > 1) result.texelsOverTolerance++;
            if (r > 0) result.maxRelativeError = Math.max(result.maxRelativeError, error / r);
        }
        return result;
    });
}

/** The moments of texel `texel` of an RGBA grid. */
export const momentsAt = (rgba: ArrayLike<number>, texel: number): Moments => ({
    mass: rgba[texel * DUST_CHANNELS], momentumX: rgba[texel * DUST_CHANNELS + 1],
    momentumY: rgba[texel * DUST_CHANNELS + 2], energy: rgba[texel * DUST_CHANNELS + 3],
});

/**
 * The reference velocity at a position, read from the small grid (RGBA per texel, `resolution` a side, row by
 * row from the bottom: mass, scaled momentum) the way the shaders read it: bilinear between texel centers, the edge
 * texels repeated, the mass and momentum interpolated first and then divided.
 */
export function referenceFromGrid(grid: ArrayLike<number>, resolution: number, offset: readonly [number, number], domainSize: number,
                                  momentumScale: number, x: number, y: number): [number, number] {
    const fx = (x + offset[0]) / domainSize * resolution - 0.5;
    const fy = (y + offset[1]) / domainSize * resolution - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const at = (cx: number, cy: number, channel: number): number =>
        grid[(Math.min(resolution - 1, Math.max(0, cy)) * resolution + Math.min(resolution - 1, Math.max(0, cx))) * 4 + channel];
    const lerp = (channel: number): number =>
        (at(ix, iy, channel) * (1 - tx) + at(ix + 1, iy, channel) * tx) * (1 - ty)
        + (at(ix, iy + 1, channel) * (1 - tx) + at(ix + 1, iy + 1, channel) * tx) * ty;
    const mass = lerp(0);
    return mass > 1e-4 ? [lerp(1) / (mass * momentumScale), lerp(2) / (mass * momentumScale)] : [0, 0];
}

/** How far a bilinear read of the reference grid may be off at a position because the hardware rounds its weights to 8 bits (px/s). */
export function referenceUncertainty(grid: ArrayLike<number>, resolution: number, offset: readonly [number, number], domainSize: number,
                                     momentumScale: number, x: number, y: number, weightBits: number): number {
    const fx = (x + offset[0]) / domainSize * resolution - 0.5;
    const fy = (y + offset[1]) / domainSize * resolution - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const velocityAt = (cx: number, cy: number): [number, number] => {
        const k = (Math.min(resolution - 1, Math.max(0, cy)) * resolution + Math.min(resolution - 1, Math.max(0, cx))) * 4;
        return grid[k] > 1e-4 ? [grid[k + 1] / (grid[k] * momentumScale), grid[k + 2] / (grid[k] * momentumScale)] : [0, 0];
    };
    const corners = [velocityAt(ix, iy), velocityAt(ix + 1, iy), velocityAt(ix, iy + 1), velocityAt(ix + 1, iy + 1)];
    const spread = Math.max(...corners.map(c => Math.hypot(c[0] - corners[0][0], c[1] - corners[0][1])));
    // Two weights (one per axis), each off by half a step of the hardware's fixed-point filter weights.
    return 2 * spread * 2 ** -(weightBits + 1);
}

/** Per-texel agitation T of an RGBA grid of the deposit, with the reference velocity of each texel centre. */
export function agitationOfGrid(grid: ArrayLike<number>, resolution: number, scales: MomentScales,
                                referenceAt: (texelX: number, texelY: number) => readonly [number, number]): Float64Array {
    const out = new Float64Array(resolution * resolution);
    for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
            const texel = y * resolution + x;
            out[texel] = agitation(momentsAt(grid, texel), referenceAt(x, y), scales);
        }
    }
    return out;
}

/** Mass-weighted mean agitation sum(rho T) / sum(rho) over the texels at or above `minMass`. */
export function meanAgitation(grid: ArrayLike<number>, resolution: number, scales: MomentScales, minMass: number,
                              referenceAt: (texelX: number, texelY: number) => readonly [number, number]): { temperature: number; mass: number; mass2: number } {
    let energy = 0, mass = 0, mass2 = 0;
    for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
            const m = momentsAt(grid, y * resolution + x);
            if (!(m.mass >= minMass)) continue;
            energy += peculiarEnergy(m, referenceAt(x, y), scales);
            mass += m.mass;
            mass2 += m.mass * m.mass;
        }
    }
    return { temperature: mass > 0 ? energy / mass : NaN, mass, mass2 };
}
