import { readLesson } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { checkCourseAccessibility } from "../checker";
import { RULE_METADATA } from "../rule-metadata";

const source = (
	question = "PUBLIC_QUESTION",
	right = "HIDDEN_RIGHT",
	label = "HIDDEN_LABEL",
	option = "HIDDEN_OPTION",
) =>
	`---\ntitle: Practice\n---\n# Practice\n::: write-distractors ${question}\nanswer: ${right}\n:: ${label}\noption: ${option}\n:::\n`;
const cases = [
	[
		"write-distractors-author-right",
		source(undefined, undefined, undefined, " hidden_right "),
		8,
		{},
		"warning",
	],
	["practice-question-too-long", source("Q".repeat(401)), 5, { max: 400 }, "error"],
	[
		"practice-right-answer-too-long",
		source(undefined, `HIDDEN_RIGHT${"😀".repeat(301)}`),
		6,
		{ max: 300 },
		"error",
	],
	[
		"practice-misconception-too-long",
		source(undefined, undefined, `HIDDEN_LABEL${"😀".repeat(121)}`),
		7,
		{ max: 120 },
		"error",
	],
	[
		"practice-option-too-long",
		source(undefined, undefined, undefined, `HIDDEN_OPTION${"😀".repeat(301)}`),
		8,
		{ max: 300 },
		"error",
	],
	[
		"write-distractors-duplicate-label",
		source().replace(":::\n", ":: hidden_label\noption: HIDDEN_OTHER\n:::\n"),
		9,
		{},
		"error",
	],
] as const;

it.each(cases)(
	"forwards owned %s diagnostics to Check without excerpts",
	(code, text, line, args, severity) => {
		const read = readLesson(text);
		const report = checkCourseAccessibility(
			read.pages,
			undefined,
			new Map(read.pages.map((page) => [page.id, { read }])),
		);
		const start = text
			.split(/(?<=\n)/)
			.slice(0, line - 1)
			.join("").length;
		const end = text.indexOf("\n", start) + 1;
		expect(read.diagnostics).toContainEqual(
			expect.objectContaining({
				code,
				line,
				column: 1,
				severity,
				span: expect.objectContaining({ start, end }),
				message: { key: `grammar.v4.${code}`, args: expect.objectContaining(args) },
			}),
		);
		expect(report.issues).toEqual([
			expect.objectContaining({
				rule: code,
				grammarDiagnostic: code,
				messageValues: args,
				outcome: severity === "warning" ? "cantTell" : "failed",
				sourceLocation: `source:${line}:1:${code}`,
			}),
		]);
		expect(JSON.stringify(report)).not.toMatch(/HIDDEN_|hidden_/);
		expect(RULE_METADATA).toHaveProperty(code);
		expect(RULE_METADATA[code]).toMatchObject(
			severity === "warning"
				? { kind: "contentQuality", displaySeverity: "minor", exportPolicy: "review" }
				: {
						kind: "conformance",
						displaySeverity: "critical",
						exportPolicy: "block",
						requirements: [],
					},
		);
		expect(report.issues[0]).not.toHaveProperty("sourceSpan");
	},
);

it("uses fresh source and editor spans across nested activities and pages", () => {
	const old = source()
		.replace("::: write-distractors", "::: accordion\n:: Practice\n::: write-distractors")
		.replace(":::\n", ":::\n:::\n");
	const editor = readLesson(old, {
		ids: (node, role) => `editor-${node.span.start}-${role ?? "node"}`,
	});
	const fresh = readLesson(
		old.replace("HIDDEN_OPTION", "HIDDEN_RIGHT") +
			"# Other\n" +
			source().split("# Practice\n")[1].replace("HIDDEN_OPTION", "HIDDEN_RIGHT"),
	);
	const report = checkCourseAccessibility(
		[editor.pages[0]],
		undefined,
		new Map([[editor.pages[0].id, { read: fresh, spans: editor.spans }]]),
	);
	expect(report.issues.filter((issue) => issue.rule === "write-distractors-author-right")).toEqual([
		expect.objectContaining({
			rule: "write-distractors-author-right",
			pageId: editor.pages[0].id,
			sourceLocation: "source:10:1:write-distractors-author-right",
		}),
	]);
	expect(JSON.stringify(report)).not.toMatch(/HIDDEN_/);
});

