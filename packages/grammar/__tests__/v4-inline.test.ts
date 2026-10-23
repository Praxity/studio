import { readFileSync } from "node:fs";
import { inlineMarkdown } from "@praxity/content-model/inline-markdown";
import { type InlineNode, renderInlineTree } from "@praxity/content-model/inline-tree";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { tokenizeInline } from "../src/v4/inline";
import { lineColumn, tokenizeLesson } from "../src/v4/lex";

const span = (start: number, end: number, raw: string) => ({ start, end, raw });
const text = (start: number, end: number, raw: string, value = raw) => ({
	kind: "text",
	...span(start, end, raw),
	value,
});

describe("G6 golden inline trees", () => {
	it.each([
		["Café 😀\u202F?", [text(0, 9, "Café 😀\u202F?")]],
		["**bold**", [{ kind: "strong", ...span(0, 8, "**bold**"), children: [text(2, 6, "bold")] }]],
		[
			"*italic*",
			[{ kind: "emphasis", ...span(0, 8, "*italic*"), children: [text(1, 7, "italic")] }],
		],
		[
			"~~struck~~",
			[{ kind: "strike", ...span(0, 10, "~~struck~~"), children: [text(2, 8, "struck")] }],
		],
		[
			"==marked==",
			[{ kind: "highlight", ...span(0, 10, "==marked=="), children: [text(2, 8, "marked")] }],
		],
		[
			"`**code**`",
			[
				{
					kind: "code",
					...span(0, 10, "`**code**`"),
					content: { ...span(1, 9, "**code**"), value: "**code**" },
				},
			],
		],
		[
			"[text](url)",
			[
				{
					kind: "link",
					...span(0, 11, "[text](url)"),
					children: [text(1, 5, "text")],
					destination: { ...span(7, 10, "url"), value: "url" },
				},
			],
		],
		[
			"[**PPE**]{gear}",
			[
				{
					kind: "term",
					...span(0, 15, "[**PPE**]{gear}"),
					children: [{ kind: "strong", ...span(1, 8, "**PPE**"), children: [text(3, 6, "PPE")] }],
					definition: { ...span(10, 14, "gear"), value: "gear" },
				},
			],
		],
		[
			"[PPE]{}",
			[
				{
					kind: "term",
					...span(0, 7, "[PPE]{}"),
					children: [text(1, 4, "PPE")],
					definition: { ...span(6, 6, ""), value: "" },
				},
			],
		],
		[
			"@icon{mail}",
			[
				{
					kind: "icon",
					...span(0, 11, "@icon{mail}"),
					name: { ...span(6, 10, "mail"), value: "mail" },
				},
			],
		],
		[
			"@source{NOVA}",
			[
				{
					kind: "source",
					...span(0, 13, "@source{NOVA}"),
					content: { ...span(8, 12, "NOVA"), value: "NOVA" },
				},
			],
		],
		["@sources", [{ kind: "sources", ...span(0, 8, "@sources") }]],
		[
			"{{learnerName}}",
			[
				{
					kind: "variable",
					...span(0, 15, "{{learnerName}}"),
					name: { ...span(2, 13, "learnerName"), value: "learnerName" },
				},
			],
		],
		[
			String.raw`\* \[ \{ \@ \\ \" \% \& \^ \unknown`,
			[
				text(
					0,
					35,
					String.raw`\* \[ \{ \@ \\ \" \% \& \^ \unknown`,
					'* [ { @ \\ " % & ^ \\unknown',
				),
			],
		],
	] as const)("%s", (source, children) => {
		expect(tokenizeInline(source)).toEqual({ source, start: 0, end: source.length, children });
	});
	it.each(["circle", "underline", "highlight", "box", "arrow"])("%s doodle", (name) => {
		const source = `@${name}{text}`;
		expect(tokenizeInline(source).children).toEqual([
			{
				kind: "doodle",
				...span(0, source.length, source),
				name,
				modifiers: [],
				children: [text(name.length + 2, name.length + 6, "text")],
			},
		]);
	});
	it("keeps a formatted term inside a doodle as one addressable term", () => {
		const source = "@underline.wavy{[**PPE**]{gear}}";
		expect(tokenizeInline(source).children).toEqual([
			{
				kind: "doodle",
				...span(0, 32, source),
				name: "underline",
				modifiers: ["wavy"],
				children: [
					{
						kind: "term",
						...span(16, 31, "[**PPE**]{gear}"),
						children: [
							{ kind: "strong", ...span(17, 24, "**PPE**"), children: [text(19, 22, "PPE")] },
						],
						definition: { ...span(26, 30, "gear"), value: "gear" },
					},
				],
			},
		]);
	});
	it("decodes escaped term fields once after finding their boundaries", () => {
		expect(tokenizeInline(String.raw`[a\]b]{a\{b\} \\ \unknown}`).children).toEqual([
			{
				kind: "term",
				...span(0, 26, String.raw`[a\]b]{a\{b\} \\ \unknown}`),
				children: [text(1, 5, String.raw`a\]b`, "a]b")],
				definition: { ...span(7, 25, String.raw`a\{b\} \\ \unknown`), value: "a{b} \\ \\unknown" },
			},
		]);
	});
});

