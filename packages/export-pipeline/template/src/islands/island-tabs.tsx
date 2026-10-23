import { createContentReveal } from "@praxity/shared-blocks/content-reveal";
import {
	createSelfCheckMutationObserver,
	createSelfCheckResizeObserver,
	observeSelfCheckLifetime,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
export function attachIsland() {
	document.querySelectorAll<HTMLElement>('[data-island="tabs"]').forEach((root) => {
		const container = root.querySelector<HTMLElement>(":scope > .praxity-tabs-static");
		const list = container?.querySelector<HTMLElement>(":scope > .praxity-tabs-list");
		if (!container || !list) return;
		const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
		const panels = Array.from(container.querySelectorAll<HTMLElement>(":scope > [role=tabpanel]"));
		const reveals = new Map<HTMLElement, ReturnType<typeof createContentReveal>>();
		let disclosure = false;
		let active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs[0];
		const activate = (tab: HTMLButtonElement, toggle = false) => {
			active = disclosure && toggle && active === tab ? undefined : tab;
			for (const candidate of tabs) {
				const selected = candidate === active;
				if (disclosure) candidate.setAttribute("aria-expanded", String(selected));
				else candidate.setAttribute("aria-selected", String(selected));
				candidate.tabIndex = disclosure || selected ? 0 : -1;
			}
			for (const panel of panels) {
				const open = panel.id === active?.getAttribute("aria-controls");
				if (disclosure) reveals.get(panel)?.setOpen(open);
				else panel.hidden = !open;
			}
		};
		// Measure the actual labels, including rich inline text and larger-text/spacing
		// preferences. A fixed phone breakpoint would miss long labels on a laptop.
		const measure = document.createElement("div");
		measure.className = "praxity-tabs-measure";
		measure.setAttribute("aria-hidden", "true");
		measure.inert = true;
		container.append(measure);
		const labels = tabs.map((tab) => {
			const label = document.createElement("span");
			label.className = "praxity-tabs-measure-label";
			label.innerHTML = tab.querySelector(".praxity-disclosure-title")?.innerHTML ?? "";
			measure.append(label);
			return label;
		});
		const adapt = () => {
			const available = container.clientWidth;
			if (!available) return;
			for (const [index, tab] of tabs.entries()) {
				const content = tab.querySelector(".praxity-disclosure-title")?.innerHTML ?? "";
				if (labels[index].innerHTML !== content) labels[index].innerHTML = content;
			}
			const shouldDisclose = measure.scrollWidth > available;
			if (shouldDisclose === disclosure) return;
			disclosure = shouldDisclose;
			container.dataset.disclosure = String(disclosure);
			list.hidden = disclosure;
			for (const tab of tabs) tab.classList.toggle("praxity-disclosure-trigger", disclosure);
			if (disclosure) {
				list.removeAttribute("role");
				for (const [index, tab] of tabs.entries()) {
					tab.removeAttribute("role");
					tab.removeAttribute("aria-selected");
					const panel = panels[index];
					if (!panel) continue;
					panel.setAttribute("role", "region");
					panel.removeAttribute("tabindex");
					panel.hidden = false;
					const reveal = createContentReveal(panel);
					reveals.set(panel, reveal);
					container.insertBefore(tab, reveal.element);
				}
			} else {
				for (const reveal of reveals.values()) reveal.destroy();
				reveals.clear();
				list.setAttribute("role", "tablist");
				for (const [index, tab] of tabs.entries()) {
					tab.setAttribute("role", "tab");
					tab.removeAttribute("aria-expanded");
					list.append(tab);
					panels[index]?.setAttribute("role", "tabpanel");
					panels[index]?.setAttribute("tabindex", "0");
				}
				active ??= tabs[0];
			}
			if (active) activate(active);
		};
		for (const [index, tab] of tabs.entries()) {
			tab.addEventListener("click", () => activate(tab, true));
			tab.addEventListener("keydown", (event) => {
				// Native disclosure buttons own Enter and Space.
				if (disclosure) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					activate(tab);
					return;
				}
				const next =
					event.key === "ArrowRight"
						? (index + 1) % tabs.length
						: event.key === "ArrowLeft"
							? (index - 1 + tabs.length) % tabs.length
							: event.key === "Home"
								? 0
								: event.key === "End"
									? tabs.length - 1
									: -1;
				if (next < 0) return;
				event.preventDefault();
				tabs[next]?.focus();
			});
		}
		observeSelfCheckLifetime((current) => {
			const refresh = () => {
				if (current()) adapt();
			};
			const resize = createSelfCheckResizeObserver(current, refresh);
			resize.observe(container);
			resize.observe(measure);
			const mutation = createSelfCheckMutationObserver(current, refresh);
			mutation.observe(container, { childList: true, subtree: true, characterData: true });
			void document.fonts.ready.then(refresh);
			return () => {
				resize.disconnect();
				mutation.disconnect();
			};
		});
		adapt();
		root.addEventListener("praxity:narration-reveal", (event) => {
			const target = event.target instanceof Element ? event.target : null;
			const reveal = target?.closest<HTMLElement>("[data-narration-reveal]");
			const tab = tabs.find(
				(candidate) => candidate.dataset.tabId === reveal?.dataset.narrationReveal,
			);
			if (tab) activate(tab);
		});
		root.setAttribute("data-hydrated", "");
	});
}
if (shouldAttachIslandAutomatically()) attachIsland();