it("leaves clean and unrelated source without distractor advice", () => {
	for (const text of [
		source(),
		source().replace("HIDDEN_OPTION", "Other wrong answer"),
		"---\ntitle: Practice\n---\n# Practice\nText\n",
	]) {
		const read = readLesson(text);
		expect(
			checkCourseAccessibility(
				read.pages,
				undefined,
				new Map(read.pages.map((page) => [page.id, { read }])),
			).issues,
		).toEqual([]);
	}
});

it("does not forward planted hidden diagnostic arguments", () => {
	const read = readLesson(source(undefined, undefined, undefined, "HIDDEN_RIGHT"));
	const warning = read.diagnostics.find((d) => d.code === "write-distractors-author-right");
	if (!warning) throw new Error("Missing warning");
	warning.message.args.excerpt = "HIDDEN_DIAGNOSTIC_EXCERPT";
	const report = checkCourseAccessibility(
		read.pages,
		undefined,
		new Map(read.pages.map((page) => [page.id, { read }])),
	);
	expect(report.issues[0].messageValues).toEqual({});
	expect(JSON.stringify(report)).not.toContain("HIDDEN_");
});

const copy = [
	[
		"write-distractors-author-right",
		{},
		"This wrong option matches the right answer. Review it.",
		"Cette mauvaise réponse correspond à la bonne réponse. Revoyez-la.",
	],
	[
		"write-distractors-duplicate-label",
		{},
		"Give each mistaken idea a distinct label.",
		"Donnez un libellé distinct à chaque idée fausse.",
	],
	[
		"practice-question-too-long",
		{ max: 400 },
		"Keep the question to 400 Unicode code points or fewer.",
		"Limitez la question à 400 points de code Unicode.",
	],
	[
		"practice-right-answer-too-long",
		{ max: 300 },
		"Keep the right answer to 300 Unicode code points or fewer.",
		"Limitez la bonne réponse à 300 points de code Unicode.",
	],
	[
		"practice-misconception-too-long",
		{ max: 120 },
		"Keep the mistaken idea label to 120 Unicode code points or fewer.",
		"Limitez le libellé de l'idée fausse à 120 points de code Unicode.",
	],
	[
		"practice-option-too-long",
		{ max: 300 },
		"Keep the wrong option to 300 Unicode code points or fewer.",
		"Limitez la mauvaise réponse à 300 points de code Unicode.",
	],
] as const;
it.each(copy)("keeps exact EN/FR diagnostic copy for %s", (code, args, english, french) => {
	for (const [locale, messages, expected] of [
		["en", en, english],
		["fr", fr, french],
	] as const) {
		const t = createTranslator({ locale, messages, namespace: "op.diagnostic" });
		expect(t(code, args)).toBe(expected);
		expect(t(code, args)).not.toMatch(/HIDDEN_/);
	}
});

it.each([false, true])(
	"ignores a different editor block type at the same source span, spans=%s",
	(withSpans) => {
		const read = readLesson(source(undefined, undefined, undefined, "HIDDEN_RIGHT"));
		const pages = read.pages.map((page) => ({
			...page,
			blocks: page.blocks.map((block) =>
				block.type === "writeDistractors"
					? { ...block, type: "text" as const, data: { content: "Public replacement" } }
					: block,
			),
		}));
		const report = checkCourseAccessibility(
			pages,
			undefined,
			new Map(pages.map((page) => [page.id, { read, spans: withSpans ? read.spans : undefined }])),
		);
		expect(
			report.issues.filter((issue) => issue.rule === "write-distractors-author-right"),
		).toEqual([]);
	},
);
