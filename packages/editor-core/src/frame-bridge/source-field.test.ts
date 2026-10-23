import { readLesson } from "@praxity/grammar";
import { getByRole, queryByRole } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import { afterEach, expect, it, vi } from "vitest";
import { nativeMessageWindow } from "../../test-support/message-window";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { createSession, dispatch } from "../session";
import { buildFrameView, connectPageFrame, mountPageLens } from "./index";

import { isFrameView } from "./protocol";

let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	dispose = undefined;
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

it("F10 private-port focus moves from a menu item straight to an admitted closed-shadow field", async () => {
	const { view, noteId } = opened();
	const { source: _source, ...closed } = view;
	const frame = document.createElement("iframe");
	frame.src = "https://studio.test/?praxity-inspect=1";
	document.body.append(frame);
	const child = frame.contentWindow;
	if (!child) throw new Error("Missing child window");
	child.document.open();
	child.document.write(`<main><h1>Page</h1><div data-node-id="${noteId}">Text</div></main>`);
	child.document.close();
	vi.spyOn(child.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(80, 80, 300, 100),
	);
	const identity = { channel: "closed-source", pageId: view.pageId };
	const ports = new MessageChannel();
	const emit = (event: object) =>
		ports.port2.postMessage({
			source: "praxity-frame",
			version: 1,
			...identity,
			presentationId: 0,
			...event,
		});
	const lens = mountPageLens({ document: child.document, view: closed, onEvent: emit });
	const host = child.document.createElement("div");
	child.document.body.append(host);
	const root = host.attachShadow({ mode: "closed" });
	const field = child.document.createElement("textarea");
	field.value = "Text\n";
	root.append(field);
	const target = { file: view.file, nodeId: noteId, role: "source" as const };
	lens.registerControl(field, target);
	const events = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: closed,
		onEvent: events,
	});
	dispose = () => {
		bridge.dispose();
		lens.dispose();
		ports.port1.close();
		ports.port2.close();
	};
	ports.port2.onmessage = ({ data }) => {
		if (data.action === "focus")
			emit({
				event: "focusResult",
				focus: data.target,
				requestId: data.requestId,
				success: lens.focus(data.target),
			});
	};
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: child,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	const menu = child.document.createElement("button");
	menu.setAttribute("role", "menuitem");
	menu.textContent = "Edit source";
	child.document.body.append(menu);
	menu.focus();
	expect(await bridge.focus({ ...target, selection: [1, 3] })).toBe(true);
	expect(root.activeElement).toBe(field);
	await vi.waitFor(() =>
		expect(events.mock.calls.filter(([e]) => e.event === "focusChanged")).toEqual([
			[expect.objectContaining({ focus: { ...target, selection: [1, 3] } })],
		]),
	);
});

function opened() {
	const lesson = readLesson("# Page\n\n::: note\nText\n:::\n");
	const pageId = lesson.pages[0].id;
	const note = [...lesson.nodes.values()].find((record) => record.node.type === "note")!;
	const translate = createTranslator({ locale: "en", messages: en });
	const t = (key: string, params?: Record<string, string | number>) =>
		translate(key as Parameters<typeof translate>[0], params);
	const state = dispatch(
		createSession(),
		{
			type: "openSource",
			displayId: note.id,
			seed: {
				file: "a.prax",
				target: { kind: "node", nodeId: note.id },
				baseRevision: "revision",
				expectedText: "::: note\nText\n:::\n",
				editableText: "::: note\nText\n",
			},
		},
		{ now: 0, translate: (message) => t(message.key, message.params) },
	).state;
	return {
		lesson,
		view: buildFrameView({ lesson, file: "a.prax", pageId, session: state, translate: t }),
		noteId: note.id,
		state,
	};
}

function sourceField() {
	const host = document.querySelector('[data-praxity-chrome="source-group"]');
	return host?.shadowRoot
		? (getByRole(host.shadowRoot as unknown as HTMLElement, "textbox", {
				name: /^Source (of|de) /,
			}) as HTMLTextAreaElement)
		: (queryByRole(document.documentElement, "textbox", {
				name: /^Source (of|de) /,
			}) as HTMLTextAreaElement | null);
}

