import { readLesson, readRetrievalSheetContent } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { checkCourseAccessibility, collectAllBlocksDeep } from "../checker";
import { RULE_METADATA } from "../rule-metadata";

const sheet = (rows: [string, string][]) =>
	`::: retrieval-sheet Recall\n${rows.map(([q, a]) => `:: ${q}\nanswer: ${a}\n`).join("")}:::\n`;
const source = (body: string) => `---\ntitle: Practice\n---\n# Practice\n${body}`;
const audit = (body: string) => {
	const read = readLesson(source(body));
	return checkCourseAccessibility(
		read.pages,
		undefined,
		new Map(read.pages.map((page) => [page.id, { read }])),
	);
};

const rules = [
	[
		"retrieval-sheet-answer-repeats-question",
		"Answer repeats its question",
		"An answer repeats its question. Write the information the learner should recall.",
		"La réponse répète sa question",
		"Une réponse répète sa question. Indiquez les informations que la personne doit se rappeler.",
	],
	[
		"retrieval-sheet-duplicate-question",
		"Repeated question",
		"A question repeats an earlier question on this sheet. Review whether each item asks for something distinct.",
		"Question répétée",
		"Une question répète une question précédente de cette fiche. Vérifiez si chaque élément demande une information distincte.",
	],
] as const;

it.each([
	["retrieval-sheet-answer-repeats-question", [["What is recall?", "  WHAT is  recall?  "]]],
	[
		"retrieval-sheet-answer-repeats-question",
		[["Qu’est-ce que le rappel?", "QU’EST-CE que le rappel?"]],
	],
	[
		"retrieval-sheet-duplicate-question",
		[
			["What is Café?", "First."],
			["  WHAT is Café?", "Second."],
		],
	],
	[
		"retrieval-sheet-duplicate-question",
		[
			["Où commencer?", "Ici."],
			["OÙ  commencer?", "Là."],
		],
	],
] as [string, [string, string][]][])(
	"emits only advisory %s for rows %j without authored excerpts",
	(rule, rows) => {
		const report = audit(sheet(rows));
		expect(report.issues.map((issue) => issue.rule)).toEqual([rule]);
		expect(report).toMatchObject({ failed: 0, cantTell: 1 });
		expect(report.issues[0]).toMatchObject({ severity: "minor", outcome: "cantTell" });
		for (const [q, a] of rows) {
			expect(JSON.stringify(report)).not.toContain(q.trim());
			expect(JSON.stringify(report)).not.toContain(a.trim());
		}
	},
);

it.each([
	"Name three bones of the arm",
	"List the stages of mitosis",
	"Nommez trois os du bras",
	"Citez les étapes de la mitose",
	"Peut-on recycler",
	"Existe-t-il une exception",
	"À quoi sert le rappel",
	"En quelle année",
	"In which year",
	"For what reason",
	"Isn’t recall useful",
	"Doesn’t recall help",
	"The recall process",
	"Le processus de rappel",
])("does not judge prompt phrasing: %s", (question) => {
	expect(audit(sheet([[question, "A distinct answer."]])).issues).toEqual([]);
});

it("accepts a clean bilingual sheet and distinct questions sharing words", () => {
	expect(
		audit(
			sheet([
				["What is recall?", "Retrieving from memory."],
				["Comment rappeler?", "Sans regarder."],
			]),
		).issues,
	).toEqual([]);
});

it.each(
	(
		[
			[["Recall", ""]],
			[["Recall", "a".repeat(1501)]],
			[["x".repeat(401), "x".repeat(401)]],
			Array.from({ length: 9 }, () => ["Recall", "Recall"]),
		] as [string, string][][]
	).map((rows) => [rows] as const),
)("leaves grammar refusals to grammar without advice for rows %j", (rows) => {
	const body = sheet(rows);
	const read = readLesson(source(body));
	expect(read.diagnostics.some((d) => d.severity === "error")).toBe(true);
	expect(audit(body).issues).toEqual([]);
});

