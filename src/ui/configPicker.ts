import { DELETE_CONFIRM_MS } from '../config';

/** What the picker needs from a store of named configs; `S` is the state a config holds. */
export interface ConfigStore<C, S> {
    list(): readonly C[];
    readonly current: C;
    select(id: string): C;
    duplicate(state: S): C;
    canEdit(id: string): boolean;
    rename(id: string, name: string): boolean;
    canRemove(id: string): boolean;
    remove(id: string): C;
    save(state: S): boolean;
    isDirty(state: S): boolean;
}

export interface ConfigPickerOptions<C, S> {
    /** Holds the controls, found by class: .config-select, .config-name, .dirty-dot, .config-new, … */
    root: HTMLElement;
    store: ConfigStore<C, S>;
    /** The state being edited. */
    state(): S;
    /** Makes a new config, current in the store. */
    create(): C;
    /** A config became current: apply it. */
    onLoad(config: C): void;
    /** Label of the group a config is listed under (none: a flat list). */
    groupOf?(config: C): string;
}

const UNSAVED_CONFIRM = 'Les modifications de la configuration courante ne sont pas enregistrées. Les abandonner ?';
const SAVE_TITLE = 'Enregistrer dans la configuration';
const SAVE_AS_NEW_TITLE = 'La configuration par défaut ne peut pas être modifiée : cliquer ici enregistre vos changements dans une nouvelle configuration';

/**
 * The tools of a list of saved configs: load, new, duplicate, rename, delete, save, and a dot
 * while the state being edited differs from the current config. refresh() must follow any edit
 * of that state.
 */
export class ConfigPicker<C extends { readonly id: string; readonly name: string }, S> {
    /** The "new" button, whose title depends on what a new config holds. */
    readonly newBtn: HTMLButtonElement;
    private readonly store: ConfigStore<C, S>;
    private readonly state: () => S;
    private readonly groupOf?: (config: C) => string;
    private readonly select: HTMLSelectElement;
    private readonly nameInput: HTMLInputElement;
    private readonly dirtyDot: HTMLElement;
    private readonly saveBtn: HTMLButtonElement;
    private readonly deleteBtn: HTMLButtonElement;
    private readonly renameBtn: HTMLButtonElement;
    private deleteTimer = 0;

    constructor({ root, store, state, create, onLoad, groupOf }: ConfigPickerOptions<C, S>) {
        const find = <T extends HTMLElement>(selector: string): T => {
            const el = root.querySelector<T>(selector);
            if (!el) throw new Error(`Élément introuvable : ${selector}`);
            return el;
        };
        this.store = store;
        this.state = state;
        this.groupOf = groupOf;
        this.select = find('.config-select');
        this.nameInput = find('.config-name');
        this.dirtyDot = find('.dirty-dot');
        this.newBtn = find('.config-new');
        this.saveBtn = find('.config-save');
        this.deleteBtn = find('.config-delete');
        this.renameBtn = find('.config-rename');

        const refreshAll = () => {
            this.refreshList();
            this.refresh();
        };
        const load = (config: C) => {
            onLoad(config);
            refreshAll();
        };
        this.select.addEventListener('change', () => {
            const id = this.select.value;
            if (!this.confirmDiscard()) {
                this.select.value = this.store.current.id;
                return;
            }
            load(this.store.select(id));
        });
        this.newBtn.addEventListener('click', () => {
            if (this.confirmDiscard()) load(create());
        });
        find('.config-duplicate').addEventListener('click', () => {
            this.store.duplicate(this.state());          // same state: nothing to reload
            refreshAll();
        });
        this.saveBtn.addEventListener('click', () => {
            // A read-only config (the default one) can't be saved over: its changes go to a new config.
            if (this.store.canEdit(this.store.current.id)) {
                if (this.store.save(this.state())) refreshAll();
            } else {
                this.store.duplicate(this.state());
                refreshAll();
            }
        });
        this.setupDelete(load);
        this.setupRename();
    }

    /** Refreshes the list and the tools that depend on the current config. */
    refreshList(): void {
        const current = this.store.current;
        const option = (c: C) => new Option(c.name, c.id, false, c.id === current.id);
        const groups = new Map<string, HTMLOptGroupElement>();
        this.select.replaceChildren(...this.store.list().flatMap(c => {
            const label = this.groupOf?.(c);
            if (label === undefined) return [option(c)];
            const existing = groups.get(label);
            if (existing) {
                existing.append(option(c));
                return [];
            }
            const group = document.createElement('optgroup');
            group.label = label;
            group.append(option(c));
            groups.set(label, group);
            return [group];
        }));
        this.deleteBtn.disabled = !this.store.canRemove(current.id);
        this.deleteBtn.title = this.deleteBtn.disabled ? 'La configuration par défaut ne peut pas être supprimée'
            : 'Supprimer la configuration';
        this.renameBtn.disabled = !this.store.canEdit(current.id);
        this.renameBtn.title = this.renameBtn.disabled ? 'La configuration par défaut ne peut pas être renommée'
            : 'Renommer la configuration';
    }

    /** Refreshes the tools that depend on the state being edited. */
    refresh(): void {
        const dirty = this.store.isDirty(this.state());
        const editable = this.store.canEdit(this.store.current.id);
        this.dirtyDot.hidden = !dirty;
        this.saveBtn.disabled = !dirty;
        this.saveBtn.title = editable ? SAVE_TITLE : SAVE_AS_NEW_TITLE;
    }

    /** Asks before throwing away unsaved edits. */
    private confirmDiscard(): boolean {
        return !this.store.isDirty(this.state()) || window.confirm(UNSAVED_CONFIRM);
    }

    /** Delete: a first click arms the button, a second one within DELETE_CONFIRM_MS deletes. */
    private setupDelete(load: (config: C) => void): void {
        const disarm = () => {
            window.clearTimeout(this.deleteTimer);
            this.deleteBtn.classList.remove('confirm');
            this.refreshList();
        };
        this.deleteBtn.addEventListener('click', () => {
            if (!this.deleteBtn.classList.contains('confirm')) {
                this.deleteBtn.classList.add('confirm');
                this.deleteBtn.title = 'Cliquer à nouveau pour supprimer';
                this.deleteTimer = window.setTimeout(disarm, DELETE_CONFIRM_MS);
                return;
            }
            disarm();
            load(this.store.remove(this.store.current.id));
        });
        this.deleteBtn.addEventListener('blur', disarm);
    }

    /** Rename in place: the select is swapped for a text field (Enter / blur commit, Escape cancels). */
    private setupRename(): void {
        const input = this.nameInput;
        const endRename = (commit: boolean) => {
            if (input.hidden) return;
            if (commit) this.store.rename(this.store.current.id, input.value);
            input.hidden = true;
            this.select.hidden = false;
            this.refreshList();
        };
        this.renameBtn.addEventListener('click', () => {
            input.value = this.store.current.name;
            this.select.hidden = true;
            input.hidden = false;
            input.focus();
            input.select();
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') endRename(true);
            else if (e.key === 'Escape') endRename(false);
        });
        input.addEventListener('blur', () => endRename(true));
    }
}
