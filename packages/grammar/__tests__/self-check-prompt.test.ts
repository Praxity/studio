import type { PraxityBlock } from "@praxity/content-model/types";
import { expect, it } from "vitest";
import { readLesson, readSelfCheckContent } from "../src/index";

const activity =
	"::: self-check TASKMARK {required private=false deckGate=attempt}\nmodel: MODELMARK EVIDMARK\n:: LABELMARK\nmissed: HINTMARK\nevidence: EVIDMARK\n:: Whole\nmissed: WHOLEHINT\n:::\n";
const wrap = (type: string, text: string) => `::: ${type}\n:: Panel\n${text}:::\n`;

it.each([
	["top level", activity, 2],
	[
		"five containers",
		wrap("accordion", wrap("tabs", wrap("sequence", wrap("columns", wrap("cards", activity))))),
		6,
	],
	["card back", wrap("cards", `Front text\n::: back\n${activity}:::\n`), 3],
])("projects only the prompt at %s, keeping each criterion allocated", (_, text, level) => {
	const lesson = readLesson(`# Practice\n${text}`, {
		ids: (node, role) => `id-${node.span.start}-${role ?? "node"}`,
	});
	const blocks: PraxityBlock[] = [];
	const collect = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		if ("type" in value && value.type === "selfCheck") blocks.push(value as PraxityBlock);
		for (const child of Object.values(value)) collect(child);
	};
	collect(lesson.blocks);
	expect(blocks).toHaveLength(1);
	const owner = blocks[0];
	const ownerRecord = lesson.nodes.get(owner.id);
	if (!ownerRecord) throw new Error("Missing self-check owner fixture");
	const criteria = [...lesson.nodes.values()].filter(
		(record) =>
			!record.role &&
			record.node.kind === "item" &&
			record.range.start > ownerRecord.range.start &&
			record.range.end < ownerRecord.range.end,
	);
	expect(criteria).toHaveLength(2);
	expect(owner.data).toEqual({
		level,
		required: true,
		private: false,
		deckGate: "attempt",
		content: { task: "TASKMARK", parts: criteria.map(({ id }) => ({ id })) },
	});
	for (const projection of [lesson.pages, lesson.blocks]) {
		expect(JSON.stringify(projection)).not.toMatch(
			/MODELMARK|EVIDMARK|LABELMARK|HINTMARK|WHOLEHINT|Whole/,
		);
		expect(JSON.stringify(projection)).toContain("TASKMARK");
	}
	expect(lesson.tree.stream.source).toBe(`# Practice\n${text}`);
	expect(readSelfCheckContent(lesson, owner.id)).toEqual({
		task: "TASKMARK",
		model: "MODELMARK EVIDMARK",
		parts: [
			{ id: criteria[0].id, label: "LABELMARK", missed: "HINTMARK", evidence: "EVIDMARK" },
			{ id: criteria[1].id, label: "Whole", missed: "WHOLEHINT", evidence: null },
		],
	});
});

it("retains author access after the admitted read is cloned or spread by identity", () => {
	const lesson = readLesson(`# Practice\n${activity}`);
	const block = lesson.blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing self-check fixture");
	const id = block.id;
	const content = readSelfCheckContent(lesson, id);
	const cloned = structuredClone(lesson);
	expect(readSelfCheckContent(cloned, id)).toEqual(content);
	expect(readSelfCheckContent({ ...cloned, transientIds: false }, id)).toEqual(content);
});
