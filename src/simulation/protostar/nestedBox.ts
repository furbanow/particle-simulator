// The nested grid on the core (C2, the `nestedGrid` flag; docs/spikes/c2-nested-grid.md). Pure: where the box goes (NestedBoxController),
// its bounds, and the twins of the two shader steps that join the levels (protostar-nested-gather.frag, protostar-nested-combine.frag).
//
// The box is GRID_RES fine cells of mainCell / ratio, that is GRID_RES / ratio main cells, its corner on a main cell's corner. Inside it the
// particles read the fine level: its gas, and the force a = a_fine(inside) + a_main(all) - a_main(inside), a_fine(inside) the gravity of the
// fine grid (whose deposit holds only the mass inside the box) and a_main(inside) the main grid's gravity of the same mass, gathered from the
// fine cells onto the main cells with the cloud-in-cell weights (gatherWeight) and summed by the main grid's own two-level pass: every pair
// with one particle outside goes through the main grid, every pair inside through the fine one.

import type { Vec2 } from '../../util/math';

/** What the controller decides with (config.ts: PROTOSTAR_NESTED_*). */
export interface NestedBoxSettings {
    /** Cells per side of either grid. */
    gridRes: number;
    /** Main cell / fine cell. */
    ratio: number;
    /** rho / rho0 of the main grid's peak from which a core may get the box. */
    onDensity: number;
    /** rho / rho0 below which the box goes off. */
    offDensity: number;
    /** Readings in a row that switch the box on (or off). */
    readings: number;
    /** Main cells the peak may move between two readings and still count as one core. */
    stillCells: number;
    /** The share of the box (centred) the peak may wander in before the box is recentred. */
    inner: number;
}

/** A reading of the reduction, as the controller sees it. */
export interface NestedBoxReading {
    /** The main grid's peak rho / rho0 (comparable from one reading to the next whatever the box does). */
    mainPeakDensity: number;
    /** The main grid's densest cell, px. */
    mainPeak: Vec2;
    /** The fine grid's densest cell, px, when the box was on for this reading (it follows the core more closely); null otherwise. */
    finePeak: Vec2 | null;
}

/** Main cells per side of the box. */
export const boxCells = (s: Pick<NestedBoxSettings, 'gridRes' | 'ratio'>): number => s.gridRes / s.ratio;

/** The box's lower left main cell centred on `peak` (px), on the main cells and inside the grid. */
export function boxOrigin(peak: Vec2, mainCell: number, s: Pick<NestedBoxSettings, 'gridRes' | 'ratio'>): Vec2 {
    const size = boxCells(s);
    const place = (x: number): number => Math.min(Math.max(Math.round(x / mainCell - size / 2), 0), s.gridRes - size);
    return { x: place(peak.x), y: place(peak.y) };
}

/** Whether `peak` (px) is in the middle `inner` share of the box at `origin` (main cells). */
export function insideInner(peak: Vec2, origin: Vec2, mainCell: number, s: Pick<NestedBoxSettings, 'gridRes' | 'ratio' | 'inner'>): boolean {
    const size = boxCells(s);
    const lo = (1 - s.inner) / 2 * size, hi = (1 + s.inner) / 2 * size;
    const within = (x: number, o: number): boolean => x / mainCell - o >= lo && x / mainCell - o <= hi;
    return within(peak.x, origin.x) && within(peak.y, origin.y);
}

/**
 * Where the nested box is, from one reading of the reduction to the next. Off until a core dominates (the main peak at onDensity or more,
 * within stillCells of the previous reading, `readings` readings in a row: before the star forms the densest cell jumps between clumps);
 * then centred on the peak, recentred when the peak leaves the middle `inner` of the box (hysteresis), off again when the main peak stays
 * below offDensity for `readings` readings.
 */
export class NestedBoxController {
    private origin: Vec2 | null = null;
    private streak = 0;
    private previous: Vec2 | null = null;
    private generation = 0;

    constructor(private readonly settings: NestedBoxSettings) {}

