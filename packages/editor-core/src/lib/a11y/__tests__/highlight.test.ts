import { readHighlightContent, readLesson } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { checkCourseAccessibility, collectAllBlocksDeep } from "../checker";
import { RULE_METADATA } from "../rule-metadata";

const practice =
	"::: highlight PRIVATE-TITLE\nquestion: PRIVATE-QUESTION\n:: PRIVATE-TARGET {key}\nnote: PRIVATE-NOTE\n:: Other\n:::\n";
const source = (body = practice) => `---\ntitle: Practice\n---\n# Reading\n${body}`;
const audit = (body = practice) => {
	const read = readLesson(source(body));
	return checkCourseAccessibility(
		read.pages,
		undefined,
		new Map(read.pages.map((page) => [page.id, { read }])),
	);
};
it("adds location-only support advice on explicit author Check, never a conformance failure", () => {
	const read = readLesson(source());
	expect(checkCourseAccessibility(read.pages).issues).toEqual([]);
	const report = checkCourseAccessibility(
		read.pages,
		undefined,
		new Map([[read.pages[0].id, { read }]]),
	);
	expect(report).toMatchObject({ failed: 0, cantTell: 1 });
	expect(report.issues).toEqual([
		expect.objectContaining({
			rule: "highlight-limited-support",
			severity: "minor",
			outcome: "cantTell",
			blockId: read.pages[0].blocks.find((b) => b.type === "highlight")!.id,
			sourceLocation: "source:5:highlight",
		}),
	]);
	expect(JSON.stringify(report)).not.toMatch(/PRIVATE-/);
	expect(RULE_METADATA["highlight-limited-support"]).toMatchObject({
		kind: "advisory",
		exportPolicy: "review",
		requirements: [],
	});
});
it.each([
	practice.replace("{key}", ""),
	practice.replace("PRIVATE-TARGET", "x".repeat(1501)),
	practice
		.replace("::: highlight PRIVATE-TITLE", "::: highlight PRIVATE-TITLE {mode=evidence}")
		.replace("question: PRIVATE-QUESTION\n", ""),
	practice.replace("{key}", '{key="true"}'),
])("adds no advice to refused source: %s", (body) => {
	const read = readLesson(source(body));
	expect(read.diagnostics.some((d) => d.severity === "error")).toBe(true);
	expect(audit(body).issues).toEqual([]);
});
it("maps nested editor identities to fresh source and excludes other pages", () => {
	const body = `::: accordion\n:: Panel\n${practice}:: Other\nText\n:::\n# Second\n${practice}`;
	const fresh = readLesson(source(body));
	const editor = readLesson(source(body), {
		ids: (node, role) => `editor-${node.span.start}-${role ?? "node"}`,
	});
	const report = checkCourseAccessibility(
		[editor.pages[0]],
		undefined,
		new Map([[editor.pages[0].id, { read: fresh, spans: editor.spans }]]),
	);
	expect(report.issues).toEqual([
		expect.objectContaining({
			blockId: collectAllBlocksDeep(editor.pages[0].blocks).find((b) => b.type === "highlight")!.id,
			pageId: editor.pages[0].id,
			sourceLocation: "source:7:highlight",
		}),
	]);
});
it.each(["bad id", "x".repeat(121)])(
	"skips source with upstream-refused real identities: %s",
	(prefix) => {
		const read = readLesson(source(), {
			ids: (node, role) => `${prefix}-${node.span.start}-${role ?? "node"}`,
		});
		const block = read.pages[0].blocks.find((b) => b.type === "highlight")!;
		expect(() => readHighlightContent(read, block.id)).toThrow("highlight-content-invalid");
		expect(
			checkCourseAccessibility(read.pages, undefined, new Map([[read.pages[0].id, { read }]]))
				.issues,
		).toEqual([]);
	},
);
it("keeps broken identity indexes visible", () => {
	const read = readLesson(source());
	const item = [...read.nodes.values()].find((r) => r.node.kind === "item")!;
	read.nodes.delete(item.id);
	expect(() =>
		checkCourseAccessibility(read.pages, undefined, new Map([[read.pages[0].id, { read }]])),
	).toThrow(expect.objectContaining({ code: "highlight-identity-invalid" }));
});
it.each([
	[
		"en",
		en,
		"Highlight practice support",
		"Highlight is optional, unsaved practice with visible text. Edit its source and print through the browser. Native PDF and block narration are unavailable.",
	],
	[
		"fr",
		fr,
		"Prise en charge de l'exercice de surlignage",
		"L'exercice de surlignage est une pratique facultative, non enregistrée, avec le texte visible. Modifiez sa source et imprimez depuis le navigateur. Le PDF natif et la narration de bloc ne sont pas disponibles.",
	],
] as const)("uses exact %s support copy", (locale, messages, title, description) => {
	const t = createTranslator({ locale, messages, namespace: "a11yAudit" });
	expect(t("rules.highlight-limited-support.title")).toBe(title);
	expect(t("rules.highlight-limited-support.description")).toBe(description);
});