describe("G6 rendering and recovery", () => {
	it("decodes every ASCII punctuation escape, preserving its raw source", () => {
		const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
		const source = Array.from(punctuation, (character) => `\\${character}`).join("");
		expect(tokenizeInline(source).children).toEqual([text(0, source.length, source, punctuation)]);
	});
	it("leaves ordinary braces literal and recognizes only valid variable names", () => {
		expect(renderInlineTree(tokenizeInline("{x} {{x}} {{with-dash}} {{123}} {{x y}}"))).toBe(
			'{x} <span data-mention="variable:x"></span> <span data-mention="variable:with-dash"></span> {{123}} {{x y}}',
		);
	});
	it.each(["mail", "mail-filled", "IconMail", "IconMailFilled"])(
		"reuses the existing %s icon contract",
		(name) => {
			const source = `Contact @icon{${name}}.`;
			expect(renderInlineTree(tokenizeInline(source))).toBe(inlineMarkdown(source));
		},
	);
	it("renders semantics even when the root source is no longer available", () => {
		const tree = tokenizeInline("[**PPE**]{gear} @underline.wavy{[docs](url)} `@icon{mail}`");
		expect(renderInlineTree({ ...tree, source: "" })).toBe(
			'<span class="inline-tooltip-trigger" data-tooltip-content="gear"><strong>PPE</strong></span> <span class="praxity-doodle" data-doodle="underline" data-doodle-mods="wavy"><a href="url">docs</a></span> <code>@icon{mail}</code>',
		);
	});
	it("keeps source-list prefixes and both source spellings in code literal", () => {
		expect(
			renderInlineTree(
				tokenizeInline("@sourcesElse `@source{x} @sources @footer{x} @footer.insert`"),
			),
		).toBe("@sourcesElse <code>@source{x} @sources @footer{x} @footer.insert</code>");
	});
	it("renders a term's formatting and resolves later mentions through a supplied course lookup", () => {
		const tree = tokenizeInline("[**PPE**]{gear} [PPE]{}");
		expect(renderInlineTree(tree, { resolveTerm: () => "gear" })).toBe(
			'<span class="inline-tooltip-trigger" data-tooltip-content="gear"><strong>PPE</strong></span> <span class="inline-tooltip-trigger" data-tooltip-content="gear">PPE</span>',
		);
		expect(renderInlineTree(tree, { interactive: false, resolveTerm: () => "gear" })).toBe(
			"<strong>PPE</strong> (gear) PPE (gear)",
		);
		expect(renderInlineTree(tokenizeInline("[**PPE**]{}"))).toBe("<strong>PPE</strong>");
	});
	it("uses existing source collector attributes with the renamed authored spelling", () => {
		expect(renderInlineTree(tokenizeInline("@source{See **docs**.} @sources"))).toBe(
			'<span data-footer-content="See **docs**.">@source{See **docs**.}</span> <span data-footer-insert="true">@sources</span>',
		);
	});
	it.each([
		"@source{}",
		"@source{unclosed",
		"@source{bad @icon{mail}}",
		"@icon{not a name}",
		"@circle{}",
		"@circle{bad @icon{mail}",
		"[PPE]{bad {nested}}",
		"[link](bad url)",
	])("keeps invalid %s opaque and unresolved", (source) => {
		expect(tokenizeInline(source).children).toEqual([
			{ kind: "unresolved", ...span(0, source.length, source), status: "unresolved" },
		]);
		expect(renderInlineTree(tokenizeInline(source))).toBe(source);
	});
	it("keeps retired source forms literal", () => {
		expect(renderInlineTree(tokenizeInline("@footer{source} @footer.insert"))).toBe(
			"@footer{source} @footer.insert",
		);
	});
	it("handles balanced destinations and escaped closers without decoding URL backslashes", () => {
		const source = String.raw`[a\]b](https://example.com/a(1)\_b)`;
		expect(renderInlineTree(tokenizeInline(source))).toBe(
			String.raw`<a href="https://example.com/a(1)\_b">a]b</a>`,
		);
	});
	it("escapes text, attributes, glossary lookups and malformed drafts", () => {
		expect(
			renderInlineTree(tokenizeInline('[<img>]{"&} [PPE]{} @circle{<script>}'), {
				resolveTerm: () => '<script>"&',
			}),
		).toBe(
			'<span class="inline-tooltip-trigger" data-tooltip-content="&quot;&amp;">&lt;img&gt;</span> <span class="inline-tooltip-trigger" data-tooltip-content="&lt;script&gt;&quot;&amp;">PPE</span> <span class="praxity-doodle" data-doodle="circle" data-doodle-mods="">&lt;script&gt;</span>',
		);
	});
});

