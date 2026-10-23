import { readLesson, readWriteDistractorsContent } from "@praxity/grammar";
import type { TreeNode } from "@praxity/grammar/src/v4/tree";
import { prepareInlineBlocks } from "@praxity/shared-blocks/inline-markdown";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { createCourseContext, writeDistractorsContentInput } from "../build";
import { collectGlossaryTerms } from "../glossary-page";
import { assertPracticeLogic, prepareHtmlCourse } from "../html-gen";
import { validateModuleDeck } from "../module-deck";
import { renderBlockHtml } from "../render-block-html";

const source =
	"::: write-distractors Q {name=wd}\nanswer: HiddenRight\n:: HiddenLabel\noption: HiddenOption\n:::\n";
const ids = Object.assign(
	(node: Readonly<TreeNode>, role?: string) => {
		if (!role && node.type === "write-distractors") return "wd-id";
		if (!role && node.type === "accordion") return "outer-id";
		return `${node.kind}-${node.span.start}-${role ?? "owner"}`;
	},
	{ transient: true },
);
const read = readLesson(`# P\n${source}`, { ids });
const distractors = read.blocks.find((block) => block.name === "wd");
if (!distractors) throw new Error("Missing grammar-produced write-distractors block");
const nested = readLesson(`# P\n::: accordion {name=outer}\n:: Panel\n${source}:::\n`, { ids });
const outer = nested.blocks.find((block) => block.name === "outer");
if (!outer) throw new Error("Missing grammar-produced containing block");
const pages = (extra: PraxityBlock[]): PraxityPage[] => [
	{ id: "page", title: "P", blocks: [outer, ...extra] },
];
const rule = (data: Record<string, unknown>): PraxityBlock => ({ id: "rule", type: "logic", data });

