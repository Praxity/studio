import { expect, it, vi } from "vitest";
import { createSession, dispatch } from "../session";
import type { AuthorOperationResult, Command, Dependencies, Effect, Focus } from "../session/types";
import { type FrameEventBody, type FrameFocus, type FrameView, mountPageLens } from "./index";

// Port of the adopted focus-model's frame-side cases. The oracle is each journey's
// literal Delete target, not the delivery matcher. Both port directions stay FIFO.
type Move = "after" | "note" | "note handle" | "blank" | "host";
type Action =
	| "D13"
	| "Escape"
	| "Mod+Enter"
	| "G10"
	| "delete"
	| "empty"
	| "history"
	| "stay"
	| "refused"
	| "open"
	| "refused range"
	| "retained leave"
	| "Tab";
type Step = "reply" | "render" | "focus" | "report" | "result" | Move;
const journeys: {
	action: Action;
	moves: Move[];
	deletes: string | null;
	start?: "body" | "host";
}[] = [];
for (const action of ["D13", "Escape", "Mod+Enter", "G10", "history"] as const) {
	for (const [moves, deletes] of [
		[[], action === "G10" ? "note+after" : "note"],
		[["after"], "after"],
		[["host"], null],
		[["blank"], null],
		[["after", "note"], "note"],
	] as [Move[], string | null][])
		journeys.push({ action, moves, deletes });
	for (const start of ["body", "host"] as const) {
		journeys.push({ action: "history", start, moves: [], deletes: null });
		journeys.push({ action: "history", start, moves: ["after"], deletes: "after" });
	}
}

