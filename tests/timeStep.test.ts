import { describe, expect, it } from 'vitest';
import { criticalStep, SubstepController, substepBounds, substepsFor, type StepCriterion, type SubstepBounds } from '../src/simulation/protostar/timeStep';

// The adaptive time step's pure side: the criterion on the reduction's maxima, the count of substeps it gives, and the controller that
// keeps the count from flickering. What it does to a cloud is measured by the lab (docs/spikes/b5-adaptive-time-step.md).

const CRITERION: StepCriterion = { cell: 8, softening: 12, courant: 0.5, omega: 0.1 };

describe('the critical substep', () => {
    it('is the smaller of the speed bound and the acceleration bound', () => {
        // speed: 0.5 cell of 8 px at 400 px/s = 10 ms; acceleration: 0.1 sqrt(12 px / 3000 px/s^2) = 6.3 ms
        expect(criticalStep(400, 3000, CRITERION)).toBeCloseTo(0.1 * Math.sqrt(12 / 3000), 12);
        // faster gas, gentler pull: the speed bound wins
        expect(criticalStep(2000, 100, CRITERION)).toBeCloseTo(0.5 * 8 / 2000, 12);
    });

    it('follows 1 / |v| and 1 / sqrt(|a|)', () => {
        const slow = criticalStep(100, 0, CRITERION);
        expect(criticalStep(200, 0, CRITERION)).toBeCloseTo(slow / 2, 12);
        const gentle = criticalStep(0, 500, CRITERION);
        expect(criticalStep(0, 2000, CRITERION)).toBeCloseTo(gentle / 2, 12);
    });

    it('asks for nothing when nothing moves and nothing pulls', () => {
        expect(criticalStep(0, 0, CRITERION)).toBe(Infinity);
        expect(criticalStep(0, 1000, CRITERION)).toBeLessThan(Infinity);
        expect(criticalStep(1000, 0, CRITERION)).toBeLessThan(Infinity);
    });

    it('takes the softening as no less than a cell: the grid smooths the force that much', () => {
        const fine = { ...CRITERION, softening: 1 };
        expect(criticalStep(0, 1000, fine)).toBeCloseTo(0.1 * Math.sqrt(8 / 1000), 12);
        expect(criticalStep(0, 1000, { ...CRITERION, softening: 8 })).toBeCloseTo(criticalStep(0, 1000, fine), 12);
    });

    it('keeps omega dt at the target in a harmonic core of frequency omega', () => {
        // a particle at the softening length of a core of oscillation frequency w feels a = w^2 epsilon at most, so dt = OMEGA sqrt(eps / a) = OMEGA / w
        const omega = 15;
        const dt = criticalStep(0, omega * omega * CRITERION.softening, CRITERION);
        expect(omega * dt).toBeCloseTo(CRITERION.omega, 12);
    });
});

describe('the number of substeps of a frame', () => {
    const FRAME = 1 / 60 * 1.7;

    it('is the smallest count whose substep is within the critical one', () => {
        expect(substepsFor(FRAME, 0.03, 8)).toBe(1);
        expect(substepsFor(FRAME, 0.02, 8)).toBe(2);
        expect(substepsFor(FRAME, 0.0099, 8)).toBe(3);
        expect(substepsFor(FRAME, FRAME / 4, 8)).toBe(4);
    });

    it('does not ask for one more substep over a rounding error', () => {
        expect(substepsFor(0.03, 0.01, 8)).toBe(3);
        expect(substepsFor(0.03 * (1 + 1e-12), 0.01, 8)).toBe(3);
        expect(substepsFor(0.03 * (1 + 1e-6), 0.01, 8)).toBe(4);
    });

    it('is clamped to [1, max]', () => {
        expect(substepsFor(FRAME, Infinity, 8)).toBe(1);
        expect(substepsFor(FRAME, 1e-9, 8)).toBe(8);
        expect(substepsFor(FRAME, 0, 8)).toBe(8);
        expect(substepsFor(0, 0.01, 8)).toBe(1);
        expect(substepsFor(FRAME, 0.001, 0)).toBe(1);
    });

    it('keeps the frame simulated time: count substeps of frame / count', () => {
        for (const critical of [0.03, 0.012, 0.0041]) {
            const count = substepsFor(FRAME, critical, 8);
            expect(FRAME / count).toBeLessThanOrEqual(critical * (1 + 1e-9));
            if (count > 1) expect(FRAME / (count - 1)).toBeGreaterThan(critical);
        }
    });
});

