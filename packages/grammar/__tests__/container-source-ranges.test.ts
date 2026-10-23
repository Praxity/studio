import { describe, expect, it } from "vitest";
import { readBlockFixture } from "./helpers/lesson-fixture.ts";

describe("container source ranges", () => {
	it.each(["accordion", "tabs", "sequence", "comparison", "group"])(
		"includes the explicit %s opener and closer around separated body content",
		(keyword) => {
			const body =
				keyword === "group"
					? "::: choice Q\n(x) Yes\n( ) No\n:::"
					: keyword === "comparison"
						? ":: First\nBody.\n:: Second\nBody."
						: ":: Item\n\nBody.";
			const result = readBlockFixture(`::: ${keyword} Attached\n\n${body}\n:::`);
			expect(result.errors).toEqual([]);
			expect(result.containerRanges).toMatchObject([{ startLine: 2, explicitClose: true }]);
		},
	);
	it.each(["cards", "cards {layout=slides}", "columns"])(
		"keeps a standalone %s outside preceding content",
		(declaration) => {
			for (const previous of [
				"## Outside",
				"Outside.",
				"```\nOutside\n```",
				"| Outside |\n| --- |\n| Value |",
				"![Outside](/assets/image.png)",
			]) {
				const prefix = `${previous}\n\n`;
				const result = readBlockFixture(`${prefix}::: ${declaration}\n:: Inside\nBody.\n:::`);
				expect(result.errors).toEqual([]);
				expect(result.blocks).toHaveLength(2);
				expect(result.containerRanges).toMatchObject([
					{ startLine: prefix.split("\n").length + 1, explicitClose: true },
				]);
			}
		},
	);
	it.each(["accordion", "tabs", "sequence", "comparison"])(
		"records the full %s range through an empty last item",
		(keyword) => {
			const source = `::: ${keyword}\n:: First\n\nBody.\n\n:: Last\n\n:::\n\n## Outside\n\nOutside body.`;
			expect(readBlockFixture(source).containerRanges).toMatchObject([
				{ keyword, startLine: 2, endLine: 9, explicitClose: true },
			]);
		},
	);
	it("records each nested range through its own closer", () => {
		const result = readBlockFixture(
			"# Outside {hideTitle}\n\n::: accordion\n:: Outer\n::: tabs\n:: Inner\nBody.\n:::\n:::\n\n## Outside\n\nOutside body.\n",
		);
		expect(result.containerRanges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ keyword: "tabs", startLine: 4, endLine: 7, explicitClose: true }),
				expect.objectContaining({
					keyword: "accordion",
					startLine: 2,
					endLine: 8,
					explicitClose: true,
				}),
			]),
		);
	});
	it("combines sibling columns into the rendered group's source range", () => {
		expect(
			readBlockFixture("# Untitled {hideTitle}\n\n::: columns\n::\nOne.\n\n::\nTwo.\n:::\n")
				.containerRanges,
		).toMatchObject([{ keyword: "columns", startLine: 2, endLine: 8, explicitClose: true }]);
	});
	it("keeps allocated identity and whole-file coordinates after frontmatter", () => {
		const result = readBlockFixture(
			"---\ntitle: Example\n---\n\n# Untitled {hideTitle}\n\n::: accordion\n:: Item {level=3}\nBody.\n:::\n",
		);
		expect(result.containerRanges).toEqual([
			{
				blockId: result.blocks[0].id,
				keyword: "accordion",
				startLine: 6,
				endLine: 9,
				explicitClose: true,
			},
		]);
	});
});
