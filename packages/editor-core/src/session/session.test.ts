// @vitest-environment node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	OperationRefusal,
	OperationRequest,
} from "@praxity/grammar/src/operations/contract.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import {
	announcement,
	createSession,
	dispatch,
	historyView,
	nodeNames,
	sameDraftTarget,
} from "./index";
import type {
	AuthorOperationResult,
	Command,
	Dependencies,
	DraftSeed,
	Effect,
	Focus,
	Session,
	TargetSnapshot,
} from "./types";

const seed: DraftSeed = {
	file: "lesson.prax",
	target: { kind: "node", nodeId: "a", path: [0, 0], fingerprint: "fp" },
	baseRevision: "r0",
	expectedText: "::: note\r\nText\r\n:::\r\n",
	editableText: "::: note\r\nText\r\n",
};
it.each(["parentRef", "afterRef", "beforeRef"] as const)(
	"01c insertion drafts distinguish unstored %s fingerprints",
	(key) => {
		const first: DraftSeed = {
			...seed,
			target: {
				kind: "insertion",
				parentId: null,
				after: null,
				before: null,
				[key]: { kind: "node", nodeId: null, path: [0, 0], fingerprint: "a" },
			},
		};
		const second: DraftSeed = {
			...seed,
			target: {
				kind: "insertion",
				parentId: null,
				after: null,
				before: null,
				[key]: { kind: "node", nodeId: null, path: [0, 1], fingerprint: "b" },
			},
		};
		expect(sameDraftTarget(first, second)).toBe(false);
		expect(sameDraftTarget(first, structuredClone(first))).toBe(true);
	},
);
const handle: Focus = { file: seed.file, nodeId: "a", role: "handle" };
const snapshot: TargetSnapshot = {
	target: { file: seed.file, ref: seed.target, expectedText: seed.expectedText },
	revision: "r0",
	draftId: null,
};
const request: OperationRequest = {
	transactionId: "tx",
	operation: "moveBlocks",
	files: [{ path: seed.file, baseRevision: "r0" }],
	targets: [snapshot.target],
	args: {},
};
const deps: Dependencies = {
	now: 0,
	validateDraft: () => ({ diagnostics: [], escapes: false }),
	helperTokens: () => [],
	focusNeighbours: () => ({
		next: { ...handle, nodeId: "next" },
		page: { ...handle, nodeId: "page" },
	}),
	nameOfFocus: () => "Paragraph: Next",
	readDraft: () => seed,
	translate: (message) => message.key,
};
it("M2 reports consumption only when cancellation belongs to an active layer", () => {
	const idle = createSession();
	expect(dispatch(idle, { type: "escape" }, deps).consumed).toBe(false);
	const selected = dispatch(idle, { type: "select", focus: handle }, deps).state;
	expect(dispatch(selected, { type: "escape" }, deps).consumed).toBe(true);
	const source = dispatch(selected, { type: "openSource", seed }, deps).state;
	expect(dispatch(source, { type: "escape" }, deps).consumed).toBe(true);
});
function success(
	transactionId = "tx",
	operation = "moveBlocks",
	fromRevision = "r0",
	toRevision = "r1",
): Extract<AuthorOperationResult, { ok: true }> {
	return {
		ok: true,
		historyId: `service-${transactionId}`,
		transactionId,
		files: [
			{
				path: seed.file,
				fromRevision,
				toRevision,
				edits: [{ start: 0, end: 0, text: "x" }],
			},
		],
		intent: "move",
		mapping: [{ oldId: "a", newId: "a", fate: "kept" }],
		inverse: { files: [], mapping: [{ oldId: "a", newId: "a", fate: "kept" }], guards: [] },
		summary: { key: `op.${operation}`, params: { count: 1 } },
		diagnostics: [],
		focus: handle,
	};
}

for (const resultKind of ["saved", "refused"] as const) {
	it.each([
		null,
		{ ...handle },
		{ ...handle, role: "source", nodeId: "other" },
		{ ...handle, role: "source", file: "other.prax" },
		{ ...handle, role: "source" },
	] satisfies (Focus | null)[])(
		`F10 ${resultKind} settlement preserves the author's current focus %j`,
		(currentFocus) => {
			let state = dispatch(createSession(), { type: "openSource", seed }, deps).state;
			state = dispatch(
				state,
				{ type: "changeDraft", text: "::: note\nSaved\n", selection: [10, 10] },
				deps,
			).state;
			state = dispatch(state, { type: "commit", trigger: "save" }, deps).state;
			if (state.pending?.kind !== "commit") throw new Error("Expected pending save");
			const transactionId = state.pending.request.transactionId;
			state = dispatch(
				state,
				{ type: "changeDraft", text: "::: note\nSaved plus typing\n", selection: [20, 20] },
				deps,
			).state;
			state = currentFocus
				? dispatch(state, { type: "focusChanged", focus: currentFocus }, deps).state
				: { ...state, focus: null };
			const result =
				resultKind === "saved"
					? success(transactionId, "editSource")
					: {
							ok: false as const,
							transactionId,
							code: "conflict" as const,
							message: { key: "op.conflict", params: {} },
						};
			const settled = dispatch(state, { type: "operationReply", result }, deps);
			const focusEffects = settled.effects.filter((effect) => effect.type === "focus");
			if (
				currentFocus?.role === "source" &&
				currentFocus.file === seed.file &&
				currentFocus.nodeId === "a"
			) {
				expect(focusEffects).toEqual([
					{
						type: "focus",
						target: { ...handle, role: "source", selection: [20, 20] },
						reason: "settlement",
						expect: [{ ...handle, role: "source" }],
						requestId: expect.stringMatching(/^focus-/u),
					},
				]);
			} else {
				expect(focusEffects).toEqual([]);
				expect(settled.state.focus).toEqual(currentFocus);
			}
		},
	);
}

it.each(["operation", "undo", "redo"] as const)(
	"D16 %s acknowledgement classifies rebased outside input before recording its revision",
	(kind) => {
		let state = dispatch(createSession(), { type: "openSource", seed }, deps).state;
		if (kind !== "operation") {
			state = dispatch(state, { type: "operation", request }, deps).state;
			state = dispatch(state, { type: "operationReply", result: success() }, deps).state;
			if (kind === "redo") {
				state = dispatch(state, { type: "undo", inTextField: false }, deps).state;
				const pending = state.pending;
				if (pending?.kind !== "history") throw new Error("Expected history write");
				const result = success(pending.transactionId);
				result.historyId = pending.historyId;
				result.files[0].fromRevision = "r1";
				result.files[0].toRevision = "r0";
				state = dispatch(
					state,
					{ type: "historyReply", transactionId: pending.transactionId, result },
					deps,
				).state;
			}
		}
		state = dispatch(
			state,
			kind === "operation" ? { type: "operation", request } : { type: kind, inTextField: false },
			deps,
		).state;
		const pending = state.pending;
		if (!pending) throw new Error("Expected pending write");
		const transactionId =
			pending.kind === "history" ? pending.transactionId : pending.request.transactionId;
		const result = success(transactionId);
		if (pending.kind === "history") result.historyId = pending.historyId;
		result.files[0].fromRevision = "outside-revision";
		result.files[0].toRevision = "merged-revision";
		const settled = dispatch(
			state,
			kind === "operation"
				? { type: "operationReply", result }
				: { type: "historyReply", transactionId, result },
			deps,
		);
		expect(settled.state.epoch).toBe(1);
		expect(settled.state.revisions[seed.file]).toBe("merged-revision");
		expect(
			settled.effects.filter(
				(effect) => effect.type === "post" && effect.method === "draftResolve",
			),
		).toMatchObject([{ epoch: 1, draft: { file: seed.file } }]);
		if (kind === "operation") expect(settled.state.history[0].epoch).toBe(1);
	},
);

it("D16 an already classified outside revision is not counted again by a rebased reply", () => {
	let state = dispatch(createSession(), { type: "openSource", seed }, deps).state;
	state = dispatch(state, { type: "operation", request }, deps).state;
	state = dispatch(
		state,
		{ type: "outsideChange", file: seed.file, revision: "outside-revision" },
		deps,
	).state;
	const result = success();
	result.files[0].fromRevision = "outside-revision";
	result.files[0].toRevision = "merged-revision";
	const settled = dispatch(state, { type: "operationReply", result }, deps);
	expect(settled.state.epoch).toBe(1);
	expect(settled.state.revisions[seed.file]).toBe("merged-revision");
	expect(
		settled.effects.filter((effect) => effect.type === "post" && effect.method === "draftResolve"),
	).toEqual([]);
});
function harness(options = {}) {
	let state: Session = createSession(options);
	let clock = 0;
	let dependencies = deps;
	const send = (command: Command) => {
		const result = dispatch(state, command, { ...dependencies, now: clock });
		state = result.state;
		// This fixture's native adapter accepts focus; cancellation is covered in reply-focus.test.ts.
		const focus = result.effects.filter((effect) => effect.type === "focus").at(-1);
		if (focus?.type === "focus" && focus.requestId)
			state = dispatch(
				state,
				{ type: "focusResult", requestId: focus.requestId, success: true },
				{ ...dependencies, now: clock },
			).state;
		return result.effects;
	};
	return {
		send,
		get state() {
			return state;
		},
		time: (now: number) => {
			clock = now;
		},
		dependencies: (next: Partial<Dependencies>) => {
			dependencies = { ...deps, ...next };
		},
	};
}
const announcements = (effects: Effect[]) => effects.filter((e) => e.type === "announce");

it("D16 switching fields cannot replace an acknowledged source revision with its pre-save seed", () => {
	const h = harness();
	h.send({ type: "openSource", seed });
	h.send({ type: "changeDraft", text: "First field", selection: [0, 0] });
	const post = posts(
		h.send({
			type: "openSource",
			seed: {
				...seed,
				target: { ...seed.target, nodeId: "b" },
				editableText: "Second field",
			},
		}),
	)[0];
	if (post?.method !== "operationApply") throw new Error("Expected field-switch save");
	h.send({ type: "operationReply", result: { ...success(post.request.transactionId), seq: 1 } });
	expect(h.state.revisions[seed.file]).toBe("r1");
	h.send({ type: "changeDraft", text: "Next save", selection: [0, 0] });
	const next = posts(h.send({ type: "commit", trigger: "save" }))[0];
	if (next?.method !== "operationApply") throw new Error("Expected second save");
	h.send({
		type: "operationReply",
		result: { ...success(next.request.transactionId, "editSource", "r1", "r2"), seq: 2 },
	});
	expect(h.state.revisions[seed.file]).toBe("r2");
	expect(h.state.epoch).toBe(0);
});