it.each(["wd", "wd-id", "@wd"])("refuses compiled field reads via %s in every action", (ref) => {
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
});
it.each(["wd", "@wd-id", "outer", "@outer-id"])("refuses require and alias targets %s", (ref) => {
	for (const action of [
		{ type: "require", targets: [ref] },
		{ type: "requireCompletion", target: ref },
	])
		expect(() => assertPracticeLogic(pages([rule({ actions: [action] })]))).toThrowError(
			expect.objectContaining({ code: "practice-no-tracking" }),
		);
});
it.each(["required", "deckGate"])("refuses compiled container %s", (setting) => {
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
		{ visible: "@wd.anything is true" },
		{ operand: { ref: "block:wd", field: "answer" } },
		{ content: '<span data-mention="blockOutput:wd:score"></span>' },
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
						{ type: "show", targets: ["wd"] },
						{ type: "hide", targets: ["outer"] },
					],
				}),
			]),
		),
	).not.toThrow();
});
it.each(["en", "fr"])("admits compiled prompt-only publication in %s", (locale) => {
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

it.each(["wd-id", "outer-id"])(
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

it("renders the direct prompt without author Content", () => {
	const html = renderBlockHtml(distractors);
	expect(html).toContain("data-write-distractors");
	expect(html).not.toMatch(/HiddenRight|HiddenLabel|HiddenOption/);
});

// Raw compiled callers can bypass the source group-membership validator.
for (const locale of ["en", "fr"]) {
	it.each([
		{ shape: "nested distractors", member: distractors.id, blocks: [outer] },
		{ shape: "container holding a distractors", member: outer.id, blocks: [outer] },
		{ shape: "sibling distractors", member: distractors.id, blocks: [distractors] },
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

it("allows a public group alongside a distractors that is not a member", () => {
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

it.each([null, undefined])(
	"refuses malformed nested distractors data=%s at closed prompt admission",
	(data) => {
		const malformed = { ...distractors, id: "malformed", data } as unknown as PraxityBlock;
		const container: PraxityBlock = {
			id: "container",
			type: "accordion",
			data: { items: [{ id: "panel", title: "Panel", children: [malformed] }] },
		};
		expect(() => renderBlockHtml(container)).toThrowError(
			expect.objectContaining({
				code: "EWRITEDISTRACTORSPROMPT",
				message: "Invalid write-distractors prompt data.",
			}),
		);
		// A valid distractors keeps the compiled logic scan active while it visits malformed data.
		expect(() =>
			prepareHtmlCourse({
				id: "course",
				title: "C",
				sourceLocale: "en",
				totalPages: 1,
				pages: [{ id: "page", title: "P", blocks: [container, distractors] }],
			}),
		).toThrowError(expect.objectContaining({ code: "EWRITEDISTRACTORSPROMPT" }));
	},
);

it("projects a typed literal prompt and keeps every author-only field private", () => {
	expect(distractors).toMatchObject({
		type: "writeDistractors",
		name: "wd",
		data: { level: 2, content: { question: "Q", count: 2 } },
	});
	expect(Object.keys(distractors.data.content as object).sort()).toEqual([
		"count",
		"items",
		"question",
	]);
	for (const hidden of ["HiddenRight", "HiddenLabel", "HiddenOption"]) {
		expect(JSON.stringify(read.blocks)).not.toContain(hidden);
		expect(JSON.stringify(read.errors)).not.toContain(hidden);
	}
});

it("keeps the question literal through glossary, footnote and inline collectors", () => {
	const question = "<b>Q</b> [term]{definition} @icon{star} @footer{note}";
	const literal = readLesson(
		`# P\n::: write-distractors ${question}\nanswer: Right\n:: Label\noption: Wrong\n:::\n`,
	);
	const block = literal.blocks.find((b) => b.type === "writeDistractors");
	if (!block) throw new Error("Missing literal placeholder");
	expect(block.data).toEqual({
		level: 2,
		content: { question, count: 2, items: [expect.objectContaining({ id: expect.any(String) })] },
	});
	expect(prepareInlineBlocks([block])).toEqual([block]);
	expect(collectGlossaryTerms(literal.pages)).toEqual([]);
	expect(
		preparePageFootnotes([block], "page", { footnote: "Footnote", footnotes: "Footnotes" }),
	).toEqual([block]);
});

it.each(["private", "scored", "required", "points", "deckGate", "id"])(
	"retains compiled unsupported %s refusal",
	(key) => {
		const block = {
			...distractors,
			data: { ...distractors.data, [key]: key === "points" ? 0 : false },
		};
		expect(() =>
			prepareHtmlCourse({
				id: "course",
				title: "C",
				sourceLocale: "en",
				totalPages: 1,
				pages: [{ id: "page", title: "P", blocks: [block] }],
			}),
		).toThrowError(expect.objectContaining({ code: "EWRITEDISTRACTORSPROMPT" }));
		expect(() => renderBlockHtml(block)).toThrowError(
			expect.objectContaining({ code: "EWRITEDISTRACTORSPROMPT" }),
		);
	},
);

it.each(["field", "require", "requireContainer", "required", "deckGate", "group"])(
	"compiled publication retains %s refusal through both entries",
	async (kind) => {
		const input = structuredClone(pages([]));
		let referencePath = "pages[0].blocks[1].data.actions[0].targets[0]";
		if (kind === "field") {
			input[0].blocks.push(
				rule({
					conditions: { rules: [{ source: "block:wd", field: "isCompleted" }] },
					actions: [],
				}),
			);
			referencePath = "pages[0].blocks[1].data.conditions.rules[0].source";
		}
		if (kind === "require" || kind === "requireContainer")
			input[0].blocks.push(
				rule({ actions: [{ type: "require", targets: [kind === "require" ? "@wd" : "@outer"] }] }),
			);
		if (kind === "required" || kind === "deckGate") {
			input[0].blocks[0].data[kind] = kind === "required" ? true : "attempt";
			referencePath = `pages[0].blocks[0].data.${kind}`;
		}
		if (kind === "group") {
			input[0].blocks.push({
				id: "group",
				type: "assessmentGroup",
				data: { memberBlockIds: ["wd-id"] },
			});
			referencePath = "pages[0].blocks[1].data.memberBlockIds[0]";
		}
		const expected = { code: "practice-no-tracking", referencePath };
		expect(() =>
			prepareHtmlCourse({
				id: "course",
				title: "C",
				sourceLocale: "en",
				totalPages: 1,
				pages: input,
			}),
		).toThrowError(expect.objectContaining(expected));
		await expect(
			createCourseContext({
				id: "course",
				title: "C",
				sourceLocale: "en",
				content: input,
				writeDistractorsContents: [
					writeDistractorsContentInput(
						distractors.id,
						readWriteDistractorsContent(nested, distractors.id),
					),
				],
			}),
		).rejects.toMatchObject(expected);
	},
);
