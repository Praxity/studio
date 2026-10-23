import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import schema from "learning-patterns/patterns/retrieval-sheet/content.schema.json" with {
	type: "json",
};
import { validateContent } from "learning-patterns/patterns/retrieval-sheet/logic.js";
import { describe, expect, it, vi } from "vitest";
import { retrievalSheetDiagnosticMessage } from "../src/practice-diagnostics";
import { readLesson } from "../src/read-lesson";
import { tokenizeLesson } from "../src/v4/lex";
import {
	BLOCK_SCHEMA,
	getDefinition,
	retrievalSheetContent,
	TURN_INTO,
	validateCourse,
	WRAP_IN,
} from "../src/v4/schema";
import { createTransientIdAllocator } from "../src/v4/to-blocks";
import { analyzeLessonTree, type TreeNode } from "../src/v4/tree";

vi.mock("learning-patterns/patterns/retrieval-sheet/logic.js", async (importOriginal) => {
	const library =
		await importOriginal<typeof import("learning-patterns/patterns/retrieval-sheet/logic.js")>();
	return { ...library, validateContent: vi.fn(library.validateContent) };
});
const catalogs = Object.fromEntries(
	["en", "fr"].map((locale) => [
		locale,
		JSON.parse(
			readFileSync(
				new URL(`../../editor-core/src/messages/${locale}.json`, import.meta.url),
				"utf8",
			),
		).op.diagnostic,
	]),
);
const format = (locale: string, code: string, args: Record<string, unknown>) => {
	const key = code;
	return catalogs[locale][key].replace(/\{(\w+)\}/g, (_match: string, name: string) =>
		String(args[name] ?? ""),
	);
};
const source = (title = "Title", question = "Question", answer = "Answer", settings = "") =>
	`# P\n::: retrieval-sheet${title ? ` ${title}` : ""}${settings ? ` {${settings}}` : ""}\n::${question ? ` ${question}` : ""}\nanswer:${answer ? ` ${answer}` : ""}\n:::\n`;
const grammar = (text: string) =>
	analyzeLessonTree(tokenizeLesson(text), { definition: getDefinition });
const sheet = (node: TreeNode): TreeNode | undefined =>
	node.type === "retrieval-sheet" ? node : node.children.map(sheet).find(Boolean);
const content = (text: string, ids = createTransientIdAllocator()) => {
	const node = sheet(grammar(text).root);
	if (!node) throw new Error("Missing retrieval-sheet fixture");
	return retrievalSheetContent(node, ids);
};
const errors = (text: string) =>
	readLesson(text).diagnostics.map((d) => ({ code: d.code, line: d.line, column: d.column }));
