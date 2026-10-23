// @vitest-environment node
import type { OperationResult } from "@praxity/grammar/src/operations/contract.ts";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { createSession, dispatch, selectionView } from "./index";
import type { Command, Dependencies, Effect, Focus, SelectionNode } from "./types";

const file = "lesson.prax";
const focus = (nodeId: string, role: Focus["role"] = "handle"): Focus => ({ file, nodeId, role });
const node = (
	id: string,
	parentId: string | null,
	pageId: string,
	kind: SelectionNode["kind"] = "block",
): SelectionNode => ({ id, parentId, pageId, kind, file, lessonId: "lesson" });
const tree = [
	node("p1", null, "p1", "page"),
	node("a", "p1", "p1"),
	node("columns", "p1", "p1"),
	node("left", "columns", "p1", "item"),
	node("inside", "left", "p1"),
	node("right", "columns", "p1", "item"),
	node("b", "p1", "p1"),
	node("c", "p1", "p1"),
	node("p2", null, "p2", "page"),
	node("d", "p2", "p2"),
	node("e", "p2", "p2"),
];
const speech = (effects: Effect[]) => effects.filter((e) => e.type === "announce");
function harness(language: "en" | "fr" = "en") {
	let state = createSession({ interfaceLanguage: language, revisions: { [file]: "r0" } });
	let nodes = [...tree];
	const translate = createTranslator({
		locale: language,
		messages: language === "en" ? en : fr,
		onError: (e) => {
			throw e;
		},
	});
	const deps: Dependencies = {
		now: 0,
		validateDraft: () => ({ diagnostics: [], escapes: false }),
		helperTokens: () => [],
		focusNeighbours: () => ({ next: focus("c"), page: focus("p1") }),
		nameOfFocus: (f) => `Paragraph: ${f.nodeId}`,
		translate: (m) => translate(m.key, m.params),
		readDraft: (f) => ({
			file: f.file,
			target: {
				kind: "node",
				nodeId: f.nodeId,
				path: [nodes.findIndex((n) => n.id === f.nodeId)],
				fingerprint: `fp-${f.nodeId}`,
			},
			baseRevision: "r0",
			expectedText: `${f.nodeId}\n`,
			editableText: `${f.nodeId}\n`,
		}),
		selectionNodes: () => nodes,
		reviewSuggestions: () => [
			{ id: "s1", nodeId: "a", focus: focus("a", "bubble") },
			{ id: "s2", nodeId: "inside", focus: focus("inside", "bubble") },
		],
	};
	const send = (command: Command) => {
		const result = dispatch(state, command, deps);
		state = result.state;
		// Model the successful native adapter before checking post-focus selection.
		const focus = result.effects.filter((effect) => effect.type === "focus").at(-1);
		if (focus?.type === "focus" && focus.requestId)
			state = dispatch(
				state,
				{ type: "focusResult", requestId: focus.requestId, success: true },
				deps,
			).state;
		return result.effects;
	};
	const select = (id: string, mode?: "range" | "toggle", role: Focus["role"] = "handle") =>
		send({ type: "select", focus: focus(id, role), mode });
	const key = (key: "previous" | "next" | "start" | "end" | "toggle" | "all" | "clear" | "level") =>
		send({ type: "selectionKey", key });
	const operation = (operation: string, args: Record<string, unknown> = {}) =>
		send({ type: "selectionOperation", operation, args });
	const reply = (operation: string, mapping: OperationResult["mapping"], target = "a") => {
		if (state.pending?.kind !== "operation") throw new Error("Expected pending operation");
		const beforeEpoch = state.epoch;
		const fromRevision =
			state.pending.request.files.find((base) => base.path === file)?.baseRevision ??
			state.revisions[file];
		const result: OperationResult & { historyId: string } = {
			ok: true,
			historyId: "service-entry",
			transactionId: state.pending.request.transactionId,
			files: [
				{
					path: file,
					fromRevision,
					toRevision: `r${Number(fromRevision.slice(1)) + 1}`,
					edits: [{ start: 0, end: 0, text: "x" }],
				},
			],
			intent: operation === "deleteBlocks" ? "delete" : "move",
			mapping,
			inverse: { files: [], mapping: [], guards: [] },
			summary: { key: `op.${operation}`, params: { count: state.pending.request.targets.length } },
			diagnostics: [],
			focus: focus(target),
		};
		// Every reply in this fixture is an own write; outside edits use outsideChange explicitly.
		const effects = send({ type: "operationReply", result });
		expect(state.epoch).toBe(beforeEpoch);
		expect(
			effects.filter((effect) => effect.type === "post" && effect.method === "draftResolve"),
		).toEqual([]);
		return effects;
	};
	return {
		send,
		select,
		key,
		operation,
		reply,
		deps,
		get state() {
			return state;
		},
		nodes: (next: SelectionNode[]) => {
			nodes = next;
		},
		text: (effects: Effect[]) =>
			speech(effects).map((e) => translate(e.message.key, e.message.params)),
		view: () => selectionView(state, deps),
	};
}

