import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeLesson } from "../src/v4/lex";
import { analyzeLessonTree, type BodyDefinition, type TreeNode } from "../src/v4/tree";

// Literal declarations stand in for G4/G5. The tree owns no block/setting vocabulary.
const definitions: Record<string, BodyDefinition> = {
	note: {
		settings: { tone: { values: ["note", "info", "tip", "success", "warning"] }, icon: {} },
		settingAliases: { colour: "tone", color: "tone" },
	},
	tabs: { items: true, heading: true, itemHeading: true },
	columns: { items: true },
	accordion: { items: true, heading: true, itemHeading: true, settings: { style: {} } },
	sequence: { items: true, heading: true, itemHeading: true },
	cards: { items: true, heading: true, itemHeading: true, settings: { columns: {}, style: {} } },
	comparison: { items: true, heading: true, itemHeading: true, settings: { layout: {} } },
	group: { heading: true, parts: ["button"], settings: { mode: {} } },
	choice: {
		body: "options",
		heading: true,
		parts: ["correct", "incorrect"],
		settings: { shuffle: {} },
	},
	checklist: { body: "tasks" },
	match: { body: "pairs", heading: true, settings: { width: {}, shuffle: {} } },
	order: { body: "steps", heading: true },
	rating: { body: "steps", heading: true, settings: { scale: {} } },
	matrix: { body: "lists", heading: true },
	dialogue: { body: "turns" },
	hotspot: { body: "spots", heading: true },
	table: { body: "tables", parts: ["caption"] },
	stats: { body: "tables" },
	quote: { parts: ["speaker", "work"] },
	video: { parts: ["transcript", "caption"] },
	categorize: { items: true, heading: true, settings: { width: {}, shuffle: {} } },
	"free-response": { heading: true, parts: ["placeholder"], settings: { download: {} } },
};
const options = {
	definition: (type: string) => definitions[type],
	suggestType: (type: string) => (type === "tab" ? "tabs" : undefined),
};
const parse = (source: string) => analyzeLessonTree(tokenizeLesson(source), options);
function walk(node: TreeNode): TreeNode[] {
	return [node, ...node.children.flatMap(walk)];
}
const nodes = (source: string, kind: string) =>
	walk(parse(source).root).filter((n) => n.kind === kind);

describe("G3 every FORMAT-NEXT 6.3 row", () => {
	it.each([
		["unclosed-block", "# P\n::: note\nKeep\n# Next", { type: "note", boundaryLine: 4 }],
		["stray-closer", "# P\n:::", {}],
		["unknown-type", "# P\n::: tab T\n:: A\nKeep\n:::", { type: "tab", suggestion: "tabs" }],
		[
			"unknown-setting",
			"# P\n::: note {colour=warning}\n:::",
			{ name: "colour", type: "note", suggestion: "tone" },
		],
		[
			"bad-setting-value",
			"# P\n::: note {tone=purple}\n:::",
			{ name: "tone", value: "purple", allowed: ["note", "info", "tip", "success", "warning"] },
		],
		["stray-item", "# P\n:: Orphan", {}],
		[
			"item-before-close",
			"# P\n::: tabs\n:: A\n::: note\nKeep\n:: B\nOther\n:::",
			{ type: "note", boundaryLine: 6 },
		],
		["setting-on-body-line", "# P\n::: note\ncolor: warning\n:::", { name: "color" }],
		["mixed-option-markers", "# P\n::: choice Q\n(x) Yes\n[ ] No\n:::", { marker: "single" }],
		["content-before-page", "Before\n# P", { replacement: "# Page title" }],
		[
			"conflicting-glossary-definitions",
			"# P\n[PPE]{First}\n[PPE]{Second}",
			{ term: "PPE", firstLine: 2, secondLine: 3 },
		],
		[
			"grammar-3",
			"--- Old page\n# Old page\n## Q\nas: choice\n(x) Yes",
			{
				command:
					"pnpm --dir ../praxity-converter --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>",
			},
		],
	])("%s has a message key, arguments and source location", (code, source, args) => {
		const tree = parse(source);
		const diagnostic = tree.diagnostics.find((d) => d.code === code);
		expect(diagnostic).toBeDefined();
		expect(diagnostic?.message).toMatchObject({ key: `grammar.v4.${code}`, args });
		expect(diagnostic?.line).toBeGreaterThan(0);
		expect(diagnostic?.column).toBeGreaterThan(0);
		expect(tree.root.raw).toBe(source);
		expect(tree.root.status).toBe("unresolved");
		if (code === "grammar-3") {
			expect(tree.refused).toBe(true);
			expect(tree.root.children).toEqual([]);
		}
	});
	it("recovers an inner non-container at an outer item without stealing that item", () => {
		const tree = parse("# P\n::: tabs\n:: A\n::: note\nKeep\n:: B\nOther\n:::\n");
		const tabs = tree.root.children[0].children[0];
		expect(tabs.children.map((n) => n.subject?.value)).toEqual(["A", "B"]);
		expect(tabs.children[0].children[0].raw).toBe("::: note\nKeep\n");
	});
});

