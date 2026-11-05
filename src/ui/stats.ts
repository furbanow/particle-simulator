import { METER_LABEL_RANGE } from '../config';
import type { StatDef } from '../simulation/algorithm';
import { findParam, paramFraction } from '../simulation/params';
import type { Simulation } from '../simulation/Simulation';
import { formatInt } from '../util/format';
import { clamp } from '../util/math';
import { byId, flash } from './dom';
import { rememberedOpen, rememberOpen } from './panelState';

const UNKNOWN = '–';
const OPEN_KEY = 'statsOverlay';
const TOGGLE_LABEL = { open: 'Masquer les statistiques', closed: 'Afficher les statistiques' };

/** A tile of an algorithm stat: paint() re-reads its value, only touching the DOM when it changed. */
interface StatTile {
    el: HTMLElement;
    paint(): void;
}

/**
 * Statistics shown over the animation: FPS, active particles and types (every algorithm), then the live
 * stats the selected algorithm declares (values, meters, counts per type), built by setAlgorithm()
 * and polled every frame by update(). A small button next to them hides or shows them.
 */
export class Stats {
    private readonly fpsVal = byId('fpsVal');
    private readonly activeVal = byId('activeVal');
    private readonly typesActiveLabel = byId('typesActiveLabel');
    private readonly typesActiveVal = byId('typesActiveVal');
    private readonly grid = byId('statGrid');
    private readonly overlay = byId('statsOverlay');
    private readonly toggleBtn = byId<HTMLButtonElement>('toggleStatsBtn');
    private tiles: StatTile[] = [];

    private fpsFrames = 0;
    private fpsTime = performance.now();

    constructor(private readonly sim: Simulation) {
        this.setOpen(rememberedOpen(OPEN_KEY, true));
        this.toggleBtn.addEventListener('click', () => {
            const open = !this.overlay.classList.contains('open');
            this.setOpen(open);
            rememberOpen(OPEN_KEY, open);
        });
        this.setAlgorithm();
    }

    private setOpen(open: boolean): void {
        this.overlay.classList.toggle('open', open);
        this.toggleBtn.setAttribute('aria-expanded', String(open));
        const label = open ? TOGGLE_LABEL.open : TOGGLE_LABEL.closed;
        this.toggleBtn.title = label;
        this.toggleBtn.setAttribute('aria-label', label);
    }

    /** Rebuilds the algorithm's stat tiles. */
    setAlgorithm(): void {
        for (const tile of this.tiles) tile.el.remove();
        this.typesActiveLabel.textContent = this.sim.algorithm.particleTypes.labels.active;
        this.tiles = (this.sim.algorithm.stats ?? []).map(def => this.buildTile(def));
        for (const tile of this.tiles) this.grid.appendChild(tile.el);
        this.update();
    }

    /** After a restart. */
    reset(): void {
        this.activeVal.textContent = formatInt(this.sim.activeCount);
        this.typesActiveVal.textContent = String(this.sim.activeTypeCount);
        this.update();
    }

    /** Re-reads the algorithm stats (every frame). */
    update(): void {
        for (const tile of this.tiles) tile.paint();
    }

    /** Counts a frame; refreshes the FPS display once per second. */
    tick(now: number): void {
        this.fpsFrames++;
        if (now - this.fpsTime < 1000) return;
        const fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsTime));
        this.fpsVal.textContent = String(fps);
        this.fpsVal.classList.toggle('mid', fps < 50 && fps >= 30);
        this.fpsVal.classList.toggle('low', fps < 30);
        this.fpsFrames = 0;
        this.fpsTime = now;
    }

    private buildTile(def: StatDef): StatTile {
        const el = document.createElement('div');
        el.className = 'stat';
        switch (def.kind) {
            case 'value': {
                el.innerHTML = '<div class="stat-label"></div><div class="stat-value"></div>';
                el.querySelector('.stat-label')!.textContent = def.label;
                const out = el.querySelector<HTMLElement>('.stat-value')!;
                let last: number | null | undefined;
                return {
                    el, paint: () => {
                        const v = this.sim.stat(def.key);
                        if (v === last) return;
                        if (def.flash && v !== null && last !== undefined && last !== null && v > last) flash(el);
                        last = v;
                        out.textContent = v === null ? UNKNOWN : def.format(v);
                    },
                };
            }
            case 'meter': {
                el.classList.add('wide');
                el.innerHTML = `
                    <div class="stat-row"><span class="stat-label"></span><span class="stat-value"></span></div>
                    <div class="meter"><div class="meter-fill"></div><div class="meter-mark"></div></div>
                    <div class="meter-legend"><span></span></div>`;
                el.querySelector('.stat-label')!.textContent = def.label;
                const meter = el.querySelector<HTMLElement>('.meter')!;
                if (def.title) meter.title = def.title;
                const out = el.querySelector<HTMLElement>('.stat-value')!;
                const fill = el.querySelector<HTMLElement>('.meter-fill')!;
                const mark = el.querySelector<HTMLElement>('.meter-mark')!;
                const markLabel = el.querySelector<HTMLElement>('.meter-legend span')!;
                const markerParam = def.marker && findParam(this.sim.algorithm, def.marker.param);
                if (!def.marker || markerParam?.kind !== 'number') {
                    mark.remove();
                    el.querySelector('.meter-legend')!.remove();
                }
                let last: number | null | undefined;
                let lastMarker: number | undefined;
                return {
                    el, paint: () => {
                        const v = this.sim.stat(def.key);
                        if (v !== last) {
                            last = v;
                            out.textContent = v === null ? UNKNOWN : def.format(v);
                            fill.style.width = `${v === null ? 0 : Math.min(100, v * 100)}%`;
                        }
                        if (!def.marker || markerParam?.kind !== 'number') return;
                        const markerValue = this.sim.params[markerParam.key];
                        if (typeof markerValue !== 'number' || markerValue === lastMarker) return;
                        lastMarker = markerValue;
                        const at = paramFraction(markerParam, markerValue) * 100;
                        mark.style.left = `${at}%`;
                        markLabel.textContent = def.marker.format(markerValue);
                        markLabel.style.left = `${clamp(at, METER_LABEL_RANGE)}%`;
                    },
                };
            }
            case 'typeCounts': {
                el.classList.add('wide');
                el.innerHTML = '<div class="stat-label"></div><div class="type-counts"></div>';
                el.querySelector('.stat-label')!.textContent = def.label;
                const list = el.querySelector<HTMLElement>('.type-counts')!;
                let lastKey = '';
                return {
                    el, paint: () => {
                        const counts = this.sim.liveTypeCounts();
                        const shown = this.sim.species.slice(0, Math.max(this.sim.activeTypeCount, 1));
                        const key = JSON.stringify([counts.slice(0, shown.length), shown.map(t => [t.symbol, t.color])]);
                        if (key === lastKey) return;
                        lastKey = key;
                        list.replaceChildren(...shown.map((t, k) => {
                            const item = document.createElement('span');
                            item.className = 'type-count';
                            item.style.setProperty('--type-color', t.color);
                            item.title = t.name;
                            item.textContent = `${t.symbol} ${formatInt(counts[k] ?? 0)}`;
                            return item;
                        }));
                    },
                };
            }
        }
    }
}
