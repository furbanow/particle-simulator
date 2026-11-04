import { describe, expect, it } from 'vitest';
import { LOG_PARAM_SLIDER_STEPS } from '../src/config';
import type { BooleanParam, ChoiceParam, NumberParam } from '../src/simulation/algorithm';
import {
    numberParam, paramFraction, paramToSlider, sliderRange, sliderToParam, validParamValue,
} from '../src/simulation/params';

const base = { label: 'x', section: 's', apply: 'live', format: String } as const;
const linear: NumberParam = { ...base, kind: 'number', key: 'lin', min: 10, max: 400, step: 5, default: 80 };
const log: NumberParam = { ...base, kind: 'number', key: 'log', min: 1e-4, max: 1, step: 0, default: 1e-2, scale: 'log' };
const toggle: BooleanParam = { ...base, kind: 'boolean', key: 'on', default: true };
const choice: ChoiceParam = { ...base, kind: 'choice', key: 'mode', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };

describe('number parameters on sliders', () => {
    it('use the value itself on a linear scale, rounded to the step', () => {
        expect(sliderRange(linear)).toEqual({ min: 10, max: 400, step: 5 });
        expect(paramToSlider(linear, 80)).toBe(80);
        expect(sliderToParam(linear, 82)).toBe(80);
        expect(sliderToParam(linear, 1000)).toBe(400);
        expect(paramFraction(linear, 205)).toBeCloseTo(0.5);
    });

    it('use positions on a log scale, keeping a few significant digits', () => {
        expect(sliderRange(log)).toEqual({ min: 0, max: LOG_PARAM_SLIDER_STEPS, step: 1 });
        expect(sliderToParam(log, 0)).toBe(1e-4);
        expect(sliderToParam(log, LOG_PARAM_SLIDER_STEPS)).toBe(1);
        expect(paramToSlider(log, 1e-2)).toBe(LOG_PARAM_SLIDER_STEPS / 2);
        expect(sliderToParam(log, LOG_PARAM_SLIDER_STEPS / 2)).toBe(0.01);
        expect(String(sliderToParam(log, 123)).replace(/^0\.0*|e.*$|\./g, '').length).toBeLessThanOrEqual(3);
        expect(paramFraction(log, 1e-2)).toBeCloseTo(0.5);
    });
});

describe('parameter values', () => {
    it('are clamped, or fall back to the default when of the wrong kind', () => {
        expect(validParamValue(linear, 9999)).toBe(400);
        expect(validParamValue(linear, Number.NaN)).toBe(80);
        expect(validParamValue(linear, '12')).toBe(80);
        expect(validParamValue(toggle, false)).toBe(false);
        expect(validParamValue(toggle, 1)).toBe(true);
        expect(validParamValue(choice, 'b')).toBe('b');
        expect(validParamValue(choice, 'z')).toBe('a');
    });

    it('read numbers with their default as fallback', () => {
        expect(numberParam({ lin: 25 }, linear)).toBe(25);
        expect(numberParam({ lin: true }, linear)).toBe(80);
        expect(numberParam({}, linear)).toBe(80);
    });
});
