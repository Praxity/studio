// @vitest-environment node
import { expect, it } from "vitest";
import { createSession, dispatch } from "./index";
import type { AuthorOperationResult, Command, Dependencies, Effect, Focus, Session } from "./types";

const opener: Focus = { file: "a.prax", nodeId: "note", role: "handle" };
const after: Focus = { ...opener, nodeId: "after" };
const seed = {
	file: "a.prax",
	baseRevision: "r0",
	expectedText: "::: note\nText\n:::\n",
	editableText: "::: note\nText\n",
	target: { kind: "node" as const, nodeId: "note", path: [0, 0], fingerprint: "fp" },
};
const deps: Dependencies = {
	now: 0,
	validateDraft: () => ({ diagnostics: [], escapes: false }),
	helperTokens: () => [],
	focusNeighbours: () => ({ next: after, page: after }),
	nameOfFocus: () => "Note",
	readDraft: (focus) => ({ ...seed, target: { ...seed.target, nodeId: focus.nodeId ?? "note" } }),
	translate: (message) => message.key,
	selectionNodes: () => [
		{
			id: "page",
			file: "a.prax",
			lessonId: "lesson",
			pageId: "page",
			parentId: null,
			kind: "page",
		},
		...["note", "after"].map((id) => ({
			id,
			file: "a.prax",
			lessonId: "lesson",
			pageId: "page",
			parentId: "page",
			kind: "block" as const,
		})),
	],
};
const send = (state: Session, command: Command) => dispatch(state, command, deps);
function reply(state: Session) {
	const pending = state.pending;
	if (!pending || pending.kind === "history") throw new Error("Expected operation");
	const result: Extract<AuthorOperationResult, { ok: true }> = {
		ok: true,
		transactionId: pending.request.transactionId,
		historyId: "history",
		files: [
			{
				path: "a.prax",
				fromRevision: "r0",
				toRevision: "r1",
				edits: [{ start: 0, end: 0, text: "Changed" }],
			},
		],
		intent: "modify",
		mapping: [],
		inverse: { files: [], guards: [], mapping: [] },
		summary: { key: "saved", params: {} },
		diagnostics: [],
		focus: opener,
	};
	return send(state, { type: "operationReply", result });
}
function deferred(effects: Effect[]) {
	const effect = effects.find((effect) => effect.type === "focus");
	if (effect?.type !== "focus" || !effect.requestId)
		throw new Error("Expected confirmed reply focus");
	return { ...effect, requestId: effect.requestId };
}
for (const action of ["implicit", "leave", "range"] as const) {
	it(`F8 D13 G10 ${action} stamps the gesture owner and defers selection to native confirmation`, () => {
		let state = send(createSession(), { type: "select", focus: opener }).state;
		if (action === "implicit")
			state = send(state, { type: "implicitEdit", seed, text: "Changed", opener }).state;
		else {
			state = send(state, { type: "openSource", seed }).state;
			state = send(state, { type: "changeDraft", text: "Changed", selection: [7, 7] }).state;
			state = send(
				state,
				action === "leave" ? { type: "escape" } : { type: "select", focus: after, mode: "range" },
			).state;
		}
		state = send(state, { type: "focusChanged", focus: after }).state;
		const settled = reply(state);
		const effect = deferred(settled.effects);
		expect(effect.expect).toEqual([
			{ ...opener, role: action === "implicit" ? "handle" : "source" },
		]);
		expect(settled.state.selected).toEqual(["after"]);
		expect(settled.state.focus).toEqual(after);
		const cancelled = send(settled.state, {
			type: "focusResult",
			requestId: effect.requestId,
			success: false,
		}).state;
		expect(cancelled.selected).toEqual(["after"]);
		expect(cancelled.focus).toEqual(after);
	});
}
it("F8 confirmation applies the intended selection once and refuses stale results", () => {
	let state = send(createSession(), { type: "select", focus: opener }).state;
	state = send(state, { type: "implicitEdit", seed, text: "Changed", opener }).state;
	state = send(state, { type: "focusChanged", focus: after }).state;
	const settled = reply(state);
	const effect = deferred(settled.effects);
	const stale = send(settled.state, {
		type: "focusResult",
		requestId: "unrelated",
		success: true,
	}).state;
	expect(stale.selected).toEqual(["after"]);
	const applied = send(stale, {
		type: "focusResult",
		requestId: effect.requestId,
		success: true,
	}).state;
	expect(applied.selected).toEqual(["note"]);
	expect(applied.focus).toEqual(opener);
	const moved = send(applied, { type: "focusChanged", focus: after }).state;
	expect(
		send(moved, { type: "focusResult", requestId: effect.requestId, success: true }).state.selected,
	).toEqual(["after"]);
});