function mount() {
	const { view, noteId, state, lesson } = opened();
	window.history.replaceState(null, "", "?praxity-inspect=1");
	document.body.innerHTML = `<main><h1>Page</h1><div data-block-id="${noteId}" data-node-id="${noteId}"><p>Text</p></div></main>`;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(80, 80, 300, 100),
	);
	const events = vi.fn();
	const lens = mountPageLens({ document, view, onEvent: events });
	dispose = lens.dispose;
	return { lens, view, noteId, events, state, lesson };
}

it("D15 feedback preserves text nodes and hides retired chrome until source closes", () => {
	const { lens, view, noteId } = mount();
	lens.renderFeedback({ nodes: { [noteId]: { state: "updating" } }, failure: null });
	const badge = document.querySelector('[data-praxity-chrome="render-badge"]');
	const text = badge?.firstChild;
	lens.renderFeedback({
		nodes: { [noteId]: { state: "failed", message: "Failed" } },
		failure: null,
	});
	expect(badge?.firstChild).toBe(text);
	expect(text?.nodeValue).toBe("Preview out of date");
	const failure = { nodes: {}, failure: [{ message: "Failure", line: 1 }] };
	lens.renderFeedback(failure);
	const banner = document.querySelector('[data-praxity-chrome="render-banner"]');
	const bannerText = banner?.firstChild;
	lens.renderFeedback(failure);
	expect(document.querySelector('[data-praxity-chrome="render-banner"]')).toBe(banner);
	expect(banner?.firstChild).toBe(bannerText);
	lens.renderFeedback({ nodes: {}, failure: [{ message: "Changed failure", line: 2 }] });
	expect(bannerText?.nodeValue).toContain("Changed failure");
	lens.renderFeedback({ nodes: {}, failure: null });
	expect(badge?.isConnected).toBe(true);
	expect(banner?.isConnected).toBe(true);
	expect(badge?.hasAttribute("hidden")).toBe(true);
	expect(banner?.hasAttribute("hidden")).toBe(true);
	vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
		this: HTMLElement,
	) {
		return this.isConnected ? new DOMRect(80, 80, 300, 100) : new DOMRect();
	});
	const { source: _source, ...closed } = view;
	lens.render(closed);
	expect(badge?.isConnected).toBe(false);
	expect(banner?.isConnected).toBe(false);
});

it("D15 queues fragment replacement and ordering until source closes; stale handles cannot focus", () => {
	const { lens, view, noteId } = mount();
	const original = lens.fragmentElement(noteId);
	const stale = document.createElement("p");
	stale.setAttribute("data-node-id", "stale");
	stale.textContent = "Stale";
	document.querySelector("main")?.append(stale);
	lens.render({ ...view, nodes: [...view.nodes, { ...view.nodes[0], id: "stale" }] });
	const handle = document.querySelector<HTMLButtonElement>(
		'[data-praxity-chrome="handle"][data-node-id="stale"]',
	);
	const observer = new MutationObserver(() => {});
	observer.observe(document, { subtree: true, childList: true });
	lens.replaceFragment({
		id: noteId,
		html: `<div data-node-id="${noteId}" data-block-id="${noteId}">First</div>`,
	});
	lens.replaceFragment({
		id: noteId,
		html: `<div data-node-id="${noteId}" data-block-id="${noteId}">Latest</div>`,
	});
	lens.orderFragments([noteId], [], new Set());
	lens.render(view);
	expect(lens.fragmentElement(noteId)).toBe(original);
	expect(handle?.isConnected).toBe(true);
	expect(handle?.inert).toBe(true);
	expect(handle?.getAttribute("aria-hidden")).toBe("true");
	expect(lens.canFocus({ file: view.file, nodeId: "stale", role: "handle" })).toBe(false);
	lens.refresh();
	lens.render({ ...view, nodes: [...view.nodes, { ...view.nodes[0], id: "stale" }] });
	expect(lens.canFocus({ file: view.file, nodeId: "stale", role: "handle" })).toBe(true);
	expect(observer.takeRecords().flatMap((record) => [...record.removedNodes])).toEqual([]);
	observer.disconnect();
	const { source: _source, ...closed } = view;
	lens.render(closed);
	expect(lens.fragmentElement(noteId)?.textContent).toBe("Latest");
	expect(document.querySelector('[data-praxity-chrome="handle"]')?.hasAttribute("inert")).toBe(
		false,
	);
});

