function focusedContent(content: HTMLElement) {
	const active = content.ownerDocument.activeElement;
	return content.contains(active) ? (active as HTMLElement) : undefined;
}

/** Keep content padding and margins inside the growing space. No authored [hidden]. */
export function createContentReveal(content: HTMLElement, open?: boolean) {
	const focused = focusedContent(content);
	const element = content.ownerDocument.createElement("div");
	const clip = content.ownerDocument.createElement("div");
	element.dataset.contentReveal = open || focused ? "open" : "closed";
	clip.className = "praxity-reveal-clip";
	content.before(element);
	element.append(clip);
	clip.append(content);
	// Restored content and focused fallbacks start visible without replaying a reveal.
	if (open || focused) {
		element.style.transition = "none";
		focused?.focus({ preventScroll: true });
		content.ownerDocument.defaultView?.getComputedStyle(element).gridTemplateRows;
		element.style.transition = "";
	}
	return {
		element,
		setOpen(open: boolean) {
			element.dataset.contentReveal = open ? "open" : "closed";
			element.inert = !open;
			element.setAttribute("aria-hidden", String(!open));
		},
		destroy() {
			const focused = focusedContent(content);
			element.replaceWith(content);
			focused?.focus({ preventScroll: true });
		},
	};
}
