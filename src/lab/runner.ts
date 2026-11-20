import { forceHalfFloatDeposit } from '../simulation/protostar/grids';
import { LAB_SEED } from './config';
import { jsonSafe } from './json';
import { withSeededRandom } from './random';
import type { JsonValue, LabContext, LabResults, Scenario, ScenarioResult } from './types';

const errorText = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);

/** Runs one scenario under the default seed; an exception is a failure, not a crash of the lab. */
export async function runScenario(context: LabContext, scenario: Scenario): Promise<ScenarioResult> {
    const started = performance.now();
    context.log(`running ${scenario.id}`);
    try {
        const outcome = await withSeededRandom(LAB_SEED, () => scenario.run(context));
        return {
            id: scenario.id, title: scenario.title, status: outcome.status, details: outcome.details,
            metrics: jsonSafe(outcome.metrics) as Record<string, JsonValue>, durationMs: Math.round(performance.now() - started),
        };
    } catch (error) {
        return {
            id: scenario.id, title: scenario.title, status: 'fail', metrics: {}, details: errorText(error),
            durationMs: Math.round(performance.now() - started),
        };
    } finally {
        forceHalfFloatDeposit(false);
    }
}

/** Runs the scenarios one after the other; `onResult` hears each as soon as it is done. */
export async function runScenarios(context: LabContext, scenarios: readonly Scenario[],
                                   onResult: (result: ScenarioResult) => void = () => {}): Promise<LabResults> {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
        const result = await runScenario(context, scenario);
        results.push(result);
        onResult(result);
    }
    return {
        renderer: context.rendererName,
        software: context.software,
        floatBlend: context.floatBlend,
        userAgent: navigator.userAgent,
        startedAt,
        totalMs: Math.round(performance.now() - started),
        scenarios: results,
    };
}
