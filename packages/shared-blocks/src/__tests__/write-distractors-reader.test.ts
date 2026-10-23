import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { assertChildIds, childRecords } from "../child-records";
import {
	adaptGrammarPreviewBlocks,
	constructWriteDistractorsPromptBlock,
} from "../grammar-adapter";
import { normalizeNarrationSourceContent, resolveNarrationV2 } from "../narration";

const block = () => ({
	id: "wd",
	type: "writeDistractors",
	data: {
		level: 2,
		content: { question: "<b>PromptControl</b>", count: 2, items: [{ id: "idea" }] },
	},
});
const invalid = {
	code: "EWRITEDISTRACTORSPROMPT",
	message: "Invalid write-distractors prompt data.",
};

it("constructs fresh closed prompt records and preserves supported settings/outer metadata", () => {
	const input = {
		...block(),
		name: "practice",
		locale: "fr",
		visible: true,
		sectionTheme: "warm",
		a11y: { altText: "Alt", decorative: false },
		layout: { width: "half", alignment: "left" },
		data: {
			...block().data,
			layoutMode: "wide",
			hide: false,
			entrance: "fade",
			visible: "flag is true",
		},
	};
	const result = constructWriteDistractorsPromptBlock(input);
	expect(result).toEqual(input);
	expect(result).not.toBe(input);
	expect(result.data.content.items[0]).not.toBe(input.data.content.items[0]);
	expect(result.a11y).not.toBe(input.a11y);
});

const polluted = [
	{ ...block(), answer: "W03_RIGHT_UNIQUE" },
	{ ...block(), data: { ...block().data, rightAnswer: "W03_RIGHT_UNIQUE" } },
	{ ...block(), data: { ...block().data, count: 2 } },
	{ ...block(), data: { ...block().data, private: true } },
	{
		...block(),
		data: {
			...block().data,
			content: {
				...block().data.content,
				misconceptions: [{ id: "idea", label: "W03_LABEL_UNIQUE" }],
			},
		},
	},
	{
		...block(),
		data: {
			...block().data,
			content: {
				...block().data.content,
				authorOptions: [{ text: "W03_OPTION_UNIQUE", misconception: "idea" }],
			},
		},
	},
	{
		...block(),
		data: {
			...block().data,
			content: { ...block().data.content, items: [{ id: "idea", label: "W03_LABEL_UNIQUE" }] },
		},
	},
	...[0, 6, 1.5, "2"].map((count) => ({
		...block(),
		data: { ...block().data, content: { ...block().data.content, count } },
	})),
	{ ...block(), data: { ...block().data, level: 7 } },
	{
		...block(),
		data: { ...block().data, content: { ...block().data.content, items: [{ id: "other" }] } },
	},
	{
		...block(),
		data: { ...block().data, content: { ...block().data.content, items: new Array(1) } },
	},
];
it.each(polluted)("refuses extra fields and malformed prompt records: %j", (input) => {
	expect(() => constructWriteDistractorsPromptBlock(input)).toThrowError(
		expect.objectContaining(invalid),
	);
	expect(() => adaptGrammarPreviewBlocks([input as never])).toThrowError(
		expect.objectContaining(invalid),
	);
});

it.each(["symbol", "nonenumerable", "getter", "prototype", "class", "array-property"])(
	"refuses %s before executing or discarding properties",
	(kind) => {
		const input = block();
		let reads = 0;
		if (kind === "symbol") Object.assign(input.data, { [Symbol("secret")]: "W03_RIGHT_UNIQUE" });
		if (kind === "nonenumerable")
			Object.defineProperty(input.data, "secret", { value: "W03_RIGHT_UNIQUE" });
		if (kind === "getter")
			Object.defineProperty(input.data.content, "question", {
				enumerable: true,
				get() {
					reads++;
					return "PromptControl";
				},
			});
		if (kind === "prototype") Object.setPrototypeOf(input.data, { secret: "W03_RIGHT_UNIQUE" });
		if (kind === "class") Object.setPrototypeOf(input.data.content.items[0], new (class Item {})());
		if (kind === "array-property")
			Object.assign(input.data.content.items, { secret: "W03_RIGHT_UNIQUE" });
		expect(() => constructWriteDistractorsPromptBlock(input)).toThrowError(
			expect.objectContaining(invalid),
		);
		expect(reads).toBe(0);
	},
);

