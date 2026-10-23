import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasInlineIconMarkup, materializeInlineIcons } from "@praxity/content-model/inline-icons";
import { prepareInlineBlocks } from "@praxity/content-model/inline-preparation";
import { validateContent } from "learning-patterns/patterns/write-distractors/logic.js";
import { describe, expect, it, vi } from "vitest";
import { readLesson, refuseUnavailableLessonRuntime } from "../src/read-lesson";
import { tokenizeLesson } from "../src/v4/lex";
import {
	BLOCK_SCHEMA,
	getDefinition,
	TURN_INTO,
	validateCourse,
	WRAP_IN,
	writeDistractorsContent,
} from "../src/v4/schema";
import { analyzeLessonTree, type TreeNode } from "../src/v4/tree";

vi.mock("learning-patterns/patterns/write-distractors/logic.js", async (original) => {
	const library =
		await original<typeof import("learning-patterns/patterns/write-distractors/logic.js")>();
	return { ...library, validateContent: vi.fn(library.validateContent) };
});
const source = (
	question = "Question",
	answer = "Right",
	label = "Mistake",
	option = "Wrong",
	settings = "",
) =>
	`# P\n::: write-distractors${question ? ` ${question}` : ""}${settings ? ` {${settings}}` : ""}\nanswer: ${answer}\n:: ${label}\noption: ${option}\n:::\n`;
const grammar = (text: string) =>
	analyzeLessonTree(tokenizeLesson(text), { definition: getDefinition });
const content = (text: string, allocate = (_item: TreeNode, index: number) => `item-${index}`) => {
	const find = (node: TreeNode): TreeNode | undefined =>
		node.type === "write-distractors" ? node : node.children.map(find).find(Boolean);
	const node = find(grammar(text).root);
	if (!node) throw new Error("Missing fixture");
	return writeDistractorsContent(node, allocate);
};
const errors = (text: string) =>
	readLesson(text).diagnostics.filter((d) => d.code !== "unsupported-runtime");
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
const copy = {
	"missing-subject": [
		"The block needs a title or subject",
		"Le bloc nécessite un titre ou un sujet",
	],
	"practice-question-too-long": [
		"Keep the question to 400 Unicode code points or fewer.",
		"Limitez la question à 400 points de code Unicode.",
	],
	"practice-right-answer-too-long": [
		"Keep the right answer to 300 Unicode code points or fewer.",
		"Limitez la bonne réponse à 300 points de code Unicode.",
	],
	"practice-misconception-too-long": [
		"Keep the mistaken idea label to 120 Unicode code points or fewer.",
		"Limitez le libellé de l'idée fausse à 120 points de code Unicode.",
	],
	"practice-option-too-long": [
		"Keep the wrong option to 300 Unicode code points or fewer.",
		"Limitez la mauvaise réponse à 300 points de code Unicode.",
	],
	"missing-part": ["Add the required {name}: part", "Ajoutez la partie obligatoire {name}:"],
	"empty-part": ["The {name}: part must contain text", "La partie {name}: doit contenir du texte"],
	"duplicate-part": [
		"Write the {name}: part only once",
		"Écrivez la partie {name}: une seule fois",
	],
	"disallowed-child": [
		"This content is not allowed in its parent",
		"Ce contenu n’est pas autorisé dans son parent",
	],
	"child-count": [
		"The block has the wrong number of items",
		"Le bloc n’a pas le bon nombre d’éléments",
	],
	"write-distractors-duplicate-label": [
		"Give each mistaken idea a distinct label.",
		"Donnez un libellé distinct à chaque idée fausse.",
	],
	"bad-setting-value": [
		"A setting has an invalid value",
		"Un réglage contient une valeur invalide",
	],
	"unknown-setting": ["Unknown setting", "Réglage inconnu"],
	"duplicate-setting": ["The setting is repeated", "Le réglage est répété"],
	"unclosed-block": ["The block is not closed", "Le bloc n’est pas fermé"],
	"response-invariant": [
		"The assessment’s answers are inconsistent",
		"Les réponses de l’évaluation sont incohérentes",
	],
	"write-distractors-author-right": [
		"This wrong option matches the right answer. Review it.",
		"Cette mauvaise réponse correspond à la bonne réponse. Revoyez-la.",
	],
	"write-distractors-invalid": [
		"The write-distractors library refuses this content. Check the question, answer and items.",
		"La bibliothèque de rédaction de mauvaises réponses refuse ce contenu. Vérifiez la question, la réponse et les éléments.",
	],
} as const;
const interpolate = (template: string, args: Record<string, unknown>) =>
	template.replace(/\{(\w+)\}/g, (_, key: string) => String(args[key] ?? ""));
