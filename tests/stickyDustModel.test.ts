import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONCENTRATION_RADIUS_SLIDER, DUST_GRAVITY_GAIN, EJECTA_RADIUS_FLOOR, GRAVITY_SLIDER } from '../src/config';
import type { GpuModelContext } from '../src/simulation/gpuModel';
import { STICKY_DUST_PARAM, STICKY_DUST_STAT, STICKY_DUST_TYPES } from '../src/simulation/stickyDust/declaration';
import { ejectScale } from '../src/simulation/stickyDust/ejecta';
import { StickyDustModel } from '../src/simulation/stickyDust/gpuModel';

// The constructor merges the drawing uniforms and builds the gravity passes (objects only: nothing
// needs a GPU until they render), so setting parameters does not need one either.
const newModel = (): StickyDustModel => new StickyDustModel({
    drawing: { uniforms: {} }, renderer: {}, density: { target: new THREE.WebGLRenderTarget(1, 1) },
    screenSize: { value: new THREE.Vector2(800, 600) }, activeCount: () => 300,
} as unknown as GpuModelContext);

describe('StickyDustModel.setParam', () => {
    it('applies numbers to the uniforms', () => {
        const model = newModel();
        model.setParam(STICKY_DUST_PARAM.gravity, 7);
        expect(model.velocityUniforms.kGravity.value).toBeCloseTo(7 * DUST_GRAVITY_GAIN, 12);
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
        expect(model.velocityUniforms.kGravity.value).toBe(GRAVITY_SLIDER.default * DUST_GRAVITY_GAIN);
    });

    it('keeps the values it was given across a restart, and adds the restart ones', () => {
        const model = newModel();
        model.setParam('tidy', false);
        model.reset({ count: 1000, early: true });
        expect(model.debugParams).toEqual({ tidy: false, count: 1000, early: true });
    });
});

describe('StickyDustModel supernova', () => {
    /** Position texels (x, y, species, 1). */
    const texels = (points: [number, number, number][]): Float32Array => {
        const data = new Float32Array(points.length * 4);
        points.forEach(([x, y, species], i) => data.set([x, y, species, 1], i * 4));
        return data;
    };

    it('sets the expansion rate of the ejection from the size of the cluster it detects, not below a fraction of the zone', () => {
        const model = newModel();
        const types = STICKY_DUST_TYPES.slice(0, 1);
        model.updateSpecies(types, [100]);
        expect(model.velocityUniforms.ejectaRadius.value).toBe(CONCENTRATION_RADIUS_SLIDER.default);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, 10);
        // Four equal particles at 30 px from their center of mass, on a cross: rms distance 30.
        const cross: [number, number, number][] = [[430, 300, 0], [370, 300, 0], [400, 330, 0], [400, 270, 0]];
        model.onReadback(texels(cross), 4);
        expect(model.velocityUniforms.ejectaRadius.value).toBeCloseTo(30, 9);
        // A clump a pixel wide: the radius is the floor.
        model.reset({});
        const tight: [number, number, number][] = [[400, 300, 0], [401, 300, 0]];
        model.onReadback(texels(tight), 2);
        expect(model.velocityUniforms.ejectaRadius.value).toBeCloseTo(EJECTA_RADIUS_FLOOR * CONCENTRATION_RADIUS_SLIDER.default, 9);
    });

    it('scales the ejection speed of each species by the factor that decreases with its mass', () => {
        const model = newModel();
        const types = STICKY_DUST_TYPES.slice(0, 3);
        model.updateSpecies(types, [100, 100, 100]);
        const mean = types.reduce((sum, t) => sum + t.values.mass, 0) / 3;
        const scales = model.velocityUniforms.speciesEjectScale.value;
        types.forEach((t, k) => expect(scales[k]).toBeCloseTo(ejectScale(t.values.mass, mean), 12));
        expect(scales[0]).toBeGreaterThan(scales[1]);
        expect(scales[1]).toBeGreaterThan(scales[2]);
    });

    it('weighs the concentration by the mass of the species: the threshold is a share of the total mass', () => {
        const model = newModel();
        const types = STICKY_DUST_TYPES.slice(0, 2);                 // hydrogen (1.008 u) and helium (4.0026 u)
        model.updateSpecies(types, [4, 1]);
        // The helium and one hydrogen share a disk of 65 px: 2 of the 5 particles, but 5.0106 of the 8.0346 units of mass.
        const points: [number, number, number][] = [[100, 100, 1], [110, 100, 0], [400, 500, 0], [600, 100, 0], [700, 500, 0]];
        model.onReadback(texels(points), points.length);
        const total = 4 * types[0].values.mass + types[1].values.mass;
        expect(model.stat(STICKY_DUST_STAT.concentration)).toBeCloseTo((types[0].values.mass + types[1].values.mass) / total, 12);
        expect(model.stat(STICKY_DUST_STAT.concentration)).toBeGreaterThan(2 / 5);
    });

    it('arms a supernova when the mass share reaches the threshold, and not before', () => {
        const model = newModel();
        const types = STICKY_DUST_TYPES.slice(0, 2);
        model.updateSpecies(types, [4, 1]);
        const points: [number, number, number][] = [[100, 100, 1], [110, 100, 0], [400, 500, 0], [600, 100, 0], [700, 500, 0]];
        const share = (types[0].values.mass + types[1].values.mass) / (4 * types[0].values.mass + types[1].values.mass);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, Math.ceil(100 * share) + 1);
        model.onReadback(texels(points), points.length);
        expect(model.wantsReadback()).toBe(true);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, Math.floor(100 * share));
        model.onReadback(texels(points), points.length);
        expect(model.wantsReadback()).toBe(false);                      // a supernova is pending
        expect(model.velocityUniforms.supernovaCenter.value.x).toBeCloseTo((100 * 4.0026 + 110 * 1.008) / (4.0026 + 1.008), 6);
    });
});