it("validates defaults before unknown fields can disappear", () => {
	expect(
		adaptGrammarPreviewBlocks([block() as never], {
			"write-distractors": { width: "wide", hide: false },
		})[0].data,
	).toMatchObject({ layoutMode: "wide", hide: false });
	for (const key of ["answer", "count", "rightAnswer", "authorOptions", "content"])
		expect(() =>
			adaptGrammarPreviewBlocks([block() as never], {
				"write-distractors": { [key]: "W03_RIGHT_UNIQUE" },
			}),
		).toThrowError(expect.objectContaining(invalid));
});

it("excludes hidden edits/count/identities from automatic narration source and fingerprints", () => {
	const resolve = (suffix: string) => {
		const read = readLesson(
			`# P\n::: write-distractors <b>PromptControl</b>\nanswer: W03_RIGHT_${suffix}\n:: W03_LABEL_${suffix}\noption: W03_OPTION_${suffix}\n:::\n`,
			{ ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` },
		);
		return resolveNarrationV2({
			courseId: "course",
			lessonId: "lesson",
			locale: "en",
			pages: read.pages,
			sidecar: { version: 2, courseId: "course", lessons: {} },
			digest: (text) => text,
		}).pages[0].segments.find((segment) => segment.blockType === "writeDistractors");
	};
	const before = resolve("ONE"),
		after = resolve("TWO");
	if (!before) throw new Error("Missing narration fixture");
	expect(after).toEqual(before);
	expect(JSON.stringify(before)).not.toMatch(/W03_RIGHT|W03_LABEL|W03_OPTION/);
	expect(JSON.parse(before.sourceContent)).toEqual({
		type: "writeDistractors",
		data: { content: { question: "<b>PromptControl</b>" } },
	});
	const nested = { type: "accordion", data: { items: [{ children: [block()] }] } };
	const source = normalizeNarrationSourceContent(JSON.stringify(nested));
	expect(source).not.toContain("idea");
	expect(source).not.toContain("count");
	expect(source).toContain("PromptControl");
});

it("registers write-distractors item identities in the shared child walker", () => {
	expect(childRecords(block() as never)).toEqual([
		{ kind: "item", id: "idea", ownerId: "wd", path: "block.data.content.items[0].id" },
	]);
	expect([...assertChildIds([block() as never])]).toEqual(["wd", "idea"]);
});
it.each(["sibling block", "sibling item", "nested item"])(
	"refuses page-wide item identity collisions with a %s",
	(collision) => {
		const first = block();
		const second =
			collision === "sibling block"
				? { id: "idea", type: "text", data: { content: "Text" } }
				: { ...block(), id: "other-wd" };
		const blocks =
			collision === "nested item"
				? [
						first,
						{
							id: "accordion",
							type: "accordion",
							data: { items: [{ id: "panel", children: [second] }] },
						},
					]
				: [first, second];
		expect(() => assertChildIds(blocks as never)).toThrowError(/Duplicate child ID: idea/);
		expect(() => adaptGrammarPreviewBlocks(blocks as never)).toThrowError(
			/Duplicate child ID: idea/,
		);
	},
);

it("refuses repeated identities within one prompt at both admission boundaries", () => {
	const input = block();
	input.data.content.items.push({ id: "idea" });
	expect(() => constructWriteDistractorsPromptBlock(input)).toThrowError(
		expect.objectContaining(invalid),
	);
	expect(() => adaptGrammarPreviewBlocks([input as never])).toThrowError(
		/Duplicate child ID: idea/,
	);
});
