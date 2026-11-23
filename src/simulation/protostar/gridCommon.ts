// What every protostar grid pass and particle pass shares: the defines and the shared GLSL of protostar-common.glsl, its uniforms
// (shared by reference by every material that includes it) and the additive deposit of the particles into a grid.
import * as THREE from 'three';
import {
    MAX_SPECIES, PROTOSTAR_COLLISION_ANGLE, PROTOSTAR_COLLISION_MIN_PARTICLES, PROTOSTAR_COLLISION_RATE, PROTOSTAR_FUSION_RATE_MAX, PROTOSTAR_GRID_RES,
    PROTOSTAR_NOISE_EXACT_MARGIN, PROTOSTAR_NOISE_N_MIN, PROTOSTAR_NOISE_SHIFT_MAX, PROTOSTAR_REFERENCE_INVERSE_MU,
} from '../../config';
import { additiveBlending, clipSpaceCamera, type Uniform } from '../../gl/common';
import { glslFloat, withDefines } from '../../gl/withDefines';
import { DRAWING_DEFINES, drawingGlsl, type DrawingUniforms } from '../drawing/DrawingField';
import commonGlsl from '../../shaders/protostar-common.glsl?raw';
import kernelGlsl from '../../shaders/deposit-kernel.glsl?raw';
import depositVert from '../../shaders/protostar-deposit.vert?raw';
import depositFrag from '../../shaders/protostar-deposit.frag?raw';
import { COLLISION_GRID_RES, COLLISION_SEED_SALT } from './collisions';

/**
 * Defines of every shader including protostar-common.glsl. GAS_THERMO is 0 here: the shaders that compute a fusion
 * rate (the power deposit, the position pass) set it to 1 and gasAt() then reads the temperature that feeds the rate; they set GAS_HEAT
 * to 0, as they do not read the heating (two samplers fewer: the nested grid's fine fields would otherwise take the position pass to 16).
 */
export const PROTOSTAR_DEFINES = {
    MAX_SPECIES, GRID_RES: PROTOSTAR_GRID_RES, FUSION_RATE_MAX: glslFloat(PROTOSTAR_FUSION_RATE_MAX),
    NOISE_N_MIN: glslFloat(PROTOSTAR_NOISE_N_MIN),
    NOISE_SHIFT_MAX: glslFloat(PROTOSTAR_NOISE_SHIFT_MAX), NOISE_EXACT_MARGIN: glslFloat(PROTOSTAR_NOISE_EXACT_MARGIN),
    INVERSE_MU_REF: glslFloat(PROTOSTAR_REFERENCE_INVERSE_MU), GAS_THERMO: 0, GAS_HEAT: 1, DEPOSIT_TSC: 0,
    COLLISION_RES: COLLISION_GRID_RES, COLLISION_MIN_PARTICLES: PROTOSTAR_COLLISION_MIN_PARTICLES,
    COLLISION_COS: glslFloat(Math.cos(PROTOSTAR_COLLISION_ANGLE)), COLLISION_SIN: glslFloat(Math.sin(PROTOSTAR_COLLISION_ANGLE)),
    COLLISION_SALT: `${COLLISION_SEED_SALT}u`,
    ...DRAWING_DEFINES,
} as const;

/**
 * What a DepositPass adds up (the DEPOSIT_KIND of protostar-deposit.vert): the moments alone, the
 * fusion power, or the moments with the composition on a second attachment.
 */
export const DEPOSIT_KIND = { moments: 0, power: 1, momentsAndComposition: 2 } as const;
export type DepositKind = (typeof DEPOSIT_KIND)[keyof typeof DEPOSIT_KIND];
const DEPOSIT_KIND_DEFINES = {
    DEPOSIT_MOMENTS: DEPOSIT_KIND.moments, DEPOSIT_POWER: DEPOSIT_KIND.power,
    DEPOSIT_MOMENTS_AND_COMPOSITION: DEPOSIT_KIND.momentsAndComposition,
} as const;

/** Prepends the defines and the shared GLSL (deposit kernel, grid sampling and drawings, fusion rate, random numbers). */
export const withProtostarCommon = (source: string, defines: Record<string, string | number> = {}): string =>
    withDefines(`${kernelGlsl}\n${drawingGlsl}\n${commonGlsl}\n${source}`, { ...PROTOSTAR_DEFINES, ...defines });

/**
 * The uniforms of protostar-common.glsl (and of drawing.glsl, which it uses), shared by reference
 * by every material that includes it.
 */