it.each(["operation", "undo", "redo"] as const)(
	"D16 a %s acknowledgement older than the admitted snapshot cannot move revisions backward",
	(kind) => {
		const h = harness();
		h.send({ type: "operation", request });
		h.send({ type: "operationReply", result: { ...success(), seq: 1 } });
		h.send({ type: "sourceSnapshot", file: seed.file, revision: "outside-r3", seq: 3 });
		if (kind === "redo") {
			const undo = posts(h.send({ type: "undo", inTextField: false }))[0];
			if (undo?.method !== "historyApply") throw new Error("Expected undo");
			h.send({
				type: "historyReply",
				transactionId: undo.transactionId,
				result: {
					...success(undo.transactionId, "moveBlocks", "r1", "r0"),
					seq: 2,
					historyId: undo.historyId,
				},
			});
		}
		const post = posts(
			h.send(
				kind === "operation" ? { type: "operation", request } : { type: kind, inTextField: false },
			),
		)[0];
		if (post?.method === "operationApply")
			h.send({ type: "operationReply", result: { ...success(), seq: 2 } });
		else if (post?.method === "historyApply")
			h.send({
				type: "historyReply",
				transactionId: post.transactionId,
				result: {
					...success(post.transactionId),
					seq: 2,
					historyId: post.historyId,
				},
			});
		else throw new Error("Expected pending write");
		expect(h.state.revisions[seed.file]).toBe("outside-r3");
		expect(h.state.revisionSeqs[seed.file]).toBe(3);
		expect(h.state.epoch).toBe(1);
	},
);
const posts = (effects: Effect[]) => effects.filter((e) => e.type === "post");
it("07f D17 restoration preserves admitted revision through equal and higher sequence snapshots", () => {
	const saved = harness();
	saved.send({ type: "openSource", seed });
	saved.send({ type: "changeDraft", text: "Held author text", selection: [0, 0] });
	const oldDraft = Object.values(saved.state.drafts)[0];
	const h = harness();
	h.send({ type: "sourceSnapshot", file: seed.file, revision: "current-r3", seq: 3 });
	h.send({
		type: "restoreDrafts",
		drafts: [
			{
				draft: oldDraft,
				resolution: {
					kind: "changed",
					seed: {
						...seed,
						baseRevision: "current-r3",
						expectedText: "Outside text",
						editableText: "Outside text",
					},
				},
				page: "First",
			},
		],
	});
	expect(h.state.revisionSeqs[seed.file]).toBe(3);
	expect(h.state.revisions[seed.file]).toBe("current-r3");
	expect(Object.values(h.state.drafts)[0]).toMatchObject({
		status: "conflict",
		text: "Held author text",
		baseRevision: "r0",
	});
	h.send({ type: "sourceSnapshot", file: seed.file, revision: "current-r3", seq: 3 });
	expect(h.state.revisions[seed.file]).toBe("current-r3");
	h.send({ type: "sourceSnapshot", file: seed.file, revision: "current-r3", seq: 4 });
	expect(h.state.epoch).toBe(0);
});
const translate = (
	language: "en" | "fr",
	key: string,
	params: Record<string, string | number> = {},
) =>
	createTranslator({
		locale: language,
		messages: language === "en" ? en : fr,
		onError: (error) => {
			throw error;
		},
	})(key, params);

it("I4 write correspondence upgrades host selection, focus and an open ID-free draft without entering history", () => {
	const runtimeId = "rt-00000000000000000000000000001003";
	const durableId = "00000000-0000-4000-8000-000000002001";
	const s = harness();
	s.send({ type: "select", focus: { ...handle, nodeId: runtimeId } });
	s.send({
		type: "openSource",
		seed: { ...seed, target: { ...seed.target, nodeId: null } },
		displayId: runtimeId,
	});
	s.send({ type: "changeDraft", text: "Keep my open draft", selection: [2, 5] });
	s.send({
		type: "operation",
		request,
		focus: { kind: "helper", opener: { ...handle, nodeId: runtimeId } },
	});
	const effects = s.send({
		type: "operationReply",
		result: { ...success(), correspondence: [{ runtimeId, durableId }] },
	});
	expect(s.state.selected).toEqual([durableId]);
	expect(s.state.selection.anchor).toBe(durableId);
	expect(s.state.selection.focus).toBe(durableId);
	expect(s.state.focus?.nodeId).toBe(durableId);
	expect(Object.values(s.state.drafts)[0]).toMatchObject({
		target: { nodeId: durableId },
		text: "Keep my open draft",
		selection: [2, 5],
	});
	expect(JSON.stringify(s.state.history)).not.toContain("correspondence");
	expect(JSON.stringify(s.state.history)).not.toContain("rt-");
	expect(JSON.stringify(effects)).not.toContain("correspondence");
});

for (const direction of ["undo", "redo"] as const) {
	it(`I4 history correspondence upgrades an open ID-free draft on ${direction}`, () => {
		const runtimeId = "rt-00000000000000000000000000001003";
		const durableId = "00000000-0000-4000-8000-000000002001";
		const storedFocus = { ...handle, nodeId: "00000000-0000-4000-8000-000000002009" };
		const s = harness();
		s.send({ type: "select", focus: storedFocus });
		s.send({ type: "operation", request });
		s.send({ type: "operationReply", result: { ...success(), focus: storedFocus } });
		if (direction === "redo") {
			const undo = posts(s.send({ type: "undo", inTextField: false }))[0];
			if (undo?.method !== "historyApply") throw new Error("Expected undo");
			s.send({
				type: "historyReply",
				transactionId: undo.transactionId,
				result: {
					...success(undo.transactionId, "moveBlocks", "r1", "r0"),
					historyId: undo.historyId,
					focus: storedFocus,
				},
			});
		}
		const draftSeed = { ...seed, file: "a.prax", target: { ...seed.target, nodeId: null } };
		s.send({ type: "openSource", seed: draftSeed, displayId: runtimeId });
		s.send({ type: "changeDraft", text: "Keep my open draft", selection: [2, 5] });
		expect(s.state.selected).toEqual([runtimeId]);
		const post = posts(s.send({ type: direction, inTextField: false }))[0];
		if (post?.method !== "historyApply") throw new Error("Expected history write");
		expect(post.direction).toBe(direction);
		const inverse = {
			files: [],
			mapping: [{ oldId: storedFocus.nodeId, newId: storedFocus.nodeId, fate: "kept" as const }],
			guards: [],
		};
		const effects = s.send({
			type: "historyReply",
			transactionId: post.transactionId,
			result: {
				...success(
					post.transactionId,
					"moveBlocks",
					direction === "undo" ? "r1" : "r0",
					direction === "undo" ? "r0" : "r1",
				),
				historyId: post.historyId,
				focus: storedFocus,
				inverse,
				correspondence: [{ runtimeId, durableId }],
			},
		});
		expect(s.state.epoch).toBe(0);
		expect(posts(effects).filter((effect) => effect.method === "draftResolve")).toEqual([]);
		expect(Object.values(s.state.drafts)).toHaveLength(1);
		expect(Object.values(s.state.drafts)[0]).toMatchObject({
			target: { nodeId: durableId },
			text: "Keep my open draft",
			selection: [2, 5],
		});
		// History restores the stored edit's selection while the unrelated draft stays open.
		expect(s.state.selected).toEqual([storedFocus.nodeId]);
		expect(s.state.focus?.nodeId).toBe(storedFocus.nodeId);
		expect(s.state.history[0].historyIds).toEqual(["service-tx"]);
		expect(s.state.history[0]).not.toHaveProperty("undo");
		expect(s.state.history[0]).not.toHaveProperty("redo");
		expect(JSON.stringify(s.state.history)).not.toContain("correspondence");
		expect(JSON.stringify(effects)).not.toContain("correspondence");
		expect(Object.values(s.state.draftDisplayIds)).toEqual([durableId]);
		const save = posts(s.send({ type: "commit", trigger: "save" }))[0];
		if (save?.method !== "operationApply") throw new Error("Expected remapped draft save");
		expect(save.request.targets[0]).toMatchObject({ file: "a.prax", ref: { nodeId: durableId } });
	});
}

it("I4 a reply for a different transaction cannot apply correspondence", () => {
	const runtimeId = "rt-00000000000000000000000000001003";
	const s = harness();
	s.send({ type: "select", focus: { ...handle, nodeId: runtimeId } });
	s.send({ type: "operation", request });
	s.send({
		type: "operationReply",
		result: {
			...success("old"),
			correspondence: [{ runtimeId, durableId: "00000000-0000-4000-8000-000000002001" }],
		},
	});
	expect(s.state.selected).toEqual([runtimeId]);
	expect(s.state.focus?.nodeId).toBe(runtimeId);
});

it("I4 replacement commits focus the durable draft seed when its previous display node retired", () => {
	const runtimeId = "rt-00000000000000000000000000001003";
	const durableId = "00000000-0000-4000-8000-000000002001";
	const s = harness();
	s.dependencies({
		readDraft: () => ({
			...seed,
			baseRevision: "r1",
			target: { ...seed.target, nodeId: durableId },
		}),
	});
	s.send({
		type: "openSource",
		seed: { ...seed, target: { ...seed.target, nodeId: null } },
		displayId: runtimeId,
	});
	s.send({ type: "changeDraft", text: "Replacement", selection: [0, 0] });
	s.send({ type: "commit", trigger: "save" });
	const pending = s.state.pending;
	if (pending?.kind !== "commit") throw new Error("Missing commit");
	s.send({
		type: "operationReply",
		result: {
			...success(pending.request.transactionId, "editSource"),
			intent: "replace",
			focus: { ...handle, nodeId: durableId },
			correspondence: [],
		},
	});
	s.send({ type: "sourceSnapshot", file: seed.file, revision: "r1", seq: 1 });
	expect(s.state.focus?.nodeId).toBe(durableId);
	expect(Object.values(s.state.drafts)[0].target).toMatchObject({ nodeId: durableId });
});

