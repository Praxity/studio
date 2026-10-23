import { createContentReveal } from "@praxity/shared-blocks/content-reveal";

/** P27 enhancement shared by published accordions, transcripts and deck utilities. */
export function enhanceDisclosure(
	button: HTMLButtonElement,
	panel: HTMLElement,
	onExpand?: () => void,
) {
	const reveal = panel.hasAttribute("data-disclosure-panel")
		? createContentReveal(panel)
		: undefined;
	if (reveal) reveal.element.dataset.revealPrint = "expand";
	const setExpanded = (expanded: boolean) => {
		if (!expanded && panel.contains(document.activeElement)) button.focus();
		// [hidden] means authored concealment to the required-activity gate. A collapsed
		// disclosure still contains eligible activities, as native details did.
		if (reveal) reveal.setOpen(expanded);
		else panel.style.display = expanded ? "" : "none";
		button.setAttribute("aria-expanded", String(expanded));
		if (expanded) onExpand?.();
	};
	const toggle = () => setExpanded(button.getAttribute("aria-expanded") !== "true");
	button.addEventListener("click", toggle);
	// Install the handler and populate the button before exposing or collapsing it.
	const label = button.parentElement?.querySelector<HTMLElement>("[data-disclosure-label]");
	if (label) button.prepend(label);
	const labelledBy = panel.getAttribute("aria-labelledby");
	if (labelledBy) panel.setAttribute("aria-labelledby", button.id);
	button.hidden = false;
	// Delayed enhancement must not interrupt a learner already using fallback content.
	setExpanded(panel.contains(document.activeElement));
	const revealAnchor = () => {
		let id: string;
		try {
			id = decodeURIComponent(location.hash.slice(1));
		} catch {
			return;
		}
		const target = document.getElementById(id);
		if (!target || (!panel.contains(target) && !button.contains(target))) return;
		setExpanded(true);
		target.scrollIntoView?.({ block: "nearest" });
	};
	window.addEventListener("hashchange", revealAnchor);
	revealAnchor();
	return {
		button,
		panel,
		setExpanded,
		destroy: () => {
			window.removeEventListener("hashchange", revealAnchor);
			button.removeEventListener("click", toggle);
			setExpanded(true);
			reveal?.destroy();
			button.hidden = true;
			if (label) button.before(label);
			if (labelledBy) panel.setAttribute("aria-labelledby", labelledBy);
		},
	};
}
