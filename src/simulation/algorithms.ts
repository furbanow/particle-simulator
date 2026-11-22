// Catalog of the selectable simulation algorithms: their declarations (pure data, no GPU or DOM).
// The GPU side of each one is registered in gpuModels.ts, under the same id.

import type { AlgorithmDeclaration, ParamValues } from './algorithm';
import { PROTOSTAR, PROTOSTAR_PARAM } from './protostar/declaration';
import { STICKY_DUST } from './stickyDust/declaration';

export const ALGORITHM_IDS = ['protostar', 'stickyDust'] as const;
export type AlgorithmId = typeof ALGORITHM_IDS[number];

/** Declarations by id, in display order (ALGORITHM_IDS). */
export const ALGORITHMS: Readonly<Record<AlgorithmId, AlgorithmDeclaration>> = {
    protostar: PROTOSTAR,
    stickyDust: STICKY_DUST,
};

export const DEFAULT_ALGORITHM: AlgorithmId = 'protostar';

/** The algorithm whose frames the GPU benchmark times (its particle cap applies to every algorithm). */
export const BENCHMARK_ALGORITHM: AlgorithmId = 'protostar';

/**
 * What the benchmark sets besides the defaults. The adaptive time step is off: the benchmark times the first frames of a restart, the
 * calm ones, where the adaptive step would run fewer substeps than the dense core it runs later, and its count depends on when
 * the asynchronous reads land; the fixed count is a deterministic load, the one the adaptive step is bounded by a ratio of.
 */
export const BENCHMARK_PARAMS: ParamValues = { [PROTOSTAR_PARAM.adaptiveTimeStep]: false };

export const isAlgorithmId = (value: string): value is AlgorithmId =>
    (ALGORITHM_IDS as readonly string[]).includes(value);

export const algorithmList = (): AlgorithmDeclaration[] => ALGORITHM_IDS.map(id => ALGORITHMS[id]);