describe("session rules", () => {
	// The ledger's source proof is absence after deletion, never the former node's text.
	it.each(
		(
			[
				"clean",
				"dirty",
				"invalid",
				"held",
				"conflict",
				"orphaned",
				"absent",
				"empty insertion",
			] as const
		).flatMap((starting) =>
			(["no undo", "before reply", "after reply", "undo then redo"] as const).flatMap((undo) =>
				(["escape", "enter", "pointer"] as const).map((leave) => ({ starting, undo, leave })),
			),
		),
	)("delete model D3 D4 D6 D11 F8 from $starting, $undo, $leave", ({ starting, undo, leave }) => {
		const h = harness();
		const paragraph = { ...seed, expectedText: "Bravo.\n", editableText: "Bravo.\n" };
		if (starting !== "absent")
			h.send({
				type: "openSource",
				seed:
					starting === "empty insertion"
						? {
								...paragraph,
								target: { kind: "insertion", parentId: "page", after: null, before: null },
								expectedText: "",
								editableText: "",
							}
						: paragraph,
			});
		if (["dirty", "invalid", "held"].includes(starting)) {
			h.send({ type: "changeDraft", text: "Changed\n", selection: [0, 0] });
			h.dependencies({
				validateDraft: () => ({
					escapes: starting === "held",
					diagnostics:
						starting === "invalid"
							? [
									{
										file: seed.file,
										ref: null,
										severity: "error",
										message: { key: "op.diagnostic.invalid-source", params: {} },
									},
								]
							: [],
				}),
			});
			h.time(200);
			h.send({ type: "tick" });
			expect(Object.values(h.state.drafts)[0].status).toBe(starting);
		}
		if (starting === "conflict" || starting === "orphaned") {
			h.send({ type: "outsideChange", file: seed.file, revision: "outside" });
			const draft = Object.values(h.state.drafts)[0];
			h.send({
				type: "draftResolved",
				id: draft.id,
				generation: draft.generation,
				epoch: h.state.epoch,
				resolution:
					starting === "conflict"
						? { kind: "changed", seed: { ...paragraph, editableText: "Outside\n" } }
						: { kind: "removed" },
			});
			expect(Object.values(h.state.drafts)[0].status).toBe(starting);
		}
		h.send({ type: "changeDraft", text: "", selection: [0, 0] });
		const commit = posts(h.send({ type: "commit", trigger: "save" }));
		if (starting === "absent" || starting === "empty insertion") {
			expect(commit).toEqual([]);
			expect(h.state.drafts).toEqual({});
			return;
		}
		if (starting === "conflict" || starting === "orphaned") {
			expect(commit).toEqual([]);
			expect(Object.values(h.state.drafts)[0]).toMatchObject({ text: "", status: starting });
			return;
		}
		const post = commit[0];
		assert(post?.method === "operationApply");
		expect(post.request).toMatchObject({
			files: [{ baseRevision: "r0" }],
			targets: [{ expectedText: "Bravo.\n" }],
			args: { text: "" },
		});
		const model = { text: "", baseline: "absent", revision: "deleted-r1" };
		const input = (text: string) => {
			model.text = text;
			h.send({ type: "changeDraft", text, selection: [text.length, text.length] });
		};
		if (undo === "before reply" || undo === "undo then redo") input("Bravo.\n");
		const result = {
			...success(post.request.transactionId, "editSource", "r0", "deleted-r1"),
			intent: "delete" as const,
			focus: { ...handle, nodeId: "next" },
			mapping: [{ oldId: "a", newId: null, fate: "retired" as const }],
		};
		const receiptEffects = h.send({ type: "operationReply", result });
		if (undo === "after reply") input("Bravo.\n");
		if (undo === "undo then redo") input("");
		const expected = {
			text: model.text,
			baseText: "",
			baseRevision: model.revision,
			status: model.text ? "orphaned" : "clean",
		};
		expect(Object.values(h.state.drafts)[0]).toMatchObject(expected);
		h.time(400);
		h.send({ type: "tick" });
		expect(Object.values(h.state.drafts)[0]).toMatchObject(expected);
		const effects = h.send(
			leave === "escape"
				? { type: "escape" }
				: leave === "enter"
					? { type: "commit", trigger: "enter" }
					: { type: "pointer", insideGroup: false, insideLayer: false },
		);
		expect(posts(effects)).toEqual([]);
		expect(h.state.activeDraft).toBeNull();
		expect(h.state.layers.some((layer) => layer.kind === "source")).toBe(false);
		expect(h.state.focus?.nodeId).toBe("next");
		expect(Object.values(h.state.drafts)).toMatchObject(model.text ? [expected] : []);
		if (model.text)
			expect([...receiptEffects, ...effects]).toContainEqual(
				expect.objectContaining({
					type: "persistDraft",
					action: "put",
					draft: expect.objectContaining(expected),
				}),
			);
	});
	it("D6 delete without returned revision fails loudly and retains the pending author text", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "", selection: [0, 0] });
		const post = posts(h.send({ type: "commit", trigger: "save" }))[0];
		assert(post?.method === "operationApply");
		h.send({ type: "changeDraft", text: "Bravo.\n", selection: [7, 7] });
		const before = h.state;
		expect(() =>
			h.send({
				type: "operationReply",
				result: {
					...success(post.request.transactionId),
					intent: "delete",
					files: [],
				},
			}),
		).toThrow("Deleted draft revision unavailable");
		expect(h.state).toBe(before);
		expect(Object.values(h.state.drafts)[0].text).toBe("Bravo.\n");
	});
	it.each(["put back", "discard", "source restored", "source changed"] as const)(
		"D11 explicit %s ends the deleted baseline",
		(action) => {
			const h = harness();
			const paragraph = { ...seed, expectedText: "Bravo.\n", editableText: "Bravo.\n" };
			h.send({ type: "openSource", seed: paragraph });
			h.send({ type: "changeDraft", text: "", selection: [0, 0] });
			const post = posts(h.send({ type: "commit", trigger: "save" }))[0];
			assert(post?.method === "operationApply");
			h.send({
				type: "operationReply",
				result: { ...success(post.request.transactionId), intent: "delete" },
			});
			h.send({ type: "changeDraft", text: "Bravo.\n", selection: [7, 7] });
			const draft = Object.values(h.state.drafts)[0];
			expect(draft.status).toBe("orphaned");
			if (action === "put back") {
				const put = posts(
					h.send({
						type: "putDraftBack",
						seed: {
							...paragraph,
							baseRevision: "r1",
							expectedText: "",
							editableText: "",
							target: { kind: "insertion", parentId: "page", after: "alpha", before: "charlie" },
						},
					}),
				)[0];
				assert(put?.method === "operationApply");
				expect(put.request).toMatchObject({
					operation: "insertBlock",
					args: { text: "Bravo.\n" },
					targets: [{ ref: { kind: "insertion", after: "alpha", before: "charlie" } }],
				});
			} else if (action === "discard") {
				h.send({ type: "discardDraft", id: draft.id });
				expect(h.state.drafts).toEqual({});
				h.send({ type: "openSource", seed: paragraph });
			} else {
				h.send({ type: "outsideChange", file: seed.file, revision: "restored-r2" });
				h.send({
					type: "draftResolved",
					id: draft.id,
					generation: draft.generation,
					epoch: h.state.epoch,
					resolution: {
						kind: action === "source changed" ? "changed" : "unchanged",
						seed: { ...paragraph, baseRevision: "restored-r2" },
					},
				});
				if (action === "source changed") {
					h.send({ type: "changeDraft", text: "Bravo restored.\n", selection: [0, 0] });
					expect(Object.values(h.state.drafts)[0].status).toBe("conflict");
					h.send({ type: "keepDraft" });
				}
			}
			h.send({ type: "changeDraft", text: "Bravo restored.\n", selection: [0, 0] });
			expect(Object.values(h.state.drafts)[0].status).toBe("dirty");
		},
	);
	it("allocates distinct draft IDs in independent windows", () => {
		const first = harness();
		const second = harness();
		first.send({ type: "openSource", seed });
		second.send({ type: "openSource", seed });
		expect(first.state.activeDraft).not.toBe(second.state.activeDraft);
	});
	it("M1 M2 M3 M4: 10,000 random event sequences close only the innermost layer and preserve typed drafts", () => {
		let random = 0x731de;
		const next = (max: number) => {
			random ^= random << 13;
			random ^= random >>> 17;
			random ^= random << 5;
			return (random >>> 0) % max;
		};
		for (let sequence = 0; sequence < 10_000; sequence++) {
			const h = harness();
			h.send({ type: "select", focus: handle });
			h.send({ type: "openSource", seed });
			assert.notEqual(h.state.activeDraft, null, `seed 0x731de, sequence ${sequence}, setup`);
			for (let step = 0; step < 25; step++) {
				try {
					const before = h.state;
					const top = before.layers.at(-1);
					const action = next(6);
					if (action === 0)
						h.send({
							type: "openPopup",
							popup: top?.kind === "popup" ? "submenu" : "helper",
							opener: { ...handle, role: "source" },
							target: snapshot,
						});
					else if (action === 1)
						h.send({ type: "openDialog", dialog: "history", opener: handle, target: snapshot });
					else if (action === 2 && before.activeDraft && top?.kind === "source")
						h.send({ type: "changeDraft", text: `typed ${sequence} ${step}`, selection: [0, 0] });
					else if (action === 3) {
						const effects = h.send({ type: "escape" });
						if (top?.kind === "popup" || top?.kind === "dialog") {
							assert.deepEqual(h.state.layers, before.layers.slice(0, -1));
							assert.deepEqual(h.state.drafts, before.drafts);
							assert.equal(posts(effects).length, 0);
						} else if (top?.kind === "source" && before.activeDraft) {
							const draft = before.drafts[before.activeDraft];
							if (draft.text !== draft.baseText) {
								const post = posts(effects)[0];
								assert.equal(post?.method, "operationApply");
								if (post?.method === "operationApply") {
									assert.equal(post.request.args.text, draft.text);
									h.send({
										type: "operationReply",
										result: {
											ok: false,
											transactionId: post.request.transactionId,
											code: "escapes-range",
											message: { key: "op.escapes-range", params: {} },
										},
									});
									assert.equal(h.state.drafts[draft.id].text, draft.text);
								}
							}
						}
					} else if (
						action === 4 &&
						!before.activeDraft &&
						top?.kind !== "popup" &&
						top?.kind !== "dialog"
					)
						h.send({ type: "openSource", seed });
					else h.send({ type: "blur" });
					assert.ok(h.state.layers.filter((l) => l.kind === "source").length <= 1);
					assert.ok(h.state.layers.filter((l) => l.kind === "dialog").length <= 1);
					const popupIndexes = h.state.layers.flatMap((l, i) => (l.kind === "popup" ? [i] : []));
					assert.ok(popupIndexes.every((index, i) => i === 0 || index === popupIndexes[i - 1] + 1));
					assert.deepEqual(h.state.layers[0], { kind: "page" });
					assert.ok(
						h.state.layers.every((l, i) => (l.kind !== "popup" && l.kind !== "dialog") || i > 0),
					);
				} catch (error) {
					throw new Error(`seed 0x731de, sequence ${sequence}, step ${step}, rng ${random >>> 0}`, {
						cause: error,
					});
				}
			}
		}
	}, 30_000);

	it("A1 A5 A8: exactly one announcement for every registered operation and refusal", () => {
		const registry = readFileSync(
			fileURLToPath(new URL("../../../operations/src/index.ts", import.meta.url)),
			"utf8",
		);
		const operations = [...registry.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
		expect(operations.length).toBeGreaterThanOrEqual(7);
		for (const operation of operations) {
			const h = harness({ interfaceLanguage: "fr", courseLanguage: "en" });
			h.send({
				type: "operation",
				request: { ...request, operation },
				context: {
					name: "Note: Hello",
					type: "Note",
					parent: "page Welcome",
					prevName: "Paragraph: Before",
					nextName: "Paragraph: After",
					pos: "2 of 3",
					key: "Tone",
					value: "Warning",
				},
			});
			const speech = announcements(
				h.send({ type: "operationReply", result: success("tx", operation) }),
			);
			expect(speech, operation).toHaveLength(1);
			expect(speech[0].level).toBe("polite");
			expect(speech[0].interfaceLanguage).toBe("fr");
			expect(speech[0].courseLanguage).toBe("en");
			expect(translate("fr", speech[0].message.key, speech[0].message.params)).not.toBe(
				speech[0].message.key,
			);
		}
		for (const code of [
			"stale",
			"conflict",
			"ambiguous",
			"orphaned",
			"escapes-range",
			"not-allowed",
			"invalid-args",
		] as const) {
			const h = harness();
			h.send({ type: "operation", request });
			const result: OperationRefusal = {
				ok: false,
				transactionId: "tx",
				code,
				message: { key: `op.${code}`, params: {} },
			};
			const speech = announcements(h.send({ type: "operationReply", result }));
			expect(speech, code).toHaveLength(1);
			expect(speech[0].level).toBe("assertive");
		}
	});

	it("A2 A4 A8: English and French announcement snapshots omit absent clauses", () => {
		const cases = [
			["saved", {}, "Saved.", "Enregistré."],
			[
				"deleted",
				{ name: "Note: Journal", undo: "Undo with Control Z" },
				"Deleted Note: Journal. Undo with Control Z.",
				"Note: Journal supprimé. Undo with Control Z.",
			],
			[
				"duplicated",
				{ name: "Note: Journal" },
				"Duplicated Note: Journal.",
				"Note: Journal dupliqué.",
			],
			["selectionCleared", {}, "Selection cleared.", "Sélection effacée."],
			[
				"moved",
				{ parent: "page Bonjour", pos: "1 of 2", nextName: "Note: Après" },
				"Moved up. 1 of 2 in page Bonjour. First in page Bonjour. Before Note: Après.",
				"Déplacé vers le haut. 1 of 2 dans page Bonjour. Premier dans page Bonjour. Avant Note: Après.",
			],
			[
				"moved",
				{ parent: "Column 2 of 2", pos: "2 of 2", prevName: "Note: Before" },
				"Moved up. 2 of 2 in Column 2 of 2. After Note: Before. Last in Column 2 of 2.",
				"Déplacé vers le haut. 2 of 2 dans Column 2 of 2. Après Note: Before. Dernier dans Column 2 of 2.",
			],
			[
				"draftsRestored",
				{ n: 1, pages: "page 3" },
				"1 unsaved draft restored: page 3.",
				"1 brouillon non enregistré restauré : page 3.",
			],
			[
				"draftsRestored",
				{ n: 2, pages: "page 3, page 5" },
				"2 unsaved drafts restored: page 3, page 5.",
				"2 brouillons non enregistrés restaurés : page 3, page 5.",
			],
			[
				"nothingInField",
				{},
				"Nothing more to undo in this block. Leave the block to undo earlier changes.",
				"Rien d'autre à annuler dans ce bloc. Quittez le bloc pour annuler les modifications précédentes.",
			],
		] as const;
		for (const [event, params, english, french] of cases) {
			const message = announcement(event, params);
			expect(translate("en", message.key, message.params)).toBe(english);
			expect(translate("fr", message.key, message.params)).toBe(french);
		}
	});

	it("A3: every node in both converted courses has a schema-labelled, unquoted, unique sibling name", () => {
		const root = fileURLToPath(new URL("../../../grammar/__tests__/fixtures/v4/", import.meta.url));
		let count = 0;
		for (const course of ["leadership", "toolkit"]) {
			for (const file of readdirSync(`${root}/${course}`).filter((f) => f.endsWith(".prax"))) {
				const tree = analyzeLessonTree(
					tokenizeLesson(readFileSync(`${root}/${course}/${file}`, "utf8")),
					{ definition: getDefinition },
				);
				for (const language of ["en", "fr"] as const) {
					const names = nodeNames(tree.root, (key, params = {}) =>
						translate(language, key, params),
					);
					const visit = (node: typeof tree.root) => {
						expect(names.get(node)).toBeTruthy();
						expect(names.get(node)).not.toMatch(/[…"'“”‘’]/u);
						expect(new Set(node.children.map((n) => names.get(n))).size).toBe(node.children.length);
						count++;
						node.children.forEach(visit);
					};
					visit(tree.root);
				}
			}
		}
		expect(count).toBeGreaterThan(500);
	});
});

describe("drafts, focus and history through dispatch", () => {
	it("D1 D2: LF field excludes closer while the request guards original whole bytes", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		const draft = h.state.drafts[h.state.activeDraft as string];
		expect(draft.baseText).toBe("::: note\nText\n");
		expect(draft.text).not.toContain(":::\n");
		h.send({ type: "changeDraft", text: "::: note\nChanged", selection: [0, 0] });
		const post = posts(h.send({ type: "commit", trigger: "save" }))[0];
		expect(post?.method).toBe("operationApply");
		if (post?.method === "operationApply") {
			expect(post.request.targets[0].expectedText).toBe(seed.expectedText);
			expect(post.request.files).toEqual([{ path: seed.file, baseRevision: "r0" }]);
			expect(post.request.args.text).toBe("::: note\nChanged");
		}
	});
	it("D3 D4: typing neither parses nor posts; validation and persistence have separate idle deadlines", () => {
		const h = harness();
		let parsed = 0;
		h.dependencies({
			validateDraft: () => {
				parsed++;
				return { diagnostics: [], escapes: false };
			},
		});
		h.send({ type: "openSource", seed });
		for (let i = 0; i < 200; i++) {
			h.time(i * 100);
			expect(posts(h.send({ type: "changeDraft", text: `text ${i}`, selection: [0, 0] }))).toEqual(
				[],
			);
		}
		expect(parsed).toBe(0);
		h.time(20049);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
		expect(parsed).toBe(0);
		h.time(20050);
		h.send({ type: "tick" });
		expect(parsed).toBe(1);
		h.time(20899);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
		h.time(20900);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toHaveLength(1);
		h.time(22000);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
	});
	it("D3 preserves generation 2 after a failed put and acknowledges only its successful retry", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		for (const text of ["Old", "New"]) {
			const effects = h.send({ type: "changeDraft", text, selection: [0, 0] });
			expect(effects.filter((e) => e.type === "post" || e.type === "persistDraft")).toEqual([]);
		}
		const draftId = h.state.activeDraft as string;
		h.time(1000);
		const put = h
			.send({ type: "tick" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(put?.type === "persistDraft" && put.action === "put");
		expect(h.state.drafts[draftId]).toMatchObject({
			generation: 2,
			persistedGeneration: -1,
			text: "New",
		});
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: put.requestId,
			generation: 2,
			ok: false,
		});
		expect(h.state.drafts[draftId]).toMatchObject({
			generation: 2,
			persistedGeneration: -1,
			text: "New",
		});
		const retry = h
			.send({ type: "tick" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(retry?.type === "persistDraft" && retry.action === "put");
		expect(retry.draft.text).toBe("New");
		expect(retry.requestId).not.toBe(put.requestId);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: put.requestId,
			generation: 2,
			ok: true,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(-1);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: retry.requestId,
			generation: 2,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toMatchObject({ persistedGeneration: 2, text: "New" });
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
	});
	it.each([true, false])("D3 ignores an old generation 1 acknowledgement with ok=%s", (ok) => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "Old", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		const old = h
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(old?.type === "persistDraft" && old.action === "put");
		h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		const current = h
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(current?.type === "persistDraft" && current.action === "put");
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: old.requestId,
			generation: 1,
			ok,
		});
		expect(h.state.drafts[draftId]).toMatchObject({
			generation: 2,
			persistedGeneration: -1,
			text: "New",
		});
		h.time(1000);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: current.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(-1);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: current.requestId,
			generation: 2,
			ok: true,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(2);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: old.requestId,
			generation: 1,
			ok,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(2);
	});
	it("D3 does not acknowledge newer typing when the only pending put succeeds", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "Old", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		const put = h
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(put?.type === "persistDraft" && put.action === "put");
		h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: put.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toMatchObject({ persistedGeneration: -1, text: "New" });
		h.time(1000);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toHaveLength(1);
	});
	it("D3 D16 undo of an acknowledged discard retries its failed restore put", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		const original = h
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(original?.type === "persistDraft" && original.action === "put");
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: original.requestId,
			generation: 1,
			ok: true,
		});
		h.send({ type: "discardDraft", id: draftId });
		const restored = h
			.send({ type: "undo", inTextField: false })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(restored?.type === "persistDraft" && restored.action === "put");
		expect(h.state.drafts[draftId]).toMatchObject({
			text: "New",
			generation: 1,
			persistedGeneration: -1,
		});
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: restored.requestId,
			generation: 1,
			ok: false,
		});
		h.time(1000);
		const retry = h
			.send({ type: "tick" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(retry?.type === "persistDraft" && retry.action === "put");
		expect(retry.draft).toMatchObject({ text: "New", generation: 1, persistedGeneration: -1 });
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: restored.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(-1);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: retry.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toMatchObject({
			text: "New",
			generation: 1,
			persistedGeneration: 1,
		});
	});
	it("D3 retries a failed clean revert without writing on a key or persisting untouched source", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.time(1000);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
		h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		expect(
			h
				.send({ type: "changeDraft", text: "::: note\nText\n", selection: [0, 0] })
				.filter((e) => e.type !== "render"),
		).toEqual([]);
		const draftId = h.state.activeDraft as string;
		h.time(2000);
		const put = h
			.send({ type: "tick" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(put?.type === "persistDraft" && put.action === "put");
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: put.requestId,
			generation: 2,
			ok: false,
		});
		const retry = h
			.send({ type: "retryDraftPersistence", id: draftId })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(retry?.type === "persistDraft" && retry.action === "put");
		expect(retry.draft).toMatchObject({
			text: "::: note\nText\n",
			status: "clean",
			generation: 2,
			persistedGeneration: -1,
		});
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: retry.requestId,
			generation: 2,
			ok: true,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(2);
		expect(h.send({ type: "tick" }).filter((e) => e.type === "persistDraft")).toEqual([]);
	});
	it("D9 retries a failed persistence put for a closed refused draft", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		const commit = posts(h.send({ type: "escape" }))[0];
		assert(commit.method === "operationApply");
		const refusal = h.send({
			type: "operationReply",
			result: {
				ok: false,
				transactionId: commit.request.transactionId,
				code: "not-allowed",
				message: { key: "op.notAllowed", params: {} },
			},
		});
		const put = refusal.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(put?.type === "persistDraft" && put.action === "put");
		expect(h.state.activeDraft).toBeNull();
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: put.requestId,
			generation: 1,
			ok: false,
		});
		const retry = h
			.send({ type: "retryDraftPersistence", id: draftId })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(retry?.type === "persistDraft" && retry.action === "put");
		expect(retry.draft).toMatchObject({ status: "held", text: "New", persistedGeneration: -1 });
		expect(
			h
				.send({ type: "retryDraftPersistence", id: draftId })
				.filter((e) => e.type === "persistDraft"),
		).toEqual([]);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: retry.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toMatchObject({
			status: "held",
			persistedGeneration: 1,
			text: "New",
		});
	});
	it("D9 ignores an earlier put reply after refusal metadata supersedes it at the same generation", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		const old = h
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(old?.type === "persistDraft" && old.action === "put");
		const commit = posts(h.send({ type: "commit", trigger: "save" }))[0];
		assert(commit.method === "operationApply");
		const refusal = h.send({
			type: "operationReply",
			result: {
				ok: false,
				transactionId: commit.request.transactionId,
				code: "not-allowed",
				message: { key: "op.notAllowed", params: {} },
			},
		});
		const current = refusal.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(current?.type === "persistDraft" && current.action === "put");
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: old.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toMatchObject({
			status: "held",
			persistedGeneration: -1,
			text: "New",
		});
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: current.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toMatchObject({
			status: "held",
			persistedGeneration: 1,
			text: "New",
		});
	});
	it("D17 ignores pre-reload put replies for a restored draft", () => {
		const before = harness();
		before.send({ type: "openSource", seed });
		before.send({ type: "changeDraft", text: "New", selection: [0, 0] });
		const draftId = before.state.activeDraft as string;
		const old = before
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(old?.type === "persistDraft" && old.action === "put");
		const h = harness();
		h.send({
			type: "restoreDrafts",
			drafts: [{ draft: old.draft, resolution: { kind: "unchanged", seed }, page: "3" }],
		});
		h.send({ type: "openSource", seed });
		const current = h
			.send({ type: "blur" })
			.find((e) => e.type === "persistDraft" && e.action === "put");
		assert(current?.type === "persistDraft" && current.action === "put");
		expect(h.send({ type: "blur" }).filter((e) => e.type === "persistDraft")).toEqual([]);
		expect(current.requestId).not.toBe(old.requestId);
		const restored = structuredClone(h.state.drafts[draftId]);
		const waiting = structuredClone(h.state.pendingDraftPersistence[draftId]);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: old.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId]).toEqual(restored);
		expect(h.state.pendingDraftPersistence[draftId]).toEqual(waiting);
		h.send({
			type: "draftPersistenceReply",
			id: draftId,
			requestId: current.requestId,
			generation: 1,
			ok: true,
		});
		expect(h.state.drafts[draftId].persistedGeneration).toBe(1);
		expect(h.state.history).toEqual([]);
	});
	it.each(["discard", "commit"])(
		"D3 ignores a late put reply after %s removes the persisted draft",
		(action) => {
			const h = harness();
			h.send({ type: "openSource", seed });
			h.send({ type: "changeDraft", text: "New", selection: [0, 0] });
			const draftId = h.state.activeDraft as string;
			const put = h
				.send({ type: "blur" })
				.find((e) => e.type === "persistDraft" && e.action === "put");
			assert(put?.type === "persistDraft" && put.action === "put");
			if (action === "discard") h.send({ type: "discardDraft", id: draftId });
			else {
				const commit = posts(h.send({ type: "commit", trigger: "save" }))[0];
				assert(commit.method === "operationApply");
				h.send({
					type: "operationReply",
					result: success(commit.request.transactionId, "editText"),
				});
			}
			const before = h.state.drafts[draftId];
			expect(before?.persistedGeneration).not.toBe(1);
			h.send({
				type: "draftPersistenceReply",
				id: draftId,
				requestId: put.requestId,
				generation: 1,
				ok: true,
			});
			expect(h.state.drafts[draftId]).toEqual(before);
			expect(
				h
					.send({ type: "retryDraftPersistence", id: draftId })
					.filter((e) => e.type === "persistDraft"),
			).toEqual([]);
		},
	);
	it.each(["escape", "enter", "save", "pointer", "focus", "node", "lens"])(
		"D6 M5 M6 M7 M8 M9 F8: %s commits once then chooses the specified destination",
		(trigger) => {
			const h = harness();
			h.send({ type: "openSource", seed });
			h.send({ type: "changeDraft", text: "new", selection: [1, 1] });
			const destination = { ...handle, nodeId: "b" };
			const commands: Record<string, Command> = {
				escape: { type: "escape" },
				enter: { type: "commit", trigger: "enter" },
				save: { type: "commit", trigger: "save" },
				pointer: { type: "pointer", insideGroup: false, insideLayer: false, focus: destination },
				focus: { type: "focusLeave", insideGroup: false, focus: destination },
				node: {
					type: "openSource",
					seed: {
						...seed,
						target: { ...seed.target, kind: "node", nodeId: "b", path: [0, 1], fingerprint: "b" },
					},
				},
				lens: { type: "switchLens", lens: "print" },
			};
			const post = posts(h.send(commands[trigger]))[0];
			expect(post?.method).toBe("operationApply");
			if (post?.method !== "operationApply") throw new Error("Expected commit");
			expect(posts(h.send(commands[trigger]))).toEqual([]);
			h.dependencies({
				readDraft: () => ({
					...seed,
					baseRevision: "r1",
					expectedText: "new",
					editableText: "new",
				}),
			});
			h.send({ type: "operationReply", result: success(post.request.transactionId, "editSource") });
			if (trigger === "save") {
				expect(h.state.focus?.role).toBe("source");
				expect(h.state.activeDraft).not.toBeNull();
			} else if (trigger === "pointer" || trigger === "focus")
				expect(h.state.focus).toEqual(destination);
			else if (trigger === "node") expect(h.state.focus?.nodeId).toBe("b");
			else if (trigger === "lens") expect(h.state.lens).toBe("print");
			else expect(h.state.focus?.role).toBe("handle");
			expect(h.state.history).toHaveLength(1);
		},
	);
	it("M5: inside-group pointers and window blur preserve L2 and only persist", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "new", selection: [0, 0] });
		expect(posts(h.send({ type: "pointer", insideGroup: true, insideLayer: true }))).toEqual([]);
		expect(posts(h.send({ type: "focusLeave", insideGroup: true, focus: handle }))).toEqual([]);
		const effects = h.send({ type: "blur" });
		expect(posts(effects)).toEqual([]);
		expect(effects.filter((e) => e.type === "persistDraft")).toHaveLength(1);
		expect(h.state.layers.at(-1)?.kind).toBe("source");
	});
	it("M9: Source lens posts once after two seconds, preserves scope and stays in its field", () => {
		const h = harness();
		h.send({ type: "switchLens", lens: "source", seed });
		h.send({ type: "changeDraft", text: "# New\n", selection: [6, 6] });
		h.time(1999);
		expect(posts(h.send({ type: "tick" }))).toEqual([]);
		h.time(2000);
		const post = posts(h.send({ type: "tick" }))[0];
		expect(post?.method).toBe("operationApply");
		if (post?.method === "operationApply") {
			expect(post.request.args.scope).toBe("file");
			expect(post.request.args.text).toBe("# New\n");
		}
		expect(posts(h.send({ type: "tick" }))).toEqual([]);
	});
	it("D9 M8: escape-range refusal holds the original draft and opens the next node", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		const original = h.state.activeDraft as string;
		h.send({ type: "changeDraft", text: "::: note\n:::\n:::", selection: [0, 0] });
		const post = posts(
			h.send({
				type: "openSource",
				seed: { ...seed, target: { kind: "node", nodeId: "b", path: [0, 1], fingerprint: "b" } },
			}),
		)[0];
		if (post?.method !== "operationApply") throw new Error("Expected commit");
		h.send({
			type: "operationReply",
			result: {
				ok: false,
				transactionId: post.request.transactionId,
				code: "escapes-range",
				message: { key: "op.escapes-range", params: {} },
			},
		});
		expect(h.state.drafts[original].status).toBe("held");
		expect(h.state.drafts[original].text).toBe("::: note\n:::\n:::");
		expect(h.state.focus?.nodeId).toBe("b");
		expect(h.state.history).toEqual([]);
	});
	it("D6: an acknowledgement cannot erase typing that arrived during the write", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "sent", selection: [4, 4] });
		const post = posts(h.send({ type: "escape" }))[0];
		if (post?.method !== "operationApply") throw new Error("Expected commit");
		h.send({ type: "changeDraft", text: "sent plus", selection: [9, 9] });
		h.dependencies({
			readDraft: () => ({
				...seed,
				baseRevision: "r1",
				expectedText: "sent",
				editableText: "sent",
			}),
		});
		h.send({ type: "operationReply", result: success(post.request.transactionId, "editSource") });
		const draft = h.state.drafts[h.state.activeDraft as string];
		expect(draft.text).toBe("sent plus");
		expect(draft.baseText).toBe("sent");
		expect(draft.status).toBe("dirty");
		expect(h.state.focus?.selection).toEqual([9, 9]);
	});
	it.each(["unchanged", "changed", "removed"] as const)(
		"D10 D11: outside target %s never replaces typed text or steals focus",
		(kind) => {
			const h = harness();
			h.send({ type: "openSource", seed });
			h.send({ type: "changeDraft", text: "mine", selection: [4, 4] });
			const originalFocus = h.state.focus;
			const effects = h.send({ type: "outsideChange", file: seed.file, revision: "r2" });
			expect(posts(effects)[0]?.method).toBe("draftResolve");
			const draft = h.state.drafts[h.state.activeDraft as string];
			const outside = {
				...seed,
				baseRevision: "r2",
				expectedText: kind === "changed" ? "theirs" : seed.expectedText,
				target: { kind: "node" as const, nodeId: "a", path: [0, 2], fingerprint: "new-fp" },
			};
			const reply = h.send({
				type: "draftResolved",
				id: draft.id,
				generation: draft.generation,
				epoch: h.state.epoch,
				resolution: kind === "removed" ? { kind } : { kind, seed: outside },
			});
			expect(h.state.drafts[draft.id].text).toBe("mine");
			expect(reply.filter((e) => e.type === "focus")).toEqual([]);
			expect(h.state.focus).toEqual(originalFocus);
			if (kind === "unchanged") {
				expect(h.state.drafts[draft.id].baseRevision).toBe("r2");
				expect(h.state.drafts[draft.id].target).toEqual(outside.target);
			} else
				expect(h.state.drafts[draft.id].status).toBe(kind === "changed" ? "conflict" : "orphaned");
		},
	);
	it("D11 D16: use outside version is an undoable discard, keep draft binds to the outside bytes", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "mine", selection: [0, 0] });
		const draft = h.state.drafts[h.state.activeDraft as string];
		h.send({ type: "outsideChange", file: seed.file, revision: "r2" });
		h.send({
			type: "draftResolved",
			id: draft.id,
			generation: 1,
			epoch: 1,
			resolution: {
				kind: "changed",
				seed: { ...seed, baseRevision: "r2", expectedText: "theirs", editableText: "theirs" },
			},
		});
		const post = posts(h.send({ type: "keepDraft" }))[0];
		if (post?.method !== "operationApply") throw new Error("Expected keep");
		expect(post.request.files[0].baseRevision).toBe("r2");
		expect(post.request.targets[0].expectedText).toBe("theirs");
		expect(post.request.args.text).toBe("mine");
	});
	it("D5 D12: stale helper retargets one structural key through native insertion; ambiguity refuses once", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({
			type: "openPopup",
			popup: "helper",
			opener: { ...handle, role: "chip:tone" },
			target: snapshot,
			helper: { key: "tone", line: "opener", range: [0, 4], text: "note" },
		});
		h.send({ type: "changeDraft", text: "something elsewhere", selection: [0, 0] });
		h.dependencies({
			helperTokens: () => [{ key: "tone", line: "opener", range: [5, 9], text: "info" }],
		});
		const effects = h.send({ type: "applyHelper", text: "warning" });
		expect(effects.find((e) => e.type === "nativeText")).toMatchObject({
			action: "insert",
			range: [5, 9],
			text: "warning",
			generation: 1,
		});
		expect(h.state.drafts[h.state.activeDraft as string].text).toBe("something elsewhere");
		expect(posts(effects)).toEqual([]);
		h.send({
			type: "openPopup",
			popup: "helper",
			opener: handle,
			target: snapshot,
			helper: { key: "tone", line: "opener", range: [0, 1], text: "x" },
		});
		h.send({ type: "changeDraft", text: "braces gone", selection: [0, 0] });
		h.dependencies({ helperTokens: () => [] });
		const refusal = h.send({ type: "applyHelper", text: "warning" });
		expect(announcements(refusal)).toHaveLength(1);
		expect(announcements(refusal)[0].level).toBe("assertive");
		expect(h.state.layers.at(-1)?.kind).toBe("popup");
	});
	it("D13 F8: an implicit helper guards source bytes, posts one editSource and returns to its opener", () => {
		const h = harness();
		const opener = { ...handle, role: "chip:tone" as const };
		const post = posts(h.send({ type: "implicitEdit", seed, text: "new", opener }))[0];
		if (post?.method !== "operationApply") throw new Error("Expected implicit operation");
		expect(post.request.operation).toBe("editSource");
		expect(post.request.targets[0].expectedText).toBe(seed.expectedText);
		expect(h.state.activeDraft).toBeNull();
		h.send({ type: "operationReply", result: success(post.request.transactionId, "editSource") });
		expect(h.state.focus).toEqual(opener);
		expect(h.state.history).toHaveLength(1);
	});
	// Owner 2026-10-14: D16 session grouping waits until after the editor switch, U7 slice 04a.
	it("D14 D16: consecutive saves each retain one service ID and allow undo", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		for (let i = 0; i < 3; i++) {
			h.send({ type: "changeDraft", text: `save ${i}`, selection: [0, 0] });
			const post = posts(h.send({ type: "commit", trigger: "save" }))[0];
			if (post?.method !== "operationApply") throw new Error("Expected commit");
			h.dependencies({
				readDraft: () => ({
					...seed,
					baseRevision: `r${i + 1}`,
					expectedText: `save ${i}`,
					editableText: `save ${i}`,
				}),
			});
			h.send({
				type: "operationReply",
				result: {
					...success(post.request.transactionId, "editSource"),
					files: [
						{
							path: seed.file,
							fromRevision: `r${i}`,
							toRevision: `r${i + 1}`,
							edits: [{ start: 0, end: 0, text: `save ${i}` }],
						},
					],
					inverse: {
						files: [],
						mapping: [{ oldId: "a", newId: "a", fate: "kept" }],
						guards: [
							{ kind: "written", file: seed.file, ref: seed.target as never, text: `save ${i}` },
						],
					},
				},
			});
			h.send({ type: "sourceSnapshot", file: seed.file, revision: `r${i + 1}`, seq: i + 1 });
		}
		expect(h.state.history).toHaveLength(3);
		for (const entry of h.state.history) {
			expect(entry.operations).toHaveLength(1);
			expect(entry.historyIds).toEqual([`service-${entry.operations[0].transactionId}`]);
		}
		expect(historyView(h.state, deps).undo.disabled).toBe(false);
		h.send({ type: "escape" });
		const post = posts(h.send({ type: "undo", inTextField: false }))[0];
		expect(post).toMatchObject({
			method: "historyApply",
			direction: "undo",
			historyId: h.state.history[2].historyIds[0],
		});
		expect(h.state.pending?.kind).toBe("history");
		expect(h.state.cursor).toBe(3);
	});
	it("D15: native text undo never falls through; forms keep native undo even with a clean source draft", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		const nothing = h.send({ type: "undo", inTextField: true });
		expect(posts(nothing)).toEqual([]);
		expect(announcements(nothing)[0]?.message.key).toBe("session.announcements.nothingInField");
		h.send({
			type: "openDialog",
			dialog: "link",
			opener: { ...handle, role: "source" },
			target: snapshot,
		});
		const form = h.send({ type: "undo", inTextField: true });
		expect(form.find((e) => e.type === "nativeText")).toEqual({
			type: "nativeText",
			action: "undo",
		});
		expect(announcements(form)).toEqual([]);
	});
	it("D16: discard then history undo restores the draft, selection and field", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "keep me", selection: [3, 3] });
		const draftId = h.state.activeDraft as string;
		h.send({ type: "discardDraft", id: draftId });
		expect(h.state.drafts[draftId]).toBeUndefined();
		h.send({ type: "undo", inTextField: false });
		expect(h.state.drafts[draftId].text).toBe("keep me");
		expect(h.state.focus?.role).toBe("source");
		expect(h.state.focus?.selection).toEqual([3, 3]);
	});
	it("D17 F9 A6: restores held/conflicted/orphaned drafts with empty history, one polite message and no focus", () => {
		const source = harness();
		source.send({ type: "openSource", seed });
		source.send({ type: "changeDraft", text: "persisted", selection: [0, 0] });
		const draft = source.state.drafts[source.state.activeDraft as string];
		const h = harness();
		const effects = h.send({
			type: "restoreDrafts",
			drafts: [
				{ draft, resolution: { kind: "unchanged", seed }, page: "page 3" },
				{ draft: { ...draft, id: "second" }, resolution: { kind: "removed" }, page: "page 5" },
			],
		});
		expect(h.state.drafts[draft.id].status).toBe("held");
		expect(h.state.drafts.second.status).toBe("orphaned");
		expect(h.state.activeDraft).toBeNull();
		expect(h.state.history).toEqual([]);
		expect(effects.filter((e) => e.type === "focus")).toEqual([]);
		const speech = announcements(h.send({ type: "tick" }));
		expect(speech).toHaveLength(1);
		expect(speech[0].level).toBe("polite");
		expect(speech[0].message.params.pages).toBe("page 3, page 5");
	});
	it("F6 F7 F10: submenu target is snapshotted before menu closure; action focuses the new field directly", () => {
		const h = harness();
		h.send({ type: "select", focus: handle });
		h.send({ type: "openPopup", popup: "actions", opener: handle, target: snapshot });
		h.send({ type: "openDialog", dialog: "turnInto", opener: handle, replaceMenu: true });
		expect(h.state.layers.some((l) => l.kind === "popup")).toBe(false);
		const effects = h.send({
			type: "menuOperation",
			operation: "insertBlock",
			args: {},
			focus: {
				kind: "insert",
				seed: {
					...seed,
					target: { kind: "node", nodeId: "new", path: [0, 2], fingerprint: "new" },
				},
				selection: [2, 6],
			},
		});
		const post = posts(effects)[0];
		if (post?.method !== "operationApply") throw new Error("Expected menu operation");
		expect(post.request.targets[0]).toEqual(snapshot.target);
		expect(effects.filter((e) => e.type === "focus")).toEqual([]);
		const reply = h.send({
			type: "operationReply",
			result: success(post.request.transactionId, "insertBlock"),
		});
		expect(reply.filter((e) => e.type === "focus")).toEqual([
			{
				type: "focus",
				target: { file: seed.file, nodeId: "new", role: "source", selection: [2, 6] },
				expect: [handle],
				requestId: expect.stringMatching(/^focus-/u),
			},
		]);
		expect(h.send({ type: "restoreFocus", lost: false }).filter((e) => e.type === "focus")).toEqual(
			[],
		);
		expect(
			h.send({ type: "restoreFocus", lost: true }).find((e) => e.type === "focus"),
		).toMatchObject({ target: h.state.focus });
	});
	it("A6 F9: backgrounds wait until typing has stopped for two seconds and never move focus", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.time(100);
		h.send({ type: "changeDraft", text: "typing", selection: [0, 0] });
		const effects = h.send({
			type: "background",
			message: announcement("runArrived", { runName: "Check", n: 2, p: 1 }),
		});
		expect(announcements(effects)).toEqual([]);
		h.time(2099);
		expect(announcements(h.send({ type: "tick" }))).toEqual([]);
		h.time(2100);
		const ready = h.send({ type: "tick" });
		expect(announcements(ready)).toHaveLength(1);
		expect(announcements(ready)[0].delayMs).toBeGreaterThanOrEqual(150);
		expect(ready.filter((e) => e.type === "focus")).toEqual([]);
	});
	it("D14: redo retains the server history ID; acknowledged inverses stay out of requests", () => {
		const h = harness();
		h.send({ type: "operation", request });
		h.send({ type: "operationReply", result: success() });
		const post = posts(h.send({ type: "undo", inTextField: false }))[0];
		if (post?.method !== "historyApply") throw new Error("Expected undo");
		const inverse = {
			files: [],
			mapping: [{ oldId: "a", newId: "a", fate: "kept" as const }],
			guards: [
				{ kind: "written" as const, file: seed.file, ref: seed.target as never, text: "before" },
			],
		};
		h.send({
			type: "historyReply",
			transactionId: post.transactionId,
			result: {
				...success(post.transactionId, "moveBlocks", "r1", "r0"),
				historyId: post.historyId,
				inverse,
			},
		});
		expect(h.state.epoch).toBe(0);
		const redo = posts(h.send({ type: "redo", inTextField: false }))[0];
		if (redo?.method !== "historyApply") throw new Error("Expected redo");
		expect(redo).toEqual({
			type: "post",
			method: "historyApply",
			transactionId: redo.transactionId,
			historyId: "service-tx",
			direction: "redo",
		});
	});
	it("D14: another history ID cannot acknowledge a pending undo or apply its correspondence", () => {
		const h = harness();
		h.send({ type: "operation", request });
		h.send({ type: "operationReply", result: success() });
		const post = posts(h.send({ type: "undo", inTextField: false }))[0];
		if (post?.method !== "historyApply") throw new Error("Expected undo");
		const before = structuredClone(h.state);
		expect(
			h.send({
				type: "historyReply",
				transactionId: post.transactionId,
				result: {
					...success(post.transactionId, "moveBlocks", "r1", "r0"),
					historyId: "another-history-id",
					correspondence: [{ runtimeId: "a", durableId: "other" }],
				},
			}),
		).toEqual([{ type: "render" }]);
		expect(h.state).toEqual(before);
		h.send({
			type: "historyReply",
			transactionId: post.transactionId,
			result: {
				...success(post.transactionId, "moveBlocks", "r1", "r0"),
				historyId: post.historyId,
			},
		});
		expect(h.state.cursor).toBe(0);
		expect(h.state.epoch).toBe(0);
	});
	it("F8: default insert opens the returned node's draft with caret at start", () => {
		const h = harness();
		h.dependencies({
			readDraft: () => ({
				...seed,
				target: { kind: "node", nodeId: "new", path: [0, 1], fingerprint: "new" },
			}),
		});
		h.send({ type: "operation", request: { ...request, operation: "insertBlock" } });
		h.send({
			type: "operationReply",
			result: {
				...success("tx", "insertBlock"),
				intent: "insert",
				focus: { ...handle, nodeId: "new", role: "source" },
			},
		});
		expect(h.state.activeDraft).not.toBeNull();
		expect(h.state.focus).toMatchObject({ nodeId: "new", role: "source", selection: [0, 0] });
	});
	it("F8 F9 A2: outside removal preserves a draft as orphaned and names the actual fallback node", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "mine", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		h.dependencies({
			translate: (message) =>
				message.key === "session.names.focusTarget" ? "wrong placeholder" : message.key,
		});
		const effects = h.send({
			type: "outsideChange",
			file: seed.file,
			revision: "r2",
			focusedRemoved: true,
		});
		expect(h.state.drafts[draftId].text).toBe("mine");
		expect(h.state.drafts[draftId].status).toBe("orphaned");
		expect(h.state.activeDraft).toBeNull();
		expect(h.state.focus?.nodeId).toBe("next");
		expect(announcements(effects)[0]?.message.params.name).toBe("Paragraph: Next");
		expect(announcements(effects)).toHaveLength(1);
		expect(announcements(effects)[0]).toMatchObject({
			level: "polite",
			message: { key: "session.announcements.focusedDraftRemoved" },
		});
		const translator = createTranslator({ locale: "en", messages: en });
		const message = announcements(effects)[0].message;
		expect(translator(message.key as Parameters<typeof translator>[0], message.params)).toBe(
			"This block was removed outside the editor. Your draft is kept.",
		);
		expect(
			announcements(
				h.send({
					type: "draftResolved",
					id: draftId,
					epoch: h.state.epoch,
					resolution: { kind: "removed" },
				}),
			),
		).toEqual([]);
	});
	it("D17: restoring a draft never collides with the next session-local draft ID", () => {
		const source = harness();
		source.send({ type: "openSource", seed });
		source.send({ type: "changeDraft", text: "persisted", selection: [0, 0] });
		const draft = source.state.drafts[source.state.activeDraft as string];
		const h = harness();
		h.send({
			type: "restoreDrafts",
			drafts: [{ draft, resolution: { kind: "unchanged", seed }, page: "page 3" }],
		});
		h.send({
			type: "openSource",
			seed: { ...seed, target: { kind: "node", nodeId: "b", path: [0, 1], fingerprint: "b" } },
		});
		expect(Object.keys(h.state.drafts)).toHaveLength(2);
		expect(h.state.drafts[draft.id].text).toBe("persisted");
	});
	it("M1 M9: read-only and Source lenses have no Page layers or menus", () => {
		const h = harness();
		h.send({ type: "switchLens", lens: "source", seed });
		expect(h.state.layers).toEqual([{ kind: "page" }]);
		h.send({ type: "openPopup", popup: "actions", opener: handle, target: snapshot });
		expect(h.state.layers).toEqual([{ kind: "page" }]);
	});
	it("D11: outside changes in a second file cannot invalidate the first draft's resolution", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "mine", selection: [0, 0] });
		const draftId = h.state.activeDraft as string;
		h.send({ type: "outsideChange", file: seed.file, revision: "r2" });
		h.send({ type: "outsideChange", file: "other.prax", revision: "other-r1" });
		h.send({
			type: "draftResolved",
			id: draftId,
			generation: 1,
			epoch: 1,
			resolution: { kind: "unchanged", seed: { ...seed, baseRevision: "r2" } },
		});
		expect(h.state.drafts[draftId].baseRevision).toBe("r2");
	});
	// Owner 2026-10-14: D16 session grouping waits until after the editor switch, U7 slice 04a.
	it("D16: an outside change advances the epoch of the next saved history entry", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		for (let i = 0; i < 2; i++) {
			h.send({ type: "changeDraft", text: `save ${i}`, selection: [0, 0] });
			const post = posts(h.send({ type: "commit", trigger: "save" }))[0];
			if (post?.method !== "operationApply") throw new Error("Expected commit");
			h.dependencies({
				readDraft: () => ({
					...seed,
					editableText: `save ${i}`,
					expectedText: `save ${i}`,
					baseRevision: `r${i + 1}`,
				}),
			});
			h.send({
				type: "operationReply",
				result: success(post.request.transactionId, "editSource", `r${i}`, `r${i + 1}`),
			});
			h.send({ type: "sourceSnapshot", file: seed.file, revision: `r${i + 1}`, seq: i + 1 });
			expect(h.state.epoch).toBe(i);
			if (!i) {
				h.send({ type: "outsideChange", file: "another.prax", revision: "other-r1" });
				expect(h.state.epoch).toBe(1);
				expect(h.state.revisions["another.prax"]).toBe("other-r1");
				expect(h.state.history.map((entry) => entry.epoch)).toEqual([0]);
			}
		}
		expect(h.state.epoch).toBe(1);
		expect(h.state.history.map((entry) => entry.epoch)).toEqual([0, 1]);
		expect(h.state.history).toHaveLength(2);
	});
	it.each([
		["duplicateBlocks", "copied"],
		["moveBlocks", "moved"],
		["turnInto", "converted"],
		["wrapInColumns", "nested"],
		["unwrapColumns", "first-child"],
		["removeItem", "next-item"],
	])("F8: %s focuses %s by identity and role", (operation, nodeId) => {
		const h = harness();
		h.send({ type: "operation", request: { ...request, operation } });
		h.send({
			type: "operationReply",
			result: { ...success("tx", operation), focus: { ...handle, nodeId, role: "handle" } },
		});
		expect(h.state.focus).toEqual({ ...handle, nodeId });
	});
	it.each(["next", "previous", "parent", "page"])(
		"F8: outside deletion falls back to %s in priority order",
		(fallback) => {
			const h = harness();
			h.send({ type: "select", focus: handle });
			const candidate = (nodeId: string) => ({ ...handle, nodeId });
			h.dependencies({
				focusNeighbours: () => ({
					...(fallback === "next" ? { next: candidate("next") } : {}),
					...(["next", "previous"].includes(fallback) ? { previous: candidate("previous") } : {}),
					...(fallback !== "page" ? { parent: candidate("parent") } : {}),
					page: candidate("page"),
				}),
			});
			h.send({ type: "outsideChange", file: seed.file, revision: "r2", focusedRemoved: true });
			expect(h.state.focus?.nodeId).toBe(fallback);
		},
	);
	it.each(["merge", "item", "review", "helper"])(
		"F8: %s uses the operation's editing or review destination",
		(kind) => {
			const h = harness();
			const target = { ...handle, nodeId: "destination" };
			h.dependencies({
				readDraft: () => ({
					...seed,
					target: { kind: "node", nodeId: "destination", path: [0, 1], fingerprint: "destination" },
				}),
			});
			const rules = {
				merge: { kind: "merge" as const, earlier: target, join: 7 },
				item: { kind: "add-item" as const, item: target },
				review: { kind: "review" as const, next: { ...target, role: "bubble" as const } },
				helper: { kind: "helper" as const, opener: { ...target, role: "chip:tone" as const } },
			};
			h.send({ type: "operation", request, focus: rules[kind as keyof typeof rules] });
			h.send({ type: "operationReply", result: success() });
			expect(h.state.focus?.nodeId).toBe("destination");
			if (kind === "merge") expect(h.state.focus?.selection).toEqual([7, 7]);
			if (kind === "item") expect(h.state.focus?.selection).toEqual([3, 3]);
			if (kind === "review") expect(h.state.focus?.role).toBe("bubble");
			if (kind === "helper") expect(h.state.focus?.role).toBe("chip:tone");
		},
	);
	it("D14 D16 A8: toolbar history names the next operation and target in the current interface language", () => {
		const h = harness();
		h.send({ type: "operation", request });
		h.send({ type: "operationReply", result: success() });
		for (const language of ["en", "fr"] as const) {
			const view = historyView(h.state, {
				translate: (m) => translate(language, m.key, m.params),
				nameOfFocus: () => "Note: Hello",
			});
			expect(translate(language, view.undo.message.key, view.undo.message.params)).toBe(
				language === "en"
					? "Undo: moved 1 block: Note: Hello"
					: "Annuler : déplacé 1 bloc : Note: Hello",
			);
			expect(view.redo.disabled).toBe(true);
			expect(view.redo.reason?.key).toBe("session.history.empty");
		}
	});
	it("D14: multi-file history is one atomic request and cannot advance on a mismatched response", () => {
		const h = harness();
		h.send({
			type: "operation",
			request: {
				...request,
				files: [...request.files, { path: "other.prax", baseRevision: "other-r0" }],
			},
		});
		h.send({
			type: "operationReply",
			result: {
				...success(),
				files: [
					...success().files,
					{
						path: "other.prax",
						fromRevision: "other-r0",
						toRevision: "other-r1",
						edits: [{ start: 0, end: 0, text: "y" }],
					},
				],
			},
		});
		expect(h.state.history).toHaveLength(1);
		const post = posts(h.send({ type: "undo", inTextField: false }))[0];
		if (post?.method !== "historyApply") throw new Error("Expected undo");
		expect(post).toEqual({
			type: "post",
			method: "historyApply",
			transactionId: post.transactionId,
			historyId: "service-tx",
			direction: "undo",
		});
		h.send({
			type: "historyReply",
			transactionId: post.transactionId,
			result: success("different"),
		});
		expect(h.state.cursor).toBe(1);
		expect(h.state.pending?.kind).toBe("history");
	});
	it("F7: submenus and dialogs inherit the chain's original target despite a different supplied selection", () => {
		const h = harness();
		const other = {
			...snapshot,
			target: {
				...snapshot.target,
				ref: { kind: "node" as const, nodeId: "b", path: [0, 1], fingerprint: "b" },
			},
		};
		h.send({ type: "openPopup", popup: "actions", opener: handle, target: snapshot });
		h.send({ type: "openPopup", popup: "submenu", opener: handle, target: other });
		h.send({
			type: "openDialog",
			dialog: "turnInto",
			opener: handle,
			target: other,
			replaceMenu: true,
		});
		const post = posts(
			h.send({ type: "menuOperation", operation: "turnInto", args: { type: "note" } }),
		)[0];
		if (post?.method !== "operationApply") throw new Error("Expected conversion");
		expect(post.request.targets).toEqual([snapshot.target]);
	});
	it("D11 D16: undo of Use the new version reopens the original conflicted draft", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		h.send({ type: "changeDraft", text: "mine", selection: [4, 4] });
		const originalId = h.state.activeDraft as string;
		h.send({ type: "outsideChange", file: seed.file, revision: "r2" });
		h.send({
			type: "draftResolved",
			id: originalId,
			generation: 1,
			epoch: 1,
			resolution: {
				kind: "changed",
				seed: { ...seed, baseRevision: "r2", expectedText: "theirs", editableText: "theirs" },
			},
		});
		h.send({ type: "useNewVersion" });
		expect(h.state.drafts[h.state.activeDraft as string].text).toBe("theirs");
		h.send({ type: "undo", inTextField: false });
		expect(h.state.activeDraft).toBe(originalId);
		expect(h.state.drafts[originalId].text).toBe("mine");
		expect(h.state.drafts[originalId].status).toBe("conflict");
		expect(h.state.focus?.selection).toEqual([4, 4]);
	});
	it("F6 F9: reported focus changes track a chip without causing focus or changing the layer", () => {
		const h = harness();
		h.send({ type: "openSource", seed });
		const before = h.state.layers;
		const chip = { ...handle, role: "chip:tone" as const };
		const effects = h.send({ type: "focusChanged", focus: chip });
		expect(effects.filter((e) => e.type === "focus")).toEqual([]);
		expect(h.state.layers).toEqual(before);
		expect(h.send({ type: "restoreFocus", lost: true }).find((e) => e.type === "focus")).toEqual({
			type: "focus",
			target: chip,
		});
	});
	it("D14 D16: outside changes preserve history; explicit availability replies update its blocked reason", () => {
		const h = harness();
		h.send({ type: "operation", request });
		h.send({ type: "operationReply", result: success() });
		const effects = h.send({ type: "outsideChange", file: seed.file, revision: "r2" });
		expect(posts(effects)).toEqual([]);
		expect(h.state.history[0].historyIds).toEqual(["service-tx"]);
		h.send({
			type: "historyAvailability",
			entryId: h.state.history[0].id,
			blocked: { key: "op.conflict", params: {} },
		});
		expect(historyView(h.state, deps).undo.disabled).toBe(true);
	});
});

