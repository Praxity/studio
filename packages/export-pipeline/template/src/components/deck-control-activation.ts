/**
 * Guided decks resolve same-origin course links and transcript seek buttons in
 * place. Chromium exposes any element with a click listener as clickable, and
 * every passive descendant inherits that action, so NVDA said "clickable" before
 * the main landmark while the deck delegated clicks from its root. Listeners
 * therefore belong on the controls themselves, never on the deck, main, body or
 * document. The deck installs the resolver; islands that render controls after
 * it starts bind them at their own render point.
 */
export const DECK_CONTROL_SELECTOR = "a[href], [data-deck-seek]";

export type DeckControlActivation = (control: HTMLElement, event: Event) => void;

declare global {
	interface Window {
		__praxityActivateDeckControl?: DeckControlActivation;
	}
}

// One function identity lets addEventListener ignore repeated binding of a control.
function activateBoundControl(event: Event): void {
	const control = event.currentTarget;
	if (control instanceof HTMLElement) window.__praxityActivateDeckControl?.(control, event);
}

/** Bind every link and seek control in `scope`, including `scope` itself. */
export function bindDeckControls(scope: ParentNode, signal?: AbortSignal): void {
	const controls = [...scope.querySelectorAll<HTMLElement>(DECK_CONTROL_SELECTOR)];
	if (scope instanceof HTMLElement && scope.matches(DECK_CONTROL_SELECTOR)) controls.unshift(scope);
	for (const control of controls)
		control.addEventListener("click", activateBoundControl, signal ? { signal } : undefined);
}

/**
 * React replaces its rendered links on every update and gives no per-node render
 * callback. React already listens for clicks on its root container, so resolving
 * deck controls there adds no clickable exposure. Use this only on React roots.
 */
export function delegateDeckControls(reactRoot: HTMLElement): void {
	reactRoot.addEventListener("click", (event) => {
		const control =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(DECK_CONTROL_SELECTOR)
				: null;
		if (control && reactRoot.contains(control))
			window.__praxityActivateDeckControl?.(control, event);
	});
}
