import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { collectGlossaryTerms } from "../glossary-page";
import { assertPracticeLogic, prepareHtmlCourse } from "../html-gen";
import { validateModuleDeck } from "../module-deck";
import { renderBlockHtml } from "../render-block-html";

const sheet: PraxityBlock = {
	id: "sheet-id",
	name: "sheet",
	type: "retrievalSheet",
	data: { level: 2, content: { title: "T", questions: [{ id: "q", question: "Q", answer: "A" }] } },
};
const outer: PraxityBlock = {
	id: "outer-id",
	name: "outer",
	type: "accordion",
	data: { items: [{ id: "panel", blocks: [sheet] }] },
};
const pages = (extra: PraxityBlock[]): PraxityPage[] => [
	{ id: "page", title: "P", blocks: [outer, ...extra] },
];
const rule = (data: Record<string, unknown>): PraxityBlock => ({ id: "rule", type: "logic", data });

it.each(["sheet", "sheet-id", "@sheet"])(
	"refuses compiled field reads via %s in every action",
	(ref) => {
		for (const field of ["score", "answer", "isAttempted", "isCompleted", "anything"])
			for (const action of ["show", "hide", "setVariable", "disableCompletion"])
				expect(() =>
					assertPracticeLogic(
						pages([
							rule({
								conditions: { rules: [{ source: `block:${ref}`, field }] },
								actions: [{ type: action, targets: ["public"] }],
							}),
						]),
					),
				).toThrowError(
					expect.objectContaining({
						code: "practice-no-tracking",
						blockId: "rule",
						referencePath: "pages[0].blocks[1].data.conditions.rules[0].source",
					}),
				);
	},
);
it.each(["sheet", "@sheet-id", "outer", "@outer-id"])(
	"refuses require and alias targets %s",
	(ref) => {
		for (const action of [
			{ type: "require", targets: [ref] },
			{ type: "requireCompletion", target: ref },
		])
			expect(() => assertPracticeLogic(pages([rule({ actions: [action] })]))).toThrowError(
				expect.objectContaining({ code: "practice-no-tracking" }),
			);
	},
);
it.each(["required", "deckGate", "_deckGate"])("refuses compiled container %s", (setting) => {
	const input = pages([]);
	input[0].blocks[0] = {
		...outer,
		data: { ...outer.data, [setting]: setting === "required" ? true : "attempt" },
	};
	expect(() => assertPracticeLogic(input)).toThrowError(
		expect.objectContaining({
			code: "practice-no-tracking",
			referencePath: `pages[0].blocks[0].data.${setting}`,
		}),
	);
});
it("refuses visibility and object operands but allows public show/hide targets", () => {
	for (const data of [
		{ visible: "@sheet.anything is true" },
		{ operand: { ref: "block:sheet", field: "answer" } },
		{ content: '<span data-mention="blockOutput:sheet:score"></span>' },
	])
		expect(() => assertPracticeLogic(pages([rule(data)]))).toThrowError(
			expect.objectContaining({ code: "practice-no-tracking" }),
		);
	expect(() =>
		assertPracticeLogic(
			pages([
				rule({
					conditions: { rules: [{ source: "variable:flag" }] },
					actions: [
						{ type: "show", targets: ["sheet"] },
						{ type: "hide", targets: ["outer"] },
					],
				}),
			]),
		),
	).not.toThrow();
});
it("does not interpret a sheet's literal HTML-looking fields as logic or glossary", () => {
	const read = readLesson(
		'# P\n::: retrieval-sheet [term]{definition}\n:: @icon{star} @footer{note}\nanswer: <span data-mention="blockOutput:sheet:score">[other]{definition}</span>\n:::\n',
	);
	const block = read.blocks.find((b) => b.type === "retrievalSheet");
	if (!block) throw new Error("Missing typed sheet");
	expect(collectGlossaryTerms(read.pages)).toEqual([]);
	expect(() =>
		assertPracticeLogic([{ ...read.pages[0], blocks: [{ ...block, name: "sheet" }] }]),
	).not.toThrow();
});
it.each(["en", "fr"])("admits compiled publication in %s", (locale) => {
	expect(() =>
		prepareHtmlCourse({
			id: "course",
			title: "C",
			sourceLocale: locale,
			totalPages: 1,
			pages: pages([]),
		}),
	).not.toThrow();
});

it.each(["sheet-id", "outer-id"])(
	"refuses effective deck gate %s before generic gate errors",
	(id) => {
		expect(() => validateModuleDeck({ gates: { [id]: "attempt" } }, pages([]), "fr")).toThrowError(
			expect.objectContaining({
				code: "practice-no-tracking",
				blockId: id,
				referencePath: `moduleDeck.gates.${id}`,
			}),
		);
	},
);