describe("G3 body ownership", () => {
	it("options own continuation and feedback, with exact editable ranges", () => {
		const source =
			"# P\r\n::: choice Q\n(x) Café 😀\r\n  continued\nfeedback:\u202FGood\r\n  more\n( ) No\n:::\n";
		const option = nodes(source, "option")[0];
		expect(option.correct).toBe(true);
		expect(option.text?.raw).toBe("Café 😀\r\n  continued");
		expect(source.slice(option.text?.range.start, option.text?.range.end)).toBe(option.text?.raw);
		expect(option.children[0].kind).toBe("part");
		expect(option.children[0].value?.raw).toBe("Good\r\n  more");
		expect(option.raw).toBe("(x) Café 😀\r\n  continued\nfeedback:\u202FGood\r\n  more\n");
	});
	it.each([
		["(x) Yes\n\nfeedback: Good", "detached-option-feedback"],
		["(x) Yes\nfeedback: First\nfeedback: Second", "duplicate-option-feedback"],
	])("never attaches or overwrites invalid feedback %s", (body, code) => {
		const tree = parse(`# P\n::: choice Q\n${body}\n( ) No\n:::`);
		expect(tree.diagnostics.map((d) => d.code)).toContain(code);
		const option = walk(tree.root).find((n) => n.kind === "option");
		expect(option?.children.filter((n) => n.kind === "part")).toHaveLength(
			code.startsWith("duplicate") ? 1 : 0,
		);
		expect(tree.root.raw).toContain(body);
	});
	it.each([
		["checklist", "- [ ] First\n- [x] Done", "task", ["First", "Done"]],
		["match", "- Risk -> Control\n- Fire -> Water", "pair", ["Risk", "Fire"]],
		["order", "3. First\n4. Second", "step", ["First", "Second"]],
		["dialogue", "- alex: Hello\n\n  More\n- sam: Hi", "turn", ["Hello\n\n  More", "Hi"]],
		["hotspot", "- Valve {x=30 y=15}\n- Pin {x=45 y=25 correct}", "spot", ["Valve", "Pin"]],
	])("%s body", (type, body, kind, labels) => {
		const tree = parse(`# P\n::: ${type} Q\n${body}\n:::`);
		expect(tree.diagnostics).toEqual([]);
		expect(
			walk(tree.root)
				.filter((n) => n.kind === kind)
				.map((n) => n.text?.value),
		).toEqual(labels);
	});
	it("pair sides, turn speaker, checked task and spot settings retain their ranges", () => {
		expect(nodes("# P\n::: match Q\n- Risk -> Control\n:::", "pair")[0].answer?.value).toBe(
			"Control",
		);
		expect(nodes("# P\n::: dialogue\n- alex: Hi\n:::", "turn")[0].speaker?.value).toBe("alex");
		expect(nodes("# P\n::: checklist\n- [x] Done\n:::", "task")[0].checked).toBe(true);
		expect(
			nodes("# P\n::: hotspot Q\n- Pin {x=45 y=25 correct}\n:::", "spot")[0].bodySettings?.map(
				(s) => [s.name, s.value.value],
			),
		).toEqual([
			["x", "45"],
			["y", "25"],
			["correct", true],
		]);
	});
	it("one ordered list starts at 3 and continues across blanks", () => {
		const source = "# P\n::: tabs\n:: A\n3. First\n\n4. Second\n\n:::\n";
		const lists = nodes(source, "list");
		expect(lists).toHaveLength(1);
		expect(lists[0].startNumber).toBe(3);
		expect(lists[0].children.map((n) => n.text?.value)).toEqual(["First", "Second"]);
		expect(lists[0].raw).toBe("3. First\n\n4. Second\n");
	});
	it("mixed markers nest at their parent content column", () => {
		const list = nodes("# P\n- Outer\n  1. Inner\n     - Deep\n- Last\n", "list")[0];
		expect(list.ordered).toBe(false);
		expect(list.children[0].children[0].ordered).toBe(true);
		expect(list.children[0].children[0].children[0].children[0].ordered).toBe(false);
		expect(list.children[1].text?.value).toBe("Last");
	});
	it("marker width controls continuation; nested order steps are errors", () => {
		const tree = parse(
			"# P\n::: order Q\n10. First\n    continued\n    1. Nested\n11. Second\n:::",
		);
		expect(tree.diagnostics.map((d) => d.code)).toContain("nested-order-list");
		expect(
			walk(tree.root)
				.filter((n) => n.kind === "step")
				.map((n) => n.text?.value),
		).toEqual(["First\n    continued", "Second"]);
		expect(nodes("# P\n10. First\n  continued\n  - nested", "list")[0].children).toHaveLength(1);
	});
	it("plain and wrapped tables own cells, escaped pipes and alignment", () => {
		const source =
			"# P\n| Name | Value |\n| :--- | ---: |\n| A\\|B | `x|y` |\n\n::: stats\n| 3x | Rate |\n:::\n";
		const tables = nodes(source, "table");
		expect(tables).toHaveLength(2);
		expect(tables[0].alignments).toEqual(["left", "right"]);
		expect(tables[0].rows?.map((r) => r.cells.map((c) => c.value))).toEqual([
			["Name", "Value"],
			["A|B", "`x|y`"],
		]);
		expect(tables[1].rows?.[0].cells.map((c) => c.value)).toEqual(["3x", "Rate"]);
		for (const table of tables)
			for (const row of table.rows ?? [])
				for (const cell of row.cells)
					expect(source.slice(cell.range.start, cell.range.end)).toBe(cell.raw);
	});
});

