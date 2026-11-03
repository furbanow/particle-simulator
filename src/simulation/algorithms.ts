// Catalog of the selectable simulation algorithms (pure data, no GPU or DOM).

export const ALGORITHM_IDS = ['stickyDust'] as const;
export type AlgorithmId = typeof ALGORITHM_IDS[number];

export interface AlgorithmInfo {
    id: AlgorithmId;
    /** Name shown in the UI. */
    label: string;
    /** One-line explanation shown under the selector. */
    description: string;
}

export const ALGORITHMS: readonly AlgorithmInfo[] = [
    {
        id: 'stickyDust',
        label: 'Poussière collante',
        description: 'Gravité sur grille multi-échelle ; les amas résistent à la compression et absorbent l\'agitation.',
    },
];

export const DEFAULT_ALGORITHM: AlgorithmId = 'stickyDust';

export const isAlgorithmId = (value: string): value is AlgorithmId =>
    (ALGORITHM_IDS as readonly string[]).includes(value);

export function algorithmInfo(id: AlgorithmId): AlgorithmInfo {
    const info = ALGORITHMS.find(a => a.id === id);
    if (!info) throw new Error(`Algorithme inconnu : ${id}`);
    return info;
}