it("D15 source closer and detached anchor stay connected until close", () => {
	const { lens, view } = mount();
	const field = sourceField();
	if (!field) throw new Error("Missing source field");
	const closer = (field.getRootNode() as ShadowRoot).querySelector(
		'[data-praxity-chrome="source-closer"]',
	);
	lens.render({ ...view, source: view.source && { ...view.source, closer: false } });
	expect(closer?.isConnected).toBe(true);
	expect(closer?.hasAttribute("hidden")).toBe(true);
	const { source: _source, ...closed } = view;
	lens.render(closed);
	expect(closer?.isConnected).toBe(false);
});

it("D15 focusing the current source and caret leaves the native editing group alone", () => {
	const { lens, noteId } = mount();
	const target = {
		file: "a.prax",
		nodeId: noteId,
		role: "source" as const,
		selection: [3, 3] as const,
	};
	expect(lens.focus(target)).toBe(true);
	const field = sourceField();
	if (!field) throw new Error("Missing source field");
	const focus = vi.spyOn(field, "focus");
	const select = vi.spyOn(field, "setSelectionRange");
	expect(lens.focus(target)).toBe(true);
	expect(focus).not.toHaveBeenCalled();
	expect(select).not.toHaveBeenCalled();
});

it("D15 a deferred replacement reports a node removed by an earlier queued order", () => {
	const { lens, view, noteId, events } = mount();
	lens.orderFragments([], [], new Set());
	expect(
		lens.replaceFragment({ id: noteId, html: `<div data-node-id="${noteId}">Late</div>` }),
	).toBe(true);
	events.mockClear();
	const { source: _source, ...closed } = view;
	lens.render({ ...closed, nodes: [], selected: [], expanded: [], focus: null });
	expect(events).toHaveBeenCalledWith({ event: "missing", nodeIds: [noteId] });
});

it("D15 a new source field binds to the fragment painted when the previous field closes", () => {
	const { lens, view, noteId } = mount();
	if (!view.source) throw new Error("Missing source projection");
	lens.replaceFragment({ id: noteId, html: `<div data-node-id="${noteId}">Latest render</div>` });
	lens.render({ ...view, source: { ...view.source, draftId: "next-draft" } });
	const slot = document.querySelector('[data-praxity-chrome="source-slot"]');
	expect(slot?.isConnected).toBe(true);
	expect(slot?.nextElementSibling?.textContent).toBe("Latest render");
	expect(sourceField()?.value).toBe("::: note\nText\n");
});

it("D15 a replacement can target a node inserted by an earlier queued order", () => {
	const { lens, view, events } = mount();
	const fragment = { id: "inserted", html: '<div data-node-id="inserted">Inserted</div>' };
	lens.orderFragments(["inserted"], [fragment], new Set());
	expect(
		lens.replaceFragment({ ...fragment, html: '<div data-node-id="inserted">Latest</div>' }),
	).toBe(true);
	events.mockClear();
	const { source: _source, ...closed } = view;
	lens.render({ ...closed, nodes: [], selected: [], expanded: [], focus: null });
	expect(lens.fragmentElement("inserted")?.textContent).toBe("Latest");
	expect(events).not.toHaveBeenCalledWith(expect.objectContaining({ event: "missing" }));
});

it.each([
	[
		"en",
		en,
		"Source editor",
		"Note: Text. Block 1 of 1. In Page: Page. Shift+Tab returns to the block.",
		"Escape to finish",
	],
	[
		"fr",
		fr,
		"Éditeur de source",
		"Note: Text. Bloc 1 sur 1. Dans Page: Page. Maj+Tab revient au bloc.",
		"Échap pour terminer",
	],
] as const)(
	"F11 source context and labelled inner group in %s",
	(language, messages, groupName, description, hint) => {
		const { lens, view, state, lesson } = mount();
		const translate = createTranslator({ locale: language, messages });
		const next = buildFrameView({
			lesson,
			file: view.file,
			pageId: view.pageId,
			session: { ...state, interfaceLanguage: language },
			translate: (key, params) => translate(key as Parameters<typeof translate>[0], params),
		});
		lens.render(next);
		const field = sourceField();
		if (!field) throw new Error("Missing field");
		const root = field.getRootNode() as ShadowRoot;
		const group = queryByRole(root as unknown as HTMLElement, "group", { name: groupName });
		expect(group).not.toBeNull();
		if (!group) throw new Error("Missing inner group");
		expect(group.contains(field)).toBe(true);
		expect(group.lang).toBe(language);
		const ids = field.getAttribute("aria-describedby")?.split(" ") ?? [];
		expect(ids.map((id) => root.getElementById(id)?.textContent).join(" ")).toBe(description);
		expect(group.textContent).toContain(hint);
		expect(root.querySelector('[data-praxity-chrome="source-caption"]')?.textContent).toBe(
			`${hint}.`,
		);
		expect(ids.some((id) => root.getElementById(id)?.textContent?.includes(hint))).toBe(false);
	},
);

