import { readLesson } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { afterEach, expect, it, vi } from "vitest";
import { nativeMessageWindow } from "../../test-support/message-window";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { createSession } from "../session";
import {
	buildFrameView,
	connectPageFrame,
	type FrameView,
	isFrameCommand,
	isFrameEvent,
	mountPageLens,
	startInspectionFrame,
} from "./index";

const identity = { channel: "test-channel", pageId: "page" };
const target = { file: "lesson.prax", nodeId: "text", role: "handle" as const };
it.each(["other control", "body without removal", "outside document"])(
	"F8 reply CAS refuses %s before focus writes",
	(departure) => {
		fixture();
		const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
		disposers.push(lens.dispose);
		lens.focus(target);
		if (departure === "other control") expect(lens.focus({ ...target, nodeId: "tabs" })).toBe(true);
		if (departure === "body without removal") handle("text")?.blur();
		vi.spyOn(document, "hasFocus").mockReturnValue(departure !== "outside document");
		const before = document.activeElement;
		expect(lens.focus(target, { expect: [{ file: target.file, nodeId: target.nodeId }] })).toBe(
			false,
		);
		expect(document.activeElement).toBe(before);
	},
);
it("F8 reply CAS retains a render removal witness and ignores synthetic input", () => {
	fixture();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
	const initial = view();
	initial.source = {
		draftId: "draft",
		nodeId: "text",
		name: "Source",
		caption: "Source",
		value: "Text",
		closer: false,
	};
	const lens = mountPageLens({ document, view: initial, onEvent: vi.fn() });
	disposers.push(lens.dispose);
	lens.focus({ ...target, role: "source" });
	lens.render(view());
	expect(document.activeElement).toBe(document.body);
	document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
	document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	expect(lens.focus(target, { expect: [{ file: target.file, nodeId: target.nodeId }] })).toBe(true);
	expect(document.activeElement).toBe(handle("text"));
});
it.each(["pagehide", "beforeunload"])(
	"inspection reports %s only through its private port",
	async (event) => {
		window.history.replaceState(null, "", "?praxity-inspect=1");
		const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
		const frame = startInspectionFrame({
			window: nativeMessageWindow(window),
			parentOrigin: "https://studio.test",
			...identity,
		});
		if (!frame) throw new Error("Missing inspection frame");
		disposers.push(frame.dispose);
		const transferred = send.mock.calls[0][2];
		if (!Array.isArray(transferred) || !(transferred[0] instanceof MessagePort))
			throw new Error("Missing bridge port");
		const events: unknown[] = [];
		const port = transferred[0];
		port.onmessage = (message: MessageEvent) => events.push(message.data);
		port.start();
		disposers.push(() => port.close());
		vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
		window.dispatchEvent(new Event(event));
		await vi.waitFor(() =>
			expect(events).toEqual([
				{
					source: "praxity-frame",
					version: 1,
					channel: "test-channel",
					pageId: "page",
					event: "unloading",
				},
			]),
		);
		expect(send).toHaveBeenCalledTimes(1);
	},
);

it("a completed inspection keeps its private port when beforeunload is cancelled", async () => {
	window.history.replaceState(null, "", "?praxity-inspect=1");
	vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
	const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
	const frame = startInspectionFrame({
		window: nativeMessageWindow(window),
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!frame) throw new Error("Missing inspection frame");
	disposers.push(frame.dispose);
	const transferred = send.mock.calls[0][2];
	if (!Array.isArray(transferred) || !(transferred[0] instanceof MessagePort))
		throw new Error("Missing bridge port");
	const events: unknown[] = [];
	const port = transferred[0];
	port.onmessage = (message: MessageEvent) => events.push(message.data);
	port.start();
	disposers.push(() => port.close());
	window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
	window.dispatchEvent(new Event("pagehide"));
	await vi.waitFor(() => expect(events).toHaveLength(1));
	expect(events).toEqual([
		{ source: "praxity-frame", version: 1, ...identity, event: "unloading" },
	]);
	expect(send).toHaveBeenCalledTimes(1);
});

it("opaque inspection authenticates the current window, identity and one private port", async () => {
	const frame = document.createElement("iframe");
	const other = document.createElement("iframe");
	document.body.append(frame, other);
	if (!frame.contentWindow) throw new Error("Missing inspection window");
	const send = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	const commands: unknown[] = [];
	ports.port2.onmessage = (event) => commands.push(event.data);
	const ready = { source: "praxity-frame", version: 1, ...identity, event: "ready" };
	for (const violation of [
		{ source: other.contentWindow },
		{ origin: "https://course.test" },
		{ data: { ...ready, channel: "stale" } },
		{ ports: [] },
		{ ports: [ports.port1, ports.port2] },
	]) {
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "null",
				source: frame.contentWindow,
				data: ready,
				ports: [ports.port1],
				...violation,
			}),
		);
	}
	expect(onEvent).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: ready,
			ports: [ports.port1],
		}),
	);
	expect(onEvent).toHaveBeenCalledOnce();
	// Commands travel only on the admitted port. A "*" window message would reach any
	// document the frame navigated to.
	await vi.waitFor(() =>
		expect(commands).toContainEqual(expect.objectContaining({ action: "render" })),
	);
	expect(send).not.toHaveBeenCalled();
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: ready,
			ports: [ports.port2],
		}),
	);
	expect(onEvent).toHaveBeenCalledOnce();
});
it.each([true, false])(
	"refuses window-message shortcut and region commands with frame focus %s",
	(focused) => {
		const frame = document.createElement("iframe");
		const outside = document.createElement("button");
		document.body.append(frame, outside);
		const onEvent = vi.fn();
		const bridge = connectPageFrame({
			window: nativeMessageWindow(window),
			frame,
			frameOrigin: "https://course.test",
			...identity,
			view: view(),
			onEvent,
		});
		disposers.push(bridge.dispose);
		if (focused) frame.focus();
		else outside.focus();
		for (const command of [
			{
				event: "shortcut",
				action: "delete",
				focus: target,
				key: { key: "Delete", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
			},
			{
				event: "region",
				direction: 1,
				key: { key: "F6", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false },
			},
		]) {
			window.dispatchEvent(
				new MessageEvent("message", {
					origin: "https://course.test",
					source: frame.contentWindow,
					data: { source: "praxity-frame", version: 1, ...identity, ...command },
				}),
			);
		}
		expect(onEvent).not.toHaveBeenCalled();
	},
);
const view = (): FrameView => ({
	file: "lesson.prax",
	pageId: "page",
	language: "en",
	alwaysShowHandles: false,
	nodes: [
		{
			id: "page",
			kind: "page",
			parentId: null,
			name: "Page: Example",
			description: "Block 1 of 3.",
		},
		{
			id: "tabs",
			kind: "block",
			parentId: "page",
			name: "Tabs: Examples",
			description: "Block 2 of 3.",
		},
		{
			id: "first",
			kind: "item",
			parentId: "tabs",
			name: "Panel 1 of 2: First",
			description: "Block 1 of 2.",
		},
		{
			id: "text",
			kind: "block",
			parentId: "first",
			name: "Paragraph: First body",
			description: "Block 1 of 1.",
		},
		{
			id: "second",
			kind: "item",
			parentId: "tabs",
			name: "Panel 2 of 2: Second",
			description: "Block 2 of 2.",
		},
		{
			id: "other",
			kind: "block",
			parentId: "second",
			name: "Paragraph: Second body",
			description: "Block 1 of 1.",
		},
	],
	selected: [],
	expanded: [],
	focus: null,
});
const fixture = () => {
	// jsdom has no layout. Give the DOM adapter rendered boxes; browser tests
	// exercise the measured positions, including genuine zero-height boxes.
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
		this: HTMLElement,
	) {
		return this.dataset.praxityChrome === "geometry"
			? new DOMRect(0, 0, 100, 100)
			: new DOMRect(100, 100, 400, 100);
	});
	window.history.replaceState(null, "", "?praxity-inspect=1");
	document.body.innerHTML = `<h1 class="praxity-page-title">Example</h1>
	<div data-node-id="tabs"><div role="tablist">
	<button role="tab" data-node-id="first" aria-controls="panel-first" aria-selected="true">First</button>
	<button role="tab" data-node-id="second" aria-controls="panel-second" aria-selected="false">Second</button></div>
	<div role="tabpanel" id="panel-first" data-node-id="first"><p data-node-id="text">First body <a href="#">Link</a></p></div>
	<div role="tabpanel" id="panel-second" data-node-id="second" hidden><p data-node-id="other">Second body <input></p></div></div>`;
};
const handle = (id: string) =>
	document.querySelector<HTMLButtonElement>(
		`button[data-focus-role="handle"][data-node-id="${id}"]`,
	);