const validEN = `---\nlang: en\n---\n# Recall later\n::: retrieval-sheet Design approaches\n:: What does universal design consider?\nanswer: Diverse users from the start.\n:: What does an accommodation address?\nanswer: An individual's access need.\n:::\n`;
const validFR = `---\nlang: fr\n---\n# Rappel ultérieur\n::: retrieval-sheet Approches de conception\n:: Que prévoit la conception universelle ?\nanswer: La diversité des personnes dès le départ.\n:: À quoi répond une adaptation ?\nanswer: Au besoin d'accès d'une personne.\n:::\n`;
const copy = {
	"missing-subject": [
		"The block needs a title or subject",
		"Le bloc nécessite un titre ou un sujet",
	],
	"practice-title-too-long": [
		"Keep the title to 120 Unicode code points or fewer.",
		"Limitez le titre à 120 points de code Unicode.",
	],
	"practice-question-too-long": [
		"Keep the question to 400 Unicode code points or fewer.",
		"Limitez la question à 400 points de code Unicode.",
	],
	"practice-answer-too-long": [
		"Keep the answer to 1500 Unicode code points or fewer.",
		"Limitez la réponse à 1500 points de code Unicode.",
	],
	"child-count": [
		"The block has the wrong number of items",
		"Le bloc n’a pas le bon nombre d’éléments",
	],
	"missing-part": ["Add the required answer: part", "Ajoutez la partie obligatoire answer:"],
	"empty-part": ["The answer: part must contain text", "La partie answer: doit contenir du texte"],
	"duplicate-part": [
		"Write the answer: part only once",
		"Écrivez la partie answer: une seule fois",
	],
	"disallowed-child": [
		"This content is not allowed in its parent",
		"Ce contenu n’est pas autorisé dans son parent",
	],
	"unknown-setting": ["Unknown setting", "Réglage inconnu"],
	"bad-setting-value": [
		"A setting has an invalid value",
		"Un réglage contient une valeur invalide",
	],
	"duplicate-setting": ["The setting is repeated", "Le réglage est répété"],
	"unclosed-block": ["The block is not closed", "Le bloc n’est pas fermé"],
	"response-invariant": [
		"The assessment’s answers are inconsistent",
		"Les réponses de l’évaluation sont incohérentes",
	],
	"retrieval-sheet-invalid": [
		"The retrieval-sheet library refuses this content. Check the title, questions and answers.",
		"La bibliothèque de fiches de rappel refuse ce contenu. Vérifiez le titre, les questions et les réponses.",
	],
} as const;
function refusal(
	text: string,
	code: keyof typeof copy,
	line: number,
	column: number,
	args: Record<string, unknown> = {},
) {
	const read = readLesson(text);
	const diagnostic = read.diagnostics.find((d) => d.code === code);
	expect(diagnostic).toMatchObject({
		code,
		line,
		column,
		severity: "error",
		message: { key: `grammar.v4.${code}`, args: { line, column, ...args } },
	});
	if (!diagnostic) throw new Error(`Missing ${code}`);
	const lines = text.split(/(?<=\n)/);
	const start = lines.slice(0, line - 1).join("").length + column - 1;
	expect(diagnostic.span.start).toBe(start);
	const lineEnd = lines.slice(0, line).join("").length;
	const tokenEnd = start + (text.slice(start).match(/^[^}\s]+/)?.[0].length ?? 0);
	expect(diagnostic.span.end).toBe(
		["unknown-setting", "bad-setting-value", "duplicate-setting"].includes(code)
			? tokenEnd
			: lineEnd,
	);
	for (const [index, locale] of ["en", "fr"].entries()) {
		expect(format(locale, code, diagnostic.message.args)).toBe(copy[code][index]);
		if (locale === "en")
			expect(retrievalSheetDiagnosticMessage(code, diagnostic.message.args)).toBe(
				copy[code][index],
			);
		const localized = readLesson(text, {
			formatMessage: (message) =>
				format(locale, message.key.replace("grammar.v4.", ""), message.args),
		});
		expect(localized.errors.find((e) => e.messageRef.key === `grammar.v4.${code}`)?.message).toBe(
			copy[code][index],
		);
	}
	expect(read.errors.find((e) => e.messageRef.key === `grammar.v4.${code}`)?.message).toBe(
		copy[code][0],
	);
	expect(read.hasErrors).toBe(true);
}

describe("retrieval-sheet grammar and publication", () => {
	it.each([validEN, validFR])("publishes valid bilingual source: %s", (text) => {
		expect(grammar(text).diagnostics).toEqual([]);
		const read = readLesson(text);
		expect(read.errors).toEqual([]);
		expect(read.hasErrors).toBe(false);
		expect(read.tree.root.raw).toBe(text);
		expect(() => validateContent(content(text))).not.toThrow();
	});
	it.each([1, 8])("admits %i questions", (count) => {
		const text = `# P\n::: retrieval-sheet Title\n${":: Q\nanswer: A\n".repeat(count)}:::\n`;
		expect(errors(text)).toEqual([]);
		const value = content(text);
		expect(value.questions).toHaveLength(count);
		expect(new Set(value.questions.map((q) => q.id)).size).toBe(count);
		for (const q of value.questions) expect(q.id).toMatch(/^[A-Za-z0-9_-]{1,120}$/);
		expect(() => validateContent(value)).not.toThrow();
	});
	it("uses only shared root settings and no item settings or conversions", () => {
		expect(Object.keys(BLOCK_SCHEMA["retrieval-sheet"].settings)).toEqual([
			"width",
			"name",
			"hide",
			"visible",
			"entrance",
			"level",
		]);
		expect(BLOCK_SCHEMA["retrieval-sheet"].itemDefinition?.settings).toEqual({});
		expect(TURN_INTO["retrieval-sheet"]).toEqual([]);
		expect(WRAP_IN["retrieval-sheet"]).not.toContain("group");
		expect(
			errors(
				source(
					"Title",
					"Question",
					"Answer",
					'width=wide name=sheet hide=false visible="flag is true" entrance=fade level=3',
				),
			),
		).toEqual([]);
		expect(schema.properties.questions).toMatchObject({
			minItems: 1,
			maxItems: 8,
			"x-uniqueBy": "id",
		});
	});
	it.each(["accordion", "tabs", "sequence", "columns"])(
		"allows optional %s placement",
		(container) => {
			const text = `# P\n::: ${container}\n:: Item\n${source().slice(4)}:::\n`;
			expect(errors(text)).toEqual([]);
		},
	);
	it.each(["", "::: back\n"])("allows card face %s", (back) => {
		expect(
			errors(`# P\n::: cards\n:: Card\n${back}${source().slice(4)}${back ? ":::\n" : ""}:::\n`),
		).toEqual([]);
	});
	it("allows module-deck source placement", () => {
		expect(errors(source().replace("# P", "# P {deckStop}"))).toEqual([]);
	});
	it("leaves publishable private choices without the sheet's runtime refusal", () => {
		expect(readLesson("# P\n::: choice Q {private}\n( ) Yes\n( ) No\n:::\n").errors).toEqual([]);
	});
});

