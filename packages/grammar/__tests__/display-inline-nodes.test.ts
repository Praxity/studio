import { inlineMarkdown, parseInlineMarkdown } from "@praxity/content-model/inline-markdown";
import {
	type InlineNode,
	inlineParagraph,
	renderInlineTree,
} from "@praxity/content-model/inline-tree";
import { describe, expect, it } from "vitest";
import { tokenizeInline } from "../src/v4/inline";

const text = (start: number, end: number, raw: string, value = raw) => ({
	kind: "text",
	start,
	end,
	raw,
	value,
});

describe.each([
	{ name: "grammar", parse: tokenizeInline, marker: "@source" },
	{ name: "display", parse: parseInlineMarkdown, marker: "@footer" },
])("$name reference ownership", ({ parse, marker }) => {
	const note = (
		start: number,
		end: number,
		name: string,
		referenceTrivia?: Array<{ start: number; end: number }>,
	) => ({
		kind: "source",
		start,
		end,
		raw: `${marker}{${name}}`,
		content: { start: start + 8, end: end - 1, raw: name, value: name },
		...(referenceTrivia ? { referenceTrivia } : {}),
	});
	it.each([
		["Pick one @note{N}", [text(0, 9, "Pick one "), note(9, 19, "N", [{ start: 8, end: 9 }])]],
		["@note{N} Pick one", [note(0, 10, "N", [{ start: 10, end: 11 }]), text(10, 19, " Pick one")]],
		[
			"Pick @note{N} one",
			[text(0, 5, "Pick "), note(5, 15, "N", [{ start: 4, end: 5 }]), text(15, 19, " one")],
		],
		["Pick@note{N}one", [text(0, 4, "Pick"), note(4, 14, "N"), text(14, 17, "one")]],
		[
			"Pick @note{N}[one](https://x.test)",
			[
				text(0, 5, "Pick "),
				note(5, 15, "N"),
				{
					kind: "link",
					start: 15,
					end: 36,
					raw: "[one](https://x.test)",
					children: [text(16, 19, "one")],
					destination: { start: 21, end: 35, raw: "https://x.test", value: "https://x.test" },
				},
			],
		],
		[
			"[Pick @note{N}](https://x.test)",
			[
				{
					kind: "link",
					start: 0,
					end: 33,
					raw: `[Pick ${marker}{N}](https://x.test)`,
					children: [text(1, 6, "Pick "), note(6, 16, "N", [{ start: 5, end: 6 }])],
					destination: { start: 18, end: 32, raw: "https://x.test", value: "https://x.test" },
				},
			],
		],
		[
			"[@note{N} Pick](https://x.test)",
			[
				{
					kind: "link",
					start: 0,
					end: 33,
					raw: `[${marker}{N} Pick](https://x.test)`,
					children: [note(1, 11, "N", [{ start: 11, end: 12 }]), text(11, 16, " Pick")],
					destination: { start: 18, end: 32, raw: "https://x.test", value: "https://x.test" },
				},
			],
		],
		[
			"~~Pick @note{N}~~",
			[
				{
					kind: "strike",
					start: 0,
					end: 19,
					raw: `~~Pick ${marker}{N}~~`,
					children: [text(2, 7, "Pick "), note(7, 17, "N", [{ start: 6, end: 7 }])],
				},
			],
		],
		[
			"Pick. @note{N} @note{M}",
			[
				text(0, 6, "Pick. "),
				note(6, 16, "N", [{ start: 5, end: 6 }]),
				text(16, 17, " "),
				note(17, 27, "M", [{ start: 16, end: 17 }]),
			],
		],
		[
			"Pick @note{N} @note{M} one",
			[
				text(0, 5, "Pick "),
				note(5, 15, "N", [{ start: 4, end: 5 }]),
				text(15, 16, " "),
				note(16, 26, "M", [{ start: 15, end: 16 }]),
				text(26, 30, " one"),
			],
		],
		[
			"Pick@note{N} @note{M} one",
			[
				text(0, 4, "Pick"),
				note(4, 14, "N"),
				text(14, 15, " "),
				note(15, 25, "M", [{ start: 14, end: 15 }]),
				text(25, 29, " one"),
			],
		],
		[
			"@note{A} Pick one @note{B}",
			[
				note(0, 10, "A", [{ start: 10, end: 11 }]),
				text(10, 20, " Pick one "),
				note(20, 30, "B", [{ start: 19, end: 20 }]),
			],
		],
		[
			"Pick one \n @note{N}",
			[text(0, 11, "Pick one \n "), note(11, 21, "N", [{ start: 8, end: 11 }])],
		],
		[
			"[Pick @note{N}](u)now",
			[
				{
					kind: "link",
					start: 0,
					end: 20,
					raw: `[Pick ${marker}{N}](u)`,
					children: [text(1, 6, "Pick "), note(6, 16, "N", [{ start: 5, end: 6 }])],
					destination: { start: 18, end: 19, raw: "u", value: "u" },
				},
				text(20, 23, "now"),
			],
		],
		[
			"now~~@note{N} Pick~~",
			[
				text(0, 3, "now"),
				{
					kind: "strike",
					start: 3,
					end: 22,
					raw: `~~${marker}{N} Pick~~`,
					children: [note(5, 15, "N", [{ start: 15, end: 16 }]), text(15, 20, " Pick")],
				},
			],
		],
		[
			"Read [@note{N} the report](u) first",
			[
				text(0, 5, "Read "),
				{
					kind: "link",
					start: 5,
					end: 31,
					raw: `[${marker}{N} the report](u)`,
					children: [note(6, 16, "N", [{ start: 16, end: 17 }]), text(16, 27, " the report")],
					destination: { start: 29, end: 30, raw: "u", value: "u" },
				},
				text(31, 37, " first"),
			],
		],
	])("keeps lossless spans and owns only reference trivia in %s", (template, children) => {
		const source = template.replaceAll("@note", marker);
		expect(parse(source)).toEqual({ source, start: 0, end: source.length, children });
	});
	it.each([
		["Pick **@note{N}** one", [{ start: 4, end: 5 }]],
		["**Pick @note{N}** one", [{ start: 6, end: 7 }]],
		["Pick **@note{N}**one", undefined],
		["@circle{[==*Pick @note{N}*==]{Definition}}", [{ start: 16, end: 17 }]],
		["[~~@note{N} Pick~~](https://x.test)", [{ start: 13, end: 14 }]],
		["Pick\t\n\f\r @note{N}", [{ start: 4, end: 9 }]],
		["Pick\u00a0@note{N}", undefined],
		["Pick\u202f@note{N}", undefined],
		["Pick\u200b@note{N}", undefined],
	])("classifies transparent marks and literal spacing in %s", (template, trivia) => {
		const tree = parse(template.replaceAll("@note", marker));
		const references: InlineNode[] = [];
		const visit = (nodes: InlineNode[]) => {
			for (const node of nodes) {
				if (node.kind === "source") references.push(node);
				if ("children" in node) visit(node.children);
			}
		};
		visit(tree.children);
		expect(references).toHaveLength(1);
		expect(references[0]).toHaveProperty("kind", "source");
		expect("referenceTrivia" in references[0] ? references[0].referenceTrivia : undefined).toEqual(
			trivia,
		);
	});
	it("marks a generated note-only paragraph while preserving its literal display", () => {
		const source = `${marker}{N}`;
		const tree = inlineParagraph(parse(source));
		expect(tree).toEqual({
			source,
			start: 0,
			end: 10,
			children: [note(0, 10, "N")],
			envelope: { kind: "paragraph", generatedBy: "source" },
		});
		expect(renderInlineTree(tree)).toBe(`<p><span data-footer-content="N">${source}</span></p>`);
	});
});

