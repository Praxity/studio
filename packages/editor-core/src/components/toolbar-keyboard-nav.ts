/**
 * Screen reader announcement utility.
 * Creates/reuses a visually-hidden live region to announce messages.
 */
export function announceToScreenReader(message: string) {
	const id = "praxity-editor-live-region";
	let el = document.getElementById(id);
	if (!el) {
		el = document.createElement("div");
		el.id = id;
		el.setAttribute("role", "status");
		el.setAttribute("aria-live", "polite");
		el.setAttribute("aria-atomic", "true");
		Object.assign(el.style, {
			position: "absolute",
			width: "1px",
			height: "1px",
			padding: "0",
			margin: "-1px",
			overflow: "hidden",
			clip: "rect(0, 0, 0, 0)",
			whiteSpace: "nowrap",
			border: "0",
		});
		document.body.appendChild(el);
	}
	// Clear and re-set to trigger announcement even with same text
	el.textContent = "";
	requestAnimationFrame(() => {
		el.textContent = message;
	});
}