function refusal(
	text: string,
	code: keyof typeof copy,
	line: number,
	column = 1,
	args: Record<string, unknown> = {},
	severity = "error",
) {
	const read = readLesson(text);
	const d = read.diagnostics.find((d) => d.code === code);
	expect(d).toMatchObject({
		code,
		line,
		column,
		severity,
		message: { key: `grammar.v4.${code}`, args },
	});
	if (!d) throw new Error(`Missing ${code}`);
	const lines = text.split(/(?<=\n)/);
	const start = lines.slice(0, line - 1).join("").length + column - 1;
	expect(d.span.start).toBe(start);
	expect(d.span.end).toBe(
		["unknown-setting", "bad-setting-value", "duplicate-setting"].includes(code)
			? start + (text.slice(start).match(/^[^}\s]+/)?.[0].length ?? 0)
			: lines.slice(0, line).join("").length,
	);
	for (const [index, locale] of ["en", "fr"].entries()) {
		const expected = interpolate(copy[code][index], args);
		expect(interpolate(catalogs[locale][code], d.message.args)).toBe(expected);
		const localized = readLesson(text, {
			formatMessage: (ref) => interpolate(catalogs[locale][ref.key.slice(11)] ?? "", ref.args),
		});
		expect(localized.errors.find((e) => e.messageRef.key === `grammar.v4.${code}`)?.message).toBe(
			expected,
		);
	}
	expect(read.errors.find((e) => e.messageRef.key === `grammar.v4.${code}`)?.message).toBe(
		interpolate(copy[code][0], args),
	);
}

