import { FPS_LIMIT_OPTIONS, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../config';
import type { DisplaySettings, DisplaySettingsStore } from '../displaySettings';
import { isLanguagePreference, t } from '../i18n';
import { byId } from './dom';

/** The settings dialog: binds its controls to the display settings and applies them to the page. */
export class DisplaySettingsPanel {
    private readonly language = byId<HTMLSelectElement>('languageSelect');
    private readonly fps = byId<HTMLSelectElement>('fpsLimitSelect');
    private readonly help = byId<HTMLInputElement>('showHelpBox');
    private readonly stats = byId<HTMLInputElement>('showStatsBox');
    private readonly author = byId<HTMLInputElement>('showAuthorBox');

    constructor(store: DisplaySettingsStore, open: () => void) {
        this.language.add(new Option(t('ui.settings.language.auto'), 'auto'));
        // Each language is named in itself, so it can be found whatever the current one is.
        for (const language of SUPPORTED_LANGUAGES) this.language.add(new Option(LANGUAGE_NAMES[language], language));
        for (const fps of FPS_LIMIT_OPTIONS) {
            const option = document.createElement('option');
            option.value = String(fps);
            option.textContent = fps > 0 ? `${fps} FPS` : t('ui.settings.fps.unlimited');
            this.fps.appendChild(option);
        }
        byId('settingsBtn').addEventListener('click', open);
        this.language.addEventListener('change', () => {
            if (!isLanguagePreference(this.language.value)) return;
            store.update({ language: this.language.value });
            // The texts are built once from the catalog of the language active at load: reload to apply.
            window.location.reload();
        });
        this.fps.addEventListener('change', () => store.update({ fpsLimit: Number(this.fps.value) }));
        this.help.addEventListener('change', () => store.update({ showHelp: this.help.checked }));
        this.stats.addEventListener('change', () => store.update({ showStats: this.stats.checked }));
        this.author.addEventListener('change', () => store.update({ showAuthor: this.author.checked }));
        store.onChange(values => this.apply(values));
        this.apply(store.values);
    }

    private apply(values: DisplaySettings): void {
        this.language.value = values.language;
        this.fps.value = String(values.fpsLimit);
        this.help.checked = values.showHelp;
        this.stats.checked = values.showStats;
        this.author.checked = values.showAuthor;
        document.body.classList.toggle('hide-help', !values.showHelp);
        document.body.classList.toggle('hide-stats', !values.showStats);
        document.body.classList.toggle('hide-author', !values.showAuthor);
    }
}
