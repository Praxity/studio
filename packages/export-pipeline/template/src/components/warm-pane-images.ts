/** Warm the current slide and its immediate neighbours, following selected tab content only. */
export function warmPaneImages(panes: readonly HTMLElement[], activeIndex: number): void {
	const active = panes[activeIndex];
	// Wait until deck initialization has hidden its inactive slides.
	if (
		!active ||
		active.closest('[hidden], [aria-hidden="true"], .praxity-deck:not([data-ready="true"])')
	)
		return;
	for (const index of [activeIndex, activeIndex + 1, activeIndex - 1]) {
		const pane = panes[index];
		if (pane) warmPane(pane, index !== activeIndex);
	}
}

function warmPane(pane: HTMLElement, neighbour: boolean): void {
	const owner = pane.closest(".praxity-tabs-static");
	// Selected tab content in the current slide keeps native loading.
	if (!owner || neighbour) {
		for (const image of pane.querySelectorAll<HTMLImageElement>("img[src]")) {
			if (image.closest(".praxity-tabs-static") !== owner) continue;
			if (neighbour) image.setAttribute("fetchpriority", "low");
			image.setAttribute("loading", "eager");
		}
	}
	for (const tabs of pane.querySelectorAll<HTMLElement>(".praxity-tabs-static")) {
		if (tabs.parentElement?.closest(".praxity-tabs-static") !== owner) continue;
		const panels = Array.from(tabs.querySelectorAll<HTMLElement>(".praxity-tabs-panel")).filter(
			(panel) => panel.closest(".praxity-tabs-static") === tabs,
		);
		const selected = Array.from(
			tabs.querySelectorAll<HTMLElement>(
				'.praxity-tabs-tab[aria-selected="true"], .praxity-tabs-tab[aria-expanded="true"]',
			),
		).find((tab) => tab.closest(".praxity-tabs-static") === tabs);
		const selectedIndex = panels.findIndex(
			(panel) => panel.id === selected?.getAttribute("aria-controls"),
		);
		const selectedPanel = panels[selectedIndex];
		if (selectedPanel) warmPane(selectedPanel, neighbour);
	}
}
