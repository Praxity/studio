import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { choiceFactError } from "@praxity/content-model";
import { describe, expect, it } from "vitest";
import { readLesson } from "../src/read-lesson";
import { tokenizeLesson } from "../src/v4/lex";
import { getDefinition, validateCourse } from "../src/v4/schema";
import { analyzeLessonTree } from "../src/v4/tree";

const choice = (settings = "", options = "(x) Yes\n( ) No") =>
	`::: choice Question${settings ? ` {${settings}}` : ""}\n${options}\n:::\n`;
const parse = (source: string) => {
	let next = 0;
	return readLesson(source, { ids: () => `id-${next++}` });
};
const grammar = (source: string) =>
	analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition });
const course = (source: string, activity = `# Practice\n${choice("name=priv private")}`) =>
	validateCourse(
		[
			{ path: "rules.prax", tree: grammar(source) },
			{ path: "practice.prax", tree: grammar(activity) },
		],
		{ variables: { picked: false, publicFlag: true } },
	).diagnostics;
const at20 = (condition: string, action: string) =>
	`# Public\n::: text {name=publicText}\nText\n:::\n${"\n".repeat(15)}::: rule\n${condition}\nthen: ${action}\n:::\n`;
const tracking = (source: string, activity?: string) =>
	course(source, activity).filter((d) => d.code === "practice-no-tracking");
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
const text = {
	en: {
		"private-choice-practice-only":
			"A private choice must be optional, unscored, outside assessment groups and without a gate.",
		"practice-no-tracking":
			"This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container.",
	},
	fr: {
		"private-choice-practice-only":
			"Un choix privé doit être facultatif, sans score, hors des groupes d’évaluations et sans condition de progression.",
		"practice-no-tracking":
			"Cette activité de pratique ne peut être lue par la logique du cours, modifier l’état du cours, fournir un score ou une condition de progression, ni être obligatoire directement ou par l’intermédiaire d’un conteneur.",
	},
};

it.each([
	["en", "en"],
	["en-CA", "en"],
	["fr", "fr"],
	["fr-CA", "fr"],
	["FR_ca", "fr"],
	["de-DE", "en"],
	["french", "en"],
])("keeps the %s choice refusal in parity with the %s editor catalogue", (locale, language) => {
	expect(choiceFactError("question-id", "attempts", locale).message).toBe(
		catalogs[language]["choice-invalid-attempts"].replace("{blockId}", "question-id"),
	);
});