it("r3: pageReplaced retains pending work, history and typed draft through dispatch", () => {
	const h = harness();
	h.send({ type: "operation", request });
	h.send({ type: "operationReply", result: success() });
	h.send({ type: "openSource", seed: { ...seed, baseRevision: "r1" } });
	h.send({ type: "changeDraft", text: "Kept typed draft", selection: [16, 16] });
	h.send({ type: "commit", trigger: "save" });
	h.send({ type: "background", message: { key: "session.announcements.saved", params: {} } });
	const before = structuredClone(h.state);
	expect(before.history).toHaveLength(1);
	expect(before.pending?.kind).toBe("commit");
	expect(Object.values(before.drafts)[0].text).toBe("Kept typed draft");
	const effects = h.send({ type: "pageReplaced" });
	expect(h.state).toEqual({ ...before, background: [] });
	expect(effects).toEqual([{ type: "render" }]);
	expect(before.background).toHaveLength(1);
	const id = h.state.pending?.kind === "commit" ? h.state.pending.request.transactionId : "missing";
	h.send({ type: "operationReply", result: success(id, "setText", "r1", "r2") });
	expect(h.state.pending).toBeNull();
	expect(h.state.epoch).toBe(0);
	expect(h.state.history).toHaveLength(2);
	h.time(3000);
	expect(announcements(h.send({ type: "tick" }))).toEqual([]);
});

it("D3 close preparation persists inactive unsaved drafts through the controller", () => {
	let state = dispatch(createSession(), { type: "openSource", seed }, deps).state;
	state = dispatch(
		state,
		{ type: "changeDraft", text: "Latest before close", selection: [2, 2] },
		deps,
	).state;
	const draft = Object.values(state.drafts)[0];
	state = {
		...state,
		activeDraft: null,
		drafts: {
			[draft.id]: draft,
			inactive: {
				...draft,
				id: "inactive",
				text: "Inactive latest",
				generation: 3,
				persistenceVersion: 4,
			},
		},
	};
	const result = dispatch(state, { type: "prepareDraftPersistence" }, deps);
	expect(result.effects).toMatchObject([
		{
			type: "persistDraft",
			action: "put",
			draft: { text: "Latest before close", generation: 1, persistenceVersion: 1 },
		},
		{
			type: "persistDraft",
			action: "put",
			draft: { id: "inactive", text: "Inactive latest", generation: 3, persistenceVersion: 4 },
		},
		{ type: "render" },
	]);
	expect(state.pendingDraftPersistence).toEqual({});
	expect(result.state.pendingDraftPersistence.inactive.requestId).not.toBeNull();
});
