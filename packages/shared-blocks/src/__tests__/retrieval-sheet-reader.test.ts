import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { adaptGrammarPreviewBlocks } from "../grammar-adapter";
import { normalizeNarrationSourceContent, resolveNarrationV2 } from "../narration";
import { preparePageFootnotes } from "../page-footnotes";

it("narrates literal title/questions through v2, excludes answers and preserves collector input", () => {
	const read = readLesson(
		'# P\n::: retrieval-sheet <b>Title</b>\n:: **Q** [term]{definition} @icon{star} @footer{note}\nanswer: ANSWER <span data-footer-content="secret">x</span>\n:::\n',
	);
	const block = read.blocks.find((b) => b.type === "retrievalSheet");
	if (!block) throw new Error("Missing typed sheet");
	expect(adaptGrammarPreviewBlocks([block])).toEqual([block]);
	expect(
		preparePageFootnotes([block], "page", { footnote: "Footnote", footnotes: "Footnotes" }),
	).toEqual([block]);
	const resolved = resolveNarrationV2({
		courseId: "course",
		lessonId: "lesson",
		locale: "en",
		pages: [{ id: "page", title: "", blocks: [block] }],
		sidecar: { version: 2, courseId: "course", lessons: {} },
		digest: (s) => s,
	});
	expect(resolved.pages[0].segments).toMatchObject([
		{
			target: { id: block.id, role: "body" },
			blockType: "retrievalSheet",
			script: "<b>Title</b> [pause]\n\n**Q** [term]{definition} @icon{star} @footer{note}",
		},
	]);
	expect(JSON.stringify(resolved.pages[0].segments)).not.toContain("ANSWER");
});

it("keeps answers, date/control metadata and item identity out of every narration fingerprint", () => {
	const resolve = (answer: string) => {
		const read = readLesson(
			`# P\n::: retrieval-sheet Title\n:: Question\nanswer: ${answer}\n:::\n`,
			{ ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` },
		);
		const block = read.blocks.find((b) => b.type === "retrievalSheet");
		if (!block) throw new Error("Missing sheet");
		const resolved = resolveNarrationV2({
			courseId: "course",
			lessonId: "lesson",
			locale: "en",
			pages: [{ id: "page", title: "", blocks: [block] }],
			sidecar: { version: 2, courseId: "course", lessons: {} },
			digest: (text) => text,
		});
		return { block, segment: resolved.pages[0].segments[0] };
	};
	const before = resolve("ANSWER SECRET ONE"),
		after = resolve("ANSWER SECRET TWO");
	expect(JSON.stringify(before.segment)).not.toContain("ANSWER");
	expect(JSON.stringify(after.segment)).not.toContain("ANSWER");
	expect(after.segment.sourceContent).toBe(before.segment.sourceContent);
	expect(after.segment.revision).toBe(before.segment.revision);
	expect(after.segment).toEqual(before.segment);
	expect(JSON.parse(before.segment.sourceContent)).toEqual({
		type: "retrievalSheet",
		data: { content: { title: "Title", questions: [{ question: "Question" }] } },
	});
	const nested = (block: typeof before.block) =>
		normalizeNarrationSourceContent(
			JSON.stringify({ type: "accordion", data: { items: [{ id: "item", children: [block] }] } }),
		);
	expect(nested(before.block)).toBe(nested(after.block));
	expect(nested(before.block)).not.toContain("ANSWER");
	const polluted = {
		...before.block,
		data: { ...before.block.data, date: "DATE SECRET", side: "CONTROL SECRET" },
	};
	expect(
		normalizeNarrationSourceContent(JSON.stringify({ type: polluted.type, data: polluted.data })),
	).toBe(before.segment.sourceContent);
});

it("pauses after the title and speaks identical questions in their authored order", () => {
	const read = readLesson(
		"# P\n::: retrieval-sheet Repeat\n:: Repeat\nanswer: ANSWER ONE\n:: Repeat\nanswer: ANSWER TWO\n:::\n",
	);
	const blocks = read.blocks.filter((b) => b.type === "retrievalSheet");
	const resolved = resolveNarrationV2({
		courseId: "course",
		lessonId: "lesson",
		locale: "en",
		pages: [{ id: "page", title: "", blocks }],
		sidecar: { version: 2, courseId: "course", lessons: {} },
		digest: (text) => text,
	});
	expect(resolved.pages[0].segments).toMatchObject([{ script: "Repeat [pause]\n\nRepeat Repeat" }]);
	expect(JSON.stringify(resolved.pages[0].segments)).not.toContain("ANSWER");
});