describe("G3 scoped headings", () => {
	it("tab A headings leave tab B and the following question unchanged", () => {
		const source =
			"# P\n::: tabs Title\n:: A\n### Local\n::: choice Nested\n(x) Yes\n( ) No\n:::\n:: B\nBody\n:::\n::: choice Following\n(x) Yes\n( ) No\n:::";
		expect(
			walk(parse(source).root)
				.filter((n) => n.headingLevel)
				.map((n) => [n.subject?.value, n.headingLevel]),
		).toEqual([
			["P", 1],
			["Title", 2],
			["A", 3],
			["Local", 3],
			["Nested", 4],
			["B", 3],
			["Following", 2],
		]);
	});
	it("a page heading sets the next block level; overrides and nested titles stop at H6", () => {
		const tree = parse(
			"# P\n## Section\n::: tabs T {level=6}\n:: A\n::: group G\n::: free-response Q\n:::\n:::\n:::",
		);
		expect(
			walk(tree.root)
				.filter((n) => n.headingLevel)
				.map((n) => n.headingLevel),
		).toEqual([1, 2, 6, 6, 6, 6]);
		expect(tree.diagnostics.filter((d) => d.code === "heading-level-clamped")).toHaveLength(3);
		expect(tree.diagnostics.every((d) => d.severity === "warning")).toBe(true);
	});
	const expected = JSON.parse(
		readFileSync(new URL("./fixtures/v4/authored-heading-levels.json", import.meta.url), "utf8"),
	) as Record<string, [string, number][]>;
	for (const [lesson, headings] of Object.entries(expected))
		it(`derived headings equal authored grammar-3 levels: ${lesson}`, () => {
			const source = readFileSync(new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url), "utf8");
			const tree = parse(source);
			expect(tree.diagnostics).toEqual([]);
			expect(
				walk(tree.root)
					.filter((n) => {
						// C2's page-boundary-metadata allowance: a folded H1 group
						// retains its title while its page also has explicit metadata.
						const first = n.children.find((child) => child.kind === "block");
						const repeatedBoundary =
							n.kind === "page" &&
							first?.type === "group" &&
							first.headingLevel === 1 &&
							first.subject?.value === n.subject?.value;
						return n.headingLevel && n.subject && !repeatedBoundary;
					})
					.map((n) => [n.subject?.value, n.headingLevel]),
			).toEqual(headings);
		});
});