describe("private single-answer choices", () => {
	it.each([
		"private",
		"private=true",
		"private=true scored=false required=false",
		"private points=5",
		"private dontKnow=false",
		"private attempts=0",
		"private feedbackMode=reveal",
	])("admits publishable %s", (settings) => {
		const source = `# P\n${choice(settings)}`;
		expect(grammar(source).diagnostics).toEqual([]);
		expect(parse(source).blocks.find((b) => b.type === "assessment")?.data.private).toBe(true);
	});
	it("admits an unkeyed private poll", () => {
		expect(
			grammar(`# P\n${choice("private", "( ) Yes\n( ) No")}`).diagnostics.map((d) => d.code),
		).toEqual([]);
	});
	it.each([
		"private=false",
		"private=false scored=true required=true deckGate=pass",
		"scored required",
		"",
	])("preserves ordinary single choice admission: %s", (settings) => {
		expect(parse(`# P\n${choice(settings)}`).diagnostics).toEqual([]);
	});
	it.each(['private="true"', 'private="false"', "private=maybe", "private=1"])(
		"rejects a nonboolean %s at its setting",
		(setting) => {
			expect(grammar(`# P\n${choice(setting)}`).diagnostics).toMatchObject([
				{ code: "bad-setting-value", line: 2, column: 22 },
			]);
		},
	);
	it("rejects duplicate privacy settings", () => {
		expect(grammar(`# P\n${choice("private=false private=false")}`).diagnostics).toMatchObject([
			{ code: "duplicate-setting", line: 2, column: 36 },
		]);
	});
	it.each(["private", "private=true", "private=false"])(
		"rejects even %s on multiple selection",
		(setting) => {
			expect(grammar(`# P\n${choice(setting, "[x] Yes\n[ ] No")}`).diagnostics).toContainEqual(
				expect.objectContaining({
					code: "response-invariant",
					line: 2,
					column: 1,
					message: {
						key: "grammar.v4.response-invariant",
						args: { line: 2, column: 1, type: "choice", rule: "private-single-only" },
					},
				}),
			);
		},
	);
	it.each([
		"scored",
		"scored=true required=false",
		"required",
		"deckGate=attempt",
		"deckGate=pass",
	])("rejects private %s at the opener", (settings) => {
		expect(grammar(`# P\n${choice(`private ${settings}`)}`).diagnostics).toContainEqual(
			expect.objectContaining({ code: "private-choice-practice-only", line: 2, column: 1 }),
		);
	});
	it("rejects group membership at the private child header", () => {
		const source = `# P\n::: group Check\n${choice("private")}:::\n`;
		expect(grammar(source).diagnostics).toContainEqual(
			expect.objectContaining({ code: "private-choice-practice-only", line: 3, column: 1 }),
		);
	});
	it("rejects private choices anywhere under an assessment group, including prose wrappers", () => {
		const source = `# P\n::: group Check\n${choice()}::: text\n${choice("private")}:::\n:::\n`;
		expect(grammar(source).diagnostics).toContainEqual(
			expect.objectContaining({ code: "private-choice-practice-only", line: 8, column: 1 }),
		);
		expect(grammar(source.replace("{private}", "{private=false}")).diagnostics).toEqual([]);
		expect(
			grammar(source.replace("{private}", "{private scored}")).diagnostics.filter(
				(d) => d.code === "private-choice-practice-only",
			),
		).toHaveLength(1);
	});
	it("keeps optional containers; Grammar 4 has no container required or deckGate setting", () => {
		for (const settings of ["", " {required}", " {deckGate=attempt}"]) {
			const diagnostics = grammar(
				`# P\n::: accordion Optional${settings}\n:: Item\n${choice("private")}:::\n`,
			).diagnostics;
			expect(diagnostics.map((d) => d.code)).toEqual(settings ? ["unknown-setting"] : []);
		}
	});
	it("omitted and false privacy keep literal projection bytes identical", () => {
		const omitted = parse(`# P\n${choice()}`);
		const explicit = parse(`# P\n${choice("private=false")}`);
		expect(JSON.stringify(explicit.blocks)).toBe(JSON.stringify(omitted.blocks));
		expect(explicit.blocks.find((b) => b.type === "assessment")?.data).not.toHaveProperty(
			"private",
		);
	});
	it("retains the frozen free-response private projection", () => {
		const read = parse(
			"# P\n::: free-response Reflect {private}\nWrite **freely**.\nplaceholder: Your answer\n:::\n",
		);
		expect(read.diagnostics).toEqual([]);
		expect(createHash("sha256").update(JSON.stringify(read.blocks)).digest("hex")).toBe(
			"199c2e1556ff7330552fd0f46159567622bf4c42d354b579969f9b21c1923163",
		);
	});
	it("admits private choice publication in the public reader", () => {
		const read = parse(`# P\n${choice("private")}`);
		expect(read.hasErrors).toBe(false);
		expect(read.errors).toEqual([]);
	});
});

