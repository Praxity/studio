import { expect, it } from "vitest";
import {
	readLesson,
	readWriteDistractorsContent,
	WriteDistractorsContentError,
	withLessonIds,
} from "../src/index";

const source =
	"# P\n::: write-distractors <b>PromptControl</b> [term]{definition} {count=3}\nanswer: W03_RIGHT_UNIQUE\n:: W03_LABEL_UNIQUE\noption: W03_OPTION_UNIQUE\n:: Second label\noption: Second option\n:::\n";
const read = (text = source) =>
	readLesson(text, { ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` });
const owner = (lesson: ReturnType<typeof read>) => {
	const block = lesson.blocks.find((block) => block.type === "writeDistractors");
	if (!block) throw new Error("Missing distractors fixture");
	return block;
};
const id = (text: string) => `id-${source.indexOf(text)}-node`;
const hidden = /W03_RIGHT_UNIQUE|W03_LABEL_UNIQUE|W03_OPTION_UNIQUE/;

it("projects only literal question, count and allocated identities, keeping diagnostics content-free", () => {
	const lesson = read();
	expect(owner(lesson).data).toEqual({
		level: 2,
		content: {
			question: "<b>PromptControl</b> [term]{definition}",
			count: 3,
			items: [{ id: id(":: W03_LABEL") }, { id: id(":: Second label") }],
		},
	});
	for (const output of [lesson.blocks, lesson.pages, lesson.errors, lesson.diagnostics])
		expect(JSON.stringify(output)).not.toMatch(hidden);
	expect(lesson.errors).toEqual([]);
});

it("returns exact complete Content from fresh source despite a stale or mutated generic projection", () => {
	const lesson = read();
	const block = owner(lesson);
	block.data.content = { question: "STALE", count: 1, items: [] };
	const expected = {
		question: "<b>PromptControl</b> [term]{definition}",
		rightAnswer: "W03_RIGHT_UNIQUE",
		count: 3,
		misconceptions: [
			{ id: id(":: W03_LABEL"), label: "W03_LABEL_UNIQUE" },
			{ id: id(":: Second label"), label: "Second label" },
		],
		authorOptions: [
			{ text: "W03_OPTION_UNIQUE", misconception: id(":: W03_LABEL") },
			{ text: "Second option", misconception: id(":: Second label") },
		],
	};
	const content = readWriteDistractorsContent(lesson, block.id);
	expect(content).toEqual(expected);
	content.misconceptions[0].label = "changed";
	expect(readWriteDistractorsContent(lesson, block.id)).toEqual(expected);
	expect(readWriteDistractorsContent(structuredClone(lesson), block.id)).toEqual(expected);
	const rebound = withLessonIds(lesson, (node, role) => `new-${node.span.start}-${role ?? "node"}`);
	expect(
		readWriteDistractorsContent(rebound, owner(rebound).id).misconceptions.map((item) => item.id),
	).toEqual(expected.misconceptions.map((item) => item.id.replace("id-", "new-")));
});

it.each(["absent", "id-0-node", id(":: W03_LABEL")])(
	"refuses a wrong owner with a content-free typed error: %s",
	(blockId) => {
		expect(() => readWriteDistractorsContent(read(), blockId)).toThrowError(
			expect.objectContaining({
				name: "WriteDistractorsContentError",
				code: "write-distractors-not-found",
				message: "write-distractors-not-found",
			}),
		);
	},
);

it("refuses missing item identities even after the source index was used", () => {
	const lesson = read();
	const blockId = owner(lesson).id;
	readWriteDistractorsContent(lesson, blockId);
	lesson.nodes.delete(id(":: W03_LABEL"));
	expect(() => readWriteDistractorsContent(lesson, blockId)).toThrowError(
		new WriteDistractorsContentError("write-distractors-identity-invalid"),
	);
});

it.each([
	source.replace("answer: W03_RIGHT_UNIQUE", "answer:"),
	source.replace("option: W03_OPTION_UNIQUE", "option:"),
	source.replace("W03_LABEL_UNIQUE", "Second label"),
	source.replace("count=3", 'count="3"'),
	source.replace("answer: W03_RIGHT_UNIQUE", "answer: W03_RIGHT_UNIQUE\nanswer: duplicate"),
	source.replace("PromptControl", "x".repeat(401)),
])("refuses invalid source without leaking authored content: %s", (text) => {
	const lesson = read(text);
	expect(() => readWriteDistractorsContent(lesson, owner(lesson).id)).toThrowError(
		new WriteDistractorsContentError("write-distractors-content-invalid"),
	);
	expect(JSON.stringify(lesson.diagnostics)).not.toMatch(hidden);
});

it("sanitizes upstream validator errors for invalid allocated IDs", () => {
	const lesson = readLesson(source, {
		ids: (node, role) => `bad id ${node.span.start} ${role ?? "node"}`,
	});
	expect(() => readWriteDistractorsContent(lesson, owner(lesson).id)).toThrowError(
		new WriteDistractorsContentError("write-distractors-content-invalid"),
	);
});

it.each(["TOP", "accordion", "tabs", "sequence", "columns", "FRONT", "BACK", "DECK"])(
	"keeps the prompt/content boundary at %s",
	(placement) => {
		const activity = source.slice(source.indexOf("::: write-distractors"));
		const wrapped = ["TOP", "DECK"].includes(placement)
			? activity
			: placement === "FRONT"
				? `::: cards\n:: Card\n${activity}:::\n`
				: placement === "BACK"
					? `::: cards\n:: Card\nFront\n::: back\n${activity}:::\n:::\n`
					: `::: ${placement}\n:: Panel\n${activity}:::\n`;
		const lesson = read(`# P${placement === "DECK" ? " {deckStop}" : ""}\n${wrapped}`);
		const owner = [...lesson.nodes.values()].find(
			(record) => !record.role && record.node.type === "write-distractors",
		);
		if (!owner) throw new Error("Missing nested fixture");
		expect(lesson.diagnostics.map((d) => d.code)).toEqual([]);
		expect(readWriteDistractorsContent(lesson, owner.id)).toMatchObject({
			question: "<b>PromptControl</b> [term]{definition}",
			rightAnswer: "W03_RIGHT_UNIQUE",
			count: 3,
		});
		expect(JSON.stringify(lesson.pages)).toContain("PromptControl");
		expect(JSON.stringify(lesson.pages)).not.toMatch(hidden);
	},
);