it("F9 an undelivered reply supplies only an explicit lost-focus restoration target", () => {
	const pending = send(createSession(), {
		type: "implicitEdit",
		seed,
		text: "Changed",
		opener,
	}).state;
	const settled = reply(pending);
	const effect = deferred(settled.effects);
	expect(settled.state.focus).toBeNull();
	expect(
		send(settled.state, { type: "restoreFocus", lost: false }).effects.filter(
			(effect) => effect.type === "focus",
		),
	).toEqual([]);
	expect(
		send(createSession(), { type: "restoreFocus", lost: true }).effects.filter(
			(effect) => effect.type === "focus",
		),
	).toEqual([]);
	const restored = send(settled.state, { type: "restoreFocus", lost: true });
	expect(restored.effects.find((effect) => effect.type === "focus")).toEqual({
		type: "focus",
		target: opener,
	});
	expect(restored.state.selected).toEqual([]);
	const stale = send(restored.state, {
		type: "focusResult",
		requestId: effect.requestId,
		success: true,
	}).state;
	expect(stale.selected).toEqual([]);
	expect(send(stale, { type: "focusChanged", focus: opener }).state.selected).toEqual(["note"]);
});

it("F2 G10 returning to a retained source after a moved-focus save selects that source again", () => {
	let state = send(createSession(), { type: "openSource", seed }).state;
	state = send(state, { type: "changeDraft", text: "Changed", selection: [7, 7] }).state;
	state = send(state, { type: "commit", trigger: "save" }).state;
	state = send(state, { type: "focusChanged", focus: after }).state;
	expect(state.selected).toEqual(["note"]);
	expect(state.layers.at(-1)?.kind).toBe("source");
	const settled = reply(state);
	expect(settled.state.activeDraft).not.toBeNull();
	const returned = send(settled.state, {
		type: "focusChanged",
		focus: { ...opener, role: "source", selection: [7, 7] },
	}).state;
	expect(returned.selected).toEqual(["note"]);
	expect(returned.layers.at(-1)?.kind).toBe("source");
	const handle = send(returned, { type: "focusChanged", focus: opener }).state;
	const deletion = send(handle, {
		type: "selectionOperation",
		operation: "deleteBlocks",
		args: {},
	});
	expect(deletion.effects.filter((effect) => effect.type === "post")).toEqual([]);
});

it.each([
	["conflict", "save"],
	["invalid", "save"],
	["conflict", "range"],
	["invalid", "range"],
] as const)("F2 a refused %s %s preserves the source layer", (code, gesture) => {
	let state = send(createSession(), { type: "openSource", seed }).state;
	state = send(state, { type: "changeDraft", text: "Changed", selection: [7, 7] }).state;
	state = send(
		state,
		gesture === "save"
			? { type: "commit", trigger: "save" }
			: { type: "select", focus: after, mode: "range" },
	).state;
	const pending = state.pending;
	if (!pending || pending.kind !== "commit") throw new Error("Expected commit");
	state = send(state, { type: "focusChanged", focus: after }).state;
	state = send(state, {
		type: "operationReply",
		result: {
			ok: false,
			transactionId: pending.request.transactionId,
			code,
			message: { key: "op.conflict", params: {} },
		},
	}).state;
	state = send(state, { type: "focusChanged", focus: { ...opener, role: "source" } }).state;
	expect(state.selected).toEqual(["note"]);
	expect(state.layers.at(-1)).toEqual({ kind: "source", draftId: state.activeDraft });
	expect(
		send(state, {
			type: "selectionOperation",
			operation: "deleteBlocks",
			args: {},
		}).effects.filter((e) => e.type === "post"),
	).toEqual([]);
});

