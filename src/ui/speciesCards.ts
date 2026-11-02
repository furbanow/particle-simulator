import * as THREE from 'three';
import { MASS_SLIDER_STEPS, SIZE_RANGE, SIZE_STEP } from '../config';
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
        this.cards = species.map(s => this.buildCard(s, onChange));
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

    private buildCard(s: Species, onChange: () => void): SpeciesCard {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `
            <div class="card-head">
                ${CHEVRON}
                <input type="color" value="${s.color}" title="Couleur">
                <span class="card-name">${s.name} <span class="card-symbol">${s.symbol}</span></span>
                <span class="summary">
                    <span title="Masse atomique (u)" data-out="sumMass"></span>
                    <span title="Taille (px)" data-out="sumSize"></span>
                    <span title="Densité" data-out="sumDensity"></span>
                </span>
            </div>
            <div class="card-body collapse"><div class="inner">
                <label class="field">
                    <span class="field-row">Masse atomique <span class="value-display" data-out="mass"></span></span>
                    <input type="range" data-in="mass" min="0" max="${MASS_SLIDER_STEPS}" step="1" value="${massToSlider(s.mass)}"></label>
                <label class="field">
                    <span class="field-row">Taille <span class="value-display" data-out="size"></span></span>
                    <input type="range" data-in="size" min="${SIZE_RANGE[0]}" max="${SIZE_RANGE[1]}" step="${SIZE_STEP}" value="${s.size}"></label>
            </div></div>`;
        const colorInput = el.querySelector<HTMLInputElement>('input[type=color]')!;
        const massInput = el.querySelector<HTMLInputElement>('[data-in=mass]')!;
        const sizeInput = el.querySelector<HTMLInputElement>('[data-in=size]')!;
        const out = (name: string) => el.querySelector<HTMLElement>(`[data-out=${name}]`)!;

        // Each input only writes its own field, so the exact default values (atomic masses,
        // sizes from atomic radii) survive until the user moves that slider.
        colorInput.addEventListener('input', () => { s.color = colorInput.value; refresh(); });
        massInput.addEventListener('input', () => { s.mass = sliderToMass(parseFloat(massInput.value)); refresh(); });
        sizeInput.addEventListener('input', () => { s.size = parseFloat(sizeInput.value); refresh(); });

        function refresh(): void {
            el.style.setProperty('--card-color', s.color);
            out('mass').textContent = `${formatMass(s.mass)} u`;
            out('size').textContent = `${s.size.toFixed(1)} px`;
            out('sumMass').textContent = `m${formatMass(s.mass)}`;
            out('sumSize').textContent = `⌀${s.size.toFixed(1)}`;
            out('sumDensity').textContent = `ρ${speciesDensity(s).toFixed(2)}`;
            syncRange(massInput);
            syncRange(sizeInput);
            onChange();
        }
        makeCollapsible(el, el.querySelector<HTMLElement>('.card-head')!, () => this.updateToggleLabel());
        refresh();
        this.container.appendChild(el);
        return {
            el,
            setColor: hex => { colorInput.value = s.color = hex; refresh(); },
            setMass: m => { s.mass = m; massInput.value = String(massToSlider(m)); refresh(); },
        };
    }
}