export interface ProtostarCommonUniforms extends DrawingUniforms {
    gridForce: Uniform<THREE.Texture | null>;
    gridGas: Uniform<THREE.Texture | null>;
    gridHeat: Uniform<THREE.Texture | null>;
    gridThermo: Uniform<THREE.Texture | null>;
    gridFuel: Uniform<THREE.Texture | null>;
    gridCell: Uniform<number>;
    /** The grid's lower left corner, px: (0, 0) for the main grid; a nested grid (C2) has its own. */
    gridOrigin: Uniform<THREE.Vector2>;
    /** 1 while the particles inside the nested box read its fine level (C2: the `nestedGrid` flag and a box placed); 0: the main grid only. */
    nestedOn: Uniform<number>;
    /** The fine cell, px. */
    nestedCell: Uniform<number>;
    /** The fine grid's lower left corner, px. */
    nestedOrigin: Uniform<THREE.Vector2>;
    /** Where the particles read the fine level, px (readRegion() of nestedBox.ts). */
    nestedLo: Uniform<THREE.Vector2>;
    nestedHi: Uniform<THREE.Vector2>;
    /** The fine level's fields: the whole force there (protostar-nested-combine.frag), its gas, heating, thermo and fuel grids. */
    gridForceFine: Uniform<THREE.Texture | null>;
    gridGasFine: Uniform<THREE.Texture | null>;
    gridHeatFine: Uniform<THREE.Texture | null>;
    gridThermoFine: Uniform<THREE.Texture | null>;
    gridFuelFine: Uniform<THREE.Texture | null>;
    /** 1: forceAt() reads the gravity grid with the TSC weights, matched to the TSC deposit (no self-force); 0: bilinearly, matched to cloud-in-cell. */
    tscForce: Uniform<number>;
    fusionTRef: Uniform<number>;
    noiseCorrection: Uniform<number>;
    seed: Uniform<number>;
    reactionTo: Uniform<number[]>;
    reactionRate: Uniform<number[]>;
    reactionPower: Uniform<number[]>;
    reactionBarrier: Uniform<number[]>;
    reactionBarrierPower: Uniform<number[]>;
    reactionFuel: Uniform<number[]>;
    reactionReference: Uniform<number[]>;
    reactionDensityExponent: Uniform<number[]>;
    reactionEnergy: Uniform<number[]>;
    /** The collision deposit (C1): (n, sum v, sum |v|^2) per cell of the shifted collision grid, velocities in L/s. */
    gridCollision: Uniform<THREE.Texture | null>;
    /** 1 while the gas collides (the `collisions` flag): the particle passes then turn the velocities in their cells. */
    collisionsOn: Uniform<number>;
    /** The shift of the collision grid at this substep, px. */
    collisionShift: Uniform<THREE.Vector2>;
    collisionVelScale: Uniform<number>;
    collisionDensity: Uniform<number>;
    /** Collisions per s of a cell at rho0 and the dispersion T0 (PROTOSTAR_COLLISION_RATE; the lab changes it). */
    collisionRate: Uniform<number>;
}

export function createCommonUniforms(drawing: DrawingUniforms): ProtostarCommonUniforms {
    const perType = (fill: number): Uniform<number[]> => ({ value: new Array<number>(MAX_SPECIES).fill(fill) });
    return {
        ...drawing,
        gridForce: { value: null }, gridGas: { value: null }, gridHeat: { value: null }, gridThermo: { value: null }, gridFuel: { value: null },
        gridCell: { value: 1 }, gridOrigin: { value: new THREE.Vector2() },
        nestedOn: { value: 0 }, nestedCell: { value: 1 }, nestedOrigin: { value: new THREE.Vector2() },
        nestedLo: { value: new THREE.Vector2() }, nestedHi: { value: new THREE.Vector2() },
        gridForceFine: { value: null }, gridGasFine: { value: null }, gridHeatFine: { value: null }, gridThermoFine: { value: null },
        gridFuelFine: { value: null },
        tscForce: { value: 0 }, fusionTRef: { value: 1 }, noiseCorrection: { value: 1 }, seed: { value: 0 },
        reactionTo: perType(-1), reactionRate: perType(0),
        reactionPower: perType(0), reactionBarrier: perType(0), reactionBarrierPower: perType(1), reactionFuel: perType(-1),
        reactionReference: perType(1), reactionDensityExponent: perType(1),
        reactionEnergy: perType(0),
        gridCollision: { value: null }, collisionsOn: { value: 0 }, collisionShift: { value: new THREE.Vector2() },
        collisionVelScale: { value: 1 }, collisionDensity: { value: 1 }, collisionRate: { value: PROTOSTAR_COLLISION_RATE },
    };
}

/**
 * An additive deposit of the particles into a render target, with the cloud-in-cell kernel or the TSC one (deposit-kernel.glsl):
 * one material per kernel, the TSC one built on first use.
 */
export class DepositPass {
    private readonly materials: [THREE.ShaderMaterial | null, THREE.ShaderMaterial | null] = [null, null];
    private readonly points: THREE.Points;
    private readonly scene = new THREE.Scene();

    constructor(private readonly kind: DepositKind, private readonly uniforms: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry,
                readonly target: THREE.WebGLRenderTarget) {
        this.points = new THREE.Points(geometry, this.material(false));
        this.points.frustumCulled = false;
        this.scene.add(this.points);
    }

    /** Deposits with the TSC kernel (true) or the cloud-in-cell one (false) from the next render. */
    setTsc(tsc: boolean): void {
        this.points.material = this.material(tsc);
    }

    private material(tsc: boolean): THREE.ShaderMaterial {
        const index = tsc ? 1 : 0;
        const kernel = { DEPOSIT_TSC: tsc ? 1 : 0 };
        this.materials[index] ??= new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: withProtostarCommon(depositVert, {
                DEPOSIT_KIND: this.kind, ...DEPOSIT_KIND_DEFINES, ...kernel, GAS_THERMO: this.kind === DEPOSIT_KIND.power ? 1 : 0, GAS_HEAT: 0,
            }),
            fragmentShader: withDefines(`${kernelGlsl}\n${depositFrag}`, { DEPOSIT_KIND: this.kind, ...DEPOSIT_KIND_DEFINES, ...kernel }),
            ...additiveBlending,
        });
        return this.materials[index];
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, clipSpaceCamera);   // autoClear clears it first
    }

    dispose(): void {
        this.target.dispose();
        for (const material of this.materials) material?.dispose();
    }
}

