import { expect, it, vi } from "vitest";
import { createSession, dispatch } from "./index";
import type { AuthorOperationResult, Dependencies, DraftSeed, Session } from "./types";

const seed: DraftSeed = {
	file: "lesson.prax",
	target: { kind: "node", nodeId: "paragraph", path: [0, 0], fingerprint: "text" },
	baseRevision: "initial",
	expectedText: "Text\n",
	editableText: "Text\n",
};
const focus = { file: seed.file, nodeId: "paragraph", role: "handle" as const };
const saved = {
	...seed,
	baseRevision: "saved",
	expectedText: "First save\n",
	editableText: "First save\n",
};
const dependencies: Dependencies = {
	now: 0,
	readDraft: () => seed,
	validateDraft: () => ({ diagnostics: [], escapes: false }),
	helperTokens: () => [],
	focusNeighbours: () => ({ page: { ...focus, nodeId: "page" } }),
	nameOfFocus: () => "Paragraph",
	translate: (message) => message.key,
};
function committing(typing = false, initial = seed) {
	let state = dispatch(createSession(), { type: "openSource", seed: initial }, dependencies).state;
	state = dispatch(
		state,
		{ type: "changeDraft", text: "First save", selection: [0, 0] },
		dependencies,
	).state;
	state = dispatch(state, { type: "commit", trigger: "save" }, dependencies).state;
	if (typing)
		state = dispatch(
			state,
			{ type: "changeDraft", text: "First save, more", selection: [0, 0] },
			dependencies,
		).state;
	if (state.pending?.kind !== "commit") throw new Error("Expected commit");
	const result: Extract<AuthorOperationResult, { ok: true }> = {
		ok: true,
		transactionId: state.pending.request.transactionId,
		historyId: "history-one",
		seq: 1,
		files: [
			{
				path: seed.file,
				fromRevision: "initial",
				toRevision: "saved",
				edits: [{ start: 0, end: 5, text: "First save\n" }],
			},
		],
		intent: initial.target.kind === "insertion" ? "insert" : "modify",
		mapping: [{ oldId: "paragraph", newId: "paragraph", fate: "kept" }],
		inverse: { files: [], mapping: [], guards: [] },
		diagnostics: [],
		focus,
		summary: { key: "op.editSource", params: { count: 1 } },
	};
	return { state, result };
}
const draft = (state: Session) => Object.values(state.drafts)[0];

it("07f fix D14 a successful receipt settles without reading its target", () => {
	const { state, result } = committing();
	const readDraft = vi.fn((): DraftSeed => {
		throw new Error("Editor draft unavailable");
	});
	const settled = dispatch(
		state,
		{ type: "operationReply", result },
		{ ...dependencies, readDraft },
	);
	expect(readDraft).not.toHaveBeenCalled();
	expect(settled.state.pending).toBeNull();
	expect(settled.state.history).toHaveLength(1);
	expect(settled.state.history[0].historyIds).toEqual(["history-one"]);
	expect(draft(settled.state).text).toBe("First save");
	// A refused projection after settlement cannot consume the durable receipt.
	expect(() =>
		dispatch(
			settled.state,
			{ type: "sourceSnapshot", file: seed.file, revision: "saved", seq: 1 },
			{ ...dependencies, readDraft },
		),
	).toThrow("Editor draft unavailable");
	expect(settled.state.pending).toBeNull();
	expect(settled.state.history).toHaveLength(1);
	const closed = dispatch(settled.state, { type: "escape" }, { ...dependencies, readDraft });
	expect(closed.state.activeDraft).toBeNull();
	expect(closed.state.history).toHaveLength(1);
	expect(closed.effects.some((effect) => effect.type === "post")).toBe(false);
});

it.each([false, true])(
	"07f fix D6 a proven snapshot refreshes the saved guard, further typing %s",
	(typing) => {
		const { state, result } = committing(typing);
		const settled = dispatch(state, { type: "operationReply", result }, dependencies).state;
		const admitted = dispatch(
			settled,
			{ type: "sourceSnapshot", file: seed.file, revision: "saved", seq: 1 },
			{ ...dependencies, readDraft: () => saved },
		).state;
		expect(draft(admitted)).toMatchObject({
			baseRevision: "saved",
			expectedText: "First save\n",
			text: typing ? "First save, more" : "First save",
			baseText: "First save",
			status: typing ? "dirty" : "clean",
		});
		expect(admitted.epoch).toBe(0);
	},
);

