import { SOFTWARE_RENDERER_PATTERN } from './config';
import type { LabOptions, Scenario } from './types';

/**
 * The scenarios named by `filter`, a comma-separated list of ids, group prefixes (`baseline`
 * selects `baseline.protostar.default-cloud`) or tags, in registry order. No filter selects all.
 */
export function selectScenarios(all: readonly Scenario[], filter: string | null): Scenario[] {
    const tokens = (filter ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (tokens.length === 0) return [...all];
    return all.filter(s => tokens.some(token => s.id === token || s.id.startsWith(`${token}.`) || s.tags.includes(token)));
}

/** Whether a WebGL renderer name (UNMASKED_RENDERER) is a software rasterizer. */
export const isSoftwareRenderer = (name: string): boolean => SOFTWARE_RENDERER_PATTERN.test(name);

/** The options the page URL overrides (`?baselineFrames=300&perfFrames=60`); invalid values are ignored. */
export function parseOptions(search: string, defaults: LabOptions): LabOptions {
    const query = new URLSearchParams(search);
    const integer = (key: string, fallback: number): number => {
        const value = Number(query.get(key));
        return query.has(key) && Number.isInteger(value) && value > 0 ? value : fallback;
    };
    return {
        baselineParticles: integer('baselineParticles', defaults.baselineParticles),
        baselineFrames: integer('baselineFrames', defaults.baselineFrames),
        perfFrames: integer('perfFrames', defaults.perfFrames),
        noiseReadings: integer('noiseReadings', defaults.noiseReadings),
        noiseBudgetSeconds: integer('noiseBudgetSeconds', defaults.noiseBudgetSeconds),
        cloudSeeds: integer('cloudSeeds', defaults.cloudSeeds),
        cloudVariants: query.get('cloudVariants') ?? defaults.cloudVariants,
        perfVariant: query.get('perfVariant') ?? defaults.perfVariant,
        params: query.get('params') ?? defaults.params,
    };
}
