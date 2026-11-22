// How the lab picks the time step of a protostar run (phase B5): the fixed count of substeps of the speed, the adaptive step, or a
// reference at a much smaller step (a multiple of the fixed count, the model's dev-only `debugSubsteps`).

import { PROTOSTAR_PARAM } from '../simulation/protostar/declaration';
import { protostarModel } from './driver';
import type { LabContext } from './types';

export interface StepMode {
    name: string;
    /** The adaptive step flag. */
    adaptive: boolean;
    /** Substeps of a frame as a multiple of the fixed count of the speed (a reference at 1 / refine of the step); 0: the model's own choice. */
    refine: number;
    /** Other constants of the adaptive step than the application's (tuning). */
    criterion?: { omega?: number; courant?: number; minRatio?: number; ratio?: number; readInterval?: number };
}

export const FIXED_STEP: StepMode = { name: 'fixed', adaptive: false, refine: 0 };
export const ADAPTIVE_STEP: StepMode = { name: 'adaptive', adaptive: true, refine: 0 };
export const referenceStep = (refine: number): StepMode => ({ name: `dt/${refine}`, adaptive: false, refine });

/** Puts the model of the running restart in `mode` (after the restart: a restart gives the flag its default back). */
export function applyStepMode(context: LabContext, mode: StepMode): void {
    const model = protostarModel(context);
    model.setParam(PROTOSTAR_PARAM.adaptiveTimeStep, mode.adaptive);
    const fixed = Math.max(1, Math.ceil(context.simulation.timeScale - 1e-6));
    model.debugSubsteps = mode.refine > 0 ? mode.refine * fixed : null;
    model.debugCriterion = mode.criterion ?? null;
}

/** Back to the application's way (the flag at its default, the model's own count). */
export function clearStepMode(context: LabContext): void {
    const model = protostarModel(context);
    model.debugSubsteps = null;
    model.debugCriterion = null;
    const flag = context.simulation.params[PROTOSTAR_PARAM.adaptiveTimeStep];
    model.setParam(PROTOSTAR_PARAM.adaptiveTimeStep, flag === true);
}