it.each([
	[1, "changed"],
	[2, "changed"],
	[1, "unchanged"],
	[2, "unchanged"],
] as const)(
	"07f fix D11 outside source at seq %s keeps typing and requires Keep, resolution %s",
	(seq, kind) => {
		const { state, result } = committing(true);
		const outside = {
			...seed,
			baseRevision: "outside",
			expectedText: "Outside edit\n",
			editableText: "Outside edit\n",
		};
		const settled = dispatch(
			state,
			{ type: "operationReply", result },
			{ ...dependencies, readDraft: () => outside },
		).state;
		const admitted = dispatch(
			settled,
			{ type: "sourceSnapshot", file: seed.file, revision: "outside", seq },
			{ ...dependencies, readDraft: () => outside },
		);
		const resolution = admitted.effects.find(
			(effect) => effect.type === "post" && effect.method === "draftResolve",
		);
		if (resolution?.type !== "post" || resolution.method !== "draftResolve")
			throw new Error("Expected resolution");
		expect(resolution.draft.expectedText).toBe("Text\n");
		const conflicted = dispatch(
			admitted.state,
			{
				type: "draftResolved",
				id: resolution.draft.id,
				generation: resolution.draft.generation,
				epoch: resolution.epoch,
				resolution: { kind, seed: outside },
			},
			dependencies,
		).state;
		expect(draft(conflicted)).toMatchObject({
			text: "First save, more",
			status: "conflict",
			outside,
		});
		expect(
			dispatch(conflicted, { type: "commit", trigger: "save" }, dependencies).effects.some(
				(effect) => effect.type === "post" && effect.method === "operationApply",
			),
		).toBe(false);
		const replaced = dispatch(conflicted, { type: "useNewVersion" }, dependencies).state;
		expect(draft(replaced)).toMatchObject({
			text: "Outside edit\n",
			status: "clean",
			baseRevision: "outside",
		});
		const kept = dispatch(conflicted, { type: "keepDraft" }, dependencies);
		expect(kept.state.pending?.kind).toBe("commit");
		if (kept.state.pending?.kind !== "commit") throw new Error("Expected Keep commit");
		expect(kept.state.pending.request.targets[0].expectedText).toBe("Outside edit\n");
		expect(kept.state.pending.request.args.text).toBe("First save, more");
	},
);

it("07h D6 announces a save waiting for source admission without posting a second write", () => {
	const { state, result } = committing(true);
	const settled = dispatch(state, { type: "operationReply", result }, dependencies).state;
	for (const command of [{ type: "commit", trigger: "save" }, { type: "escape" }] as const) {
		const waiting = dispatch(settled, command, dependencies);
		expect(waiting.effects.filter((e) => e.type === "post")).toEqual([]);
		expect(waiting.effects.filter((e) => e.type === "announce")).toMatchObject([
			{
				message: {
					key: "session.announcements.notSaved",
					params: { message: "session.reasons.sourceAdmission" },
				},
			},
		]);
		expect(draft(waiting.state).text).toBe("First save, more");
	}
});

it.each(
	["changed", "unchanged"].flatMap((kind) =>
		[false, true].map((insertion) => ({ kind: kind as "changed" | "unchanged", insertion })),
	),
)(
	"07h D11 proves the saved node with its written guard, resolution $kind, insertion $insertion",
	({ kind, insertion }) => {
		const { state, result } = committing(
			true,
			insertion
				? {
						...seed,
						target: { kind: "insertion", parentId: "page", after: "paragraph", before: null },
						expectedText: "",
						editableText: "",
					}
				: seed,
		);
		result.inverse.guards = [
			{
				kind: "written",
				file: seed.file,
				ref: seed.target as Extract<DraftSeed["target"], { kind: "node" }>,
				text: "First save\n",
			},
		];
		const settled = dispatch(state, { type: "operationReply", result }, dependencies).state;
		const admitted = dispatch(
			settled,
			{ type: "sourceSnapshot", file: seed.file, revision: "other-section", seq: 2 },
			dependencies,
		);
		const post = admitted.effects.find((e) => e.type === "post" && e.method === "draftResolve");
		if (post?.type !== "post" || post.method !== "draftResolve") throw Error("Expected resolution");
		expect(post.draft.target).toEqual(seed.target);
		expect(post.draft.expectedText).toBe("First save\n");
		const typed = dispatch(
			admitted.state,
			{ type: "changeDraft", text: "First save, latest", selection: [0, 0] },
			dependencies,
		).state;
		const retry = dispatch(
			typed,
			{
				type: "draftResolved",
				id: post.draft.id,
				generation: post.draft.generation,
				epoch: post.epoch,
				resolution: { kind, seed: { ...saved, baseRevision: "other-section" } },
			},
			dependencies,
		);
		const retried = retry.effects.find((e) => e.type === "post" && e.method === "draftResolve");
		if (retried?.type !== "post" || retried.method !== "draftResolve")
			throw Error("Expected retry");
		expect(retried.draft.target).toEqual(seed.target);
		expect(retried.draft.expectedText).toBe("First save\n");
		const resolved = dispatch(
			retry.state,
			{
				type: "draftResolved",
				id: post.draft.id,
				generation: retried.draft.generation,
				epoch: post.epoch,
				resolution: { kind, seed: { ...saved, baseRevision: "other-section" } },
			},
			dependencies,
		);
		expect(draft(resolved.state)).toMatchObject({
			status: "dirty",
			text: "First save, latest",
			baseText: "First save",
			expectedText: "First save\n",
			baseRevision: "other-section",
		});
		expect(draft(resolved.state).outside).toBeUndefined();
		expect(
			dispatch(resolved.state, { type: "commit", trigger: "save" }, dependencies).state.pending
				?.kind,
		).toBe("commit");
	},
);

