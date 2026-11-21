export const DECK_CONTROL_SELECTOR = "a[href], [data-deck-seek]";

export type DeckControlActivation = (control: HTMLElement, event: Event) => void;

declare global {
	interface Window {
		__praxityActivateDeckControl?: DeckControlActivation;
	}
}

function activateBoundControl(event: Event): void {
	const control = event.currentTarget;
	if (control instanceof HTMLElement) window.__praxityActivateDeckControl?.(control, event);
}

export function bindDeckControls(scope: ParentNode, signal?: AbortSignal): void {
	const controls = [...scope.querySelectorAll<HTMLElement>(DECK_CONTROL_SELECTOR)];
	if (scope instanceof HTMLElement && scope.matches(DECK_CONTROL_SELECTOR)) controls.unshift(scope);
	for (const control of controls)
		control.addEventListener("click", activateBoundControl, signal ? { signal } : undefined);
}

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
