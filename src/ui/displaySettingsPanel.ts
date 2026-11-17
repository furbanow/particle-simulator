import {
    BENCHMARK_TARGET_FPS, DELETE_CONFIRM_MS, FPS_LIMIT_OPTIONS, LANGUAGE_NAMES, PARTICLE_CAP_RANGE, PARTICLE_CAP_STEP,
    SUPPORTED_LANGUAGES,
} from '../config';
import { resetSettings, sanitizeParticleCap, type DisplaySettings, type DisplaySettingsStore } from '../displaySettings';
import { formatNumber, isLanguagePreference, t } from '../i18n';
import { byId } from './dom';

/**
 * The settings dialog: binds its controls to the display settings and applies them to the page.
 * The particle limit is applied by main.ts (it listens to the store); `benchmark` reruns the GPU benchmark.
 */
export class DisplaySettingsPanel {
    private readonly language = byId<HTMLSelectElement>('languageSelect');
    private readonly fps = byId<HTMLSelectElement>('fpsLimitSelect');
    private readonly help = byId<HTMLInputElement>('showHelpBox');
    private readonly stats = byId<HTMLInputElement>('showStatsBox');
    private readonly author = byId<HTMLInputElement>('showAuthorBox');
    private readonly particleCap = byId<HTMLInputElement>('particleCapInput');
    private readonly benchmarkResult = byId('benchmarkResult');

    constructor(store: DisplaySettingsStore, open: () => void, benchmark: () => void) {
        this.language.add(new Option(t('ui.settings.language.auto'), 'auto'));
        // Each language is named in itself, so it can be found whatever the current one is.
        for (const language of SUPPORTED_LANGUAGES) this.language.add(new Option(LANGUAGE_NAMES[language], language));
        for (const fps of FPS_LIMIT_OPTIONS) {
            const option = document.createElement('option');
            option.value = String(fps);
            option.textContent = fps > 0 ? `${fps} FPS` : t('ui.settings.fps.unlimited');
            this.fps.appendChild(option);
        }
        this.particleCap.min = String(PARTICLE_CAP_RANGE[0]);
        this.particleCap.max = String(PARTICLE_CAP_RANGE[1]);
        this.particleCap.step = String(PARTICLE_CAP_STEP);
        byId('settingsBtn').addEventListener('click', open);
        byId('benchmarkBtn').addEventListener('click', benchmark);
        this.bindReset();
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
        this.particleCap.addEventListener('change', () => {
            const cap = sanitizeParticleCap(this.particleCap.valueAsNumber);
            // An empty or invalid entry shows the current limit again.
            if (cap === null) this.apply(store.values);
            else store.update({ particleCap: cap });
        });
        store.onChange(values => this.apply(values));
        this.apply(store.values);
    }

    /** Reset: a first click arms the button, a second one within DELETE_CONFIRM_MS resets and reloads. */
    private bindReset(): void {
        const button = byId<HTMLButtonElement>('resetSettingsBtn');
        const label = button.textContent;
        let timer = 0;
        const disarm = () => {
            window.clearTimeout(timer);
            button.classList.remove('confirm');
            button.textContent = label;
        };
        button.addEventListener('click', () => {
            if (!button.classList.contains('confirm')) {
                button.classList.add('confirm');
                button.textContent = t('ui.settings.reset.confirm');
                timer = window.setTimeout(disarm, DELETE_CONFIRM_MS);
                return;
            }
            disarm();
            let storage: Storage | null = null;
            try { storage = window.localStorage; } catch { /* blocked */ }
            resetSettings(storage);
            window.location.reload();
        });
    }

    private apply(values: DisplaySettings): void {
        this.language.value = values.language;
        this.fps.value = String(values.fpsLimit);
        this.help.checked = values.showHelp;
        this.stats.checked = values.showStats;
        this.author.checked = values.showAuthor;
        this.particleCap.value = values.particleCap === null ? '' : String(values.particleCap);
        this.benchmarkResult.textContent = values.benchmarkCap === null
            ? t('ui.settings.benchmark.none')
            : t('ui.settings.benchmark.result', {
                count: formatNumber(values.benchmarkCap),
                fps: BENCHMARK_TARGET_FPS,
            });
        document.body.classList.toggle('hide-help', !values.showHelp);
        document.body.classList.toggle('hide-stats', !values.showStats);
        document.body.classList.toggle('hide-author', !values.showAuthor);
    }
}
