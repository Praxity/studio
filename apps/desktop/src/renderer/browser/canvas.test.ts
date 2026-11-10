import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { type CanvasMessages, canvasMessages } from "../../shared/canvas-messages";
import { startStudioAuthor } from "./canvas";
import { createCanvasTextSession, type mountCanvasTextFields } from "./canvas-text";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const origin = "http://127.0.0.1:9000";
const built = { entryUrl: `${origin}/preview/revision/`, pages: [{ id: "page", slug: "page" }] };

const reviewGate =
	'<!doctype html><html><body><h1 id="review-heading">Some blocks would get new IDs</h1></body></html>';

/** Mounts the canvas with a stub server: `build` answers each canvasPreviewBuild RPC
 * and `page` serves the built author document. */
async function mountCanvas(
	messages: CanvasMessages,
	build: () => Response | Promise<Response>,
	page: () => string = () => reviewGate,
) {
	const dom = new JSDOM(
		"<!doctype html><html><head></head><body><h1>Saved course</h1></body></html>",
		{
			url: `${origin}/canvas/preview/course.html#session=${"a".repeat(43)}`,
			pretendToBeVisual: true,
		},
	);
	const window = dom.window;
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
	const fetch = vi.fn<typeof window.fetch>(async (input, options) => {
		if (String(input).endsWith("/api/rpc")) {
			const { method } = JSON.parse(String(options?.body)) as { method: string };
			if (method === "canvasPreviewBuild") return build();
			const result = method === "canvasTextSnapshot" ? snapshot : {};
			return new Response(JSON.stringify({ ok: true, result }));
		}
		return new Response(page());
	});
	window.fetch = fetch;
	let events: ReadableStreamDefaultController<Uint8Array> | undefined;
	let seq = 0;
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
	startStudioAuthor(
		origin,
		"http://127.0.0.1:9001/course.html",
		messages,
		() => view,
		createCanvasTextSession,
		{ light: "", dark: "" },
		openEvents,
		1000,
	);
	window.dispatchEvent(new window.Event("DOMContentLoaded"));
	const panel = () =>
		window.document.documentElement.firstElementChild?.shadowRoot?.firstElementChild?.shadowRoot;
	const status = () => panel()?.querySelector('[role="status"]');
	await vi.waitFor(() => expect(status()?.textContent).toBe(messages.connected));
	return {
		window,
		fetch,
		view,
		panel,
		status,
		readLink: () => panel()?.querySelector<HTMLAnchorElement>('a[role="link"]'),
		changeSource: () =>
			events?.enqueue(new TextEncoder().encode(`{"type":"editorChanged","seq":${++seq}}\n`)),
		close: () => {
			window.dispatchEvent(new window.Event("pagehide"));
			window.close();
		},
	};
}

it("offers Review changes without projecting a gate received by a background refresh", async () => {
	const canvas = await mountCanvas(
		canvasMessages.en,
		() => new Response(JSON.stringify({ ok: true, result: built })),
	);
	const body = canvas.window.document.body;
	try {
		canvas.changeSource();
		await vi.waitFor(() =>
			expect(canvas.status()?.textContent).toBe(
				"This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.",
			),
		);
		const review = [...(canvas.panel()?.querySelectorAll("a") ?? [])].find(
			(link) => link.textContent === "Review changes",
		);
		expect(review?.hidden).toBe(false);
		expect(review?.href).toBe(`${origin}/launch`);
		expect(canvas.window.document.body).toBe(body);
		expect(body.textContent).toBe("Saved course");
		expect(canvas.window.document.querySelector("#review-heading")).toBeNull();
		expect(canvas.view.update).not.toHaveBeenCalled();
	} finally {
		canvas.close();
	}
});

const refusalText =
	"lesson.prax, line 10, column 1: A private choice must be optional, unscored, outside assessment groups and without a gate.\nlesson.prax, line 21, column 1: This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container.";
const practiceRefusal = () =>
	new Response(
		JSON.stringify({
			ok: false,
			error: {
				code: "practice_refused",
				message: refusalText,
				details: {
					diagnostics: [
						{ code: "private-choice-practice-only", file: "lesson.prax", line: 10, column: 1 },
						{ code: "practice-no-tracking", file: "lesson.prax", line: 21, column: 1 },
					],
				},
			},
		}),
		{ status: 422 },
	);