describe("display node compatibility", () => {
	it("keeps nested UTF-16 spans, escaped raw text, literal code and unresolved forms", () => {
		const source = "😀 **A\\*B** `\\*` @footer{}";
		expect(parseInlineMarkdown(source)).toEqual({
			source,
			start: 0,
			end: 26,
			children: [
				text(0, 3, "😀 "),
				{
					kind: "strong",
					start: 3,
					end: 11,
					raw: "**A\\*B**",
					children: [text(5, 6, "A"), text(6, 8, "\\*", "*"), text(8, 9, "B")],
				},
				text(11, 12, " "),
				{
					kind: "code",
					start: 12,
					end: 16,
					raw: "`\\*`",
					content: { start: 13, end: 15, raw: "\\*", value: "\\*" },
				},
				text(16, 17, " "),
				{ kind: "unresolved", start: 17, end: 26, raw: "@footer{}", status: "unresolved" },
			],
		});
	});
	it.each([
		[
			"@source{Note}",
			'<span data-footer-content="Note">@source{Note}</span>',
			'<span class="praxity-doodle" data-doodle="source" data-doodle-mods="">Note</span>',
		],
		["@sources", '<span data-footer-insert="true">@sources</span>', "@sources"],
		["@footer{Note}", "@footer{Note}", '<span data-footer-content="Note">@footer{Note}</span>'],
		["@footer.insert", "@footer.insert", '<span data-footer-insert="true">@footer.insert</span>'],
	])("preserves both producers' %s divergence", (source, grammar, display) => {
		for (const interactive of [true, false]) {
			expect(renderInlineTree(tokenizeInline(source), { interactive })).toBe(grammar);
			expect(inlineMarkdown(source, { interactive })).toBe(display);
			expect(renderInlineTree(parseInlineMarkdown(source), { interactive })).toBe(display);
		}
	});
	it.each([
		[
			"[**Yes**]{Definition}",
			'<span class="inline-tooltip-trigger" data-tooltip-content="Definition"><strong>Yes</strong></span>',
			"<strong>Yes</strong> (Definition)",
		],
		["[Yes](https://x.test)", '<a href="https://x.test">Yes</a>', "Yes"],
		[
			"@circle{==Yes==} ~~No~~",
			'<span class="praxity-doodle" data-doodle="circle" data-doodle-mods=""><mark>Yes</mark></span> <del>No</del>',
			'<span class="praxity-doodle" data-doodle="circle" data-doodle-mods=""><mark>Yes</mark></span> <del>No</del>',
		],
		[
			"[Empty]{} @footer{} @icon{bad name}",
			"[Empty]{} @footer{} @icon{bad name}",
			"[Empty]{} @footer{} @icon{bad name}",
		],
		[
			String.raw`\% \< \q \* \[ \{ \@`,
			String.raw`\% \&lt; \q * [ { @`,
			String.raw`\% \&lt; \q * [ { @`,
		],
	])("retains literal HTML for %s", (source, interactiveHtml, flatHtml) => {
		expect(inlineMarkdown(source)).toBe(interactiveHtml);
		expect(inlineMarkdown(source, { interactive: false })).toBe(flatHtml);
	});
	it("keeps narration's emphasis-only interpretation", () => {
		expect(
			inlineMarkdown("`**Yes**` @footer{N} [A](url) ~~No~~ *maybe*", { emphasisOnly: true }),
		).toBe("`<strong>Yes</strong>` @footer{N} [A](url) ~~No~~ <em>maybe</em>");
	});
	it.each([
		[tokenizeInline, "@sources", 8],
		[parseInlineMarkdown, "@footer.insert", 14],
	] as const)("marks insertion envelopes at the paragraph builder for $1", (parse, source, end) => {
		expect(inlineParagraph(parse(source))).toEqual({
			source,
			start: 0,
			end,
			children: [{ kind: "sources", start: 0, end, raw: source }],
			envelope: { kind: "paragraph", generatedBy: "sources" },
		});
	});
	it.each(["", "<p></p>", "<p><br></p>", "Read @source{N}", "[@source{N}](url)", "~~@source{N}~~"])(
		"keeps material or authored envelopes for %s",
		(source) => {
			expect(inlineParagraph(tokenizeInline(source)).envelope).toEqual({ kind: "paragraph" });
		},
	);
});