it.each([false, true])(
	"07h D14 undo before source admission preserves author text and admits the next save, typing %s",
	(typing) => {
		const { state, result } = committing(typing);
		const settled = dispatch(state, { type: "operationReply", result }, dependencies).state;
		const undo = dispatch(settled, { type: "undo", inTextField: false }, dependencies).state;
		if (undo.pending?.kind !== "history") throw new Error("Expected undo");
		const undone = dispatch(
			undo,
			{
				type: "historyReply",
				transactionId: undo.pending.transactionId,
				result: {
					...result,
					transactionId: undo.pending.transactionId,
					seq: 2,
					files: [{ ...result.files[0], fromRevision: "saved", toRevision: "initial" }],
				},
			},
			dependencies,
		).state;
		const admitted = dispatch(
			undone,
			{ type: "sourceSnapshot", file: seed.file, revision: "initial", seq: 2 },
			dependencies,
		).state;
		expect(draft(admitted)).toMatchObject({
			baseRevision: "initial",
			expectedText: "Text\n",
			// With no later typing the saved text belongs to the undone write.
			status: typing ? "dirty" : "clean",
			text: typing ? "First save, more" : "Text\n",
		});
		expect(admitted.epoch).toBe(0);
		expect(admitted.cursor).toBe(0);
		expect(admitted.history).toHaveLength(1);
		expect(admitted.draftAcknowledgements).toEqual({});
		const late = dispatch(
			admitted,
			{ type: "sourceSnapshot", file: seed.file, revision: "saved", seq: 1 },
			{ ...dependencies, readDraft: () => saved },
		).state;
		expect(draft(late).expectedText).toBe("Text\n");
		const changed = dispatch(
			late,
			{ type: "changeDraft", text: "After undo", selection: [0, 0] },
			dependencies,
		).state;
		const next = dispatch(changed, { type: "commit", trigger: "save" }, dependencies);
		expect(next.state.pending?.kind).toBe("commit");
		if (next.state.pending?.kind !== "commit") throw new Error("Expected next save");
		expect(next.state.pending.request.targets[0].expectedText).toBe("Text\n");
		expect(next.state.pending.request.args.text).toBe("After undo");
	},
);

it("07h fix D11 resolves a missing saved focus without reading a removed node", () => {
	const { state, result } = committing(true);
	const settled = dispatch(state, { type: "operationReply", result }, dependencies).state;
	const readDraft = vi.fn(() => {
		throw Error("Editor draft unavailable");
	});
	const admitted = dispatch(
		settled,
		{ type: "sourceSnapshot", file: seed.file, revision: "saved", seq: 1 },
		{ ...dependencies, selectionNodes: () => [], readDraft },
	);
	expect(readDraft).not.toHaveBeenCalled();
	const post = admitted.effects.find((e) => e.type === "post" && e.method === "draftResolve");
	if (post?.type !== "post" || post.method !== "draftResolve") throw Error("Expected resolution");
	const resolved = dispatch(
		admitted.state,
		{
			type: "draftResolved",
			id: post.draft.id,
			generation: post.draft.generation,
			epoch: post.epoch,
			resolution: { kind: "removed" },
		},
		dependencies,
	).state;
	expect(draft(resolved)).toMatchObject({ status: "orphaned", text: "First save, more" });
	expect(resolved.draftAcknowledgements).toEqual({});
});
