// The scenarios of the lab, in the order they run. To add one: write a `Scenario` (see
// docs/lab.md) in src/lab/scenarios/ and list it here.

import { defaultCloud, energyDrift, ignitionRatioBaseline } from './scenarios/baseline';
import { halfFloatDeposit } from './scenarios/halfFloat';
import { perfScenarios } from './scenarios/perf';
import { selftest } from './scenarios/selftest';
import type { Scenario } from './types';

export const SCENARIOS: readonly Scenario[] = [
    selftest,
    halfFloatDeposit,
    ignitionRatioBaseline,
    defaultCloud,
    energyDrift,
    ...perfScenarios,
];
