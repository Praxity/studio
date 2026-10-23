import { parseInlineMarkdown } from "@praxity/content-model/inline-markdown";
import { type InlineNode, inlineParagraph } from "@praxity/content-model/inline-tree";
import { describe, expect, it } from "vitest";
import { tokenizeInline } from "../src/v4/inline";

describe.each([
	{ name: "grammar", parse: tokenizeInline },
	{ name: "display", parse: parseInlineMarkdown },
])("$name whole ancillary ownership", ({ parse }) => {
	it.each([
		[
			"Pick ==X== one",
			[
				{ kind: "text", start: 0, end: 5, raw: "Pick ", value: "Pick " },
				{
					kind: "highlight",
					start: 5,
					end: 10,
					raw: "==X==",
					children: [{ kind: "text", start: 7, end: 8, raw: "X", value: "X" }],
					referenceTrivia: [{ start: 4, end: 5 }],
				},
				{ kind: "text", start: 10, end: 14, raw: " one", value: " one" },
			],
		],
		[
			"Pick @circle{X} one",
			[
				{ kind: "text", start: 0, end: 5, raw: "Pick ", value: "Pick " },
				{
					kind: "doodle",
					start: 5,
					end: 15,
					raw: "@circle{X}",
					name: "circle",
					modifiers: [],
					children: [{ kind: "text", start: 13, end: 14, raw: "X", value: "X" }],
					referenceTrivia: [{ start: 4, end: 5 }],
				},
				{ kind: "text", start: 15, end: 19, raw: " one", value: " one" },
			],
		],
		[
			"Pick [X]{D} one",
			[
				{ kind: "text", start: 0, end: 5, raw: "Pick ", value: "Pick " },
				{
					kind: "term",
					start: 5,
					end: 11,
					raw: "[X]{D}",
					children: [{ kind: "text", start: 6, end: 7, raw: "X", value: "X" }],
					definition: { start: 9, end: 10, raw: "D", value: "D" },
					referenceTrivia: [{ start: 4, end: 5 }],
				},
				{ kind: "text", start: 11, end: 15, raw: " one", value: " one" },
			],
		],
	])("retains the entire literal tree for %s", (source, children) => {
		expect(parse(source)).toEqual({ source, start: 0, end: source.length, children });
	});
	describe.each([
		{ kind: "highlight", spelling: "==X==", endGap: 5, linkGap: 6, strikeGap: 7 },
		{ kind: "doodle", spelling: "@circle{X}", endGap: 10, linkGap: 11, strikeGap: 12 },
		{ kind: "term", spelling: "[X]{D}", endGap: 6, linkGap: 7, strikeGap: 8 },
	])("$kind", ({ kind, spelling, endGap, linkGap, strikeGap }) => {
		it.each([
			["Pick @mark", [{ start: 4, end: 5 }]],
			["@mark Pick", [{ start: endGap, end: endGap + 1 }]],
			["Pick @mark one", [{ start: 4, end: 5 }]],
			["Pick@markone", undefined],
			["Pick @mark[one](url)", undefined],
			["Pick@mark one", undefined],
			["[Pick @mark](url)", [{ start: 5, end: 6 }]],
			["[@mark Pick](url)", [{ start: linkGap, end: linkGap + 1 }]],
			["[Pick @mark one](url)", [{ start: 5, end: 6 }]],
			["[Pick @mark](url)now", [{ start: 5, end: 6 }]],
			["[Pick *@mark*](url)", [{ start: 5, end: 6 }]],
			["[Pick **@mark**](url)", [{ start: 5, end: 6 }]],
			["Read [@mark the report](url) first", [{ start: linkGap + 5, end: linkGap + 6 }]],
			["~~Pick @mark~~", [{ start: 6, end: 7 }]],
			["~~@mark Pick~~", [{ start: strikeGap, end: strikeGap + 1 }]],
			["~~Pick @mark one~~", [{ start: 6, end: 7 }]],
			["now~~@mark Pick~~", [{ start: strikeGap + 3, end: strikeGap + 4 }]],
			["~~*@mark* Pick~~", [{ start: endGap + 4, end: endGap + 5 }]],
			["~~**@mark** Pick~~", [{ start: endGap + 6, end: endGap + 7 }]],
			["**Pick *A @mark* one**", [{ start: 9, end: 10 }]],
			["Pick\u00a0@mark", undefined],
			["Pick\u202f@mark", undefined],
		])("owns only the ancillary separator in %s", (template, trivia) => {
			const source = template.replace("@mark", spelling);
			const annotations: InlineNode[] = [];
			const visit = (nodes: InlineNode[]) => {
				for (const node of nodes) {
					if (node.kind === kind) annotations.push(node);
					if ("children" in node) visit(node.children);
				}
			};
			visit(parse(source).children);
			expect(annotations).toHaveLength(1);
			expect(
				"referenceTrivia" in annotations[0] ? annotations[0].referenceTrivia : undefined,
			).toEqual(trivia);
		});
		it("marks its whole-element-only generated paragraph", () => {
			expect(inlineParagraph(parse(spelling)).envelope).toEqual({
				kind: "paragraph",
				generatedBy: kind,
			});
			expect(inlineParagraph(parse(`**${spelling}**`)).envelope).toEqual({
				kind: "paragraph",
				generatedBy: kind,
			});
			expect(inlineParagraph(parse(`*${spelling}*`)).envelope).toEqual({
				kind: "paragraph",
				generatedBy: kind,
			});
			expect(inlineParagraph(parse(`\u00a0${spelling}`)).envelope).toEqual({ kind: "paragraph" });
			expect(inlineParagraph(parse(`**Material** ${spelling}`)).envelope).toEqual({
				kind: "paragraph",
			});
			expect(inlineParagraph(parse(`*Material* ${spelling}`)).envelope).toEqual({
				kind: "paragraph",
			});
		});
		it("owns runs and both edges while preserving the only material gap", () => {
			const references = (source: string) => {
				const nodes = parse(source).children.filter((node) => node.kind === kind);
				expect(nodes).toHaveLength(2);
				return nodes.map((node) => ("referenceTrivia" in node ? node.referenceTrivia : undefined));
			};
			expect(references(`Pick ${spelling} ${spelling} one`)).toEqual([
				[{ start: 4, end: 5 }],
				[{ start: endGap + 5, end: endGap + 6 }],
			]);
			expect(references(`Pick${spelling} ${spelling} one`)).toEqual([
				undefined,
				[{ start: endGap + 4, end: endGap + 5 }],
			]);
			expect(references(`${spelling} Pick one ${spelling}`)).toEqual([
				[{ start: endGap, end: endGap + 1 }],
				[{ start: endGap + 9, end: endGap + 10 }],
			]);
		});
	});
	it.each([
		[
			"[Pick *==b==*](u)",
			{
				kind: "link",
				start: 0,
				end: 17,
				raw: "[Pick *==b==*](u)",
				children: [
					{ kind: "text", start: 1, end: 6, raw: "Pick ", value: "Pick " },
					{
						kind: "emphasis",
						start: 6,
						end: 13,
						raw: "*==b==*",
						children: [
							{
								kind: "highlight",
								start: 7,
								end: 12,
								raw: "==b==",
								children: [{ kind: "text", start: 9, end: 10, raw: "b", value: "b" }],
								referenceTrivia: [{ start: 5, end: 6 }],
							},
						],
					},
				],
				destination: { start: 15, end: 16, raw: "u", value: "u" },
			},
		],
		[
			"[Pick **==b==**](u)",
			{
				kind: "link",
				start: 0,
				end: 19,
				raw: "[Pick **==b==**](u)",
				children: [
					{ kind: "text", start: 1, end: 6, raw: "Pick ", value: "Pick " },
					{
						kind: "strong",
						start: 6,
						end: 15,
						raw: "**==b==**",
						children: [
							{
								kind: "highlight",
								start: 8,
								end: 13,
								raw: "==b==",
								children: [{ kind: "text", start: 10, end: 11, raw: "b", value: "b" }],
								referenceTrivia: [{ start: 5, end: 6 }],
							},
						],
					},
				],
				destination: { start: 17, end: 18, raw: "u", value: "u" },
			},
		],
	])("keeps literal separator ownership across emphasis in %s", (source, link) => {
		expect(parse(source)).toEqual({ source, start: 0, end: source.length, children: [link] });
	});
	it.each([
		["*==a==*", "highlight"],
		["**==a==**", "highlight"],
		["*@circle{a}* ==b==", "doodle"],
		["**@circle{a}** ==b==", "doodle"],
	])("retains the ancillary-only emphasis envelope in %s", (source, generatedBy) => {
		expect(inlineParagraph(parse(source)).envelope).toEqual({ kind: "paragraph", generatedBy });
	});
	it("retains the literal NBSP separating two ancillary nodes as material", () => {
		const source = "==a==\u00a0==b==";
		expect(inlineParagraph(parse(source))).toEqual({
			source,
			start: 0,
			end: 11,
			children: [
				{
					kind: "highlight",
					start: 0,
					end: 5,
					raw: "==a==",
					children: [{ kind: "text", start: 2, end: 3, raw: "a", value: "a" }],
				},
				{ kind: "text", start: 5, end: 6, raw: "\u00a0", value: "\u00a0" },
				{
					kind: "highlight",
					start: 6,
					end: 11,
					raw: "==b==",
					children: [{ kind: "text", start: 8, end: 9, raw: "b", value: "b" }],
				},
			],
			envelope: { kind: "paragraph" },
		});
	});
	it.each([
		["[Pick ==aside==](url)", "highlight", [{ start: 5, end: 6 }]],
		["[==aside== Pick](url)", "highlight", [{ start: 10, end: 11 }]],
		["[Pick @circle{aside}](url)", "doodle", [{ start: 5, end: 6 }]],
		["[@circle{aside} Pick](url)", "doodle", [{ start: 15, end: 16 }]],
		["[Pick [aside]{Definition}](url)", "term", [{ start: 5, end: 6 }]],
		["[[aside]{Definition} Pick](url)", "term", [{ start: 20, end: 21 }]],
	])("retains the reviewed boundary for %s", (source, kind, referenceTrivia) => {
		const link = parse(source).children[0];
		expect(link.kind).toBe("link");
		const annotation = "children" in link && link.children.find((node) => node.kind === kind);
		expect(annotation).toMatchObject({ kind, referenceTrivia });
	});
	it.each([
		["==Yes==", "highlight", 7],
		["@circle{Yes}", "doodle", 12],
		["[Yes]{Definition}", "term", 17],
	] as const)(
		"distinguishes a whole option label from a partial %s mark without a policy",
		(source, kind, end) => {
			const spans = (source: string) =>
				parse(source).children.map(({ kind, start, end }) => ({ kind, start, end }));
			expect(spans(source)).toEqual([{ kind, start: 0, end }]);
			expect(spans(`${source} now`)).toEqual([
				{ kind, start: 0, end },
				{ kind: "text", start: end, end: end + 4 },
			]);
		},
	);
	it.each([
		["==Pick one==", "==Pick== one", "highlight", 12, 8],
		["@circle{Pick one}", "@circle{Pick} one", "doodle", 17, 13],
		["[Pick one]{Definition}", "[Pick]{Definition} one", "term", 22, 18],
	] as const)(
		"keeps whole and partial stem spans addressable for %s",
		(whole, partial, kind, end, partialEnd) => {
			const wholeTree = inlineParagraph(parse(whole));
			const partialTree = inlineParagraph(parse(partial));
			const spans = (tree: typeof wholeTree) =>
				tree.children.map(({ kind, start, end }) => ({ kind, start, end }));
			expect(spans(wholeTree)).toEqual([{ kind, start: 0, end }]);
			expect(spans(partialTree)).toEqual([
				{ kind, start: 0, end: partialEnd },
				{ kind: "text", start: partialEnd, end },
			]);
			expect(wholeTree.source).toBe(whole);
			expect(partialTree.source).toBe(partial);
		},
	);
	it("marks mixed ancillary-only envelopes and retains authored or material ones", () => {
		const footnote = parse === tokenizeInline ? "@source{N}" : "@footer{N}";
		expect(
			inlineParagraph(parse(`==aside== @circle{other} [term]{Definition} ${footnote}`)).envelope,
		).toEqual({ kind: "paragraph", generatedBy: "highlight" });
		for (const source of [
			"<p></p>",
			"<p><br></p>",
			"[==aside==](url)",
			"~~==aside==~~",
			"**Material**",
			"*Material*",
		])
			expect(inlineParagraph(parse(source)).envelope).toEqual({ kind: "paragraph" });
	});
	it("classifies mixed ancillary runs as one run without taking the final material gap", () => {
		const tree = parse("Pick ==X== @circle{Y} [Z]{D} one");
		expect(tree.children).toEqual([
			{ kind: "text", start: 0, end: 5, raw: "Pick ", value: "Pick " },
			{
				kind: "highlight",
				start: 5,
				end: 10,
				raw: "==X==",
				children: [{ kind: "text", start: 7, end: 8, raw: "X", value: "X" }],
				referenceTrivia: [{ start: 4, end: 5 }],
			},
			{ kind: "text", start: 10, end: 11, raw: " ", value: " " },
			{
				kind: "doodle",
				start: 11,
				end: 21,
				raw: "@circle{Y}",
				name: "circle",
				modifiers: [],
				children: [{ kind: "text", start: 19, end: 20, raw: "Y", value: "Y" }],
				referenceTrivia: [{ start: 10, end: 11 }],
			},
			{ kind: "text", start: 21, end: 22, raw: " ", value: " " },
			{
				kind: "term",
				start: 22,
				end: 28,
				raw: "[Z]{D}",
				children: [{ kind: "text", start: 23, end: 24, raw: "Z", value: "Z" }],
				definition: { start: 26, end: 27, raw: "D", value: "D" },
				referenceTrivia: [{ start: 21, end: 22 }],
			},
			{ kind: "text", start: 28, end: 32, raw: " one", value: " one" },
		]);
	});
});