const disposers: (() => void)[] = [];
it("P3 page heading handles use the authored page ID instead of the reader title ID", () => {
	fixture();
	const heading = document.querySelector("h1");
	if (!heading) throw new Error("Missing heading");
	heading.setAttribute("data-node-id", "reader-title");
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(heading.getAttribute("data-node-id")).toBe("page");
	expect(lens.focus({ ...target, nodeId: "page" })).toBe(true);
	expect(document.activeElement).toBe(handle("page"));
});
it("F11 inspection removes learner button semantics around nested handles", () => {
	fixture();
	const wrapper = document.createElement("div");
	wrapper.setAttribute("aria-pressed", "false");
	wrapper.setAttribute("role", "button");
	const paragraph = document.querySelector('[data-node-id="text"]');
	if (!paragraph) throw new Error("Missing paragraph");
	paragraph.before(wrapper);
	wrapper.append(paragraph);
	const lens = mountPageLens({ document, view: view(), onEvent: () => {} });
	disposers.push(() => lens.dispose());
	expect(wrapper.getAttribute("role")).toBeNull();
	expect(wrapper.getAttribute("aria-pressed")).toBeNull();
	expect(lens.focus(target)).toBe(true);
	lens.dispose();
	expect(wrapper.getAttribute("role")).toBe("button");
	expect(wrapper.getAttribute("aria-pressed")).toBe("false");
});
it("A1 inspection silences course live regions and restores them on disposal", () => {
	fixture();
	const courseStatus = document.createElement("div");
	courseStatus.setAttribute("aria-live", "polite");
	courseStatus.setAttribute("role", "status");
	document.body.append(courseStatus);
	const lens = mountPageLens({ document, view: view(), onEvent: () => {} });
	disposers.push(() => lens.dispose());
	expect(courseStatus.getAttribute("aria-live")).toBe("off");
	expect(courseStatus.getAttribute("role")).toBe("status");
	lens.dispose();
	expect(courseStatus.getAttribute("aria-live")).toBe("polite");
	expect(courseStatus.getAttribute("role")).toBe("status");
});
afterEach(() => {
	disposers.splice(0).forEach((dispose) => dispose());
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

it("F11 course stylesheets cannot restyle handles: an earlier per-mount layer and inline geometry are !important", () => {
	fixture();
	const course = document.createElement("style");
	course.textContent = "@layer course { button { display:none !important; } }";
	document.head.append(course);
	disposers.push(() => course.remove());
	const first = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(first.dispose);
	const guard = document.head.firstElementChild;
	const layer = guard?.textContent?.match(/^@layer (praxity-\w+) \{/u)?.[1];
	expect(layer).toBeTruthy();
	// Important declarations in the earliest layer outrank every later author layer.
	expect(guard?.compareDocumentPosition(course)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	expect(guard?.textContent).not.toMatch(/var\(--(?:paper|edge|ink-2|accent|focus)/u);
	expect(handle("text")?.style.getPropertyPriority("inset-block-start")).toBe("important");
	expect(handle("text")?.style.getPropertyPriority("width")).toBe("important");
	first.dispose();
	expect(document.head.contains(guard)).toBe(false);
	// A course cannot predict the next mount's layer name.
	const second = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(second.dispose);
	expect(document.head.firstElementChild?.textContent).not.toContain(`@layer ${layer} `);
});

it("F11 the editing lens removes declarative invokers while mounted and restores them", () => {
	fixture();
	const invoker = document.createElement("button");
	invoker.setAttribute("commandfor", "course-dialog");
	invoker.setAttribute("command", "show-modal");
	invoker.setAttribute("popovertarget", "course-popover");
	invoker.setAttribute("interestfor", "course-popover");
	document.body.append(invoker);
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	for (const name of ["command", "commandfor", "popovertarget", "interestfor"])
		expect(invoker.hasAttribute(name)).toBe(false);
	lens.dispose();
	expect(invoker.getAttribute("command")).toBe("show-modal");
	expect(invoker.getAttribute("interestfor")).toBe("course-popover");
});

it("F1 F3 creates one native named handle per node before content and removes learner tab stops", () => {
	fixture();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(document.querySelectorAll('[data-focus-role="handle"]')).toHaveLength(6);
	expect(handle("text")?.nextElementSibling?.textContent).toContain("First body");
	expect(handle("text")?.getAttribute("aria-label")).toBe("Paragraph: First body");
	expect(handle("text")?.getAttribute("aria-haspopup")).toBe("menu");
	expect(handle("text")?.getAttribute("aria-expanded")).toBe("false");
	expect(
		document.getElementById(handle("text")?.getAttribute("aria-describedby") ?? "")?.textContent,
	).toBe("Block 1 of 1.");
	expect(handle("text")?.tabIndex).toBe(0);
	expect(document.querySelector("a")?.tabIndex).toBe(-1);
	expect(document.querySelector("input")?.tabIndex).toBe(-1);
});

it("authored chrome cannot forge intents or hijack logical focus, including after a patch", () => {
	fixture();
	const forged = document.createElement("button");
	forged.dataset.praxityChrome = "handle";
	forged.dataset.focusRole = "handle";
	forged.dataset.nodeId = "text";
	document.querySelector("h1")?.append(forged);
	const onEvent = vi.fn();
	const lens = mountPageLens({ document, view: view(), onEvent });
	disposers.push(lens.dispose);
	for (const button of [forged, forged.cloneNode(true) as HTMLButtonElement]) {
		if (!button.isConnected) document.querySelector("h1")?.append(button);
		button.dataset.praxityChrome = "handle";
		button.dataset.focusRole = "handle";
		button.dataset.nodeId = "text";
		lens.refresh();
		expect(button.tabIndex).toBe(-1);
		expect(button.hasAttribute("data-praxity-chrome")).toBe(false);
		expect(button.hasAttribute("data-focus-role")).toBe(false);
		expect(button.hasAttribute("data-node-id")).toBe(false);
		button.focus();
		onEvent.mockClear();
		button.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
		expect(onEvent).not.toHaveBeenCalled();
		expect(lens.focus(target)).toBe(true);
		expect(document.activeElement).toBe(handle("text"));
	}
});

it("embed frames and their wrappers suppress learner interaction and restore on disposal", () => {
	fixture();
	const wrapper = document.createElement("div");
	wrapper.innerHTML = '<iframe title="Learner embed" tabindex="0"></iframe>';
	document.querySelector('p[data-node-id="text"]')?.append(wrapper);
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	try {
		expect(wrapper.querySelector("iframe")?.tabIndex).toBe(-1);
		expect(wrapper.hasAttribute("inert")).toBe(true);
		expect(handle("text")?.hidden).toBe(false);
	} finally {
		lens.dispose();
	}
	expect(wrapper.querySelector("iframe")?.tabIndex).toBe(0);
	expect(wrapper.hasAttribute("inert")).toBe(false);
});

it("RTL reserves the inline-start gutter and positions handles on the right", () => {
	fixture();
	document.body.style.direction = "rtl";
	vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
		this: HTMLElement,
	) {
		return this.dataset.praxityChrome === "geometry"
			? new DOMRect(0, 0, 100, 100)
			: new DOMRect(
					window.innerWidth -
						424 -
						(Number.parseFloat(document.body.style.paddingInlineStart) || 0),
					100,
					400,
					100,
				);
	});
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	try {
		expect(document.body.style.paddingInlineStart).toBe("36px");
		const button = handle("text");
		expect(button?.style.insetInlineStart).toMatch(/^calc\(100% - \d+px\)$/u);
	} finally {
		lens.dispose();
		document.body.style.direction = "";
	}
});

it("WCAG 2.5.8 moves a handle beyond its line rather than overlap another handle", () => {
	// fixture() lays the page, tabs, tab and paragraph on one box: three blocks share a line.
	fixture();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	const boxes = [
		...document.querySelectorAll<HTMLButtonElement>('button[data-focus-role="handle"]'),
	]
		.filter((button) => !button.hidden)
		.map((button) => ({
			id: button.dataset.nodeId,
			left: Number.parseFloat(button.style.insetInlineStart),
			top: Number.parseFloat(button.style.insetBlockStart),
			size: Number.parseFloat(button.style.width),
		}));
	expect(boxes.map((box) => box.id)).toEqual(["page", "tabs", "first", "text", "second"]);
	for (const [index, a] of boxes.entries())
		for (const b of boxes.slice(index + 1)) {
			const overlap =
				a.left < b.left + b.size &&
				b.left < a.left + a.size &&
				a.top < b.top + b.size &&
				b.top < a.top + a.size;
			expect(overlap, `${a.id} and ${b.id}`).toBe(false);
		}
});

it.each(["transform", "zoom"])(
	"%s coordinates keep a handle centre on the node's first line",
	(kind) => {
		fixture();
		const text = document.querySelector<HTMLElement>('p[data-node-id="text"]');
		if (!text) throw new Error("Missing text");
		text.parentElement?.setAttribute(
			"style",
			kind === "zoom" ? "zoom:2" : "transform:translateY(8px)",
		);
		// jsdom cannot lay out a fixed containing block. Model its measured origin
		// and scale; the browser scenarios verify genuine transform/zoom geometry.
		// The page and tabs start above the panel, so their handles leave its line free.
		vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
			this: HTMLElement,
		) {
			if (this.dataset.praxityChrome === "geometry")
				return kind === "zoom" ? new DOMRect(0, 0, 200, 200) : new DOMRect(0, 8, 100, 100);
			return this.closest('[role="tabpanel"]')
				? new DOMRect(100, 100, 400, 100)
				: new DOMRect(100, 20, 400, 180);
		});
		const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
		disposers.push(lens.dispose);
		const button = handle("text");
		const top = Number.parseFloat(button?.style.insetBlockStart ?? "");
		const height = Number.parseFloat(button?.style.height || "24");
		const centre = kind === "zoom" ? (top + height / 2) * 2 : top + height / 2 + 8;
		expect(centre).toBeCloseTo(112);
	},
);

it("F5 reveals a selected or focused tab and excludes handles inside hidden panels", () => {
	fixture();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(handle("other")?.hidden).toBe(true);
	expect(handle("second")?.hidden).toBe(false);
	lens.render({ ...view(), selected: ["other"], focus: { ...target, nodeId: "other" } });
	expect(document.getElementById("panel-second")?.hidden).toBe(false);
	expect(document.getElementById("panel-first")?.hidden).toBe(true);
	expect(handle("other")?.hidden).toBe(false);
	expect(handle("text")?.hidden).toBe(true);
	expect(document.activeElement).toBe(document.body);
});

it("F5 disposal restores every tab panel's hidden, selection and tab-stop state exactly", () => {
	fixture();
	const state = () =>
		[...document.querySelectorAll('[role="tab"],[role="tabpanel"]')].map((el) => [
			el.id || el.getAttribute("data-node-id"),
			el.getAttribute("hidden"),
			el.getAttribute("aria-selected"),
			el.getAttribute("tabindex"),
		]);
	const before = state();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	lens.render({ ...view(), selected: ["other"], focus: { ...target, nodeId: "other" } });
	expect(document.getElementById("panel-first")?.hidden).toBe(true);
	expect(
		document.querySelector('[data-node-id="second"][role="tab"]')?.getAttribute("aria-selected"),
	).toBe("true");
	expect(document.querySelector<HTMLElement>('[role="tab"]')?.tabIndex).toBe(-1);
	lens.dispose();
	expect(state()).toEqual(before);
});

it("F1 F5 puts each tab's handle before its panel so Tab reaches every panel's children", () => {
	fixture();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	const following = (a: string, b: string) =>
		Boolean(
			handle(a)?.compareDocumentPosition(handle(b) as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
		);
	// Sequential order: first tab, its panel's children, then the second tab.
	expect(following("first", "text")).toBe(true);
	expect(following("text", "second")).toBe(true);
	expect(following("second", "other")).toBe(true);
	expect(handle("second")?.nextElementSibling).toBe(document.getElementById("panel-second"));
	// A tablist owns only tabs.
	expect(document.querySelector('[role="tablist"] [data-praxity-chrome]')).toBeNull();
	// Hidden panels keep their tab's handle reachable; its children stay hidden (F5).
	expect(handle("second")?.hidden).toBe(false);
	expect(handle("other")?.hidden).toBe(true);
});

// Markup as render-block-html emits it: later slides and conditional blocks start hidden.
const revealFixture = () => {
	fixture();
	document.body.innerHTML = `<h1 class="praxity-page-title">Example</h1>
	<section data-card-root data-block-id="deck" data-node-id="deck" tabindex="0"><div class="praxity-slides-grid">
	<div class="praxity-slides-item" data-slide-index="0" data-slide-position="active" data-active="true"><article data-node-id="one"><p data-node-id="one-body">One</p></article></div>
	<div class="praxity-slides-item" data-slide-index="1" data-slide-position="after" data-active="false" aria-hidden="true" inert><article data-node-id="two"><p data-node-id="two-body">Two</p><button type="button" data-card-flip aria-expanded="true">Hide answer</button></article></div>
	</div><div class="praxity-card-controls"><button type="button" data-card-previous disabled aria-label="Previous slide"></button><button type="button" data-card-dot aria-label="Go to slide 2"></button><span data-card-counter>1 / 2</span><button type="button" data-card-next aria-label="Next slide"></button></div></section>
	<div data-block-id="later" data-node-id="later" hidden><p data-node-id="later-body">Shown by a rule</p></div>`;
	const node = (id: string, kind: "block" | "item", parentId: string, name: string) => ({
		id,
		kind,
		parentId,
		name,
		description: "Block 1 of 1.",
	});
	return {
		...view(),
		nodes: [
			view().nodes[0],
			node("deck", "block", "page", "Cards: Deck"),
			node("one", "item", "deck", "Card 1 of 2: One"),
			node("one-body", "block", "one", "Paragraph: One"),
			node("two", "item", "deck", "Card 2 of 2: Two"),
			node("two-body", "block", "two", "Paragraph: Two"),
			node("later", "block", "page", "Paragraph: Shown by a rule"),
			node("later-body", "block", "later", "Paragraph: Shown by a rule"),
		],
	} satisfies FrameView;
};

it("F1 F5 lays later card slides open so their handles stay in the Tab order", () => {
	const lens = mountPageLens({ document, view: revealFixture(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	const slide = document.querySelector<HTMLElement>('[data-slide-index="1"]');
	for (const id of ["two", "two-body"]) {
		expect(handle(id)?.hidden).toBe(false);
		expect(lens.focus({ ...target, nodeId: id })).toBe(true);
		expect(document.activeElement).toBe(handle(id));
		expect(handle(id)?.getAttribute("aria-label")).toBeTruthy();
	}
	expect(slide?.hasAttribute("inert")).toBe(false);
	expect(slide?.hasAttribute("aria-hidden")).toBe(false);
	expect(slide?.dataset.active).toBe("true");
	lens.dispose();
	expect(slide?.hasAttribute("inert")).toBe(true);
	expect(slide?.getAttribute("aria-hidden")).toBe("true");
	expect(slide?.dataset.active).toBe("false");
	expect(slide?.dataset.slidePosition).toBe("after");
	expect(slide?.hasAttribute("style")).toBe(false);
});

it("F1 keeps learner-only card controls inert while slides are laid open, restoring them on disposal", () => {
	const lens = mountPageLens({ document, view: revealFixture(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	const controls = document.querySelector<HTMLElement>(".praxity-card-controls");
	const flip = document.querySelector<HTMLElement>("[data-card-flip]");
	// Laid open, the flip button is otherwise exposed; the controls always were.
	expect(flip?.closest("[inert],[aria-hidden='true']")).toBe(flip);
	expect(controls?.hasAttribute("inert")).toBe(true);
	lens.dispose();
	expect(controls?.hasAttribute("inert")).toBe(false);
	expect(flip?.hasAttribute("inert")).toBe(false);
});

it("F1 stacks laid-open slides without dropping their inline style, restoring it exactly", () => {
	const nodes = revealFixture();
	const slide = document.querySelector<HTMLElement>('[data-slide-index="1"]');
	slide?.setAttribute("style", "--i:1; --praxity-stagger-index:1");
	const lens = mountPageLens({ document, view: nodes, onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(slide?.style.getPropertyValue("--i")).toBe("1");
	expect(slide?.style.getPropertyValue("--praxity-stagger-index")).toBe("1");
	expect(slide?.style.getPropertyValue("grid-area")).toBe("auto");
	lens.refresh();
	expect(slide?.style.getPropertyValue("--i")).toBe("1");
	lens.dispose();
	expect(slide?.getAttribute("style")).toBe("--i:1; --praxity-stagger-index:1");
});

it("F1 F5 shows conditional blocks and their children, restoring them on disposal", () => {
	const lens = mountPageLens({ document, view: revealFixture(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	const block = document.querySelector<HTMLElement>('[data-block-id="later"]');
	expect(block?.hidden).toBe(false);
	for (const id of ["later", "later-body"]) {
		expect(handle(id)?.hidden).toBe(false);
		expect(lens.focus({ ...target, nodeId: id })).toBe(true);
	}
	// A patch that replaces the block with its hidden server form is laid open again.
	block?.setAttribute("hidden", "");
	lens.refresh();
	expect(block?.hidden).toBe(false);
	lens.dispose();
	expect(block?.hidden).toBe(true);
});

it("F1 measures a display:contents node, such as a matching pair, by its contents", () => {
	fixture();
	const text = document.querySelector<HTMLElement>('p[data-node-id="text"]');
	if (!text) throw new Error("Missing fixture text");
	// Browsers give a display:contents element an empty box of its own.
	text.style.display = "contents";
	vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
		this: HTMLElement,
	) {
		if (this === text) return new DOMRect(0, 0, 0, 0);
		return this.dataset.praxityChrome === "geometry"
			? new DOMRect(0, 0, 100, 100)
			: new DOMRect(100, 100, 400, 100);
	});
	// jsdom has no Range layout; the browser spec measures real matching pairs.
	const contents = vi.fn(() => new DOMRect(100, 100, 400, 40));
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		configurable: true,
		value: contents,
	});
	disposers.push(() => Reflect.deleteProperty(Range.prototype, "getBoundingClientRect"));
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(contents).toHaveBeenCalled();
	expect(handle("text")?.hidden).toBe(false);
	expect(lens.focus(target)).toBe(true);
});

it("F5 refuses focus and hides the handle when its node has no rendered box", () => {
	fixture();
	const text = document.querySelector<HTMLElement>('p[data-node-id="text"]');
	if (!text) throw new Error("Missing fixture text");
	const box = vi
		.spyOn(text, "getBoundingClientRect")
		.mockReturnValue(new DOMRect(100, 100, 400, 0));
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(handle("text")?.hidden).toBe(true);
	expect(lens.focus(target)).toBe(false);
	expect(document.activeElement).toBe(document.body);
	box.mockReturnValue(new DOMRect(100, 100, 400, 100));
	lens.refresh();
	expect(handle("text")?.hidden).toBe(false);
	expect(lens.focus(target)).toBe(true);
});

it("reserves a stable inspection gutter and restores the course padding on disposal", () => {
	fixture();
	vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
		this: HTMLElement,
	) {
		return this.dataset.praxityChrome === "geometry"
			? new DOMRect(0, 0, 100, 100)
			: new DOMRect(52, 100, 400, 100);
	});
	const padding = document.body.style.paddingInlineStart;
	document.body.style.paddingInlineStart = "52px";
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	try {
		expect(document.body.style.paddingInlineStart).toBe("60px");
		lens.render({ ...view(), alwaysShowHandles: true });
		lens.refresh();
		expect(document.body.style.paddingInlineStart).toBe("60px");
	} finally {
		lens.dispose();
		expect(document.body.style.paddingInlineStart).toBe("52px");
		document.body.style.paddingInlineStart = padding;
	}
});

it("F11 places handles inside a focusable learner container such as the main landmark", () => {
	fixture();
	// Compiled pages give main tabindex="-1" as the skip-link target; carousels are tabbable too.
	document.body.innerHTML = `<main tabindex="-1">${document.body.innerHTML}</main>`;
	vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
		this: HTMLElement,
	) {
		if (this.dataset.praxityChrome === "geometry") return new DOMRect(0, 0, 100, 100);
		return this.tagName === "MAIN"
			? new DOMRect(40, 0, 600, 1000)
			: new DOMRect(100, 100, 400, 100);
	});
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(handle("text")?.hidden).toBe(false);
	expect(lens.focus(target)).toBe(true);
});

it("F2 reports logical focus", () => {
	fixture();
	const onEvent = vi.fn();
	const lens = mountPageLens({ document, view: view(), onEvent });
	disposers.push(lens.dispose);
	handle("text")?.focus();
	expect(onEvent).toHaveBeenCalledWith({ event: "focusChanged", focus: target });
});
it.each(["geometry", "popup"] as const)(
	"keeps caller-owned %s markers outside learner attribute restoration",
	(kind) => {
		fixture();
		const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
		const chrome = document.createElement("span");
		lens.registerChrome(chrome, kind);
		expect(chrome.getAttribute("data-praxity-chrome")).toBe(kind);
		lens.dispose();
		expect(chrome.getAttribute("data-praxity-chrome")).toBe(kind);
	},
);

it("F6 F9 keeps bridge-owned handles during a node patch and restores only lost frame focus", () => {
	fixture();
	const lens = mountPageLens({ document, view: { ...view(), focus: target }, onEvent: vi.fn() });
	disposers.push(lens.dispose);
	lens.focus(target);
	const before = handle("text");
	const node = before?.nextElementSibling;
	if (!node) throw new Error("Missing fixture node");
	node.outerHTML = '<p data-node-id="text">Patched body</p>';
	lens.refresh();
	expect(handle("text")).toBe(before);
	expect(document.activeElement).toBe(before);
	handle("text")?.remove();
	lens.refresh();
	expect(handle("text")).not.toBe(before);
	expect(document.activeElement).toBe(handle("text"));
	handle("second")?.focus();
	lens.refresh();
	expect(document.activeElement).toBe(handle("second"));
});

it("F9 background renders and initial mounting never claim focus", () => {
	fixture();
	const lens = mountPageLens({ document, view: { ...view(), focus: target }, onEvent: vi.fn() });
	disposers.push(lens.dispose);
	expect(document.activeElement).toBe(document.body);
	lens.render({ ...view(), selected: ["text"], expanded: ["text"], focus: target });
	expect(document.activeElement).toBe(document.body);
	expect(handle("text")?.getAttribute("aria-expanded")).toBe("true");
});

it("F6 restores the most recently reported target while the controller render is in transit", () => {
	fixture();
	const lens = mountPageLens({ document, view: { ...view(), focus: target }, onEvent: vi.fn() });
	disposers.push(lens.dispose);
	handle("second")?.focus();
	handle("second")?.remove();
	lens.refresh();
	expect(document.activeElement).toBe(handle("second"));
});

it("F9 leaves intentional body focus alone while the previous handle still exists", () => {
	fixture();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	handle("text")?.focus();
	handle("text")?.blur();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
	lens.render({ ...view(), selected: ["text"], focus: target });
	expect(document.activeElement).toBe(document.body);
});

it("F3 descriptions keep valid references even when a supplied node ID contains whitespace", () => {
	fixture();
	const text = document.querySelector<HTMLElement>('p[data-node-id="text"]');
	if (!text) throw new Error("Missing fixture text");
	text.dataset.nodeId = "text space";
	const next = {
		...view(),
		nodes: view().nodes.map((node) => ({
			...node,
			id: node.id === "text" ? "text space" : node.id,
		})),
	};
	const lens = mountPageLens({ document, view: next, onEvent: vi.fn() });
	disposers.push(lens.dispose);
	const descriptionId = handle("text space")?.getAttribute("aria-describedby");
	expect(descriptionId).not.toMatch(/\s/u);
	expect(document.getElementById(descriptionId ?? "")?.textContent).toBe("Block 1 of 1.");
});

it("F6 source targets preserve the controller caret through the public frame view and focus effect", () => {
	fixture();
	const source = document.createElement("textarea");
	source.dataset.praxityChrome = "source";
	source.dataset.nodeId = "text";
	source.dataset.focusRole = "source";
	source.value = "Some source text";
	document.body.append(source);
	const onEvent = vi.fn();
	const lens = mountPageLens({ document, view: view(), onEvent });
	disposers.push(lens.dispose);
	lens.registerControl(source, { ...target, role: "source" });
	expect(lens.focus({ ...target, role: "source", selection: [2, 6] })).toBe(true);
	expect([source.selectionStart, source.selectionEnd]).toEqual([2, 6]);
	expect(onEvent).toHaveBeenLastCalledWith({
		event: "focusChanged",
		focus: { ...target, role: "source", selection: [2, 6] },
	});
	const lesson = readLesson("# Example\n\nBody.\n");
	const pageId = lesson.pages[0].id;
	const session = createSession();
	session.focus = { file: "lesson.prax", nodeId: pageId, role: "source", selection: [2, 6] };
	const t = createTranslator({ locale: "en", messages: en });
	const built = buildFrameView({ lesson, file: "lesson.prax", pageId, session, translate: t });
	expect(
		isFrameCommand(
			{
				source: "praxity-editor",
				version: 1,
				channel: identity.channel,
				pageId,
				action: "render",
				view: built,
			},
			{ ...identity, pageId },
		),
	).toBe(true);
	expect(built.focus?.selection).toEqual([2, 6]);
});

it.each([false, true])("F10 focused source owns its native caret, shadow root %s", (shadow) => {
	fixture();
	const host = document.createElement("div");
	document.body.append(host);
	const source = document.createElement("textarea");
	source.dataset.praxityChrome = "source";
	source.dataset.nodeId = "text";
	source.dataset.focusRole = "source";
	source.value = "Some source text";
	(shadow ? host.attachShadow({ mode: "open" }) : host).append(source);
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	lens.registerControl(source, { ...target, role: "source" });
	expect(lens.focus({ ...target, role: "source", selection: [2, 6] })).toBe(true);
	source.setSelectionRange(8, 12, "backward");
	expect(lens.focus({ ...target, role: "source", selection: [2, 6] })).toBe(true);
	expect([source.selectionStart, source.selectionEnd, source.selectionDirection]).toEqual([
		8,
		12,
		"backward",
	]);
	source.blur();
	expect(lens.focus({ ...target, role: "source", selection: [1, 3] })).toBe(true);
	expect([source.selectionStart, source.selectionEnd]).toEqual([1, 3]);
});

it("F6 restores a source caret after its control is replaced", () => {
	fixture();
	const source = document.createElement("textarea");
	source.dataset.praxityChrome = "source";
	source.dataset.nodeId = "text";
	source.dataset.focusRole = "source";
	source.value = "Some source text";
	document.body.append(source);
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	disposers.push(lens.dispose);
	lens.registerControl(source, { ...target, role: "source" });
	lens.focus({ ...target, role: "source", selection: [2, 6] });
	source.setSelectionRange(4, 8);
	const replacement = source.cloneNode(true) as HTMLTextAreaElement;
	source.replaceWith(replacement);
	// Cloning trusted markup does not clone its admission.
	expect(lens.focus({ ...target, role: "source", selection: [4, 8] })).toBe(false);
	lens.registerControl(replacement, { ...target, role: "source" });
	lens.refresh();
	expect(document.activeElement).toBe(replacement);
	expect([replacement.selectionStart, replacement.selectionEnd]).toEqual([4, 8]);
});

it("inspection bridge refuses learner pages, window commands and wrong-channel or malformed port commands", async () => {
	fixture();
	const original = window.location.href;
	window.history.replaceState(null, "", "?praxity-inspect=0");
	expect(
		startInspectionFrame({
			window: nativeMessageWindow(window),
			parentOrigin: "https://studio.test",
			...identity,
		}),
	).toBeNull();
	window.history.replaceState(null, "", "?praxity-inspect=1");
	const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
	const bridge = startInspectionFrame({
		window: nativeMessageWindow(window),
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!bridge) throw new Error("Inspection bridge missing");
	disposers.push(bridge.dispose);
	const transferred = send.mock.calls[0][2];
	if (!Array.isArray(transferred) || !(transferred[0] instanceof MessagePort))
		throw new Error("Missing bridge port");
	const events: unknown[] = [];
	const port = transferred[0];
	port.onmessage = (event: MessageEvent) => events.push(event.data);
	port.start();
	disposers.push(() => port.close());
	const command = {
		source: "praxity-editor",
		version: 1,
		...identity,
		action: "render",
		view: view(),
	};
	// Window messages carry no command, even from the editor's exact origin and parent window.
	window.dispatchEvent(
		new MessageEvent("message", {
			data: command,
			origin: "https://studio.test",
			source: window.parent,
		}),
	);
	const deliver = (data: unknown) => port.postMessage(data);
	deliver({ ...command, channel: "wrong" });
	deliver({ ...command, view: { ...view(), nodes: [{ id: "bad" }] } });
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(document.querySelectorAll('[data-praxity-chrome="handle"]')).toHaveLength(0);
	deliver(command);
	await vi.waitFor(() => expect(handle("text")).not.toBeNull());
	deliver({
		source: "praxity-editor",
		version: 1,
		...identity,
		action: "focus",
		requestId: 1,
		target: { ...target, nodeId: "absent" },
	});
	await vi.waitFor(() =>
		expect(events).toContainEqual(
			expect.objectContaining({ event: "missing", nodeIds: ["absent"] }),
		),
	);
	expect(send).toHaveBeenCalledWith(
		expect.objectContaining({ event: "ready" }),
		"https://studio.test",
		[expect.anything()],
	);
	window.history.replaceState(null, "", original);
});

it.each([
	{ frames: 1, lag: false },
	{ frames: 2, lag: false },
	{ frames: 2, lag: true },
])(
	"inspection bridge retries refused focus across $frames rendering opportunities, focus lag $lag",
	async ({ frames, lag }) => {
		fixture();
		const original = window.location.href;
		window.history.replaceState(null, "", "?praxity-inspect=1");
		const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
		const bridge = startInspectionFrame({
			window: nativeMessageWindow(window),
			parentOrigin: "https://studio.test",
			...identity,
		});
		if (!bridge) throw new Error("Inspection bridge missing");
		disposers.push(bridge.dispose);
		const port = send.mock.calls[0][2]?.[0];
		if (!(port instanceof MessagePort)) throw new Error("Missing bridge port");
		const events: { event?: string; success?: boolean }[] = [];
		port.onmessage = (event: MessageEvent) => events.push(event.data);
		disposers.push(() => port.close());
		const command = { source: "praxity-editor", version: 1, ...identity };
		port.postMessage({ ...command, action: "render", view: view() });
		await vi.waitFor(() => expect(handle("text")).not.toBeNull());
		// WebKit can refuse focus for multiple tasks before its next rendering opportunity.
		const nativeFocus = HTMLElement.prototype.focus;
		let acceptsFocus = false;
		let entering = false;
		vi.spyOn(document, "hasFocus").mockImplementation(() => !lag || acceptsFocus);
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
			this: HTMLElement,
			...args
		) {
			if (!acceptsFocus) {
				if (!entering) {
					entering = true;
					void (async () => {
						for (let i = 0; i < frames; i++)
							await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
						setTimeout(() => {
							acceptsFocus = true;
						}, 0);
					})();
				}
				return;
			}
			nativeFocus.apply(this, args);
		});
		port.postMessage({ ...command, action: "focus", requestId: 1, target });
		await vi.waitFor(() =>
			expect(events).toContainEqual(expect.objectContaining({ event: "focusResult" })),
		);
		expect(events.filter(({ event }) => event === "focusResult")).toEqual([
			expect.objectContaining({ success: true }),
		]);
		expect(events).not.toContainEqual(expect.objectContaining({ event: "missing" }));
		expect(document.activeElement).toBe(handle("text"));
		window.history.replaceState(null, "", original);
	},
);

it.each(["left frame", "expired", "tabbed"])(
	"inspection bridge cancels refused focus when %s",
	async (reason) => {
		fixture();
		const original = window.location.href;
		window.history.replaceState(null, "", "?praxity-inspect=1");
		const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
		const bridge = startInspectionFrame({
			window: nativeMessageWindow(window),
			parentOrigin: "https://studio.test",
			...identity,
		});
		if (!bridge) throw new Error("Inspection bridge missing");
		disposers.push(bridge.dispose);
		const port = send.mock.calls[0][2]?.[0];
		if (!(port instanceof MessagePort)) throw new Error("Missing bridge port");
		const events: { event?: string; success?: boolean }[] = [];
		port.onmessage = (event: MessageEvent) => events.push(event.data);
		disposers.push(() => port.close());
		const command = { source: "praxity-editor", version: 1, ...identity };
		port.postMessage({ ...command, action: "render", view: view() });
		await vi.waitFor(() => expect(handle("text")).not.toBeNull());
		const outside = document.createElement("button");
		document.body.append(outside);
		outside.focus();
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementationOnce(() => {});
		vi.spyOn(document, "hasFocus")
			.mockReturnValueOnce(true)
			.mockReturnValue(reason !== "left frame");
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(0)
			.mockReturnValue(reason === "expired" ? 5000 : 0);
		port.postMessage({ ...command, action: "focus", requestId: 1, target });
		if (reason === "tabbed") {
			const next = document.createElement("button");
			document.body.append(next);
			setTimeout(() => next.focus(), 0);
		}
		await vi.waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({ event: "focusResult", success: false }),
			),
		);
		if (reason === "tabbed") expect(document.activeElement).toBe(outside.nextElementSibling);
		else expect(document.activeElement).toBe(outside);
		window.history.replaceState(null, "", original);
	},
);

it("inspection bridge drops a refused focus retry once a newer focus arrives", async () => {
	fixture();
	const original = window.location.href;
	window.history.replaceState(null, "", "?praxity-inspect=1");
	const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
	const bridge = startInspectionFrame({
		window: nativeMessageWindow(window),
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!bridge) throw new Error("Inspection bridge missing");
	disposers.push(bridge.dispose);
	const port = send.mock.calls[0][2]?.[0];
	if (!(port instanceof MessagePort)) throw new Error("Missing bridge port");
	const events: { event?: string; success?: boolean; focus?: { nodeId: string } }[] = [];
	port.onmessage = (event: MessageEvent) => events.push(event.data);
	disposers.push(() => port.close());
	const command = { source: "praxity-editor", version: 1, ...identity };
	port.postMessage({ ...command, action: "render", view: view() });
	await vi.waitFor(() => expect(handle("tabs")).not.toBeNull());
	// WebKit refuses the first focus; the host then asks for a different node.
	vi.spyOn(HTMLElement.prototype, "focus").mockImplementationOnce(() => {});
	port.postMessage({ ...command, action: "focus", requestId: 1, target });
	port.postMessage({
		...command,
		action: "focus",
		requestId: 2,
		target: { ...target, nodeId: "tabs" },
	});
	await vi.waitFor(() =>
		expect(events).toContainEqual(expect.objectContaining({ event: "focusResult" })),
	);
	await new Promise((resolve) => window.requestAnimationFrame(() => setTimeout(resolve, 0)));
	expect(
		events
			.filter(({ event }) => event === "focusResult")
			.map(({ focus, success }) => [focus?.nodeId, success]),
	).toEqual([["tabs", true]]);
	expect(document.activeElement).toBe(handle("tabs"));
	window.history.replaceState(null, "", original);
});

it("typed bridge validates exact commands and events, including nested targets", () => {
	const command = {
		source: "praxity-editor",
		version: 1,
		...identity,
		action: "render",
		view: view(),
	};
	expect(isFrameCommand(command, identity)).toBe(true);
	expect(isFrameCommand({ ...command, surprise: 1 }, identity)).toBe(false);
	expect(
		isFrameCommand(
			{ ...command, view: { ...view(), focus: { ...target, role: "script" } } },
			identity,
		),
	).toBe(false);
	const event = {
		source: "praxity-frame",
		version: 1,
		...identity,
		event: "focusChanged",
		presentationId: 0,
		focus: target,
	};
	expect(isFrameEvent(event, identity)).toBe(true);
	expect(isFrameEvent({ ...event, focus: { ...target, nodeId: 12 } }, identity)).toBe(false);
	expect(isFrameCommand({ ...command, view: { ...view(), language: ["en"] } }, identity)).toBe(
		false,
	);
	expect(
		isFrameCommand(
			{
				...command,
				view: { ...view(), nodes: view().nodes.map((node) => ({ ...node, kind: [node.kind] })) },
			},
			identity,
		),
	).toBe(false);
});

it("F1 refuses direct Page lens mounting outside inspection mode", () => {
	fixture();
	window.history.replaceState(null, "", "?praxity-inspect=0");
	expect(() => mountPageLens({ document, view: view(), onEvent: vi.fn() })).toThrow("inspection");
	window.history.replaceState(null, "", "?praxity-inspect=1");
});

it("F6 host replays the controller view after a swap and explicitly restores only frame-owned focus", async () => {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	const onEvent = vi.fn();
	const send = vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(() => {});
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "https://course.test",
		...identity,
		view: { ...view(), focus: target },
		onEvent,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	const swapped = new MessageChannel();
	disposers.push(() => {
		for (const port of [ports.port1, ports.port2, swapped.port1, swapped.port2]) port.close();
	});
	const commands: { action?: string }[] = [];
	ports.port2.onmessage = (event) => commands.push(event.data);
	const ready = { source: "praxity-frame", version: 1, ...identity, event: "ready" };
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "https://evil.test",
			source: frame.contentWindow,
			data: ready,
			ports: [ports.port1],
		}),
	);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "https://course.test",
			source: frame.contentWindow,
			data: ready,
			ports: [ports.port1],
		}),
	);
	await vi.waitFor(() => expect(commands.map(({ action }) => action)).toEqual(["render"]));
	frame.focus();
	const channel = bridge.prepareSwap();
	const replayed: unknown[] = [];
	swapped.port2.onmessage = (event) => replayed.push(event.data);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "https://course.test",
			source: frame.contentWindow,
			data: { ...ready, channel },
			ports: [swapped.port1],
		}),
	);
	await vi.waitFor(() =>
		expect(replayed).toContainEqual(
			expect.objectContaining({ action: "focus", requestId: 1, target }),
		),
	);
	expect(send).not.toHaveBeenCalled();
});