function assertRanges(source: string, nodes: readonly InlineNode[], start: number, end: number) {
	let cursor = start;
	for (const node of nodes) {
		expect(node.start).toBe(cursor);
		expect(node.end).toBeGreaterThan(node.start);
		expect(node.raw).toBe(source.slice(node.start, node.end));
		if ("children" in node) {
			for (const child of node.children) {
				expect(child.start).toBeGreaterThan(node.start);
				expect(child.end).toBeLessThan(node.end);
			}
			if (node.children.length)
				assertRanges(source, node.children, node.children[0].start, node.children.at(-1)?.end ?? 0);
		}
		for (const field of ["content", "definition", "destination", "name"] as const) {
			if (!(field in node) || typeof node[field as keyof typeof node] === "string") continue;
			const value = (
				node as unknown as Record<string, { start: number; end: number; raw: string }>
			)[field];
			expect(value.start).toBeGreaterThan(node.start);
			expect(value.end).toBeLessThan(node.end);
			expect(value.raw).toBe(source.slice(value.start, value.end));
		}
		cursor = node.end;
	}
	expect(cursor).toBe(end);
}

describe("G6 original lesson ranges", () => {
	it("accepts G1 token spans without trimming or decoding first", () => {
		const source =
			"\uFEFF# Café 😀\r\n::: note [**PPE**]{gear} {tone=tip}\ncaption: See [docs](url)\r";
		const spans = tokenizeLesson(source).tokens.filter((token) =>
			["subject", "part-value"].includes(token.kind),
		);
		for (const range of spans) {
			const tree = tokenizeInline(source, range);
			expect(tree.start).toBe(range.start);
			expect(tree.end).toBe(range.end);
			assertRanges(source, tree.children, range.start, range.end);
		}
		const term = tokenizeInline(source, spans[1]).children[0];
		expect(lineColumn(source, term.start)).toEqual({ line: 2, column: 10 });
	});
	it.each([
		{ start: -1, end: 2 },
		{ start: 1, end: 4 },
		{ start: 2, end: 1 },
		{ start: 0.5, end: 2 },
	])("rejects invalid ranges %j", (range) => {
		expect(() => tokenizeInline("abc", range)).toThrow(RangeError);
	});
	it("accepts empty ranges and cannot close syntax outside its selected G1 span", () => {
		expect(tokenizeInline("before after", { start: 6, end: 6 })).toEqual({
			source: "before after",
			start: 6,
			end: 6,
			children: [],
		});
		const source = "[PPE]{gear} next";
		expect(tokenizeInline(source, { start: 0, end: 10 }).children).toEqual([
			{ kind: "unresolved", ...span(0, 10, "[PPE]{gear"), status: "unresolved" },
		]);
	});
	it("partitions 1,000 invalid and nested drafts without changing source", () => {
		let state = 0x6a11;
		const fragments = [
			"**",
			"*",
			"~~",
			"==",
			"`",
			"[",
			"]",
			"(",
			")",
			"{",
			"}",
			"@source{",
			"@circle{",
			"{{var}}",
			"\\",
			"Café 😀\u202F?",
			"\r\n",
			"\uD800",
			"\uFEFF",
		];
		for (let input = 0; input < 1_000; input++) {
			let source = "";
			for (let i = 0; i < 15; i++) {
				state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
				source += fragments[state % fragments.length];
			}
			const tree = tokenizeInline(source);
			assertRanges(source, tree.children, 0, source.length);
			expect(tree.children.map((node) => node.raw).join("")).toBe(source);
		}
	});
});

