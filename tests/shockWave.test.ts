import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHOCK_MIN_KICK, SHOCK_STRENGTH } from '../src/config';
import { fitLine } from '../src/lab/haffFit';
import { advanceFront, frontConstant, frontRadiusAt, frontSpeed, ShockWave, type ShockUniforms } from '../src/simulation/shockWave';

const R0 = 65;
const V0 = 294;

describe('the front law R dR/dt = K', () => {
    it('starts at the given radius and moves at the given speed there', () => {
        const k = frontConstant(V0, R0);
        expect(frontRadiusAt(R0, V0, 0)).toBe(R0);
        expect(frontSpeed(R0, k)).toBeCloseTo(V0, 12);
        // The first instants: R ~ R0 + V0 t.
        expect(frontRadiusAt(R0, V0, 1e-4)).toBeCloseTo(R0 + V0 * 1e-4, 4);
    });

    it('has R^2 linear in time: R^2 = R0^2 + 2 K t', () => {
        const k = frontConstant(V0, R0);
        for (const t of [0.1, 0.5, 2, 10, 40]) expect(frontRadiusAt(R0, V0, t) ** 2).toBeCloseTo(R0 * R0 + 2 * k * t, 6);
        const series = Array.from({ length: 200 }, (_, i): [number, number] => [i * 0.2, frontRadiusAt(R0, V0, i * 0.2) ** 2]);
        const fit = fitLine(series);
        expect(fit.r2).toBeCloseTo(1, 12);
        expect(fit.slope).toBeCloseTo(2 * k, 6);
        expect(fit.intercept).toBeCloseTo(R0 * R0, 6);
    });

    it('goes as t^(1/2) once far from the start (Sedov-Taylor in two dimensions)', () => {
        const times = Array.from({ length: 60 }, (_, i) => 20 * 1.1 ** i);                 // 20 s to 6000 s: R >> R0
        const fit = fitLine(times.map((t): [number, number] => [Math.log(t), Math.log(frontRadiusAt(R0, V0, t))]));
        expect(fit.slope).toBeCloseTo(0.5, 2);
        expect(fit.r2).toBeGreaterThan(0.99999);
    });

    it('goes as (t + t0)^(1/2) exactly, from the start, with the virtual origin t0 = R0^2 / (2 K)', () => {
        const k = frontConstant(V0, R0);
        const t0 = R0 * R0 / (2 * k);
        const times = Array.from({ length: 40 }, (_, i) => 0.05 * 1.2 ** i);
        const fit = fitLine(times.map((t): [number, number] => [Math.log(t + t0), Math.log(frontRadiusAt(R0, V0, t))]));
        expect(fit.slope).toBeCloseTo(0.5, 10);
    });

    it('slows down as 1/R: the speed times the radius stays K', () => {
        const k = frontConstant(V0, R0);
        for (const t of [0, 0.3, 3, 30]) {
            const r = frontRadiusAt(R0, V0, t);
            expect(frontSpeed(r, k) * r).toBeCloseTo(k, 9);
        }
        expect(frontSpeed(frontRadiusAt(R0, V0, 5), k)).toBeLessThan(V0 / 3);
    });

    it('can be advanced step by step: the same radius as in one go, whatever the steps', () => {
        const k = frontConstant(V0, R0);
        let r = R0;
        for (let i = 0; i < 400; i++) r = advanceFront(r, k, 0.0125);
        expect(r).toBeCloseTo(frontRadiusAt(R0, V0, 5), 9);
    });
});

function uniforms(speed: number): ShockUniforms {
    return {
        supernovaCenter: { value: new THREE.Vector2(512, 384) }, supernovaSpeed: { value: speed }, shockActive: { value: 0 },
        shockCenter: { value: new THREE.Vector2() }, shockInner: { value: 0 }, shockOuter: { value: 0 }, shockRef: { value: 1 },
    };
}

describe('ShockWave', () => {
    it('starts at the aggregate radius and sweeps radius ranges that follow the law', () => {
        const u = uniforms(V0);
        const wave = new ShockWave(u);
        wave.start(R0, 1024, 768);
        expect(u.shockActive.value).toBe(1);
        expect(u.shockRef.value).toBe(R0);
        expect(u.shockOuter.value).toBe(R0);
        let t = 0;
        for (let i = 0; i < 200; i++) {
            wave.advance(0.0125);
            t += 0.0125;
            expect(u.shockOuter.value).toBeCloseTo(frontRadiusAt(R0, V0, t), 9);
            expect(u.shockInner.value).toBeLessThan(u.shockOuter.value);
        }
    });

    it('takes the speed slider live: it changes K from then on', () => {
        const u = uniforms(V0);
        const wave = new ShockWave(u);
        wave.start(R0, 1024, 768);
        wave.advance(0.0125);
        u.supernovaSpeed.value = 2 * V0;
        const before = u.shockOuter.value;
        wave.advance(0.0125);
        expect(u.shockOuter.value).toBeCloseTo(advanceFront(before, frontConstant(2 * V0, R0), 0.0125), 12);
    });

    it('stops at the farthest corner, or where the kick has become negligible, and when the speed is zero', () => {
        const u = uniforms(V0);
        const wave = new ShockWave(u);
        wave.start(R0, 1024, 768);
        const corner = Math.hypot(512, 384);
        for (let i = 0; i < 100000 && u.shockActive.value === 1; i++) wave.advance(0.0125);
        expect(u.shockActive.value).toBe(0);
        expect(u.shockOuter.value).toBeGreaterThanOrEqual(Math.min(corner, R0 * SHOCK_STRENGTH / SHOCK_MIN_KICK));
        expect(u.shockOuter.value).toBeLessThan(corner + 10);

        u.shockActive.value = 1;
        u.supernovaSpeed.value = 0;
        wave.advance(0.0125);
        expect(u.shockActive.value).toBe(0);
    });
});