describe("write-distractors literal grammar contract", () => {
	it("declares shared settings, literal count and no item settings or conversions", () => {
		expect(Object.keys(BLOCK_SCHEMA["write-distractors"].settings)).toEqual([
			"width",
			"name",
			"hide",
			"visible",
			"entrance",
			"level",
			"count",
		]);
		expect(BLOCK_SCHEMA["write-distractors"].itemDefinition?.settings).toEqual({});
		expect(TURN_INTO["write-distractors"]).toEqual([]);
		expect(WRAP_IN["write-distractors"]).not.toContain("group");
		expect(
			errors(
				source(
					"Q",
					"R",
					"L",
					"O",
					'width=wide name=wd hide=false visible="flag is true" entrance=fade level="3" count=5',
				),
			),
		).toEqual([]);
		expect(content(source()).count).toBe(2);
	});
	it.each([1, 2, 3, 4, 5])("admits count %i independent of item count", (count) => {
		const text = source("Q", "R", "L", "O", `count=${count}`);
		expect(errors(text)).toEqual([]);
		expect(content(text)).toEqual({
			question: "Q",
			rightAnswer: "R",
			count,
			misconceptions: [{ id: "item-0", label: "L" }],
			authorOptions: [{ text: "O", misconception: "item-0" }],
		});
	});
	it("has no maximum authored item count", () => {
		expect(
			errors(
				`# P\n::: write-distractors Q\nanswer: R\n${Array.from({ length: 12 }, (_, i) => `:: L${i}\noption: O${i}\n`).join("")}:::\n`,
			),
		).toEqual([]);
	});
	it.each(["", "\u00a0\u2003"])("refuses blank question and label %s", (blank) => {
		refusal(source(blank), "missing-subject", 2);
		refusal(source("Q", "R", blank), "missing-subject", 4);
	});
	it.each([
		[source("😀".repeat(401)), "practice-question-too-long", 2, 400],
		[source("Q", "😀".repeat(301)), "practice-right-answer-too-long", 3, 300],
		[source("Q", "R", "😀".repeat(121)), "practice-misconception-too-long", 4, 120],
		[source("Q", "R", "L", "😀".repeat(301)), "practice-option-too-long", 5, 300],
	] as const)("refuses overflow at its own field with $1", (text, code, line, max) =>
		refusal(text, code, line, 1, { max }),
	);
	it.each(["😀", "e\u0301"])("admits inclusive code-point limits %s", (char) => {
		expect(
			errors(
				source(
					char.repeat(400 / [...char].length),
					char.repeat(300 / [...char].length),
					char.repeat(120 / [...char].length),
					"O".repeat(300),
				),
			),
		).toEqual([]);
	});
	it.each(["answer", "option"])("refuses missing, blank and repeated %s", (name) => {
		const line = name === "answer" ? 3 : 5;
		const value = name === "answer" ? "Right" : "Wrong";
		refusal(source().replace(`${name}: ${value}\n`, ""), "missing-part", line - 1, 1, { name });
		for (const blank of ["", "\u00a0\u2003"])
			refusal(source().replace(`${name}: ${value}`, `${name}: ${blank}`), "empty-part", line, 1, {
				name,
			});
		refusal(
			source().replace(`${name}: ${value}`, `${name}: ${value}\n${name}: Other`),
			"duplicate-part",
			line + 1,
			1,
			{ name },
		);
	});
	it("refuses a late answer at its line and the missing root answer", () => {
		const text = source()
			.replace("answer: Right\n", "")
			.replace("option: Wrong", "option: Wrong\nanswer: Right");
		refusal(text, "disallowed-child", 5);
		refusal(text, "missing-part", 2, 1, { name: "answer" });
	});
	it("refuses no items", () =>
		refusal("# P\n::: write-distractors Q\nanswer: R\n:::\n", "child-count", 2, 1, {
			min: 1,
			count: 0,
		}));
	it("refuses normalized duplicate labels without Unicode normalization", () => {
		refusal(
			source("Q", "R", "A  B").replace(":::\n", ":: a b \noption: Second\n:::\n"),
			"write-distractors-duplicate-label",
			6,
		);
		expect(
			errors(source("Q", "R", "é").replace(":::\n", ":: e\u0301\noption: Second\n:::\n")),
		).toEqual([]);
	});
	it.each(["0", "6", "1.5", "two", '"2"', '"9"', '"abc"', "true", "2.0", "+2", "02", "2."])(
		"refuses count=%s at the token",
		(count) =>
			refusal(source("Question", "R", "L", "O", `count=${count}`), "bad-setting-value", 2, 33),
	);
	it.each([
		"private",
		"private=true",
		"scored=false",
		"required=false",
		"points=0",
		"deckGate=attempt",
		"id=x",
	])("refuses root %s", (setting) =>
		refusal(source("Question", "R", "L", "O", setting), "unknown-setting", 2, 33),
	);
	it.each([
		"name=x",
		"width=wide",
		"hide",
		"visible=flag",
		"entrance=none",
		"level=2",
		"count=2",
		"id=x",
	])("refuses item %s", (setting) =>
		refusal(source().replace(":: Mistake", `:: Mistake {${setting}}`), "unknown-setting", 4, 13),
	);
	it.each(["width=huge", "name=1bad", "hide=maybe", "entrance=zoom", "level=7"])(
		"refuses shared %s",
		(setting) => refusal(source("Question", "R", "L", "O", setting), "bad-setting-value", 2, 33),
	);
	it("preserves legacy quoted numeric level and points", () => {
		expect(errors(source("Q", "R", "L", "O", 'level="2"'))).toEqual([]);
		expect(
			readLesson('# P\n::: choice Q {points="2" level="3"}\n(x) Yes\n( ) No\n:::\n').errors,
		).toEqual([]);
	});
	it("refuses duplicate settings and an unclosed block", () => {
		refusal(source("Question", "R", "L", "O", "hide hide"), "duplicate-setting", 2, 38);
		refusal(source().replace(/:::\n$/, ""), "unclosed-block", 2);
	});
	it.each(["model: Hidden", "feedback: Hidden", "Stray prose", "::: text\nNested\n:::"])(
		"refuses undeclared content %s",
		(child) => {
			refusal(source().replace("option: Wrong", child), "disallowed-child", 5);
			refusal(source().replace("answer: Right", child), "disallowed-child", 3);
		},
	);
	it.each(["", "::: text\n"])(
		"refuses direct or nested group membership with wrapper %j",
		(wrapper) => {
			refusal(
				`# P\n::: group Check\n::: choice Q\n(x) Yes\n( ) No\n:::\n${wrapper}${source().slice(4)}${wrapper ? ":::\n" : ""}:::\n`,
				"response-invariant",
				wrapper ? 8 : 7,
				1,
				{ rule: "group-assessments-or-prose" },
			);
		},
	);
	it("warns at the option when it normalizes to the right answer", () => {
		const text = source("Q", "A  B", "L", "a b ");
		refusal(text, "write-distractors-author-right", 5, 1, {}, "warning");
		expect(errors(text).map((d) => d.code)).toEqual(["write-distractors-author-right"]);
		expect(() => validateContent(content(text))).not.toThrow();
	});
	it("preserves literal escapes, whitespace and continuations without glossary or footnotes", () => {
		const text = String.raw`# P
::: write-distractors **Q** [term]{definition} <b>HTML</b>
answer: Hidden @var{x} [^1] \*R\* \\* \d  
  next

    indented  
:: Hidden @icon{star} [label]{secret}
option: Hidden @footer{note} <i>O</i>
:::
`.replaceAll("\n", "\r\n");
		expect(content(text)).toEqual({
			question: "**Q** [term]{definition} <b>HTML</b>",
			rightAnswer: String.raw`Hidden @var{x} [^1] *R* \* \d  ` + "\nnext\n\n  indented  ",
			count: 2,
			misconceptions: [{ id: "item-0", label: "Hidden @icon{star} [label]{secret}" }],
			authorOptions: [{ text: "Hidden @footer{note} <i>O</i>", misconception: "item-0" }],
		});
		expect(validateCourse([{ path: "literal.prax", tree: grammar(text) }]).glossary.size).toBe(0);
		expect(JSON.stringify(readLesson(text).blocks)).not.toContain("Hidden");
	});
	it("calls upstream unchanged after structure checks, fails closed without exception text", async () => {
		const { validateContent: actualValidator } = await vi.importActual<
			typeof import("learning-patterns/patterns/write-distractors/logic.js")
		>("learning-patterns/patterns/write-distractors/logic.js");
		vi.mocked(validateContent).mockClear();
		grammar(source("", "", "", ""));
		expect(validateContent).not.toHaveBeenCalled();
		grammar(source());
		expect(validateContent).toHaveBeenCalledExactlyOnceWith({
			question: "Question",
			rightAnswer: "Right",
			count: 2,
			misconceptions: [{ id: "misconception-0", label: "Mistake" }],
			authorOptions: [{ text: "Wrong", misconception: "misconception-0" }],
		});
		vi.mocked(validateContent).mockImplementation(() => {
			throw new Error("HIDDEN_EXCEPTION");
		});
		try {
			refusal(source(), "write-distractors-invalid", 2);
			expect(JSON.stringify(readLesson(source()).errors)).not.toContain("HIDDEN_EXCEPTION");
		} finally {
			vi.mocked(validateContent).mockReset();
			vi.mocked(validateContent).mockImplementation(actualValidator);
		}
	});
	it("refuses malformed, duplicate and reserved allocated identities upstream", () => {
		for (const id of ["", "other", "bad id", "x".repeat(121)])
			expect(() => validateContent(content(source(), () => id))).toThrow();
		expect(() =>
			validateContent(
				content(source().replace(":::\n", ":: Other\noption: Second\n:::\n"), () => "same"),
			),
		).toThrow();
	});
	it("admits source publication with prompt-only data", () => {
		const read = readLesson(source());
		expect(read.errors).toEqual([]);
		expect(() => refuseUnavailableLessonRuntime(read, "lesson.prax")).not.toThrow();
	});
});

