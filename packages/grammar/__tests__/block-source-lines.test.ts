import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "./helpers/lesson-fixture.ts";

describe("reader source coordinates", () => {
	it("maps lines correctly with no frontmatter", () => {
		const source = "# Heading\n\nSome text.\n\n![A photo](https://example.com/img.png)\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(0);
		expect(lineMap.get(blocks[1].id)?.startLine).toBe(2);
		expect(lineMap.get(blocks[2].id)?.startLine).toBe(4);
	});

	it("maps lines correctly with frontmatter", () => {
		const source = "---\ntitle: Test\n---\n\n# Heading\n\nSome text.\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(4);
		expect(lineMap.get(blocks[1].id)?.startLine).toBe(6);
	});

	it("handles whitespace-only separator between frontmatter and body", () => {
		const source = "---\ntitle: Test\n---\n   \n# Heading\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(4);
	});

	it("handles multiple blank lines after frontmatter", () => {
		const source = "---\ntitle: Test\n---\n\n\n# Heading\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(5);
	});

	it("maps fenced blocks correctly with frontmatter", () => {
		const source =
			"---\ntitle: Test\n---\n\n# Heading\n\nSome text.\n\n![A photo](https://example.com/img.png)\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(4);
		expect(lineMap.get(blocks[1].id)?.startLine).toBe(6);
		expect(lineMap.get(blocks[2].id)?.startLine).toBe(8);
	});

	it("handles mixed blank and whitespace-only lines after frontmatter", () => {
		const source = "---\ntitle: T\n---\n\n   \n# Heading\n";
		const { blocks, spans } = readBlockSource(source);
		const lineMap = spans;

		expect(lineMap.get(blocks[0].id)?.startLine).toBe(5);
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
