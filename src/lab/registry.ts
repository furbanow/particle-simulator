// The scenarios of the lab, in the order they run. To add one: write a `Scenario` (see
// docs/lab.md) in src/lab/scenarios/ and list it here.

import { defaultCloud, defaultCloudVariants, ignitionRatioBaseline } from './scenarios/baseline';
import { diagnosticsCost } from './scenarios/diagnosticsCost';
import { dustCloudScenarios } from './scenarios/dustCloud';
import { dustGranularScenarios } from './scenarios/dustGranular';
import { dustGravityScenarios } from './scenarios/dustGravity';
import { energyDrift, energyDriftAttribution, energyReference, reductionChannels } from './scenarios/energy';
import { halfFloatDeposit } from './scenarios/halfFloat';
import { heating } from './scenarios/heating';
import { temperatureNoise } from './scenarios/temperatureNoise';
import { temperatureSmoothing } from './scenarios/temperatureSmoothing';
import { perfScenarios } from './scenarios/perf';
import { perfPhaseScenarios } from './scenarios/perfPhases';
import { secondDeposit, secondDepositLoad } from './scenarios/secondDeposit';
import { secondDepositCost } from './scenarios/secondDepositCost';
import { selftest } from './scenarios/selftest';
import type { Scenario } from './types';

export const SCENARIOS: readonly Scenario[] = [
    selftest,
    halfFloatDeposit,
    secondDeposit,
    secondDepositLoad,
    heating,
    temperatureNoise,
    temperatureSmoothing,
    ignitionRatioBaseline,
    defaultCloud,
    defaultCloudVariants,
    energyReference,
    reductionChannels,
    energyDrift,
    energyDriftAttribution,
    ...dustGravityScenarios,
    ...dustCloudScenarios,
    ...dustGranularScenarios,
    ...perfScenarios,
    ...perfPhaseScenarios,
    secondDepositCost,
    diagnosticsCost,
];