describe("write distractors course logic boundary", () => {
	const distractors = `# Practice\n::: accordion {name=outer}\n:: Panel\n${source("Question", "Right", "Mistake", "Wrong", "name=wd").slice(4)}:::\n`;
	const rule = (condition: string, action: string) =>
		`# Public\n::: text {name=publicText}\nText\n:::\n${"\n".repeat(15)}::: rule\n${condition}\nthen: ${action}\n:::\n`;
	it("uses an otherwise valid named practice fixture", () => {
		expect(errors(distractors)).toEqual([]);
	});
	const tracking = (rules: string, practice = distractors) =>
		validateCourse(
			[
				{ path: "rules.prax", tree: grammar(rules) },
				{ path: "practice.prax", tree: grammar(practice) },
			],
			{ variables: { publicFlag: true, picked: false } },
		).diagnostics.filter((d) => d.code === "practice-no-tracking");
	it.each(["@wd", "block:wd", "wd"])("refuses every field via %s at 21:1", (ref) => {
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
				rule(`if: publicFlag is true\n${part}: @wd.isCompleted is true`, "show @publicText"),
			),
		).toMatchObject([{ line: 22, column: 1 }]);
	});
	it("refuses visible at its setting span", () => {
		const source = '# P\n::: text {visible="@wd.anything is true"}\nText\n:::\n';
		expect(tracking(source)).toMatchObject([
			{
				line: 2,
				column: 11,
				span: { start: source.indexOf("visible="), end: source.indexOf("}") },
			},
		]);
	});
	it.each(["wd", "outer"])("refuses require @%s at 22:1", (target) => {
		const source = rule("if: publicFlag is true", `require @${target}`);
		expect(tracking(source)).toMatchObject([
			{ path: "rules.prax", line: 22, column: 1, span: { start: source.indexOf("then:") } },
		]);
	});
	it("cannot shadow distractor or container names with public definitions", () => {
		const publicSource =
			"# P\n::: text {name=wd}\nPublic\n:::\n::: text {name=outer}\nPublic\n:::\n";
		expect(
			tracking(publicSource + rule("if: @wd.isCompleted is true", "require @outer")),
		).toHaveLength(2);
	});
	it("allows public-condition show/hide targets and scalar lookalikes", () => {
		for (const action of ["show @wd", "hide @outer", 'set picked = "block:wd.score"'])
			expect(tracking(rule("if: publicFlag is true", action))).toEqual([]);
	});
});

