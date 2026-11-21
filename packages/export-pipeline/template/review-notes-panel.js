// Optional host helper for a review notes panel. The host supplies the markup: a header button with
// popovertarget pointing at a popover="manual" panel, and optionally a [data-notes-badge] element
// inside the button. A manual popover stays open while the reviewer reads; this adds what the
// platform leaves out. `sibling` is another popover sharing the same space (a menu); opening one
// closes the other. Returns null when the browser has no Popover API.
export function mountNotesPanel(button, { sibling = null } = {}) {
	const panel = button.popoverTargetElement;
	if (!panel?.showPopover) return null;
	const badge = button.querySelector("[data-notes-badge]");
	const open = (node) => Boolean(node?.matches(":popover-open"));
	panel.addEventListener("beforetoggle", (event) => {
		if (event.newState === "open") {
			if (open(sibling)) sibling.hidePopover();
		} else if (panel.contains(document.activeElement)) {
			// A manual popover leaves focus on the page body when it closes.
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
		// The count shows in the badge; zero empties and hides it.
		setCount(count) {
			if (!badge) return;
			badge.textContent = count > 0 ? String(count) : "";
			badge.hidden = !(count > 0);
		},
	};
}