describe("literal contract refusals and exact bilingual locations", () => {
	it.each(["", "\u00a0\u2003"])("refuses blank title %s", (value) =>
		refusal(source(value), "missing-subject", 2, 1),
	);
	it.each(["", "\u00a0\u2003"])("refuses blank question %s", (value) =>
		refusal(source("Title", value), "missing-subject", 3, 1),
	);
	it.each([
		[source("😀".repeat(121)), "practice-title-too-long", 2, 120],
		[source("Title", "😀".repeat(401)), "practice-question-too-long", 3, 400],
		[source("Title", "Q", "😀".repeat(1501)), "practice-answer-too-long", 4, 1500],
	] as const)("refuses code point overflow with $1", (text, code, line, max) =>
		refusal(text, code, line, 1, { max }),
	);
	it.each([0, 9])("refuses %i rows at the opener", (count) =>
		refusal(
			`# P\n::: retrieval-sheet Title\n${":: Q\nanswer: A\n".repeat(count)}:::\n`,
			"child-count",
			2,
			1,
			{ min: 1, max: 8, count },
		),
	);
	it("refuses missing answer", () =>
		refusal(source().replace("answer: Answer\n", ""), "missing-part", 3, 1, { name: "answer" }));
	it.each(["", "\u00a0\u2003"])("refuses blank answer %s", (value) =>
		refusal(source("Title", "Q", value), "empty-part", 4, 1, { name: "answer" }),
	);
	it("refuses a duplicate answer at its second line", () =>
		refusal(
			source().replace("answer: Answer", "answer: Answer\nanswer: Other"),
			"duplicate-part",
			5,
			1,
			{ name: "answer" },
		));
	it.each(["answers: Answer", "feedback: Answer", "Stray prose", "::: text\nNested\n:::"])(
		"refuses undeclared item content %s",
		(value) => {
			const text = source().replace("answer: Answer", value);
			refusal(text, "disallowed-child", 4, 1);
			refusal(text, "missing-part", 3, 1, { name: "answer" });
		},
	);
	it("refuses a root answer", () =>
		refusal(
			source().replace(":: Question", "answer: Early\n:: Question"),
			"disallowed-child",
			3,
			1,
		));
	it("refuses bare root prose", () =>
		refusal(source().replace(":: Question", "Stray\n:: Question"), "disallowed-child", 3, 1));
	it.each([
		"scored=false",
		"required=false",
		"deckGate=attempt",
		"private=true",
		"date=2027-01-01",
		"spacing=7",
		"id=x",
		"side=back",
		"reminder=true",
		"input=true",
	])("refuses root %s", (setting) =>
		refusal(source("Title", "Q", "A", setting), "unknown-setting", 2, 28),
	);
	it.each(["name=x", "width=wide", "hide", "visible=flag", "entrance=none", "level=2", "id=x"])(
		"refuses item %s",
		(setting) =>
			refusal(
				source().replace(":: Question", `:: Question {${setting}}`),
				"unknown-setting",
				3,
				14,
			),
	);
	it.each(["width=huge", "name=1bad", "hide=maybe", "entrance=zoom", "level=7"])(
		"refuses shared %s",
		(setting) => refusal(source("Title", "Q", "A", setting), "bad-setting-value", 2, 28),
	);
	it("refuses duplicate settings at the second token", () =>
		refusal(source("Title", "Q", "A", "hide hide"), "duplicate-setting", 2, 33));
	it("refuses an unclosed block at its opener", () =>
		refusal(source().replace(/:::\n$/, ""), "unclosed-block", 2, 1));
	it("refuses assessment group membership at the sheet header", () =>
		refusal(
			`# P\n::: group Check\n::: choice Q\n(x) Yes\n( ) No\n:::\n${source().slice(4)}:::\n`,
			"response-invariant",
			7,
			1,
			{ rule: "group-assessments-or-prose" },
		));
	it("refuses a sheet nested under assessment-group prose at the sheet header", () => {
		refusal(
			`# P\n::: group Check\n::: choice Q\n(x) Yes\n( ) No\n:::\n::: text\n${source().slice(4)}:::\n:::\n`,
			"response-invariant",
			8,
			1,
			{ rule: "group-assessments-or-prose" },
		);
	});
	it("refuses duplicate course names", () => {
		const tree = grammar(
			source("Title", "Q", "A", "name=sheet") + source("Title", "Q", "A", "name=sheet").slice(4),
		);
		expect(
			validateCourse([{ path: "lesson.prax", tree }]).diagnostics.filter(
				(d) => d.code === "duplicate-logic-name",
			),
		).toMatchObject([{ code: "duplicate-logic-name", path: "lesson.prax", line: 6, column: 28 }]);
	});
});

