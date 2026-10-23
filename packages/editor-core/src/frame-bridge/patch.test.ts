import { afterEach, expect, it, vi } from "vitest";
import { mountPageLens } from "./page-lens";
import { createFramePatcher } from "./patch";
import type { FrameView } from "./protocol";

const disposals: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});
const fragment = (id: string, text: string) => ({
	id,
	html: `<div data-node-id="${id}" data-block-id="${id}">${text}</div>`,
});
function fixture(options: { readOnly?: boolean; body?: string } = {}) {
	window.history.replaceState(null, "", "?praxity-inspect=1");
	document.body.innerHTML =
		options.body ??
		'<main id="page"><div data-node-id="one" data-block-id="one">One</div><div data-node-id="two" data-block-id="two">Two</div></main>';
	const view: FrameView = {
		...(options.readOnly ? { readOnly: true } : {}),
		file: "lesson.prax",
		pageId: "page",
		language: "en",
		alwaysShowHandles: false,
		nodes: [],
		selected: [],
		expanded: [],
		focus: null,
	};
	const lens = mountPageLens({ document, view, onEvent: () => {} });
	const feedback = vi.fn();
	const patcher = createFramePatcher({ document, pageId: "page", lens, onFeedback: feedback });
	disposals.push(() => {
		patcher.dispose();
		lens.dispose();
	});
	const text = (id: string) => document.querySelector(`[data-block-id="${id}"]`)?.textContent;
	return { patcher, lens, view, text, feedback };
}
it("replaces a node while keeping untouched DOM identity", () => {
	const { patcher, text } = fixture();
	const untouched = document.querySelector('[data-block-id="two"]');
	patcher.nodes({ pageId: "page", seq: 1, fragments: [fragment("one", "Changed")] });
	expect(text("one")).toBe("Changed");
	expect(document.querySelector('[data-block-id="two"]')).toBe(untouched);
});
it("orders inserts and moves and deletes from the rendered baseline, even with an empty host view", () => {
	const { patcher, text } = fixture();
	const two = document.querySelector('[data-block-id="two"]');
	patcher.patch({
		pageId: "page",
		seq: 1,
		order: ["two", "three"],
		fragments: [fragment("three", "Three")],
		shellStale: false,
	});
	expect(text("one")).toBeUndefined();
	expect(document.querySelector('[data-block-id="two"]')).toBe(two);
	expect(
		[...document.querySelectorAll("[data-block-id]")].map((el) => el.getAttribute("data-block-id")),
	).toEqual(["two", "three"]);
});
it("inserts into an empty page", () => {
	const { patcher, text } = fixture();
	patcher.patch({ pageId: "page", seq: 1, order: [], fragments: [], shellStale: false });
	patcher.patch({
		pageId: "page",
		seq: 2,
		order: ["new"],
		fragments: [fragment("new", "New")],
		shellStale: false,
	});
	expect(text("new")).toBe("New");
});
it("rejects obsolete renders per node without dropping older work for a different node", () => {
	const { patcher, text } = fixture();
	patcher.nodes({ pageId: "page", seq: 4, fragments: [fragment("one", "New")] });
	patcher.nodes({
		pageId: "page",
		seq: 3,
		fragments: [fragment("one", "Old"), fragment("two", "Other")],
	});
	expect(text("one")).toBe("New");
	expect(text("two")).toBe("Other");
});
it("deduplicates draft responses and refuses old gestures and epochs", () => {
	const { patcher, text } = fixture();
	patcher.beginDraft({ seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one"] });
	const draft = {
		pageId: "page",
		seq: 1,
		transactionId: "a",
		state: "draft" as const,
		fragments: [fragment("one", "Draft")],
	};
	patcher.draft(draft, 0);
	const element = document.querySelector('[data-block-id="one"]');
	patcher.draft(draft, 0);
	expect(document.querySelector('[data-block-id="one"]')).toBe(element);
	patcher.resetDraftEpoch(1);
	patcher.beginDraft({ seq: 1, epoch: 1, transactionId: "b", nodeIds: ["one"] });
	patcher.draft({ ...draft, state: "reverted", fragments: [fragment("one", "Stale")] }, 0);
	expect(text("one")).toBe("Draft");
	patcher.draft({ ...draft, transactionId: "b", fragments: [fragment("one", "Latest")] }, 1);
	expect(text("one")).toBe("Latest");
});
it("settles older sibling drafts separately", () => {
	const { patcher, text } = fixture();
	patcher.beginDraft({ seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one"] });
	patcher.beginDraft({ seq: 2, epoch: 0, transactionId: "b", nodeIds: ["two"] });
	patcher.draft(
		{
			pageId: "page",
			seq: 1,
			transactionId: "a",
			state: "reverted",
			fragments: [fragment("one", "Saved")],
		},
		0,
	);
	expect(text("one")).toBe("Saved");
	expect(text("two")).toBe("Two");
	patcher.draft({ pageId: "page", seq: 2, transactionId: "b", state: "saved", fragments: [] }, 0);
	expect(text("two")).toBe("Two");
});
it("retains deferred page changes when a newer node render arrives during a draft", () => {
	const { patcher, text } = fixture();
	patcher.beginDraft({ seq: 7, epoch: 0, transactionId: "a", nodeIds: ["one"] });
	patcher.patch({
		pageId: "page",
		seq: 20,
		order: ["one", "two"],
		fragments: [fragment("two", "Outside")],
		shellStale: false,
	});
	patcher.nodes({ pageId: "page", seq: 21, fragments: [fragment("one", "Saved")] });
	patcher.draft({ pageId: "page", seq: 7, transactionId: "a", state: "saved", fragments: [] }, 0);
	expect(text("two")).toBe("Outside");
	expect(text("one")).toBe("Saved");
});
it("shows Updating after 400 ms, then clears it even when compile has no changed fragments", () => {
	vi.useFakeTimers();
	const { patcher } = fixture();
	patcher.beginDraft({ seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one"] });
	vi.advanceTimersByTime(399);
	expect(patcher.feedback().nodes).toEqual({});
	vi.advanceTimersByTime(1);
	expect(patcher.feedback().nodes.one).toEqual({ state: "updating" });
	expect(document.querySelector('[data-praxity-chrome="render-badge"]')?.textContent).toBe(
		"Updating",
	);
	patcher.draft({ pageId: "page", seq: 1, transactionId: "a", state: "saved", fragments: [] }, 0);
	patcher.patch({
		pageId: "page",
		seq: 1,
		order: ["one", "two"],
		fragments: [],
		shellStale: false,
	});
	expect(patcher.feedback().nodes).toEqual({});
});
it("keeps the last render on failure and exposes a localized banner and node description", () => {
	const { patcher, text } = fixture();
	patcher.nodes({ pageId: "page", seq: 1, fragments: [fragment("one", "Good")] });
	// Replacement patterns in a diagnostic stay literal; the banner claims nothing about saving.
	const message = "Invalid lesson near $& and $' and $`";
	patcher.failed({ pageId: "page", seq: 2, diagnostics: [{ message }] });
	expect(text("one")).toBe("Good");
	expect(document.querySelector('[data-praxity-chrome="render-banner"]')?.textContent).toBe(
		`Page preview is out of date: ${message}. Showing the last version that compiled.`,
	);
	expect(patcher.feedback().nodes.one).toEqual({ state: "failed", message });
	expect(document.querySelectorAll('[data-praxity-chrome="render-badge"]')).toHaveLength(0);
});
it("resilences live roles and refuses authored chrome in replacement markup", () => {
	const { patcher } = fixture();
	patcher.nodes({
		pageId: "page",
		seq: 1,
		fragments: [
			fragment(
				"one",
				'<div role="log">Log</div><button data-praxity-chrome="handle" data-focus-role="source">Forged</button><iframe tabindex="0"></iframe>',
			),
		],
	});
	expect(document.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe("off");
	expect(document.querySelector("button")?.hasAttribute("data-focus-role")).toBe(false);
	expect(document.querySelector("iframe")?.getAttribute("tabindex")).toBe("-1");
});
it("keeps a registered source field and its caret while replacing its content node", () => {
	const { patcher, lens, view } = fixture();
	view.nodes.push({ id: "one", kind: "block", parentId: "page", name: "One", description: "One" });
	const field = document.createElement("textarea");
	field.value = "Author draft";
	document.querySelector('[data-block-id="one"]')?.append(field);
	lens.registerControl(field, { file: view.file, nodeId: "one", role: "source" });
	field.focus();
	field.setSelectionRange(2, 7);
	patcher.nodes({ pageId: "page", seq: 1, fragments: [fragment("one", "Changed")] });
	expect(document.activeElement).toBe(field);
	expect([field.selectionStart, field.selectionEnd]).toEqual([2, 7]);
});
it("a read-only page view keeps focus on the patched node's control, or on its root", () => {
	const links = (text: string) =>
		`<div data-node-id="one" data-block-id="one">${text} <a href="#a">A</a> <a href="#b">B</a></div>`;
	const { patcher, text } = fixture({
		readOnly: true,
		body: `<main id="page">${links("One")}<div data-node-id="two" data-block-id="two">Two</div></main>`,
	});
	document.querySelector<HTMLElement>('a[href="#b"]')?.focus();
	patcher.nodes({ pageId: "page", seq: 1, fragments: [{ id: "one", html: links("Changed") }] });
	expect(text("one")).toContain("Changed");
	expect(document.activeElement).toBe(document.querySelector('a[href="#b"]'));
	patcher.nodes({ pageId: "page", seq: 2, fragments: [fragment("one", "No links")] });
	const root = document.querySelector<HTMLElement>('[data-block-id="one"]');
	expect(document.activeElement).toBe(root);
	expect(root?.getAttribute("tabindex")).toBe("-1");
});
it("a read-only page view moves focus to the next surviving node when a patch removes the focused one", () => {
	const node = (id: string) =>
		`<div data-node-id="${id}" data-block-id="${id}">${id} <a href="#${id}">${id}</a></div>`;
	const { patcher } = fixture({
		readOnly: true,
		body: `<main id="page">${node("one")}${node("two")}${node("three")}</main>`,
	});
	const order = (seq: number, ids: string[]) =>
		patcher.patch({ pageId: "page", seq, order: ids, fragments: [], shellStale: false });
	document.querySelector<HTMLElement>('a[href="#two"]')?.focus();
	order(1, ["one", "three"]);
	const three = document.querySelector<HTMLElement>('[data-block-id="three"]');
	expect(document.activeElement).toBe(three);
	expect(three?.getAttribute("tabindex")).toBe("-1");
	document.querySelector<HTMLElement>('a[href="#three"]')?.focus();
	order(2, ["one"]);
	expect(document.activeElement).toBe(document.querySelector('[data-block-id="one"]'));
});
it("a read-only page view keeps focus inside the innermost patched node", () => {
	const inner = (links: string) => `<div data-node-id="inner" data-block-id="inner">${links}</div>`;
	const { patcher, lens } = fixture({
		readOnly: true,
		body: `<main id="page"><div data-node-id="outer" data-block-id="outer"><a href="#before">Before</a>${inner('<a href="#x">X</a><a href="#y">Y</a>')}<a href="#after">After</a></div></main>`,
	});
	lens.fragmentElement("outer");
	document.querySelector<HTMLElement>('a[href="#y"]')?.focus();
	// The patched node loses its second control. Counting in the outer node would land on "After".
	patcher.nodes({
		pageId: "page",
		seq: 1,
		fragments: [{ id: "inner", html: inner('<a href="#x">X</a>') }],
	});
	const root = document.querySelector<HTMLElement>('[data-block-id="inner"]');
	expect(document.activeElement).toBe(root);
	expect(root?.getAttribute("tabindex")).toBe("-1");
});
it("a read-only patch leaves focus alone while it is outside the frame", () => {
	const links = (text: string) =>
		`<div data-node-id="one" data-block-id="one">${text} <a href="#a">A</a></div>`;
	const { patcher } = fixture({
		readOnly: true,
		body: `<main id="page">${links("One")}</main>`,
	});
	document.querySelector<HTMLElement>('a[href="#a"]')?.focus();
	vi.spyOn(document, "hasFocus").mockReturnValue(false);
	patcher.nodes({ pageId: "page", seq: 1, fragments: [{ id: "one", html: links("Changed") }] });
	expect(document.activeElement).toBe(document.body);
});
it("rejects malformed fragment roots and other pages without changing the document", () => {
	const { patcher, text } = fixture();
	expect(
		patcher.nodes({
			pageId: "page",
			seq: 1,
			fragments: [{ id: "one", html: '<div data-node-id="two">Wrong</div>' }],
		}),
	).toEqual(["one"]);
	patcher.nodes({ pageId: "other", seq: 2, fragments: [fragment("one", "Other page")] });
	expect(text("one")).toBe("One");
});
it("an in-flight compile cannot overwrite a saved or reverted draft settlement", () => {
	const { patcher, text } = fixture();
	patcher.beginDraft({ seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one"] });
	patcher.patch({
		pageId: "page",
		seq: 0,
		order: ["one", "two"],
		fragments: [fragment("one", "Obsolete")],
		shellStale: false,
	});
	patcher.draft(
		{
			pageId: "page",
			seq: 1,
			transactionId: "a",
			state: "saved",
			fragments: [fragment("one", "Confirmed")],
		},
		0,
	);
	expect(text("one")).toBe("Confirmed");
});
it("a patch affects only its page in a multi-page deck document", () => {
	const { patcher, text } = fixture();
	const other = document.createElement("section");
	other.id = "other-page";
	other.innerHTML = fragment("other-node", "Other page").html;
	document.body.append(other);
	patcher.patch({ pageId: "page", seq: 1, order: ["two"], fragments: [], shellStale: false });
	expect(text("one")).toBeUndefined();
	expect(text("other-node")).toBe("Other page");
});
it("reconciles structural regions without replacing unchanged content", () => {
	const { patcher } = fixture();
	const two = document.querySelector('[data-block-id="two"]');
	patcher.patch({
		pageId: "page",
		seq: 1,
		shellStale: false,
		order: ["region:columns-open", "two", "region:column-close"],
		fragments: [
			{ id: "region:columns-open", html: '<section class="columns">' },
			{ id: "region:column-close", html: "</section>" },
		],
	});
	expect(document.querySelector('.columns > [data-block-id="two"]')).toBe(two);
	expect(document.querySelector('[data-block-id="one"]')).toBeNull();
	patcher.patch({ pageId: "page", seq: 2, shellStale: false, order: ["two"], fragments: [] });
	expect(document.querySelector('[data-block-id="two"]')).toBe(two);
});
it("uses French render copy and includes failure details in the handle description", () => {
	const { patcher, lens, view } = fixture();
	view.language = "fr";
	view.nodes.push({ id: "page", kind: "page", parentId: null, name: "Page", description: "Page" });
	view.nodes.push({
		id: "one",
		kind: "block",
		parentId: "page",
		name: "Un",
		description: "Premier bloc",
	});
	lens.render(view);
	patcher.failed({ pageId: "page", seq: 1, diagnostics: [{ message: "Erreur de syntaxe" }] });
	expect(document.querySelector('[data-praxity-chrome="render-banner"]')?.textContent).toBe(
		"L'aperçu de la page est obsolète : Erreur de syntaxe. Dernière version valide affichée.",
	);
	expect(document.querySelector('[data-praxity-chrome="description"]')?.textContent).toContain(
		"Erreur de syntaxe",
	);
});
it("a reconnect resync replaces a painted draft even at an applied revision", () => {
	const { patcher, text } = fixture();
	patcher.nodes({ pageId: "page", seq: 3, fragments: [fragment("one", "Saved")] });
	patcher.beginDraft({ seq: 1, epoch: 0, transactionId: "a", nodeIds: ["one"] });
	patcher.draft(
		{
			pageId: "page",
			seq: 1,
			transactionId: "a",
			state: "draft",
			fragments: [fragment("one", "Draft")],
		},
		0,
	);
	expect(text("one")).toBe("Draft");
	patcher.resetDraftEpoch(1);
	patcher.patch({
		pageId: "page",
		seq: 3,
		order: ["one", "two"],
		fragments: [fragment("one", "Saved"), fragment("two", "Two")],
		shellStale: false,
	});
	expect(text("one")).toBe("Saved");
});
it("strips scripts, nonces and refreshes from patched nodes, as the served inspection does", () => {
	const { patcher, text } = fixture();
	patcher.nodes({
		pageId: "page",
		seq: 1,
		fragments: [
			{
				id: "one",
				html: '<div data-node-id="one" data-block-id="one"><meta http-equiv="Refresh" content="0;url=index.html"><script>window.ran = true</script><script type="application/json">{"logic":1}</script><p nonce="guess">Patched</p><template><script>1</script></template></div>',
			},
		],
	});
	const node = document.querySelector('[data-block-id="one"]');
	expect(text("one")).toContain("Patched");
	expect(node?.querySelector("meta")).toBeNull();
	expect(node?.querySelectorAll("script")).toHaveLength(1);
	expect(node?.querySelector("script")?.getAttribute("type")).toBe("application/json");
	expect(node?.querySelector("[nonce]")).toBeNull();
	expect(node?.querySelector("template")?.content.querySelector("script")).toBeNull();
});
