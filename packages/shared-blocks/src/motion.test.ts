import { afterEach, describe, expect, it, vi } from "vitest";
import css from "./blocks/shared-blocks.css?raw";
import { initializeEntranceMotion } from "./motion";

describe("owned decorative motion policy", () => {
	// DESIGN-DECISIONS §13: motion never loops or decorates; the old pulses became static cues.
	it("declares no looping or pulse animation", () => {
		expect(css).not.toMatch(/animation[^;]*infinite/);
		expect(css).not.toMatch(/@keyframes praxity-(block-)?pulse/);
	});
});

function motionRoot(): HTMLElement {
	document.body.innerHTML = `<div data-praxity-root data-praxity-motion-entrance="slide" data-praxity-motion-stagger="sequential">
		<div class="praxity-block praxity-block-sequence"><span class="praxity-sequence-item"></span></div>
		<div class="praxity-block praxity-block-stats"><span class="praxity-stats-item"></span></div>
		${'<div class="praxity-block"></div>'.repeat(5)}
	</div>`;
	return document.body.firstElementChild as HTMLElement;
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe("initializeEntranceMotion", () => {
	it("stamps capped block/item indices and reveals intersecting content", () => {
		let callback: IntersectionObserverCallback | undefined;
		let observer: IntersectionObserver | undefined;
		class MockIntersectionObserver {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			takeRecords = vi.fn(() => []);
			root = null;
			rootMargin = "0px";
			thresholds = [0.1];

			constructor(nextCallback: IntersectionObserverCallback) {
				callback = nextCallback;
				observer = this as unknown as IntersectionObserver;
			}
		}
		vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

		const root = motionRoot();
		const cleanup = initializeEntranceMotion(root);
		const blocks = root.querySelectorAll<HTMLElement>(".praxity-block");
		const firstBlock = blocks[0];

		expect([...blocks].map((block) => block.dataset.entrance)).toEqual(
			Array.from({ length: 7 }, () => "pending"),
		);
		expect(blocks[6].style.getPropertyValue("--praxity-stagger-index")).toBe("5");
		expect(root.querySelector(".praxity-sequence-item")).toHaveAttribute(
			"data-entrance",
			"pending",
		);

		callback?.(
			[{ isIntersecting: true, target: firstBlock } as unknown as IntersectionObserverEntry],
			observer as IntersectionObserver,
		);
		expect(firstBlock).toHaveAttribute("data-entrance", "visible");
		expect(firstBlock.querySelector(".praxity-sequence-item")).toHaveAttribute(
			"data-entrance",
			"visible",
		);

		cleanup();
		expect(blocks[1]).toHaveAttribute("data-entrance", "visible");
	});

	it("keeps content visible when IntersectionObserver is unavailable or throws", () => {
		const unavailableRoot = motionRoot();
		initializeEntranceMotion(unavailableRoot);
		expect(unavailableRoot.querySelectorAll('[data-entrance="pending"]')).toHaveLength(0);

		class ThrowingIntersectionObserver {
			constructor() {
				throw new Error("observer unavailable");
			}
		}
		vi.stubGlobal("IntersectionObserver", ThrowingIntersectionObserver);
		const throwingRoot = motionRoot();
		initializeEntranceMotion(throwingRoot);
		expect(throwingRoot.querySelectorAll('[data-entrance="pending"]')).toHaveLength(0);
	});

	it("bails out visibly for OS and learner reduced-motion preferences", () => {
		const Observer = vi.fn();
		vi.stubGlobal("IntersectionObserver", Observer);
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia,
		);
		const osRoot = motionRoot();
		initializeEntranceMotion(osRoot);
		expect(Observer).not.toHaveBeenCalled();
		expect(osRoot.querySelectorAll('[data-entrance="pending"]')).toHaveLength(0);

		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
		const learnerRoot = motionRoot();
		learnerRoot.dataset.praxityReducedMotion = "true";
		initializeEntranceMotion(learnerRoot);
		expect(Observer).not.toHaveBeenCalled();
		expect(learnerRoot.querySelectorAll('[data-entrance="pending"]')).toHaveLength(0);
	});
});
