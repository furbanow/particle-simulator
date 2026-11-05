import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_SHOCK_WAVES, SHOCK_MIN_KICK, SHOCK_STRENGTH } from '../src/config';
import { ShockWaves, type ShockUniforms } from '../src/simulation/shockWave';

function setup(speed = 100) {
    const u: ShockUniforms = {
        supernovaSpeed: { value: speed },
        shockCount: { value: 0 },
        shockFronts: { value: Array.from({ length: MAX_SHOCK_WAVES }, () => new THREE.Vector4()) },
        shockRefs: { value: new Array<number>(MAX_SHOCK_WAVES).fill(1) },
    };
    return { u, waves: new ShockWaves(u) };
}

describe('ShockWaves', () => {
    it('runs a wave from the aggregate edge, the swept ring moving at the ejection speed', () => {
        const { u, waves } = setup();

        waves.start(100, 50, 20, 800, 600);
        expect(u.shockCount.value).toBe(1);
        expect(u.shockRefs.value[0]).toBe(20);

        waves.advance(0.1);
        expect(u.shockFronts.value[0].toArray()).toEqual([100, 50, 20, 30]);
        waves.advance(0.1);
        expect(u.shockFronts.value[0].toArray()).toEqual([100, 50, 30, 40]);
    });

    it('keeps the running waves when another one starts', () => {
        const { u, waves } = setup();

        waves.start(100, 50, 20, 800, 600);
        waves.advance(0.1);
        waves.start(400, 300, 20, 800, 600);
        waves.advance(0.1);

        expect(u.shockCount.value).toBe(2);
        expect(u.shockFronts.value[0].toArray()).toEqual([100, 50, 30, 40]);
        expect(u.shockFronts.value[1].toArray()).toEqual([400, 300, 20, 30]);
    });

    it('ends a wave past the farthest corner and keeps the others in order', () => {
        const { u, waves } = setup(1000);

        // The center of a small 100x100 screen: the corner is about 71 px away.
        waves.start(50, 50, 20, 100, 100);
        waves.start(50, 50, 20, 800, 600);
        waves.advance(0.1);
        expect(u.shockCount.value).toBe(2);
        waves.advance(0.1);

        expect(u.shockCount.value).toBe(1);
        expect(u.shockFronts.value[0].z).toBe(120);
    });

    it('ends a wave where its kick becomes negligible', () => {
        const { u, waves } = setup(1000);
        const fade = 10 * SHOCK_STRENGTH / SHOCK_MIN_KICK;

        waves.start(5000, 5000, 10, 10000, 10000);
        for (let t = 0; t < 10 && u.shockCount.value > 0; t++) waves.advance(fade / 1000 / 10);
        waves.advance(fade / 1000 / 10);

        expect(u.shockCount.value).toBe(0);
    });

    it('replaces the oldest wave when every slot is taken', () => {
        const { u, waves } = setup();

        for (let i = 0; i <= MAX_SHOCK_WAVES; i++) waves.start(i, 0, 20, 800, 600);

        expect(u.shockCount.value).toBe(MAX_SHOCK_WAVES);
        expect(u.shockFronts.value[0].x).toBe(1);
        expect(u.shockFronts.value[MAX_SHOCK_WAVES - 1].x).toBe(MAX_SHOCK_WAVES);
    });

    it('stops every wave', () => {
        const { u, waves } = setup();

        waves.start(100, 50, 20, 800, 600);
        waves.stop();

        expect(u.shockCount.value).toBe(0);
    });
});