it.each(["required=true", "deckGate=attempt"])(
	"refuses a distractor container's %s at the setting",
	(setting) => {
		const source = `# P\n::: accordion {${setting}}\n:: Panel\n::: write-distractors Q\nanswer: R\n:: L\noption: O\n:::\n:::\n`;
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
	"reports only unknown-setting on a distractor's own %s",
	(setting) => {
		const tree = grammar(source("Q", "R", "L", "O", setting));
		const diagnostics = validateCourse([{ path: "practice.prax", tree }]).diagnostics;
		expect(diagnostics.filter((d) => d.code === "practice-no-tracking")).toEqual([]);
		expect(diagnostics.filter((d) => d.code === "unknown-setting")).toHaveLength(1);
	},
);

it("reports each strict-ancestor gate once even when several distractors share it", () => {
	const child = source().slice(4);
	const text = `# P\n::: accordion {required=true deckGate=attempt}\n:: Panel\n${child}${child}:::\n`;
	const diagnostics = validateCourse([{ path: "practice.prax", tree: grammar(text) }]).diagnostics;
	const tracking = diagnostics.filter((d) => d.code === "practice-no-tracking");
	expect(tracking).toHaveLength(2);
	expect(new Set(tracking.map((d) => d.span.start)).size).toBe(2);
});

it.each(["accordion", "tabs", "sequence", "columns"])(
	"keeps optional %s projections prompt-only",
	(container) => {
		const text = `# P\n::: ${container}\n:: Panel\n${source("PromptControl", "HiddenRight", "HiddenLabel", "HiddenOption").slice(4)}:::\n`;
		expect(errors(text)).toEqual([]);
		const projected = JSON.stringify(readLesson(text).blocks);
		expect(projected).toContain("PromptControl");
		for (const marker of ["HiddenRight", "HiddenLabel", "HiddenOption"])
			expect(projected).not.toContain(marker);
	},
);
it.each(["", "::: back\n"])("keeps card faces prompt-only %s", (back) => {
	const text = `# P\n::: cards\n:: Card\n${back}${source("PromptControl", "HiddenRight", "HiddenLabel", "HiddenOption").slice(4)}${back ? ":::\n" : ""}:::\n`;
	expect(errors(text)).toEqual([]);
	const projected = JSON.stringify(readLesson(text).blocks);
	expect(projected).toContain("PromptControl");
	for (const marker of ["HiddenRight", "HiddenLabel", "HiddenOption"])
		expect(projected).not.toContain(marker);
});
it("keeps module-deck source prompt-only", () => {
	const text = source("PromptControl", "HiddenRight", "HiddenLabel", "HiddenOption").replace(
		"# P",
		"# P {deckStop}",
	);
	expect(errors(text)).toEqual([]);
	expect(readLesson(text).blocks.find((b) => b.type === "writeDistractors")).toMatchObject({
		data: { level: 2, content: { question: "PromptControl", count: 2 } },
	});
	for (const marker of ["HiddenRight", "HiddenLabel", "HiddenOption"])
		expect(JSON.stringify(readLesson(text).blocks)).not.toContain(marker);
});
it("reports CRLF refusals in original source coordinates", () =>
	refusal(source("Q", "", "L", "O").replaceAll("\n", "\r\n"), "empty-part", 3, 1, {
		name: "answer",
	}));

it.each(['"2"', '"9"', '"abc"', "2.0", "+2", "02", "2."])(
	"refuses count=%s exactly once",
	(count) => {
		const text = source("Question", "R", "L", "O", `count=${count}`);
		refusal(text, "bad-setting-value", 2, 33);
		expect(errors(text).map((d) => d.code)).toEqual(["bad-setting-value"]);
	},
);

it("preserves literal prompt bytes without preparing inline icons or markup", () => {
	const question = "<b>Q</b> [term]{definition} @icon{star} @footer{note}";
	const read = readLesson(source(question));
	const block = read.blocks.find((b) => b.type === "writeDistractors");
	if (!block) throw new Error("Missing typed placeholder");
	expect(block.data).toEqual({
		level: 2,
		content: { question, count: 2, items: [expect.objectContaining({ id: expect.any(String) })] },
	});
	expect(prepareInlineBlocks([block])).toEqual([block]);
	expect(hasInlineIconMarkup(block)).toBe(false);
	expect(materializeInlineIcons(structuredClone(block), { outline: {}, filled: {} })).toEqual(
		block,
	);
});
