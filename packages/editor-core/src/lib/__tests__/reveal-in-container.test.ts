import { describe, expect, it } from "vitest";
import { revealOffsetInContainer } from "../reveal-in-container";

/** Minimal stand-in — the helper only reads these four properties. */
function fakeContainer(scrollTop: number, clientHeight = 600, scrollHeight = 3000) {
	const calls: number[] = [];
	const container = {
		scrollTop,
		clientHeight,
		scrollHeight,
		scrollTo: ({ top }: ScrollToOptions) => calls.push(top ?? 0),
	} as unknown as HTMLElement;
	return { container, calls };
}

describe("revealOffsetInContainer", () => {
	it("leaves a comfortably visible target alone", () => {
		const { container, calls } = fakeContainer(0);
		revealOffsetInContainer(container, 300);
		expect(calls).toEqual([]);
	});

	it("scrolls a target below the viewport to a third from the top", () => {
		const { container, calls } = fakeContainer(0);
		revealOffsetInContainer(container, 1200);
		expect(calls).toEqual([1000]);
	});

	it("scrolls back up for a target above the viewport", () => {
		const { container, calls } = fakeContainer(2000);
		revealOffsetInContainer(container, 400);
		expect(calls).toEqual([200]);
	});

	it("never scrolls past the end of the content", () => {
		const { container, calls } = fakeContainer(0);
		revealOffsetInContainer(container, 2950);
		expect(calls).toEqual([2400]);
	});

	it("offsets for sticky chrome when a container has some", () => {
		const { container, calls } = fakeContainer(0);
		revealOffsetInContainer(container, 1200, { stickyOffset: 50 });
		expect(calls).toEqual([950]);
	});
});
