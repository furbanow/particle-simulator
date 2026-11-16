/**
 * A modal dialog over the whole page: the overlay `root` holds the dialog card and a `.modal-close`
 * button. A click on the overlay outside the card, the close button and Escape close it; the focus
 * goes back to where it was.
 */
export class Modal {
    private opener: HTMLElement | null = null;

    constructor(private readonly root: HTMLElement) {
        root.addEventListener('pointerdown', e => {
            if (e.target === root) this.close();
        });
        root.querySelector('.modal-close')?.addEventListener('click', () => this.close());
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.isOpen) {
                e.preventDefault();
                this.close();
            }
        });
    }

    get isOpen(): boolean {
        return !this.root.hidden;
    }

    open(): void {
        if (this.isOpen) return;
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.root.hidden = false;
        this.root.querySelector<HTMLElement>('.modal-close')?.focus();
    }

    close(): void {
        if (!this.isOpen) return;
        this.root.hidden = true;
        this.opener?.focus();
        this.opener = null;
    }
}