it.each(["en", "fr"] as const)(
	"F3 A3 builds names and draft descriptions from the existing owners in %s",
	(language) => {
		const lesson = readLesson(
			"# Example\n\n::: accordion\n:: First\n\nBody.\n\n:: Second\n\nOther body.\n:::\n",
		);
		const pageId = lesson.pages[0].id;
		const session = createSession({ interfaceLanguage: language });
		const t = createTranslator({
			locale: language,
			messages: language === "en" ? en : fr,
			onError: (error) => {
				throw error;
			},
		});
		const built = buildFrameView({ lesson, file: "lesson.prax", pageId, session, translate: t });
		expect(built.nodes.find((node) => node.kind === "item")?.name).toBe(
			language === "en" ? "Panel 1 of 2: First" : "Panneau 1 sur 2 : First",
		);
		expect(built.nodes[0]?.name).toContain("Example");
		expect(built.nodes.some((node) => node.description.includes("undefined"))).toBe(false);
	},
);

it("disposal removes chrome and restores learner attributes", () => {
	fixture();
	const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
	lens.dispose();
	expect(document.querySelector("[data-praxity-chrome]")).toBeNull();
	expect(document.querySelector("a")?.hasAttribute("tabindex")).toBe(false);
	expect(document.querySelector("h1")?.hasAttribute("data-node-id")).toBe(false);
});
it("07t suspend before ready clears queued focus without revoking the document", async () => {
	const frame = document.createElement("iframe");
	const opener = document.createElement("button");
	document.body.append(frame, opener);
	opener.focus();
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent,
	});
	disposers.push(bridge.dispose);
	const result = bridge.focus(target);
	bridge.suspend();
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	const commands: { action?: string }[] = [];
	ports.port2.onmessage = (event) => commands.push(event.data);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	bridge.refresh();
	await vi.waitFor(() =>
		expect(commands).toContainEqual(expect.objectContaining({ action: "refresh" })),
	);
	expect(commands.filter(({ action }) => action === "focus")).toEqual([]);
	expect(await result).toBe(false);
	expect(onEvent).toHaveBeenCalledOnce();
	expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "ready" }));
});

