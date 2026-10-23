import { shouldAttachIslandAutomatically } from "@praxity/shared-blocks/self-check-consumers";
import { enhanceDisclosure } from "../disclosure";

export function attachIsland() {
	document.querySelectorAll<HTMLElement>('[data-island="accordion"]').forEach((root) => {
		const container = root.querySelector<HTMLElement>(":scope > .praxity-accordion-static");
		if (!container) return;
		let showingAll = false;
		const controls = new Map<HTMLElement, ReturnType<typeof enhanceDisclosure>>();
		for (const item of container.querySelectorAll<HTMLElement>(":scope > [data-accordion-item]")) {
			const button = item.querySelector<HTMLButtonElement>(
				":scope > .praxity-disclosure-heading > button",
			);
			const panel = item.querySelector<HTMLElement>(":scope > [data-disclosure-panel]");
			if (!button || !panel) continue;
			controls.set(
				item,
				enhanceDisclosure(button, panel, () => {
					if (showingAll || container.dataset.multiple === "true") return;
					for (const [sibling, control] of controls)
						if (sibling !== item) control.setExpanded(false);
				}),
			);
		}
		const showAll = container.querySelector<HTMLButtonElement>("[data-accordion-show-all]");
		if (showAll) {
			showAll.hidden = false;
			showAll.addEventListener("click", () => {
				showingAll = true;
				for (const control of controls.values()) control.setExpanded(true);
				showingAll = false;
			});
		}
		if (controls.size > 6)
			for (const control of controls.values()) control.panel.setAttribute("role", "group");
		const buttons = Array.from(controls.values(), (control) => control.button);
		for (const [index, button] of buttons.entries()) {
			button.addEventListener("keydown", (event) => {
				const next =
					event.key === "ArrowDown"
						? (index + 1) % buttons.length
						: event.key === "ArrowUp"
							? (index - 1 + buttons.length) % buttons.length
							: event.key === "Home"
								? 0
								: event.key === "End"
									? buttons.length - 1
									: -1;
				if (next < 0) return;
				event.preventDefault();
				buttons[next]?.focus();
			});
		}
		root.addEventListener("praxity:narration-reveal", (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) return;
			// Each owning island reveals its item, including ancestors of nested accordions.
			for (const [item, control] of controls) if (item.contains(target)) control.setExpanded(true);
		});
		root.setAttribute("data-hydrated", "");
	});
}
if (shouldAttachIslandAutomatically()) attachIsland();
