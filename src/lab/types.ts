import type * as THREE from 'three';
import type { Simulation } from '../simulation/Simulation';
import type { GpuSync } from './gpuSync';

/** What a scenario can record: plain JSON. */
export type JsonValue = number | string | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type LabStatus = 'pass' | 'fail' | 'skip' | 'known-failure';

/**
 * What a scenario returns. `pass` means it ran and its checks (if any) held; `skip` carries the reason in `details`;
 * `known-failure` means a check missed its target and the miss is documented (the details name the phase that fixes it): it does
 * not make the run fail, but it is not a pass either.
 */
export interface ScenarioOutcome {
    status: LabStatus;
    metrics: Record<string, JsonValue>;
    details: string;
}

/** Parameters of the run that the page URL can change (for quick experiments); the defaults are in config.ts. */
export interface LabOptions {
    baselineParticles: number;
    baselineFrames: number;
    perfFrames: number;
    /** Most readings, and seconds, of a case of protostar.temperature-noise. */
    noiseReadings: number;
    noiseBudgetSeconds: number;
    /** Seeds of each variant of baseline.protostar.default-cloud-tuning, and its variants as JSON (an array of objects, see CloudVariant). */
    cloudSeeds: number;
    cloudVariants: string;
}

/** What a scenario is given: the renderer, the real simulation and the helpers that go with them. */
export interface LabContext {
    readonly renderer: THREE.WebGLRenderer;
    /** UNMASKED_RENDERER of the WebGL context. */
    readonly rendererName: string;
    /** Whether the renderer is a software rasterizer (timings are then meaningless). */
    readonly software: boolean;
    /** Whether the device has EXT_float_blend (else the grids already deposit in half floats). */
    readonly floatBlend: boolean;
    readonly simulation: Simulation;
    /** Waits for the GPU work that the state textures depend on. */
    readonly sync: GpuSync;
    readonly options: LabOptions;
    log(message: string): void;
}

export interface Scenario {
    /** Dotted, stable: `baseline.protostar.default-cloud`. A prefix up to a dot selects the group. */
    readonly id: string;
    readonly title: string;
    /** Free labels for selection (`perf`, `baseline`, `slow`, ...). */
    readonly tags: readonly string[];
    run(context: LabContext): Promise<ScenarioOutcome>;
}

export interface ScenarioResult extends ScenarioOutcome {
    id: string;
    title: string;
    durationMs: number;
}

/** Published as `window.__labResults`. */
export interface LabResults {
    renderer: string;
    software: boolean;
    floatBlend: boolean;
    userAgent: string;
    startedAt: string;
    totalMs: number;
    scenarios: ScenarioResult[];
}
