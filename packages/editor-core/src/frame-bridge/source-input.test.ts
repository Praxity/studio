import { readLesson } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { afterEach, expect, it, vi } from "vitest";
import { nativeInput } from "../../test-support/native-input";
import en from "../messages/en.json";
import { type Command, createSession, dispatch, type Effect } from "../session";
import { buildFrameView, mountPageLens } from "./index";

let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	vi.restoreAllMocks();
	vi.useRealTimers();
	document.body.innerHTML = "";
});

function setup() {
	const attachShadow = HTMLElement.prototype.attachShadow;
	vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (init) {
		return nativeInput(attachShadow.call(this, init));
	});
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const lesson = readLesson("# Page\n\n::: note\nText\n:::\n");
	const note = [...lesson.nodes.values()].find((r) => r.node.type === "note");
	if (!note) throw new Error("Missing note");
	const translate = createTranslator({ locale: "en", messages: en });
	const t = (key: string, params?: Record<string, string | number>) =>
		translate(key as Parameters<typeof translate>[0], params);
	const seed = {
		file: "a.prax",
		target: { kind: "node" as const, nodeId: note.id },
		baseRevision: "revision",
		expectedText: "::: note\nText\n:::\n",
		editableText: "::: note\nText\n",
	};
	const effects: Effect[] = [];
	let admittedSeed = seed;
	const validation = vi.fn(() => ({
		diagnostics: [
			{
				file: "a.prax",
				ref: null,
				severity: "error" as const,
				message: { key: "op.diagnostic.invalid-source" as const, params: {} },
			},
		],
		escapes: false,
	}));
	let state = createSession();
	let lens: ReturnType<typeof mountPageLens> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const command = (input: Command) => {
		const result = dispatch(state, input, {
			now: Date.now(),
			translate: (m) => t(m.key, m.params),
			validateDraft: validation,
			readDraft: () => admittedSeed,
			focusNeighbours: () => ({ page: { file: "a.prax", nodeId: note.id, role: "handle" } }),
		});
		state = result.state;
		effects.push(...result.effects);
		if (lens) {
			lens.render(view());
			clearTimeout(timer);
			const draft = state.activeDraft ? state.drafts[state.activeDraft] : undefined;
			const due =
				draft && draft.generation !== draft.validatedGeneration ? draft.changedAt + 150 : Infinity;
			if (Number.isFinite(due))
				timer = setTimeout(() => command({ type: "tick" }), Math.max(0, due - Date.now()));
		}
	};
	command({ type: "openSource", seed, displayId: note.id });
	const view = () =>
		buildFrameView({
			lesson,
			file: "a.prax",
			pageId: lesson.pages[0].id,
			session: state,
			translate: t,
		});
	window.history.replaceState(null, "", "?praxity-inspect=1");
	document.body.innerHTML = `<main><h1>Page</h1><div data-node-id="${note.id}">Text</div></main>`;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(80, 80, 300, 100),
	);
	const events = vi.fn((event: import("./protocol").FrameEventBody) => {
		if (event.event === "sourceChanged" && event.focus.selection)
			command({ type: "changeDraft", text: event.text, selection: [...event.focus.selection] });
		if (event.event === "focusChanged") command({ type: "focusChanged", focus: event.focus });
		if (event.event === "sourceAction")
			command(
				event.action === "undoSource"
					? { type: "undo", inTextField: true }
					: { type: "commit", trigger: event.action === "saveSource" ? "save" : "enter" },
			);
		if (event.event === "escape") command({ type: "escape" });
	});
	lens = mountPageLens({ document: nativeInput(document), view: view(), onEvent: events });
	dispose = () => {
		clearTimeout(timer);
		lens?.dispose();
	};
	lens.focus({ file: "a.prax", nodeId: note.id, role: "source", selection: [0, 0] });
	const root = (document.activeElement as HTMLElement).shadowRoot;
	if (!root || !(root.activeElement instanceof HTMLTextAreaElement))
		throw new Error("Missing focused source field");
	const field = root.activeElement;
	effects.length = 0;
	events.mockClear();
	const input = (value: string) => {
		field.value = value;
		field.setSelectionRange(value.length, value.length);
		field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
	};
	const key = (key: string, extra: KeyboardEventInit = {}) => {
		const event = new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			composed: true,
			cancelable: true,
			...extra,
		});
		field.dispatchEvent(event);
		return event;
	};
	return {
		lens,
		field,
		root,
		events,
		effects,
		validation,
		command,
		input,
		key,
		seed,
		admitSeed: (next: typeof seed) => {
			admittedSeed = next;
		},
		view,
		state: () => state,
	};
}

