export const REVEAL_RATIO = 1 / 3;

const COMFORT_MARGIN = 0.15;

export interface RevealOptions {
	ratio?: number;
	stickyOffset?: number;
	behavior?: ScrollBehavior;
}

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

export function flashReveal(element: HTMLElement, durationMs = 1200): void {
	element.setAttribute("data-reveal-flash", "");
	window.setTimeout(() => element.removeAttribute("data-reveal-flash"), durationMs);
}