// Grammar-4 forms are documented in docs/prax-format/reference/inline-formatting.md.
// Translate only the source-note rename when comparing the two dialects.
function compareInline(source: string) {
	const legacy = source.replace(/@source\{/g, "@footer{").replace(/@sources\b/g, "@footer.insert");
	const converted = legacy
		.replace(/@footer\{/g, "@source{")
		.replace(/@footer\.insert/g, "@sources");
	for (const interactive of [true, false]) {
		// These assertion literals use escaped quotes absent from v3's punctuation set.
		// Exact expected values keep the dialect allowlist narrow.
		const escapedQuoteDifferences = new Map([
			[String.raw`role=\"link`, "role=&quot;link"],
			[String.raw`data-doodle=\"highlight\"`, "data-doodle=&quot;highlight&quot;"],
			[String.raw`data-doodle-mods=\"purple\"`, "data-doodle-mods=&quot;purple&quot;"],
		]);
		const expected =
			escapedQuoteDifferences.get(source) ??
			inlineMarkdown(legacy, { interactive })
				.replace(/@footer\{/g, "@source{")
				.replace(/@footer\.insert/g, "@sources");
		expect(renderInlineTree(tokenizeInline(converted), { interactive }), source).toBe(expected);
	}
}

describe("G6 compatibility corpus", () => {
	const baseline: { tag: string; sources: Record<string, string[]> } = JSON.parse(
		readFileSync(new URL("./fixtures/inline-baseline.json", import.meta.url), "utf8"),
	);
	for (const [file, literals] of Object.entries(baseline.sources)) {
		it(`matches the archived inline literals from ${file}`, () => {
			expect(baseline.tag).toBe("converter-v3-to-v4");
			expect(literals.length).toBeGreaterThan(0);
			for (const literal of literals) compareInline(literal);
		});
	}
	for (const lesson of [
		"leadership/00-avant-de-commencer",
		"leadership/01-affirmez-vous",
		"leadership/02-quatre-cavaliers",
		"leadership/03-resoudre-un-conflit",
		"toolkit/welcome",
	]) {
		it(`matches inlineMarkdown throughout converted ${lesson}`, () => {
			const original = readFileSync(
				new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url),
				"utf8",
			);
			for (const ending of ["\n", "\r\n", "\r"]) {
				const source = original.replace(/\r\n|\r|\n/g, ending);
				const stream = tokenizeLesson(source);
				for (const line of stream.lines) compareInline(source.slice(line.start, line.contentEnd));
				for (const token of stream.tokens) {
					if (
						["subject", "part-value", "prose", "quote", "image-alt", "image-source"].includes(
							token.kind,
						)
					) {
						compareInline(token.raw);
						assertRanges(source, tokenizeInline(source, token).children, token.start, token.end);
					}
				}
				for (const line of source.split(/\r\n|\r|\n/)) {
					for (const cell of line.split("|")) compareInline(cell.trim());
					compareInline(line.replace(/^\s*(?:\d+\. |[-] |\([ x]\) |\[[ x]\] )/, ""));
				}
			}
		});
	}
	for (const file of [
		"../../shared-blocks/src/__tests__/inline-preparation.test.ts",
		"../../shared-blocks/src/__tests__/page-footnotes.test.ts",
		"../../export-pipeline/src/__tests__/inline-preparation.test.ts",
		"../../export-pipeline/src/__tests__/tabler-inline-icons.test.ts",
	]) {
		it(`matches every authored inline literal in ${file}`, () => {
			const source = readFileSync(new URL(file, import.meta.url), "utf8");
			const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
			let count = 0;
			const visit = (node: ts.Node) => {
				if (
					ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node) ||
					ts.isTemplateHead(node) ||
					ts.isTemplateMiddle(node) ||
					ts.isTemplateTail(node)
				) {
					const value =
						ts.isTaggedTemplateExpression(node.parent) &&
						node.parent.tag.getText(ast) === "String.raw"
							? (node.rawText ?? node.text)
							: node.text;
					compareInline(value);
					count++;
				}
				ts.forEachChild(node, visit);
			};
			visit(ast);
			expect(count).toBeGreaterThan(0);
		});
	}
});