describe('the bounds of the substeps', () => {
    it('are the ratios times the fixed count, rounded up, around the fixed count', () => {
        expect(substepBounds(2, 1, 1.5, 8)).toEqual({ min: 2, max: 3 });
        expect(substepBounds(1, 1, 1.5, 8)).toEqual({ min: 1, max: 2 });
        expect(substepBounds(3, 1, 1.5, 8)).toEqual({ min: 3, max: 5 });
        expect(substepBounds(4, 1, 1.5, 8)).toEqual({ min: 4, max: 6 });
        expect(substepBounds(2, 1, 1, 8)).toEqual({ min: 2, max: 2 });
    });

    it('lets the calm phases run fewer substeps than the fixed count with a ratio under 1, never fewer than one', () => {
        expect(substepBounds(2, 0.5, 1.5, 8)).toEqual({ min: 1, max: 3 });
        expect(substepBounds(3, 0.5, 1.5, 8)).toEqual({ min: 2, max: 5 });
        expect(substepBounds(2, 0, 1.5, 8)).toEqual({ min: 1, max: 3 });
    });

    it('never goes under the fixed count at the top, nor over it at the bottom, and keeps the absolute ceiling unless the fixed count is above it', () => {
        expect(substepBounds(2, 3, 0.5, 8)).toEqual({ min: 2, max: 2 });
        expect(substepBounds(6, 1, 2, 8)).toEqual({ min: 6, max: 8 });
        expect(substepBounds(10, 1, 1.5, 8)).toEqual({ min: 10, max: 10 });
    });
});

describe('the substep controller', () => {
    const FRAME = 0.03;
    const RELEASE = 0.85;
    const CALM: SubstepBounds = { min: 1, max: 8 };           // the calm phases may go under the fixed count
    const REFINE: SubstepBounds = { min: 2, max: 3 };         // fixed count 2: refine only, up to 1.5 times

    it('starts from the fixed count while there is no reading', () => {
        const controller = new SubstepController(RELEASE);
        expect(controller.next(FRAME, null, 2, CALM)).toBe(2);
        expect(controller.next(FRAME, null, 2, CALM)).toBe(2);
    });

    it('goes up at once to what the criterion asks, however much', () => {
        const controller = new SubstepController(RELEASE);
        controller.next(FRAME, 0.05, 2, CALM);
        expect(controller.next(FRAME, 0.0059, 2, CALM)).toBe(6);
    });

    it('comes down one count at a time', () => {
        const controller = new SubstepController(RELEASE);
        controller.next(FRAME, 0.0035, 2, CALM);                  // 9 asked, 8 allowed
        const counts: number[] = [];
        for (let k = 0; k < 10; k++) counts.push(controller.next(FRAME, 0.1, 2, CALM));
        expect(counts).toEqual([7, 6, 5, 4, 3, 2, 1, 1, 1, 1]);
    });

    it('gives a count up only when the lower one keeps room to spare: no flicker around the limit', () => {
        const controller = new SubstepController(RELEASE);
        expect(controller.next(FRAME, 0.0119, 2, CALM)).toBe(3);               // 0.03 / 0.0119 = 2.52
        // 2 substeps of 15 ms are within 0.0151 but not within 0.85 x 0.0151: it stays at 3
        expect(controller.next(FRAME, 0.0151, 2, CALM)).toBe(3);
        expect(controller.next(FRAME, 0.0178, 2, CALM)).toBe(2);               // 15 ms <= 0.85 x 17.8 ms
        // the criterion hovering on the limit of 2 does not bring a third one back unless it really needs it
        expect(controller.next(FRAME, 0.0149, 2, CALM)).toBe(3);
        expect(controller.next(FRAME, 0.0151, 2, CALM)).toBe(3);
        expect(controller.next(FRAME, 0.0149, 2, CALM)).toBe(3);
    });

    it('never runs more than the maximum, nor fewer than the minimum', () => {
        const controller = new SubstepController(RELEASE);
        expect(controller.next(FRAME, 1e-6, 2, REFINE)).toBe(3);
        for (let k = 0; k < 4; k++) expect(controller.next(FRAME, 1, 2, REFINE)).toBeGreaterThanOrEqual(2);
        expect(controller.next(FRAME, 1, 2, REFINE)).toBe(2);
        expect(new SubstepController(RELEASE).next(0.1, 1e-6, 10, { min: 10, max: 10 })).toBe(10);
        expect(new SubstepController(RELEASE).next(0.1, null, 12, { min: 12, max: 12 })).toBe(12);
    });

    it('with a minimum at the fixed count only ever refines: the same substeps as the fixed step where the criterion is met', () => {
        const controller = new SubstepController(RELEASE);
        for (const critical of [0.5, 0.2, 0.03, 0.016, 0.0151, 0.1]) expect(controller.next(FRAME, critical, 2, REFINE)).toBeGreaterThanOrEqual(2);
        expect(controller.next(FRAME, 0.5, 2, REFINE)).toBeGreaterThanOrEqual(2);
    });

    it('starts again from the fixed count after a reset', () => {
        const controller = new SubstepController(RELEASE);
        controller.next(FRAME, 0.004, 2, CALM);
        controller.reset();
        expect(controller.next(FRAME, null, 2, CALM)).toBe(2);
    });

    it('follows a change of the speed slider: the frame time changes, the criterion does not', () => {
        const controller = new SubstepController(RELEASE);
        expect(controller.next(0.0283, 0.0100, 2, CALM)).toBe(3);
        expect(controller.next(0.0500, 0.0100, 3, CALM)).toBe(5);
        expect(controller.next(0.0100, 0.0100, 1, CALM)).toBe(4);               // one count down per frame
    });
});
