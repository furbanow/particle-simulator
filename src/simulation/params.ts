import { LOG_PARAM_DIGITS, LOG_PARAM_SLIDER_STEPS } from '../config';
import { clamp, snap } from '../util/math';
import type { AlgorithmDeclaration, NumberParam, ParamDef, ParamValue, ParamValues } from './algorithm';

/** Every parameter at its default value. */
export const defaultParams = (algorithm: AlgorithmDeclaration): ParamValues =>
    Object.fromEntries(algorithm.params.map(p => [p.key, p.default]));

export function findParam(algorithm: AlgorithmDeclaration, key: string): ParamDef | undefined {
    return algorithm.params.find(p => p.key === key);
}

/** `value` if it fits the parameter (type, bounds, options), else the closest valid value. */
export function validParamValue(param: ParamDef, value: unknown): ParamValue {
    switch (param.kind) {
        case 'number':
            return typeof value === 'number' && Number.isFinite(value) ? clamp(value, [param.min, param.max]) : param.default;
        case 'boolean':
            return typeof value === 'boolean' ? value : param.default;
        case 'choice':
            return param.options.some(o => o.value === value) ? value as string : param.default;
    }
}

/** Reads a number parameter (its default when the value is missing or not a number). */
export function numberParam(values: ParamValues, param: NumberParam): number {
    const v = values[param.key];
    return typeof v === 'number' ? v : param.default;
}

// ---- Sliders ----

/** Slider bounds and step of a number parameter: the value itself, or a position on a log scale. */
export function sliderRange(param: NumberParam): { min: number; max: number; step: number } {
    return param.scale === 'log'
        ? { min: 0, max: LOG_PARAM_SLIDER_STEPS, step: 1 }
        : { min: param.min, max: param.max, step: param.step };
}

const logSpan = (param: NumberParam): number => Math.log(param.max / param.min);

export function paramToSlider(param: NumberParam, value: number): number {
    if (param.scale !== 'log') return value;
    return Math.round(Math.log(clamp(value, [param.min, param.max]) / param.min) / logSpan(param) * LOG_PARAM_SLIDER_STEPS);
}

export function sliderToParam(param: NumberParam, position: number): number {
    if (param.scale !== 'log') return snap(position, param.step, [param.min, param.max]);
    const v = param.min * Math.exp(position / LOG_PARAM_SLIDER_STEPS * logSpan(param));
    return clamp(Number(v.toPrecision(LOG_PARAM_DIGITS)), [param.min, param.max]);
}

/** Position of `value` along the slider, 0..1. */
export function paramFraction(param: NumberParam, value: number): number {
    const { min, max } = sliderRange(param);
    return max > min ? (paramToSlider(param, value) - min) / (max - min) : 0;
}
