import { cleanName } from '../elementConfigs';
import type { ParticleType, ParticleTypeSchema } from '../simulation/algorithm';

/** Sets an input's value only when it differs, so the caret doesn't jump while typing. */
function setValue(input: HTMLInputElement, value: string): void {
    if (input.value !== value) input.value = value;
}

/**
 * Compact editor of the selected type: its color (a swatch opening the color picker), its name,
 * the read-only values its schema derives from it (e.g. density) and the types it turns into.
 * The other properties are edited on the chart. Each input only writes its own field into the
 * shared `ParticleType` object.
 */
export class ElementEditor {
    private index = 0;
    private readonly colorInput: HTMLInputElement;
    private readonly nameInput: HTMLInputElement;
    private readonly readouts: HTMLElement[];
    private readonly transitions: HTMLElement;

    /** `onChange(live)` follows every edit, `live` when the running simulation must be updated. */
    constructor(private readonly container: HTMLElement, private readonly schema: ParticleTypeSchema,
                private readonly species: readonly ParticleType[], onChange: (live: boolean) => void) {
        container.innerHTML = `
            <div class="editor-head">
                <input type="color" title="Couleur" aria-label="Couleur">
                <input type="text" class="editor-name" title="Nom" aria-label="Nom" spellcheck="false">
            </div>`;
        this.readouts = (schema.readouts ?? []).map(r => {
            const line = document.createElement('div');
            line.className = 'editor-readout';
            line.append(`${r.label} `, document.createElement('span'));
            container.appendChild(line);
            return line.querySelector('span')!;
        });
        this.transitions = document.createElement('div');
        this.transitions.className = 'editor-readout';
        container.appendChild(this.transitions);
        this.colorInput = container.querySelector<HTMLInputElement>('input[type=color]')!;
        this.nameInput = container.querySelector<HTMLInputElement>('.editor-name')!;

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

    private get current(): ParticleType {
        return this.species[this.index];
    }

    show(index: number): void {
        this.index = index;
        this.refresh(true);
    }

    /**
     * Re-reads the type. The name field being edited is left alone unless `force` is set,
     * so the caret doesn't jump.
     */
    refresh(force = false): void {
        const t = this.current;
        const editing = !force && document.activeElement === this.nameInput;
        this.container.style.setProperty('--card-color', t.color);
        setValue(this.colorInput, t.color);
        if (!editing) setValue(this.nameInput, t.name);
        (this.schema.readouts ?? []).forEach((r, i) => { this.readouts[i].textContent = r.format(t); });
        const into = (this.schema.transitions ?? []).filter(tr => tr.from === this.index && this.species[tr.to]);
        this.transitions.textContent = into.map(tr => `${tr.label} → ${this.species[tr.to].symbol}`).join(' · ');
        this.transitions.hidden = into.length === 0;
    }
}