it("refuses an inconsistent owner identity mapping", () => {
	const lesson = read();
	const blockId = owner(lesson).id;
	readWriteDistractorsContent(lesson, blockId);
	const entry = lesson.nodes.get(blockId);
	if (!entry) throw new Error("Missing owner fixture");
	lesson.nodes.set(blockId, { ...entry, id: "foreign" });
	expect(() => readWriteDistractorsContent(lesson, blockId)).toThrowError(
		new WriteDistractorsContentError("write-distractors-identity-invalid"),
	);
});

it("retains resolved identity and admits valid publication", () => {
	const lesson = read();
	const block = owner(lesson);
	expect(lesson.tree.root.status).toBe("resolved");
	expect(lesson.nodes.get(block.id)?.node.status).toBe("resolved");
	expect(lesson.tree.root.children.find((node) => node.kind === "page")?.status).toBe("resolved");
	expect(lesson.hasErrors).toBe(false);
	expect(lesson.errors).toEqual([]);
	const invalid = read(source.replace("answer: W03_RIGHT_UNIQUE", "answer:"));
	expect(invalid.tree.root.status).toBe("unresolved");
	expect(invalid.nodes.get(owner(invalid).id)?.node.status).toBe("unresolved");
});

it("refuses an unresolved source owner even without retained diagnostics", () => {
	const lesson = read();
	const record = lesson.nodes.get(owner(lesson).id);
	if (!record) throw new Error("Missing owner fixture");
	record.node.status = "unresolved";
	lesson.diagnostics.length = 0;
	expect(() => readWriteDistractorsContent(lesson, owner(lesson).id)).toThrowError(
		new WriteDistractorsContentError("write-distractors-content-invalid"),
	);
});