it.each(["en", "fr"] as const)("F11 %s typing keeps the field context unchanged", (language) => {
	const { state, lesson, view } = opened();
	const t = createTranslator({ locale: language, messages: language === "en" ? en : fr });
	const translate = (key: string, params?: Record<string, string | number>) =>
		t(key as Parameters<typeof t>[0], params);
	const project = (session: typeof state) =>
		buildFrameView({ lesson, file: view.file, pageId: view.pageId, session, translate });
	const before = project(state);
	const dirty = dispatch(
		state,
		{ type: "changeDraft", text: "::: note\nText\nx", selection: [15, 15] },
		{ now: 1 },
	).state;
	const after = project(dirty);
	expect(after.source?.description).toBe(before.source?.description);
	expect(after.nodes.find((node) => node.id === after.source?.nodeId)?.description).toContain(
		language === "en" ? "Unsaved draft." : "Brouillon non enregistré.",
	);
});

it.each(["en", "fr"] as const)("F11 %s context preserves the literal undefined", (language) => {
	const t = createTranslator({ locale: language, messages: language === "en" ? en : fr });
	const params = {
		hasName: "yes",
		name: "undefined",
		position: "1.",
		hasParent: "yes",
		parent: "undefined",
	};
	expect(t("sourceField.description", params)).toBe(
		language === "en"
			? "undefined. 1. In undefined. Shift+Tab returns to the block."
			: "undefined. 1. Dans undefined. Maj+Tab revient au bloc.",
	);
	expect(t("sourceField.description", { ...params, hasName: "no", hasParent: "no" })).toBe(
		language === "en" ? "1. Shift+Tab returns to the block." : "1. Maj+Tab revient au bloc.",
	);
});

it("F11 owning handle reports open source through replacement and close", () => {
	const { lens, view, noteId } = mount();
	const handle = () => getByRole(document.body, "button", { name: /^Note/ });
	expect(handle().getAttribute("aria-expanded")).toBe("true");
	lens.replaceFragment({
		id: noteId,
		html: `<div data-block-id="${noteId}" data-node-id="${noteId}">Replacement</div>`,
	});
	lens.refresh();
	expect(handle().getAttribute("aria-expanded")).toBe("true");
	const { source: _source, ...closed } = view;
	lens.render(closed);
	expect(handle().getAttribute("aria-expanded")).toBe("false");
	expect(lens.focus({ file: view.file, nodeId: noteId, role: "handle" })).toBe(true);
});

it("F11 repeated note context states its position once", () => {
	const lesson = readLesson("# Safety basics\n\n::: note\nText\n:::\n\n::: note\nText\n:::\n");
	const note = [...lesson.nodes.values()].find((record) => record.node.type === "note");
	if (!note) throw new Error("Missing note");
	const state = dispatch(
		createSession(),
		{
			type: "openSource",
			seed: {
				file: "a.prax",
				target: { kind: "node", nodeId: note.id },
				baseRevision: "r0",
				expectedText: "::: note\nText\n:::\n",
				editableText: "::: note\nText\n",
			},
		},
		{ now: 0 },
	).state;
	const t = createTranslator({ locale: "en", messages: en });
	const view = buildFrameView({
		lesson,
		file: "a.prax",
		pageId: lesson.pages[0].id,
		session: state,
		translate: (key, params) => t(key as Parameters<typeof t>[0], params),
	});
	expect(view.source?.description).toBe(
		"Note: Text. Block 1 of 2. In Page: Safety basics. Shift+Tab returns to the block.",
	);
});