// F8/G9: cancelling native delivery cannot change the survivor recorded for Redo.
// Exercise an old acknowledgement before, during and after the next delivery.
for (const departure of ["blank", "host", "after"] as const)
	for (const staleAt of [
		"undo pending",
		"undo reply",
		"undo confirmed",
		"redo pending",
		"redo reply",
	] as const)
		it(`F8 G9 history model ${departure}, stale acknowledgement at ${staleAt}`, () => {
			let lens: ReturnType<typeof mountPageLens> | undefined;
			try {
				window.history.replaceState(null, "", "?praxity-inspect=1");
				vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
					new DOMRect(100, 100, 400, 100),
				);
				let inFrame = true;
				vi.spyOn(document, "hasFocus").mockImplementation(() => inFrame);
				document.body.innerHTML =
					'<h1 class="praxity-page-title">Page</h1><p data-node-id="note">Text</p><p data-node-id="after">After</p><button id="blank">Blank</button>';
				let state = createSession();
				let removed = false;
				const send = (command: Command) => {
					const result = dispatch(state, command, {
						now: 0,
						validateDraft: () => ({ diagnostics: [], escapes: false }),
						helperTokens: () => [],
						focusNeighbours: () => ({ next: after, page: after }),
						nameOfFocus: () => "Note",
						readDraft: (focus) => ({
							...seed,
							target: { ...seed.target, nodeId: focus.nodeId ?? "note" },
						}),
						selectionNodes: () => [
							{
								id: "page",
								file,
								lessonId: "lesson",
								pageId: "page",
								parentId: null,
								kind: "page",
							},
							...["note", "after"]
								.filter((id) => !removed || id !== "note")
								.map((id) => ({
									id,
									file,
									lessonId: "lesson",
									pageId: "page",
									parentId: "page",
									kind: "block" as const,
								})),
						],
						translate: (m) => m.key,
					});
					state = result.state;
					return result.effects;
				};
				const view = (): FrameView => ({
					file,
					pageId: "page",
					language: "en",
					alwaysShowHandles: true,
					nodes: ["page", ...(removed ? [] : ["note"]), "after"].map((id) => ({
						id,
						kind: id === "page" ? "page" : "block",
						parentId: id === "page" ? null : "page",
						name: id,
						description: id,
					})),
					selected: [],
					expanded: [],
					focus: null,
				});
				lens = mountPageLens({ document, view: view(), onEvent: () => {} });
				const reply = (undo = false) => {
					const pending = state.pending;
					if (!pending) throw new Error("Expected history request");
					removed = !undo;
					if (undo) {
						const node = document.createElement("p");
						node.setAttribute("data-node-id", "note");
						node.textContent = "Text";
						document.body.append(node);
					}
					const transactionId =
						pending.kind === "history" ? pending.transactionId : pending.request.transactionId;
					const result: Extract<AuthorOperationResult, { ok: true }> = {
						ok: true,
						transactionId,
						historyId: "history",
						files: [
							{
								path: file,
								fromRevision: undo ? "r1" : "r0",
								toRevision: undo ? "r0" : "r1",
								edits: [{ start: 0, end: 0, text: "Changed" }],
							},
						],
						intent: undo ? "modify" : "delete",
						mapping: undo ? [] : [{ oldId: "note", newId: null, fate: "deleted" }],
						inverse: { files: [], guards: [], mapping: [] },
						summary: { key: "saved", params: {} },
						diagnostics: [],
						focus: undo ? note : after,
					};
					const effects = send(
						pending.kind === "history"
							? { type: "historyReply", transactionId, result }
							: { type: "operationReply", result },
					);
					lens?.render(view());
					const effect = effects.find((effect) => effect.type === "focus");
					if (!effect?.requestId) throw new Error("Expected focus delivery");
					return effect;
				};
				const deliver = (effect: Extract<Effect, { type: "focus" }>) => {
					const success =
						lens?.focus(effect.target as FrameFocus, {
							expect: effect.expect?.flatMap((owner) =>
								owner.nodeId ? [{ file: owner.file, nodeId: owner.nodeId }] : [],
							),
						}) ?? false;
					if (!effect.requestId) throw new Error("Expected focus request id");
					send({ type: "focusResult", requestId: effect.requestId, success });
					return success;
				};
				send({ type: "select", focus: note });
				lens.focus(note as FrameFocus);
				send({ type: "selectionOperation", operation: "deleteBlocks", args: {} });
				if (departure === "host") inFrame = false;
				else if (departure === "after") {
					lens.focus(after as FrameFocus);
					send({ type: "focusChanged", focus: after });
				} else {
					document.getElementById("blank")?.focus();
					document.getElementById("blank")?.blur();
				}
				const deletion = reply();
				expect(deliver(deletion)).toBe(false);
				inFrame = true;
				lens.focus(after as FrameFocus);
				send({ type: "select", focus: after });
				const stale = (phase: typeof staleAt) => {
					if (phase !== staleAt || !deletion.requestId) return;
					const before = structuredClone({
						focus: state.focus,
						selected: state.selected,
						selection: state.selection,
						replyFocus: state.replyFocus,
					});
					send({ type: "focusResult", requestId: deletion.requestId, success: true });
					expect({
						focus: state.focus,
						selected: state.selected,
						selection: state.selection,
						replyFocus: state.replyFocus,
					}).toEqual(before);
				};
				send({ type: "undo", inTextField: false });
				stale("undo pending");
				const undone = reply(true);
				stale("undo reply");
				expect(deliver(undone)).toBe(true);
				expect(state.selected).toEqual(["note"]);
				stale("undo confirmed");
				send({ type: "redo", inTextField: false });
				stale("redo pending");
				const redone = reply();
				stale("redo reply");
				expect(deliver(redone)).toBe(true);
				expect(redone.target).toEqual(after);
				expect(state.selected).toEqual(["after"]);
			} finally {
				lens?.dispose();
				document.body.innerHTML = "";
				vi.restoreAllMocks();
			}
		});
for (const action of ["delete", "empty"] as const)
	for (const [moves, deletes] of [
		[[], "after"],
		[["blank"], null],
		[["host"], null],
		[["after", "note"], "after"],
	] as [Move[], string | null][])
		journeys.push({ action, moves, deletes });

for (const action of ["stay", "refused", "open", "refused range", "retained leave"] as const)
	for (const moves of [[], ["after"], ["host"], ["blank"], ["after", "note"]] as Move[][])
		journeys.push({ action, moves, deletes: null });

// Returning to the original admitted handle can accept the new field's reply.
for (const moves of [["note handle"], ["after", "note handle"]] as Move[][])
	journeys.push({ action: "open", moves, deletes: null });

