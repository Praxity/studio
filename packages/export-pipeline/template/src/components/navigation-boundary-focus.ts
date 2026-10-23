/** Move endangered focus before native disabling can send it to the document body. */
export function updateBoundaryNavigation(
	previous: HTMLButtonElement | null,
	next: HTMLButtonElement | null,
	previousDisabled: boolean,
	nextDisabled: boolean,
	contentTarget: HTMLElement | null,
): void {
	const active = document.activeElement;
	const endangered =
		(previous !== null && active === previous && previousDisabled) ||
		(next !== null && active === next && nextDisabled);
	// The opposite control may still be disabled from the boundary we just left.
	if (previous && !previousDisabled) previous.disabled = false;
	if (next && !nextDisabled) next.disabled = false;
	if (endangered) {
		const surviving = active === previous ? next : previous;
		const survivingDisabled = active === previous ? nextDisabled : previousDisabled;
		if (surviving && !survivingDisabled) surviving.focus({ preventScroll: true });
		else if (contentTarget) {
			contentTarget.tabIndex = -1;
			contentTarget.focus({ preventScroll: true });
		}
	}
	if (previous) previous.disabled = previousDisabled;
	if (next) next.disabled = nextDisabled;
}
