import type * as THREE from 'three';
import { SHOCK_MIN_KICK, SHOCK_STRENGTH } from '../config';
import type { Uniform } from '../gl/common';

/** The velocity-shader uniforms driven by the shock wave. */
export interface ShockUniforms {
    supernovaCenter: Uniform<THREE.Vector2>;
    supernovaSpeed: Uniform<number>;
    shockActive: Uniform<number>;
    shockCenter: Uniform<THREE.Vector2>;
    shockInner: Uniform<number>;
    shockOuter: Uniform<number>;
    shockRef: Uniform<number>;
}

/**
 * The constant K (px^2/s) of the front law R dR/dt = K, chosen so that the front moves at `speed` (px/s) when it
 * is at `radius0` (px): K = speed x radius0.
 */
export const frontConstant = (speed: number, radius0: number): number => speed * radius0;

/**
 * Radius of the front `dt` seconds after it was at `radius`. In two dimensions a blast that keeps its energy
 * obeys dR/dt = K / R (Sedov-Taylor, R ~ t^(1/2)), so R^2 grows linearly with time: R^2 = radius^2 + 2 K dt. Exact for
 * any dt, and it can be chained step after step (K may change between the steps).
 */
export const advanceFront = (radius: number, k: number, dt: number): number => Math.sqrt(radius * radius + 2 * k * dt);

/** Radius of the front `t` seconds after it started at `radius0` moving at `speed`. */
export const frontRadiusAt = (radius0: number, speed: number, t: number): number =>
    advanceFront(radius0, frontConstant(speed, radius0), t);

/** Speed of the front at `radius`: K / R. */
export const frontSpeed = (radius: number, k: number): number => k / radius;

/**
 * Expanding front after a supernova. It starts at the aggregate edge at the ejection speed, slows down as
 * dR/dt = K / R (see advanceFront) and stops at the farthest screen corner or where the kick has become negligible.
 */
export class ShockWave {
    private radius = 0;
    private maxRadius = 0;
    /** Radius at which the front started: with the speed slider, it sets K. */
    private startRadius = 1;

    constructor(private readonly u: ShockUniforms) {}

    start(aggregateRadius: number, width: number, height: number): void {
        const { u } = this;
        const c = u.supernovaCenter.value;
        const ref = Math.max(aggregateRadius, 1);
        u.shockCenter.value.copy(c);
        u.shockRef.value = ref;
        this.radius = ref;
        this.startRadius = ref;
        const corner = Math.hypot(Math.max(c.x, width - c.x), Math.max(c.y, height - c.y));
        this.maxRadius = Math.min(corner, ref * SHOCK_STRENGTH / SHOCK_MIN_KICK);
        u.shockInner.value = this.radius;
        u.shockOuter.value = this.radius;
        u.shockActive.value = 1;
    }

    advance(dt: number): void {
        const { u } = this;
        if (u.shockActive.value === 0) return;
        const speed = u.supernovaSpeed.value;
        if (this.radius >= this.maxRadius || speed <= 0) {
            u.shockActive.value = 0;
            return;
        }
        u.shockInner.value = this.radius;
        this.radius = advanceFront(this.radius, frontConstant(speed, this.startRadius), dt);
        u.shockOuter.value = this.radius;
    }

    stop(): void {
        this.u.shockActive.value = 0;
    }
}
