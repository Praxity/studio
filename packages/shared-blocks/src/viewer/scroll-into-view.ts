import { createSelfCheckResizeObserver, observeSelfCheckLifetime } from "../self-check-consumers";

const pageScrollBars = [
	[".praxity-top-bar-fallback", "scroll-padding-block-start"],
	["#praxity-page-nav", "scroll-padding-block-end"],
] as const;

function updatePageScrollPadding(doc: Document): void {
	const scroller = doc.scrollingElement as HTMLElement | null;
	if (!scroller) return;
	for (const [selector, property] of pageScrollBars) {
		const bar = doc.querySelector<HTMLElement>(selector);
		const height =
			bar && ["fixed", "sticky"].includes(getComputedStyle(bar).position)
				? bar.getBoundingClientRect().height
				: 0;
		scroller.style.setProperty(
			property,
			property === "scroll-padding-block-end"
				? `calc(${height}px + var(--praxity-scroll-overlay-end, 0px))`
				: `${height}px`,
		);
	}
}

/** Native Tab focus and every scroll destination share the sticky chrome clearance. */
export function observePageScrollPadding(doc: Document): () => void {
	return observeSelfCheckLifetime((current) => {
		const sync = () => {
			if (current()) updatePageScrollPadding(doc);
		};
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: createSelfCheckResizeObserver(current, sync);
		for (const [selector] of pageScrollBars) {
			const bar = doc.querySelector(selector);
			if (bar) observer?.observe(bar);
		}
		doc.defaultView?.addEventListener("resize", sync);
		sync();
		return () => {
			observer?.disconnect();
			doc.defaultView?.removeEventListener("resize", sync);
		};
	}, doc);
}

export function scrollElementIntoView(
	element: Element,
	options: Omit<ScrollIntoViewOptions, "behavior">,
): void {
	updatePageScrollPadding(element.ownerDocument);
	// Native smooth scrolling has no duration control; learner motion must stay under 300 ms.
	element.scrollIntoView({ ...options, behavior: "instant" });
}
