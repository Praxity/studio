import { createContentReveal } from "@praxity/shared-blocks/content-reveal";

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
		if (reveal) reveal.setOpen(expanded);
		else panel.style.display = expanded ? "" : "none";
		button.setAttribute("aria-expanded", String(expanded));
		if (expanded) onExpand?.();
	};
	const toggle = () => setExpanded(button.getAttribute("aria-expanded") !== "true");
	button.addEventListener("click", toggle);
	const label = button.parentElement?.querySelector<HTMLElement>("[data-disclosure-label]");
	if (label) button.prepend(label);
	const labelledBy = panel.getAttribute("aria-labelledby");
	if (labelledBy) panel.setAttribute("aria-labelledby", button.id);
	button.hidden = false;
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