it.each([
	["after", after, ["after"]],
	["source handle", opener, ["note"]],
] as const)(
	"F2 G8 a native Tab select preserves %s through a delayed reply",
	(_name, destination, expected) => {
		let state = send(createSession(), { type: "openSource", seed }).state;
		state = send(state, { type: "changeDraft", text: "Changed", selection: [7, 7] }).state;
		// 09e moves native focus before sending select on the same port.
		state = send(state, { type: "focusChanged", focus: after }).state;
		state = send(state, { type: "select", focus: after }).state;
		expect(state.selected).toEqual(["after"]);
		if (destination === opener) state = send(state, { type: "focusChanged", focus: opener }).state;
		const settled = reply(state);
		expect(deferred(settled.effects).expect).toEqual([after]);
		expect(settled.state.history[0]?.selectionBefore?.selected).toEqual(["note"]);
		expect(settled.state.selected).toEqual(expected);
		// Delete may arrive before the queued focus command and its acknowledgement.
		const deletion = send(settled.state, {
			type: "selectionOperation",
			operation: "deleteBlocks",
			args: {},
		});
		expect(
			deletion.effects.find(
				(effect) => effect.type === "post" && effect.method === "operationApply",
			),
		).toMatchObject({ request: { targets: [{ ref: { nodeId: expected[0] } }] } });
	},
);

it.each([
	["native Tab", "undo"],
	["native Tab", "redo"],
	["stay save", "undo"],
	["stay save", "redo"],
	["open source", "undo"],
	["open source", "redo"],
	["open source accepted", "undo"],
	["open source accepted", "redo"],
] as const)(
	"F8 %s %s keeps persistent focus and Delete on the selected handle",
	(route, direction) => {
		let state = send(createSession(), { type: "openSource", seed }).state;
		state = send(state, { type: "changeDraft", text: "Changed", selection: [7, 7] }).state;
		if (route === "native Tab") {
			state = send(state, { type: "focusChanged", focus: after }).state;
			state = send(state, { type: "select", focus: after }).state;
		} else {
			state = send(
				state,
				route === "stay save"
					? { type: "commit", trigger: "save" }
					: { type: "openSource", seed: { ...seed, target: { ...seed.target, nodeId: "after" } } },
			).state;
			state = send(state, { type: "focusChanged", focus: after }).state;
		}
		const saved = reply(state);
		const saveFocus = saved.effects.find((effect) => effect.type === "focus" && effect.requestId);
		const saveState =
			route === "open source accepted"
				? send(saved.state, { type: "focusChanged", focus: opener }).state
				: saved.state;
		state =
			saveFocus?.type === "focus" && saveFocus.requestId
				? send(saveState, {
						type: "focusResult",
						requestId: saveFocus.requestId,
						success: route === "native Tab" || route === "open source accepted",
					}).state
				: saveState;
		if (state.activeDraft) state = send(state, { type: "escape" }).state;
		expect(state.pending).toBeNull();
		state = send(state, { type: "focusChanged", focus: after }).state;
		state = send(state, { type: "undo", inTextField: false }).state;
		const pending = state.pending;
		if (pending?.kind !== "history") throw new Error("Expected Undo request");
		const historyResult: Extract<AuthorOperationResult, { ok: true }> = {
			ok: true,
			transactionId: pending.transactionId,
			historyId: "history",
			files: [
				{
					path: "a.prax",
					fromRevision: "r1",
					toRevision: "r0",
					edits: [{ start: 0, end: 0, text: "Text" }],
				},
			],
			intent: "modify",
			mapping: [],
			inverse: { files: [], guards: [], mapping: [] },
			summary: { key: "saved", params: {} },
			diagnostics: [],
			focus: opener,
		};
		const undone = send(state, {
			type: "historyReply",
			transactionId: pending.transactionId,
			result: historyResult,
		});
		const delivery = deferred(undone.effects);
		expect(delivery.target).toEqual(opener);
		state = send(undone.state, {
			type: "focusResult",
			requestId: delivery.requestId,
			success: true,
		}).state;
		expect(state.focus).toEqual(opener);
		expect(state.selected).toEqual(["note"]);
		let deletionFocus = opener;
		if (direction === "redo") {
			state = send(state, { type: "redo", inTextField: false }).state;
			const redoPending = state.pending;
			if (redoPending?.kind !== "history") throw new Error("Expected Redo request");
			const redone = send(state, {
				type: "historyReply",
				transactionId: redoPending.transactionId,
				result: {
					...historyResult,
					transactionId: redoPending.transactionId,
					files: [
						{
							path: "a.prax",
							fromRevision: "r0",
							toRevision: "r1",
							edits: [{ start: 0, end: 0, text: "Changed" }],
						},
					],
				},
			});
			const redoDelivery = deferred(redone.effects);
			deletionFocus = route === "stay save" ? opener : after;
			expect(redoDelivery.target).toEqual(deletionFocus);
			state = send(redone.state, {
				type: "focusResult",
				requestId: redoDelivery.requestId,
				success: true,
			}).state;
			expect(state.focus).toEqual(deletionFocus);
			expect(state.selected).toEqual([deletionFocus.nodeId]);
		}
		const deletion = send(state, {
			type: "selectionOperation",
			operation: "deleteBlocks",
			args: {},
		});
		expect(
			deletion.effects.find(
				(effect) => effect.type === "post" && effect.method === "operationApply",
			),
		).toMatchObject({ request: { targets: [{ ref: { nodeId: deletionFocus.nodeId } }] } });
	},
);

