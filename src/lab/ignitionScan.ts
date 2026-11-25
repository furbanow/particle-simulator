// Pure helpers of the lab's measure of the ignition temperatures on thermal gases (proposal A1): the box
// that gives a gas of a given density, and the temperature at which a series of (temperature, rate) readings
// crosses a reference rate. No GPU, no DOM (tested in tests/labMolecularWeight.test.ts).

import { PROTOSTAR_CLOUD_RADIUS, PROTOSTAR_FUSION_RATE_MAX, TOTAL_MASS } from '../config';
import { LAB_AREA } from './config';
import type { Box } from './thermalGas';

/**
 * The square, centered in the lab's area, that holds all the mass of the simulation (TOTAL_MASS, whatever the number of
 * particles) at a density of `density` rho0, rho0 being the initial mean density of the cloud: the densest uniform gas the
 * lab can draw, since a denser one would leave no mass for the cells around it.
 */
export function boxForDensity(density: number): Box {
    const length = Math.min(LAB_AREA.width, LAB_AREA.height);
    const cloudArea = Math.PI * (PROTOSTAR_CLOUD_RADIUS * length) ** 2;
    const side = Math.sqrt(cloudArea / density);
    const [cx, cy] = [LAB_AREA.width / 2, LAB_AREA.height / 2];
    return { x0: cx - side / 2, y0: cy - side / 2, x1: cx + side / 2, y1: cy + side / 2 };
}

/** Density, in rho0, of the whole mass spread uniformly over `box`. */
export function boxDensity(box: Box): number {
    const length = Math.min(LAB_AREA.width, LAB_AREA.height);
    const rho0 = TOTAL_MASS / (Math.PI * (PROTOSTAR_CLOUD_RADIUS * length) ** 2);
    return TOTAL_MASS / ((box.x1 - box.x0) * (box.y1 - box.y0)) / rho0;
}

/** A reading of a thermal gas: its temperature (any unit) and the mean fusion rate per particle (1/s). */
export interface ScanPoint {
    temperature: number;
    rate: number;
}

/**
 * The temperature at which the rate crosses `targetRate`, from the readings of a scan: the points are sorted by temperature
 * and the first pair that brackets the target (rate below it, then at or above it) is interpolated linearly in ln T and
 * ln rate, which is exact for a power law. Readings at the cap of the rate (the law is saturated there) and at a rate of 0 are
 * ignored. Null when no pair brackets the target.
 */
export function interpolateIgnition(points: readonly ScanPoint[], targetRate: number): number | null {
    const usable = points
        .filter(p => p.rate > 0 && p.rate < PROTOSTAR_FUSION_RATE_MAX * 0.99 && p.temperature > 0)
        .sort((a, b) => a.temperature - b.temperature);
    for (let i = 0; i + 1 < usable.length; i++) {
        const [low, high] = [usable[i], usable[i + 1]];
        if (low.rate < targetRate && high.rate >= targetRate) {
            const slope = (Math.log(high.rate) - Math.log(low.rate)) / (Math.log(high.temperature) - Math.log(low.temperature));
            return low.temperature * Math.exp((Math.log(targetRate) - Math.log(low.rate)) / slope);
        }
    }
    return null;
}

/** The local exponent d ln rate / d ln T of the same series at `temperature` (the two nearest readings), null with fewer than two usable. */
export function localExponent(points: readonly ScanPoint[], temperature: number): number | null {
    const usable = points.filter(p => p.rate > 0 && p.rate < PROTOSTAR_FUSION_RATE_MAX * 0.99 && p.temperature > 0)
        .sort((a, b) => Math.abs(Math.log(a.temperature / temperature)) - Math.abs(Math.log(b.temperature / temperature)))
        .slice(0, 2);
    if (usable.length < 2 || usable[0].temperature === usable[1].temperature) return null;
    return (Math.log(usable[0].rate) - Math.log(usable[1].rate)) / (Math.log(usable[0].temperature) - Math.log(usable[1].temperature));
}
