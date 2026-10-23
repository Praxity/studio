import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { canvasMessages } from "../../shared/canvas-messages";
import { startStudioAuthor } from "./canvas";
import { createCanvasTextSession, type mountCanvasTextFields } from "./canvas-text";

afterEach(() => vi.unstubAllGlobals());

it("offers Review changes without projecting a gate received by a background refresh", async () => {
	const origin = "http://127.0.0.1:9000";
	const dom = new JSDOM(
		"<!doctype html><html><head></head><body><h1>Saved course</h1></body></html>",
		{
			url: `${origin}/canvas/preview/course.html#session=${"a".repeat(43)}`,
			pretendToBeVisual: true,
		},
	);
	const window = dom.window;
	const body = window.document.body;
	window.HTMLElement.prototype.showPopover = () => {};
	window.scrollTo = () => {};
	for (const name of [
		"document",
		"location",
		"history",
		"sessionStorage",
		"navigator",
		"Document",
		"HTMLElement",
		"Element",
		"HTMLAnchorElement",
		"HTMLAreaElement",
		"HTMLLinkElement",
		"Node",
		"DOMParser",
		"MutationObserver",
		"AbortController",
		"AbortSignal",
		"getComputedStyle",
		"scrollX",
		"scrollY",
		"scrollTo",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	] as const)
		vi.stubGlobal(name, window[name]);
	vi.stubGlobal("window", window);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	const fields = [
		{
			file: "lesson.prax",
			nodeId: "page",
			ownerId: "page",
			kind: "page",
			field: "subject",
			text: "Page",
			baseRevision: "b".repeat(64),
		},
	];
	const snapshot = { fields, seq: 0, servedSeq: 0, sourceRevisions: {}, servedSourceRevisions: {} };
	window.fetch = vi.fn<typeof fetch>(async (input, options) => {
		if (String(input).endsWith("/api/rpc")) {
			const { method } = JSON.parse(String(options?.body)) as { method: string };
			const result =
				method === "canvasTextSnapshot"
					? snapshot
					: method === "canvasPreviewBuild"
						? { entryUrl: `${origin}/preview/revision/`, pages: [{ id: "page", slug: "page" }] }
						: {};
			return new Response(JSON.stringify({ ok: true, result }));
		}
		return new Response(
			'<!doctype html><html><body><h1 id="review-heading">Some blocks would get new IDs</h1></body></html>',
		);
	});
	let events: ReadableStreamDefaultController<Uint8Array> | undefined;
	const openEvents = async (_token: string, signal: AbortSignal) =>
		new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					events = controller;
					controller.enqueue(new TextEncoder().encode('{"type":"ready"}\n'));
					signal.addEventListener("abort", () => controller.close(), { once: true });
				},
			}),
		);
	const view: ReturnType<typeof mountCanvasTextFields> = {
		isEditing: () => true,
		setEditing: async () => {},
		isOpen: () => false,
		unmapped: false,
		update: vi.fn(),
		owns: () => false,
		focusedBinding: () => undefined,
		focusBinding: () => {},
		dispose: () => {},
	};
	try {
		startStudioAuthor(
			origin,
			"http://127.0.0.1:9001/course.html",
			canvasMessages.en,
			() => view,
			createCanvasTextSession,
			{ light: "", dark: "" },
			openEvents,
			1000,
		);
		window.dispatchEvent(new window.Event("DOMContentLoaded"));
		const panel = () =>
			window.document.documentElement.firstElementChild?.shadowRoot?.firstElementChild?.shadowRoot;
		await vi.waitFor(() =>
			expect(panel()?.querySelector('[role="status"]')?.textContent).toBe("Connected"),
		);
		events?.enqueue(new TextEncoder().encode('{"type":"editorChanged","seq":1}\n'));
		await vi.waitFor(() =>
			expect(panel()?.querySelector('[role="status"]')?.textContent).toBe(
				"This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.",
			),
		);
		const review = [...(panel()?.querySelectorAll("a") ?? [])].find(
			(link) => link.textContent === "Review changes",
		);
		expect(review?.hidden).toBe(false);
		expect(review?.href).toBe(`${origin}/launch`);
		expect(window.document.body).toBe(body);
		expect(body.textContent).toBe("Saved course");
		expect(window.document.querySelector("#review-heading")).toBeNull();
		expect(view.update).not.toHaveBeenCalled();
	} finally {
		window.dispatchEvent(new window.Event("pagehide"));
		window.close();
	}
});