for (const language of ["en", "fr"] as const) {
	for (const kind of ["page", "paragraph", "column"] as const) {
		it(`F11 ${language} ${kind} context does not repeat its name or position`, () => {
			const lesson = readLesson(
				kind === "column"
					? "# Page\n\n::: columns\n::\nText\n::\nOther\n:::\n"
					: "# Page\n\nText\n\nText\n",
			);
			const record = [...lesson.nodes.values()].find(
				(record) =>
					!record.role &&
					record.node.kind ===
						(kind === "paragraph" ? "body" : kind === "column" ? "item" : "page"),
			);
			if (!record) throw new Error("Missing source target");
			const text = kind === "page" ? "# Page\n" : kind === "column" ? "::\nText\n" : "Text\n";
			const state = dispatch(
				createSession({ interfaceLanguage: language }),
				{
					type: "openSource",
					seed: {
						file: "a.prax",
						target: { kind: "node", nodeId: record.id },
						baseRevision: "r0",
						expectedText: text,
						editableText: text,
					},
				},
				{ now: 0 },
			).state;
			const t = createTranslator({ locale: language, messages: language === "en" ? en : fr });
			const view = buildFrameView({
				lesson,
				file: "a.prax",
				pageId: lesson.pages[0].id,
				session: state,
				translate: (key, params) => t(key as Parameters<typeof t>[0], params),
			});
			const names =
				language === "en"
					? {
							page: "Source of Page: Page",
							paragraph: "Source of Paragraph: Text",
							column: "Source of Column",
						}
					: {
							page: "Source de Page: Page",
							paragraph: "Source de Paragraphe: Text",
							column: "Source de Colonne",
						};
			const descriptions =
				language === "en"
					? {
							page: "Block 1 of 1. Shift+Tab returns to the block.",
							paragraph: "Block 1 of 2. In Page: Page. Shift+Tab returns to the block.",
							column: "Block 1 of 2. In Columns: Text. Shift+Tab returns to the block.",
						}
					: {
							page: "Bloc 1 sur 1. Maj+Tab revient au bloc.",
							paragraph: "Bloc 1 sur 2. Dans Page: Page. Maj+Tab revient au bloc.",
							column: "Bloc 1 sur 2. Dans Colonnes: Text. Maj+Tab revient au bloc.",
						};
			expect(view.source?.name).toBe(names[kind]);
			expect(view.source?.description).toBe(descriptions[kind]);
		});
	}
}

it("F11 rejects nontext source context at the projection edge", () => {
	const { view } = opened();
	expect(isFrameView({ ...view, source: { ...view.source, description: 7 } })).toBe(false);
	expect(
		isFrameView({ ...view, source: { ...view.source, description: "Context", extra: true } }),
	).toBe(false);
	expect(isFrameView(view)).toBe(true);
});

it("D1 D2 F3 projects the admitted note draft and decorative closer", () => {
	const { lens } = mount();
	const field = sourceField();
	expect(field?.value).toBe("::: note\nText\n");
	expect(field?.getAttribute("aria-label")).toBe("Source of Note");
	expect(field?.getAttribute("aria-describedby")).toBeTruthy();
	const closer = field?.nextElementSibling;
	expect(closer?.textContent).toBe(":::");
	expect(closer?.getAttribute("aria-hidden")).toBe("true");
	expect(closer?.hasAttribute("tabindex")).toBe(false);
	lens.dispose();
	dispose = undefined;
	expect(sourceField()).toBeNull();
});

it("F10 F11 a fragment patch retains the same focused field and literal caret", () => {
	const { lens, noteId } = mount();
	const target = {
		file: "a.prax",
		nodeId: noteId,
		role: "source" as const,
		selection: [3, 3] as const,
	};
	expect(lens.focus(target)).toBe(true);
	const field = sourceField() as HTMLTextAreaElement;
	expect(
		lens.replaceFragment({
			id: noteId,
			html: `<div data-block-id="${noteId}" data-node-id="${noteId}"><p>Patched</p></div>`,
		}),
	).toBe(true);
	lens.refresh();
	expect((field.getRootNode() as ShadowRoot).activeElement).toBe(field);
	expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3]);
	expect(field.value).toBe("::: note\nText\n");
});