it.each([
	["authored text", 0, true],
	["blank", 0, false],
	["handle", 0, false],
	["secondary button", 2, false],
	["blurred source", 0, false],
	["closed source", 0, false],
] as const)(
	"G1 queued selection retains native source ownership for %s",
	(destination, button, held) => {
		const h = setup();
		const content = document.querySelector<HTMLElement>(
			`[data-node-id="${h.seed.target.nodeId}"]:not(button)`,
		);
		if (!content) throw new Error("Missing authored node");
		if (destination === "blurred source") h.field.blur();
		if (destination === "closed source") {
			const { source: _source, ...closed } = h.view();
			h.lens.render(closed);
		}
		const target =
			destination === "blank"
				? document.body
				: destination === "handle"
					? document.querySelector<HTMLButtonElement>(
							`button[data-node-id="${h.seed.target.nodeId}"]`,
						)
					: content;
		if (!target) throw new Error("Missing pointer target");
		h.events.mockClear();
		const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button });
		target.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(held);
		expect(h.events).not.toHaveBeenCalled();
		if (held) {
			content.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
			expect(h.events.mock.calls.filter(([event]) => event.event === "select")).toEqual([
				[
					expect.objectContaining({
						event: "select",
						focus: { file: "a.prax", nodeId: h.seed.target.nodeId, role: "handle" },
						mode: "single",
						finalInput: expect.objectContaining({ draftId: h.state().activeDraft }),
					}),
				],
			]);
		}
	},
);

