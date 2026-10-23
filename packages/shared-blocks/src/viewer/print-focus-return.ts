/** Retain an activity's focus across browser print without changing its content or controls. */
export function preservePrintFocus(
	root: HTMLElement,
	current: () => boolean = () => true,
): () => void {
	const doc = root.ownerDocument;
	const view = doc.defaultView;
	if (!view) return () => {};
	const media = view.matchMedia?.("print");
	let printing = false;
	let target: HTMLElement | null = null;
	const capture = (active: Element | null) => {
		// Media entry and beforeprint can both arrive. Keep the first capture:
		// Firefox blurs print-hidden controls to BODY between these events.
		if (printing || !current()) return;
		printing = true;
		target = active instanceof view.HTMLElement && root.contains(active) ? active : null;
	};
	const begin = () => capture(doc.activeElement);
	// CSS can hide a focused action before the print-media change listener runs.
	const blurred = (event: FocusEvent) => {
		if (media?.matches && event.target instanceof view.HTMLElement && root.contains(event.target))
			capture(event.target);
	};
	const cancel = () => {
		target = null;
	};
	const finish = () => {
		// afterprint may precede screen styles; hidden controls cannot take focus.
		if (media?.matches) return;
		const original = target;
		cancel();
		printing = false;
		if (
			current() &&
			original?.isConnected &&
			!original.closest("[hidden], [inert]") &&
			!original.matches(":disabled") &&
			(doc.activeElement === doc.body || doc.activeElement === doc.documentElement)
		)
			original.focus({ preventScroll: true });
	};
	const changed = (event: MediaQueryListEvent) => (event.matches ? begin() : finish());
	const moved = (event: FocusEvent) => {
		if (
			event.target !== target &&
			event.target !== doc.body &&
			event.target !== doc.documentElement
		)
			cancel();
	};
	const cleanup = () => {
		cancel();
		printing = false;
		view.removeEventListener("beforeprint", begin);
		view.removeEventListener("afterprint", finish);
		view.removeEventListener("pagehide", cancel);
		media?.removeEventListener("change", changed);
		doc.removeEventListener("focusin", moved);
		doc.removeEventListener("focusout", blurred);
		doc.removeEventListener("pointerdown", cancel);
		doc.removeEventListener("keydown", cancel);
	};
	try {
		view.addEventListener("beforeprint", begin);
		view.addEventListener("afterprint", finish);
		view.addEventListener("pagehide", cancel);
		media?.addEventListener("change", changed);
		doc.addEventListener("focusin", moved);
		doc.addEventListener("focusout", blurred);
		doc.addEventListener("pointerdown", cancel);
		doc.addEventListener("keydown", cancel);
		return cleanup;
	} catch (error) {
		// A failed attach must not leave a document listener holding the activity.
		cleanup();
		throw error;
	}
}