it("a page-title patch replaces the rendered heading while its source field is open", () => {
	const { lens, view } = mount();
	if (!view.source) throw new Error("Missing source projection");
	const heading = document.querySelector("h1");
	lens.render({
		...view,
		source: { ...view.source, nodeId: view.pageId, value: "# Page\n", closer: false },
		focus: { file: view.file, nodeId: view.pageId, role: "source" },
	});
	expect(lens.fragmentElement(view.pageId)).toBe(heading);
	expect(
		lens.replaceFragment({
			id: view.pageId,
			html: `<h1 data-node-id="${view.pageId}">Changed</h1>`,
		}),
	).toBe(true);
	lens.refresh();
	const { source: _source, ...closed } = view;
	lens.render(closed);
	expect([...document.querySelectorAll("h1")].map((element) => element.textContent)).toEqual([
		"Changed",
	]);
});

it("a render projection cannot overwrite native author text in the same open draft", () => {
	const { lens, view, noteId } = mount();
	if (!view.source) throw new Error("Missing source projection");
	lens.focus({ file: view.file, nodeId: noteId, role: "source" });
	const field = sourceField() as HTMLTextAreaElement;
	field.value = "::: note\nAuthor text\n";
	field.setSelectionRange(3, 8, "backward");
	lens.render({ ...view, source: { ...view.source, value: "::: note\nOlder projection\n" } });
	expect(field.value).toBe("::: note\nAuthor text\n");
	expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([
		3,
		8,
		"backward",
	]);
});

it("D15 changed handle descriptions retain their text node through draft and feedback updates", () => {
	const { lens, view, noteId } = mount();
	const handle = getByRole(document.documentElement, "button", { name: /^Note/, hidden: true });
	const description = document.getElementById(handle.getAttribute("aria-describedby") ?? "");
	const text = description?.firstChild;
	expect(text).toBeTruthy();
	lens.render({
		...view,
		nodes: view.nodes.map((node) =>
			node.id === noteId ? { ...node, description: "Block 1 of 1. Unsaved draft." } : node,
		),
	});
	expect(description?.textContent).toBe("Block 1 of 1. Unsaved draft.");
	expect(description?.firstChild).toBe(text);
	lens.renderFeedback({ nodes: {}, failure: [] });
	expect(description?.firstChild).toBe(text);
});

it("suspend and data-only render deny field focus; resume preserves field without replay", () => {
	const { lens, view, noteId, events } = mount();
	const target = { file: "a.prax", nodeId: noteId, role: "source" as const };
	expect(lens.focus(target)).toBe(true);
	const field = sourceField() as HTMLTextAreaElement;
	lens.suspend();
	expect(field.disabled).toBe(true);
	lens.render(view);
	expect(lens.focus(target)).toBe(false);
	// jsdom treats a tabindex as focusable even when disabled; browsers test native focus.
	expect(document.activeElement).not.toBe(field);
	events.mockClear();
	field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	field.dispatchEvent(new Event("input", { bubbles: true }));
	expect(events).not.toHaveBeenCalled();
	lens.resume(view);
	expect(sourceField()).toBe(field);
	expect(field.disabled).toBe(false);
	expect(document.activeElement).not.toBe(field);
	expect(lens.focus(target)).toBe(true);
});

it("source projection validation refuses unknown targets, extra keys and raw event payloads", () => {
	const { view } = opened();
	expect(isFrameView(view)).toBe(true);
	const source = (view as typeof view & { source?: object }).source;
	expect(source).toBeDefined();
	expect(isFrameView({ ...view, source: { ...source, nodeId: "foreign" } })).toBe(false);
	expect(isFrameView({ ...view, source: { ...source, html: "<script>" } })).toBe(false);
	expect(isFrameView({ ...view, readOnly: true })).toBe(false);
	for (const invalid of [{ baseText: 1 }, { diagnostic: {} }, { invalid: "true" }])
		expect(isFrameView({ ...view, source: { ...source, ...invalid } })).toBe(false);
});