it.each(["animation frame", "task"])(
	"07t suspend cancels the inspection focus retry at its %s boundary even after resume",
	async (boundary) => {
		fixture();
		const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
		const inspection = startInspectionFrame({
			window: nativeMessageWindow(window),
			parentOrigin: "https://studio.test",
			...identity,
		});
		if (!inspection) throw new Error("Missing inspection frame");
		disposers.push(inspection.dispose);
		const port = send.mock.calls[0][2]?.[0];
		if (!(port instanceof MessagePort)) throw new Error("Missing bridge port");
		disposers.push(() => port.close());
		const events: { event?: string }[] = [];
		port.onmessage = (event: MessageEvent) => events.push(event.data);
		const command = { source: "praxity-editor", version: 1, ...identity };
		port.postMessage({ ...command, action: "render", view: view() });
		await vi.waitFor(() => expect(handle("text")).not.toBeNull());
		const retries: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			retries.push(callback);
			return retries.length;
		});
		const nativeFocus = HTMLElement.prototype.focus;
		let resumed = false;
		let lateFocus = 0;
		const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
			this: HTMLElement,
			...args
		) {
			if (!resumed) return;
			lateFocus++;
			nativeFocus.apply(this, args);
		});
		port.postMessage({ ...command, action: "focus", requestId: 1, target });
		await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
		const retry = retries.at(-1);
		if (!retry) throw new Error("Missing deferred focus");
		const tasks: (() => void)[] = [];
		if (boundary === "task") {
			const nativeTimeout = globalThis.setTimeout;
			vi.spyOn(globalThis, "setTimeout").mockImplementation(((
				callback: () => void,
				delay: number,
				...args: unknown[]
			) => {
				if (delay === 0) {
					tasks.push(callback);
					return 0;
				}
				return nativeTimeout(callback, delay, ...args);
			}) as typeof setTimeout);
			retry(0);
			expect(tasks).toHaveLength(1);
		}
		const heights = events.filter(({ event }) => event === "height").length;
		port.postMessage({ ...command, action: "suspend" });
		port.postMessage({
			...command,
			action: "resume",
			presentationId: 1,
			view: { ...view(), focus: null },
		});
		await vi.waitFor(() =>
			expect(events.filter(({ event }) => event === "height")).toHaveLength(heights + 1),
		);
		resumed = true;
		if (boundary === "task") tasks[0]();
		else retry(0);
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		if (boundary === "animation frame")
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(lateFocus).toBe(0);
		expect(events).not.toContainEqual(expect.objectContaining({ event: "focusResult" }));
	},
);

