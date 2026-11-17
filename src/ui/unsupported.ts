import { byId } from './dom';

/** Shows the "needs WebGL 2 and a GPU" apology over the page and stops the caller. */
export function showUnsupported(): never {
    byId('unsupported-overlay').hidden = false;
    throw new Error('WebGL 2 with float render targets is unavailable');
}