it("D5 a warning stays described without marking the field invalid", () => {
	const { lens, view } = mount();
	if (!view.source) throw new Error("Missing source");
	lens.render({
		...view,
		source: { ...view.source, diagnostic: "Line 1: Warning", invalid: false },
	});
	const field = sourceField();
	expect(field?.hasAttribute("aria-invalid")).toBe(false);
	expect(field?.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
});

it("D4 D15 diagnostic and caption changes keep shadow text nodes connected", () => {
	const { lens, view } = mount();
	if (!view.source) throw new Error("Missing source");
	const field = sourceField();
	if (!field) throw new Error("Missing native field");
	const observer = new MutationObserver(() => {});
	observer.observe(field.getRootNode(), { subtree: true, childList: true });
	lens.render({
		...view,
		source: { ...view.source, diagnostic: "Line 1: Error", invalid: true },
	});
	expect(field.getAttribute("aria-invalid")).toBe("true");
	const diagnosticId = field.getAttribute("aria-describedby")?.split(" ")[1];
	const diagnostic = (field.getRootNode() as ShadowRoot).getElementById(diagnosticId ?? "");
	expect(diagnostic?.textContent).toBe("Line 1: Error");
	lens.render({ ...view, source: { ...view.source, caption: "Source of a renamed note." } });
	expect(field.hasAttribute("aria-invalid")).toBe(false);
	expect(field.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
	expect(diagnostic?.textContent).toBe("");
	expect(observer.takeRecords().flatMap((record) => [...record.removedNodes])).toEqual([]);
	observer.disconnect();
});

it("D2 closing restores the render; ordinary fields have no closer and captions stay text", () => {
	const { lens, view } = mount();
	if (!view.source) throw new Error("Missing source projection");
	lens.render({
		...view,
		source: { ...view.source, closer: false, caption: "<img src=x onerror=alert(1)>" },
	});
	expect(sourceField()?.nextElementSibling?.hasAttribute("hidden")).toBe(true);
	expect(sourceField()?.previousElementSibling?.textContent).toBe("<img src=x onerror=alert(1)>");
	expect(document.querySelector("img")).toBeNull();
	const { source: _source, ...closed } = view;
	lens.render(closed);
	expect(sourceField()).toBeNull();
	expect(document.querySelector("[data-block-id]")?.getAttribute("style")).toBeNull();
	expect(document.querySelector("[data-block-id]")?.getAttribute("aria-hidden")).toBeNull();
});

it("F11 a collapsed hostile geometry probe keeps the last source placement and focus", () => {
	const { lens, noteId } = mount();
	const target = {
		file: "a.prax",
		nodeId: noteId,
		role: "source" as const,
		selection: [3, 3] as const,
	};
	expect(lens.focus(target)).toBe(true);
	const field = sourceField();
	if (!field) throw new Error("Missing admitted source field");
	vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
		this: HTMLElement,
	) {
		return this.getAttribute("data-praxity-chrome") === "geometry"
			? new DOMRect(0, 0, 0, 0)
			: new DOMRect(80, 80, 300, 100);
	});
	expect(() => lens.refresh()).not.toThrow();
	expect((field.getRootNode() as ShadowRoot).activeElement).toBe(field);
	expect(lens.focus(target)).toBe(true);
});

it("F10 admitted closed-shadow source focus reports its actual caret once and preserves backward selection", () => {
	const { lens, view, noteId, events } = mount();
	const { source: _source, ...closed } = view;
	lens.render(closed);
	const host = document.createElement("div");
	document.body.append(host);
	const root = host.attachShadow({ mode: "closed" });
	const field = document.createElement("textarea");
	field.value = "Text\n";
	root.append(field);
	const target = { file: view.file, nodeId: noteId, role: "source" as const };
	lens.registerControl(field, target);
	const clone = field.cloneNode(true) as HTMLTextAreaElement;
	document.body.prepend(clone);
	events.mockClear();
	expect(lens.focus({ ...target, selection: [1, 3] })).toBe(true);
	expect(root.activeElement).toBe(field);
	expect(events.mock.calls).toEqual([
		[{ event: "focusChanged", focus: { ...target, selection: [1, 3] } }],
	]);
	events.mockClear();
	field.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
	field.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true, composed: true }));
	clone.focus();
	expect(events).not.toHaveBeenCalled();
	expect(lens.focus(target)).toBe(true);
	field.setSelectionRange(1, 4, "backward");
	lens.refresh();
	expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([
		1,
		4,
		"backward",
	]);
	lens.dispose();
	dispose = undefined;
	events.mockClear();
	field.blur();
	field.focus();
	expect(events).not.toHaveBeenCalled();
});

