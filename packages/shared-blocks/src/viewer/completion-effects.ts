import { getNextPageUnavailable } from "../i18n/completion-gate-strings";

/**
 * Continue gate, settled 2026-10-01. Presentation belongs to the DOM adapter.
 * Shipped: focusable aria-disabled controls, one reason in the visible navigation band.
 * Rejected: sibling reason became a body-grid item; the full nav hides in minimal mode.
 * Rejected: CSS-only proxy reveal still left its native hidden attribute in place.
 * Browser checks cover Chromium, WebKit and Firefox; live screen-reader speech is untested.
 * Navigation reads the engine's gate, independently of these presentation effects.
 */
export function createCompletionEffects(currentPage: number, doc: Document = document) {
	const selector = "[data-continue-button], a[data-page-number], #deck-next, #deck-continue";
	const attributes = ["href", "role", "tabindex", "aria-disabled", "aria-describedby"] as const;
	const effects = new Map<HTMLElement, Map<string, string | null>>();
	let proxyVisibility: { element: HTMLElement; hidden: string | null } | undefined;
	const description = doc.createElement("p");
	const message = doc.createElement("span");
	description.append(message);
	let suffix = 0;
	do {
		description.id = `praxity-completion-reason-${suffix++}`;
	} while (doc.getElementById(description.id));
	description.setAttribute("data-completion-reason", "");

	const restoreControl = (control: HTMLElement, saved: Map<string, string | null>) => {
		for (const [name, value] of saved) {
			if (value === null) control.removeAttribute(name);
			else control.setAttribute(name, value);
		}
		for (const type of ["click", "auxclick", "keydown"])
			control.removeEventListener(type, guard, true);
		effects.delete(control);
	};
	const restore = () => {
		for (const [control, saved] of effects) restoreControl(control, saved);
		description.remove();
		if (proxyVisibility) {
			if (
				proxyVisibility.hidden === null ||
				(proxyVisibility.element.id === "deck-controls" &&
					doc.querySelector(".praxity-deck[data-ready]"))
			)
				proxyVisibility.element.removeAttribute("hidden");
			else proxyVisibility.element.setAttribute("hidden", proxyVisibility.hidden);
			proxyVisibility = undefined;
		}
	};
	const guard = (event: Event) => {
		const target =
			event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
		if (!target || !effects.has(target)) return;
		if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};

	return {
		description,
		sync(blocked: boolean, reasons: string[]) {
			if (!blocked) {
				restore();
				return;
			}
			message.textContent = reasons.length
				? reasons.join(" ")
				: (doc.defaultView?.__PRAXITY_STRINGS__?.nextPageUnavailable ??
					getNextPageUnavailable(doc.documentElement.lang));
			const controls = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(
				(control) =>
					control.hasAttribute("data-continue-button") ||
					control.id === "deck-next" ||
					control.id === "deck-continue" ||
					Number(control.dataset.pageNumber) >
						Number(
							doc.querySelector<HTMLElement>("[data-deck-slide]:not([hidden])")?.dataset
								.pageNumber ?? currentPage,
						),
			);
			for (const [control, saved] of effects) {
				if (!controls.includes(control)) restoreControl(control, saved);
			}
			// Inside the nav, the reason shares its band; as a sibling it would become a layout grid item.
			const primary =
				(doc.body.classList.contains("praxity-minimal")
					? doc.getElementById("praxity-embed-nav")
					: null) ??
				doc.getElementById("praxity-page-nav") ??
				doc.getElementById("deck-controls") ??
				controls[0]?.closest("nav");
			if (
				primary?.classList.contains("praxity-navigation-proxy") ||
				primary?.id === "deck-controls"
			) {
				proxyVisibility ??= { element: primary, hidden: primary.getAttribute("hidden") };
				primary.removeAttribute("hidden");
			}
			if (!description.isConnected) {
				if (primary) primary.append(description);
				else controls[0]?.insertAdjacentElement("afterend", description);
			}
			for (const control of controls) {
				if (!effects.has(control)) {
					// Control-owned capture guards modified clicks and AT activation without making containers clickable.
					for (const type of ["click", "auxclick", "keydown"])
						control.addEventListener(type, guard, true);
					effects.set(
						control,
						new Map(attributes.map((name) => [name, control.getAttribute(name)])),
					);
				}
				const saved = effects.get(control);
				if (control.tagName === "A") {
					control.removeAttribute("href");
					control.setAttribute("role", "link");
					control.setAttribute("tabindex", saved?.get("tabindex") ?? "0");
				}
				control.setAttribute("aria-disabled", "true");
				control.setAttribute(
					"aria-describedby",
					[saved?.get("aria-describedby"), description.id].filter(Boolean).join(" "),
				);
			}
		},
		destroy() {
			restore();
		},
	};
}