describe("G3 Q1 review table", () => {
	it.each([
		[
			"nested columns",
			"::: columns\n::\n::: tabs\n:: A\n::: note\nKeep\n:::\n:: B\nOther\n:::\n:: Right\n- List\n## Heading\n:::",
			1,
			[],
		],
		["item heading", "::: tabs\n:: A\n## Subheading\nBody\n:: B\nOther\n:::", 1, []],
		["page in item", "::: tabs\n:: A\n# Subheading", 2, ["unclosed-block"]],
		["code", "```\n# literal\n:::\n```", 1, []],
		["longer fence", "````\n```\n# literal\n:::\n````", 1, []],
		["indented fence", "    ```\n# Real second page", 2, []],
		["quote shielding", "> # literal\n> :::\n> :: literal\n> ```\n> ```", 1, []],
		["setext divider", "Title\n---\nTitle\n===", 1, []],
		["blank list gap", "::: tabs\n:: A\n3. First\n\n4. Second\n:::", 1, []],
		["number width", "10. First\n  continued\n  - nested", 1, []],
		["braces", "::: note The set {pressure}\n{pressure}\n{{score}}\n:::", 1, ["unknown-setting"]],
		["bad settings", "::: note {tone = warning}\n:::", 1, ["spaces-around-equals"]],
		[
			"French colon",
			"::: video\ncaption\u202f: Attention\u00a0!\ncaption:\u202fAttention\u00a0!\n:::",
			1,
			["part-colon-spacing"],
		],
		["empty items", "::: tabs\n::\n::\n:::", 1, []],
		["unclosed block", "::: note Keep\nBody", 1, ["unclosed-block"]],
		["unknown type", "::: tab Title\n:: A\nBody\n:::", 1, ["unknown-type"]],
		[
			"option feedback",
			"::: choice Q\n(x) Yes\n\nfeedback: Good\nfeedback: More\n( ) No\n:::",
			1,
			["detached-option-feedback", "detached-option-feedback"],
		],
		[
			"parts and escape",
			"::: quote\n\\speaker: literal\n:::\n::: video\ntranscript: First\n  More\n:::",
			1,
			[],
		],
		["image escaping", "![A \\] bracket](/assets/a.png)\n![Map](/assets/a(1).png)", 1, []],
		[
			"strict extra closer",
			"::: columns\n::\n::: accordion\n:: A\nBody\n:::\n:::\n:::",
			1,
			["stray-closer"],
		],
	])("%s", (_name, body, pages, errors) => {
		const source = `# Review\n${body}`;
		const tree = parse(source);
		expect(tree.diagnostics.map((d) => d.code)).toEqual(errors);
		expect(tree.root.children.filter((n) => n.kind === "page")).toHaveLength(pages);
		expect(tree.root.raw).toBe(source);
	});
});