    /** The box's lower left main cell, null while off. */
    get box(): Vec2 | null {
        return this.origin;
    }

    /** Counts the moves and the switches: a new value means the fine level's history (its averaged temperature) no longer holds. */
    get placement(): number {
        return this.generation;
    }

    reset(): void {
        this.origin = null;
        this.streak = 0;
        this.previous = null;
        this.generation++;
    }

    /** Takes a reading; `mainCell` px. Returns whether the box changed (placed, moved or switched off). */
    update(reading: NestedBoxReading, mainCell: number): boolean {
        const s = this.settings;
        const { mainPeakDensity: density, mainPeak } = reading;
        const still = this.previous !== null
            && Math.hypot(mainPeak.x - this.previous.x, mainPeak.y - this.previous.y) <= s.stillCells * mainCell;
        this.previous = { ...mainPeak };
        if (this.origin === null) {
            this.streak = density >= s.onDensity && (still || s.readings <= 1) ? this.streak + 1 : (density >= s.onDensity ? 1 : 0);
            if (this.streak < s.readings) return false;
            this.place(boxOrigin(mainPeak, mainCell, s));
            return true;
        }
        this.streak = density < s.offDensity ? this.streak + 1 : 0;
        if (this.streak >= s.readings) {
            this.origin = null;
            this.streak = 0;
            this.generation++;
            return true;
        }
        const peak = reading.finePeak ?? mainPeak;
        if (insideInner(peak, this.origin, mainCell, s)) return false;
        const next = boxOrigin(peak, mainCell, s);
        if (next.x === this.origin.x && next.y === this.origin.y) return false;
        this.place(next);
        return true;
    }

    /** Dev-only (the lab): puts the box at `origin` (main cells) whatever the readings, or off with null. */
    force(origin: Vec2 | null): void {
        this.origin = origin ? { ...origin } : null;
        this.streak = 0;
        this.generation++;
    }

    private place(origin: Vec2): void {
        this.origin = origin;
        this.streak = 0;
        this.generation++;
    }
}

/**
 * The region (px) where a particle reads the fine level: the box less `margin` fine cells on each side, where the gas pass's 3 x 3
 * neighborhoods and the force's read (cloud-in-cell or TSC) are whole. Twin of nestedInner of protostar-common.glsl.
 */
export function readRegion(originPx: Vec2, fineCell: number, gridRes: number, margin: number): { lo: Vec2; hi: Vec2 } {
    return {
        lo: { x: originPx.x + margin * fineCell, y: originPx.y + margin * fineCell },
        hi: { x: originPx.x + (gridRes - margin) * fineCell, y: originPx.y + (gridRes - margin) * fineCell },
    };
}

/**
 * The cloud-in-cell weight that the gather gives the mass of a fine cell whose center is at `d` main cells from a main cell's center
 * (protostar-nested-gather.frag): the main grid's own tent, so that the gathered mass keeps the fine mass's center (the weights of the
 * main cells around a point sum to 1 and their first moment is the point).
 */
export function gatherWeight(d: Vec2): number {
    return Math.max(1 - Math.abs(d.x), 0) * Math.max(1 - Math.abs(d.y), 0);
}

/**
 * A main-grid field (values at the main cell centers, `field(i, j)`, cells clamped to the grid) read bilinearly at `x` px: what the
 * combine pass reads the main gravity with at the fine cell centers (protostar-nested-combine.frag).
 */
export function bilinearAt(field: (i: number, j: number) => number, x: Vec2, cell: number, gridRes: number): number {
    const px = x.x / cell - 0.5, py = x.y / cell - 0.5;
    const i = Math.floor(px), j = Math.floor(py);
    const fx = px - i, fy = py - j;
    const at = (a: number, b: number): number =>
        field(Math.min(Math.max(a, 0), gridRes - 1), Math.min(Math.max(b, 0), gridRes - 1));
    return (1 - fx) * (1 - fy) * at(i, j) + fx * (1 - fy) * at(i + 1, j) + (1 - fx) * fy * at(i, j + 1) + fx * fy * at(i + 1, j + 1);
}
