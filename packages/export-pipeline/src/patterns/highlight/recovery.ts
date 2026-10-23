/** Attributes added to chunks, owned here for reset, destroy and failed-attach recovery. */
export const HIGHLIGHT_RESULT_ATTRIBUTES = [
	"aria-disabled",
	"aria-describedby",
	"data-highlight-outcome",
] as const;
export const HIGHLIGHT_ADDED_ATTRIBUTES = [
	"role",
	"tabindex",
	"aria-pressed",
	...HIGHLIGHT_RESULT_ATTRIBUTES,
] as const;

/** Restore the baseline, using focus captured before instance teardown when supplied. */
export function restoreHighlightBaseline(
	root: HTMLElement,
	active: Element | null = root.contains(root.ownerDocument.activeElement)
		? root.ownerDocument.activeElement
		: null,
): void {
	const flow = root.querySelector<HTMLElement>("[data-highlight-flow]");
	const hiddenFocus =
		active && (flow?.contains(active) || active.matches("[data-highlight-chunk]"));
	root.querySelectorAll<HTMLElement>("[data-highlight-chunk]").forEach((chunk) => {
		for (const attribute of HIGHLIGHT_ADDED_ATTRIBUTES) chunk.removeAttribute(attribute);
	});
	root.querySelector("[data-highlight-passage]")?.removeAttribute("aria-describedby");
	root.querySelector("[data-highlight-restart]")?.removeAttribute("aria-describedby");
	for (const selector of [
		"[data-highlight-instructions]",
		"[data-highlight-flow]",
		"[data-highlight-limit]",
		"[data-highlight-summary]",
	])
		root.querySelectorAll<HTMLElement>(selector).forEach((node) => {
			node.hidden = true;
		});
	root.querySelectorAll<HTMLElement>("[data-highlight-feedback]").forEach((node) => {
		node.replaceChildren();
		node.hidden = true;
		node.removeAttribute("data-highlight-outcome");
	});
	root
		.querySelectorAll(
			"[data-highlight-memory-notice], [data-praxity-js-control]:not([data-highlight-check]):not([data-highlight-restart])",
		)
		.forEach((node) => node.remove());
	const answer = root.querySelector<HTMLDetailsElement>("[data-highlight-fallback]");
	if (answer) {
		answer.hidden = false;
		answer.open = false;
	}
	// Removing a chunk's injected focusability needs the same recovery as hiding a flow control.
	if (active && (hiddenFocus || !active.isConnected)) answer?.querySelector("summary")?.focus();
}
