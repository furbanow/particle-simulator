/**
 * Head summaries shown while a section is folded: "{id}" in `data-summary` is replaced by the
 * text of the element with that id. The summaries are looked up on every call, so sections built
 * later (the algorithm's parameters) are included.
 */
export function createSummaries(root: ParentNode = document): () => void {
    return () => {
        for (const el of root.querySelectorAll<HTMLElement>('[data-summary]')) {
            el.textContent = el.dataset.summary!.replace(/\{(\w+)\}/g,
                (_, id: string) => document.getElementById(id)?.textContent ?? '');
        }
    };
}
