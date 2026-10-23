import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeLesson } from "../src/v4/lex";
import * as schema from "../src/v4/schema";
import { analyzeLessonTree } from "../src/v4/tree";

const parse = (source: string) =>
	analyzeLessonTree(tokenizeLesson(source), { definition: schema.getDefinition });
const question = (type: string, body: string, settings = "") =>
	parse(`# P\n::: ${type} Question${settings}\n${body}\n:::\n`);
const codes = (tree: ReturnType<typeof parse>) => tree.diagnostics.map((d) => d.code);
const types = [
	"choice",
	"match",
	"order",
	"categorize",
	"fill-blank",
	"free-response",
	"rating",
	"matrix",
	"hotspot",
	"group",
	"checklist",
	"signature",
	"rule",
];

describe("G5 declarations through lesson analysis", () => {
	it.each(["", " {dontKnow}", " {dontKnow=true}", " {dontKnow=false}"])(
		"single choice accepts the uncertainty setting %s",
		(settings) => {
			expect(question("choice", "(x) First\n( ) Second", settings).diagnostics).toEqual([]);
		},
	);
	it.each(["true", "false"])("multiple choice rejects dontKnow=%s at its line", (value) => {
		expect(
			question("choice", "[x] First\n[ ] Second", ` {dontKnow=${value}}`).diagnostics,
		).toContainEqual(
			expect.objectContaining({
				code: "response-invariant",
				line: 2,
				message: expect.objectContaining({
					args: expect.objectContaining({ rule: "dont-know-single-only" }),
				}),
			}),
		);
	});
	it.each(["yes", "1", '"false"'])("rejects nonboolean dontKnow=%s", (value) => {
		expect(
			question("choice", "(x) First\n( ) Second", ` {dontKnow=${value}}`).diagnostics,
		).toContainEqual(expect.objectContaining({ code: "bad-setting-value", line: 2 }));
	});
	it.each(types)("%s template is a resolved lossless lesson", (type) => {
		const definition = schema.getDefinition(type);
		expect(definition).toBeDefined();
		const source = `# Example\n${definition?.insertTemplate}`;
		for (const text of [source, source.replaceAll("\n", "\r\n")]) {
			const tree = parse(text);
			expect(tree.diagnostics).toEqual([]);
			expect(tree.root.status).toBe("resolved");
			expect(tree.root.raw).toBe(text);
		}
	});
	it("two (x) options violate the single-answer invariant", () => {
		const tree = question("choice", "(x) First\n(x) Second");
		expect(codes(tree)).toContain("response-invariant");
		expect(
			tree.diagnostics.find((d) => d.code === "response-invariant")?.message.args,
		).toMatchObject({ rule: "at-most-one-correct", count: 2 });
		expect(tree.root.status).toBe("unresolved");
	});
	it("a hotspot rejects x=-50 at the spot's line", () => {
		const tree = question("hotspot", "![Map](/assets/map.png)\n- Target {x=-50 y=25 correct}");
		expect(tree.diagnostics.find((d) => d.code === "bad-setting-value")).toMatchObject({
			line: 4,
			message: { args: { name: "x", value: "-50" } },
		});
	});
	it("a hotspot image must precede its spots", () => {
		expect(
			codes(question("hotspot", "- Target {x=50 y=50 correct}\n![Map](/assets/map.png)")),
		).toContain("response-invariant");
	});
	it("group accepts fenced prose alongside an assessment", () => {
		const tree = parse(
			"# P\n::: group\n::: text\nIntroduction\n:::\n::: choice Q\n(x) Yes\n( ) No\n:::\n:::",
		);
		expect(tree.diagnostics).toEqual([]);
	});
	it("dialogue to text declares speaker loss and matrix to choice declares scale loss", () => {
		expect(schema.TURN_INTO.dialogue).toContainEqual(
			expect.objectContaining({
				target: "text",
				losses: expect.arrayContaining(["turn-speakers"]),
			}),
		);
		expect(schema.TURN_INTO.matrix).toContainEqual(
			expect.objectContaining({
				target: "choice",
				losses: expect.arrayContaining(["scale-labels"]),
			}),
		);
	});
	it.each([
		["choice", "(x) One", "", "child-count"],
		["choice", "(x)\n( ) Two", "", "response-invariant"],
		["match", "- A -> B", "", "child-count"],
		["match", "- A -> B\n- C ->", "", "response-invariant"],
		["order", "1. One", "", "response-invariant"],
		["categorize", ":: A\n- One", "", "child-count"],
		["categorize", ":: A\n:: B\n- Two", "", "response-invariant"],
		["fill-blank", "No blanks", "", "response-invariant"],
		["fill-blank", "Choose {red|blue}", " {style=dropdown}", "response-invariant"],
		["fill-blank", "Choose {*red}", " {style=dropdown}", "response-invariant"],
		["fill-blank", "Choose {*red|red}", " {style=dropdown}", "response-invariant"],
		["fill-blank", "Use {red}\nbank: blue", " {style=word-bank}", "response-invariant"],
		["fill-blank", "Use {red} and {red}\nbank: red", " {style=word-bank}", "response-invariant"],
		["fill-blank", "Write ____", " {feedbackMode=reveal}", "response-invariant"],
		["rating", "", " {scale=11}", "bad-setting-value"],
		["rating", "", " {scale=1}", "bad-setting-value"],
		["rating", "", "", "response-invariant"],
		["rating", "1. Low\n2. High", " {scale=3}", "response-invariant"],
		["matrix", "1. Low\n2. High", "", "response-invariant"],
		["hotspot", "![Map](/assets/map.png)\n- A {x=101 y=10 correct}", "", "bad-setting-value"],
		[
			"hotspot",
			"![Map](/assets/map.png)\n- A {x=10 y=10 w=0 h=20 shape=rect correct}",
			"",
			"bad-setting-value",
		],
		[
			"hotspot",
			"![Map](/assets/map.png)\n- A {x=10 y=10 shape=ellipse correct}",
			"",
			"response-invariant",
		],
		[
			"hotspot",
			'![Map](/assets/map.png)\n- A {shape=polygon points="0 0, 10 10" correct}',
			"",
			"bad-setting-value",
		],
		["hotspot", "![Map](/assets/map.png)\n- A {x=0 y=100}", "", "response-invariant"],
		["group", "Text only", " {passingScore=101}", "bad-setting-value"],
		["group", "Text only", "", "response-invariant"],
		["checklist", "Text only", "", "child-count"],
		["signature", "", " {mode=invalid}", "bad-setting-value"],
		["rule", "if: ready", "", "response-invariant"],
		["rule", "then: show @target\nif: ready", "", "response-invariant"],
	])("rejects %s %s %s with %s", (type, body, settings, code) => {
		const tree = question(type, body, settings);
		expect(codes(tree)).toContain(code);
		expect(tree.root.status).toBe("unresolved");
		expect(tree.root.raw).toContain(body);
	});
	it.each([
		["choice", "( ) First\n( ) Second", ""],
		["choice", "[ ] First\n[ ] Second", ""],
		["choice", "[x] First\n[x] Second", ""],
		["fill-blank", "Choose {*red|blue}", " {style=dropdown}"],
		["fill-blank", "Use {red} and {red}\nbank: red | red", " {style=word-bank}"],
		["fill-blank", "Write ____", ""],
		["rating", "", " {scale=2}"],
		["rating", "", " {scale=10}"],
		["matrix", "1. Low\n2. High\n- First\n- Second", ""],
		["hotspot", "![Map](/assets/map.png)\n- Target {x=0 y=100 correct}", ""],
		[
			"hotspot",
			'![Map](/assets/map.png)\n- Target {shape=polygon points="0 0, 100 0, 100 100" correct}',
			"",
		],
	])("accepts %s boundaries and answers with body %s and settings %s", (type, body, settings) => {
		expect(question(type, body, settings).diagnostics).toEqual([]);
	});
	it("does not mistake variables, terms, code or escaped braces for blanks", () => {
		const tree = question("fill-blank", "{{score}} [PPE]{Equipment} `{code}` \\{literal\\}");
		expect(codes(tree)).toContain("response-invariant");
	});
	it.each(["points=-1", "attempts=1.5", "pointsOverride=-1", "passingScore=-1"])(
		"rejects numeric setting %s",
		(setting) => {
			const type =
				setting.startsWith("pointsOverride") || setting.startsWith("passingScore")
					? "group"
					: "choice";
			expect(codes(question(type, "(x) Yes\n( ) No", ` {${setting}}`))).toContain(
				"bad-setting-value",
			);
		},
	);
	it.each([
		"leadership/00-avant-de-commencer",
		"leadership/01-affirmez-vous",
		"leadership/02-quatre-cavaliers",
		"leadership/03-resoudre-un-conflit",
		"toolkit/welcome",
	])("resolves all declarations in %s", (lesson) => {
		const source = readFileSync(new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url), "utf8");
		expect(parse(source).diagnostics).toEqual([]);
	});
});

