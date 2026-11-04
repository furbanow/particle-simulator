import type { ParamDef } from '../simulation/algorithm';
import { paramToSlider, sliderRange, sliderToParam } from '../simulation/params';
import type { Simulation } from '../simulation/Simulation';
import { setupPersistentCollapsible } from './panelState';
import { syncAllRanges } from './sliders';

const PENDING_HINT = 'Appliqué au redémarrage';
const CHEVRON = '<svg class="chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
// The algorithm's sections are open the first time they are shown.
const SECTIONS_DEFAULT_OPEN = true;
const BOOLEAN_TEXT = { on: 'Oui', off: 'Non' } as const;

interface Control {
    param: ParamDef;
    /** Pushes the control's value into the simulation and paints its display. */
    update(): void;
    pending?: HTMLElement;
}

/**
 * Panel sections of the selected algorithm, built from its declared parameters: a slider per
 * number, a checkbox per switch, a select per choice. Values go to Simulation.setParam(); the ones
 * applied on restart show a hint while they differ from the running simulation. setAlgorithm()
 * rebuilds the sections for another algorithm.
 */
export class ParamPanel {
    private sections: HTMLElement[] = [];
    private controls: Control[] = [];

    /** The sections go just before `anchor`, in the panel. */
    constructor(private readonly anchor: HTMLElement, private readonly sim: Simulation) {
        this.setAlgorithm();
    }

    setAlgorithm(): void {
        for (const section of this.sections) section.remove();
        const algorithm = this.sim.algorithm;
        this.controls = [];
        this.sections = algorithm.sections.map(def => {
            const params = algorithm.params.filter(p => p.section === def.id);
            const section = document.createElement('section');
            section.className = 'section';
            section.dataset.key = def.id;
            const summary = params.filter(p => p.summary).map(p => `{${valueId(p)}}`).join(' · ');
            section.innerHTML = `
                <h2 class="section-head">${CHEVRON}<span></span><span class="summary"></span></h2>
                <div class="section-body collapse"><div class="inner"></div></div>`;
            const head = section.querySelector<HTMLElement>('.section-head')!;
            head.querySelector('span')!.replaceWith(def.label);
            const summaryEl = head.querySelector<HTMLElement>('.summary')!;
            if (summary) summaryEl.dataset.summary = summary;
            else summaryEl.remove();
            const inner = section.querySelector<HTMLElement>('.inner')!;
            for (const param of params) inner.appendChild(this.buildControl(param));
            this.anchor.before(section);
            setupPersistentCollapsible(section, head, def.id, SECTIONS_DEFAULT_OPEN);
            syncAllRanges(section);
            return section;
        });
        for (const control of this.controls) control.update();
    }

    /** Refreshes the pending hints after a restart. */
    afterRestart(): void {
        this.refreshPending();
    }

    private refreshPending(): void {
        for (const { param, pending } of this.controls) {
            if (pending) pending.textContent = this.sim.isPending(param.key) ? PENDING_HINT : '';
        }
    }

    private buildControl(param: ParamDef): HTMLElement {
        const field = document.createElement('label');
        field.className = 'field';
        const row = document.createElement('span');
        row.className = 'field-row';
        row.append(param.label);
        field.appendChild(row);
        const out = document.createElement('span');
        out.className = 'value-display';
        out.id = valueId(param);

        const value = this.sim.params[param.key];
        let input: HTMLInputElement | HTMLSelectElement;
        let update: () => void;
        switch (param.kind) {
            case 'number': {
                const slider = input = document.createElement('input');
                slider.type = 'range';
                const range = sliderRange(param);
                slider.min = String(range.min);
                slider.max = String(range.max);
                slider.step = String(range.step);
                // The default value is the value attribute: double-click goes back to it.
                slider.defaultValue = String(paramToSlider(param, param.default));
                slider.value = String(paramToSlider(param, typeof value === 'number' ? value : param.default));
                row.appendChild(out);
                field.appendChild(slider);
                update = () => {
                    const v = sliderToParam(param, parseFloat(slider.value));
                    this.sim.setParam(param.key, v);
                    out.textContent = param.format(v);
                };
                break;
            }
            case 'boolean': {
                const box = input = document.createElement('input');
                box.type = 'checkbox';
                box.defaultChecked = param.default;
                box.checked = typeof value === 'boolean' ? value : param.default;
                row.append(out, box);
                out.hidden = true;                      // only read by the section summary
                update = () => {
                    this.sim.setParam(param.key, box.checked);
                    out.textContent = box.checked ? BOOLEAN_TEXT.on : BOOLEAN_TEXT.off;
                };
                break;
            }
            case 'choice': {
                const select = input = document.createElement('select');
                select.className = 'param-select';
                for (const o of param.options) select.add(new Option(o.label, o.value, o.value === param.default));
                select.value = typeof value === 'string' ? value : param.default;
                row.append(out, select);
                out.hidden = true;
                update = () => {
                    this.sim.setParam(param.key, select.value);
                    out.textContent = select.selectedOptions[0]?.text ?? '';
                };
                break;
            }
        }
        if (param.hint) {
            const hint = document.createElement('div');
            hint.className = 'hint';
            hint.textContent = param.hint;
            field.appendChild(hint);
        }
        let pending: HTMLElement | undefined;
        if (param.apply === 'restart') {
            pending = document.createElement('div');
            pending.className = 'hint pending';
            field.appendChild(pending);
        }
        const control: Control = { param, pending, update: () => { update(); this.refreshPending(); } };
        input.addEventListener(param.kind === 'number' ? 'input' : 'change', control.update);
        this.controls.push(control);
        return field;
    }
}

/** Id of a parameter's value display, for the folded section summaries. */
const valueId = (param: ParamDef): string => `param_${param.key}_val`;
