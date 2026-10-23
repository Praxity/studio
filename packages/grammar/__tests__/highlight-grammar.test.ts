import { readFileSync } from "node:fs";
import schema from "learning-patterns/patterns/highlight/content.schema.json" with { type: "json" };
import { markLimit, validateContent } from "learning-patterns/patterns/highlight/logic.js";
import { describe, expect, it, vi } from "vitest";
import {
	assertCoursePracticeAdmission,
	practiceAdmissionDiagnostics,
	readLesson,
	validateCourse,
} from "../src/index";
import { BLOCK_SCHEMA, TURN_INTO, WRAP_IN } from "../src/v4/schema";

vi.mock("learning-patterns/patterns/highlight/logic.js", async (original) => {
	const library = await original<typeof import("learning-patterns/patterns/highlight/logic.js")>();
	return { ...library, validateContent: vi.fn(library.validateContent) };
});
const source = (root = "Title", chunk = "Target {key}", question = "", note = "") =>
	`# P\n::: highlight ${root}\n${question ? `${question}\n` : ""}:: ${chunk}\n${note ? `${note}\n` : ""}:::\n`;
const catalogs = Object.fromEntries(
	["en", "fr"].map((locale) => [
		locale,
		JSON.parse(
			readFileSync(
				new URL(`../../editor-core/src/messages/${locale}.json`, import.meta.url),
				"utf8",
			),
		),
	]),
);
function refusal(text: string, code: string, token: string, spanText = token) {
	const diagnostic = readLesson(text).diagnostics.find((d) => d.code === code);
	const start = text.indexOf(token);
	const prefix = text.slice(0, start).split("\n");
	expect(diagnostic).toMatchObject({
		code,
		severity: "error",
		line: prefix.length,
		column: prefix.at(-1)!.length + 1,
		span: { start, end: start + spanText.length },
	});
	for (const locale of ["en", "fr"]) {
		expect(catalogs[locale].op.diagnostic[code]).toEqual(expect.any(String));
	}
	return diagnostic!;
}
function content(text: string) {
	const read = readLesson(text);
	expect(read.diagnostics).toEqual([]);
	const block = read.blocks.find((b) => b.type === "highlight");
	expect(block).toBeDefined();
	const value = block!.data.content;
	validateContent(value);
	return value;
}
const validEN = `---
lang: en
---
# Reading evidence
::: highlight Taking a break {mode=evidence maxMarks=1}
question: Why say when you will return?
:: You need a moment to think.
note: This explains the pause, not the return time.
:: They know when to expect you. {key=true}
:: Agree on a time before leaving. {paragraph=true}
note: This is advice rather than the reason asked for.
:::
`;
const validFR = `---
lang: fr
---
# Lire les idées clés
::: highlight Une pause utile {mode=key}
question: Que faut-il retenir ?
:: Pourquoi partir ? Pour réfléchir.
note: Ce détail décrit la pause.
:: Il dit : « Je reviens à midi ! » {key=true}
:: Une heure précise réduit l'incertitude. {key=true paragraph=true}
:: Le mur est bleu.
note: Cette couleur n'explique pas l'intérêt de préciser l'heure.
:::
`;
describe("highlight literal grammar", () => {
	it.each([validEN, validFR])("compiles the contract example %#", (text) => {
		const value = content(text);
		expect(value.paragraphs.map((p) => p.length)).toEqual(text === validEN ? [2, 1] : [2, 2]);
		expect(value.mode).toBe(text === validEN ? "evidence" : "key");
		if (text === validFR) {
			expect(value.question).toBe("Que faut-il retenir ?");
			expect(value.paragraphs[0][1].text).toBe("Il dit : « Je reviens à midi ! »");
		}
		expect(new Set(value.paragraphs.flat().map((c) => c.id)).size).toBe(text === validEN ? 3 : 4);
	});
	it("resolves omitted mode, omits absent flags and maxMarks, preserves explicit false and paragraph grouping", () => {
		const value = content(
			source(
				"Title",
				"First {key paragraph=true}\n\n:: Second {key=false paragraph=false}\n:: Third {key paragraph}",
			),
		);
		expect(value).toEqual({
			mode: "key",
			title: "Title",
			paragraphs: [
				[
					{ id: expect.any(String), text: "First", key: true },
					{ id: expect.any(String), text: "Second", key: false },
				],
				[{ id: expect.any(String), text: "Third", key: true }],
			],
		});
		expect(markLimit(value)).toBe(3);
		expect(
			markLimit(content(source("Title {mode=evidence}", "Target {key}", "question: Why?"))),
		).toBe(1);
	});
	it("adds no paragraph, chunk or aggregate passage cap", () => {
		const chunks = Array.from(
			{ length: 24 },
			(_, i) => `Passage ${i} ${"x".repeat(1000)} {key paragraph}`,
		).join("\n:: ");
		const value = content(source("Title", chunks));
		expect(value.paragraphs).toHaveLength(24);
		expect(markLimit(value)).toBe(25);
	});
	it.each([1, 2, 10, 9007199254740991])(
		"leaves authored maxMarks=%s to upstream semantics",
		(max) => {
			const value = content(source(`Title {maxMarks=${max}}`, "A {key}\n:: B {key}"));
			expect(value.maxMarks).toBe(max);
			expect(markLimit(value)).toBe(max);
		},
	);
	it("decodes ASCII escapes exactly once, retains entities and nonstructural whitespace, normalizes CRLF continuations", () => {
		const value = content(
			source(
				String.raw`T \{literal} \\*`,
				String.raw`&amp; &lt; " ' \{this} \\* \d {key}`,
				"question: Why  \n  this?  ",
				"note: First  \n  next\u00a0 \n    indented  ",
			).replaceAll("\n", "\r\n"),
		);
		expect(value.title).toBe(String.raw`T {literal} \*`);
		expect(value.question).toBe("Why  \nthis?  ");
		expect(value.paragraphs[0][0]).toMatchObject({
			text: String.raw`&amp; &lt; " ' {this} \* \d`,
			note: "First  \nnext\u00a0 \n  indented  ",
		});
		expect(
			validateCourse([
				{
					path: "literal.prax",
					tree: readLesson(
						source("@icon{star} [term]{definition}", "{{x}} [^1] @footer{note} {key}"),
					).tree,
				},
			]).glossary.size,
		).toBe(0);
	});
	it.each(["😀", "e\u0301"])("counts Unicode code points inclusively for %s", (char) => {
		const fill = (n: number) => char.repeat(n / [...char].length);
		content(
			source(fill(120), `${fill(1500)} {key}`, `question: ${fill(400)}`, `note: ${fill(1500)}`),
		);
	});
	it("projects exactly the six shared settings outside literal content", () => {
		const read = readLesson(
			source(
				'Title {name=mark width=wide hide=true visible="flag is true" entrance=fade level=4 mode=key maxMarks=1}',
			),
		);
		expect(read.diagnostics).toEqual([]);
		expect(read.blocks.find((b) => b.type === "highlight")).toMatchObject({
			name: "mark",
			data: {
				level: 4,
				layoutMode: "wide",
				hide: true,
				visible: "flag is true",
				entrance: "fade",
				content: { mode: "key", maxMarks: 1 },
			},
		});
		expect(read.blocks.find((b) => b.type === "highlight")!.data).not.toHaveProperty("mode");
		expect(read.blocks.find((b) => b.type === "highlight")!.data).not.toHaveProperty("maxMarks");
		expect(Object.keys(BLOCK_SCHEMA.highlight.settings)).toEqual([
			"width",
			"name",
			"hide",
			"visible",
			"entrance",
			"level",
			"mode",
			"maxMarks",
		]);
		expect(Object.keys(BLOCK_SCHEMA.highlight.itemDefinition!.settings)).toEqual([
			"key",
			"paragraph",
		]);
		expect(TURN_INTO.highlight).toEqual([]);
		expect(WRAP_IN.highlight).not.toContain("group");
	});
	it.each([
		[source(""), "missing-subject", "::: highlight \n"],
		[source("Title", ""), "missing-subject", ":: \n"],
		[source("😀".repeat(121)), "practice-title-too-long", `::: highlight ${"😀".repeat(121)}\n`],
		[
			source("Title", `${"x".repeat(1501)} {key}`),
			"highlight-chunk-too-long",
			`:: ${"x".repeat(1501)} {key}\n`,
		],
		[
			source("Title", "Target {key}", `question: ${"x".repeat(401)}`),
			"practice-question-too-long",
			`question: ${"x".repeat(401)}\n`,
		],
		[
			source("Title", "Target {key}", "", `note: ${"x".repeat(1501)}`),
			"highlight-note-too-long",
			`note: ${"x".repeat(1501)}\n`,
		],
		["# P\n::: highlight Title\n:::\n", "child-count", "::: highlight Title\n"],
		[source("Title", "Detail"), "highlight-no-target", "::: highlight Title\n"],
		[source("Title {mode=evidence}"), "missing-part", "::: highlight Title {mode=evidence}\n"],
		[source("Title", "Target {key}", "question:"), "empty-part", "question:\n"],
		[
			source("Title", "Target {key}", "question: First\nquestion: Again"),
			"duplicate-part",
			"question: Again\n",
		],
		[source("Title", "Target {key}", "", "note:"), "empty-part", "note:\n"],
		[
			source("Title", "Target {key}", "", "note: First\nnote: Again"),
			"duplicate-part",
			"note: Again\n",
		],
		...["\u00a0Target", "Target\u00a0", "\u202fTarget"].map((chunk) => [
			source("Title", `${chunk} {key}`),
			"highlight-chunk-whitespace",
			`:: ${chunk} {key}\n`,
		]),
	])("refuses field row %# with exact span", (text, code, token) => refusal(text, code, token));
	it.each([
		"mode=Evidence",
		...["0", "-1", "1.5", "01", "1e2", "9007199254740992", '"1"'].map((v) => `maxMarks=${v}`),
	])("refuses root %s at setting", (setting) =>
		refusal(source(`Title {${setting}}`), "bad-setting-value", setting),
	);
	it.each(['key="true"', 'key="false"', 'paragraph="true"', "paragraph=1"])(
		"refuses item %s at setting",
		(setting) => refusal(source("Title", `Target {${setting}}`), "bad-setting-value", setting),
	);
	it.each([
		"scored=false",
		"required=false",
		"private=true",
		"deckGate=attempt",
		"state=x",
		"id=x",
		"commit=abc",
		'narration="Unspoken script"',
		'narrationAudio="unspoken.mp3"',
		"narrationDisabled=false",
		"narrationLanguage=fr",
		"narrationVoice=Maya",
		"narrationSpeed=1.2",
	])("refuses root %s at setting", (setting) =>
		refusal(source(`Title {${setting}}`), "unknown-setting", setting),
	);
	it("refuses item root-only settings", () =>
		refusal(source("Title", "Target {key maxMarks=2}"), "unknown-setting", "maxMarks=2"));
	it.each([
		[source("Title", "Target {key}", "note: Wrong"), "note: Wrong\n"],
		[source("Title", "Target {key}", "", "question: Wrong"), "question: Wrong\n"],
		[source("Title", "Target {key}", "", "answer: Wrong"), "answer: Wrong\n"],
		[source("Title", "Target {key}", "", "feedback: Wrong"), "feedback: Wrong\n"],
		[source("Title", "Target {key}", "Wrong prose"), "Wrong prose\n"],
		[source("Title", "Target {key}", "::: text\nNested\n:::"), "::: text\n"],
	])("refuses disallowed child %#", (text, token) => refusal(text, "disallowed-child", token));
	it("keeps root question after an item disallowed and root evidence question missing", () => {
		const text = source("Title {mode=evidence}", "Target {key}", "", "question: Late");
		refusal(text, "disallowed-child", "question: Late\n");
		refusal(text, "missing-part", "::: highlight Title {mode=evidence}\n");
	});
	it.each([
		[source("Title", "Read {this} carefully."), "settings-not-final", "{this} carefully."],
		[source("Title", "Read {key"), "missing-settings-close", "{key"],
		[source("Title", 'Read {key="true}'), "unclosed-setting-quote", '{key="true}'],
		[source("Title {mode=key mode=evidence}"), "duplicate-setting", "mode=evidence", "mode"],
		[source().replace(":::\n", ""), "unclosed-block", "::: highlight Title\n"],
	])("retains lexer/block refusal %#", (text, code, token, span) =>
		refusal(text, code, token, span),
	);
	it("preserves exact CRLF diagnostic spans", () => {
		const text = source("Title", "Target {key}", "", "note:").replaceAll("\n", "\r\n");
		refusal(text, "empty-part", "note:\r\n");
	});
	it("uses upstream schema bounds and masks an unexpected semantic exception", () => {
		expect(schema.properties.title.maxLength).toBe(120);
		vi.mocked(validateContent).mockImplementationOnce(() => {
			throw new Error("AUTHORED SECRET");
		});
		const text = source();
		refusal(text, "highlight-invalid", "::: highlight Title\n");
		vi.mocked(validateContent).mockImplementationOnce(() => {
			throw new Error("AUTHORED SECRET");
		});
		expect(JSON.stringify(readLesson(text).errors)).not.toContain("AUTHORED SECRET");
	});
	it.each(["en", "fr"])("uses the agreed %s author labels and diagnostic copy", (locale) => {
		expect(catalogs[locale].session.labels.grammar_v4_type_highlight).toBe(
			locale === "en" ? "Highlight practice" : "Exercice de surlignage",
		);
		expect(catalogs[locale].session.labels.grammar_v4_type_highlight_item).toBe("Passage");
		const read = readLesson(source("Title", "Target\u00a0 {key}"), {
			formatMessage: (m) => catalogs[locale].op.diagnostic[m.key.replace("grammar.v4.", "")],
		});
		expect(read.errors[0].message).toBe(
			locale === "en"
				? "Remove whitespace at the start and end of this passage."
				: "Retirez les espaces au début et à la fin de ce passage.",
		);
	});
});

