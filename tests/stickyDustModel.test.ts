import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONCENTRATION_RADIUS_SLIDER, DUST_GRAVITY_GAIN, EJECTA_RADIUS_FLOOR, GRAVITY_SLIDER } from '../src/config';
import type { GpuModelContext } from '../src/simulation/gpuModel';
import { STICKY_DUST_PARAM, STICKY_DUST_STAT, STICKY_DUST_TYPES } from '../src/simulation/stickyDust/declaration';
import { ejectScale } from '../src/simulation/stickyDust/ejecta';
import { StickyDustModel } from '../src/simulation/stickyDust/gpuModel';

// The constructor merges the drawing uniforms and builds the gravity passes (objects only: nothing
// needs a GPU until they render), so setting parameters does not need one either.
const newModel = (renderer: object = {}): StickyDustModel => new StickyDustModel({
    drawing: { uniforms: {} }, renderer, geometry: new THREE.BufferGeometry(), density: { target: new THREE.WebGLRenderTarget(1, 1) },
    screenSize: { value: new THREE.Vector2(800, 600) }, activeCount: () => 300,
} as unknown as GpuModelContext);
/** A renderer that says it blends float32 targets: the model builds its GPU reduction (nothing draws until a measure). */
const gpuRenderer = { extensions: { has: (name: string) => name === 'EXT_float_blend' } };

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

describe('StickyDustModel concentration on the GPU', () => {
    const reading = { fraction: 0.6, members: 10, centerX: 400, centerY: 300, spread: 30 };

    it('reads no positions back when the device can blend float32 targets, and does when it cannot', () => {
        const gpu = newModel(gpuRenderer);
        expect(gpu.wantsReadback()).toBe(false);
        gpu.debugForceCpu(true);
        expect(gpu.wantsReadback()).toBe(true);
        expect(newModel().wantsReadback()).toBe(true);
    });

    it('arms the ejection of the disk the reduction found: center, radius, and the rms radius of the ejecta', () => {
        const model = newModel(gpuRenderer);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, 50);
        model.takeConcentration(reading, 65);
        const u = model.velocityUniforms;
        expect(model.stat(STICKY_DUST_STAT.concentration)).toBe(0.6);
        expect([u.supernovaCenter.value.x, u.supernovaCenter.value.y]).toEqual([400, 300]);
        expect(u.supernovaRadius.value).toBe(65);
        expect(u.ejectaRadius.value).toBe(30);
    });

    it('updates the meter but does not arm a supernova below the threshold, or without particles in the disk', () => {
        const model = newModel(gpuRenderer);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, 70);
        model.takeConcentration(reading, 65);
        expect(model.stat(STICKY_DUST_STAT.concentration)).toBe(0.6);
        expect(model.velocityUniforms.supernovaCenter.value.x).toBe(0);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, 10);
        model.takeConcentration({ ...reading, members: 0 }, 65);
        expect(model.velocityUniforms.supernovaCenter.value.x).toBe(0);
    });

    it('keeps the radius the disk was measured with, not the slider\'s value of the moment the reading came back', () => {
        const model = newModel(gpuRenderer);
        model.setParam(STICKY_DUST_PARAM.supernovaThreshold, 10);
        model.setParam(STICKY_DUST_PARAM.concentrationRadius, 200);
        model.takeConcentration(reading, 65);
        expect(model.velocityUniforms.supernovaRadius.value).toBe(65);
    });
});
