import { clamp } from '../util/math';
import { byId, flash, formatInt } from './dom';

/** Statistics tiles, FPS badge and the concentration meter. */
export class Stats {
    private readonly fpsVal = byId('fpsVal');
    private readonly fpsBadge = byId('fpsBadge');
    private readonly fpsBadgeVal = byId('fpsBadgeVal');
    private readonly activeVal = byId('activeVal');
    private readonly typesActiveVal = byId('typesActiveVal');
    private readonly supernovaVal = byId('supernovaVal');
    private readonly supernovaStat = byId('supernovaStat');
    private readonly clusterVal = byId('clusterVal');
    private readonly clusterBar = byId('clusterBar');
    private readonly clusterMark = byId('clusterMark');
    private readonly clusterMarkVal = byId('clusterMarkVal');

    private fpsFrames = 0;
    private fpsTime = performance.now();

    /** After a restart. */
    reset(activeCount: number, activeTypeCount: number): void {
        this.activeVal.textContent = formatInt(activeCount);
        this.typesActiveVal.textContent = String(activeTypeCount);
        this.supernovaVal.textContent = '0';
        this.clusterVal.textContent = '–';
        this.clusterBar.style.width = '0%';
    }

    supernova(count: number): void {
        this.supernovaVal.textContent = String(count);
        flash(this.supernovaStat);
    }

    concentration(fraction: number): void {
        this.clusterVal.textContent = `${(fraction * 100).toFixed(0)} %`;
        this.clusterBar.style.width = `${Math.min(100, fraction * 100)}%`;
    }

    /** Places the supernova threshold marker on the meter. */
    threshold(percent: number): void {
        this.clusterMark.style.left = `${percent}%`;
        this.clusterMarkVal.textContent = `seuil ${percent} %`;
        this.clusterMarkVal.style.left = `${clamp(percent, [16, 84])}%`;
    }

    /** Counts a frame; returns true once per second, when the FPS display was refreshed. */
    tick(now: number): boolean {
        this.fpsFrames++;
        if (now - this.fpsTime < 1000) return false;
        const fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsTime));
        this.fpsVal.textContent = String(fps);
        this.fpsBadgeVal.textContent = `${fps} FPS`;
        this.fpsBadge.classList.toggle('mid', fps < 50 && fps >= 30);
        this.fpsBadge.classList.toggle('low', fps < 30);
        this.fpsFrames = 0;
        this.fpsTime = now;
        return true;
    }
}
