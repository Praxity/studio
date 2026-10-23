/**
 * Reveal a location inside a scroll container when you arrive from somewhere else —
 * an accessibility issue clicked in a side panel, a preview block, a search result.
 *
 * Two rules, both borrowed from what editors converged on (VS Code's
 * revealRangeInCenterIfOutsideViewport, GitHub's line anchors):
 *
 * 1. If the target is already comfortably visible, do not move. A jump the reader
 *    did not need is the most disorienting kind.
 * 2. Otherwise put it about a third from the top, not at the very top and not dead
 *    centre. The top hides the context an issue usually depends on — the heading
 *    above it, the image the alt text belongs to — and centre wastes the space
 *    below, which is where the reader is about to work.
 */
export const REVEAL_RATIO = 1 / 3;

/** Ignore a target already inside this band of the viewport. */
const COMFORT_MARGIN = 0.15;

export interface RevealOptions {
	/** Fraction of the container height to place the target at. */
	ratio?: number;
	/** Extra top offset for sticky chrome that would otherwise cover the target. */
	stickyOffset?: number;
	behavior?: ScrollBehavior;
}

/** Scroll `container` so `offsetTop` (relative to the container's content) sits at the ratio. */
export function revealOffsetInContainer(
	container: HTMLElement,
	offsetTop: number,
	{ ratio = REVEAL_RATIO, stickyOffset = 0, behavior }: RevealOptions = {},
): void {
	const viewport = container.clientHeight;
	const visibleTop = container.scrollTop + viewport * COMFORT_MARGIN + stickyOffset;
	const visibleBottom = container.scrollTop + viewport * (1 - COMFORT_MARGIN);
	if (offsetTop >= visibleTop && offsetTop <= visibleBottom) return;

	const maxScroll = Math.max(0, container.scrollHeight - viewport);
	const target = Math.min(Math.max(0, offsetTop - viewport * ratio - stickyOffset), maxScroll);
	const prefersReduced =
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
	container.scrollTo({ top: target, behavior: behavior ?? (prefersReduced ? "auto" : "smooth") });
}

/** Same rule for an element: resolves its position within the container first. */
export function revealElementInContainer(
	element: HTMLElement,
	container: HTMLElement,
	options: RevealOptions = {},
): void {
	const offsetTop =
		element.getBoundingClientRect().top -
		container.getBoundingClientRect().top +
		container.scrollTop;
	revealOffsetInContainer(container, offsetTop, options);
}

/** Nearest scrollable ancestor, or null when only the document scrolls. */
export function findScrollContainer(element: HTMLElement): HTMLElement | null {
	let node = element.parentElement;
	while (node && node !== document.body) {
		const overflowY = getComputedStyle(node).overflowY;
		if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

/**
 * Brief highlight so the reader can see where they were taken. Reduced motion keeps
 * the highlight and drops the fade — the cue is the point, the animation is not.
 */
export function flashReveal(element: HTMLElement, durationMs = 1200): void {
	element.setAttribute("data-reveal-flash", "");
	window.setTimeout(() => element.removeAttribute("data-reveal-flash"), durationMs);
}