it("shows a practice refusal once in the status and keeps the last good page", async () => {
	let reply = practiceRefusal;
	let page = reviewGate;
	const canvas = await mountCanvas(
		canvasMessages.en,
		() => reply(),
		() => page,
	);
	const body = canvas.window.document.body;
	const readHref = canvas.readLink()?.href;
	const builds = () =>
		canvas.fetch.mock.calls.filter(([, options]) =>
			String(options?.body).includes("canvasPreviewBuild"),
		).length;
	try {
		canvas.changeSource();
		await vi.waitFor(() => expect(canvas.status()?.textContent).toBe(refusalText));
		await vi.waitFor(() => expect(canvas.readLink()?.href).toBe(readHref));
		expect(canvas.readLink()?.textContent).toBe("Read mode");
		expect(canvas.window.document.body).toBe(body);
		expect(body.textContent).toBe("Saved course");
		expect(canvas.view.update).not.toHaveBeenCalled();
		// The same refusal after another outside change is not announced again.
		const status = canvas.status() as Node;
		let mutations = 0;
		new canvas.window.MutationObserver(() => mutations++).observe(status, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		canvas.changeSource();
		await vi.waitFor(() => expect(builds()).toBe(2));
		await vi.waitFor(() => expect(canvas.readLink()?.getAttribute("aria-busy")).toBeNull());
		expect(mutations).toBe(0);
		expect(canvas.status()?.textContent).toBe(refusalText);
		// A repaired course clears the refusal through the next admitted build.
		reply = () => new Response(JSON.stringify({ ok: true, result: built }));
		page = "<!doctype html><html><head></head><body><h1>Repaired course</h1></body></html>";
		canvas.changeSource();
		await vi.waitFor(() => expect(canvas.status()?.textContent).toBe("Connected"));
		expect(body.textContent).toBe("Repaired course");
	} finally {
		canvas.close();
	}
});

it("discards an obsolete refusal while the repaired source is still building", async () => {
	let releaseFirst!: (response: Response) => void;
	let releaseSecond!: (response: Response) => void;
	const first = new Promise<Response>((resolve) => {
		releaseFirst = resolve;
	});
	const second = new Promise<Response>((resolve) => {
		releaseSecond = resolve;
	});
	let builds = 0;
	const canvas = await mountCanvas(
		canvasMessages.en,
		() => (++builds === 1 ? first : second),
		() => "<!doctype html><html><head></head><body><h1>Repaired course</h1></body></html>",
	);
	const announced: string[] = [];
	const observer = new canvas.window.MutationObserver(() => {
		announced.push(canvas.status()?.textContent ?? "");
	});
	observer.observe(canvas.status() as Node, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	try {
		canvas.changeSource();
		await vi.waitFor(() => expect(builds).toBe(1));
		canvas.changeSource();
		// Let the second watcher event supersede the pending request before releasing it.
		await new Promise((resolve) => setTimeout(resolve, 0));
		releaseFirst(practiceRefusal());
		await vi.waitFor(() => expect(builds).toBe(2));
		expect(canvas.status()?.textContent).not.toBe(refusalText);
		expect(announced).not.toContain(refusalText);
		expect(canvas.window.document.body.textContent).toBe("Saved course");
		releaseSecond(new Response(JSON.stringify({ ok: true, result: built })));
		await vi.waitFor(() => expect(canvas.window.document.body.textContent).toBe("Repaired course"));
		expect(canvas.status()?.textContent).toBe("Connected");
		expect(announced).not.toContain(refusalText);
	} finally {
		observer.disconnect();
		canvas.close();
	}
});

it("keeps the generic refresh failure for other refused builds", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const canvas = await mountCanvas(
		canvasMessages.en,
		() =>
			new Response(
				JSON.stringify({
					ok: false,
					error: { code: "operation_failed", message: "HIDDEN upstream detail" },
				}),
				{ status: 500 },
			),
	);
	try {
		canvas.changeSource();
		await vi.waitFor(() =>
			expect(canvas.status()?.textContent).toBe(canvasMessages.en.refreshFailed),
		);
	} finally {
		canvas.close();
	}
});
