import { cleanName } from '../elementConfigs';
import { speciesDensity, type Species } from '../species';

/** Sets an input's value only when it differs, so the caret doesn't jump while typing. */
function setValue(input: HTMLInputElement, value: string): void {
    if (input.value !== value) input.value = value;
}

/**
 * Compact editor of the selected species: its color (a swatch opening the color picker), its
 * name and its density. The other properties are edited on the chart. Each input only writes
 * its own field into the shared `Species` object.
 */
export class ElementEditor {
    private index = 0;
    private readonly colorInput: HTMLInputElement;
    private readonly nameInput: HTMLInputElement;
    private readonly density: HTMLElement;

    /** `onChange(live)` follows every edit, `live` when the running simulation must be updated. */
    constructor(private readonly container: HTMLElement, private readonly species: readonly Species[],
                onChange: (live: boolean) => void) {
        container.insertAdjacentHTML('beforeend', `
            <div class="editor-head">
                <input type="color" title="Couleur" aria-label="Couleur">
                <input type="text" class="editor-name" title="Nom" aria-label="Nom" spellcheck="false">
            </div>
            <div class="editor-readout">Densité <span></span></div>`);
        this.colorInput = container.querySelector<HTMLInputElement>('input[type=color]')!;
        this.nameInput = container.querySelector<HTMLInputElement>('.editor-name')!;
        this.density = container.querySelector<HTMLElement>('.editor-readout span')!;

        this.colorInput.addEventListener('input', () => {
            this.current.color = this.colorInput.value;
            onChange(true);
        });
        // Names: an empty field is allowed while typing, and reverts to the previous name on commit.
        this.nameInput.addEventListener('input', () => {
            this.current.name = cleanName(this.nameInput.value) || this.current.name;
            onChange(false);
        });
        this.nameInput.addEventListener('change', () => this.refresh(true));
        this.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.nameInput.blur(); });
        this.refresh(true);
    }

    private get current(): Species {
        return this.species[this.index];
    }

    show(index: number): void {
        this.index = index;
        this.refresh(true);
    }

    /**
     * Re-reads the species. The name field being edited is left alone unless `force` is set,
     * so the caret doesn't jump.
     */
    refresh(force = false): void {
        const s = this.current;
        const editing = !force && document.activeElement === this.nameInput;
        this.container.style.setProperty('--card-color', s.color);
        setValue(this.colorInput, s.color);
        if (!editing) setValue(this.nameInput, s.name);
        this.density.textContent = `ρ ${speciesDensity(s).toFixed(2)}`;
    }
}
