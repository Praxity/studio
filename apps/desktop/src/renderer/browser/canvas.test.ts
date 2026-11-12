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
	sourceRefusal = "",
	snapshotForDocument?: (path: string) => unknown,
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
	const snapshot = {
		fields: sourceRefusal ? [] : fields,
		sourceRefusal,
		seq: 0,
		servedSeq: 0,
		sourceRevisions: {},
		servedSourceRevisions: {},
	};
	const fetch = vi.fn<typeof window.fetch>(async (input, options) => {
		if (String(input).endsWith("/api/rpc")) {
			const { method } = JSON.parse(String(options?.body)) as { method: string };
			if (method === "canvasPreviewBuild") return build();
			const result =
				method === "canvasTextSnapshot"
					? (snapshotForDocument?.(new Headers(options?.headers).get("X-Praxity-Canvas") ?? "") ??
						snapshot)
					: {};
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
	let editing = true;
	const view: ReturnType<typeof mountCanvasTextFields> = {
		setUpdating: vi.fn(),
		isEditing: () => editing,
		setEditing: async () => {},
		isOpen: () => false,
		unmapped: false,
		update: vi.fn(),
		owns: () => false,
		focusedBinding: () => undefined,
		focusBinding: () => {},
		dispose: () => {},
	};
	let lifecycleReload: (() => void) | undefined;
	startStudioAuthor(
		origin,
		"http://127.0.0.1:9001/course.html",
		messages,
		(...args) => {
			lifecycleReload = args[9]?.reload;
			view.setEditing = async (value) => {
				editing = value;
				args[4].textContent = value ? messages.editingOn : messages.editingOff;
				args[9]?.editingChanged?.(value, false);
			};
			return view;
		},
		createCanvasTextSession,
		{ light: "", dark: "" },
		openEvents,
		1000,
	);
	window.dispatchEvent(new window.Event("DOMContentLoaded"));
	const panel = () =>
		window.document.documentElement.firstElementChild?.shadowRoot?.firstElementChild?.shadowRoot;
	const status = () => panel()?.querySelector('[role="status"]');
	await vi.waitFor(() => expect(status()?.textContent).toBe(sourceRefusal || messages.connected));
	return {
		window,
		snapshot,
		fetch,
		view,
		panel,
		status,
		readLink: () => panel()?.querySelector<HTMLAnchorElement>('a[role="link"]'),
		reload: () => lifecycleReload?.(),
		changeSource: () =>
			events?.enqueue(new TextEncoder().encode(`{"type":"editorChanged","seq":${++seq}}\n`)),
		close: () => {
			window.dispatchEvent(new window.Event("pagehide"));
			window.close();
		},
	};
}

it.each([false, true])(
	"uses the new document scope after temporary IDs change, refused=%s",
	async (refused) => {
		let fresh: unknown;
		const canvas = await mountCanvas(
			canvasMessages.en,
			() => new Response(JSON.stringify({ ok: true, result: { ...built, pageId: "page" } })),
			() => "<!doctype html><html><head></head><body><h1>Same lesson</h1></body></html>",
			"",
			(path) => (path.endsWith("/page.html") ? fresh : undefined),
		);
		try {
			const fields = canvas.snapshot.fields.map((field) => ({
				...field,
				nodeId: "new-page",
				ownerId: "new-page",
			}));
			fresh = {
				...canvas.snapshot,
				fields: refused ? [] : fields,
				sourceRefusal: refused ? canvasMessages.en.sourceError : "",
			};
			canvas.snapshot.fields = [];
			canvas.changeSource();
			await vi.waitFor(() =>
				expect(canvas.view.update).toHaveBeenLastCalledWith(refused ? [] : fields),
			);
			expect(canvas.window.document.body.textContent).toBe(
				refused ? "Saved course" : "Same lesson",
			);
			expect(canvas.view.setUpdating).toHaveBeenLastCalledWith(false);
			expect(canvas.status()?.textContent).toBe(
				refused ? canvasMessages.en.sourceError : canvasMessages.en.connected,
			);
		} finally {
			canvas.close();
		}
	},
);

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

for (const lang of ["en", "fr"] as const)
	it(`keeps the page updating and edits blocked until fresh content lands (${lang})`, async () => {
		let release!: (response: Response) => void;
		const held = new Promise<Response>((resolve) => {
			release = resolve;
		});
		const canvas = await mountCanvas(
			canvasMessages[lang],
			() => held,
			() => "<!doctype html><html><head></head><body><h1>Outside edit</h1></body></html>",
		);
		try {
			canvas.reload();
			await vi.waitFor(() =>
				expect(canvas.status()?.textContent).toBe(canvasMessages[lang].updating),
			);
			expect(canvas.view.setUpdating).toHaveBeenLastCalledWith(true);
			expect(canvas.window.document.body.textContent).toBe("Saved course");
			release(new Response(JSON.stringify({ ok: true, result: built })));
			await vi.waitFor(() => expect(canvas.window.document.body.textContent).toBe("Outside edit"));
			expect(canvas.view.setUpdating).toHaveBeenLastCalledWith(false);
			expect(canvas.status()?.textContent).toBe(canvasMessages[lang].connected);
		} finally {
			canvas.close();
		}
	});

it.each(["network", "timeout", "server", "practice", "missing-page"] as const)(
	"releases updating after a held reload fails: %s",
	async (kind) => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let fail!: () => void;
		const held = new Promise<Response>((resolve, reject) => {
			fail = () => {
				if (kind === "network" || kind === "timeout") {
					reject(new Error(kind === "timeout" ? "Request timed out" : "Network unavailable"));
				} else if (kind === "practice") resolve(practiceRefusal());
				else if (kind === "missing-page")
					resolve(new Response(JSON.stringify({ ok: true, result: { ...built, pages: [] } })));
				else
					resolve(
						new Response(JSON.stringify({ ok: false, error: { code: "operation_failed" } }), {
							status: 500,
						}),
					);
			};
		});
		const canvas = await mountCanvas(canvasMessages.en, () => held);
		try {
			canvas.reload();
			expect(canvas.view.setUpdating).toHaveBeenLastCalledWith(true);
			fail();
			await vi.waitFor(() =>
				expect(canvas.status()?.textContent).toBe(
					kind === "practice" ? refusalText : canvasMessages.en.refreshFailed,
				),
			);
			expect(canvas.view.setUpdating).toHaveBeenLastCalledWith(false);
			expect(canvas.window.document.body.textContent).toBe("Saved course");
		} finally {
			canvas.close();
		}
	},
);
it("shows the initial source refusal and recovers using the server-selected page without a title field", async () => {
	const sourceRefusal =
		"lesson.prax, line 23, column 1: Fix the feedback lines in this lesson's .prax file to edit its text. Put correct: and incorrect: before the answer choices, and feedback: directly under its choice, with no blank line.";
	const canvas = await mountCanvas(
		canvasMessages.en,
		() => new Response(JSON.stringify({ ok: true, result: { ...built, pageId: "page" } })),
		() => "<!doctype html><html><head></head><body><h1>Repaired lesson</h1></body></html>",
		sourceRefusal,
	);
	try {
		expect(canvas.status()?.textContent).toBe(sourceRefusal);
		await canvas.view.setEditing(false);
		expect(canvas.status()?.textContent).toBe(sourceRefusal);
		await canvas.view.setEditing(true);
		expect(canvas.status()?.textContent).toBe(sourceRefusal);
		canvas.snapshot.sourceRefusal = "";
		canvas.changeSource();
		await vi.waitFor(() => expect(canvas.status()?.textContent).toBe("Connected"));
		expect(canvas.window.document.body.textContent).toBe("Repaired lesson");
		expect(canvas.readLink()?.href).toContain("page.html");
		await canvas.view.setEditing(false);
		await canvas.view.setEditing(true);
		expect(canvas.status()?.textContent).toBe(canvasMessages.en.editingOn);
	} finally {
		canvas.close();
	}
});

it.each(["en", "fr"] as const)(
	"%s: a deleted or renamed lesson keeps its page with a refusal instead of Connected",
	async (locale) => {
		const canvas = await mountCanvas(
			canvasMessages[locale],
			() => new Response(JSON.stringify({ ok: true, result: { ...built, pageId: "page" } })),
			() => "<!doctype html><html><head></head><body><h1>Other course page</h1></body></html>",
		);
		try {
			const originalBody = canvas.window.document.body.innerHTML;
			canvas.snapshot.fields = [];
			canvas.snapshot.sourceRefusal = canvasMessages[locale].lessonGone;
			canvas.changeSource();
			await vi.waitFor(() =>
				expect(canvas.status()?.textContent).toBe(canvasMessages[locale].lessonGone),
			);
			expect(canvas.view.update).toHaveBeenCalledWith([]);
			expect(canvas.window.document.body.innerHTML).toBe(originalBody);
			expect(
				canvas.fetch.mock.calls.some(([, options]) =>
					String(options?.body).includes("canvasPreviewBuild"),
				),
			).toBe(false);
			await canvas.view.setEditing(false);
			await canvas.view.setEditing(true);
			expect(canvas.status()?.textContent).toBe(canvasMessages[locale].lessonGone);
		} finally {
			canvas.close();
		}
	},
);
