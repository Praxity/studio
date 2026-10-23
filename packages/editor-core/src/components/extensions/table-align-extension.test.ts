import { describe, expect, it } from "vitest";
import {
	computeColumnWidths,
	computeTablePaddingSpecs,
	type TableLineEntry,
} from "./table-align-extension";

describe("computeColumnWidths", () => {
	it("computes max width per column", () => {
		const lines = ["| Name | Age | City |", "| Alice | 30 | New York |", "| Bob | 25 | LA |"];
		expect(computeColumnWidths(lines)).toEqual([5, 3, 8]);
	});

	it("handles single column", () => {
		expect(computeColumnWidths(["| Hello |", "| Hi |"])).toEqual([5]);
	});

	it("handles uneven columns", () => {
		const widths = computeColumnWidths(["| A | B |", "| C |"]);
		expect(widths[0]).toBe(1);
		expect(widths[1]).toBe(1);
	});

	it("handles empty cells", () => {
		expect(computeColumnWidths(["| | B |", "| AA | C |"])).toEqual([2, 1]);
	});
});

describe("computeTablePaddingSpecs", () => {
	it("creates padding specs per cell based on max width in a contiguous table block", () => {
		const lines: TableLineEntry[] = [
			{ text: "| A | BB |", lineStart: 10 },
			{ text: "| CCC | D |", lineStart: 30 },
		];

		expect(computeTablePaddingSpecs(lines)).toEqual([
			{ pos: 13, widthCh: 2 },
			{ pos: 39, widthCh: 1 },
		]);
	});

	it("resets width calculation between separate table blocks", () => {
		const lines: TableLineEntry[] = [
			{ text: "| A |", lineStart: 1 },
			{ text: "| BBB |", lineStart: 20 },
			{ text: "not a table row", lineStart: 40 },
			{ text: "| C |", lineStart: 60 },
		];

		expect(computeTablePaddingSpecs(lines)).toEqual([{ pos: 4, widthCh: 2 }]);
	});

	it("treats indented rows as table rows", () => {
		const lines: TableLineEntry[] = [
			{ text: "   | X | YY |", lineStart: 100 },
			{ text: "   | XXX | Z |", lineStart: 120 },
		];

		expect(computeTablePaddingSpecs(lines)).toEqual([
			{ pos: 106, widthCh: 2 },
			{ pos: 132, widthCh: 1 },
		]);
	});

	it("does not add padding for a single-row table", () => {
		const lines: TableLineEntry[] = [{ text: "| A | B |", lineStart: 1 }];
		expect(computeTablePaddingSpecs(lines)).toEqual([]);
	});

	it("pads from empty cells when a later row has wider content", () => {
		const lines: TableLineEntry[] = [
			{ text: "| | B |", lineStart: 1 },
			{ text: "| AA | C |", lineStart: 20 },
		];

		expect(computeTablePaddingSpecs(lines)).toEqual([{ pos: 2, widthCh: 2 }]);
	});
});