it("G1: homogeneous kinds, outline-only pages and ancestor normalization", () => {
	const h = harness();
	h.select("inside");
	h.select("a", "toggle");
	h.select("columns", "toggle");
	expect(h.state.selected).toEqual(["a", "columns"]);
	expect(h.text(h.select("inside", "toggle"))).toEqual([
		"Already selected as part of Paragraph: columns.",
	]);
	expect(h.state.selected).toEqual(["a", "columns"]);
	h.select("left", "toggle");
	expect(h.state.selected).toEqual(["left"]);
	h.select("right", "toggle");
	expect(h.state.selected).toEqual(["left", "right"]);
	h.select("p1");
	expect(h.state.selected).toEqual(["left", "right"]);
	h.select("p1", undefined, "outline");
	h.select("p2", "toggle", "outline");
	expect(h.state.selected).toEqual(["p1", "p2"]);
});
it("G2: focus follows singleton until extension, then Escape collapses to focused node", () => {
	const h = harness();
	h.select("a");
	h.send({ type: "focusChanged", focus: focus("b") });
	expect(h.state.selected).toEqual(["b"]);
	h.select("c", "toggle");
	h.send({ type: "focusChanged", focus: focus("d") });
	expect(h.state.selected).toEqual(["b", "c"]);
	expect(h.text(h.send({ type: "escape" }))).toEqual(["Selection cleared."]);
	expect(h.state.selected).toEqual(["d"]);
	h.send({ type: "focusChanged", focus: focus("e") });
	expect(h.state.selected).toEqual(["e"]);
});
it("G3: plain, range and toggle gestures share anchor and ordered selection", () => {
	const h = harness();
	h.select("c");
	h.select("a", "range");
	expect(h.state.selected).toEqual(["a", "columns", "b", "c"]);
	h.select("b", "toggle");
	expect(h.state.selection.anchor).toBe("b");
	expect(h.state.selected).toEqual(["a", "columns", "c"]);
	h.select("d");
	expect(h.state.selected).toEqual(["d"]);
	expect(h.state.selection.extended).toBe(false);
});
it("G4: range lifts endpoints to children of their lowest common parent", () => {
	const h = harness();
	h.select("inside");
	h.select("b", "range");
	expect(h.state.selected).toEqual(["columns", "b"]);
	h.select("a");
	h.select("d", "range");
	expect(h.state.selected).toEqual(["a", "columns", "b", "c", "d"]);
});
it("G5: keyboard range grows, shrinks and reaches sibling boundaries", () => {
	const h = harness();
	h.select("b");
	h.key("previous");
	expect(h.state.selected).toEqual(["columns", "b"]);
	h.key("next");
	expect(h.state.selected).toEqual(["b"]);
	expect(h.state.selection.extended).toBe(true);
	h.key("end");
	expect(h.state.selected).toEqual(["b", "c"]);
	h.key("start");
	expect(h.state.selected).toEqual(["a", "columns", "b"]);
});
it("G5: Mod+A selects siblings, then top-level blocks on the page", () => {
	const h = harness();
	h.select("inside");
	expect(h.text(h.key("all"))).toEqual(["1 block selected."]);
	expect(h.state.selected).toEqual(["inside"]);
	expect(h.text(h.key("all"))).toEqual(["4 blocks selected."]);
	expect(h.state.selected).toEqual(["a", "columns", "b", "c"]);
	h.key("all");
	expect(h.state.selected).toEqual(["a", "columns", "b", "c"]);
});
it.each(["handle", "outline"] as const)(
	"G5: Mod+A on an item selects its siblings in %s",
	(role) => {
		const h = harness();
		h.select("left", undefined, role);
		h.key("all");
		expect(h.state.selected).toEqual(["left", "right"]);
		h.key("all");
		expect(h.state.selected).toEqual(["a", "columns", "b", "c"]);
	},
);
it("G5: changing the focused node restarts Mod+A at its siblings", () => {
	const h = harness();
	h.select("left");
	h.key("all");
	h.send({ type: "focusChanged", focus: focus("inside") });
	h.key("all");
	expect(h.state.selected).toEqual(["inside"]);
});
it("F4: moving a pinned selection from another focused row keeps the tree context", () => {
	const h = harness();
	h.select("b", undefined, "outline");
	h.key("toggle");
	h.send({ type: "focusChanged", focus: focus("c", "outline") });
	h.operation("moveBlocks", { direction: "up" });
	const effects = h.reply("moveBlocks", [{ oldId: "b", newId: "b", fate: "kept" }], "b");
	expect(h.state.selected).toEqual(["b"]);
	expect(h.state.focus).toEqual(focus("b", "outline"));
	expect(effects).toContainEqual({
		type: "focus",
		target: focus("b", "outline"),
		expect: [focus("c", "outline")],
		requestId: expect.stringMatching(/^focus-/u),
	});
});
it("G5 G7: pin, toggle removal, level menu and clear announce exactly once", () => {
	const h = harness();
	h.select("a");
	expect(h.text(h.key("toggle"))).toEqual([
		"Paragraph: a selected. Move to other blocks and press Shift Space to add them.",
	]);
	h.send({ type: "focusChanged", focus: focus("c") });
	expect(h.text(h.key("toggle"))).toEqual(["2 blocks selected."]);
	expect(h.text(h.key("toggle"))).toEqual(["Removed from selection. 1 block selected."]);
	h.key("level");
	expect(h.state.selected).toEqual(["a", "columns", "b", "c"]);
	expect(h.text(h.key("clear"))).toEqual(["Selection cleared."]);
});
it("G6: selection view supplies handle descriptions, outline state, count and descendant review bubbles", () => {
	const h = harness();
	h.select("a");
	h.select("columns", "toggle");
	const view = h.view();
	expect(view.count).toBe(2);
	expect(view.members.a).toEqual({ selected: true, description: "Selected" });
	expect(view.members.b.selected).toBe(false);
	expect(view.suggestions.map((s) => s.id)).toEqual(["s1", "s2"]);
	expect(view.label).toBe("2 blocks selected.");
	expect(view.dragLabel).toBe("2 blocks");
});
it("G7: every selection announcement is polite, translated and excludes the new focus name", () => {
	const h = harness("fr");
	h.select("a");
	const effects = h.select("c", "range");
	expect(h.text(effects)).toEqual(["4 blocs sélectionnés."]);
	expect(speech(effects)).toHaveLength(1);
	expect(speech(effects)[0].level).toBe("polite");
	expect(h.text(effects)[0]).not.toContain("Paragraph: c");
});
it("G8: Move up across pages is refused with exactly one announcement and no request", () => {
	const h = harness();
	h.select("a");
	h.select("d", "toggle");
	expect(h.view().actions.moveUp.enabled).toBe(false);
	const effects = h.operation("moveBlocks", { direction: "up" });
	expect(effects.filter((e) => e.type === "post")).toHaveLength(0);
	expect(h.text(effects)).toEqual([
		"Can't move: move up and down need blocks on the same page. Use Move to.",
	]);
	expect(speech(effects)).toHaveLength(1);
	expect(speech(effects)[0].level).toBe("assertive");
});
it.each([
	["p1", "moveBlocks", "movePage"],
	["left", "moveBlocks", "moveItem"],
	["p1", "deleteBlocks", "deletePage"],
	["left", "deleteBlocks", "removeItem"],
])("F4 outline command for %s delegates %s to %s", (id, command, operation) => {
	const h = harness();
	h.select(id, undefined, "outline");
	const effects = h.operation(command, command === "moveBlocks" ? { direction: "down" } : {});
	const post = effects.find((e) => e.type === "post" && e.method === "operationApply");
	expect(post).toMatchObject({ type: "post", method: "operationApply", request: { operation } });
});
it("F4 item removal announces the removed node once", () => {
	const h = harness();
	h.select("left", undefined, "outline");
	h.operation("deleteBlocks");
	const effects = h.reply("removeItem", [{ oldId: "left", newId: null }], "right");
	expect(h.text(effects)).toEqual(["Deleted Paragraph: left. Undo with Control Z."]);
});
it("G8: nonadjacent moves are refused, Move to sends every guarded target once", () => {
	const h = harness();
	h.select("a");
	h.select("c", "toggle");
	expect(h.text(h.operation("moveBlocks", { direction: "down" }))).toEqual([
		"Can't move: move up and down need neighbouring blocks. Use Move to.",
	]);
	h.select("d", "toggle");
	h.operation("moveBlocks", { destination: "p2" });
	expect(h.state.pending?.kind).toBe("operation");
	if (h.state.pending?.kind !== "operation") return;
	expect(
		h.state.pending.request.targets.map((t) => [
			t.ref.kind === "node" && t.ref.nodeId,
			t.expectedText,
		]),
	).toEqual([
		["a", "a\n"],
		["c", "c\n"],
		["d", "d\n"],
	]);
	expect(h.state.pending.request.files).toEqual([{ path: file, baseRevision: "r0" }]);
});
it("G8: copy across pages uses saved text in document order and keeps selection", () => {
	const h = harness();
	h.select("d");
	h.select("a", "toggle");
	const effects = h.operation("copy");
	expect(effects.find((e) => e.type === "clipboard")).toMatchObject({ text: "a\n\nd\n" });
	expect(h.state.selected).toEqual(["a", "d"]);
	expect(h.text(effects)).toEqual(["Copied 2 blocks."]);
});
it("G8 G9: duplicate selects copies, undo restores selection and focused member, redo selects copies", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	h.operation("duplicateBlocks");
	h.nodes([...tree, node("a-copy", "p1", "p1"), node("b-copy", "p1", "p1")]);
	expect(
		h.text(
			h.reply(
				"duplicateBlocks",
				[
					{ oldId: "a", newId: "a-copy", fate: "copied" },
					{ oldId: "b", newId: "b-copy", fate: "copied" },
				],
				"b-copy",
			),
		),
	).toEqual(["Duplicated 2 blocks."]);
	expect(h.state.selected).toEqual(["a-copy", "b-copy"]);
	expect(h.state.history).toHaveLength(1);
	for (const direction of ["undo", "redo"] as const) {
		h.send({ type: direction, inTextField: false });
		const pending = h.state.pending;
		if (pending?.kind !== "history") throw new Error("Expected history");
		h.send({
			type: "historyReply",
			transactionId: pending.transactionId,
			result: {
				ok: true,
				historyId: "service-entry",
				transactionId: pending.transactionId,
				files: [],
				intent: "move",
				mapping: [],
				inverse: { files: [], mapping: [], guards: [] },
				summary: { key: "op.duplicateBlocks", params: { count: 2 } },
				diagnostics: [],
				focus: focus("unrelated"),
			},
		});
		expect(h.state.selected).toEqual(direction === "undo" ? ["a", "b"] : ["a-copy", "b-copy"]);
		expect(h.state.focus?.nodeId).toBe(direction === "undo" ? "b" : "b-copy");
	}
});
it("G9: a selection survives an unrelated operation and loses a deleted node", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	h.send({
		type: "operation",
		request: {
			transactionId: "outside-target",
			operation: "setText",
			files: [{ path: file, baseRevision: "r0" }],
			targets: [],
			args: {},
		},
	});
	h.reply("setText", [{ oldId: "c", newId: "c", fate: "kept" }], "c");
	expect(h.state.selected).toEqual(["a", "b"]);
	h.nodes(tree.filter((n) => n.id !== "b"));
	const effects = h.send({
		type: "outsideChange",
		file,
		revision: "r2",
		mapping: [{ oldId: "b", newId: null, fate: "retired" }],
	});
	expect(h.state.selected).toEqual(["a"]);
	expect(speech(effects)).toHaveLength(1);
});
it("G9: service refusal leaves every member and history untouched and names the refusing member", () => {
	const h = harness();
	h.select("a");
	h.select("d", "toggle");
	h.operation("deleteBlocks");
	const pending = h.state.pending;
	if (pending?.kind !== "operation") throw new Error("Expected operation");
	const effects = h.send({
		type: "operationReply",
		result: {
			ok: false,
			transactionId: pending.request.transactionId,
			code: "stale",
			member: "d",
			message: { key: "op.stale", params: {} },
		},
	});
	expect(h.state.selected).toEqual(["a", "d"]);
	expect(h.state.history).toEqual([]);
	expect(speech(effects)).toHaveLength(1);
	expect(h.text(effects)[0]).toContain("Paragraph: d");
});
it("G10: opening source collapses once; field selection commands do nothing; drafts block writes but not saved-text copy", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	expect(h.text(h.send({ type: "openSource", seed: h.deps.readDraft(focus("b")) }))).toEqual([
		"Selection cleared.",
	]);
	expect(h.state.selected).toEqual(["b"]);
	h.key("all");
	expect(h.state.selected).toEqual(["b"]);
	h.send({ type: "changeDraft", text: "draft", selection: [5, 5] });
	const effects = h.operation("deleteBlocks");
	expect(h.text(effects)).toEqual([
		"Can't delete: finish or discard the draft in Paragraph: b first.",
	]);
	expect(effects.filter((e) => e.type === "post")).toHaveLength(0);
	const copy = h.operation("copy");
	expect(copy.find((e) => e.type === "clipboard")).toMatchObject({ text: "b\n" });
	expect(h.text(copy)).toEqual(["Copied 1 block. The draft in Paragraph: b isn't included."]);
});
it("G10: modified pointer selection waits for draft commit and keeps edited node as anchor", () => {
	const h = harness();
	h.select("a");
	h.send({ type: "openSource", seed: h.deps.readDraft(focus("a")) });
	h.send({ type: "changeDraft", text: "saved", selection: [5, 5] });
	h.select("b", "range");
	expect(h.state.selected).toEqual(["a"]);
	const pending = h.state.pending;
	if (pending?.kind !== "commit") throw new Error("Expected commit");
	h.send({
		type: "operationReply",
		result: {
			ok: true,
			historyId: "service-entry",
			transactionId: pending.request.transactionId,
			files: [
				{
					path: file,
					fromRevision: "r0",
					toRevision: "r1",
					edits: [{ start: 0, end: 2, text: "saved\n" }],
				},
			],
			intent: "modify",
			mapping: [{ oldId: "a", newId: "a", fate: "kept" }],
			inverse: { files: [], mapping: [], guards: [] },
			summary: { key: "op.editSource", params: {} },
			diagnostics: [],
			focus: focus("a"),
		},
	});
	expect(h.state.selected).toEqual(["a", "columns", "b"]);
	expect(h.state.selection.anchor).toBe("a");
});
it("G11: review follows IDs, review focus and accept keep selection, delete closes descendant suggestions once", () => {
	const h = harness();
	h.select("a");
	h.select("columns", "toggle");
	h.send({ type: "reviewSelection" });
	expect(h.state.focus?.role).toBe("bubble");
	expect(h.state.selected).toEqual(["a", "columns"]);
	h.send({
		type: "operation",
		request: {
			transactionId: "accept",
			operation: "acceptSuggestion",
			targets: [],
			files: [],
			args: {},
		},
		focus: { kind: "review", next: focus("b", "bubble") },
	});
	h.reply("acceptSuggestion", [], "b");
	expect(h.state.selected).toEqual(["a", "columns"]);
	h.operation("moveBlocks", { destination: "p2" });
	h.reply("moveBlocks", [
		{ oldId: "a", newId: "a", fate: "kept" },
		{ oldId: "columns", newId: "columns", fate: "kept" },
	]);
	expect(h.view().suggestions.map((s) => s.id)).toEqual(["s1", "s2"]);
	h.operation("deleteBlocks");
	const effects = h.reply(
		"deleteBlocks",
		[
			{ oldId: "a", newId: null, fate: "retired" },
			{ oldId: "columns", newId: null, fate: "retired" },
		],
		"c",
	);
	expect(effects.find((e) => e.type === "reviewReplaced")).toMatchObject({
		suggestionIds: ["s1", "s2"],
	});
	expect(speech(effects)).toHaveLength(1);
	expect(h.text(effects)[0]).toContain("2 suggestions in them were closed.");
	expect(h.state.selected).toEqual(["c"]);
});
it("G8: directional move guards every controller entry point and menu dispatch keeps all guarded members", () => {
	const h = harness();
	h.select("a");
	h.select("d", "toggle");
	const request = {
		transactionId: "direct",
		operation: "moveBlocks",
		args: { direction: "up" },
		files: [{ path: file, baseRevision: "r0" }],
		targets: [{ file, ref: h.deps.readDraft(focus("a")).target, expectedText: "a\n" }],
	};
	expect(h.text(h.send({ type: "operation", request }))).toEqual([
		"Can't move: move up and down need blocks on the same page. Use Move to.",
	]);
	expect(h.state.pending).toBeNull();
	h.send({
		type: "openPopup",
		popup: "actions",
		opener: focus("d"),
		target: {
			target: { file, ref: h.deps.readDraft(focus("d")).target, expectedText: "d\n" },
			revision: "r0",
			draftId: null,
		},
	});
	h.send({ type: "menuOperation", operation: "deleteBlocks", args: {} });
	if (h.state.pending?.kind !== "operation") throw new Error("Expected menu operation");
	expect(h.state.pending.request.targets.map((t) => t.ref.kind === "node" && t.ref.nodeId)).toEqual(
		["a", "d"],
	);
});
it("G8: Move to includes one guarded insertion destination after all selected members", () => {
	const h = harness();
	h.select("a");
	h.select("d", "toggle");
	const destination = {
		file,
		ref: { kind: "insertion" as const, parentId: "p2", before: "e", after: "d" },
	};
	h.send({
		type: "selectionOperation",
		operation: "moveBlocks",
		args: {},
		destination: { target: destination, baseRevision: "r0" },
	});
	if (h.state.pending?.kind !== "operation") throw new Error("Expected move");
	expect(h.state.pending.request.targets.at(-1)).toEqual(destination);
	expect(h.state.pending.request.targets).toHaveLength(3);
});
it("G8: wrapping requires adjacent siblings; grammar eligibility refuses all members together", () => {
	const h = harness();
	h.select("a");
	h.select("d", "toggle");
	expect(h.view().actions.wrapIn.enabled).toBe(false);
	expect(h.view().actions.wrapInColumns.enabled).toBe(false);
	expect(h.operation("wrapInColumns").some((e) => e.type === "post")).toBe(false);
	h.select("a");
	h.select("columns", "toggle");
	h.deps.selectionAllowed = () => ({ key: "op.not-allowed", params: {} });
	expect(h.operation("turnInto", { type: "quote" }).some((e) => e.type === "post")).toBe(false);
});
it("G9: operation mappings remap surviving IDs, preserve pending IDs and prune retired nodes", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	h.operation("turnInto", { type: "quote" });
	h.nodes(tree.map((n) => (n.id === "a" ? { ...n, id: "new-a" } : n)));
	h.reply(
		"turnInto",
		[
			{ oldId: "a", newId: "new-a", fate: "survivor" },
			{ oldId: "b", newId: "b", fate: "pending" },
		],
		"b",
	);
	expect(h.state.selected).toEqual(["new-a", "b"]);
});
it("G9: outside focus removal keeps remaining selection and restores focus once", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	h.nodes(tree.filter((n) => n.id !== "b"));
	const effects = h.send({
		type: "outsideChange",
		file,
		revision: "r1",
		mapping: [{ oldId: "b", newId: null, fate: "retired" }],
	});
	expect(h.state.selected).toEqual(["a"]);
	expect(h.state.focus?.nodeId).toBe("c");
	expect(effects.filter((e) => e.type === "focus")).toHaveLength(1);
	expect(speech(effects)).toHaveLength(1);
});
it("G10: draft commit refusal prevents deferred modified selection", () => {
	const h = harness();
	h.select("a");
	h.send({ type: "openSource", seed: h.deps.readDraft(focus("a")) });
	h.send({ type: "changeDraft", text: "draft", selection: [5, 5] });
	h.select("b", "range");
	const pending = h.state.pending;
	if (pending?.kind !== "commit") throw new Error("Expected commit");
	const effects = h.send({
		type: "operationReply",
		result: {
			ok: false,
			transactionId: pending.request.transactionId,
			code: "conflict",
			message: { key: "op.conflict", params: {} },
		},
	});
	expect(h.state.selected).toEqual(["a"]);
	expect(h.state.focus?.nodeId).toBe("a");
	expect(speech(effects)).toHaveLength(1);
});
it("G8: move and Turn into keep the focused member; duplicate focuses its copy even if service focus names the first member", () => {
	for (const operation of ["moveBlocks", "turnInto", "duplicateBlocks", "wrapInColumns"]) {
		const h = harness();
		h.select("b");
		h.select("c", "toggle");
		h.operation(operation, operation === "moveBlocks" ? { direction: "up" } : {});
		if (operation === "duplicateBlocks")
			h.nodes([...tree, node("b-copy", "p1", "p1"), node("c-copy", "p1", "p1")]);
		h.reply(
			operation,
			["b", "c"].map((id) => ({
				oldId: id,
				newId: operation === "duplicateBlocks" ? `${id}-copy` : id,
				fate: operation === "duplicateBlocks" ? "copied" : "kept",
			})),
			operation === "duplicateBlocks" ? "b-copy" : "b",
		);
		expect(h.state.focus?.nodeId).toBe(operation === "duplicateBlocks" ? "c-copy" : "c");
		expect(h.state.selected).toEqual(
			operation === "wrapInColumns"
				? ["c"]
				: operation === "duplicateBlocks"
					? ["b-copy", "c-copy"]
					: ["b", "c"],
		);
	}
});
it("G7: a plain content pointer clears a multi-selection with one announcement", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	expect(
		h.text(h.send({ type: "pointer", insideGroup: false, insideLayer: false, focus: focus("c") })),
	).toEqual(["Selection cleared."]);
	expect(h.state.selected).toEqual(["c"]);
});
it("G7 A8: item and page selection counts use their own nouns in both catalogs", () => {
	for (const [language, items, pages] of [
		["en", "2 items selected.", "2 pages selected."],
		["fr", "2 éléments sélectionnés.", "2 pages sélectionnées."],
	] as const) {
		const h = harness(language);
		h.select("left");
		expect(h.text(h.select("right", "toggle"))).toEqual([items]);
		h.select("p1", undefined, "outline");
		expect(h.text(h.select("p2", "toggle", "outline"))).toEqual([pages]);
	}
});
it("G9: deleting an unrelated node preserves selection, deleting one selected node prunes only that ID", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	const request = (transactionId: string) => ({
		transactionId,
		operation: "deleteBlocks",
		args: {},
		files: [],
		targets: [{ file, ref: h.deps.readDraft(focus("c")).target, expectedText: "c\n" }],
	});
	h.send({ type: "operation", request: request("delete-c") });
	h.reply("deleteBlocks", [{ oldId: "c", newId: null, fate: "retired" }], "e");
	expect(h.state.selected).toEqual(["a", "b"]);
	h.send({ type: "operation", request: request("delete-b") });
	h.nodes(tree.filter((n) => n.id !== "b"));
	h.reply("deleteBlocks", [{ oldId: "b", newId: null, fate: "retired" }], "e");
	expect(h.state.selected).toEqual(["a"]);
});
it("G8 A2: direction and Move to choose the matching result template", () => {
	const h = harness();
	h.select("b");
	h.select("c", "toggle");
	h.operation("moveBlocks", { direction: "down" });
	expect(
		h.text(
			h.reply(
				"moveBlocks",
				[
					{ oldId: "b", newId: "b", fate: "kept" },
					{ oldId: "c", newId: "c", fate: "kept" },
				],
				"b",
			),
		)[0],
	).toMatch(/^Moved 2 blocks down\./u);
	h.send({
		type: "selectionOperation",
		operation: "moveBlocks",
		args: {},
		destination: {
			target: { file, ref: { kind: "insertion", parentId: "p2", before: "e", after: "d" } },
			baseRevision: "r1",
		},
		context: { parent: "Page Two", first: 2, last: 3, total: 5 },
	});
	expect(
		h.text(
			h.reply(
				"moveBlocks",
				[
					{ oldId: "b", newId: "b", fate: "kept" },
					{ oldId: "c", newId: "c", fate: "kept" },
				],
				"b",
			),
		),
	).toEqual(["Moved 2 blocks to Page Two. 2 to 3 of 5."]);
});
it("G10: helpers and item actions collapse a multi-selection to the focused node", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	expect(
		h.text(
			h.send({
				type: "openPopup",
				popup: "helper",
				opener: focus("b"),
				target: {
					target: { file, ref: h.deps.readDraft(focus("b")).target, expectedText: "b\n" },
					revision: "r0",
					draftId: null,
				},
			}),
		),
	).toEqual(["Selection cleared."]);
	expect(h.state.selected).toEqual(["b"]);
	h.send({ type: "escape" });
	h.select("left");
	h.select("right", "toggle");
	h.send({
		type: "openPopup",
		popup: "actions",
		opener: focus("right"),
		target: {
			target: { file, ref: h.deps.readDraft(focus("right")).target, expectedText: "right\n" },
			revision: "r0",
			draftId: null,
		},
	});
	h.send({ type: "menuOperation", operation: "addItem", args: {} });
	expect(h.state.selected).toEqual(["right"]);
});
it("G9: a multi-selection menu keeps original guards through outside changes and submenus", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	const original = h.deps.readDraft(focus("b"));
	h.send({
		type: "openPopup",
		popup: "actions",
		opener: focus("b"),
		target: {
			target: { file, ref: original.target, expectedText: original.expectedText },
			revision: "r0",
			draftId: null,
		},
	});
	const read = h.deps.readDraft;
	h.deps.readDraft = (f) => ({
		...read(f),
		expectedText: `outside-${f.nodeId}\n`,
		baseRevision: "r2",
	});
	h.send({ type: "outsideChange", file, revision: "r2" });
	h.send({
		type: "openPopup",
		popup: "submenu",
		opener: focus("b"),
		target: {
			target: { file, ref: original.target, expectedText: "outside-b\n" },
			revision: "r2",
			draftId: null,
		},
	});
	h.send({ type: "menuOperation", operation: "deleteBlocks", args: {} });
	if (h.state.pending?.kind !== "operation") throw new Error("Expected delete");
	expect(h.state.pending.request.files).toEqual([{ path: file, baseRevision: "r0" }]);
	expect(h.state.pending.request.targets.map((t) => t.expectedText)).toEqual(["a\n", "b\n"]);
});
it("G9: direct operation expansion keeps its transaction ID and provided target guards", () => {
	const h = harness();
	h.select("a");
	h.select("b", "toggle");
	h.send({
		type: "operation",
		request: {
			transactionId: "caller-tx",
			operation: "deleteBlocks",
			args: {},
			files: [{ path: file, baseRevision: "old-revision" }],
			targets: [{ file, ref: h.deps.readDraft(focus("a")).target, expectedText: "original-a\n" }],
		},
	});
	if (h.state.pending?.kind !== "operation") throw new Error("Expected delete");
	expect(h.state.pending.request.transactionId).toBe("caller-tx");
	expect(h.state.pending.request.files[0].baseRevision).toBe("old-revision");
	expect(h.state.pending.request.targets[0].expectedText).toBe("original-a\n");
});

it.each([
	["p1", "next", "a"],
	["p1", "end", "c"],
	["c", "start", "p1"],
	["a", "previous", "p1"],
	["columns", "next", "left"],
	["inside", "next", "right"],
	["c", "next", "c"],
	["p1", "previous", "p1"],
	["p2", "end", "e"],
] as const)("F1 plain %s %s traverses handles on the current page to %s", (from, key, to) => {
	const h = harness();
	h.select("a");
	h.select("c", "toggle");
	h.send({ type: "focusChanged", focus: focus(from) });
	const effects = h.send({ type: "selectionKey", key, extend: false });
	expect(h.state.focus).toEqual(focus(to));
	expect(h.state.selected).toEqual(["a", "c"]);
	expect(effects.filter((effect) => effect.type === "post")).toEqual([]);
});
