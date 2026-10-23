import { readLesson } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { checkCourseAccessibility, collectAllBlocksDeep } from "../checker";
import { RULE_METADATA } from "../rule-metadata";

const selfCheck =
	"::: self-check Explain the [delay](https://example.com).\nmodel: The data arrived late.\n:: Reason\nmissed: Explain the cause.\n:::\n";

// A self-check's content is structured, not HTML; the literal task holds no link.
it.each([
	["on a page", `# Page\n\n${selfCheck}`, []],
	[
		"inside an accordion",
		`# Page\n\n::: accordion\n:: Panel\n${selfCheck}:::\n`,
		["container-single-item"],
	],
])("checks a self-check %s", (_where, source, rules) => {
	const report = checkCourseAccessibility(readLesson(source).pages);
	expect(report.issues.map((issue) => issue.rule)).toEqual(rules);
});

function audit(source: string) {
	const read = readLesson(`---\ntitle: Practice\n---\n# Practice\n${source}`);
	return checkCourseAccessibility(
		read.pages,
		undefined,
		new Map(read.pages.map((page) => [page.id, { read }])),
	);
}

const valid =
	"::: self-check Explain the delay.\nmodel: The data arrived late.\n:: Reason\nmissed: Explain the cause.\nevidence: data arrived late\n:::\n";

describe("self-check author advice through the checker", () => {
	it.each([
		[
			"evidence missing from the model",
			valid.replace("evidence: data arrived late", "evidence: HIDDEN_EVIDENCE"),
			"evidence-not-once",
			9,
		],
		["missing hint", valid.replace("missed: Explain the cause.\n", ""), "missing-part", 7],
		["blank hint", valid.replace("missed: Explain the cause.", "missed:   "), "empty-part", 8],
		[
			"repeated evidence",
			valid.replace(
				"model: The data arrived late.",
				"model: The data arrived late. The data arrived late.",
			),
			"evidence-not-once",
			9,
		],
	])("reuses grammar for %s", (_name, source, code, line) => {
		const report = audit(source);
		const issues = report.issues.filter((issue) => issue.rule === "self-check-grammar");
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			outcome: "failed",
			messageValues: { code, line, column: 1 },
		});
		expect(issues[0].sourceLocation).toBe(`source:${line}:1:${code}`);
		expect(JSON.stringify(report)).not.toMatch(
			/HIDDEN_EVIDENCE|The data arrived late|Explain the cause/,
		);
	});

	it("accepts valid publishable self-check content without advice", () => {
		const read = readLesson(`# Practice\n${valid}`);
		expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
		expect(audit(valid).issues).toEqual([]);
	});

	it.each([
		[
			"self-check-task-reveals-model",
			valid.replace("Explain the delay.", "Explain the delay: The data arrived late."),
			"cantTell",
		],
		[
			"self-check-model-length",
			valid.replace("The data arrived late.", `The data arrived late. ${"word ".repeat(197)}`),
			"cantTell",
		],
		[
			"self-check-criterion-length",
			// Advice retains its existing UTF-16 metric: 61 code points, 122 units.
			valid.replace(":: Reason", `:: ${"😀".repeat(61)}`),
			"cantTell",
		],
		["self-check-hint-actionable", valid.replace("Explain the cause.", "Try again."), "cantTell"],
		["self-check-hint-actionable", valid.replace("Explain the cause.", "Réessayez."), "cantTell"],
		[
			"self-check-evidence-overlap",
			valid.replace(":::\n", ":: Arrival\nmissed: Describe the arrival.\nevidence: arrived\n:::\n"),
			"cantTell",
		],
	])("emits %s with content-free advice for source %s", (rule, source, outcome) => {
		const report = audit(source);
		expect(report.issues.map((issue) => issue.rule)).toEqual([rule]);
		expect(report.issues[0]).toMatchObject({
			outcome,
			pageId: expect.any(String),
			blockId: expect.any(String),
		});
		expect(report.cantTell).toBe(1);
		expect(JSON.stringify(report)).not.toMatch(
			/The data arrived late|Explain the cause|Describe the arrival|Réessayez/,
		);
	});

	it("refuses the original 121-character criterion without forwarding authored text", () => {
		const source = valid.replace(":: Reason", `:: ${"x".repeat(121)}`);
		const report = audit(source);
		expect(report.issues.map((issue) => issue.rule)).toEqual(["self-check-grammar"]);
		expect(report.issues[0]).toMatchObject({
			outcome: "failed",
			messageValues: { code: "self-check-invalid" },
		});
		expect(JSON.stringify(report)).not.toContain("x".repeat(121));
	});

	it("accepts whole-answer criteria and limits at 200 words and 120 characters", () => {
		const source = valid
			.replace("The data arrived late.", `The data arrived late. ${"word ".repeat(196)}`)
			.replace(":: Reason", `:: ${"x".repeat(120)}`)
			.replace("evidence: data arrived late\n", "");
		expect(audit(source).issues).toEqual([]);
	});

	it("checks nested self-checks once and retains editor block identities", () => {
		const read = readLesson(
			`# Practice\n::: accordion\n:: Panel\n${valid.replace("Explain the cause.", "Try again.")}:: Other\nText\n:::\n`,
		);
		const source = readLesson(
			`# Practice\n::: accordion\n:: Panel\n${valid.replace("Explain the cause.", "Try again.")}:: Other\nText\n:::\n`,
		);
		const report = checkCourseAccessibility(
			read.pages,
			undefined,
			new Map([[read.pages[0].id, { read: source, spans: read.spans }]]),
		);
		const issues = report.issues.filter((issue) => issue.rule.startsWith("self-check"));
		expect(issues).toHaveLength(1);
		expect(issues[0].blockId).toBe(
			collectAllBlocksDeep(read.pages[0].blocks).find((block) => block.type === "selfCheck")?.id,
		);
	});

	it("requires explicit author input, keeping generic checks prompt-only", () => {
		expect(
			checkCourseAccessibility(
				readLesson(`# Practice\n${valid.replace("Explain the cause.", "Try again.")}`).pages,
			).issues,
		).toEqual([]);
	});

	it.each([
		"self-check-grammar",
		"self-check-task-reveals-model",
		"self-check-model-length",
		"self-check-criterion-length",
		"self-check-hint-actionable",
		"self-check-evidence-overlap",
	])("has EN/FR metadata for %s", (rule) => {
		expect(RULE_METADATA[rule]).toMatchObject({
			category: "assessmentInteraction",
			exportPolicy: "review",
			requirements: [],
		});
		for (const messages of [en, fr]) {
			expect(messages.a11yAudit.rules[rule].title).toBeTruthy();
			expect(messages.a11yAudit.rules[rule].description).toBeTruthy();
		}
	});
});