it("dispatches the public sheet through renderBlockHtml", () => {
	const html = renderBlockHtml(sheet);
	expect(html).toContain("data-retrieval-sheet");
	expect(html).toContain('data-retrieval-side="front"');
	expect(html).toContain('data-retrieval-side="back"');
	expect(html).toContain("<p>Q</p>");
	expect(html).toContain("<p>A</p>");
	expect(html).not.toMatch(/data-(completed|attempted|signed|paid)/);
});

// Raw compiled callers can bypass the source group-membership validator.
for (const locale of ["en", "fr"]) {
	it.each([
		{ shape: "nested sheet", member: sheet.id, blocks: [outer] },
		{ shape: "container holding a sheet", member: outer.id, blocks: [outer] },
		{ shape: "sibling sheet", member: sheet.id, blocks: [sheet] },
	])(`refuses $shape in compiled group membership (${locale})`, ({ member, blocks }) => {
		const group: PraxityBlock = {
			id: "group",
			type: "assessmentGroup",
			data: { groupName: "Practice", mode: "all", memberBlockIds: ["public", member] },
		};
		expect(() =>
			assertPracticeLogic([{ id: "page", title: "P", blocks: [...blocks, group] }], locale),
		).toThrowError(
			expect.objectContaining({
				code: "practice-no-tracking",
				blockId: "group",
				referencePath: "pages[0].blocks[1].data.memberBlockIds[1]",
				message:
					locale === "fr"
						? "Cette activité de pratique ne peut être lue par la logique du cours, modifier l’état du cours, fournir un score ou une condition de progression, ni être obligatoire directement ou par l’intermédiaire d’un conteneur."
						: "This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container.",
			}),
		);
	});
}

it("allows a public group alongside a sheet that is not a member", () => {
	const ordinary: PraxityBlock = {
		id: "ordinary",
		type: "assessment",
		data: {
			assessmentType: "choice",
			gradingMode: "none",
			response: {
				type: "choice",
				selectionMode: "single",
				options: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
			},
		},
	};
	const group: PraxityBlock = {
		id: "group",
		type: "assessmentGroup",
		data: { groupName: "Public group", mode: "all", memberBlockIds: [ordinary.id] },
	};
	expect(() => assertPracticeLogic(pages([ordinary, group]))).not.toThrow();
});

it.each([
	null,
	undefined,
	{},
	{ content: null },
	{ content: { title: "T", questions: [] } },
	{ content: { title: " ", questions: [{ id: "q", question: "Q", answer: "A" }] } },
	{ content: { title: "T", questions: [{ id: "bad id", question: "Q", answer: "A" }] } },
	{ content: { title: "T", questions: [{ id: "q", question: "Q", answer: " " }] } },
	{
		content: {
			title: "T",
			questions: Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, question: "Q", answer: "A" })),
		},
	},
	{
		content: { title: "T", questions: [{ id: "q", question: "x".repeat(401), answer: "SECRET" }] },
	},
])("codes malformed nested compiled sheet data=%s", (data) => {
	const malformed = { ...sheet, id: "malformed", data } as unknown as PraxityBlock;
	const container: PraxityBlock = {
		id: "container",
		type: "accordion",
		data: { items: [{ id: "panel", title: "Panel", children: [malformed] }] },
	};
	for (const render of [
		() => renderBlockHtml(container),
		() =>
			prepareHtmlCourse({
				id: "course",
				title: "C",
				sourceLocale: "fr",
				totalPages: 1,
				pages: [{ id: "page", title: "P", blocks: [container] }],
			}),
	]) {
		expect(render).toThrowError(
			expect.objectContaining({ code: "retrieval-sheet-invalid", blockId: "malformed" }),
		);
		try {
			render();
		} catch (error) {
			expect(String(error)).not.toContain("SECRET");
		}
	}
});
it("localizes compiled retrieval-sheet-invalid advice in French", () => {
	expect(() =>
		prepareHtmlCourse({
			id: "course",
			title: "C",
			sourceLocale: "fr",
			totalPages: 1,
			pages: [
				{ id: "page", title: "P", blocks: [{ ...sheet, data: null } as unknown as PraxityBlock] },
			],
		}),
	).toThrowError(
		expect.objectContaining({
			code: "retrieval-sheet-invalid",
			message:
				"La bibliothèque de fiches de rappel refuse ce contenu. Vérifiez le titre, les questions et les réponses.",
		}),
	);
});
it.each(["group", "required"])("refuses compiled %s through publication admission", (kind) => {
	const blocks =
		kind === "group"
			? [
					sheet,
					{
						id: "group",
						type: "assessmentGroup",
						data: { memberBlockIds: [sheet.id] },
					} as PraxityBlock,
				]
			: [{ ...outer, data: { ...outer.data, required: true } }];
	expect(() =>
		prepareHtmlCourse({
			id: "course",
			title: "C",
			sourceLocale: "en",
			totalPages: 1,
			pages: [{ id: "page", title: "P", blocks }],
		}),
	).toThrowError(expect.objectContaining({ code: "practice-no-tracking" }));
});
