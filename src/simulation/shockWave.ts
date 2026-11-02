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
 * Expanding front after a supernova. It starts at the aggregate edge, moves at the ejection
 * speed and stops at the farthest screen corner or where the kick has become negligible.
 */
export class ShockWave {
    private radius = 0;
    private maxRadius = 0;

    constructor(private readonly u: ShockUniforms) {}

    start(aggregateRadius: number, width: number, height: number): void {
        const { u } = this;
        const c = u.supernovaCenter.value;
        const ref = Math.max(aggregateRadius, 1);
        u.shockCenter.value.copy(c);
        u.shockRef.value = ref;
        this.radius = ref;
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
        this.radius += speed * dt;
        u.shockOuter.value = this.radius;
    }

    stop(): void {
        this.u.shockActive.value = 0;
    }
}
