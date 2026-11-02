import * as THREE from 'three';
import { MASS_SLIDER_STEPS } from '../config';
import {
    formatMass, massToSlider, randomSpeciesHsl, randomSpeciesMasses, sliderToMass, speciesDensity,
    type Species,
} from '../species';
import { makeCollapsible } from './panelState';
import { syncRange } from './sliders';

interface SpeciesCard {
    el: HTMLElement;
    setColor(hex: string): void;
    setMass(mass: number): void;
}

const CHEVRON = '<svg class="chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

/**
 * One compact row per species (color, name, mass / size / density summary); clicking the row
 * expands its sliders. Edits write straight into the shared `Species` objects.
 */
export class SpeciesPanel {
    private readonly cards: SpeciesCard[];

    constructor(private readonly container: HTMLElement, species: Species[],
                private readonly toggleBtn: HTMLButtonElement, onChange: () => void) {
        this.cards = species.map((s, k) => this.buildCard(s, k, onChange));
        toggleBtn.addEventListener('click', () => {
            const open = !toggleBtn.classList.contains('expanded');
            this.cards.forEach(c => c.el.classList.toggle('open', open));
            this.updateToggleLabel();
        });
    }

    /**
     * A card is shown for every species that is either selected or still running; a card whose
     * state will change on the next restart is dimmed.
     */
    showCounts(selected: number, active: number): void {
        this.cards.forEach(({ el }, k) => {
            el.hidden = k >= Math.max(selected, active);
            el.classList.toggle('pending', (k < selected) !== (k < active));
        });
        this.updateToggleLabel();
    }

    randomizeColors(): void {
        const color = new THREE.Color();
        randomSpeciesHsl(this.cards.length, this.visibleCount()).forEach(({ h, s, l }, k) => {
            color.setHSL(h, s, l, THREE.SRGBColorSpace);
            this.cards[k].setColor(`#${color.getHexString(THREE.SRGBColorSpace)}`);
        });
    }

    randomizeMasses(): void {
        randomSpeciesMasses(this.cards.length, this.visibleCount()).forEach((m, k) => this.cards[k].setMass(m));
    }

    private visibleCount(): number {
        return this.cards.filter(c => !c.el.hidden).length;
    }

    private updateToggleLabel(): void {
        const anyOpen = this.cards.some(c => !c.el.hidden && c.el.classList.contains('open'));
        const label = anyOpen ? 'Tout replier' : 'Tout déplier';
        this.toggleBtn.classList.toggle('expanded', anyOpen);
        this.toggleBtn.title = label;
        this.toggleBtn.setAttribute('aria-label', label);
    }

    private buildCard(s: Species, k: number, onChange: () => void): SpeciesCard {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `
            <div class="card-head">
                ${CHEVRON}
                <input type="color" value="${s.color}" title="Couleur">
                <span class="card-name">Sorte ${k + 1}</span>
                <span class="summary">
                    <span title="Masse" data-out="sumMass"></span>
                    <span title="Taille (px)" data-out="sumSize"></span>
                    <span title="Densité" data-out="sumDensity"></span>
                </span>
            </div>
            <div class="card-body collapse"><div class="inner">
                <label class="field">
                    <span class="field-row">Masse <span class="value-display" data-out="mass"></span></span>
                    <input type="range" data-in="mass" min="0" max="${MASS_SLIDER_STEPS}" step="1" value="${massToSlider(s.mass)}"></label>
                <label class="field">
                    <span class="field-row">Taille <span class="value-display" data-out="size"></span></span>
                    <input type="range" data-in="size" min="1" max="6" step="0.5" value="${s.size}"></label>
            </div></div>`;
        const colorInput = el.querySelector<HTMLInputElement>('input[type=color]')!;
        const massInput = el.querySelector<HTMLInputElement>('[data-in=mass]')!;
        const sizeInput = el.querySelector<HTMLInputElement>('[data-in=size]')!;
        const out = (name: string) => el.querySelector<HTMLElement>(`[data-out=${name}]`)!;

        const refresh = () => {
            s.color = colorInput.value;
            s.mass = sliderToMass(parseFloat(massInput.value));
            s.size = parseFloat(sizeInput.value);
            el.style.setProperty('--card-color', s.color);
            out('mass').textContent = formatMass(s.mass);
            out('size').textContent = `${s.size.toFixed(1)} px`;
            out('sumMass').textContent = `m${formatMass(s.mass)}`;
            out('sumSize').textContent = `⌀${s.size.toFixed(1)}`;
            out('sumDensity').textContent = `ρ${speciesDensity(s).toFixed(2)}`;
            syncRange(massInput);
            syncRange(sizeInput);
            onChange();
        };
        for (const input of [colorInput, massInput, sizeInput]) input.addEventListener('input', refresh);
        makeCollapsible(el, el.querySelector<HTMLElement>('.card-head')!, () => this.updateToggleLabel());
        refresh();
        this.container.appendChild(el);
        return {
            el,
            setColor: hex => { colorInput.value = hex; refresh(); },
            setMass: m => { massInput.value = String(massToSlider(m)); refresh(); },
        };
    }
}
