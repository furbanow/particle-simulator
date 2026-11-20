import { describe, expect, it } from 'vitest';
import { K_GRAVITY } from '../src/config';
import type { GpuModelContext } from '../src/simulation/gpuModel';
import { STICKY_DUST_PARAM } from '../src/simulation/stickyDust/declaration';
import { StickyDustModel } from '../src/simulation/stickyDust/gpuModel';

// The constructor only merges the drawing uniforms; nothing needs a GPU to set parameters.
const newModel = (): StickyDustModel => new StickyDustModel({ drawing: { uniforms: {} } } as unknown as GpuModelContext);

describe('StickyDustModel.setParam', () => {
    it('applies numbers to the uniforms', () => {
        const model = newModel();
        model.setParam(STICKY_DUST_PARAM.gravity, 7);
        expect(model.velocityUniforms.kGravity.value).toBe(7);
        model.setParam(STICKY_DUST_PARAM.supernovaPower, 50);
        expect(model.velocityUniforms.supernovaSpeed.value).toBeGreaterThan(0);
    });

    it('accepts booleans and choices, and keeps them with the numbers', () => {
        const model = newModel();
        model.setParam('tidy', false);
        model.setParam('mode', 'exact');
        model.setParam(STICKY_DUST_PARAM.gravity, 3);
        expect(model.debugParams).toEqual({ tidy: false, mode: 'exact', gravity: 3 });
        model.setParam('tidy', true);
        expect(model.debugParams.tidy).toBe(true);
    });

    it('does not let a non-number reach a numeric parameter', () => {
        const model = newModel();
        model.setParam(STICKY_DUST_PARAM.gravity, true);
        model.setParam(STICKY_DUST_PARAM.gravity, 'strong');
        expect(model.velocityUniforms.kGravity.value).toBe(K_GRAVITY);
    });

    it('keeps the values it was given across a restart, and adds the restart ones', () => {
        const model = newModel();
        model.setParam('tidy', false);
        model.reset({ count: 1000, early: true });
        expect(model.debugParams).toEqual({ tidy: false, count: 1000, early: true });
    });
});