// 09e reports native Tab focus before its select event commits the dirty field.
for (const [moves, deletes] of [
	[[], "after"],
	[["after"], "after"],
	[["host"], null],
	[["blank"], null],
	[["note handle"], "note"],
	[["after", "note handle"], "note"],
] as [Move[], string | null][])
	journeys.push({ action: "Tab", moves, deletes });

function histories(moves: Move[]): Step[][] {
	const found: Step[][] = [];
	function visit(trace: Step[], replied: boolean, author: number, toFrame: Step[], toHost: Step[]) {
		if (replied && author === moves.length && !toFrame.length && !toHost.length) {
			found.push(trace);
			return;
		}
		if (!replied) visit([...trace, "reply"], true, author, ["render", "focus"], toHost);
		if (author < moves.length)
			visit([...trace, moves[author]], replied, author + 1, toFrame, [...toHost, "report"]);
		if (toFrame.length) {
			const [next, ...rest] = toFrame;
			visit(
				[...trace, next],
				replied,
				author,
				rest,
				next === "focus" ? [...toHost, "report", "result"] : toHost,
			);
		}
		if (toHost.length) visit([...trace, toHost[0]], replied, author, toFrame, toHost.slice(1));
	}
	visit([], false, 0, [], []);
	return found;
}
const file = "a.prax";
const note: Focus = { file, nodeId: "note", role: "handle" };
const after: Focus = { ...note, nodeId: "after" };
const seed = {
	file,
	baseRevision: "r0",
	expectedText: "Text\n",
	editableText: "Text\n",
	target: { kind: "node" as const, nodeId: "note", path: [0, 0], fingerprint: "fp" },
};

