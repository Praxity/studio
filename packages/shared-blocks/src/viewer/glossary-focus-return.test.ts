import { afterEach, expect, it, vi } from "vitest";
import { rememberGlossaryFocusReturn } from "./glossary-focus-return";

afterEach(() => {
	window.__praxityCancelGlossaryFocusReturn?.();
	Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

it("revocation during delayed focus cannot cancel a successor's focus return", () => {
	let epoch = 0;
	Object.assign(window, {
		__praxitySelfCheckDocument: {
			loadTicket() {
				const captured = epoch;
				return () => epoch === captured;
			},
		},
	});
	const frames: FrameRequestCallback[] = [],
		timers: (() => void)[] = [];
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void) => {
		timers.push(callback);
		return timers.length;
	}) as typeof window.setTimeout);
	const oldLink = document.createElement("a"),
		freshLink = document.createElement("a");
	oldLink.textContent = "Old term";
	freshLink.textContent = "Fresh term";
	for (const link of [oldLink, freshLink]) {
		link.href = "#term";
		vi.spyOn(link, "getClientRects").mockReturnValue([
			{ width: 10, height: 10 },
		] as unknown as DOMRectList);
		document.body.append(link);
	}
	let focused = 0;
	oldLink.addEventListener("focus", () => {
		if (++focused !== 2) return;
		++epoch;
		rememberGlossaryFocusReturn(freshLink);
	});
	rememberGlossaryFocusReturn(oldLink);
	window.dispatchEvent(new Event("focus"));
	frames.splice(0).forEach((callback) => callback(0));
	expect(document.activeElement).toBe(oldLink);
	oldLink.blur();
	timers.splice(0).forEach((callback) => callback());
	expect(epoch).toBe(1);
	oldLink.blur();
	window.dispatchEvent(new Event("focus"));
	frames.splice(0).forEach((callback) => callback(0));
	expect(document.activeElement).toBe(freshLink);
});
