import { PROTOSTAR_GRAVITY_SLIDER, PROTOSTAR_FEEDBACK_SLIDER } from '../../config';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import {
    LAB_SEED, SELFTEST_FRAMES, SELFTEST_FUSION_RATE, SELFTEST_MASS_TOLERANCE, SELFTEST_PARTICLES,
} from '../config';
import { protostarGrids, protostarModel, restart, runFrames } from '../driver';
import { maxAbsChannel, maxAbsDiff, relativeDiff, sumChannel } from '../numbers';
import { withSeededRandom } from '../random';
import { readTarget, readTargetSync } from '../readback';
import type { Scenario, ScenarioOutcome } from '../types';

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}

const P = PROTOSTAR_PARAM;

/** The infrastructure itself: the seeded random numbers, the slider bypass, the read-back and the replay of a run. */
export const selftest: Scenario = {
    id: 'lab.selftest',
    title: 'Lab self-test: seeds, slider bypass, grid read-back, replay',
    tags: ['selftest', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { simulation } = context;
        const checks: Check[] = [];
        const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };
        const metrics: ScenarioOutcome['metrics'] = {};

        // 1. The seeded generator repeats, and Math.random comes back.
        const original = Math.random;
        const draw = () => withSeededRandom(LAB_SEED, () => [Math.random(), Math.random(), Math.random()]);
        const [a, b] = [await draw(), await draw()];
        check('seeded-random', a.every((v, i) => v === b[i]) && Math.random === original, `first draws ${a.map(v => v.toFixed(6)).join(', ')}`);

        // 2. The sliders have minima; the model can be set below them. At G = 0 the gravity grid is zero.
        simulation.setParam(P.gravity, 0);
        simulation.setParam(P.feedback, 0);
        const sliderGravity = simulation.params[P.gravity];
        const sliderFeedback = simulation.params[P.feedback];
        check('slider-minima', sliderGravity === PROTOSTAR_GRAVITY_SLIDER.min && sliderFeedback === PROTOSTAR_FEEDBACK_SLIDER.min,
            `Simulation.setParam(0) gives gravity ${String(sliderGravity)}, feedback ${String(sliderFeedback)}`);
        await restart(context, { count: SELFTEST_PARTICLES, overrides: { [P.gravity]: 0, [P.feedback]: 0 } });
        const model = protostarModel(context);
        check('bypass-applied', model.debugParams[P.gravity] === 0 && model.debugParams[P.feedback] === 0,
            `model gravity ${String(model.debugParams[P.gravity])}, feedback ${String(model.debugParams[P.feedback])} after reset()`);
        await runFrames(context, SELFTEST_FRAMES);
        const grids = protostarGrids(context);
        const gravity = await readTarget(context.renderer, grids.gravity);
        const strongest = Math.max(maxAbsChannel(gravity, 0), maxAbsChannel(gravity, 1));
        metrics.maxGravityAtZeroG = strongest;
        check('zero-gravity-grid', strongest === 0 && gravity.length > 0, `largest |a| in the gravity grid at G = 0: ${strongest}`);

        // 3. The deposit holds `count` units of mass in total, and both read-backs agree.
        const moments = await readTarget(context.renderer, grids.moments);
        const massSum = sumChannel(moments, 0);
        const massError = relativeDiff(massSum, SELFTEST_PARTICLES);
        metrics.depositedMass = massSum;
        metrics.depositedMassError = massError;
        check('deposit-mass', massError < SELFTEST_MASS_TOLERANCE, `sum of the moments' mass ${massSum.toFixed(3)} for ${SELFTEST_PARTICLES} particles (error ${massError.toExponential(2)})`);
        const gas = await readTarget(context.renderer, grids.gas);
        const gasSync = readTargetSync(context.renderer, grids.gas);
        check('async-sync-read', maxAbsDiff(gas, gasSync) === 0, `async and sync read-backs of the gas grid differ by ${maxAbsDiff(gas, gasSync)}`);

        // 4. Replay: the same seed gives the same grids bit for bit, another seed does not. Fusions are
        // forced (a rate far above the slider's) so the GPU random stream takes part.
        const replay = async (seed: number): Promise<{ moments: Float32Array; fusions: number }> => {
            await restart(context, { count: SELFTEST_PARTICLES, overrides: { [P.fusionRate]: SELFTEST_FUSION_RATE }, seed });
            await runFrames(context, SELFTEST_FRAMES);
            const g = protostarGrids(context);
            return { moments: await readTarget(context.renderer, g.moments), fusions: sumChannel(await readTarget(context.renderer, g.power), 1) };
        };
        const first = await replay(LAB_SEED);
        const second = await replay(LAB_SEED);
        const other = await replay(LAB_SEED + 1);
        const replayDiff = maxAbsDiff(first.moments, second.moments);
        const otherDiff = maxAbsDiff(first.moments, other.moments);
        metrics.replayMaxDiff = replayDiff;
        metrics.otherSeedMaxDiff = otherDiff;
        metrics.replayFusionsPerSecond = first.fusions;
        check('replay-identical', replayDiff === 0, `two runs of the same seed differ by ${replayDiff} in the moments grid`);
        check('replay-exercises-fusion', first.fusions > 0, `${first.fusions.toFixed(2)} expected fusions/s in the forced-fusion run`);
        check('seed-matters', otherDiff > 0, `another seed differs by ${otherDiff}`);

        metrics.checks = checks.map(c => ({ name: c.name, ok: c.ok, detail: c.detail }));
        const failed = checks.filter(c => !c.ok);
        return {
            status: failed.length === 0 ? 'pass' : 'fail',
            metrics,
            details: failed.length === 0 ? `${checks.length} checks passed` : failed.map(c => `${c.name}: ${c.detail}`).join('; '),
        };
    },
};
