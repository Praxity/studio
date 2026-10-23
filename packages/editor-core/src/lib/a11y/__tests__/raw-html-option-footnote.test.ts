import { readLesson } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { checkCourseAccessibility } from "../checker";
import { isExportBlockingIssue, RULE_METADATA } from "../rule-metadata";

const rule = "choice-raw-html-footnote";
const audit = (label: string) => {
	const read = readLesson(`# Question\n::: choice Choose\n(x) ${label}\n( ) No\n:::\n`);
	expect(read.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
	const before = structuredClone(read.pages);
	const report = checkCourseAccessibility(read.pages);
	expect(read.pages).toEqual(before);
	return report.issues.filter((issue) => issue.rule === rule);
};

it.each([
	"<em>Yes</em> @source{N}",
	"Use `<em>` tag @footer{N}",
	"<strong>Yes</strong> @sources",
	"<span>Yes</span> @footer.insert",
	'<span class="@source{N}">Yes</span>',
])("advises on raw source containing HTML and a footnote reference: %s", (label) => {
	expect(audit(label)).toEqual([
		expect.objectContaining({
			rule,
			severity: "minor",
			outcome: "cantTell",
			message:
				"Learners may see the footnote as plain text. Editing the note later may make them answer again. Use Markdown formatting or move the note to the question.",
			sourceLocation: "data.response.options[0].label",
		}),
	]);
	expect(audit(label).some(isExportBlockingIssue)).toBe(false);
});

it.each(["Yes @source{N}", "**Yes** @footer{N}", "<em>Yes</em>", "<em>Yes</em> @source{}"])(
	"does not advise without both recognized forms: %s",
	(label) => expect(audit(label)).toEqual([]),
);

it("does not advise on non-choice blocks", () => {
	const read = readLesson("# Text\n<em>Yes</em> @source{N}\n");
	expect(
		checkCourseAccessibility(read.pages).issues.filter((issue) => issue.rule === rule),
	).toEqual([]);
});

it("registers advice without a conformance claim", () => {
	expect(RULE_METADATA[rule]).toMatchObject({
		kind: "advisory",
		exportPolicy: "review",
		requirements: [],
	});
});

it("locates each nested option separately", () => {
	const read = readLesson(
		"# Question\n::: accordion\n:: Panel\n::: choice Choose\n(x) <em>Yes</em> @source{N}\n( ) <em>No</em> @source{N}\n:::\n:::\n",
	);
	const issues = checkCourseAccessibility(read.pages).issues.filter((issue) => issue.rule === rule);
	expect(issues.map((issue) => issue.sourceLocation)).toEqual([
		"data.response.options[0].label",
		"data.response.options[1].label",
	]);
	expect(new Set(issues.map((issue) => issue.blockId)).size).toBe(1);
});

it.each([
	[
		"en",
		en,
		"Footnote in an option with HTML",
		"Learners may see the footnote as plain text. Editing the note later may make them answer again. Use Markdown formatting or move the note to the question.",
	],
	[
		"fr",
		fr,
		"Note de bas de page dans une option avec HTML",
		"Les apprenants peuvent voir la note en texte brut. Si vous la modifiez plus tard, ils devront peut-être répondre de nouveau. Utilisez la mise en forme Markdown ou déplacez la note dans la question.",
	],
] as const)("uses exact %s advice copy", (locale, messages, title, description) => {
	const t = createTranslator({ locale, messages, namespace: "a11yAudit" });
	expect(t(`rules.${rule}.title`)).toBe(title);
	expect(t(`rules.${rule}.description`)).toBe(description);
});
