// Catalog of the selectable simulation algorithms: their declarations (pure data, no GPU or DOM).
// The GPU side of each one is registered in gpuModels.ts, under the same id.

import type { AlgorithmDeclaration } from './algorithm';
import { PROTOSTAR } from './protostar/declaration';
import { STICKY_DUST } from './stickyDust/declaration';

export const ALGORITHM_IDS = ['stickyDust', 'protostar'] as const;
export type AlgorithmId = typeof ALGORITHM_IDS[number];

/** Declarations by id, in display order (ALGORITHM_IDS). */
export const ALGORITHMS: Readonly<Record<AlgorithmId, AlgorithmDeclaration>> = {
    stickyDust: STICKY_DUST,
    protostar: PROTOSTAR,
};

export const DEFAULT_ALGORITHM: AlgorithmId = 'stickyDust';

export const isAlgorithmId = (value: string): value is AlgorithmId =>
    (ALGORITHM_IDS as readonly string[]).includes(value);

export const algorithmList = (): AlgorithmDeclaration[] => ALGORITHM_IDS.map(id => ALGORITHMS[id]);
