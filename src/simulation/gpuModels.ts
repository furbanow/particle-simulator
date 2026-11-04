// GPU side of each algorithm of the catalog (algorithms.ts), by id. The Record type makes a
// declared algorithm without a GPU model a type error.

import type { AlgorithmId } from './algorithms';
import type { GpuModelFactory } from './gpuModel';
import { StickyDustModel } from './stickyDust/gpuModel';

export const GPU_MODELS: Readonly<Record<AlgorithmId, GpuModelFactory>> = {
    stickyDust: context => new StickyDustModel(context),
};