describe("private choice course logic boundary", () => {
	it.each(["block:priv", "@priv", "priv"])(
		"refuses every field read via %s at 21:1 whatever the action",
		(ref) => {
			for (const field of [
				"selectedOption",
				"score",
				"result",
				"isAttempted",
				"isCompleted",
				"anything",
			])
				for (const action of [
					"set picked = true",
					"show @publicText",
					"hide @publicText",
					"disableCompletion",
					"jump @publicText",
					"show @publicText\nthen: set picked = true",
				]) {
					const source = at20(`if: ${ref}.${field} is true`, action);
					expect(tracking(source)).toEqual([
						expect.objectContaining({
							path: "rules.prax",
							line: 21,
							column: 1,
							severity: "error",
							message: { key: "grammar.v4.practice-no-tracking", args: { line: 21, column: 1 } },
							span: expect.objectContaining({
								start: source.indexOf("if:"),
								end: source.indexOf("then:"),
							}),
						}),
					]);
				}
		},
	);
	it.each(["and", "or"])("checks %s conditions", (part) => {
		const source = at20(
			`if: publicFlag is true\n${part}: @priv.isCompleted is true`,
			"show @publicText",
		);
		expect(tracking(source)).toMatchObject([
			{ line: 22, column: 1, span: { start: source.indexOf(`${part}:`) } },
		]);
	});
	it.each(["::: text", ":: Item", "::: back"])(
		"checks visible on %s at the setting token",
		(opener) => {
			for (const ref of ["block:priv", "@priv", "priv"]) {
				const source = `# P\n${opener} {visible="${ref}.isCompleted is true"}\n`;
				const ds = tracking(source);
				expect(ds).toMatchObject([{ line: 2, column: opener.length + 3 }]);
				expect(ds[0].span.start).toBe(source.indexOf("visible="));
			}
		},
	);
	it("registers private names even after a public name on another page/lesson", () => {
		const source = at20("if: @priv.isCompleted is true", "require @outer");
		const diagnostics = validateCourse(
			[
				{
					path: "public.prax",
					tree: grammar(
						"# Public\n::: text {name=priv}\nPublic\n:::\n::: text {name=outer}\nPublic\n:::\n",
					),
				},
				{
					path: "practice.prax",
					tree: grammar(
						`# Practice\n::: accordion {name=outer}\n:: Item\n${choice("private name=priv")}:::\n${source}`,
					),
				},
			],
			{ variables: { publicFlag: true } },
		).diagnostics;
		expect(diagnostics.filter((d) => d.code === "duplicate-logic-name")).toHaveLength(2);
		expect(diagnostics.filter((d) => d.code === "practice-no-tracking")).toHaveLength(2);
	});
	it("refuses a same-lesson private read hiding a required public target", () => {
		const source = `---\nvariables:\n  picked: false\n---\n# Practice\n${choice("name=priv private")}${choice("name=publicRequired required")}::: rule\nif: @priv.isCompleted is true\nthen: hide @publicRequired\n:::\n`;
		const diagnostics = validateCourse([{ path: "same.prax", tree: grammar(source) }]).diagnostics;
		expect(diagnostics.filter((d) => d.code === "practice-no-tracking")).toMatchObject([
			{ path: "same.prax", column: 1, span: { start: source.indexOf("if:") } },
		]);
	});
	it("requires direct targets and mixed nested containers at 22:1", () => {
		const activity = `# P\n::: accordion Outer {name=outer}\n:: Item\n::: tabs Inner {name=inner}\n:: Tab\n${choice("private name=priv")}::: text\nOrdinary sibling\n:::\n:::\n:::\n`;
		for (const target of ["priv", "inner", "outer"]) {
			const source = at20("if: publicFlag is true", `require @${target}`);
			expect(tracking(source, activity)).toMatchObject([
				{ path: "rules.prax", line: 22, column: 1, span: { start: source.indexOf("then:") } },
			]);
		}
	});
	it("allows public conditions to show/hide private targets and scalar lookalikes", () => {
		for (const action of [
			"show @priv",
			"hide @priv",
			"add picked + block:priv.score",
			'set picked = "block:priv.score"',
		])
			expect(tracking(at20("if: publicFlag is true", action))).toEqual([]);
	});
	it("keeps require and private field reads for ordinary choices and optional containers", () => {
		const activity = `# P\n::: accordion Container {name=outer}\n:: Item\n${choice("name=priv private=false")}:::\n`;
		expect(course(at20("if: @priv.isCompleted is true", "require @outer"), activity)).toEqual([]);
	});
	it.each(["en", "fr"] as const)("uses exact %s messages with no authored content", (locale) => {
		for (const [code, message] of Object.entries(text[locale]))
			expect(catalogs[locale][code]).toBe(message);
		const source = `# P\n${choice("private scored")}`;
		const formatted = readLesson(source, {
			formatMessage: (message) => catalogs[locale][message.key.replace("grammar.v4.", "")],
		});
		expect(
			formatted.errors.find((e) => e.messageRef.key === "grammar.v4.private-choice-practice-only")
				?.message,
		).toBe(text[locale]["private-choice-practice-only"]);
		expect(
			JSON.stringify(tracking(at20("if: @priv.selectedOption is true", "set picked = true"))),
		).not.toMatch(/Question|Yes|selectedOption/);
	});
});
