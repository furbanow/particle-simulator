// Catalog of the selectable simulation algorithms: their declarations (pure data, no GPU or DOM).
// The GPU side of each one is registered in gpuModels.ts, under the same id.

import type { AlgorithmDeclaration } from './algorithm';
import { PROTOSTAR } from './protostar/declaration';
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

export const isAlgorithmId = (value: string): value is AlgorithmId =>
    (ALGORITHM_IDS as readonly string[]).includes(value);

export const algorithmList = (): AlgorithmDeclaration[] => ALGORITHM_IDS.map(id => ALGORITHMS[id]);
