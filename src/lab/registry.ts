// The scenarios of the lab, in the order they run. To add one: write a `Scenario` (see
// docs/lab.md) in src/lab/scenarios/ and list it here.

import { defaultCloud, defaultCloudTuning, defaultCloudVariants, ignitionRatioBaseline } from './scenarios/baseline';
import { adaptiveStepScenarios } from './scenarios/adaptiveStep';
import { constantMassScenarios } from './scenarios/constantMass';
import { collisionScenarios } from './scenarios/collisions';
import { coolingScenarios } from './scenarios/cooling';
import { diagnosticsCost } from './scenarios/diagnosticsCost';
import { dustCloudScenarios } from './scenarios/dustCloud';
import { dustConcentrationScenarios } from './scenarios/dustConcentration';
import { dustConcentrationCostScenarios } from './scenarios/dustConcentrationCost';
import { dustGranularScenarios } from './scenarios/dustGranular';
import { dustGravityScenarios } from './scenarios/dustGravity';
import { dustHitchScenarios } from './scenarios/dustHitches';
import { dustSupernovaScenarios } from './scenarios/dustSupernova';
import { dustSupernovaHistoryScenarios } from './scenarios/dustSupernovaHistory';
import { energyDrift, energyDriftAttribution, energyReference, reductionChannels } from './scenarios/energy';
import { fuelFractions, localExponentGas } from './scenarios/gamowRates';
import { initialConditions, initialCost, initialGridForce, maclaurinCollapse, restartCost } from './scenarios/initialConditions';
import { integration } from './scenarios/integration';
import { halfFloatDeposit } from './scenarios/halfFloat';
import { heating } from './scenarios/heating';
import { ignitionGas, molecularWeight } from './scenarios/molecularWeight';
import { temperatureNoise } from './scenarios/temperatureNoise';
import { temperatureSmoothing } from './scenarios/temperatureSmoothing';
import { perfScenarios } from './scenarios/perf';
import { perfPhaseScenarios } from './scenarios/perfPhases';
import { perfProtostarScenarios } from './scenarios/perfProtostar';
import { secondDeposit, secondDepositLoad } from './scenarios/secondDeposit';
import { secondDepositCost } from './scenarios/secondDepositCost';
import { selftest } from './scenarios/selftest';
import { singlePassScenarios } from './scenarios/singlePass';
import { stabilityScenarios } from './scenarios/stabilityMap';
import { gridChainScenarios } from './scenarios/gridChain';
import { nestedGridScenarios } from './scenarios/nestedGrid';
import { thicknessScenarios } from './scenarios/thickness';
import { tscDepositScenarios } from './scenarios/tscDeposit';
import type { Scenario } from './types';

export const SCENARIOS: readonly Scenario[] = [
    selftest,
    halfFloatDeposit,
    secondDeposit,
    secondDepositLoad,
    heating,
    ...coolingScenarios,
    molecularWeight,
    ignitionGas,
    fuelFractions,
    localExponentGas,
    temperatureNoise,
    temperatureSmoothing,
    ignitionRatioBaseline,
    defaultCloud,
    defaultCloudVariants,
    defaultCloudTuning,
    ...constantMassScenarios,
    energyReference,
    reductionChannels,
    energyDrift,
    energyDriftAttribution,
    integration,
    initialConditions,
    initialGridForce,
    maclaurinCollapse,
    initialCost,
    restartCost,
    ...dustGravityScenarios,
    ...dustCloudScenarios,
    ...dustGranularScenarios,
    ...dustConcentrationScenarios,
    ...dustSupernovaScenarios,
    ...dustSupernovaHistoryScenarios,
    ...perfScenarios,
    ...perfPhaseScenarios,
    ...perfProtostarScenarios,
    ...dustHitchScenarios,
    ...dustConcentrationCostScenarios,
    secondDepositCost,
    diagnosticsCost,
    ...adaptiveStepScenarios,
    ...stabilityScenarios,
    ...thicknessScenarios,
    ...gridChainScenarios,
    ...nestedGridScenarios,
    ...tscDepositScenarios,
    ...collisionScenarios,
    ...singlePassScenarios,
];
