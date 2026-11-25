import { SHARE_FEEDBACK_MS } from '../config';
import { t } from '../i18n';

/**
 * The share button: copies the link `link()` gives, then shows a check mark for a moment. When the
 * clipboard is out of reach (insecure context, permission refused), the link is shown to copy by hand.
 */
export function setupShareButton(button: HTMLButtonElement, link: () => string): void {
    const title = button.title;
    let timer = 0;
    button.addEventListener('click', () => {
        const url = link();
        const copied = (): void => {
            button.classList.add('copied');
            button.title = t('ui.share.copied');
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                button.classList.remove('copied');
                button.title = title;
            }, SHARE_FEEDBACK_MS);
        };
        const byHand = (): void => { window.prompt(t('ui.share.prompt'), url); };
        if (!navigator.clipboard) {
            byHand();
            return;
        }
        navigator.clipboard.writeText(url).then(copied, byHand);
    });
}
