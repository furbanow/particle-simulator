import { byId } from './dom';

/** The GPU benchmark's overlay: shown while it runs, with its progress; it cannot be closed. */
export class BenchmarkDialog {
    private readonly root = byId('benchmark-overlay');
    private readonly bar = byId('benchmarkBar');

    show(): void {
        this.progress(0);
        this.root.hidden = false;
    }

    /** `fraction` of the benchmark's duration elapsed, 0..1. */
    progress(fraction: number): void {
        this.bar.style.transform = `scaleX(${fraction})`;
    }

    hide(): void {
        this.root.hidden = true;
    }
}
