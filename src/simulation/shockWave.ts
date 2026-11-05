import type * as THREE from 'three';
import { MAX_SHOCK_WAVES, SHOCK_MIN_KICK, SHOCK_STRENGTH } from '../config';
import type { Uniform } from '../gl/common';

/** The velocity-shader uniforms driven by the shock waves. */
export interface ShockUniforms {
    supernovaSpeed: Uniform<number>;
    /** Number of running waves: they fill the first slots of the arrays below, oldest first. */
    shockCount: Uniform<number>;
    /** Per wave: center x, center y, front radius at the previous step, front radius now. */
    shockFronts: Uniform<THREE.Vector4[]>;
    /** Per wave: aggregate radius (kick reference distance). */
    shockRefs: Uniform<number[]>;
}

/**
 * Expanding fronts after the supernovae. Each one starts at the aggregate edge, moves at the
 * ejection speed and stops at the farthest screen corner or where the kick has become negligible.
 * When every slot is taken, a new wave replaces the oldest one, whose kick is the weakest.
 */
export class ShockWaves {
    private readonly radii = new Array<number>(MAX_SHOCK_WAVES).fill(0);
    private readonly maxRadii = new Array<number>(MAX_SHOCK_WAVES).fill(0);

    constructor(private readonly u: ShockUniforms) {}

    start(centerX: number, centerY: number, aggregateRadius: number, width: number, height: number): void {
        const { u } = this;
        if (u.shockCount.value === MAX_SHOCK_WAVES) {
            for (let i = 1; i < MAX_SHOCK_WAVES; i++) this.moveSlot(i, i - 1);
            u.shockCount.value--;
        }
        const slot = u.shockCount.value++;
        const ref = Math.max(aggregateRadius, 1);
        const corner = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY));
        u.shockFronts.value[slot].set(centerX, centerY, ref, ref);
        u.shockRefs.value[slot] = ref;
        this.radii[slot] = ref;
        this.maxRadii[slot] = Math.min(corner, ref * SHOCK_STRENGTH / SHOCK_MIN_KICK);
    }

    advance(dt: number): void {
        const { u } = this;
        const speed = u.supernovaSpeed.value;
        let kept = 0;
        for (let i = 0; i < u.shockCount.value; i++) {
            if (this.radii[i] >= this.maxRadii[i] || speed <= 0) continue;
            if (kept !== i) this.moveSlot(i, kept);
            const front = u.shockFronts.value[kept];
            front.z = this.radii[kept];
            this.radii[kept] += speed * dt;
            front.w = this.radii[kept];
            kept++;
        }
        u.shockCount.value = kept;
    }

    stop(): void {
        this.u.shockCount.value = 0;
    }

    private moveSlot(from: number, to: number): void {
        const { u } = this;
        u.shockFronts.value[to].copy(u.shockFronts.value[from]);
        u.shockRefs.value[to] = u.shockRefs.value[from];
        this.radii[to] = this.radii[from];
        this.maxRadii[to] = this.maxRadii[from];
    }
}