for (const journey of journeys) {
	const traces = histories(journey.moves);
	it.each(traces.map((trace) => [trace.join(" > "), trace] as const))(
		`F8 D13 G10 model ${journey.action} ${journey.start ?? "control"} ${journey.moves.join("/") || "no move"}: %s${journey.start ? ` [journey ${journeys.indexOf(journey)}]` : ""}`,
		(_label, trace) => {
			let lens: ReturnType<typeof mountPageLens> | undefined;
			try {
				window.history.replaceState(null, "", "?praxity-inspect=1");
				vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
					new DOMRect(100, 100, 400, 100),
				);
				let inFrame = journey.start !== "host";
				vi.spyOn(document, "hasFocus").mockImplementation(() => inFrame);
				document.body.innerHTML =
					'<h1 class="praxity-page-title">Page</h1><p data-node-id="note">Text</p><p data-node-id="after">After</p><button id="blank">Blank</button>';
				let state = createSession();
				let removed = false;
				const nodes = () => [
					{
						id: "page",
						file,
						lessonId: "lesson",
						pageId: "page",
						parentId: null,
						kind: "page" as const,
					},
					..."note after"
						.split(" ")
						.filter((id) => !removed || id !== "note")
						.map((id) => ({
							id,
							file,
							lessonId: "lesson",
							pageId: "page",
							parentId: "page",
							kind: "block" as const,
						})),
				];
				const deps: Dependencies = {
					now: 0,
					validateDraft: () => ({ diagnostics: [], escapes: false }),
					helperTokens: () => [],
					focusNeighbours: () => ({ next: after, page: { ...note, nodeId: "page" } }),
					nameOfFocus: () => "Note",
					readDraft: () => seed,
					selectionNodes: nodes,
					translate: (m) => m.key,
				};
				const send = (command: Command) => {
					const result = dispatch(state, command, deps);
					state = result.state;
					return result.effects;
				};
				const reports: (FrameEventBody | null)[] = [];
				const view = (): FrameView => ({
					file,
					pageId: "page",
					language: "en",
					alwaysShowHandles: true,
					nodes: nodes().map((node) => ({
						id: node.id,
						kind: node.kind,
						parentId: node.parentId,
						name: node.id,
						description: node.id,
					})),
					selected: state.selected.filter((id) => nodes().some((node) => node.id === id)),
					expanded: [],
					focus:
						state.focus && nodes().some((node) => node.id === state.focus?.nodeId)
							? (state.focus as FrameFocus)
							: null,
					...(state.activeDraft
						? {
								source: {
									nodeId: journey.action === "open" && !state.pending ? "after" : "note",
									draftId: state.activeDraft,
									value: "Text",
									name: "Source",
									caption: "Source",
									closer: false,
								},
							}
						: {}),
				});
				if (!journey.start) send({ type: "select", focus: note });
				if (
					[
						"Escape",
						"Mod+Enter",
						"G10",
						"empty",
						"stay",
						"refused",
						"open",
						"refused range",
						"retained leave",
						"Tab",
					].includes(journey.action)
				) {
					send({ type: "openSource", seed });
					send({
						type: "changeDraft",
						text: journey.action === "empty" ? "" : "Changed",
						selection: [0, 0],
					});
				}
				lens = mountPageLens({
					document,
					view: view(),
					onEvent: (event) => {
						if (event.event === "focusChanged") reports.push(event);
					},
				});
				if (state.focus) lens.focus(state.focus as FrameFocus);
				reports.length = 0;
				if (journey.action === "D13")
					send({ type: "implicitEdit", seed, text: "Changed", opener: note });
				else if (journey.action === "delete")
					send({ type: "selectionOperation", operation: "deleteBlocks", args: {} });
				else if (journey.action === "Tab") {
					lens.focus(after as FrameFocus);
					for (const report of reports.splice(0))
						if (report?.event === "focusChanged")
							send({ type: "focusChanged", focus: report.focus });
					send({ type: "select", focus: after });
					expect(state.selected).toEqual(["after"]);
				} else if (journey.action === "retained leave") {
					send({ type: "escape" });
					send({ type: "changeDraft", text: "Newer", selection: [5, 5] });
				} else if (journey.action === "G10" || journey.action === "refused range")
					send({ type: "select", focus: after, mode: "range" });
				else if (journey.action === "open")
					send({
						type: "openSource",
						seed: { ...seed, target: { ...seed.target, nodeId: "after" } },
					});
				else if (journey.action === "stay" || journey.action === "refused")
					send({ type: "commit", trigger: "save" });
				else if (journey.action === "history") {
					state.history = [
						{
							id: "entry",
							kind: "operation",
							operations: [],
							historyIds: ["history"],
							epoch: 0,
							focus: note,
							summary: { key: "saved", params: {} },
						},
					];
					state.cursor = 1;
					send({ type: "undo", inTextField: false });
				} else
					send(
						journey.action === "Mod+Enter"
							? { type: "commit", trigger: "enter" }
							: { type: "escape" },
					);
				let focusEffect: Extract<Effect, { type: "focus" }> | undefined;
				let applied = false;
				for (const step of trace) {
					if (step === "reply") {
						const pending = state.pending;
						if (!pending) throw new Error("Missing request");
						removed = journey.action === "delete" || journey.action === "empty";
						const result: Extract<AuthorOperationResult, { ok: true }> = {
							ok: true,
							transactionId:
								pending.kind === "history" ? pending.transactionId : pending.request.transactionId,
							historyId: "history",
							files: [
								{
									path: file,
									fromRevision: "r0",
									toRevision: "r1",
									edits: [{ start: 0, end: 0, text: "Changed" }],
								},
							],
							intent: removed ? "delete" : "modify",
							mapping: removed ? [{ oldId: "note", newId: null, fate: "deleted" }] : [],
							inverse: { files: [], guards: [], mapping: [] },
							summary: { key: "saved", params: {} },
							diagnostics: [],
							focus: removed ? after : note,
						};
						const effects = send(
							pending.kind === "history"
								? { type: "historyReply", transactionId: pending.transactionId, result }
								: {
										type: "operationReply",
										result: journey.action.startsWith("refused")
											? {
													ok: false,
													transactionId: result.transactionId,
													code: "invalid",
													message: { key: "op.invalid", params: {} },
												}
											: result,
									},
						);
						focusEffect = effects.find((effect) => effect.type === "focus");
						if (journey.action === "Tab") expect(focusEffect?.expect).toEqual([after]);
						if (
							[
								"Escape",
								"Mod+Enter",
								"G10",
								"empty",
								"stay",
								"open",
								"retained leave",
								"Tab",
							].includes(journey.action)
						) {
							expect(state.history[0].selectionBefore?.selected).toEqual(["note"]);
							expect(state.history[0].selectionBefore?.focus).toEqual(note);
						}
					} else if (step === "render") lens.render(view());
					else if (step === "focus") {
						const before = reports.length;
						if (focusEffect)
							applied = lens.focus(focusEffect.target as FrameFocus, {
								expect: focusEffect.expect?.flatMap((owner) =>
									owner.nodeId ? [{ file: owner.file, nodeId: owner.nodeId }] : [],
								),
							});
						// Native control focus also acquires its browsing context in the real iframe.
						if (applied) inFrame = true;
						if (reports.length === before) reports.push(null);
					} else if (step === "report") {
						const report = reports.shift();
						if (report?.event === "focusChanged")
							send({ type: "focusChanged", focus: report.focus });
					} else if (step === "result") {
						if (focusEffect?.requestId)
							send({ type: "focusResult", requestId: focusEffect.requestId, success: applied });
					} else {
						const before = reports.length;
						if (step === "host") inFrame = false;
						else {
							inFrame = true;
							if (step === "blank") {
								const blank = document.getElementById("blank");
								blank?.focus();
								blank?.blur();
							} else {
								const source = [...document.querySelectorAll("div")].flatMap((element) => [
									...(element.shadowRoot?.querySelectorAll("textarea") ?? []),
								])[0];
								const control =
									(step === "note" && source) ||
									[...document.querySelectorAll<HTMLButtonElement>('button[tabindex="0"]')].find(
										(button) =>
											button.getAttribute("aria-label") ===
											(step === "note handle" ? "note" : step),
									);
								control?.focus();
							}
						}
						if (reports.length === before) reports.push(null);
					}
					if (["stay", "open", "retained leave"].includes(journey.action) && state.history.length) {
						expect(state.history[0].selectionAfter?.focus).toEqual(
							journey.action === "open" ? after : note,
						);
					}
					if (
						["stay", "refused", "open"].includes(journey.action) &&
						state.pending?.kind === "commit"
					) {
						expect(state.selected).toEqual(["note"]);
						expect(state.layers.at(-1)).toEqual({ kind: "source", draftId: state.activeDraft });
					}
				}
				if (
					["stay", "refused", "open", "refused range", "retained leave"].includes(journey.action)
				) {
					// F8 stay and M8 open retain a field. Returning cannot expose another node to Delete.
					const owner = journey.action === "open" ? after : note;
					lens.render(view());
					lens.focus({ ...owner, role: "source" });
					lens.focus(owner as FrameFocus);
					for (const report of reports.splice(0))
						if (report?.event === "focusChanged")
							send({ type: "focusChanged", focus: report.focus });
					expect(state.selected).toEqual([owner.nodeId]);
					expect(state.layers.at(-1)).toEqual({ kind: "source", draftId: state.activeDraft });
					expect(
						send({ type: "selectionOperation", operation: "deleteBlocks", args: {} }).filter(
							(effect) => effect.type === "post",
						),
					).toEqual([]);
					return;
				}
				const native = document.activeElement;
				const isHandle =
					native instanceof HTMLButtonElement &&
					["note", "after", "page"].includes(native.getAttribute("aria-label") ?? "");
				const deletes = inFrame && isHandle ? state.selected.join("+") : null;
				// G2 pins an accepted range even when a later Tab-like focus move follows it.
				let expected = journey.deletes;
				if (journey.action === "G10" && journey.moves.includes("after")) {
					const delivery = trace.indexOf("focus"),
						away = trace.indexOf("after"),
						back = trace.indexOf("note");
					if (delivery < away || (back >= 0 && delivery > back)) expected = "note+after";
				}
				expect(deletes).toBe(expected);
			} finally {
				lens?.dispose();
				document.body.innerHTML = "";
				vi.restoreAllMocks();
			}
		},
	);
}