it("07t same-target pre-suspend focus acknowledgement cannot settle the resumed request", async () => {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	frame.focus();
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	const commands: { action: string; requestId: number }[] = [];
	ports.port2.onmessage = (event) => commands.push(event.data);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	const oldResult = bridge.focus(target);
	await vi.waitFor(() =>
		expect(commands.filter(({ action }) => action === "focus")).toHaveLength(1),
	);
	const old = commands.find(({ action }) => action === "focus");
	if (!old) throw new Error("Missing old request");
	bridge.suspend();
	bridge.resume(view());
	frame.focus();
	const settled = vi.fn();
	const result = bridge.focus(target).then(settled);
	await vi.waitFor(() =>
		expect(commands.filter(({ action }) => action === "focus")).toHaveLength(2),
	);
	const current = commands.filter(({ action }) => action === "focus")[1];
	if (!current) throw new Error("Missing resumed request");
	const reply = (request: typeof old) =>
		ports.port2.postMessage({
			source: "praxity-frame",
			version: 1,
			...identity,
			event: "focusResult",
			presentationId: request.requestId === old.requestId ? 0 : 1,
			focus: target,
			success: true,
			requestId: request.requestId,
		});
	reply(old);
	ports.port2.postMessage({
		source: "praxity-frame",
		version: 1,
		...identity,
		event: "height",
		height: 17,
	});
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "height", height: 17 })),
	);
	expect(settled).not.toHaveBeenCalled();
	expect(await oldResult).toBe(false);
	reply(current);
	await result;
	expect(settled).toHaveBeenCalledExactlyOnceWith(true);
});

it("07t native inspection input is suspended then resumes on its original port", async () => {
	fixture();
	const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
	const inspection = startInspectionFrame({
		window: nativeMessageWindow(window),
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!inspection) throw new Error("Missing inspection");
	disposers.push(inspection.dispose);
	const port = send.mock.calls[0][2]?.[0];
	if (!(port instanceof MessagePort)) throw new Error("Missing port");
	disposers.push(() => port.close());
	const events: { event?: string }[] = [];
	port.onmessage = (event: MessageEvent) => events.push(event.data);
	const command = { source: "praxity-editor", version: 1, ...identity };
	port.postMessage({ ...command, action: "render", view: view() });
	await vi.waitFor(() => expect(handle("text")).not.toBeNull());
	const originalHandle = handle("text");
	const heights = events.filter(({ event }) => event === "height").length;
	port.postMessage({ ...command, action: "suspend" });
	const paintBarrier = async (seq: number) => {
		port.postMessage({
			...command,
			action: "nodes",
			render: { seq, pageId: "page", fragments: [] },
		});
		await vi.waitFor(() =>
			expect(events).toContainEqual(expect.objectContaining({ event: "painted", seq })),
		);
	};
	await paintBarrier(1);
	originalHandle?.focus();
	await paintBarrier(2);
	expect(events.filter(({ event }) => event === "focusChanged")).toEqual([]);
	// Document work and its paint observation continue on the suspended port.
	const resumeHeights = events.filter(({ event }) => event === "height").length;
	expect(resumeHeights).toBeGreaterThan(heights);
	port.postMessage({ ...command, action: "resume", presentationId: 1, view: view() });
	await vi.waitFor(() =>
		expect(events.filter(({ event }) => event === "height")).toHaveLength(resumeHeights + 1),
	);
	expect(handle("text")).toBe(originalHandle);
	handle("tabs")?.focus();
	await vi.waitFor(() =>
		expect(events).toContainEqual(
			expect.objectContaining({ event: "focusChanged", focus: { ...target, nodeId: "tabs" } }),
		),
	);
	expect(events.filter(({ event }) => event === "unloading")).toEqual([]);
	expect(send).toHaveBeenCalledOnce();
});

it("07t suspended document still reports unloading to its revocation owner", async () => {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	const onEvent = vi.fn((event: { event: string }) => {
		if (event.event === "unloading") bridge.dispose();
	});
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	const commands: { action?: string }[] = [];
	ports.port2.onmessage = (event) => commands.push(event.data);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	bridge.suspend();
	ports.port2.postMessage({ source: "praxity-frame", version: 1, ...identity, event: "unloading" });
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "unloading" })),
	);
	const readyCount = onEvent.mock.calls.filter(([event]) => event.event === "ready").length;
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	expect(onEvent.mock.calls.filter(([event]) => event.event === "ready")).toHaveLength(readyCount);
});

it("07t suspended host refuses native port input and focus until the latest view binds", async () => {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	frame.focus();
	const onEvent = vi.fn();
	const onEscape = vi.fn(() => true);
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent,
		onEscape,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	bridge.suspend();
	expect(await bridge.focus(target)).toBe(false);
	onEvent.mockClear();
	const send = (body: object) =>
		ports.port2.postMessage({
			source: "praxity-frame",
			version: 1,
			...identity,
			presentationId: 0,
			...body,
		});
	send({ event: "select", focus: target, mode: "single" });
	send({ event: "escape" });
	ports.port2.postMessage({
		source: "praxity-frame",
		version: 1,
		...identity,
		event: "height",
		height: 23,
	});
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "height", height: 23 })),
	);
	expect(onEvent).toHaveBeenCalledOnce();
	bridge.resume(view());
	send({ event: "select", focus: target, mode: "single", presentationId: 1 });
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event: "select", focus: target, mode: "single" }),
		),
	);
});