describe("G3 semantic boundaries", () => {
	it("optional outer table pipes need a delimiter row outside a table body", () => {
		const source = "# P\nA | B\n--- | ---\nC | D\n\nProse | words\n\n::: stats\n3x | Rate\n:::\n";
		const tables = nodes(source, "table");
		expect(tables.map((n) => n.rows?.map((r) => r.cells.map((c) => c.value)))).toEqual([
			[
				["A", "B"],
				["C", "D"],
			],
			[["3x", "Rate"]],
		]);
		expect(nodes(source, "body").map((n) => n.raw)).toEqual(["Prose | words\n"]);
	});
	it("short indents after a wide numbered marker stay prose", () => {
		const source = "# P\n10. First\n  continued\n  - nested\n";
		expect(nodes(source, "list")).toHaveLength(1);
		expect(nodes(source, "body").map((n) => n.raw)).toEqual(["  continued\n  - nested\n"]);
	});
	it("feedback paragraphs after a blank remain feedback, never option text", () => {
		const option = nodes(
			"# P\n::: choice Q\n(x) Yes\nfeedback: Good\n\n  More\n( ) No\n:::\n",
			"option",
		)[0];
		expect(option.text?.value).toBe("Yes");
		expect(option.children[0].value?.raw).toBe("Good\n\n  More");
		expect(option.children[0].raw).toBe("feedback: Good\n\n  More\n");
	});
	it("checks option markers even when a question part is misplaced", () => {
		const tree = parse("# P\n::: choice Q\n(x) Yes\ncorrect: Question feedback\n[ ] No\n:::");
		expect(tree.diagnostics.map((d) => d.code)).toEqual([
			"detached-option-feedback",
			"mixed-option-markers",
		]);
		expect(
			walk(tree.root)
				.filter((n) => n.kind === "option")
				.map((n) => n.optionKind),
		).toEqual(["single", "single"]);
	});
	it("BOM grammar-3 input refuses, shielded as lines remain content", () => {
		expect(parse("\uFEFFas: choice\n(x) Yes").refused).toBe(true);
		for (const source of [
			"# P\n```\nas: choice\n```",
			"# P\n> as: choice",
			"# P\n\\as: choice",
			"---\nas: metadata\n---\n# P",
		])
			expect(parse(source).refused).toBe(false);
	});
	it("inline code and escaped terms do not define glossary terms", () => {
		const tree = parse("# P\n`[PPE]{First}`\n\\[PPE]{Second}\n[PPE]{Real}\n[PPE]{Real}");
		expect(tree.diagnostics).toEqual([]);
	});
	it("a body setting classifier cannot suppress the grammar-3 refusal", () => {
		const tree = analyzeLessonTree(
			tokenizeLesson("# P\nas: choice", { isSettingName: (name) => name === "as" }),
			options,
		);
		expect(tree.refused).toBe(true);
		expect(tree.diagnostics[0].message.args.command).toBe(
			"pnpm --dir ../praxity-converter --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>",
		);
	});
	function ownership(source: string) {
		const tree = parse(source);
		for (const node of walk(tree.root)) {
			expect(node.raw).toBe(source.slice(node.span.start, node.span.end));
			expect(
				tree.stream.tokens
					.slice(node.span.tokenStart, node.span.tokenEnd)
					.map((t) => t.raw)
					.join(""),
			).toBe(node.raw);
			const owned =
				node.children.length || node.header
					? [
							...node.children.map((n) => n.span),
							...node.trivia,
							...[node.header, node.closer].filter((s) => s !== undefined),
						].sort((a, b) => a.start - b.start)
					: [node.span];
			let cursor = node.span.start;
			for (const part of owned) {
				expect(part.start, node.raw).toBe(cursor);
				cursor = part.end;
			}
			expect(cursor, node.raw).toBe(node.span.end);
		}
	}
	it("semantic children, trivia and headers tile the five converted lessons in every ending", () => {
		for (const lesson of [
			"leadership/00-avant-de-commencer",
			"leadership/01-affirmez-vous",
			"leadership/02-quatre-cavaliers",
			"leadership/03-resoudre-un-conflit",
			"toolkit/welcome",
		]) {
			const original = readFileSync(
				new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url),
				"utf8",
			);
			for (const ending of ["LF", "CRLF", "mixed"]) {
				let index = 0;
				ownership(
					original.replace(/\r\n|\r|\n/g, () =>
						ending === "LF" ? "\n" : ending === "CRLF" || index++ % 2 === 0 ? "\r\n" : "\n",
					),
				);
			}
		}
	});
	it("500 malformed body drafts retain exact nested ownership", () => {
		let state = 0x62a3;
		const fragments = [
			"3. First\n",
			"- Outer\n",
			"  1. Inner\n",
			"    continued\n",
			"\n",
			"(x) Yes\n",
			"feedback: Good\n",
			"  more\n",
			"[ ] No\n",
			"| A | B |\n",
			"Body\n",
			"correct: Good\n",
			"color: warning\n",
		];
		for (let count = 0; count < 500; count++) {
			let source = `# P\n::: ${["tabs", "choice", "order", "note"][count % 4]}\n`;
			if (count % 4 === 0) source += ":: A\n";
			for (let index = 0; index < count % 12; index++) {
				state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
				source += fragments[state % fragments.length];
			}
			ownership(`${source}:::\n`);
		}
	});
});