it("uses nested editor identities, audits once and excludes other pages", () => {
	const body = `::: accordion\n:: Panel\n${sheet([["What is recall?", "What is recall?"]])}:: Other\nText\n:::\n# Second\n${sheet([["What is recall?", "Retrieve."]])}`;
	const editor = readLesson(source(body), {
		ids: (node, role) => `editor-${node.span.start}-${role ?? "node"}`,
	});
	const read = readLesson(source(body));
	const report = checkCourseAccessibility(
		editor.pages,
		undefined,
		new Map(editor.pages.map((page) => [page.id, { read, spans: editor.spans }])),
	);
	expect(report.issues).toHaveLength(1);
	expect(report.issues[0]).toMatchObject({
		pageId: editor.pages[0].id,
		blockId: collectAllBlocksDeep(editor.pages[0].blocks).find((b) => b.type === "retrievalSheet")
			?.id,
		sourceLocation: "source:9:questions[0].answer",
	});
});

it.each(rules)(
	"has literal EN/FR advice and review-only metadata: %s",
	(rule, enTitle, enMessage, frTitle, frMessage) => {
		expect(RULE_METADATA[rule]).toMatchObject({
			kind: "contentQuality",
			exportPolicy: "review",
			requirements: [],
		});
		for (const [locale, messages, title, message] of [
			["en", en, enTitle, enMessage],
			["fr", fr, frTitle, frMessage],
		] as const) {
			const t = createTranslator({ locale, messages, namespace: "a11yAudit" });
			expect(t(`rules.${rule}.title`)).toBe(title);
			expect(t(`rules.${rule}.description`)).toBe(message);
		}
	},
);

it("audits fresh source when stale editor blocks still contain removed items", () => {
	const stale = readLesson(
		source(
			sheet([
				["Old A", "Distinct A"],
				["Old B", "Distinct B"],
				["Stale third", "Stale third"],
			]),
		),
		{ ids: (node, role) => `editor-${node.span.start}-${role ?? "node"}` },
	);
	const fresh = readLesson(
		source(
			"::: retrieval-sheet Recall\n:: Fresh recall\nanswer: First answer\n  continued\n  again\n:: Fresh recall\nanswer: Distinct answer\n:::\n",
		),
	);
	const staleSheet = stale.pages[0].blocks.find((b) => b.type === "retrievalSheet");
	const freshSheet = fresh.pages[0].blocks.find((b) => b.type === "retrievalSheet");
	if (!staleSheet || !freshSheet) throw new Error("Missing sheet fixture");
	expect(staleSheet.id).not.toBe(freshSheet.id);
	expect(stale.spans.get(staleSheet.id)).toEqual(fresh.spans.get(freshSheet.id));
	const report = checkCourseAccessibility(
		stale.pages,
		undefined,
		new Map([[stale.pages[0].id, { read: fresh, spans: stale.spans }]]),
	);
	expect(report.issues).toEqual([
		expect.objectContaining({
			rule: "retrieval-sheet-duplicate-question",
			blockId: staleSheet.id,
			sourceLocation: "source:10:questions[1].question",
		}),
	]);
	expect(JSON.stringify(report)).not.toMatch(
		/Old A|Old B|Stale third|Fresh recall|Distinct answer/,
	);
});

it.each(["bad id", "x".repeat(121)])(
	"skips content refused by the accessor's real-identity validation: %s",
	(prefix) => {
		const read = readLesson(source(sheet([["Recall", "Recall"]])), {
			ids: (node, role) => `${prefix}-${node.span.start}-${role ?? "node"}`,
		});
		const block = read.pages[0].blocks.find((block) => block.type === "retrievalSheet");
		if (!block) throw new Error("Missing sheet fixture");
		expect(read.diagnostics.map((d) => d.code)).toEqual([]);
		expect(() => readRetrievalSheetContent(read, block.id)).toThrowError(
			"retrieval-sheet-content-invalid",
		);
		expect(
			checkCourseAccessibility(read.pages, undefined, new Map([[read.pages[0].id, { read }]]))
				.issues,
		).toEqual([]);
	},
);

it("keeps identity integrity errors visible instead of treating them as invalid content", () => {
	const read = readLesson(source(sheet([["Recall", "Recall"]])));
	const item = [...read.nodes.values()].find((record) => record.node.kind === "item");
	if (!item) throw new Error("Missing item fixture");
	read.nodes.delete(item.id);
	expect(() =>
		checkCourseAccessibility(read.pages, undefined, new Map([[read.pages[0].id, { read }]])),
	).toThrowError(expect.objectContaining({ code: "retrieval-sheet-identity-invalid" }));
});