describe("highlight placement and source course boundary", () => {
	const h = source("Title {name=mark}").slice(4);
	it.each([
		["top", h],
		["accordion", `::: accordion\n:: Panel\n${h}:::\n`],
		["tabs", `::: tabs\n:: Tab\n${h}:::\n`],
		["sequence", `::: sequence\n:: Step\n${h}:::\n`],
		["columns", `::: columns\n:: One\n${h}:: Two\nOther\n:::\n`],
		["card front", `::: cards\n:: Front\n${h}::: back\nOther\n:::\n:::\n`],
		["card back", `::: cards\n:: Front\nOther\n::: back\n${h}:::\n:::\n`],
	])("admits optional %s", (_name, text) => {
		expect(readLesson(`# P\n${text}`).diagnostics).toEqual([]);
	});
	const courseSource = (text: string) =>
		`# P\n::: accordion {name=outer}\n:: Panel\n${h}:::\n${text}`;
	const rules = (text: string) =>
		validateCourse(
			[
				{
					path: "course.prax",
					tree: readLesson(courseSource(text)).tree,
				},
			],
			{ variables: { flag: true } },
		).diagnostics;
	it.each(["mark", "@mark", "block:mark"])("refuses source alias %s and every field", (ref) => {
		for (const field of ["score", "answer", "isCompleted", "isAttempted", "anything"]) {
			const condition = `if: ${ref}.${field} is true\n`;
			const text = `::: rule\n${condition}then: disableCompletion\n:::\n`;
			const d = rules(text).find((d) => d.code === "practice-no-tracking")!;
			expect(d).toMatchObject({
				path: "course.prax",
				line: 9,
				column: 1,
				span: {
					start: courseSource(text).indexOf(condition),
					end: courseSource(text).indexOf(condition) + condition.length,
				},
			});
		}
	});
	it.each(["and", "or"])("refuses %s at its part span", (part) => {
		const text = `::: rule\nif: flag is true\n${part}: @mark.isCompleted is true\nthen: disableCompletion\n:::\n`;
		expect(rules(text).filter((d) => d.code === "practice-no-tracking")).toMatchObject([
			{
				line: 10,
				column: 1,
				span: {
					start: courseSource(text).indexOf(`${part}:`),
					end: courseSource(text).indexOf("then:"),
				},
			},
		]);
	});
	it.each(["mark", "outer"])("refuses require @%s", (target) => {
		const text = `::: rule\nif: flag is true\nthen: require @${target}\n:::\n`;
		const action = `then: require @${target}\n`;
		expect(rules(text).filter((d) => d.code === "practice-no-tracking")).toMatchObject([
			{
				line: 10,
				column: 1,
				span: {
					start: courseSource(text).indexOf(action),
					end: courseSource(text).indexOf(action) + action.length,
				},
			},
		]);
	});
	it("refuses visibility at its setting and cannot shadow practice names", () => {
		const text =
			'::: text {name=mark}\nPublic\n:::\n::: text {visible="@mark.answer is true"}\nPublic\n:::\n';
		const ds = rules(text);
		expect(ds.some((d) => d.code === "duplicate-logic-name")).toBe(true);
		expect(ds.filter((d) => d.code === "practice-no-tracking")).toMatchObject([
			{
				line: 11,
				column: 11,
				span: {
					start: courseSource(text).indexOf("visible="),
					end: courseSource(text).indexOf("visible=") + 'visible="@mark.answer is true"'.length,
				},
			},
		]);
	});
	it.each(["required", "required=true", "deckGate=attempt"])(
		"refuses ancestor %s with exact setting span",
		(setting) => {
			const text = `# P\n::: accordion {${setting}}\n:: Panel\n${h}:::\n`;
			const d = validateCourse([{ path: "a.prax", tree: readLesson(text).tree }]).diagnostics.find(
				(d) => d.code === "practice-no-tracking",
			);
			expect(d).toMatchObject({
				path: "a.prax",
				line: 2,
				column: 16,
				span: { start: 19, end: 19 + setting.length },
			});
		},
	);
	it.each([h, `::: accordion\n:: Panel\n${h}:::\n`, `::: group Inner\n${h}:::\n`])(
		"refuses group membership %# at highlight header",
		(inner) => {
			const text = `# P\n::: group Outer\n::: choice Q\n(x) Yes\n( ) No\n:::\n${inner}:::\n`;
			const d = readLesson(text).diagnostics.find(
				(d) =>
					d.code === "response-invariant" &&
					d.message.args.rule === "group-assessments-or-prose" &&
					d.span.start === text.indexOf("::: highlight"),
			);
			expect(d).toMatchObject({
				span: {
					start: text.indexOf("::: highlight"),
					end: text.indexOf("::: highlight") + "::: highlight Title {name=mark}\n".length,
				},
			});
		},
	);
	it("allows public show/hide and literal lookalikes", () => {
		expect(
			rules("::: rule\nif: flag is true\nthen: show @mark\nthen: hide @outer\n:::\n").filter(
				(d) => d.code === "practice-no-tracking",
			),
		).toEqual([]);
	});
	it("admits hidden nested runtime content while native PDF retains exact refusal coordinates", () => {
		const text = `# P\n::: accordion {hide}\n:: Panel\n${h}:::\n`;
		const ds = practiceAdmissionDiagnostics(
			[{ path: "nested.prax", read: readLesson(text) }],
			"fr",
			"native-pdf",
		);
		expect(ds).toMatchObject([
			{
				code: "highlight-native-pdf-unsupported",
				file: "nested.prax",
				line: 4,
				column: 1,
				span: { start: text.indexOf("::: highlight"), end: text.indexOf(":: Target") },
			},
		]);
		expect(() =>
			assertCoursePracticeAdmission([{ path: "nested.prax", read: readLesson(text) }]),
		).not.toThrow();
		expect(practiceAdmissionDiagnostics([{ path: "nested.prax", read: readLesson(text) }])).toEqual(
			[],
		);
	});
});
