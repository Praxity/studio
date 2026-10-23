import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { describe, expect, it } from "vitest";
import {
	readBlockFixture as readBlockSource,
	withoutNodeIdentity,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { renderBlockHtml } from "../render-block-html";

describe("quote surface styles", () => {
	it.each(["none", "outline", "shaded", "primary", "secondary"])(
		"preserves %s through parser, adapter and canonical semantic rendering",
		(style) => {
			const parsed = readBlockSource(
				`# Fixture {hideTitle}\n\n::: quote {style=${style} source=https://example.com/source}\nQuoted words.\nspeaker: Speaker\nwork: Source work\n:::\n`,
			);
			const block = adaptGrammarPreviewBlocks(parsed.blocks)[0];
			expect(block.data.style).toBe(style);
			const html = withoutNodeIdentity(renderBlockHtml(block));
			expect(html).toContain(`class="praxity-quote" data-style="${style}"`);
			expect(html).toContain(
				'<blockquote cite="https://example.com/source"><p>Quoted words.</p></blockquote>',
			);
			expect(html).toContain('<cite><a href="https://example.com/source">Source work</a></cite>');
		},
	);
	it("applies configured quote defaults only to omitted source styles", () => {
		const omitted = readBlockSource("# Untitled {hideTitle}\n\n::: quote\nQuoted words.\n:::\n");
		expect(omitted.blocks[0].data).not.toHaveProperty("style");
		expect(renderBlockHtml(adaptGrammarPreviewBlocks(omitted.blocks)[0])).toContain(
			'<figure class="praxity-quote" data-size="default">',
		);
		expect(
			adaptGrammarPreviewBlocks(omitted.blocks, { quote: { style: "primary" } })[0].data.style,
		).toBe("primary");
		const explicit = readBlockSource(
			"# Untitled {hideTitle}\n\n::: quote {style=none}\nQuoted words.\n:::\n",
		);
		expect(
			adaptGrammarPreviewBlocks(explicit.blocks, { quote: { style: "primary" } })[0].data.style,
		).toBe("none");
	});
});