it("D3 D4 field input carries literal text and caret without posting or parsing", () => {
	const h = setup();
	h.input("::: note\nChanged\n");
	expect(h.events).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "sourceChanged",
			text: "::: note\nChanged\n",
			focus: expect.objectContaining({ selection: [17, 17] }),
		}),
	);
	expect(h.validation).not.toHaveBeenCalled();
	expect(h.effects.filter((e) => e.type === "post" || e.type === "persistDraft")).toEqual([]);
});
it("D3 late trusted source input retains its text after native focus leaves", () => {
	const h = setup();
	h.lens.focus({ file: "a.prax", nodeId: h.seed.target.nodeId, role: "handle" });
	h.effects.length = 0;
	h.input("::: note\nFinalABC\n");
	expect(h.state().drafts[h.state().activeDraft ?? ""]).toMatchObject({
		text: "::: note\nFinalABC\n",
		selection: [18, 18],
	});
	expect(h.state().focus?.role).toBe("handle");
	expect(h.effects).toEqual([{ type: "render" }]);
});
it("D6 the gesture carries a cloned admitted snapshot and never raw DOM text", () => {
	const h = setup();
	h.input("::: note\nFinalABC\n");
	h.key("Escape");
	const gesture = h.events.mock.calls.find(([event]) => event.event === "escape")?.[0];
	expect(gesture).toMatchObject({
		finalInput: { text: "::: note\nFinalABC\n", selection: [18, 18] },
	});
	h.field.value = "Forged";
	expect(gesture).toMatchObject({
		finalInput: { text: "::: note\nFinalABC\n", selection: [18, 18] },
	});
});
it("F10 final capture reads the native caret before its selection report", () => {
	const h = setup();
	h.input("::: note\nFinalABC\n");
	h.field.setSelectionRange(2, 6, "backward");
	h.key("Escape");
	expect(h.events.mock.calls.find(([event]) => event.event === "escape")?.[0]).toMatchObject({
		finalInput: { text: "::: note\nFinalABC\n", selection: [2, 6] },
	});
});
it("D3 a clone cannot supply final native input", () => {
	const h = setup();
	const clone = h.field.cloneNode(true) as HTMLTextAreaElement;
	h.root.append(clone);
	clone.focus();
	clone.value = "Forged";
	h.events.mockClear();
	clone.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
	expect(h.events).not.toHaveBeenCalled();
	expect(h.state().drafts[h.state().activeDraft ?? ""].text).toBe("::: note\nText\n");
});
it.each([
	["Escape", {}],
	["Enter", { ctrlKey: true }],
	["s", { ctrlKey: true }],
] as const)("D6 %s posts one request through the actual field", (key, modifiers) => {
	const h = setup();
	h.input("::: note\nChanged\n");
	h.key(key, modifiers);
	expect(h.effects.filter((e) => e.type === "post" && e.method === "operationApply")).toHaveLength(
		1,
	);
	expect(h.state().pending).toMatchObject({
		kind: "commit",
		exit: { kind: key === "s" ? "stay" : "leave" },
	});
});
it("D15 base-text undo is swallowed; dirty undo and redo stay native", () => {
	const h = setup();
	expect(h.key("z", { ctrlKey: true }).defaultPrevented).toBe(true);
	expect(h.events).toHaveBeenCalledWith(
		expect.objectContaining({ event: "sourceAction", action: "undoSource" }),
	);
	expect(h.effects.filter((e) => e.type === "post")).toEqual([]);
	expect(h.effects.find((e) => e.type === "announce")).toMatchObject({
		message: { key: "session.announcements.nothingInField" },
	});
	h.input("::: note\nChanged\n");
	expect(h.key("z", { ctrlKey: true }).defaultPrevented).toBe(false);
	expect(h.key("z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
});
it("D4 D5 diagnostics absent at 149 ms, present at 150 ms after final field input", () => {
	const h = setup();
	h.input("::: note\nFirst\n");
	vi.advanceTimersByTime(100);
	h.input("::: note\nFinal\n");
	vi.advanceTimersByTime(149);
	expect(h.validation).not.toHaveBeenCalled();
	expect(h.field.hasAttribute("aria-invalid")).toBe(false);
	vi.advanceTimersByTime(1);
	expect(h.validation).toHaveBeenCalledTimes(1);
	expect(h.field.getAttribute("aria-invalid")).toBe("true");
	expect(h.field.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
	expect(h.root.querySelector('[data-praxity-chrome="source-diagnostic"]')?.textContent).toBe(
		"Line 1: The source contains an error",
	);
	expect(h.effects.filter((e) => e.type === "post")).toEqual([]);
});
it("F10 controller caret matches actual selection on source re-entry", () => {
	const h = setup();
	h.field.setSelectionRange(3, 8);
	h.field.dispatchEvent(new Event("select", { bubbles: true }));
	expect(h.state().drafts[h.state().activeDraft ?? ""].selection).toEqual([3, 8]);
	expect(h.state().focus?.selection).toEqual([3, 8]);
	const focus = h.view().focus;
	if (!focus) throw new Error("Missing source focus");
	h.lens.focus(focus);
	expect([h.field.selectionStart, h.field.selectionEnd]).toEqual([3, 8]);
});

it("D5 contained-invalid save keeps its diagnostic and invalid field semantics", () => {
	const h = setup();
	h.input("::: note\nChanged\n");
	vi.advanceTimersByTime(150);
	h.key("s", { ctrlKey: true });
	const post = h.effects.find((e) => e.type === "post" && e.method === "operationApply");
	if (!post || post.type !== "post" || post.method !== "operationApply")
		throw new Error("Missing save");
	const nodeId = h.seed.target.nodeId;
	h.command({
		type: "operationReply",
		result: {
			ok: true,
			transactionId: post.request.transactionId,
			historyId: "invalid-save",
			files: [
				{
					path: "a.prax",
					fromRevision: "revision",
					toRevision: "saved",
					edits: [{ start: 16, end: 20, text: "Changed" }],
				},
			],
			intent: "modify",
			mapping: [{ oldId: nodeId, newId: nodeId, fate: "kept" }],
			inverse: { files: [], mapping: [], guards: [] },
			diagnostics: [
				{
					file: "a.prax",
					ref: null,
					severity: "error",
					message: { key: "op.diagnostic.invalid-source", params: { line: 1 } },
				},
			],
			focus: { file: "a.prax", nodeId, role: "handle" },
			summary: { key: "op.editSource", params: { count: 1 } },
		},
	});
	expect(h.field.getAttribute("aria-invalid")).toBe("true");
	expect(h.root.querySelector('[data-praxity-chrome="source-diagnostic"]')?.textContent).toBe(
		"Line 1: The source contains an error",
	);
});
it.each([false, true])(
	"D6 D15 canonical saved source preserves native baseline, newer typing %s",
	(typing) => {
		const h = setup();
		h.input("::: note\nText\nX");
		h.key("s", { ctrlKey: true });
		const pending = h.state().pending;
		if (pending?.kind !== "commit") throw new Error("Missing save");
		if (typing) h.input("::: note\nText\nXY");
		h.command({
			type: "operationReply",
			result: {
				ok: true,
				transactionId: pending.request.transactionId,
				historyId: "saved",
				files: [
					{
						path: "a.prax",
						fromRevision: "revision",
						toRevision: "saved",
						edits: [{ start: 0, end: 19, text: "::: note\nText\nX\n:::\n" }],
					},
				],
				intent: "modify",
				mapping: [],
				inverse: { files: [], mapping: [], guards: [] },
				diagnostics: [],
				focus: { file: "a.prax", nodeId: h.seed.target.nodeId, role: "handle" },
				summary: { key: "op.editSource", params: { count: 1 } },
			},
		});
		h.admitSeed({
			...h.seed,
			baseRevision: "saved",
			expectedText: "::: note\nText\nX\n:::\n",
			editableText: "::: note\nText\nX\n",
		});
		h.command({ type: "sourceSnapshot", file: "a.prax", revision: "saved", seq: 1 });
		const draft = h.state().drafts[h.state().activeDraft ?? ""];
		expect(draft).toMatchObject({
			text: typing ? "::: note\nText\nXY" : "::: note\nText\nX",
			baseText: "::: note\nText\nX",
			expectedText: "::: note\nText\nX\n:::\n",
			editableText: "::: note\nText\nX\n",
			status: typing ? "dirty" : "clean",
		});
		expect(h.field.value).toBe(draft.text);
		if (!typing) {
			h.key("z", { ctrlKey: true });
			expect(h.effects).toContainEqual(
				expect.objectContaining({
					type: "announce",
					message: expect.objectContaining({ key: "session.announcements.nothingInField" }),
				}),
			);
			h.field.setSelectionRange(1, 1);
			h.field.dispatchEvent(new Event("select", { bubbles: true }));
			h.key("Escape");
			expect(h.effects.filter((e) => e.type === "post")).toHaveLength(1);
		}
	},
);

it("source selection refuses text that was never admitted by input", () => {
	const h = setup();
	h.field.value = "Forged";
	h.field.setSelectionRange(1, 1);
	h.field.dispatchEvent(new Event("select", { bubbles: true }));
	expect(h.events).not.toHaveBeenCalled();
	expect(h.state().drafts[h.state().activeDraft ?? ""].text).toBe("::: note\nText\n");
});

it("D19 composing Escape, Tab, Mod+Enter, save and undo produce zero editor actions", () => {
	const h = setup();
	for (const guard of [{ isComposing: true }, { keyCode: 229 }])
		for (const [key, modifiers] of [
			["Escape", {}],
			["Tab", { shiftKey: true }],
			["Enter", { ctrlKey: true }],
			["s", { ctrlKey: true }],
			["z", { ctrlKey: true }],
		] as const)
			h.key(key, { ...guard, ...modifiers });
	expect(h.events).not.toHaveBeenCalled();
});
it("F10 source selection is reported for re-entry even without text input", () => {
	const h = setup();
	h.field.setSelectionRange(3, 8, "backward");
	h.field.dispatchEvent(new Event("select", { bubbles: true }));
	expect(h.events).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "sourceChanged",
			text: "::: note\nText\n",
			focus: expect.objectContaining({ selection: [3, 8] }),
		}),
	);
});