it("07t protocol requires exact suspend commands and safe focus request tokens", () => {
	const command = { source: "praxity-editor", version: 1, ...identity };
	const event = { source: "praxity-frame", version: 1, ...identity, presentationId: 0 };
	expect(isFrameCommand({ ...command, action: "suspend" }, identity)).toBe(true);
	expect(isFrameCommand({ ...command, action: "suspend", target }, identity)).toBe(false);
	expect(isFrameCommand({ ...command, action: "focus", target, requestId: 7 }, identity)).toBe(
		true,
	);
	expect(
		isFrameEvent(
			{ ...event, event: "focusResult", focus: target, success: true, requestId: 7 },
			identity,
		),
	).toBe(true);
	for (const requestId of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "7"]) {
		expect(isFrameCommand({ ...command, action: "focus", target, requestId }, identity)).toBe(
			false,
		);
		expect(
			isFrameEvent(
				{ ...event, event: "focusResult", focus: target, success: true, requestId },
				identity,
			),
		).toBe(false);
	}
	expect(isFrameCommand({ ...command, channel: "obsolete", action: "suspend" }, identity)).toBe(
		false,
	);
});

function resumePresentation(bridge: ReturnType<typeof connectPageFrame>, next: FrameView) {
	bridge.resume(next);
}

function inspectionPort() {
	fixture();
	const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
	const inspection = startInspectionFrame({
		window: nativeMessageWindow(window),
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!inspection) throw new Error("Missing inspection");
	disposers.push(inspection.dispose);
	const port = send.mock.calls[0][2]?.[0];
	if (!(port instanceof MessagePort)) throw new Error("Missing port");
	disposers.push(() => port.close());
	const events: { event: string; height?: number; seq?: number }[] = [];
	port.onmessage = (event) => events.push(event.data);
	const command = (body: object) =>
		port.postMessage({ source: "praxity-editor", version: 1, ...identity, ...body });
	const render = async (next = view(), action = "render") => {
		const heights = events.filter((event) => event.event === "height").length;
		command({ action, view: next, ...(action === "resume" ? { presentationId: 1 } : {}) });
		await vi.waitFor(() =>
			expect(events.filter((event) => event.event === "height")).toHaveLength(heights + 1),
		);
	};
	const paint = async (seq: number) => {
		command({ action: "nodes", render: { seq, pageId: "page", fragments: [] } });
		await vi.waitFor(() =>
			expect(events).toContainEqual(expect.objectContaining({ event: "painted", seq })),
		);
	};
	return { command, render, paint, events };
}

// jsdom has no trusted keyboard source. Adapt native listener registration only;
// the production trust check and dispatcher still run, alongside real MessagePorts.
function admitTestKeys(win: Window) {
	for (const input of [win, win.document]) {
		const add = input.addEventListener.bind(input);
		const remove = input.removeEventListener.bind(input);
		const listeners = new Map<EventListenerOrEventListenerObject, EventListener>();
		vi.spyOn(input, "addEventListener").mockImplementation((type, receive, options) => {
			if (type !== "keydown" || !receive) return add(type, receive, options);
			const listener: EventListener = (event) => {
				const trusted = new Proxy(event, {
					get(target, key) {
						if (key === "isTrusted") return true;
						const value = Reflect.get(target, key, target);
						return typeof value === "function" ? value.bind(target) : value;
					},
				});
				if (typeof receive === "function") receive(trusted);
				else receive.handleEvent(trusted);
			};
			listeners.set(receive, listener);
			add(type, listener, options);
		});
		vi.spyOn(input, "removeEventListener").mockImplementation((type, receive, options) => {
			remove(type, receive ? (listeners.get(receive) ?? receive) : receive, options);
		});
	}
}

it.each(["suspend then swap", "swap then suspend"])(
	"07t fix %s sends no automatic focus even after explicit resume before ready",
	async (order) => {
		const h = reviewHost();
		h.ready();
		h.bridge.render({ ...view(), focus: target });
		let channel: string;
		if (order === "suspend then swap") {
			h.bridge.suspend();
			h.frame.focus(); // A still-focused suspended frame must not regain authority.
			channel = h.bridge.prepareSwap();
		} else {
			channel = h.bridge.prepareSwap();
			h.bridge.suspend();
		}
		resumePresentation(h.bridge, { ...view(), focus: target });
		h.frame.focus();
		const next = new MessageChannel();
		disposers.push(() => {
			next.port1.close();
			next.port2.close();
		});
		const commands: { action: string }[] = [];
		next.port2.onmessage = (event) => commands.push(event.data);
		h.ready(channel, next.port1);
		h.bridge.refresh();
		await vi.waitFor(() =>
			expect(commands).toContainEqual(expect.objectContaining({ action: "refresh" })),
		);
		expect(commands.filter((command) => command.action === "focus")).toEqual([]);
	},
);

it("07t fix suspended inspection runs no focus command or retry", async () => {
	const h = inspectionPort();
	await h.render();
	h.command({ action: "suspend" });
	await h.render();
	const focus = vi.spyOn(HTMLElement.prototype, "focus");
	const schedule = vi.spyOn(window, "requestAnimationFrame");
	h.command({ action: "focus", target, requestId: 9 });
	await h.render(); // Port order without scheduling a paint.
	expect(focus).not.toHaveBeenCalled();
	expect(schedule).not.toHaveBeenCalled();
});

it("07t fix suspended top-document Escape remains unconsumed until explicit resume", async () => {
	admitTestKeys(window);
	const frame = document.createElement("iframe");
	document.body.append(frame);
	const onEscape = vi.fn(() => true);
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent: vi.fn(),
		onEscape,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [ports.port1],
		}),
	);
	frame.focus();
	bridge.suspend();
	expect(document.activeElement).not.toBe(frame);
	bridge.render(view());
	const key = () => {
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		document.body.dispatchEvent(event);
		return event;
	};
	expect(key().defaultPrevented).toBe(false);
	expect(onEscape).not.toHaveBeenCalled();
	resumePresentation(bridge, view());
	expect(key().defaultPrevented).toBe(true);
	expect(onEscape).toHaveBeenCalledExactlyOnceWith({ type: "escape" });
});

it.each(["Escape", "F6", "F2", "ArrowDown", "Delete"])(
	"07t fix suspended lens does not consume %s even if it keeps focus",
	async (key) => {
		admitTestKeys(window);
		const h = inspectionPort();
		await h.render({ ...view(), escapeEnabled: true });
		const button = handle("text");
		if (!button) throw new Error("Missing handle");
		button.focus();
		h.command({ action: "suspend" });
		await h.render({ ...view(), escapeEnabled: true });
		const event = new KeyboardEvent("keydown", {
			key,
			altKey: key === "F6",
			bubbles: true,
			cancelable: true,
		});
		button.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		await h.render({ ...view(), escapeEnabled: true }, "resume");
		const active = new KeyboardEvent("keydown", {
			key,
			altKey: key === "F6",
			bubbles: true,
			cancelable: true,
		});
		button.dispatchEvent(active);
		expect(active.defaultPrevented).toBe(true);
	},
);

it("07t fix render updates a suspended view without restoring focus or input", async () => {
	const h = inspectionPort();
	await h.render();
	const original = handle("text");
	original?.focus();
	h.command({ action: "suspend" });
	const focus = vi.spyOn(HTMLElement.prototype, "focus");
	await h.render({ ...view(), language: "fr", expanded: ["text"], focus: target });
	expect(original?.getAttribute("lang")).toBe("en");
	expect(original?.getAttribute("aria-expanded")).toBe("false");
	handle("tabs")?.focus();
	focus.mockClear();
	await h.paint(100);
	expect(h.events.filter((event) => event.event === "focusChanged")).toHaveLength(1);
	await h.render({ ...view(), language: "fr", expanded: ["text"], focus: target }, "resume");
	expect(handle("text")).toBe(original);
	expect(original?.getAttribute("lang")).toBe("fr");
	expect(original?.getAttribute("aria-expanded")).toBe("true");
	expect(focus).not.toHaveBeenCalled();
});

it("07t fix suspended observer refresh and remembered focus do not replay on resume", async () => {
	const h = inspectionPort();
	await h.render();
	handle("text")?.focus();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
	h.command({ action: "suspend" });
	await h.render();
	const focus = vi.spyOn(HTMLElement.prototype, "focus");
	handle("text")?.remove();
	await h.paint(101);
	expect(handle("text")).toBeNull();
	expect(focus).not.toHaveBeenCalled();
	await h.render(view(), "resume");
	expect(handle("text")).not.toBeNull();
	expect(focus).not.toHaveBeenCalled();
});

it("07t fix protocol refuses focus commands and results truly missing requestId", () => {
	expect(
		isFrameCommand(
			{ source: "praxity-editor", version: 1, ...identity, action: "focus", target },
			identity,
		),
	).toBe(false);
	expect(
		isFrameEvent(
			{
				source: "praxity-frame",
				version: 1,
				...identity,
				presentationId: 0,
				event: "focusResult",
				focus: target,
				success: true,
			},
			identity,
		),
	).toBe(false);
});

