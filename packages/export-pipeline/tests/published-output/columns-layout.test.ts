import { beforeAll, describe, expect, test } from "vitest";
import { type BuildResult, blocksByType, getBuild } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Columns layout", () => {
	test("column wrapper contains .praxity-column children", () => {
		const columns = blocksByType(build.blocks, "columns");
		expect(columns.length).toBeGreaterThan(0);
		for (const block of columns) {
			const cols = block.element.querySelectorAll(".praxity-column");
			expect(
				cols.length,
				`columns ${block.id} has no .praxity-column children`,
			).toBeGreaterThanOrEqual(2);
		}
	});

	test("column count matches block data items count", () => {
		const columns = blocksByType(build.blocks, "columns");
		for (const block of columns) {
			const cols = block.element.querySelectorAll(".praxity-column");
			const items = block.data?.items ?? block.data?.children;
			if (Array.isArray(items)) {
				expect(
					cols.length,
					`columns ${block.id} rendered ${cols.length} columns but data has ${items.length} items`,
				).toBe(items.length);
			}
		}
	});

	test("column children contain rendered content", () => {
		const columns = blocksByType(build.blocks, "columns");
		for (const block of columns) {
			const cols = block.element.querySelectorAll(".praxity-column");
			for (let i = 0; i < cols.length; i++) {
				const col = cols[i];
				const textContent = col.textContent?.trim() ?? "";
				expect(
					textContent.length,
					`columns ${block.id} column ${i} has no visible text content`,
				).toBeGreaterThan(0);
			}
		}
	});

	test("3-column blocks produce exactly 3 columns", () => {
		const columns = blocksByType(build.blocks, "columns");
		const threeCol = columns.filter((b) => {
			const items = b.data?.items ?? b.data?.children;
			return Array.isArray(items) && items.length === 3;
		});
		for (const block of threeCol) {
			const cols = block.element.querySelectorAll(".praxity-column");
			expect(cols.length, `3-column block ${block.id} produced ${cols.length} columns`).toBe(3);
		}
	});
});