describe("G5 course checks and editor declarations", () => {
	it("reads lesson variables and styles from frontmatter and preserves both trees", () => {
		const tree = parse(
			'---\nvariables:\n  ready: true\npageStyles:\n  calm: {}\n---\n# A {style=calm}\n{{ready}}\n::: note {visible="ready"}\nText\n:::',
		);
		const before = JSON.stringify(tree.root);
		expect(schema.validateCourse([{ path: "lesson", tree }]).diagnostics).toEqual([]);
		expect(JSON.stringify(tree.root)).toBe(before);
	});
	it("refuses malformed frontmatter and unknown page styles", () => {
		const result = schema.validateCourse([
			{ path: "lesson", tree: parse("---\nvariables: [wrong]\n---\n# A {style=missing}") },
		]);
		expect(result.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining(["invalid-course-metadata", "unknown-page-style"]),
		);
	});
	it("uses formatted same-lesson term labels and reports exactly one conflict", () => {
		const result = schema.validateCourse([
			{ path: "lesson", tree: parse("# A\n[**PPE**]{First}\n[PPE]{Second}\n[PPE]{}") },
		]);
		expect(
			result.diagnostics.filter((d) => d.code === "conflicting-glossary-definitions"),
		).toHaveLength(1);
		expect(result.glossary.get("PPE")?.definition).toBe("First");
		expect(result.diagnostics.filter((d) => d.code === "undefined-glossary-term")).toEqual([]);
	});
	it("retains the first repeated identical definition and ignores literals and reference destinations", () => {
		const result = schema.validateCourse([
			{
				path: "lesson",
				tree: parse(
					"# A\n[PPE]{Equipment}\n[**PPE**]{Equipment}\n`[Fake]{One}` [Go](https://example.com/{{absent}})\n$$\n[Math]{Two}\n$$",
				),
			},
		]);
		expect(result.diagnostics).toEqual([]);
		expect([...result.glossary.keys()]).toEqual(["PPE"]);
	});
	it("course checks do not scan fill-blank answers as glossary definitions", () => {
		const result = schema.validateCourse([
			{ path: "lesson", tree: parse("# A\n::: fill-blank Q\nSupply {[PPE]{answer}}\n:::") },
		]);
		expect(result.glossary.size).toBe(0);
	});
	it("emits one inline variable diagnostic for a multiline option", () => {
		const result = schema.validateCourse([
			{
				path: "lesson",
				tree: parse("# A\n::: choice Q\n(x) First\n  {{missing}}\n( ) Other\n:::"),
			},
		]);
		expect(result.diagnostics.filter((d) => d.code === "unknown-logic-name")).toHaveLength(1);
	});
	it.each([
		"if: ready\nand: other\nor: another\nthen: show @target",
		"if: ready\nthen: typpo @target",
		"if: ready\nthen: show @bad_name",
		"if: ready\nthen: disableCompletion because nope",
	])("refuses malformed rule parts %s", (body) => {
		expect(codes(parse(`# A\n::: rule\n${body}\n:::`))).toContain("response-invariant");
	});
	it("wrap declarations agree with target child policy", () => {
		for (const [source, targets] of Object.entries(schema.WRAP_IN)) {
			if (targets.includes("group"))
				expect([
					...schema.ASSESSMENT_TYPES,
					"text",
					"heading",
					"image",
					"divider",
					"table",
				]).toContain(source);
		}
	});
	it("conflicting course definitions name both files and UTF-16 lines", () => {
		const lessons = [
			{ path: "a.prax", tree: parse("# A\r\n[**PPE**]{First}") },
			{ path: "b.prax", tree: parse("# B\nText\n[PPE]{Second}") },
		];
		const result = schema.validateCourse(lessons);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "conflicting-glossary-definitions",
				path: "b.prax",
				line: 3,
				message: {
					key: "grammar.v4.conflicting-glossary-definitions",
					args: expect.objectContaining({
						term: "PPE",
						firstPath: "a.prax",
						firstLine: 2,
						secondPath: "b.prax",
						secondLine: 3,
					}),
				},
			}),
		);
	});
	it("resolves mentions across lessons and ignores code and settings", () => {
		const result = schema.validateCourse(
			[
				{
					path: "a",
					tree: parse('# A\n[PPE]{}\n```\n[Fake]{One}\n```\n::: note {visible="ready"}\nText\n:::'),
				},
				{ path: "b", tree: parse("# B\n[PPE]{Equipment}") },
			],
			{ variables: { ready: true } },
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.glossary.get("PPE")?.definition).toBe("Equipment");
		expect(result.glossary.has("Fake")).toBe(false);
	});
	it("reports unknown glossary, cast, variables and logic targets plus duplicate names", () => {
		const source =
			'# A\n[Missing]{} {{unknown}}\n::: dialogue\n- ghost: Hello\n:::\n::: note {name=target visible="absent"}\n::: \n::: note {name=target}\n:::\n::: rule\nif: block:missing.result is "correct"\nthen: show @lost\nthen: set counter = 1\n:::\n';
		const result = schema.validateCourse([{ path: "lesson", tree: parse(source) }], { cast: {} });
		expect(result.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining([
				"undefined-glossary-term",
				"unknown-cast-speaker",
				"unknown-logic-name",
				"duplicate-logic-name",
			]),
		);
		expect(
			result.diagnostics
				.filter((d) => d.code === "unknown-logic-name")
				.map((d) => d.message.args.name),
		).toEqual(expect.arrayContaining(["unknown", "absent", "missing", "lost", "counter"]));
	});
	it("accepts forward block references, cast keys, variables and ordered rule parts", () => {
		const source =
			'# A\n::: rule\nif: block:answer.result isNot "correct"\nthen: show @followUp\nthen: set ready = true\n:::\n::: choice Q {name=answer}\n(x) Yes\n( ) No\n:::\n::: note {name=followUp visible="ready"}\n{{ready}}\n:::\n::: dialogue\n- alex: Hello\n:::\n';
		expect(
			schema.validateCourse([{ path: "lesson", tree: parse(source) }], {
				cast: { alex: { name: "Alex" } },
				variables: { ready: false },
			}).diagnostics,
		).toEqual([]);
	});
	it("every schema type has explicit Turn-into and Wrap-in declarations and valid targets", () => {
		expect(Object.keys(schema.TURN_INTO)).toEqual(Object.keys(schema.BLOCK_SCHEMA));
		expect(Object.keys(schema.WRAP_IN)).toEqual(Object.keys(schema.BLOCK_SCHEMA));
		for (const [source, conversions] of Object.entries(schema.TURN_INTO)) {
			for (const conversion of conversions) {
				expect(
					schema.getDefinition(conversion.target),
					`${source} -> ${conversion.target}`,
				).toBeDefined();
				expect(conversion.target).not.toBe(source);
				expect(Array.isArray(conversion.losses)).toBe(true);
				expect(typeof conversion.losesAnswers).toBe("boolean");
			}
		}
		for (const targets of Object.values(schema.WRAP_IN))
			for (const target of targets) expect(schema.getDefinition(target)).toBeDefined();
		expect(schema.TURN_INTO.choice).toContainEqual(
			expect.objectContaining({ target: "rating", losesAnswers: true }),
		);
		expect(schema.TURN_INTO.note).toContainEqual(
			expect.objectContaining({
				target: "quote",
				losses: expect.arrayContaining(["subject", "setting:icon"]),
			}),
		);
		for (const source of ["accordion", "tabs", "sequence", "cards"])
			for (const target of ["accordion", "tabs", "sequence", "cards"].filter((t) => t !== source))
				expect(schema.TURN_INTO[source]).toContainEqual(expect.objectContaining({ target }));
	});
	it("published blocks.json carries the generated G4/G5 declarations", () => {
		const published = JSON.parse(
			readFileSync(
				new URL("../../../docs/prax-format/reference/blocks.json", import.meta.url),
				"utf8",
			),
		);
		expect(published).toEqual(schema.generateBlocksIndex());
		expect(published.blocks.map((b: { id: string }) => b.id)).toEqual(
			Object.keys(schema.BLOCK_SCHEMA),
		);
	});
});