const semanticInputs = [
	{ event: "focusChanged", focus: target },
	{ event: "select", focus: target, mode: "single" },
	{ event: "intent", intent: "source", focus: target },
	{ event: "navigate", direction: "next", extend: false },
	{ event: "escape" },
	{
		event: "region",
		direction: 1,
		key: { key: "F6", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
	},
	{
		event: "shortcut",
		action: "delete",
		focus: target,
		key: { key: "Delete", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
	},
	{ event: "missing", nodeIds: ["text"] },
];
it.each(semanticInputs)(
	"07t fix queued $event before or during suspend cannot enter a fresh presentation",
	async (body) => {
		const h = reviewHost();
		h.ready();
		h.bridge.render({ ...view(), focus: target });
		h.emit(body);
		h.bridge.suspend();
		h.emit(body);
		resumePresentation(h.bridge, { ...view(), focus: target });
		h.frame.focus();
		await h.barrier(110);
		expect(h.onEvent.mock.calls.filter(([event]) => event.event === body.event)).toEqual([]);
		h.emit({ ...body, presentationId: 1 });
		await h.barrier(111);
		expect(h.onEvent.mock.calls.filter(([event]) => event.event === body.event)).toHaveLength(1);
	},
);

it("07t fix host data render does not readmit current-generation native input or focus", async () => {
	const h = reviewHost();
	h.ready();
	h.bridge.suspend();
	h.bridge.render({ ...view(), focus: target });
	h.emit({ event: "focusChanged", focus: target });
	await h.barrier(112);
	expect(h.onEvent.mock.calls.filter(([event]) => event.event === "focusChanged")).toEqual([]);
	expect(await h.bridge.focus(target)).toBe(false);
	resumePresentation(h.bridge, view());
	h.emit({ event: "focusChanged", focus: target, presentationId: 1 });
	await h.barrier(113);
	expect(h.onEvent.mock.calls.filter(([event]) => event.event === "focusChanged")).toHaveLength(1);
});

it("07t fix suspension retains draft admission and fragment revision state", async () => {
	const h = inspectionPort();
	await h.render();
	const original = handle("text");
	h.command({
		action: "beginDraft",
		request: { seq: 1, epoch: 0, transactionId: "draft-1", nodeIds: ["text"] },
	});
	h.command({ action: "suspend" });
	h.command({
		action: "draft",
		epoch: 0,
		render: {
			seq: 1,
			pageId: "page",
			transactionId: "draft-1",
			state: "draft",
			fragments: [{ id: "text", html: '<p data-node-id="text">Draft text</p>' }],
		},
	});
	await h.paint(120);
	expect(document.querySelector('p[data-node-id="text"]')?.textContent).toBe("Draft text");
	h.command({
		action: "nodes",
		render: {
			seq: 10,
			pageId: "page",
			fragments: [{ id: "text", html: '<p data-node-id="text">Saved text</p>' }],
		},
	});
	await h.paint(121);
	expect(document.querySelector('p[data-node-id="text"]')?.textContent).toBe("Draft text");
	h.command({
		action: "draft",
		epoch: 0,
		render: { seq: 1, pageId: "page", transactionId: "draft-1", state: "saved", fragments: [] },
	});
	await h.paint(122);
	expect(document.querySelector('p[data-node-id="text"]')?.textContent).toBe("Draft text");
	await h.render(view(), "resume");
	expect(handle("text")).toBe(original);
	h.command({
		action: "nodes",
		render: {
			seq: 9,
			pageId: "page",
			fragments: [{ id: "text", html: '<p data-node-id="text">Obsolete text</p>' }],
		},
	});
	await h.paint(123);
	expect(document.querySelector('p[data-node-id="text"]')?.textContent).toBe("Draft text");
});

it("07t fix protocol requires exact explicit resume and semantic presentation IDs", () => {
	const command = {
		source: "praxity-editor",
		version: 1,
		...identity,
		action: "resume",
		view: view(),
	};
	const event = {
		source: "praxity-frame",
		version: 1,
		...identity,
		event: "focusChanged",
		focus: target,
	};
	expect(isFrameCommand(command, identity)).toBe(false);
	expect(isFrameEvent(event, identity)).toBe(false);
	expect(isFrameCommand({ ...command, presentationId: 1 }, identity)).toBe(true);
	expect(isFrameEvent({ ...event, presentationId: 1 }, identity)).toBe(true);
	for (const presentationId of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
		expect(isFrameCommand({ ...command, presentationId }, identity)).toBe(false);
		expect(isFrameEvent({ ...event, presentationId }, identity)).toBe(false);
	}
	expect(isFrameEvent({ ...event, presentationId: 1, extra: true }, identity)).toBe(false);
});

it("07t fix suspended document patches still silence learner announcements", async () => {
	const h = inspectionPort();
	await h.render();
	h.command({ action: "suspend" });
	h.command({
		action: "nodes",
		render: {
			seq: 130,
			pageId: "page",
			fragments: [
				{
					id: "text",
					html: '<p data-node-id="text"><span role="status" aria-live="polite">Course announcement</span></p>',
				},
			],
		},
	});
	await h.paint(131);
	expect(document.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("off");
	await h.render(view(), "resume");
	expect(document.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("off");
});

function reviewHost() {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	frame.focus();
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: view(),
		onEvent,
	});
	disposers.push(bridge.dispose);
	const ports = new MessageChannel();
	disposers.push(() => {
		ports.port1.close();
		ports.port2.close();
	});
	const commands: { action: string; requestId: number; target: typeof target }[] = [];
	ports.port2.onmessage = (event) => commands.push(event.data);
	const ready = (channel = "test-channel", port = ports.port1) =>
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "null",
				source: frame.contentWindow,
				data: { source: "praxity-frame", version: 1, channel, pageId: "page", event: "ready" },
				ports: [port],
			}),
		);
	const emit = (body: object) =>
		ports.port2.postMessage({
			presentationId: 0,
			source: "praxity-frame",
			version: 1,
			...identity,
			...body,
		});
	const barrier = async (height: number) => {
		ports.port2.postMessage({
			source: "praxity-frame",
			version: 1,
			...identity,
			event: "height",
			height,
		});
		await vi.waitFor(() =>
			expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "height", height })),
		);
	};
	return { frame, bridge, ports, commands, ready, emit, barrier, onEvent };
}

it("07t fix double suspend between focus and ready then resume accepts first fresh focus", async () => {
	const h = reviewHost();
	const old = h.bridge.focus(target);
	h.bridge.suspend();
	h.bridge.suspend();
	h.ready();
	await vi.waitFor(() => expect(h.commands.map((c) => c.action)).toEqual(["suspend", "render"]));
	expect(await old).toBe(false);
	resumePresentation(h.bridge, view());
	h.frame.focus();
	const result = h.bridge.focus(target);
	await vi.waitFor(() => expect(h.commands.filter((c) => c.action === "focus")).toHaveLength(1));
	expect(h.commands.find((c) => c.action === "focus")?.requestId).toBe(2);
	h.emit({ event: "focusResult", focus: target, success: true, requestId: 2, presentationId: 1 });
	expect(await result).toBe(true);
});

it("07t fix render without suspend and token plus target matching", async () => {
	const h = reviewHost();
	h.ready();
	h.bridge.render(view());
	const old = h.bridge.focus(target);
	const settled = vi.fn();
	const result = h.bridge.focus(target).then(settled);
	await vi.waitFor(() => expect(h.commands.filter((c) => c.action === "focus")).toHaveLength(2));
	expect(await old).toBe(false);
	h.emit({ event: "focusResult", focus: target, success: true, requestId: 1 });
	for (const focus of [
		{ ...target, nodeId: "tabs" },
		{ ...target, file: "other.prax" },
		{ ...target, role: "source" },
	])
		h.emit({ event: "focusResult", focus, success: true, requestId: 2 });
	await h.barrier(81);
	expect(settled).not.toHaveBeenCalled();
	h.emit({ event: "focusResult", focus: target, success: true, requestId: 2 });
	await result;
	expect(settled).toHaveBeenCalledExactlyOnceWith(true);
});

it("07t fix suspend during pending swap prevents automatic restoration", async () => {
	const h = reviewHost();
	h.ready();
	const old = h.bridge.focus(target);
	h.bridge.render({ ...view(), focus: target });
	const channel = h.bridge.prepareSwap();
	h.bridge.suspend();
	h.bridge.suspend();
	const next = new MessageChannel();
	disposers.push(() => {
		next.port1.close();
		next.port2.close();
	});
	const commands: { action: string }[] = [];
	next.port2.onmessage = (event) => commands.push(event.data);
	h.ready(channel, next.port1);
	await vi.waitFor(() => expect(commands.map((c) => c.action)).toEqual(["suspend", "render"]));
	expect(await old).toBe(false);
});

it("07t fix swap restoration receives a fresh token", async () => {
	const h = reviewHost();
	h.ready();
	h.bridge.render({ ...view(), focus: target });
	const old = h.bridge.focus(target);
	await vi.waitFor(() => expect(h.commands.filter((c) => c.action === "focus")).toHaveLength(1));
	const channel = h.bridge.prepareSwap();
	const next = new MessageChannel();
	disposers.push(() => {
		next.port1.close();
		next.port2.close();
	});
	const commands: { action: string; requestId: number }[] = [];
	next.port2.onmessage = (event) => commands.push(event.data);
	h.ready(channel, next.port1);
	await vi.waitFor(() => expect(commands.find((c) => c.action === "focus")?.requestId).toBe(2));
	expect(await old).toBe(false);
});

it("07t fix pre-suspend semantic event cannot enter resumed presentation", async () => {
	const h = reviewHost();
	h.ready();
	// A native focus command can queue this event before the host commits a hide/rebind.
	h.emit({ event: "focusChanged", focus: target });
	h.bridge.suspend();
	resumePresentation(h.bridge, view());
	await h.barrier(83);
	expect(h.onEvent.mock.calls.filter(([e]) => e.event === "focusChanged")).toEqual([]);
});

it("07t fix suspended fragment patch cannot restore old native focus", async () => {
	fixture();
	const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
	const inspection = startInspectionFrame({
		window: nativeMessageWindow(window),
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!inspection) throw new Error("Missing inspection");
	disposers.push(inspection.dispose);
	const port = send.mock.calls[0][2]?.[0];
	if (!(port instanceof MessagePort)) throw new Error("Missing port");
	disposers.push(() => port.close());
	const events: { event: string; seq?: number }[] = [];
	port.onmessage = (e) => events.push(e.data);
	const command = { source: "praxity-editor", version: 1, ...identity };
	port.postMessage({ ...command, action: "render", view: view() });
	await vi.waitFor(() => expect(handle("text")).not.toBeNull());
	handle("text")?.focus();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
	port.postMessage({ ...command, action: "suspend" });
	port.postMessage({
		...command,
		action: "nodes",
		render: { seq: 90, pageId: "page", fragments: [] },
	});
	await vi.waitFor(() =>
		expect(events).toContainEqual(expect.objectContaining({ event: "painted", seq: 90 })),
	);
	const focus = vi.spyOn(HTMLElement.prototype, "focus");
	port.postMessage({
		...command,
		action: "nodes",
		render: {
			seq: 91,
			pageId: "page",
			fragments: [
				{
					id: "first",
					html: '<div role="tabpanel" id="panel-first" data-node-id="first"><p data-node-id="text">Updated</p></div>',
				},
			],
		},
	});
	await vi.waitFor(() =>
		expect(events).toContainEqual(expect.objectContaining({ event: "painted", seq: 91 })),
	);
	expect(focus).not.toHaveBeenCalled();
});

it("07t fix genuine old focus event queued on the connected port is refused after resume", async () => {
	const frame = document.createElement("iframe");
	frame.src = "https://studio.test/?praxity-inspect=1";
	document.body.append(frame);
	const child = frame.contentWindow;
	if (!child) throw new Error("Missing child window");
	child.document.open();
	child.document.write(
		'<!doctype html><html><body><h1 class="praxity-page-title">Example</h1><p data-node-id="text">First body</p><p data-node-id="tabs">Second body</p></body></html>',
	);
	child.document.close();
	vi.spyOn(child.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 100, 400, 100),
	);
	const latest = {
		...view(),
		nodes: view()
			.nodes.filter((n) => ["page", "text", "tabs"].includes(n.id))
			.map((n) => (n.id === "text" ? { ...n, parentId: "page" } : n)),
	};
	const offer = vi.spyOn(child.parent, "postMessage").mockImplementation(() => {});
	const inspection = startInspectionFrame({
		window: child,
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!inspection) throw new Error("Missing inspection");
	disposers.push(inspection.dispose);
	const port = offer.mock.calls[0][2]?.[0];
	if (!(port instanceof MessagePort)) throw new Error("Missing offered port");
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: latest,
		onEvent,
	});
	disposers.push(bridge.dispose);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [port],
		}),
	);
	const childHandle = (id: string) =>
		child.document.querySelector<HTMLButtonElement>(
			`button[data-focus-role="handle"][data-node-id="${id}"]`,
		);
	await vi.waitFor(() => expect(childHandle("text")).not.toBeNull());
	childHandle("text")?.focus();
	bridge.suspend();
	resumePresentation(bridge, latest);
	bridge.nodes({ seq: 94, pageId: "page", fragments: [] });
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "painted", seq: 94 })),
	);
	const oldEvents = onEvent.mock.calls.filter(([e]) => e.event === "focusChanged");
	frame.focus();
	const focusResult = bridge.focus({ ...target, nodeId: "tabs" });
	expect(await focusResult).toBe(true);
	expect(child.document.activeElement).toBe(childHandle("tabs"));
	onEvent.mockClear();
	childHandle("text")?.focus();
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event: "focusChanged", focus: target }),
		),
	);
	expect(offer).toHaveBeenCalledOnce();
	expect(oldEvents).toEqual([]);
});

