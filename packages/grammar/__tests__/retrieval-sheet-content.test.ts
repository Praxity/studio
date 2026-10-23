import { expect, it } from "vitest";
import { readLesson, readRetrievalSheetContent, withLessonIds } from "../src/index";

const text = "# Page\n::: retrieval-sheet Recall\n:: Name a step\nanswer: First step.\n:::\n";
const read = (source = text) =>
	readLesson(source, { ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` });
const sheetId = (lesson: ReturnType<typeof read>) => {
	const block = lesson.blocks.find((block) => block.type === "retrievalSheet");
	if (!block) throw new Error("Missing sheet fixture");
	return block.id;
};

it("reads literal source content and allocated item identities despite a stale projection", () => {
	const lesson = read();
	const block = lesson.blocks.find((block) => block.type === "retrievalSheet");
	if (!block) throw new Error("Missing sheet fixture");
	block.data.content = { title: "STALE", questions: [] };
	expect(readRetrievalSheetContent(lesson, block.id)).toEqual({
		title: "Recall",
		questions: [{ id: "id-34-node", question: "Name a step", answer: "First step." }],
	});
});

it("retains source content across cloning and identity reassignment", () => {
	const lesson = read();
	const content = readRetrievalSheetContent(lesson, sheetId(lesson));
	const cloned = structuredClone(lesson);
	expect(readRetrievalSheetContent(cloned, sheetId(cloned))).toEqual(content);
	const rebound = withLessonIds(lesson, (node, role) => `new-${node.span.start}-${role ?? "node"}`);
	expect(readRetrievalSheetContent(rebound, sheetId(rebound))).toEqual({
		title: "Recall",
		questions: [{ id: "new-34-node", question: "Name a step", answer: "First step." }],
	});
});

it.each(["absent", "id-0-node", "id-34-node"])("refuses a missing or wrong owner: %s", (id) => {
	expect(() => readRetrievalSheetContent(read(), id)).toThrowError(
		expect.objectContaining({
			code: "retrieval-sheet-not-found",
			message: "retrieval-sheet-not-found",
		}),
	);
});

it("refuses missing item identity records without authored content", () => {
	const lesson = read();
	lesson.nodes.delete("id-34-node");
	expect(() => readRetrievalSheetContent(lesson, sheetId(lesson))).toThrowError(
		expect.objectContaining({
			code: "retrieval-sheet-identity-invalid",
			message: "retrieval-sheet-identity-invalid",
		}),
	);
});

it.each([
	text.replace("answer: First step.", "answer:"),
	text.replace("Name a step", "x".repeat(401)),
	text.replace("answer: First step.", "answer: First step.\nanswer: Second step."),
])("refuses invalid source with a content-free code: %s", (source) => {
	const lesson = read(source);
	expect(() => readRetrievalSheetContent(lesson, sheetId(lesson))).toThrowError(
		expect.objectContaining({
			code: "retrieval-sheet-content-invalid",
			message: "retrieval-sheet-content-invalid",
		}),
	);
});

it("refuses item identities that the upstream content validator rejects", () => {
	const lesson = readLesson(text, {
		ids: (node, role) => `bad id ${node.span.start} ${role ?? "node"}`,
	});
	expect(() => readRetrievalSheetContent(lesson, sheetId(lesson))).toThrowError(
		expect.objectContaining({
			code: "retrieval-sheet-content-invalid",
			message: "retrieval-sheet-content-invalid",
		}),
	);
});
