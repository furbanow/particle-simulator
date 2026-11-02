export type Defines = Record<string, string | number>;

/** Float literal for GLSL (`60` -> `60.0`). */
export const glslFloat = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Prepends `#define NAME VALUE` lines to a shader source. */
export function withDefines(source: string, defines: Defines): string {
    const header = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n');
    return `${header}\n${source}`;
}
