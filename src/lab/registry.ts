// The scenarios of the lab, in the order they run. To add one: write a `Scenario` (see
// docs/lab.md) in src/lab/scenarios/ and list it here.

import { defaultCloud, energyDrift, ignitionRatioBaseline } from './scenarios/baseline';
import { halfFloatDeposit } from './scenarios/halfFloat';
import { perfScenarios } from './scenarios/perf';
import { secondDeposit, secondDepositLoad } from './scenarios/secondDeposit';
import { secondDepositCost } from './scenarios/secondDepositCost';
import { selftest } from './scenarios/selftest';
import type { Scenario } from './types';

export const SCENARIOS: readonly Scenario[] = [
    selftest,
    halfFloatDeposit,
    secondDeposit,
    secondDepositLoad,
    ignitionRatioBaseline,
    defaultCloud,
    energyDrift,
    ...perfScenarios,
    secondDepositCost,
];
