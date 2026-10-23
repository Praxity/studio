import type { JSDOM } from "jsdom";
import { afterEach, expect } from "vitest";

const callbackErrors: unknown[] = [];
afterEach(() => expect(callbackErrors.splice(0)).toEqual([]));

/** JSDOM has no layout. Keep concealment and contents behavior at the browser seam. */
export function reviewPageLayout(dom: JSDOM) {
	const win = dom.window;
	const computedStyle = win.getComputedStyle.bind(win);
	win.Element.prototype.getBoundingClientRect = () =>
		({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }) as DOMRect;
	win.addEventListener("error", (event) => {
		callbackErrors.push(event.error ?? event.message);
		event.preventDefault();
	});
	function concealed(element: Element) {
		for (let node: Element | null = element; node; node = node.parentElement) {
			if (computedStyle(node).display === "none") return true;
			if (
				node.matches("details:not([open])") &&
				element !== node &&
				!node.querySelector("summary")?.contains(element)
			)
				return true;
		}
		return false;
	}
	win.Element.prototype.getClientRects = function () {
		return (concealed(this) || computedStyle(this).display === "contents"
			? []
			: [this.getBoundingClientRect()]) as unknown as DOMRectList;
	};
	win.Range.prototype.getClientRects = function () {
		const root = this.commonAncestorContainer;
		const nodes: Node[] = root.nodeType === 3 ? [root] : [];
		const walker = win.document.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
		return nodes
			.filter(
				(node) =>
					node.textContent &&
					this.intersectsNode(node) &&
					node.parentElement &&
					!concealed(node.parentElement),
			)
			.map((node) => {
				const box = node.parentElement!.getBoundingClientRect();
				// Default text still renders when a test does not need measured coordinates.
				return box.width || box.height
					? box
					: { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 };
			}) as unknown as DOMRectList;
	};
	win.Range.prototype.getBoundingClientRect = function () {
		const rects = Array.from(this.getClientRects());
		const left = Math.min(...rects.map((box) => box.left)),
			top = Math.min(...rects.map((box) => box.top));
		const right = Math.max(...rects.map((box) => box.right)),
			bottom = Math.max(...rects.map((box) => box.bottom));
		return rects.length
			? ({ left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect)
			: ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect);
	};
}
