// The refactoring of the protostar's grids into a grid chain (phase P9, C2's first step), on the real GPU:
//  - protostar.grid-chain.parity: the refactored ProtostarGrids and a frozen copy of the grids before it (lab/legacy/protostarGrids.ts),
//    both built afresh in the same run, draw their grids from the same particles with the same uniforms; every target (all the
//    attachments of the moments and of the gas, the power, the heat, the coarse grid, the gravity, the collision deposit, the reductions)
//    must be the same to the bit, for each setting of the flags. Two separate runs are not comparable on Direct3D 11 (the order of the
//    additive blending), which is why both are drawn here.

import * as THREE from 'three';
import { PROTOSTAR_PARAM } from '../../simulation/protostar/declaration';
import { ProtostarGrids, type ProtostarCommonUniforms } from '../../simulation/protostar/grids';
import { LegacyProtostarGrids } from '../legacy/protostarGrids';
import { GRID_CHAIN_PARITY_FLAGS, GRID_CHAIN_PARITY_FRAMES, GRID_CHAIN_PARITY_PARTICLES } from '../config';
import { protostarModel, restart, runFrames } from '../driver';
import { readAttachment, readTarget } from '../readback';
import type { JsonValue, LabContext, Scenario, ScenarioOutcome } from '../types';

/** What both kinds of grids answer to. */
type AnyGrids = ProtostarGrids | LegacyProtostarGrids;

/** Copies the values of the model's common uniforms (not the textures, which each set of grids publishes itself) into `to`. */
function copyCommon(from: ProtostarCommonUniforms, to: object): void {
    const source = from as unknown as Record<string, THREE.IUniform>;
    const target = to as unknown as Record<string, THREE.IUniform>;
    for (const [key, uniform] of Object.entries(source)) {
        const value: unknown = uniform.value;
        if (value === null || value instanceof THREE.Texture) continue;
        if (Array.isArray(value)) target[key].value = [...(value as unknown[])];
        else if (value instanceof THREE.Vector2) target[key].value = value.clone();
        else target[key].value = value;
    }
}

/** Every target of a set of grids, attachment by attachment, after an update and a reduction. */
async function readAll(context: LabContext, grids: AnyGrids): Promise<Map<string, Float32Array>> {
    const { renderer } = context;
    const t = grids.targets;
    const out = new Map<string, Float32Array>();
    const all = async (name: string, target: THREE.WebGLRenderTarget | null): Promise<void> => {
        if (!target) return;
        for (let k = 0; k < target.textures.length; k++) out.set(`${name}.${k}`, await readAttachment(renderer, target, k));
    };
    await all('moments', t.moments);
    await all('gas', t.gas);
    await all('power', t.power);
    await all('heat', t.heat);
    await all('coarse', t.coarse);
    await all('gravity', t.gravity);
    await all('collision', t.collision);
    grids.stashPotential();
    grids.reduceStats();
    out.set('potential', await readTarget(renderer, t.potential));
    out.set('reduction', await readTarget(renderer, t.reduce2));
    return out;
}

/** Floats of the moments grid that change when the model steps once: the comparison is not blind. */
async function sensitivityCheck(context: LabContext): Promise<number> {
    const model = protostarModel(context);
    model.beforeSubstep(0);
    const before = await readTarget(context.renderer, model.debugGridTargets.moments);
    await runFrames(context, 1);
    model.beforeSubstep(0);
    const after = await readTarget(context.renderer, model.debugGridTargets.moments);
    let d = 0;
    for (let k = 0; k < before.length; k++) if (!Object.is(before[k], after[k])) d++;
    return d;
}

const parity: Scenario = {
    id: 'protostar.grid-chain.parity',
    title: 'Grid chain (C2, step 1): the refactored grids against a frozen copy of the old ones, from the same particles in the same run, to the bit',
    tags: ['protostar', 'nested-grid', 'fast'],
    async run(context): Promise<ScenarioOutcome> {
        const { renderer } = context;
        await restart(context, { count: GRID_CHAIN_PARITY_PARTICLES });
        await runFrames(context, GRID_CHAIN_PARITY_FRAMES);
        const model = protostarModel(context);
        const settings: Record<string, JsonValue>[] = [];
        let ok = true;
        const notes: string[] = [];
        for (const flags of GRID_CHAIN_PARITY_FLAGS) {
            model.setParam(PROTOSTAR_PARAM.adaptiveThickness, flags.adaptiveThickness);
            model.beforeSubstep(0);                                   // the model's scales for this setting
            const scales = model.debugGridScales;
            if (!scales) throw new Error('the model has not drawn its grids');
            const inputs = model.debugGridInputs();
            const deposit = model.debugGrids.debugDepositInputs;
            const channels = deposit.fuel.map(([x, y]) => x > 0 ? 0 : y > 0 ? 1 : -1);
            const drawing = model.debugGrids.common;
            const geometry = model.debugGrids.debugGeometry;
            const reads: Map<string, Float32Array>[] = [];
            for (const make of [() => new ProtostarGrids(renderer, geometry, drawing), () => new LegacyProtostarGrids(renderer, geometry, drawing)]) {
                const grids = make();
                try {
                    copyCommon(model.debugGrids.common, grids.common);
                    grids.setScales(scales);
                    grids.setDepositMasses(deposit.depositMass);
                    grids.setInverseMolecularWeights(deposit.inverseMolecularWeight);
                    grids.setFuelChannels(channels);
                    grids.setTscDeposit(flags.tscDeposit);
                    grids.shareStepLength({ value: 1 / 120 });
                    grids.setCollisions(flags.collisions);
                    grids.startRun();
                    grids.update(inputs.positions, inputs.velocities, 1 / 120, inputs.accelerations);
                    reads.push(await readAll(context, grids));
                } finally {
                    grids.dispose();
                }
            }
            const [refactored, legacy] = reads;
            let differing = 0, floats = 0;
            const differ: string[] = [];
            for (const [name, values] of legacy) {
                const other = refactored.get(name);
                if (!other || other.length !== values.length) { differ.push(`${name} (missing)`); ok = false; continue; }
                let d = 0;
                for (let k = 0; k < values.length; k++) if (!Object.is(values[k], other[k])) d++;
                floats += values.length;
                differing += d;
                if (d > 0) differ.push(`${name} (${d})`);
            }
            ok &&= differing === 0 && refactored.size === legacy.size;
            settings.push({ name: flags.name, targets: legacy.size, floats, differing, differ });
            notes.push(`${flags.name}: ${differing} of ${floats} floats differ over ${legacy.size} targets${differ.length ? ` (${differ.join(', ')})` : ''}`);
        }
        // The comparison can see a difference: the same grids drawn from the particles one substep later (velocities changed) must differ.
        const sensitivity = await sensitivityCheck(context);
        ok &&= sensitivity > 0;
        notes.push(`a later state differs in ${sensitivity} floats of the moments`);
        model.setParam(PROTOSTAR_PARAM.adaptiveThickness, false);
        model.setParam(PROTOSTAR_PARAM.tscDeposit, false);
        model.setParam(PROTOSTAR_PARAM.collisions, false);
        model.beforeSubstep(0);                                       // the model's own grids publish their textures again
        return { status: ok ? 'pass' : 'fail', metrics: { settings, sensitivityFloats: sensitivity }, details: notes.join('; ') };
    },
};

export const gridChainScenarios: readonly Scenario[] = [parity];