it("F8 an unrelated source does not own another selection's history", () => {
	const last: Focus = { ...after, nodeId: "last" };
	const otherDeps: Dependencies = {
		...deps,
		selectionNodes: () => [
			...(deps.selectionNodes?.() ?? []),
			{
				id: "last",
				file: "a.prax",
				lessonId: "lesson",
				pageId: "page",
				parentId: "page",
				kind: "block",
			},
		],
	};
	let state = dispatch(
		createSession(),
		{ type: "openSource", seed: { ...seed, baseRevision: "r1" } },
		otherDeps,
	).state;
	const draftId = state.activeDraft;
	state.history = [
		{
			id: "other",
			kind: "operation",
			operations: [],
			historyIds: ["other-history"],
			epoch: 0,
			focus: after,
			summary: { key: "saved", params: {} },
			selectionBefore: {
				selected: ["after"],
				selection: { anchor: "after", focus: "after", extended: false, allScope: null },
				focus: after,
			},
		},
	];
	state.cursor = 1;
	state.revisions["a.prax"] = "r1";
	const issue = (command: Command) => {
		const output = dispatch(state, command, otherDeps);
		state = output.state;
		return output.effects;
	};
	issue({ type: "focusChanged", focus: after });
	issue({ type: "undo", inTextField: false });
	const undoPending = state.pending;
	if (undoPending?.kind !== "history") throw new Error("Expected Undo request");
	const result: Extract<AuthorOperationResult, { ok: true }> = {
		ok: true,
		transactionId: undoPending.transactionId,
		historyId: "other-history",
		files: [
			{
				path: "a.prax",
				fromRevision: "r1",
				toRevision: "r0",
				edits: [{ start: 0, end: 0, text: "Earlier" }],
			},
		],
		intent: "modify",
		mapping: [],
		inverse: { files: [], guards: [], mapping: [] },
		summary: { key: "saved", params: {} },
		diagnostics: [],
		focus: after,
	};
	const restored = deferred(
		issue({ type: "historyReply", transactionId: undoPending.transactionId, result }),
	);
	issue({ type: "focusResult", requestId: restored.requestId, success: true });
	expect(state.activeDraft).toBe(draftId);
	expect(state.selected).toEqual(["after"]);
	issue({ type: "selectionOperation", operation: "deleteBlocks", args: {} });
	const deletion = state.pending;
	if (deletion?.kind !== "operation") throw new Error("Expected delete of After");
	const delivered = deferred(
		issue({
			type: "operationReply",
			result: {
				...result,
				transactionId: deletion.request.transactionId,
				historyId: "delete-after",
				files: [
					{
						path: "a.prax",
						fromRevision: "r0",
						toRevision: "r1",
						edits: [{ start: 0, end: 0, text: "Deleted After" }],
					},
				],
				intent: "delete",
				mapping: [{ oldId: "after", newId: null, fate: "deleted" }],
				focus: last,
			},
		}),
	);
	expect(state.activeDraft).toBe(draftId);
	expect(state.history.at(-1)?.selectionAfter?.selected).toEqual(["last"]);
	expect(state.history.at(-1)?.selectionAfter?.focus).toEqual(last);
	issue({ type: "focusResult", requestId: delivered.requestId, success: true });
	expect(state.history.at(-1)?.selectionAfter?.focus).toEqual(last);
});
