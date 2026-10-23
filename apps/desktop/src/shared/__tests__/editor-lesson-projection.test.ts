import en from "@praxity/editor-core/messages/en";
import { createSession, type Dependencies, dispatch } from "@praxity/editor-core/session";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import { largeSnapshotFixture } from "../../main/__tests__/fixtures/editor-snapshot";
import { editorLessonProjection, readEditorLesson } from "../editor-session";

const translator = createTranslator({ locale: "en", messages: en });
const translate = (key: string, params?: Record<string, string | number>) =>
	translator(key as Parameters<typeof translator>[0], params);
const source = "# First\n\nText\n\n# Second\n\nOther\n";

// Same admitted-ID adapter as #1581's frontmatter regression.
function admittedSnapshot(source: string) {
	const result = largeSnapshotFixture(source);
	result.transientIdentity = false;
	const stable = (value: string) => `00000000-0000-4000-8000-${value.slice(-12)}`;
	for (const lesson of result.lessons) {
		lesson.id = stable(lesson.id);
		lesson.seed.target.nodeId = lesson.id;
		for (const node of lesson.nodes) {
			node.id = stable(node.id);
			node.pageId = stable(node.pageId);
			node.parentId = node.parentId ? stable(node.parentId) : null;
			node.seed.target.nodeId = node.id;
		}
	}
	return result;
}

it("A3 D1 D6 G1 settles save-1 with lesson projections and zero frame", () => {
	const lesson = admittedSnapshot(source).lessons[0];
	const focus = { file: "a.prax", nodeId: lesson.nodes[1].id, role: "handle" as const };
	let state = createSession({ revisions: { "a.prax": lesson.baseRevision } });
	const projection = () => editorLessonProjection(lesson, state, translate);
	const deps = (): Dependencies => ({
		...projection(),
		now: 0,
		translate: (message) =>
			translate(message.key as Parameters<typeof translate>[0], message.params),
		validateDraft: () => ({ diagnostics: [], escapes: false }),
		helperTokens: () => [],
		focusNeighbours: () => ({ page: { ...focus, nodeId: lesson.nodes[0].id } }),
	});
	expect(
		lesson.nodes.map((node) => projection().nameOfFocus({ ...focus, nodeId: node.id })),
	).toEqual(["Page: First", "Paragraph: Text", "Page: Second", "Paragraph: Other"]);
	expect(projection().readDraft(focus).expectedText).toBe("Text\n");
	expect(projection().readDraft(focus).editableText).toBe("Text\n");
	expect(projection().readDraft(focus, "file").expectedText).toBe(source);
	expect(
		projection()
			.selectionNodes()
			.map((node) => [node.id, node.parentId, node.pageId]),
	).toEqual([
		["00000000-0000-4000-8000-000000000002", null, "00000000-0000-4000-8000-000000000002"],
		[
			"00000000-0000-4000-8000-000000000003",
			"00000000-0000-4000-8000-000000000002",
			"00000000-0000-4000-8000-000000000002",
		],
		["00000000-0000-4000-8000-000000000004", null, "00000000-0000-4000-8000-000000000004"],
		[
			"00000000-0000-4000-8000-000000000005",
			"00000000-0000-4000-8000-000000000004",
			"00000000-0000-4000-8000-000000000004",
		],
	]);
	const pending = dispatch(
		state,
		{
			type: "operation",
			request: {
				transactionId: "save-1",
				operation: "setText",
				files: [{ path: "a.prax", baseRevision: lesson.baseRevision }],
				targets: [{ file: "a.prax", ref: lesson.nodes[1].seed.target, expectedText: "Text\n" }],
				args: { text: "Changed" },
			},
		},
		deps(),
	);
	state = pending.state;
	expect(`${state.pending ? "Pending" : "Settled"}:${state.history.length}`).toBe("Pending:0");
	expect(pending.effects.filter((effect) => effect.type === "post")).toHaveLength(1);
	state = dispatch(
		state,
		{
			type: "operationReply",
			result: {
				ok: true,
				transactionId: "save-1",
				historyId: "saved-entry",
				files: [
					{
						path: "a.prax",
						fromRevision: lesson.baseRevision,
						toRevision: "saved-revision",
						edits: [{ start: 9, end: 13, text: "Changed" }],
					},
				],
				intent: "modify",
				mapping: [{ oldId: focus.nodeId, newId: focus.nodeId, fate: "kept" }],
				inverse: { files: [], mapping: [], guards: [] },
				diagnostics: [],
				focus,
				summary: { key: "op.setText", params: { count: 1 } },
			},
		},
		deps(),
	).state;
	expect(`${state.pending ? "Pending" : "Settled"}:${state.history.length}`).toBe("Settled:1");
	expect(state.history[0].historyIds).toEqual(["saved-entry"]);
});

it("review: a valid lesson with frontmatter variables projects admitted reader roles", () => {
	const lesson = admittedSnapshot(
		"---\ntitle: Feedback\nvariables:\n  score: 0\n---\n# Feedback\n\nText\n",
	).lessons[0];
	const read = readEditorLesson(lesson);
	expect(
		[...read.nodes.values()]
			.filter((record) => record.node.kind === "frontmatter")
			.map((record) => record.id),
	).toEqual([`${lesson.id}:variable:score`]);
	expect(editorLessonProjection(lesson, createSession(), translate).selectionNodes()).toHaveLength(
		2,
	);
});

it("reports projection failure without admitting a frame", () => {
	const broken = largeSnapshotFixture("# Feedback\n\nText\n").lessons[0];
	broken.nodes.pop();
	expect(() => readEditorLesson(broken)).toThrow("Editor snapshot identity unavailable");
});

it("D10 refuses foreign files and missing executable draft nodes", () => {
	const lesson = admittedSnapshot(source).lessons[0];
	const projection = editorLessonProjection(lesson, createSession(), translate);
	expect(() =>
		projection.readDraft({ file: "b.prax", nodeId: lesson.nodes[1].id, role: "handle" }),
	).toThrow("Editor draft outside lesson");
	expect(() => projection.readDraft({ file: "a.prax", nodeId: "missing", role: "handle" })).toThrow(
		"Editor draft unavailable",
	);
});