it.each([false, true])("07e root inert across swap, hidden=%s", async (suspended) => {
	const frame = document.createElement("iframe");
	frame.src = "https://studio.test/?praxity-inspect=1";
	document.body.append(frame);
	const child = frame.contentWindow;
	if (!child) throw new Error("Missing child window");
	const load = () => {
		child.document.open();
		child.document.write(
			'<!doctype html><html><body><h1 class="praxity-page-title">Example</h1><p data-node-id="text">First body</p><p data-node-id="tabs">Second body</p></body></html>',
		);
		child.document.close();
	};
	load();
	vi.spyOn(child.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 100, 400, 100),
	);
	const latest = {
		...view(),
		nodes: view()
			.nodes.filter((n) => ["page", "text", "tabs"].includes(n.id))
			.map((n) => (n.id === "text" ? { ...n, parentId: "page" } : n)),
	};
	const offer = vi.spyOn(child.parent, "postMessage").mockImplementation(() => {});
	const first = startInspectionFrame({
		window: child,
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!first) throw new Error("Missing inspection");
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: latest,
		onEvent,
	});
	disposers.push(bridge.dispose);
	const readyWith = (channel: string, port: MessagePort) =>
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "null",
				source: frame.contentWindow,
				data: {
					source: "praxity-frame",
					version: 1,
					channel,
					pageId: identity.pageId,
					event: "ready",
				},
				ports: [port],
			}),
		);
	readyWith(identity.channel, offer.mock.calls[0][2]?.[0] as MessagePort);
	const childHandle = (id: string) =>
		child.document.querySelector<HTMLButtonElement>(
			`button[data-focus-role="handle"][data-node-id="${id}"]`,
		);
	await vi.waitFor(() => expect(childHandle("text")).not.toBeNull());
	bridge.suspend();
	await vi.waitFor(() => expect(child.document.documentElement.inert).toBe(true));
	expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ event: "unloading" }));
	bridge.resume(latest);
	await vi.waitFor(() => expect(child.document.documentElement.inert).toBe(false));
	if (suspended) bridge.suspend();
	const channel = bridge.prepareSwap();
	first.dispose();
	load();
	const second = startInspectionFrame({
		window: child,
		parentOrigin: "https://studio.test",
		...identity,
		channel,
	});
	if (!second) throw new Error("Missing successor inspection");
	disposers.push(second.dispose);
	readyWith(channel, offer.mock.calls[1][2]?.[0] as MessagePort);
	if (suspended) {
		await vi.waitFor(() => expect(child.document.documentElement.inert).toBe(true));
		const heights = onEvent.mock.calls.filter(([event]) => event.event === "height").length;
		bridge.render(latest);
		await vi.waitFor(() =>
			expect(onEvent.mock.calls.filter(([event]) => event.event === "height")).toHaveLength(
				heights + 1,
			),
		);
		expect(child.document.documentElement.inert).toBe(true);
		bridge.resume(latest);
	}
	await vi.waitFor(() => expect(child.document.documentElement.inert).toBe(false));
	await vi.waitFor(() => expect(childHandle("text")).not.toBeNull());
	onEvent.mockClear();
	childHandle("tabs")?.focus();
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "focusChanged" })),
	);
});

it("07t round 2 a successor mounted while suspended consumes no editor keys", async () => {
	admitTestKeys(window);
	const h = inspectionPort();
	// The host's ready handler sends suspend before the first render of a suspended bridge.
	h.command({ action: "suspend" });
	await h.render({ ...view(), escapeEnabled: true });
	// Suspended reconciliation creates no handles, so the keys land on the document body.
	expect(handle("text")).toBeNull();
	for (const key of ["Escape", "F2", "Delete"]) {
		const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
		document.body.dispatchEvent(event);
		expect(event.defaultPrevented, key).toBe(false);
	}
});

it("07t round 2 suspend releases focus after an already sent command", async () => {
	const frame = document.createElement("iframe");
	frame.src = "https://studio.test/?praxity-inspect=1";
	document.body.append(frame);
	const child = frame.contentWindow;
	if (!child) throw new Error("Missing child window");
	child.document.open();
	child.document.write(
		'<!doctype html><html><body><h1 class="praxity-page-title">Example</h1><p data-node-id="text">First body</p><p data-node-id="tabs">Second body</p></body></html>',
	);
	child.document.close();
	vi.spyOn(child.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 100, 400, 100),
	);
	const latest = {
		...view(),
		nodes: view()
			.nodes.filter((n) => ["page", "text", "tabs"].includes(n.id))
			.map((n) => (n.id === "text" ? { ...n, parentId: "page" } : n)),
	};
	const offer = vi.spyOn(child.parent, "postMessage").mockImplementation(() => {});
	const inspection = startInspectionFrame({
		window: child,
		parentOrigin: "https://studio.test",
		...identity,
	});
	if (!inspection) throw new Error("Missing inspection");
	disposers.push(inspection.dispose);
	const onEvent = vi.fn();
	const bridge = connectPageFrame({
		window: nativeMessageWindow(window),
		frame,
		frameOrigin: "null",
		...identity,
		view: latest,
		onEvent,
	});
	disposers.push(bridge.dispose);
	window.dispatchEvent(
		new MessageEvent("message", {
			origin: "null",
			source: frame.contentWindow,
			data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
			ports: [offer.mock.calls[0][2]?.[0] as MessagePort],
		}),
	);
	const childHandle = (id: string) =>
		child.document.querySelector<HTMLButtonElement>(
			`button[data-focus-role="handle"][data-node-id="${id}"]`,
		);
	await vi.waitFor(() => expect(childHandle("tabs")).not.toBeNull());
	const release = vi.spyOn(child.parent, "focus").mockImplementation(() => {});
	vi.spyOn(child.document, "hasFocus").mockReturnValue(true);
	// The controller asks for focus, then hides the view in the same task (fast switch or rebind).
	const result = bridge.focus({ ...target, nodeId: "tabs" });
	bridge.suspend();
	bridge.nodes({ seq: 95, pageId: "page", fragments: [] });
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "painted", seq: 95 })),
	);
	expect(await result).toBe(false);
	expect(child.document.activeElement).toBe(childHandle("tabs"));
	expect(release).toHaveBeenCalledOnce();
	release.mockClear();
	vi.mocked(child.document.hasFocus).mockReturnValue(false);
	bridge.suspend();
	bridge.nodes({ seq: 96, pageId: "page", fragments: [] });
	await vi.waitFor(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "painted", seq: 96 })),
	);
	expect(release).not.toHaveBeenCalled();
});

it.each([false, true])(
	"F10 settlement focus delivered after a native leave is cancelled, shadow root %s",
	(shadow) => {
		fixture();
		document.documentElement.inert = false;
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		const lens = mountPageLens({ document, view: view(), onEvent: vi.fn() });
		disposers.push(lens.dispose);
		const source = document.createElement("textarea");
		source.value = "Some source text";
		const container = document.createElement("div");
		document.body.append(container);
		(shadow ? container.attachShadow({ mode: "open" }) : container).append(source);
		const targetSource = { ...target, role: "source" as const, selection: [1, 3] as const };
		lens.registerControl(source, targetSource);
		expect(lens.focus(targetSource)).toBe(true);
		source.setSelectionRange(8, 12, "backward");
		expect(lens.focus(targetSource, { preserveFocus: true })).toBe(true);
		expect([source.selectionStart, source.selectionEnd, source.selectionDirection]).toEqual([
			8,
			12,
			"backward",
		]);
		handle("tabs")?.focus();
		expect(lens.focus(targetSource, { preserveFocus: true })).toBe(false);
		expect(document.activeElement).toBe(handle("tabs"));
		expect([source.selectionStart, source.selectionEnd, source.selectionDirection]).toEqual([
			8,
			12,
			"backward",
		]);
		// A child retains activeElement when its outer document has focus elsewhere.
		lens.focus(targetSource);
		source.setSelectionRange(8, 12);
		vi.mocked(document.hasFocus).mockReturnValue(false);
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		const focusWindow = vi.spyOn(window, "focus");
		expect(lens.focus(targetSource, { preserveFocus: true })).toBe(false);
		expect(focus).not.toHaveBeenCalled();
		expect(focusWindow).not.toHaveBeenCalled();
		expect([source.selectionStart, source.selectionEnd]).toEqual([8, 12]);
	},
);

it("F10 settlement on the private port cannot reclaim focus moved after dispatch", async () => {
	const h = inspectionPort();
	await h.render();
	handle("text")?.focus();
	h.command({ action: "focus", target, requestId: 81, preserveFocus: true });
	handle("tabs")?.focus();
	await h.render();
	expect(document.activeElement).toBe(handle("tabs"));
	expect(h.events).toContainEqual(
		expect.objectContaining({ event: "focusResult", requestId: 81, success: false }),
	);
	expect(h.events.filter((event) => event.event === "missing")).toEqual([]);
	handle("text")?.focus();
	h.command({ action: "focus", target: { ...target, nodeId: "tabs" }, requestId: 83 });
	await h.render();
	expect(document.activeElement).toBe(handle("tabs"));
	// Cancellation never leaves a deferred attempt that could override the author.
	await h.paint(82);
	expect(document.activeElement).toBe(handle("tabs"));
});

it("F10 focus protocol admits only the explicit native-focus preservation flag", () => {
	const command = {
		source: "praxity-editor",
		version: 1,
		...identity,
		action: "focus",
		target,
		requestId: 1,
	};
	expect(isFrameCommand({ ...command, preserveFocus: true }, identity)).toBe(true);
	expect(
		isFrameCommand(
			{ ...command, expect: [{ file: target.file, nodeId: target.nodeId }] },
			identity,
		),
	).toBe(true);
	expect(isFrameCommand({ ...command, expect: [] }, identity)).toBe(true);
	for (const expectOwners of [
		null,
		true,
		{},
		[null],
		[{ file: 1, nodeId: "text" }],
		[{ file: "a", nodeId: null }],
		[{ file: "a", nodeId: "text", extra: true }],
	])
		expect(isFrameCommand({ ...command, expect: expectOwners }, identity)).toBe(false);
	for (const preserveFocus of [false, 0, "true", null])
		expect(isFrameCommand({ ...command, preserveFocus }, identity)).toBe(false);
});

it.each([false, true])(
	"F10 host retains settlement preservation, ready before request %s",
	async (readyFirst) => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const bridge = connectPageFrame({
			window: nativeMessageWindow(window),
			frame,
			frameOrigin: "null",
			...identity,
			view: view(),
			onEvent: vi.fn(),
		});
		disposers.push(bridge.dispose);
		const ports = new MessageChannel();
		disposers.push(() => {
			ports.port1.close();
			ports.port2.close();
		});
		const commands: unknown[] = [];
		ports.port2.onmessage = (event) => commands.push(event.data);
		const ready = () =>
			window.dispatchEvent(
				new MessageEvent("message", {
					origin: "null",
					source: frame.contentWindow,
					data: { source: "praxity-frame", version: 1, ...identity, event: "ready" },
					ports: [ports.port1],
				}),
			);
		if (readyFirst) ready();
		frame.focus();
		const owners = [{ file: target.file, nodeId: target.nodeId }];
		const result = bridge.focus(target, { preserveFocus: true, expect: owners });
		if (!readyFirst) ready();
		await vi.waitFor(() =>
			expect(commands).toContainEqual(
				expect.objectContaining({
					action: "focus",
					target,
					requestId: 1,
					preserveFocus: true,
					expect: owners,
				}),
			),
		);
		bridge.dispose();
		expect(await result).toBe(false);
	},
);
