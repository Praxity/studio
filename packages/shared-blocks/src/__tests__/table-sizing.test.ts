/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { allocateTableColumns, enhanceTableSizing } from "../table-sizing";

it("preserves compact columns in either position and shares the rest above intrinsic minimums", () => {
	const allocate = (min: number[], max: number[], width = 900) =>
		allocateTableColumns(min, max, width, 16)?.map(Math.round);
	expect(allocate([60, 100], [120, 1400])).toEqual([120, 780]);
	expect(allocate([100, 60], [1400, 120])).toEqual([780, 120]);
	expect(allocate([60, 100, 100], [120, 1400, 1200])).toEqual([120, 390, 390]);
	expect(allocate([60, 500, 100], [120, 1400, 1200])).toEqual([120, 500, 280]);
});

it("leaves narrow, enlarged, all-fitting and all-prose tables native", () => {
	for (const [min, max, width, font] of [
		[[60, 100], [120, 1400], 320, 16],
		[[60, 100], [120, 1400], 900, 32],
		[[60, 100], [120, 140], 900, 16],
		[[100, 100], [700, 1400], 900, 16],
		[[500, 500], [700, 1400], 900, 16],
	] as const)
		expect(allocateTableColumns(min, max, width, font)).toBeNull();
	expect(allocateTableColumns([60, 100], [120, Number.NaN], 900, 16)).toBeNull();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

it("measures without duplicate IDs, updates content, and disposes idempotently without observer loops", async () => {
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	document.body.innerHTML =
		'<section><table id="table" style="font-size:16px"><caption>Responsibilities</caption><tbody><tr><th id="label" scope="row">Label</th><td>Long prose</td></tr></tbody></table></section>';
	const table = document.querySelector("table") as HTMLTableElement;
	Object.defineProperty(table.parentElement, "clientWidth", { value: 900, configurable: true });
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
		this: HTMLElement,
	) {
		const measuring = this.closest("table");
		expect(document.querySelectorAll("#label")).toHaveLength(1);
		expect(document.querySelectorAll("#table")).toHaveLength(1);
		const width =
			measuring?.style.width === "min-content" ? 60 : this.tagName === "TH" ? 120 : 1400;
		return width;
	});
	// A scaled ancestor changes visual rectangles, but must not shrink layout allocation.
	table.parentElement?.style.setProperty("transform", "scale(.5)");
	const visualWidth = vi
		.spyOn(HTMLElement.prototype, "getBoundingClientRect")
		.mockReturnValue({ width: 60 } as DOMRect);
	const cleanup = enhanceTableSizing(table);
	expect(visualWidth).not.toHaveBeenCalled();
	expect(table.querySelector("col")?.style.width).toBe("121px");
	const duplicateCleanup = enhanceTableSizing(table);
	expect(table.style.tableLayout).toBe("fixed");
	expect(table.firstElementChild).toBe(table.caption);
	expect(table.querySelectorAll("colgroup")).toHaveLength(1);
	duplicateCleanup();
	expect(table.style.tableLayout).toBe("fixed");
	await Promise.resolve();
	expect(frames).toHaveLength(0);
	const decoration = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	decoration.setAttribute("data-praxity-doodle-decoration", "");
	table.rows[0].cells[0].append(decoration);
	await Promise.resolve();
	expect(frames).toHaveLength(0);
	decoration.remove();
	await Promise.resolve();
	expect(frames).toHaveLength(0);
	table.rows[0].cells[0].textContent = "Changed";
	await Promise.resolve();
	expect(frames).toHaveLength(1);
	frames.shift()?.(0);
	await Promise.resolve();
	expect(frames).toHaveLength(0);
	expect(table.querySelectorAll("colgroup")).toHaveLength(1);
	Object.defineProperty(table.parentElement, "clientWidth", { value: 300 });
	table.style.fontSize = "32px";
	await Promise.resolve();
	frames.shift()?.(0);
	expect(table.style.tableLayout).toBe("");
	cleanup();
	expect(table.style.width).toBe("");
	expect(table.querySelector("colgroup")).toBeNull();
	expect(table.rows[0].cells[0].scope).toBe("row");
});
