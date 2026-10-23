import { describe, expect, it } from "vitest";
import {
	readBlockFixture as readBlockSource,
	replayLesson,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { adaptGrammarPreviewBlocks } from "../grammar-adapter";
import { inlineMarkdown } from "../inline-markdown";
import { preparePageFootnotes } from "../page-footnotes";
import { sanitizeHtml } from "../sanitize";
import type { PraxityBlock } from "../types";

const strings = { footnote: "Footnote", footnotes: "Sources" };
const prepare = (source: string) =>
	preparePageFootnotes(adaptGrammarPreviewBlocks(readBlockSource(source).blocks), "page", strings);

describe("page footnotes", () => {
	it("preserves literal self-check fields and numbers only surrounding rich text", () => {
		const task =
			'Write @source{Raw source} <span data-footer-content="Literal source">note</span> <span data-footer-insert="true">@footer.insert</span> here.';
		const blocks = adaptGrammarPreviewBlocks(
			readBlockSource(
				`# Practice\n::: accordion\n:: Panel\nBefore @source{Before source}.\n::: self-check ${task}\nmodel: Model\n:: Criterion\nmissed: Hint\n:::\nAfter @source{After source}.\n:::\n`,
			).blocks,
		);
		const before = structuredClone(blocks);
		const result = preparePageFootnotes(blocks, "page", strings);
		const items = result.find((block) => block.type === "accordion")?.data.items as {
			children: PraxityBlock[];
		}[];
		const content = items[0].children.find((block) => block.type === "selfCheck")?.data.content as {
			task: string;
		};
		expect(content.task).toBe(task);
		expect(result.at(-1)?.data.content).toBe(
			'<ol class="praxity-footnotes" aria-label="Sources"><li>Before source</li><li>After source</li></ol>',
		);
		expect(blocks).toEqual(before);
	});
	it("numbers in page order and appends a list without mutating source", () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\nOne @source{First source}.\n\nTwo @source{Second **source**}.\n",
		).blocks;
		const before = JSON.stringify(blocks);
		const prepared = preparePageFootnotes(blocks, "page", strings);
		expect(JSON.stringify(blocks)).toBe(before);
		expect(JSON.stringify(prepared)).toContain("[1]");
		expect(JSON.stringify(prepared)).toContain("[2]");
		expect(prepared.at(-1)?.data.content).toContain(
			"<li>First source</li><li>Second <strong>source</strong></li>",
		);
		expect(JSON.stringify(prepared)).not.toContain('role=\\"link');
		expect(preparePageFootnotes(prepared, "page", strings)).toBe(prepared);
		expect(
			JSON.stringify(prepare("# New page {hideTitle}\nNew page @source{Third source}.")),
		).toContain("[1]");
	});

	it("places all page sources inside an authored accordion, including later references", () => {
		const prepared = prepare(
			"# Untitled {hideTitle}\n\nBefore @source{First}.\n\n::: accordion\n:: Sources {level=3}\n@sources\n:::\n\nAfter @source{Second}.\n",
		);
		const accordion = prepared.find((block) => block.type === "accordion");
		expect(JSON.stringify(accordion)).toContain("<li>First</li><li>Second</li>");
		expect(prepared.some((block) => block.data._footnotes)).toBe(false);
		expect(JSON.stringify(prepared)).not.toContain("<p><ol");
	});

	it("leaves inline code and inline insert text literal, with one standalone insertion", () => {
		const result = prepare(
			"# Literal {hideTitle}\nRead `@source{literal}`.\n\nText @source{source}.\n\nNot here @sources please.\n\n@sources\n\n@sources",
		);
		const html = JSON.stringify(result);
		expect(html).toContain("<code>@source{literal}</code>");
		expect(html.match(/<ol /g)).toHaveLength(1);
		expect(html).toContain("Not here");
		expect(html).not.toContain("Footnote </span>[2]");
	});

	it("keeps malformed footer syntax out of generic doodles", () => {
		const html = inlineMarkdown("Malformed @footer{source with @icon{mail}}.");

		expect(html).not.toContain('data-doodle="footer"');
		expect(html).toContain("@footer");
	});

	it("preserves footnote source through grammar round trip, including code and entities", () => {
		const source =
			'# Sources {hideTitle}\nText @source{A **bold** source, `x < y`, & "quoted".}\n\n@sources';
		const parsed = readBlockSource(source);
		const serialized = replayLesson(parsed);
		expect(serialized).toContain('@source{A **bold** source, `x < y`, & "quoted".}');
		expect(serialized).toContain("@sources");
		expect(JSON.stringify(readBlockSource(serialized).blocks.map((block) => block.data))).toBe(
			JSON.stringify(parsed.blocks.map((block) => block.data)),
		);
	});

	it("keeps source HTML inert and unsafe source links sanitized", () => {
		const html = String(
			prepare(
				"# Unsafe {hideTitle}\nText @source{<img src=x onerror=alert(1)> [bad](javascript:evil)}.",
			).at(-1)?.data.content,
		);
		const safe = sanitizeHtml(html);
		expect(safe).toContain("&lt;img");
		expect(safe).not.toContain('href="javascript:');
		expect(safe).not.toContain("<img");
	});

	it("does not collect hidden blocks or code blocks", () => {
		const marker = inlineMarkdown("@footer{Not a source}");
		const blocks: PraxityBlock[] = [
			{ id: "hidden", type: "text", data: { content: marker, hide: true } },
			{ id: "code", type: "code", data: { code: marker } },
		];
		expect(preparePageFootnotes(blocks, "page", strings)).toBe(blocks);
	});
});
