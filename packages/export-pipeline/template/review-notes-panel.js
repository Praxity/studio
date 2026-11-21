export function mountNotesPanel(button, { sibling = null } = {}) {
	const panel = button.popoverTargetElement;
	if (!panel?.showPopover) return null;
	const badge = button.querySelector("[data-notes-badge]");
	const open = (node) => Boolean(node?.matches(":popover-open"));
	panel.addEventListener("beforetoggle", (event) => {
		if (event.newState === "open") {
			if (open(sibling)) sibling.hidePopover();
		} else if (panel.contains(document.activeElement)) {
			setTimeout(() => button.focus());
		}
	});
	sibling?.addEventListener("beforetoggle", (event) => {
		if (event.newState === "open" && open(panel)) panel.hidePopover();
	});
	for (const node of [panel, button])
		node.addEventListener("keydown", (event) => {
			if (event.key !== "Escape" || !open(panel)) return;
			event.preventDefault();
			panel.hidePopover();
		});
	return {
		setCount(count) {
			if (!badge) return;
			badge.textContent = count > 0 ? String(count) : "";
			badge.hidden = !(count > 0);
		},
	};
}
