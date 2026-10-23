import { readLesson } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import { childRecords } from "../src/child-records";
import { adaptGrammarPreviewBlocks } from "../src/grammar-adapter";
import type { PraxityBlock } from "../src/types";

const strict = (blocks: PraxityBlock[]) => adaptGrammarPreviewBlocks(blocks);
type RecordData = Record<string, unknown>;
const cases: Array<[string, PraxityBlock, (block: PraxityBlock) => RecordData[]]> = [
	[
		"match pairs",
		{
			id: "match",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "matching",
					pairs: [
						{ id: "p-a", matchId: "m-a", prompt: "A", correctMatch: "One" },
						{ id: "p-b", matchId: "m-b", prompt: "B", correctMatch: "Two" },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).pairs as RecordData[],
	],
	[
		"order steps",
		{
			id: "order",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "sequence",
					items: [
						{ id: "s-a", label: "A", correctPosition: 0 },
						{ id: "s-b", label: "B", correctPosition: 1 },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).items as RecordData[],
	],
	[
		"blanks",
		{
			id: "blank",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "fillBlank",
					blanks: [
						{ id: "b-a", answer: "A" },
						{ id: "b-b", answer: "B" },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).blanks as RecordData[],
	],
	[
		"categories",
		{
			id: "cat",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "categorize",
					categories: [
						{ id: "c-a", name: "A", items: ["same", "same"], itemIds: ["i-a", "i-b"] },
						{ id: "c-b", name: "B", items: ["C"], itemIds: ["i-c"] },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).categories as RecordData[],
	],
	[
		"matrix statements",
		{
			id: "matrix",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "matrix",
					statements: [
						{ id: "t-a", text: "A" },
						{ id: "t-b", text: "B" },
					],
					scalePoints: [
						{ id: "l-a", value: 1, label: "Low" },
						{ id: "l-b", value: 2, label: "High" },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).statements as RecordData[],
	],
	[
		"hotspot spots",
		{
			id: "spot",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "hotspot",
					hotspots: [
						{ id: "h-a", label: "A" },
						{ id: "h-b", label: "B" },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).hotspots as RecordData[],
	],
	[
		"options",
		{
			id: "choice",
			type: "assessment",
			data: {
				stem: [],
				response: {
					type: "choice",
					options: [
						{ id: "o-a", label: "A" },
						{ id: "o-b", label: "B" },
					],
				},
			},
		},
		(b) => (b.data.response as RecordData).options as RecordData[],
	],
	[
		"card items",
		{
			id: "card",
			type: "card",
			data: {
				items: [
					{ id: "f-a", label: "A", front: [], back: [], backId: "k-a" },
					{ id: "f-b", label: "B", front: [], back: [], backId: "k-b" },
				],
			},
		},
		(b) => b.data.items as RecordData[],
	],
	[
		"dialogue turns",
		{
			id: "talk",
			type: "dialogue",
			data: {
				turns: [
					{ id: "d-a", speaker: "A", paragraphs: ["Hello"] },
					{ id: "d-b", speaker: "B", paragraphs: ["Hi"] },
				],
			},
		},
		(b) => b.data.turns as RecordData[],
	],
	[
		"checklist tasks",
		{
			id: "check",
			type: "checklist",
			data: {
				items: [
					{ id: "q-a", text: "A" },
					{ id: "q-b", text: "B" },
				],
			},
		},
		(b) => b.data.items as RecordData[],
	],
	[
		"rating levels",
		{
			id: "rate",
			type: "rating",
			data: {
				scale: [
					{ id: "r-a", value: 1, label: "A" },
					{ id: "r-b", value: 2, label: "B" },
				],
			},
		},
		(b) => b.data.scale as RecordData[],
	],
	[
		"self-check criteria",
		{
			id: "self",
			type: "selfCheck",
			data: {
				content: {
					task: "T",
					parts: [{ id: "c-a" }, { id: "c-b" }],
				},
			},
		},
		(b) => (b.data.content as RecordData).parts as RecordData[],
	],
];

describe("G8 child identity through the public adapter", () => {
	it("lists self-check criteria with their reader identities and data paths", () => {
		const lesson = readLesson(
			"# P\n::: self-check Task\nmodel: Model text\n:: First\nmissed: Add it\nevidence: Model\n:: Second\nmissed: Add more\n:::\n",
			{ ids: (node, role) => `n-${node.span.start}${role ? `-${role}` : ""}` },
		);
		const block = lesson.pages[0].blocks[1];
		expect(childRecords(block)).toEqual([
			{ kind: "criterion", id: "n-42", ownerId: "n-4", path: "block.data.content.parts[0].id" },
			{ kind: "criterion", id: "n-82", ownerId: "n-4", path: "block.data.content.parts[1].id" },
		]);
		// Each record leads back to its criterion's source node.
		expect(
			childRecords(block).map((child) => lesson.nodes.get(String(child.id))?.node.subject?.value),
		).toEqual(["First", "Second"]);
	});
	it("refuses positional children synthesized from incomplete grammar-4 data", () => {
		const blank: PraxityBlock = {
			id: "incomplete",
			type: "assessment",
			data: {
				stem: [],
				response: { type: "fillBlank", template: "Answer {A}.", blanks: [{ answer: "A" }] },
			},
		};
		expect(() => strict([blank])).toThrow(/Missing child ID/);
	});
	it("exposes match sides and category entries with their owning records", () => {
		expect(
			childRecords(cases[0][1]).map(({ kind, id, ownerId }) => ({ kind, id, ownerId })),
		).toEqual([
			{ kind: "pair", id: "p-a", ownerId: "match" },
			{ kind: "match", id: "m-a", ownerId: "p-a" },
			{ kind: "pair", id: "p-b", ownerId: "match" },
			{ kind: "match", id: "m-b", ownerId: "p-b" },
		]);
		expect(
			childRecords(cases[3][1])
				.filter((child) => child.kind === "category-item")
				.map(({ id, ownerId }) => ({ id, ownerId })),
		).toEqual([
			{ id: "i-a", ownerId: "c-a" },
			{ id: "i-b", ownerId: "c-a" },
			{ id: "i-c", ownerId: "c-b" },
		]);
	});
	it("keeps separately referenced matrix levels and rejects their missing IDs", () => {
		const block = structuredClone(cases[4][1]);
		const levels = (block.data.response as RecordData).scalePoints as RecordData[];
		levels.reverse();
		expect((strict([block])[0].data.response as RecordData).scalePoints).toEqual([
			{ id: "l-b", value: 2, label: "High" },
			{ id: "l-a", value: 1, label: "Low" },
		]);
		delete levels[0].id;
		expect(() => strict([block])).toThrow(/Missing child ID/);
	});
	it.each(["item", "block", "answer"])("rejects duplicated %s IDs across owners", (kind) => {
		const a = structuredClone(cases[0][1]);
		const b = structuredClone(cases[1][1]);
		if (kind === "block") b.id = a.id;
		else cases[1][2](b)[0].id = kind === "answer" ? "m-a" : "p-a";
		expect(() => strict([a, b])).toThrow(/Duplicate child ID/);
	});
	it.each([
		[
			"matching",
			"pairs",
			[
				{ id: "pair-a", matchId: "answer-a", left: "A", right: "One" },
				{ id: "pair-b", matchId: "answer-b", left: "B", right: "Two" },
			],
		],
		[
			"sequence",
			"items",
			[
				{ id: "step-a", text: "A" },
				{ id: "step-b", text: "B" },
			],
		],
		[
			"fillBlank",
			"blanks",
			[
				{ id: "blank-a", answer: "A" },
				{ id: "blank-b", answer: "B" },
			],
		],
		[
			"categorize",
			"categories",
			[
				{ id: "category-a", name: "A", items: ["same", "same"], itemIds: ["entry-a", "entry-b"] },
				{ id: "category-b", name: "B", items: ["C"], itemIds: ["entry-c"] },
			],
		],
		[
			"matrix",
			"statements",
			[
				{ id: "statement-a", text: "A" },
				{ id: "statement-b", text: "B" },
			],
		],
	] as const)(
		"preserves supplied %s IDs through canonical renderer records",
		(assessmentType, key, records) => {
			const block: PraxityBlock = {
				id: "question",
				type: "assessment",
				data: { stem: [], response: { type: assessmentType, [key]: [...records].reverse() } },
			};
			const [adapted] = adaptGrammarPreviewBlocks([block]);
			const children = (adapted.data.response as RecordData)[key] as RecordData[];
			expect(children.map((child) => child.id)).toEqual(records.map((child) => child.id).reverse());
			if (assessmentType === "matching")
				expect(children.map((child) => child.matchId)).toEqual(["answer-b", "answer-a"]);
			if (assessmentType === "categorize")
				expect(children.map((child) => child.itemIds)).toEqual([
					["entry-c"],
					["entry-a", "entry-b"],
				]);
		},
	);
	it.each(cases)("keeps supplied IDs after reordering %s", (_name, original, records) => {
		const reordered = structuredClone(original);
		records(reordered).reverse();
		const before = records(strict([original])[0]);
		const after = records(strict([reordered])[0]);
		expect(after.map((record) => record.id)).toEqual(before.map((record) => record.id).reverse());
		for (const child of after) {
			const previous = before.find((record) => record.id === child.id);
			expect(child).toEqual(previous);
		}
	});
	it.each(cases)("throws for a missing %s ID before adapting", (_name, original, records) => {
		const broken = structuredClone(original);
		delete records(broken)[0].id;
		expect(() => strict([broken])).toThrow(/Missing child ID/);
	});
	it.each(["matchId", "backId"])("requires the separately referenced %s", (field) => {
		const [, original, records] = cases[field === "matchId" ? 0 : 7];
		const broken = structuredClone(original);
		delete records(broken)[0][field];
		// An authored back remains a face even if its content is empty.
		if (field === "backId")
			records(broken)[0].back = [{ id: "back-text", type: "text", data: { content: "Back" } }];
		expect(() => strict([broken])).toThrow(/Missing child ID/);
	});
	it("keeps category item IDs with repeated text after reordering and moving items", () => {
		const original = structuredClone(cases[3][1]);
		const categories = cases[3][2](original);
		categories[0].items = ["same"];
		categories[0].itemIds = ["i-b"];
		categories[1].items = ["same", "C"];
		categories[1].itemIds = ["i-a", "i-c"];
		expect(cases[3][2](strict([original])[0])).toEqual(categories);
		categories[1].itemIds = ["i-a"];
		expect(() => strict([original])).toThrow(/Missing child ID/);
	});
	it("validates nested children and rejects whitespace IDs", () => {
		const nested = structuredClone(cases[7][1]);
		(nested.data.items as RecordData[])[0].front = [{ ...cases[0][1], id: "nested" }];
		const match = ((nested.data.items as RecordData[])[0].front as PraxityBlock[])[0];
		cases[0][2](match)[0].matchId = " ";
		expect(() => strict([nested])).toThrow(/Missing child ID/);
	});
	it("reads and adapts every grammar-4 identity shape without generating replacements", () => {
		const source =
			"# P\n::: match Q\n- A -> B\n- C -> D\n:::\n::: order Q\n1. A\n2. B\n:::\n::: fill-blank Q\n{A} {B}\n:::\n::: categorize Q\n:: A\n- X\n:: B\n- Y\n:::\n::: matrix Q\n1. Low\n2. High\n- A\n- B\n:::\n::: hotspot Q\n![Map](/assets/map.png)\n- A {x=20 y=30 correct}\n- B {x=40 y=50}\n:::\n::: choice Q\n(x) A\n( ) B\n:::\n::: cards\n:: A\nFront\n::: back\nBack\n:::\n:: B\nOther\n:::\n::: dialogue\n- alice: Hello\n- bob: Hi\n:::\n::: checklist\n- [ ] A\n- [ ] B\n:::\n::: rating Q\n1. Low\n2. High\n:::\n";
		const lesson = readLesson(source, {
			ids: (node, role) => `supplied-${node.span.start}-${role ?? "node"}`,
		});
		expect(lesson.hasErrors).toBe(false);
		const adapted = strict(lesson.blocks);
		const collect = (value: unknown): string[] => {
			if (Array.isArray(value)) return value.flatMap(collect);
			if (!value || typeof value !== "object") return [];
			return Object.entries(value).flatMap(([key, child]) =>
				key === "id" || key === "matchId" || key === "backId" || key === "imageId"
					? [String(child)]
					: key === "itemIds"
						? (child as string[])
						: collect(child),
			);
		};
		expect(collect(adapted).sort()).toEqual(collect(lesson.blocks).sort());
	});
});