describe("literal field and upstream validation boundary", () => {
	it("preserves text, once-decoded escapes, CRLF continuations, blank paragraphs and whitespace", () => {
		const text = String.raw`# P
::: retrieval-sheet **Title** [term]{definition} <b>HTML</b>
:: @icon{star} @var{x} [^1] @footer{note} \*Q\* \\* \d
answer: First  
  second \*line\* \\* \d

    indented  
:::
`.replaceAll("\n", "\r\n");
		const tree = grammar(text);
		expect(tree.diagnostics.map((d) => d.code)).toEqual([]);
		expect(content(text, () => "existing-id")).toEqual({
			title: "**Title** [term]{definition} <b>HTML</b>",
			questions: [
				{
					id: "existing-id",
					question: String.raw`@icon{star} @var{x} [^1] @footer{note} *Q* \* \d`,
					answer: `First  \n${String.raw`second *line* \* \d`}\n\n  indented  `,
				},
			],
		});
		expect(validateCourse([{ path: "literal.prax", tree }]).glossary.size).toBe(0);
	});
	it.each(["😀", "e\u0301"])(
		"counts code points at inclusive limits without normalization: %s",
		(char) => {
			const title = char.repeat(120 / [...char].length);
			const question = char.repeat(400 / [...char].length);
			const answer = char.repeat(1500 / [...char].length);
			expect(errors(source(title, question, answer))).toEqual([]);
			expect(content(source(title, question, answer), () => "existing-id")).toEqual({
				title,
				questions: [{ id: "existing-id", question, answer }],
			});
		},
	);
	it("counts decoded escapes and normalized continuations including trailing whitespace", () => {
		expect(errors(source("\\*".repeat(120), "Q", `${"a".repeat(1498)}\n  b`))).toEqual([]);
		refusal(source("Title", "Q", `${"a".repeat(1498)}\n  b `), "practice-answer-too-long", 4, 1, {
			max: 1500,
		});
		refusal(source("Title", "Q", `${"a".repeat(1500)} `), "practice-answer-too-long", 4, 1, {
			max: 1500,
		});
	});
	it("passes actual literal content to the upstream validator", () => {
		vi.mocked(validateContent).mockClear();
		grammar(source());
		expect(validateContent).toHaveBeenCalledExactlyOnceWith({
			title: "Title",
			questions: [{ id: "question-0", question: "Question", answer: "Answer" }],
		});
	});
	it("does not duplicate structural failures with a generic library refusal", () => {
		vi.mocked(validateContent).mockClear();
		expect(errors(source("", "", ""))).toEqual([
			{ code: "missing-subject", line: 2, column: 1 },
			{ code: "missing-subject", line: 3, column: 1 },
			{ code: "empty-part", line: 4, column: 1 },
		]);
		expect(validateContent).not.toHaveBeenCalled();
	});
	it("fails closed on an unexpected upstream rule without disclosing its exception", () => {
		vi.mocked(validateContent).mockImplementationOnce(() => {
			throw new Error("SECRET authored exception");
		});
		const read = readLesson(source());
		expect(read.errors).toMatchObject([
			{
				message: copy["retrieval-sheet-invalid"][0],
				line: 2,
				column: 1,
				blockType: "retrieval-sheet",
			},
		]);
		expect(JSON.stringify(read.errors)).not.toContain("SECRET");
		for (const [index, locale] of ["en", "fr"].entries())
			expect(format(locale, "retrieval-sheet-invalid", {})).toBe(
				copy["retrieval-sheet-invalid"][index],
			);
	});
	it("keeps IDs with the supplied identity owner and lets upstream refuse malformed IDs", () => {
		const ids = createTransientIdAllocator();
		const value = content(validEN, ids);
		expect(() => validateContent(value)).not.toThrow();
		for (const id of ["bad id", "x".repeat(121), ""])
			expect(() => validateContent(content(source(), () => id))).toThrow();
		expect(() => validateContent(content(validEN, () => "duplicate"))).toThrow();
	});
	it("CLI validation accepts a retrieval sheet", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "retrieval-grammar-"));
		const file = resolve(directory, "fixture.prax");
		writeFileSync(file, source());
		try {
			const output = execFileSync(
				process.execPath,
				["--import", "tsx", new URL("../src/cli/validate.ts", import.meta.url).pathname, file],
				{ stdio: "pipe" },
			);
			expect(output.toString()).not.toContain("unsupported-runtime");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

it("keeps CRLF diagnostic spans in original source coordinates", () => {
	const text = source("Title", "Question", "").replaceAll("\n", "\r\n");
	refusal(text, "empty-part", 4, 1, { name: "answer" });
	expect(readLesson(text).diagnostics).toMatchObject([
		{ code: "empty-part", line: 4, column: 1, span: { start: 45, end: 54 } },
	]);
});

it("reports every oversized field once at its own source field", () => {
	const text = source("x".repeat(121), "x".repeat(401), "x".repeat(1501));
	expect(errors(text)).toEqual([
		{ code: "practice-title-too-long", line: 2, column: 1 },
		{ code: "practice-question-too-long", line: 3, column: 1 },
		{ code: "practice-answer-too-long", line: 4, column: 1 },
	]);
});

it("keeps a misplaced self-check's required model distinct from retrieval item answers", () => {
	const text =
		"# P\n::: retrieval-sheet Title\n::: self-check Task\n:: Criterion\nmissed: Hint\n:::\n:: Q\nanswer: A\n:::\n";
	const missing = grammar(text).diagnostics.filter((d) => d.code === "missing-part");
	expect(missing).toMatchObject([{ line: 3, column: 1, message: { args: { name: "model" } } }]);
	expect(missing).toHaveLength(1);
});

it("reports a sheet in an inner assessment group once at the sheet header", () => {
	const text =
		"# P\n::: group Outer\n::: choice Q\n(x) Yes\n( ) No\n:::\n::: group Inner\n::: choice Q\n(x) Yes\n( ) No\n:::\n::: retrieval-sheet Title\n:: Question\nanswer: Answer\n:::\n:::\n:::\n";
	expect(
		grammar(text).diagnostics.filter((d) => d.code === "response-invariant" && d.line === 12),
	).toMatchObject([
		{ line: 12, column: 1, message: { args: { rule: "group-assessments-or-prose" } } },
	]);
	expect(
		grammar(text).diagnostics.filter((d) => d.code === "response-invariant" && d.line === 12),
	).toHaveLength(1);
});

describe("retrieval sheet course logic boundary", () => {
	const sheet =
		"# Practice\n::: accordion {name=outer}\n:: Panel\n::: retrieval-sheet Title {name=sheet}\n:: Question\nanswer: Answer\n:::\n:::\n";
	const rule = (condition: string, action: string) =>
		`# Public\n::: text {name=publicText}\nText\n:::\n${"\n".repeat(15)}::: rule\n${condition}\nthen: ${action}\n:::\n`;
	const tracking = (rules: string, practice = sheet) =>
		validateCourse(
			[
				{ path: "rules.prax", tree: grammar(rules) },
				{ path: "practice.prax", tree: grammar(practice) },
			],
			{ variables: { publicFlag: true, picked: false } },
		).diagnostics.filter((d) => d.code === "practice-no-tracking");
	it.each(["@sheet", "block:sheet", "sheet"])("refuses every field via %s at 21:1", (ref) => {
		for (const field of ["score", "answer", "isAttempted", "isCompleted", "anything"])
			for (const action of [
				"show @publicText",
				"hide @publicText",
				"set picked = true",
				"disableCompletion",
			]) {
				const source = rule(`if: ${ref}.${field} is true`, action);
				expect(tracking(source)).toEqual([
					expect.objectContaining({
						path: "rules.prax",
						line: 21,
						column: 1,
						span: expect.objectContaining({
							start: source.indexOf("if:"),
							end: source.indexOf("then:"),
						}),
						message: { key: "grammar.v4.practice-no-tracking", args: { line: 21, column: 1 } },
					}),
				]);
			}
	});
	it.each(["and", "or"])("refuses %s reads at their condition", (part) => {
		expect(
			tracking(
				rule(`if: publicFlag is true\n${part}: @sheet.isCompleted is true`, "show @publicText"),
			),
		).toMatchObject([{ line: 22, column: 1 }]);
	});
	it("refuses visible at its setting span", () => {
		const source = '# P\n::: text {visible="@sheet.anything is true"}\nText\n:::\n';
		expect(tracking(source)).toMatchObject([
			{
				line: 2,
				column: 11,
				span: { start: source.indexOf("visible="), end: source.indexOf("}") },
			},
		]);
	});
	it.each(["sheet", "outer"])("refuses require @%s at 22:1", (target) => {
		const source = rule("if: publicFlag is true", `require @${target}`);
		expect(tracking(source)).toMatchObject([
			{ path: "rules.prax", line: 22, column: 1, span: { start: source.indexOf("then:") } },
		]);
	});
	it("cannot shadow sheet or container names with public definitions", () => {
		const publicSource =
			"# P\n::: text {name=sheet}\nPublic\n:::\n::: text {name=outer}\nPublic\n:::\n";
		expect(
			tracking(publicSource + rule("if: @sheet.isCompleted is true", "require @outer")),
		).toHaveLength(2);
	});
	it("allows public-condition show/hide targets and scalar lookalikes", () => {
		for (const action of ["show @sheet", "hide @outer", 'set picked = "block:sheet.score"'])
			expect(tracking(rule("if: publicFlag is true", action))).toEqual([]);
	});
});

it.each(["required=true", "deckGate=attempt"])(
	"refuses a retrieval container's %s at the setting",
	(setting) => {
		const source = `# P\n::: accordion {${setting}}\n:: Panel\n::: retrieval-sheet T\n:: Q\nanswer: A\n:::\n:::\n`;
		expect(
			validateCourse([{ path: "practice.prax", tree: grammar(source) }]).diagnostics.filter(
				(d) => d.code === "practice-no-tracking",
			),
		).toMatchObject([
			{
				path: "practice.prax",
				line: 2,
				column: 16,
				span: { start: source.indexOf(setting), end: source.indexOf("}") },
			},
		]);
	},
);

it.each(["required", "required=true", "deckGate=attempt"])(
	"reports only unknown-setting on a sheet's own %s",
	(setting) => {
		const tree = grammar(source("T", "Q", "A", setting));
		const diagnostics = validateCourse([{ path: "practice.prax", tree }]).diagnostics;
		expect(diagnostics.filter((d) => d.code === "practice-no-tracking")).toEqual([]);
		expect(diagnostics.filter((d) => d.code === "unknown-setting")).toHaveLength(1);
	},
);

it("reports each strict-ancestor gate once even when several sheets share it", () => {
	const child = source().slice(4);
	const text = `# P\n::: accordion {required=true deckGate=attempt}\n:: Panel\n${child}${child}:::\n`;
	const diagnostics = validateCourse([{ path: "practice.prax", tree: grammar(text) }]).diagnostics;
	const tracking = diagnostics.filter((d) => d.code === "practice-no-tracking");
	expect(tracking).toHaveLength(2);
	expect(new Set(tracking.map((d) => d.span.start)).size).toBe(2);
});

it("bounds source gate validation to linear child-list visits on deep containers", () => {
	const depth = 128;
	const text = `# P\n${"::: accordion\n:: Panel\n".repeat(depth)}${source().slice(4)}${":::\n".repeat(depth)}`;
	const tree = grammar(text);
	const all = [tree.root];
	for (let i = 0; i < all.length; i++) all.push(...all[i].children);
	let visits = 0;
	for (const node of all) {
		const children = node.children;
		Object.defineProperty(node, "children", {
			get: () => {
				visits++;
				return children;
			},
		});
	}
	validateCourse([{ path: "deep.prax", tree }]);
	expect(visits).toBeLessThan(all.length * 40);
});
