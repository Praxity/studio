import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../../../grammar/__tests__/helpers/lesson-fixture.ts";

describe("reader source coordinates", () => {
	it("maps lines correctly with no frontmatter", () => {
		const source = "# Heading\n\nSome text.\n\n![A photo](https://example.com/img.png)\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(0); // # Heading → line 0
		expect(lineMap.get(blocks[1].id)?.startLine).toBe(2); // Some text. → line 2
		expect(lineMap.get(blocks[2].id)?.startLine).toBe(4); // image URL → line 4
	});

	it("maps lines correctly with frontmatter", () => {
		const source = "---\ntitle: Test\n---\n\n# Heading\n\nSome text.\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(4); // # Heading → line 4
		expect(lineMap.get(blocks[1].id)?.startLine).toBe(6); // Some text. → line 6
	});

	it("handles whitespace-only separator between frontmatter and body", () => {
		const source = "---\ntitle: Test\n---\n   \n# Heading\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		// Line 3 is "   " (whitespace-only). parseFrontmatter keeps it in the body
		// (only strips leading \n), and computeBodyLineOffset (fixed) no longer
		// skips it. Both agree: body starts at line 3, heading is at body line 2
		// (1-based token → 0-based = 1), so 3 + 1 = 4, matching source line 4.
		expect(lineMap.get(blocks[0].id)?.startLine).toBe(4); // # Heading → line 4
	});

	it("handles multiple blank lines after frontmatter", () => {
		const source = "---\ntitle: Test\n---\n\n\n# Heading\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(5); // # Heading → line 5
	});

	it("maps fenced blocks correctly with frontmatter", () => {
		const source =
			"---\ntitle: Test\n---\n\n# Heading\n\nSome text.\n\n![A photo](https://example.com/img.png)\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(4); // # Heading → line 4
		expect(lineMap.get(blocks[1].id)?.startLine).toBe(6); // Some text. → line 6
		expect(lineMap.get(blocks[2].id)?.startLine).toBe(8); // image URL → line 8
	});

	it("handles mixed blank and whitespace-only lines after frontmatter", () => {
		const source = "---\ntitle: T\n---\n\n   \n# Heading\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		// Line 0: ---
		// Line 1: title: T
		// Line 2: ---
		// Line 3: "" (empty, skipped by both computeBodyLineOffset and parseFrontmatter)
		// Line 4: "   " (whitespace-only, NOT skipped after fix)
		// Line 5: # Heading
		// computeBodyLineOffset skips line 3 (truly empty), stops at line 4.
		// parseFrontmatter strips the leading \n (line 3), body = "   \n# Heading".
		// Heading token at body line 2 (1-based) → 0-based = 1, offset = 4.
		// So heading maps to 4 + 1 = 5, matching source line 5.
		expect(lineMap.get(blocks[0].id)?.startLine).toBe(5); // # Heading → line 5
	});

	it("uses parser spans to map nested blocks", () => {
		const source = "# Untitled {hideTitle}\n\n::: columns\n::\n### Nested\n\nNested text\n:::\n";
		const parsed = readBlockSource(source);
		const columns = parsed.blocks.find((block) => block.type === "columns");
		const items = columns?.data.items as Array<{ children?: PraxityBlock[] }> | undefined;
		const nestedText = items?.[0]?.children?.find((block) => block.type === "text");
		const lineMap = parsed.spans;

		expect(lineMap.get(nestedText?.id ?? "")?.startLine).toBe(6);
	});

	it("uses whole-file coordinates to parser spans", () => {
		const source = "---\ntitle: Test\n---\n\n# Untitled {hideTitle}\nAlpha";
		const parsed = readBlockSource(source);
		const lineMap = parsed.spans;

		expect(lineMap.get(parsed.blocks[0]?.id ?? "")?.startLine).toBe(5);
	});
});
