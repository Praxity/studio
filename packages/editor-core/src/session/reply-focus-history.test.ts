// @vitest-environment node
import { expect, it } from "vitest";
import { createSession, dispatch } from "./index";
import type { Command, Dependencies, Effect, Focus } from "./types";

it.each(["blank", "last"] as const)(
	"F8 G9 redo after declined deletion focus targets the survivor: %s",
	(departure) => {
		const note: Focus = { file: "a.prax", nodeId: "note", role: "handle" };
		const after: Focus = { ...note, nodeId: "after" };
		let removed = false;
		const deps: Dependencies = {
			now: 0,
			validateDraft: () => ({ diagnostics: [], escapes: false }),
			helperTokens: () => [],
			focusNeighbours: () => ({ next: after, page: after }),
			nameOfFocus: () => "Note",
			readDraft: (focus) => ({
				file: "a.prax",
				baseRevision: "r0",
				expectedText: "Note\n",
				editableText: "Note\n",
				target: { kind: "node", nodeId: focus.nodeId ?? "note", path: [0, 0], fingerprint: "fp" },
			}),
			selectionNodes: () => [
				{
					id: "page",
					file: "a.prax",
					lessonId: "lesson",
					pageId: "page",
					parentId: null,
					kind: "page",
				},
				...["note", "after", "last"]
					.filter((id) => !removed || id !== "note")
					.map((id) => ({
						id,
						file: "a.prax",
						lessonId: "lesson",
						pageId: "page",
						parentId: "page",
						kind: "block" as const,
					})),
			],
			translate: (m) => m.key,
		};
		let state = createSession();
		const send = (command: Command) => {
			const result = dispatch(state, command, deps);
			state = result.state;
			return result.effects;
		};
		const ack = (effects: Effect[], success: boolean) => {
			const focus = effects.find((e) => e.type === "focus");
			if (focus?.type === "focus" && "requestId" in focus && focus.requestId)
				send({ type: "focusResult", requestId: focus.requestId, success } as Command);
		};
		const reply = (undo = false) => {
			const p = state.pending;
			if (!p) throw new Error("Expected pending request");
			const transactionId = p.kind === "history" ? p.transactionId : p.request.transactionId;
			const result = {
				ok: true as const,
				transactionId,
				historyId: "history",
				files: [
					{
						path: "a.prax",
						fromRevision: undo ? "r1" : "r0",
						toRevision: undo ? "r0" : "r1",
						edits: [{ start: 0, end: 0, text: "Changed" }],
					},
				],
				intent: undo ? ("modify" as const) : ("delete" as const),
				mapping: undo ? [] : [{ oldId: "note", newId: null, fate: "deleted" as const }],
				inverse: { files: [], guards: [], mapping: [] },
				summary: { key: "saved", params: {} },
				diagnostics: [],
				focus: undo ? note : after,
			};
			return send(
				p.kind === "history"
					? { type: "historyReply", transactionId, result }
					: { type: "operationReply", result },
			);
		};
		send({ type: "select", focus: note });
		send({ type: "selectionOperation", operation: "deleteBlocks", args: {} });
		if (departure === "last") send({ type: "focusChanged", focus: { ...note, nodeId: "last" } });
		removed = true;
		const deletion = reply();
		// Native blank-page input cancels F8. No focusChanged comes from BODY.
		ack(deletion, false);
		// The author focuses After, then explicitly undoes and redoes the deletion.
		send({ type: "select", focus: after });
		send({ type: "undo", inTextField: false });
		removed = false;
		ack(reply(true), true);
		expect(state.selected).toEqual(["note"]);
		send({ type: "redo", inTextField: false });
		removed = true;
		const redone = reply();
		const focus = redone.find((e) => e.type === "focus");
		expect(focus).toMatchObject({ type: "focus", target: after });
	},
);
