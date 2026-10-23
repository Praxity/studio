import { expect, it } from "vitest";
import { type EditorDraftRanges, editorDraftSeed } from "../editor-session";

function lesson(file = "a.prax") {
	const note = {
		seed: {
			target: { kind: "node", nodeId: null, path: [0, 0], fingerprint: "a".repeat(64) },
			expected: { start: 7, end: 30 },
			editable: { start: 7, end: 25 },
			scope: "node",
		} satisfies EditorDraftRanges,
	};
	return {
		file,
		baseRevision: "b".repeat(64),
		source: "\uFEFFHead\r\n::: note\r\nText🙂\r\n:::\r\nTail",
		seed: {
			target: { kind: "node", nodeId: null, path: [], fingerprint: "c".repeat(64) },
			expected: { start: 0, end: 34 },
			editable: { start: 0, end: 34 },
			scope: "file",
		} satisfies EditorDraftRanges,
		nodes: [note],
	};
}

it("D1 D2 adapts the admitted node's exact ranges and literal null write target", () => {
	const source = lesson();
	expect(editorDraftSeed(source, source.nodes[0])).toEqual({
		file: "a.prax",
		baseRevision: "b".repeat(64),
		target: { kind: "node", nodeId: null, path: [0, 0], fingerprint: "a".repeat(64) },
		scope: "node",
		expectedText: "::: note\r\nText🙂\r\n:::\r\n",
		editableText: "::: note\r\nText🙂\r\n",
	});
});

it("D1 adapts a whole-file seed without losing BOM or CRLF bytes", () => {
	expect(editorDraftSeed(lesson())).toEqual({
		file: "a.prax",
		baseRevision: "b".repeat(64),
		target: { kind: "node", nodeId: null, path: [], fingerprint: "c".repeat(64) },
		scope: "file",
		expectedText: "\uFEFFHead\r\n::: note\r\nText🙂\r\n:::\r\nTail",
		editableText: "\uFEFFHead\r\n::: note\r\nText🙂\r\n:::\r\nTail",
	});
});

it("D10 refuses a node from another lesson before slicing its source", () => {
	const a = lesson();
	const b = lesson("b.prax");
	b.source =
		"\uFEFFHead\r\n::: note\r\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\r\n:::\r\n";
	expect(() => editorDraftSeed(b, a.nodes[0])).toThrow("Node does not belong to this lesson");
	expect(() => editorDraftSeed(b, a.nodes[0])).toThrow(RangeError);
});

it("D10 checks lesson membership before validating a foreign node's ranges", () => {
	const a = lesson();
	a.nodes[0].seed.expected = { start: -1, end: -1 };
	expect(() => editorDraftSeed(lesson("b.prax"), a.nodes[0])).toThrow(
		"Node does not belong to this lesson",
	);
});

it("D10 refuses an unadmitted copy of a node, including from the same file", () => {
	const source = lesson();
	expect(() => editorDraftSeed(source, { ...source.nodes[0] })).toThrow(RangeError);
});

it("D2 refuses invalid admitted ranges through the shared adapter", () => {
	const source = lesson();
	source.nodes[0].seed.editable.end = 35;
	expect(() => editorDraftSeed(source, source.nodes[0])).toThrow(RangeError);
});
