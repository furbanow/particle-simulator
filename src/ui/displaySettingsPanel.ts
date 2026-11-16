import { FPS_LIMIT_OPTIONS } from '../config';
import type { DisplaySettings, DisplaySettingsStore } from '../displaySettings';
import { byId } from './dom';

/** The settings dialog: binds its controls to the display settings and applies them to the page. */
export class DisplaySettingsPanel {
    private readonly fps = byId<HTMLSelectElement>('fpsLimitSelect');
    private readonly help = byId<HTMLInputElement>('showHelpBox');
    private readonly stats = byId<HTMLInputElement>('showStatsBox');
    private readonly author = byId<HTMLInputElement>('showAuthorBox');

    constructor(store: DisplaySettingsStore, open: () => void) {
        for (const fps of FPS_LIMIT_OPTIONS) {
            const option = document.createElement('option');
            option.value = String(fps);
            option.textContent = fps > 0 ? `${fps} FPS` : 'Illimité';
            this.fps.appendChild(option);
        }
        byId('settingsBtn').addEventListener('click', open);
        this.fps.addEventListener('change', () => store.update({ fpsLimit: Number(this.fps.value) }));
        this.help.addEventListener('change', () => store.update({ showHelp: this.help.checked }));
        this.stats.addEventListener('change', () => store.update({ showStats: this.stats.checked }));
        this.author.addEventListener('change', () => store.update({ showAuthor: this.author.checked }));
        store.onChange(values => this.apply(values));
        this.apply(store.values);
    }

    private apply(values: DisplaySettings): void {
        this.fps.value = String(values.fpsLimit);
        this.help.checked = values.showHelp;
        this.stats.checked = values.showStats;
        this.author.checked = values.showAuthor;
        document.body.classList.toggle('hide-help', !values.showHelp);
        document.body.classList.toggle('hide-stats', !values.showStats);
        document.body.classList.toggle('hide-author', !values.showAuthor);
    }
}