for (const shadow of [false, true]) {
	it(`re-registers a retired ${shadow ? "closed-shadow" : "light-DOM"} control`, () => {
		const { lens, view, noteId } = mount();
		const { source: _source, ...closed } = view;
		lens.render(closed);
		const host = document.createElement("div");
		document.body.append(host);
		const root = shadow ? host.attachShadow({ mode: "closed" }) : host;
		const field = document.createElement("textarea");
		field.value = "Kept";
		root.append(field);
		const target = { file: view.file, nodeId: noteId, role: "source" as const };
		lens.registerControl(field, target);
		expect(lens.focus(target)).toBe(true);
		host.remove();
		lens.refresh();
		document.body.append(host);
		lens.registerControl(field, target);
		lens.registerControl(field, target);
		expect(lens.focus(target)).toBe(true);
		expect(field.value).toBe("Kept");
	});
}

it.each([false, true])(
	"D11 a duplicate marker cannot capture a missing source anchor, block marker %s",
	(block) => {
		const { lens, noteId, events } = mount();
		const field = sourceField();
		if (!field) throw new Error("Missing field");
		field.value = "Kept";
		document.querySelector(`[data-block-id="${noteId}"]`)?.remove();
		const decoy = document.createElement("div");
		decoy.dataset.nodeId = noteId;
		if (block) decoy.dataset.blockId = noteId;
		decoy.textContent = "Decoy";
		document.querySelector("main")?.append(decoy);
		events.mockClear();
		lens.refresh();
		expect(sourceField()).toBe(field);
		expect(field.value).toBe("Kept");
		const slot = document.querySelector<HTMLElement>('[data-praxity-chrome="source-slot"]');
		expect(slot?.hidden).toBe(true);
		expect(decoy.style.display).toBe("");
		expect(decoy.hasAttribute("aria-hidden")).toBe(false);
		expect(events).toHaveBeenCalledWith({
			event: "missing",
			nodeIds: expect.arrayContaining([noteId]),
		});
		// A patcher-admitted replacement can restore geometry without replacing native text.
		const replacement = decoy.cloneNode(true) as HTMLElement;
		document.querySelector("main")?.append(replacement);
		lens.admitFragment(noteId, replacement);
		lens.refresh();
		expect(document.querySelector('[data-praxity-chrome="source-slot"]')).toBe(slot);
		expect(slot?.hidden).toBe(false);
		expect(replacement.style.display).toBe("none");
		expect(sourceField()).toBe(field);
		expect(field.value).toBe("Kept");
	},
);

it("D11 missing render retains the exact native draft and reports its identity", () => {
	const { lens, view, noteId, events, state } = mount();
	const field = sourceField();
	if (!field) throw new Error("Missing field");
	field.value = "::: note\nCafé 😀\n";
	document.querySelector(`[data-block-id="${noteId}"]`)?.remove();
	lens.refresh();
	expect(sourceField()).toBe(field);
	expect(field.value).toBe("::: note\nCafé 😀\n");
	expect(events).toHaveBeenCalledWith({
		event: "missing",
		nodeIds: expect.arrayContaining([noteId]),
	});
	lens.render(view);
	expect(sourceField()).toBe(field);
	const edited = dispatch(
		state,
		{
			type: "changeDraft",
			text: "::: note\nCafé 😀\n",
			selection: [3, 3],
		},
		{ now: 1 },
	).state;
	const id = edited.activeDraft;
	if (!id) throw new Error("Missing controller draft");
	const changed = dispatch(
		edited,
		{ type: "outsideChange", file: "a.prax", revision: "r2" },
		{ now: 2 },
	).state;
	const resolution = dispatch(
		changed,
		{
			type: "draftResolved",
			id,
			generation: edited.drafts[id].generation,
			epoch: changed.epoch,
			resolution: { kind: "removed" },
		},
		{ now: 3 },
	);
	expect(resolution.state.drafts[id].status).toBe("orphaned");
	expect(resolution.state.drafts[id].text).toBe("::: note\nCafé 😀\n");
	expect(resolution.effects.filter((effect) => effect.type === "focus")).toEqual([]);
});
