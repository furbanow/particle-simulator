/**
 * Head summaries shown while a section is folded: "{id}" in `data-summary` is replaced by the
 * text of the element with that id.
 */
export function createSummaries(root: ParentNode = document): () => void {
    const summaries = [...root.querySelectorAll<HTMLElement>('[data-summary]')];
    return () => {
        for (const el of summaries) {
            el.textContent = el.dataset.summary!.replace(/\{(\w+)\}/g,
                (_, id: string) => document.getElementById(id)?.textContent ?? '');
        }
    };
}
