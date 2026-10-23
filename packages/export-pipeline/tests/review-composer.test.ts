import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { refusalStatuses } from "../../../apps/desktop/src/main/studio/review-http";
import reviewEn from "../../editor-core/src/messages/en.json" with { type: "json" };
import reviewFr from "../../editor-core/src/messages/fr.json" with { type: "json" };
import type { ReviewAnchor } from "../../review-share/src/review";
import {
	create as createThread,
	REVIEW_LIMITS,
	REVIEW_TEXT_RULES,
	type ReviewState,
} from "../../review-share/src/review";
import { renderBlockHtml } from "../src/render-block-html";

const source = await readFile(new URL("../template/review-comments.js", import.meta.url), "utf8");
const reviewId = "11111111-1111-4111-8111-111111111111";
const capability = "A".repeat(43);
const settings = {
	schema: 1,
	reviewId,
	capability,
	endpoint: `/api/reviews/${reviewId}`,
	locale: "en",
	limits: REVIEW_LIMITS,
	blockNames: reviewEn.pedagogyAudit.blockTypes,
	textRules: { controls: REVIEW_TEXT_RULES.bodyControls, surrogates: REVIEW_TEXT_RULES.surrogates },
	page: {
		lessonId: "lesson",
		pageId: "page",
		pageIds: ["page", "other"],
		pageIndex: 0,
		revision: "revision",
	},
};
const doms: JSDOM[] = [];
afterEach(async () => {
	for (const dom of doms.splice(0)) {
		dom.window.dispatchEvent(new dom.window.Event("pagehide"));
		await settle();
		dom.window.close();
	}
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function open(
	options: {
		markup?: string;
		fetch?: ReturnType<typeof vi.fn>;
		stored?: [string, string][];
		capability?: string;
		brokenStorage?: boolean;
		noLocks?: boolean;
		locale?: string;
		revision?: string;
		draftOriginChanged?: true;
		prepare?: (dom: JSDOM) => void;
	} = {},
) {
	const dom = new JSDOM(
		`<!doctype html><html><head><script type="application/json" id="praxity-review-config">${JSON.stringify({ ...settings, ...(options.draftOriginChanged ? { draftOriginChanged: true } : {}), page: { ...settings.page, revision: options.revision ?? settings.page.revision }, capability: options.capability ?? capability, locale: options.locale ?? "en", blockNames: (options.locale === "fr" ? reviewFr : reviewEn).pedagogyAudit.blockTypes })}</script><script data-praxity-review-comments="true"></script></head><body><main><h1>Page title</h1>${options.markup ?? '<p data-block-type="text" data-block-id="block" data-node-id="node">Read this passage.</p>'}</main></body></html>`,
		{
			url: "http://127.0.0.1:3456/lesson.html",
			runScripts: "outside-only",
			pretendToBeVisual: true,
		},
	);
	doms.push(dom);
	const { window: win } = dom;
	Object.defineProperty(win, "TextEncoder", { value: TextEncoder });
	// JSDOM has no SubtleCrypto. Keep native SHA-256 behind that platform seam.
	Object.defineProperty(win.crypto, "subtle", {
		configurable: true,
		value: {
			digest: async (algorithm: string, bytes: Uint8Array) => {
				expect(algorithm).toBe("SHA-256");
				return Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer;
			},
		},
	});
	if (!options.noLocks)
		Object.defineProperty(win.navigator, "locks", { value: testLocks(), configurable: true });
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	win.requestAnimationFrame = (callback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	};
	win.cancelAnimationFrame = (id) => {
		frames.delete(id);
	};
	const flushFrames = () => {
		const callbacks = [...frames.values()];
		frames.clear();
		callbacks.forEach((callback) => callback(0));
	};
	win.HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	win.HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new win.Event("close"));
	};
	win.document.elementFromPoint = () => win.document.querySelector("main");
	Object.defineProperties(win.document.documentElement, {
		clientWidth: { get: () => 1280 },
		clientHeight: { get: () => 900 },
	});
	win.HTMLElement.prototype.getBoundingClientRect = () =>
		({ left: 60, top: 100, right: 360, bottom: 140, width: 300, height: 40 }) as DOMRect;
	win.Range.prototype.getClientRects = () =>
		[
			{ left: 60, top: 100, right: 260, bottom: 120, width: 200, height: 20 },
		] as unknown as DOMRectList;
	for (const [key, value] of options.stored ?? [])
		win[options.noLocks ? "sessionStorage" : "localStorage"].setItem(key, value);
	if (options.brokenStorage)
		Object.defineProperty(win, "localStorage", {
			get() {
				throw new Error("storage disabled");
			},
		});
	const fetchMock =
		(options.fetch &&
			vi.fn((url, init) => Reflect.apply(options.fetch!, undefined, [url, init]))) ??
		vi.fn().mockImplementation((_url, init) => {
			if (init?.method !== "POST")
				return Promise.resolve(reply({ ok: true, threads: [], nextCursor: null }));
			const payload = JSON.parse(init.body);
			return Promise.resolve(
				reply({
					ok: true,
					thread: {
						id: "saved-thread",
						anchor: payload.anchor,
						status: "open",
						messages: [
							{
								body: payload.body,
								actor: { displayName: "Reviewer" },
								at: "2026-10-19T00:00:00.000Z",
							},
						],
					},
				}),
			);
		});
	win.fetch = fetchMock as typeof win.fetch;
	options.prepare?.(dom);
	win.eval(source);
	win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
	await settle();
	const doc = win.document;
	const click = async (selector: string) => {
		const node = doc.querySelector(selector) as HTMLButtonElement;
		expect(node, selector).not.toBeNull();
		node.click();
		await settle();
	};
	const type = async (body: string) => {
		const field = doc.querySelector("textarea") as HTMLTextAreaElement;
		field.value = body;
		field.dispatchEvent(new win.Event("input", { bubbles: true }));
		await settle();
	};
	const pick = async (index = 1) => {
		await click(".prx-review-choose");
		const radios = doc.querySelectorAll<HTMLInputElement>('input[type="radio"]');
		radios[index].checked = true;
		await click(".prx-review-next");
	};
	const selection = () => {
		const range = doc.createRange();
		range.selectNodeContents(doc.querySelector("main p") as Element);
		win.getSelection()?.removeAllRanges();
		win.getSelection()?.addRange(range);
		doc.dispatchEvent(new win.Event("selectionchange"));
		flushFrames();
	};
	return { dom, win, doc, click, type, pick, selection, fetchMock, frames, flushFrames };
}
async function settle() {
	for (let i = 0; i < 80; i++) await Promise.resolve();
}
function testLocks() {
	const tails = new Map<string, Promise<unknown>>(),
		held = new Set<string>();
	return {
		held,
		request: vi.fn((name: string, callback: () => unknown) => {
			const task = (tails.get(name) || Promise.resolve())
				.catch(() => {})
				.then(async () => {
					held.add(name);
					try {
						return await callback();
					} finally {
						held.delete(name);
					}
				});
			tails.set(name, task);
			return task;
		}),
	};
}
const posts = (ui: Awaited<ReturnType<typeof open>>) =>
	ui.fetchMock.mock.calls
		.filter(([, init]) => init?.method === "POST")
		.map(([, init]) => JSON.parse(init.body));
const records = (storage: ReturnType<typeof sharedDraftStorage>) => [...storage.values];
const bodies = (storage: ReturnType<typeof sharedDraftStorage>) =>
	records(storage)
		.map(([, raw]) => JSON.parse(raw).body)
		.sort();
async function holdDraftLock(storage: ReturnType<typeof sharedDraftStorage>) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	void storage.locks.request(`praxity-review:${reviewId}:page`, () => gate);
	await settle();
	return release;
}
function heldPost() {
	let acknowledge!: (value: Response) => void;
	const fetch = vi.fn().mockImplementation((_url, init) =>
		init?.method === "POST"
			? new Promise<Response>((resolve) => {
					acknowledge = resolve;
				})
			: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
	);
	return {
		fetch,
		respond(response: Response) {
			acknowledge(response);
		},
		ack(payload: { anchor: ReviewAnchor; body: string }) {
			acknowledge(
				reply({
					ok: true,
					thread: {
						id: "ack",
						anchor: payload.anchor,
						status: "open",
						messages: [
							{ body: payload.body, actor: { displayName: "Reviewer" }, at: "2026-10-19" },
						],
					},
				}),
			);
		},
	};
}

it("a queued event cannot unlock a send or let its acknowledgement remove a successor draft", async () => {
	const storage = sharedDraftStorage(),
		held = heldPost();
	const a = await open({ prepare: storage.prepare, fetch: held.fetch });
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	await b.type("Sending text");
	await a.pick(0);
	await a.click(".prx-review-submit");
	const submitted = posts(a)[0];
	storage.deliver();
	expect(a.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
	await a.click(".prx-review-cancel");
	await b.type("Successor draft");
	storage.deliver();
	await a.click(".prx-review-open-draft");
	await a.type("New unsent correction");
	held.ack(submitted);
	await settle();
	expect(bodies(storage)).toEqual(["New unsent correction"]);
	expect(submitted.body).toBe("Sending text");
	expect(a.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("New unsent correction");
});
it("the second editor forks a changed draft and keeps both exact texts with a notice", async () => {
	const storage = sharedDraftStorage();
	const a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Initial");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await a.pick(0);
	await b.pick(0);
	await a.type("First writer");
	await b.type("Second writer");
	storage.deliver();
	expect(bodies(storage)).toEqual(["First writer", "Second writer"]);
	expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"Another tab changed this draft. Your text was kept as a separate draft.",
	);
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Second writer");
});
it.each(["acknowledge", "discard"])(
	"a clean stale composer reports another tab's %s and never resurrects it",
	async (outcome) => {
		const storage = sharedDraftStorage();
		const a = await open({ prepare: storage.prepare });
		await a.pick(0);
		await a.type("Same intent");
		await a.click(".prx-review-cancel");
		const b = await open({ prepare: storage.prepare });
		await b.pick(0);
		if (outcome === "acknowledge") {
			await a.pick(0);
			await a.click(".prx-review-submit");
			await settle();
		} else await a.click(".prx-review-discard-draft");
		storage.deliver();
		await b.click(".prx-review-submit");
		await settle();
		expect(posts(b)).toHaveLength(0);
		expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
			"This draft was sent or discarded in another tab.",
		);
		expect(b.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(
			"This draft was sent or discarded in another tab.",
		);
		expect(b.doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.disabled).toBe(true);
		expect(b.doc.querySelector<HTMLButtonElement>(".prx-review-keep-new")?.hidden).toBe(false);
		await b.click(".prx-review-cancel");
		b.win.dispatchEvent(new b.win.Event("pagehide"));
		expect(records(storage)).toHaveLength(0);
	},
);
it.each(["send", "discard"])(
	"dirty text survives another tab's %s through close and reload",
	async (outcome) => {
		const storage = sharedDraftStorage(),
			server = realReview(),
			a = await open({ prepare: storage.prepare, fetch: server.fetch });
		await a.pick(0);
		await a.type("Original");
		await a.click(".prx-review-cancel");
		const b = await open({ prepare: storage.prepare, fetch: server.fetch });
		await b.pick(0);
		if (outcome === "send") {
			await a.pick(0);
			await a.click(".prx-review-submit");
			await server.idle();
			await settle();
		} else await a.click(".prx-review-discard-draft");
		await b.type("Original plus B");
		expect(bodies(storage)).toEqual(["Original plus B"]);
		expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
		await b.click(".prx-review-cancel");
		const c = await open({
			prepare: storage.prepare,
			fetch: server.fetch,
		});
		await c.click(".prx-review-open-draft");
		expect(c.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Original plus B");
		storage.deliver();
		expect(a.doc.querySelector(".prx-review-draft-body")?.textContent).toBe("Original plus B");
	},
);
it("Keep as new draft retains the draft ID after another tab discards", async () => {
	const storage = sharedDraftStorage();
	const a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Kept text");
	const id = records(storage)[0][0].slice(-36);
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	await a.click(".prx-review-discard-draft");
	await b.click(".prx-review-submit");
	await b.click(".prx-review-keep-new");
	expect(bodies(storage)).toEqual(["Kept text"]);
	expect(records(storage)[0][0].slice(-36)).toBe(id);
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	await b.click(".prx-review-submit");
	await settle();
	expect(posts(b)).toHaveLength(1);
	expect(posts(b)[0].requestId).toBe(id);
});
it("unknown sends live in the outbox and two reloads retry the identical frozen intent", async () => {
	const storage = sharedDraftStorage();
	const fetch = vi
		.fn()
		.mockImplementation((_url, init) =>
			init?.method === "POST"
				? Promise.reject(new TypeError("lost ack"))
				: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
		);
	const a = await open({ prepare: storage.prepare, fetch });
	await a.pick(0);
	await a.type("Unknown exact text");
	await a.click(".prx-review-submit");
	await settle();
	const submitted = posts(a)[0],
		[key, raw] = [...storage.values.entries()][0];
	expect(key).toBe(`praxity-review-outbox:${reviewId}:page:${submitted.requestId}`);
	expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
		"anchor",
		"body",
		"draftId",
		"requestId",
		"savedAt",
	]);
	const b = await open({ prepare: storage.prepare, fetch: vi.fn(fetch.getMockImplementation()) }),
		c = await open({ prepare: storage.prepare, fetch: vi.fn(fetch.getMockImplementation()) });
	for (const ui of [b, c]) {
		expect(ui.doc.querySelectorAll(".prx-review-discard-draft")).toHaveLength(0);
		await ui.click(".prx-review-retry-outbox");
	}
	for (const ui of [b, c]) {
		await ui.click(".prx-review-submit");
		await settle();
		expect(posts(ui)[0]).toEqual(submitted);
	}
});
it("a crash after outbox write hides only its equal predecessor draft", async () => {
	const a = await open();
	await a.pick(0);
	await a.type("Crash text");
	await a.click(".prx-review-cancel");
	const [draftKey, draftRaw] = Object.entries(a.win.localStorage)[0];
	const draftId = draftKey.split(":").at(-1),
		requestId = "22222222-2222-4222-8222-222222222222";
	const outbox = { ...JSON.parse(draftRaw), draftId, requestId };
	const b = await open({
		stored: [
			[draftKey, draftRaw],
			[`praxity-review-outbox:${reviewId}:page:${requestId}`, JSON.stringify(outbox)],
		],
	});
	expect(b.doc.querySelectorAll(".prx-review-open-draft")).toHaveLength(0);
	expect(b.doc.querySelectorAll(".prx-review-retry-outbox")).toHaveLength(1);
	expect(b.doc.querySelector(".prx-review-drafts")?.textContent).toContain("Not confirmed. Retry");
	await b.click(".prx-review-retry-outbox");
	await b.click(".prx-review-submit");
	await settle();
	expect(Object.keys(b.win.localStorage)).toEqual([]);
});
it("full-anchor matching keeps a previous revision reachable without replacing the admitted anchor", async () => {
	const a = await open();
	await a.pick();
	await a.type("Earlier revision");
	await a.click(".prx-review-cancel");
	const b = await open({ stored: Object.entries(a.win.localStorage), revision: "new-revision" });
	await b.pick();
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
	await b.type("New revision");
	await b.click(".prx-review-submit");
	await settle();
	expect(posts(b)[0].anchor.revision).toBe("new-revision");
	await b.click(".prx-review-open-draft");
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Earlier revision");
	await b.click(".prx-review-submit");
	await settle();
	expect(posts(b)[1].anchor.revision).toBe("revision");
});
it.each(["open", "discard"])(
	"keeps focused %s draft controls through remote list refresh and Escape",
	async (action) => {
		const storage = sharedDraftStorage();
		const a = await open({ prepare: storage.prepare });
		await a.pick(0);
		await a.type("Original draft");
		await a.click(".prx-review-cancel");
		const selector = action === "open" ? ".prx-review-open-draft" : ".prx-review-discard-draft";
		const control = a.doc.querySelector<HTMLButtonElement>(selector) as HTMLButtonElement;
		control.focus();
		const b = await open({ prepare: storage.prepare });
		await b.pick();
		await b.type("Other target");
		storage.deliver();
		expect(a.doc.activeElement).toBe(control);
		(a.doc.querySelector(".prx-review-open-draft") as HTMLButtonElement).click();
		a.doc
			.querySelector(".prx-review-composer")
			?.dispatchEvent(new a.win.Event("cancel", { cancelable: true }));
		expect(a.doc.activeElement).toBe(a.doc.querySelector(".prx-review-open-draft"));
	},
);

function sharedDraftStorage() {
	const values = new Map<string, string>();
	const locks = testLocks();
	let paused:
		| { operation: string; action: () => void; matches: (key: string) => boolean }
		| undefined;
	let putsFail = false,
		outboxPutsFail = false,
		removalsFail = false;
	let capacity = Infinity;
	const removals: string[] = [];
	function pause(operation: string, key: string) {
		if (paused?.operation === operation && paused.matches(key)) {
			const action = paused.action;
			paused = undefined;
			action();
		}
	}
	const windows: JSDOM["window"][] = [];
	const events: (() => void)[] = [];
	return {
		values,
		locks,
		removals,
		limitStorage(characters: number) {
			capacity = characters;
		},
		failPuts(value: boolean, outboxOnly = false) {
			putsFail = value && !outboxOnly;
			outboxPutsFail = value && outboxOnly;
		},
		failRemovals(value: boolean) {
			removalsFail = value;
		},
		pauseNext(
			operation: string,
			action: () => void,
			matches: (key: string) => boolean = () => true,
		) {
			paused = { operation, action, matches };
		},
		deliver() {
			for (const deliver of events.splice(0)) deliver();
		},
		prepare(dom: JSDOM) {
			const win = dom.window;
			let alive = true;
			win.addEventListener("pagehide", () => {
				alive = false;
			});
			Object.defineProperty(win.navigator, "locks", {
				value: {
					request: (name: string, callback: () => unknown) =>
						locks.request(name, () => (alive ? callback() : undefined)),
				},
				configurable: true,
			});
			windows.push(win);
			function change(key: string, value: string | null) {
				const oldValue = values.get(key) ?? null;
				if (value === null) values.delete(key);
				else values.set(key, value);
				if (oldValue === value) return;
				for (const other of windows)
					if (other !== win)
						events.push(() =>
							other.dispatchEvent(
								new other.StorageEvent("storage", { key, oldValue, newValue: value }),
							),
						);
			}
			Object.defineProperty(win, "localStorage", {
				value: {
					get length() {
						return values.size;
					},
					key: (index: number) => [...values.keys()][index] ?? null,
					getItem: (key: string) => {
						pause("getItem", key);
						return values.get(key) ?? null;
					},
					setItem: (key: string, value: string) => {
						expect(
							locks.held.has(
								`praxity-review:${reviewId}:${key.slice(key.indexOf(reviewId) + reviewId.length + 1, -37)}`,
							),
						).toBe(true);
						pause("setItem", key);
						const size = [...values].reduce(
							(total, [storedKey, raw]) =>
								total + (storedKey === key ? 0 : storedKey.length + raw.length),
							key.length + value.length,
						);
						if (putsFail || (outboxPutsFail && key.startsWith("praxity-review-outbox:")))
							throw new win.DOMException("Quota", "QuotaExceededError");
						if (size > capacity) throw new win.DOMException("Quota", "QuotaExceededError");
						change(key, String(value));
					},
					removeItem: (key: string) => {
						expect(
							locks.held.has(
								`praxity-review:${reviewId}:${key.slice(key.indexOf(reviewId) + reviewId.length + 1, -37)}`,
							),
						).toBe(true);
						pause("removeItem", key);
						removals.push(key);
						if (removalsFail) throw new win.DOMException("Denied", "SecurityError");
						change(key, null);
					},
				},
			});
		},
	};
}

it("announces quota failure once across repeated edits and skips malformed entries", async () => {
	const ui = await open({
		prepare(dom) {
			Object.defineProperty(dom.window, "localStorage", {
				value: {
					length: 1,
					key: () => `praxity-review-draft:${reviewId}:bad`,
					getItem: (key: string) => (key.endsWith(":bad") ? "{bad" : null),
					setItem() {
						throw new Error("quota");
					},
					removeItem() {},
				},
			});
		},
	});
	await ui.pick(0);
	expect(ui.doc.querySelector<HTMLElement>(".prx-review-storage-error")?.hidden).toBe(true);
	const messages: string[] = [];
	const observer = new ui.win.MutationObserver(() => {
		const text = ui.doc.querySelector(".prx-review-composer-status")?.textContent;
		if (text) messages.push(text);
	});
	observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
		childList: true,
	});
	for (const body of ["a", "ab", "abc"]) {
		await ui.type(body);
		await settle();
	}
	expect(messages).toEqual([
		"Drafts cannot be saved in this browser. Keep this page open until your comment is saved.",
	]);
	observer.disconnect();
});
it("selection opens one composer and saves the literal quote anchor, then focuses the thread", async () => {
	const ui = await open();
	ui.selection();
	const button = ui.doc.querySelector(".prx-review-selection") as HTMLButtonElement;
	expect(button.hidden).toBe(false);
	const down = new ui.win.MouseEvent("mousedown", { bubbles: true, cancelable: true });
	button.dispatchEvent(down);
	expect(down.defaultPrevented).toBe(true);
	button.click();
	expect(button.hidden).toBe(true);
	expect(ui.doc.activeElement).toBe(ui.doc.querySelector("textarea"));
	expect(ui.doc.querySelector(".prx-review-composer blockquote")?.textContent).toBe(
		"Read this passage.",
	);
	await ui.type("  Literal comment  ");
	await ui.click(".prx-review-submit");
	await ui.click(".prx-review-submit");
	await settle();
	const posts = ui.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
	expect(posts).toHaveLength(1);
	expect(JSON.parse(posts[0][1].body)).toEqual({
		reviewId,
		requestId: expect.any(String),
		body: "  Literal comment  ",
		anchor: {
			courseId: null,
			lessonId: "lesson",
			pageId: "page",
			nodeId: "node",
			blockId: "block",
			revision: "revision",
			quote: { type: "TextQuoteSelector", exact: "Read this passage.", prefix: "", suffix: "" },
			pin: null,
			tab: null,
			revealPath: [],
			cssPath: null,
			context: { pageTitle: "Page title", targetLabel: "Read this passage." },
		},
	});
	expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(false);
	expect(ui.doc.activeElement).toBe(ui.doc.querySelector(".prx-review-comment"));
	expect(ui.doc.querySelector(".prx-review-status")?.textContent).toBe("Comment saved.");
	expect(Object.keys(ui.win.localStorage)).toEqual([]);
});
it("refuses an oversized selection without a clipped quote", async () => {
	const ui = await open({ markup: `<p data-node-id="node">${"x".repeat(2001)}</p>` });
	ui.selection();
	const button = ui.doc.querySelector<HTMLButtonElement>(".prx-review-selection");
	expect(button?.disabled).toBe(true);
	expect(button?.hidden).toBe(false);
	expect(ui.doc.getElementById(button?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
		"This selection cannot be used. Select up to 2000 characters of course text.",
	);
	await ui.click(".prx-review-choose");
	expect(ui.doc.querySelector("fieldset")?.textContent).not.toContain("xxx");
});
it("orders picker targets, defaults to the first visible block and returns focus on Escape", async () => {
	const ui = await open({
		markup:
			'<p data-block-type="text" data-node-id="one" data-block-id="one">First prose</p><section data-block-type="note" data-block-id="two" data-node-id="two"><h2>Second heading</h2><p data-block-id="nested">Nested</p></section>',
	});
	await ui.click(".prx-review-choose");
	expect(Array.from(ui.doc.querySelectorAll(".prx-review-target"), (el) => el.textContent)).toEqual(
		["Whole page", "Text: First prose", "Note: Second heading"],
	);
	expect(ui.doc.activeElement).toBe(ui.doc.querySelectorAll("input[type=radio]")[1]);
	ui.doc
		.querySelector(".prx-review-picker")
		?.dispatchEvent(new ui.win.Event("cancel", { cancelable: true }));
	expect(ui.doc.activeElement).toBe(ui.doc.querySelector(".prx-review-choose"));
	ui.selection();
	await ui.click(".prx-review-choose");
	expect(ui.doc.querySelector(".prx-review-target")?.textContent).toBe(
		"Selected text: “First prose”",
	);
});
it.each([["canvas", "<canvas>Private graphic fallback</canvas>"]])(
	"offers and captures identity-only %s targets without quote text",
	async (_kind, markup) => {
		const ui = await open({
			markup: markup.replace(
				/^<([a-z]+)/,
				'<$1 data-node-id="node" data-block-id="block" data-block-type="button"',
			),
		});
		await ui.pick();
		await ui.type("Review target");
		await ui.click(".prx-review-submit");
		await settle();
		const post = ui.fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
		const payload = JSON.parse(post?.[1].body);
		expect(payload.anchor).toMatchObject({
			nodeId: "node",
			blockId: "block",
			quote: null,
			context: { targetLabel: null },
		});
		expect(JSON.stringify(payload)).not.toContain("Private");
	},
);
it.each(["navigation", "link"])(
	"captures real %s Button projections once and excludes their text",
	async (kind) => {
		const markup = renderBlockHtml({
			id: "action",
			type: "button",
			data: {
				text: "Authored button label",
				...(kind === "navigation"
					? { action: "goToPage", targetPageId: "other" }
					: { href: "https://example.com" }),
			},
		});
		const ui = await open({ markup });
		const api = (
			ui.win as unknown as {
				PraxityReview: {
					fromSelection(range: Range): ReviewAnchor | null;
					fromPin(el: Element, x: number, y: number): ReviewAnchor;
					resolve(anchor: ReviewAnchor): { state: string; target: Element };
				};
			}
		).PraxityReview;
		const control = ui.doc.querySelector(".praxity-button") as Element;
		const selected = ui.doc.createRange();
		selected.selectNodeContents(control);
		expect(api.fromSelection(selected)).toBeNull();
		const anchor = api.fromPin(control, 100, 110);
		expect(anchor).toMatchObject({ nodeId: "action", quote: null, context: { targetLabel: null } });
		expect(api.resolve(anchor)).toMatchObject({ state: "placed", target: control });
	},
);
it.each([
	{
		type: "tabs",
		selector: '[role="tab"]',
		id: "tab-one",
		label: "Authored tab",
		expected: "Tab: Authored tab",
		data: { items: [{ id: "tab-one", label: "Authored tab", children: [] }] },
	},
	{
		type: "accordion",
		selector: "[data-disclosure-label]",
		id: "section-one",
		label: "Authored section",
		expected: "Section: Authored section",
		data: { items: [{ id: "section-one", label: "Authored section", children: [] }] },
	},
	{
		type: "assessment",
		selector: ".praxity-order-item",
		id: "order-one",
		label: "Authored order item",
		expected: "Item: Authored order item",
		data: {
			assessmentType: "order",
			stem: [],
			response: { type: "sequence", items: [{ id: "order-one", label: "Authored order item" }] },
		},
	},
])("offers real nested $type identities and resolves their pins", async (item) => {
	const markup = renderBlockHtml({ id: "parent", type: item.type as "tabs", data: item.data });
	const ui = await open({ markup });
	await ui.click(".prx-review-choose");
	const labels = Array.from(ui.doc.querySelectorAll(".prx-review-target"), (el) => el.textContent);
	expect(labels.at(-1)).toBe(item.expected);
	const api = (
		ui.win as unknown as {
			PraxityReview: {
				fromPin(el: Element, x: number, y: number): ReviewAnchor;
				resolve(anchor: ReviewAnchor): { state: string };
			};
		}
	).PraxityReview;
	const target = ui.doc.querySelector(item.selector) as Element;
	const anchor = api.fromPin(target, 100, 110);
	expect(anchor).toMatchObject({
		nodeId: item.id,
		blockId: "parent",
		quote: null,
		context: { targetLabel: item.label },
	});
	expect(api.resolve(anchor).state).toBe("placed");
});
it("pin capture blocks every learner pointer event, stays active on refusal, then cancels to Pin", async () => {
	const ui = await open({
		markup:
			'<p data-node-id="node" data-block-id="block"><a href="#destination">A link</a><button>Action</button></p>',
	});
	const link = ui.doc.querySelector("main a") as HTMLElement;
	const action = ui.doc.querySelector("main button") as HTMLElement;
	const activated = vi.fn();
	link.addEventListener("click", activated);
	action.addEventListener("click", activated);
	await ui.click(".prx-review-pin");
	for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart"]) {
		const event = new ui.win.MouseEvent(name, { bubbles: true, cancelable: true });
		link.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(name !== "touchstart");
	}
	action.click();
	expect(activated).not.toHaveBeenCalled();
	expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(true);
	await ui.click(".prx-review-cancel");
	await ui.click(".prx-review-pin");
	ui.doc
		.querySelector("h1")
		?.dispatchEvent(new ui.win.MouseEvent("click", { bubbles: true, cancelable: true }));
	expect(ui.doc.querySelector(".prx-review-pin")?.getAttribute("aria-pressed")).toBe("true");
	ui.doc.dispatchEvent(new ui.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	expect(ui.doc.activeElement).toBe(ui.doc.querySelector(".prx-review-pin"));
	expect(ui.doc.querySelector(".prx-review-pin")?.getAttribute("aria-pressed")).toBe("false");
	link.click();
	expect(activated).toHaveBeenCalledTimes(1);
});
it("retains exact payload and request ID on repeated failure and Retry", async () => {
	const fetchMock = vi
		.fn()
		.mockImplementation((_url, init) =>
			init?.method === "POST"
				? Promise.reject(new TypeError("lost acknowledgement"))
				: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
		);
	const ui = await open({ fetch: fetchMock });
	await ui.pick(0);
	await ui.type("Kept exactly ");
	await ui.click(".prx-review-submit");
	await settle();
	const field = ui.doc.querySelector("textarea") as HTMLTextAreaElement;
	expect(field.value).toBe("Kept exactly ");
	expect(field.getAttribute("aria-describedby")).toContain("prx-review-error");
	expect(field.getAttribute("aria-invalid")).toBe("true");
	expect(ui.doc.querySelector(".prx-review-submit")?.textContent).toBe("Retry");
	await ui.click(".prx-review-submit");
	await settle();
	const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
	expect(posts).toHaveLength(2);
	expect(posts[1][1].body).toBe(posts[0][1].body);
	const announcements: string[] = [];
	const observer = new ui.win.MutationObserver(() =>
		announcements.push(ui.doc.querySelector(".prx-review-composer-status")?.textContent ?? ""),
	);
	observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
		childList: true,
	});
	await ui.click(".prx-review-submit");
	await settle();
	expect(announcements).toContain("");
	expect(announcements).toContain("Comment could not be posted.");
	observer.disconnect();
});
it.each([
	[400, "invalid_input", "The comment or its target is invalid."],
	[413, "body_too_large", "The comment exceeds the allowed size."],
	[409, "limit_reached", "This review has reached its comment limit."],
	[403, "forbidden", "This action is not permitted."],
	[404, "not_found", "Review or comment not found."],
])(
	"unlocks a definitive %i %s refusal and keeps its draft request ID after correction",
	async (status, code, message) => {
		let attempt = 0;
		const fetchMock = vi.fn().mockImplementation((_url, init) => {
			if (init?.method !== "POST")
				return Promise.resolve(reply({ ok: true, threads: [], nextCursor: null }));
			if (++attempt === 1) return Promise.resolve(reply({ ok: false, code }, Number(status)));
			const payload = JSON.parse(init.body);
			return Promise.resolve(
				reply({
					ok: true,
					thread: {
						id: "corrected",
						anchor: payload.anchor,
						status: "open",
						messages: [
							{ body: payload.body, actor: { displayName: "Reviewer" }, at: "2026-10-19" },
						],
					},
				}),
			);
		});
		const ui = await open({ fetch: fetchMock });
		await ui.pick(0);
		await ui.type("First intent");
		const originalDraftKey = Object.keys(ui.win.localStorage)[0];
		await ui.click(".prx-review-submit");
		await settle();
		const field = ui.doc.querySelector("textarea") as HTMLTextAreaElement;
		expect(field.readOnly).toBe(false);
		expect(field.value).toBe("First intent");
		expect(ui.doc.querySelector(".prx-review-error")?.textContent).toBe(message);
		const editable = Object.entries(ui.win.localStorage);
		expect(editable).toHaveLength(1);
		expect(editable[0][0]).toBe(originalDraftKey);
		expect(editable[0][0]).toContain("praxity-review-draft:");
		expect(Object.keys(JSON.parse(editable[0][1])).sort()).toEqual(["anchor", "body", "savedAt"]);
		expect(JSON.parse(editable[0][1]).body).toBe("First intent");
		await ui.type("Corrected intent");
		await ui.click(".prx-review-submit");
		await settle();
		const posts = fetchMock.mock.calls
			.filter(([, init]) => init?.method === "POST")
			.map(([, init]) => JSON.parse(init.body));
		expect(posts[1].requestId).toBe(posts[0].requestId);
		expect(posts[1].body).toBe("Corrected intent");
	},
);
it.each(["bad\u000btext", "bad\u0000text", "bad\ud800text"])(
	"refuses C1-invalid body text locally: %s",
	async (body) => {
		const ui = await open();
		await ui.pick(0);
		await ui.type(body);
		await ui.click(".prx-review-submit");
		await settle();
		expect(ui.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
		expect((ui.doc.querySelector("textarea") as HTMLTextAreaElement).readOnly).toBe(false);
	},
);
it("persists drafts without a capability, restores after reload/new capability, and explicitly discards", async () => {
	const ui = await open();
	await ui.pick(0);
	await ui.type("Unsent exact text");
	await ui.click(".prx-review-cancel");
	expect(ui.doc.querySelector(".prx-review-draft-count")?.textContent).toBe("Drafts: 1");
	const stored = Object.entries(ui.win.localStorage);
	expect(stored).toHaveLength(1);
	expect(stored[0][0]).toMatch(
		/^praxity-review-draft:11111111-1111-4111-8111-111111111111:page:[0-9a-f-]{36}$/,
	);
	expect(stored[0][1]).not.toContain(capability);
	expect(JSON.parse(stored[0][1])).toMatchObject({
		body: "Unsent exact text",
		savedAt: expect.any(String),
		anchor: { pageId: "page" },
	});
	expect(Object.keys(JSON.parse(stored[0][1])).sort()).toEqual(["anchor", "body", "savedAt"]);
	const reloaded = await open({ stored, capability: "B".repeat(43) });
	expect(reloaded.doc.querySelector(".prx-review-drafts")?.textContent).toContain("Unsent draft");
	await reloaded.click(".prx-review-open-draft");
	expect((reloaded.doc.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
		"Unsent exact text",
	);
	await reloaded.click(".prx-review-cancel");
	await reloaded.click(".prx-review-discard-draft");
	expect(Object.keys(reloaded.win.localStorage)).toEqual([]);
});
it("keeps the composer usable and explains storage failure", async () => {
	const ui = await open({ brokenStorage: true });
	const messages: string[] = [];
	const observer = new ui.win.MutationObserver(() => {
		const text = ui.doc.querySelector(".prx-review-composer-status")?.textContent;
		if (text) messages.push(text);
	});
	observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
		childList: true,
	});
	await ui.pick(0);
	await ui.type("Still usable");
	await settle();
	expect(messages).toEqual([
		"Drafts cannot be saved in this browser. Keep this page open until your comment is saved.",
	]);
	expect(ui.doc.querySelector("textarea")?.getAttribute("aria-describedby")?.split(" ")).toContain(
		"prx-review-storage-error",
	);
	expect(ui.doc.querySelector(".prx-review-storage-error")?.textContent).toBe(
		"Drafts cannot be saved in this browser. Keep this page open until your comment is saved.",
	);
	await ui.click(".prx-review-submit");
	await settle();
	expect(ui.doc.querySelectorAll(".prx-review-comment")).toHaveLength(1);
	expect(ui.doc.querySelectorAll(".prx-review-open-draft")).toHaveLength(0);
	observer.disconnect();
});
it("retains failed submission identity across reload with a new capability", async () => {
	const fetchMock = vi
		.fn()
		.mockImplementation((_url, init) =>
			init?.method === "POST"
				? Promise.reject(new TypeError("lost reply"))
				: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
		);
	const ui = await open({ fetch: fetchMock });
	await ui.pick(0);
	await ui.type("An unknown outcome");
	await ui.click(".prx-review-submit");
	await settle();
	await ui.click(".prx-review-cancel");
	const original = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1].body;
	const reloaded = await open({
		stored: Object.entries(ui.win.localStorage),
		capability: "B".repeat(43),
	});
	await reloaded.click(".prx-review-retry-outbox");
	await reloaded.click(".prx-review-submit");
	await settle();
	expect(reloaded.fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1].body).toBe(
		original,
	);
});
it("keeps separate page drafts on slide navigation and isolates dialog keys from the course", async () => {
	const ui = await open();
	await ui.pick(0);
	await ui.type("First page draft");
	const courseKey = vi.fn();
	ui.doc.addEventListener("keydown", courseKey);
	ui.doc
		.querySelector("textarea")
		?.dispatchEvent(new ui.win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
	expect(courseKey).not.toHaveBeenCalled();
	const navigate = (pageId: string) =>
		ui.win.dispatchEvent(
			new ui.win.CustomEvent("praxity:active-page-change", { detail: { pageId } }),
		);
	navigate("other");
	await settle();
	await ui.pick(0);
	await ui.type("Other page draft");
	navigate("page");
	await settle();
	await ui.click(".prx-review-open-draft");
	expect((ui.doc.querySelector("textarea") as HTMLTextAreaElement).value).toBe("First page draft");
	expect(ui.win.localStorage.length).toBe(2);
});
it.each([false, true])(
	"removes an emptied draft without restoring old text (quota=%s)",
	async (quota) => {
		const storage = sharedDraftStorage(),
			ui = await open({ prepare: storage.prepare });
		await ui.pick(0);
		await ui.type("Old text");
		if (quota) {
			storage.failPuts(true);
			await ui.type("New quota revision");
		}
		await ui.type("");
		await ui.click(".prx-review-cancel");
		expect(records(storage)).toHaveLength(0);
		expect(ui.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
		const reloaded = await open({ prepare: storage.prepare });
		expect(reloaded.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
		await reloaded.pick(0);
		expect((reloaded.doc.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
	},
);
it("an emptied quota successor stays blocked until its durable predecessor can retire", async () => {
	const storage = sharedDraftStorage(),
		ui = await open({ prepare: storage.prepare });
	await ui.pick(0);
	await ui.type("Durable baseline");
	storage.failPuts(true);
	await ui.type("Volatile edit");
	storage.failRemovals(true);
	await ui.type("");
	expect(bodies(storage)).toEqual(["Durable baseline"]);
	expect(ui.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"The saved draft could not be safely removed. Keep this page open, allow browser storage, then retry.",
	);
	storage.failRemovals(false);
	await ui.click(".prx-review-cancel");
	expect(records(storage)).toHaveLength(0);
	expect(ui.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
});
it("clearing a quota successor preserves another tab's replacement of its predecessor", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Durable baseline");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	storage.failPuts(true);
	await a.pick(0);
	await a.type("Volatile edit");
	storage.failPuts(false);
	await b.type("Other tab's replacement");
	await a.type("");
	await a.click(".prx-review-cancel");
	expect(bodies(storage)).toEqual(["Other tab's replacement"]);
});
it("clearing a conflicted draft keeps the other tab's text without announcing a fork", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Base");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	await a.pick(0);
	await a.type("Base edited in A");
	await b.type("");
	expect(bodies(storage)).toEqual(["Base edited in A"]);
	expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe("");
	expect(b.doc.querySelector(".prx-review-composer-status")?.textContent).toBe("");
});
it("Retry never sends an outbox retired by another tab's refusal and discard", async () => {
	const storage = sharedDraftStorage(),
		held = heldPost(),
		a = await open({ prepare: storage.prepare, fetch: held.fetch });
	await a.pick(0);
	await a.type("Retired submission");
	await a.click(".prx-review-submit");
	const b = await open({ prepare: storage.prepare });
	await b.click(".prx-review-retry-outbox");
	held.respond(reply({ ok: false, code: "limit_reached" }, 409));
	await settle();
	await a.click(".prx-review-cancel");
	await a.click(".prx-review-discard-draft");
	storage.deliver();
	await settle();
	expect(records(storage)).toHaveLength(0);
	await b.click(".prx-review-submit");
	expect(posts(b)).toHaveLength(0);
	expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"This draft was sent or discarded in another tab.",
	);
	expect(b.doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.disabled).toBe(true);
});
it("refuses over-limit save and announces character count only at thresholds", async () => {
	const ui = await open();
	await ui.pick(0);
	await ui.type("x".repeat(1799));
	expect(ui.doc.querySelector(".prx-review-composer-status")?.textContent).toBe("");
	await ui.type("x".repeat(1800));
	await settle();
	expect(ui.doc.querySelector(".prx-review-composer-status")?.textContent).toBe("1800 / 2000");
	await ui.type("x".repeat(1801));
	expect(ui.doc.querySelector(".prx-review-composer-status")?.textContent).toBe("1800 / 2000");
	await ui.type("x".repeat(2001));
	await ui.click(".prx-review-submit");
	expect(ui.doc.querySelector(".prx-review-error")?.textContent).toBe(
		"Use at most 2000 characters.",
	);
	expect(ui.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});
it.each([".prx-review-choose", ".prx-review-pin"])(
	"keeps %s focused when a deferred list arrives",
	async (selector) => {
		let complete!: (reply: Response) => void;
		const ui = await open({
			fetch: vi.fn().mockImplementation(
				() =>
					new Promise<Response>((resolve) => {
						complete = resolve;
					}),
			),
		});
		const action = ui.doc.querySelector<HTMLElement>(selector) as HTMLElement;
		action.focus();
		complete(reply({ ok: true, threads: [], nextCursor: null }));
		await settle();
		expect(ui.doc.activeElement).toBe(action);
	},
);
it("does not lock or trap another target's composer behind an earlier pending send", async () => {
	const fetchMock = vi
		.fn()
		.mockImplementation((_url, init) =>
			init?.method === "POST"
				? new Promise(() => {})
				: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
		);
	const ui = await open({ fetch: fetchMock });
	await ui.pick(0);
	await ui.type("First page");
	await ui.click(".prx-review-submit");
	ui.win.dispatchEvent(
		new ui.win.CustomEvent("praxity:active-page-change", { detail: { pageId: "other" } }),
	);
	await settle();
	await ui.pick(0);
	expect((ui.doc.querySelector(".prx-review-cancel") as HTMLButtonElement).disabled).toBe(false);
	ui.doc
		.querySelector(".prx-review-composer")
		?.dispatchEvent(new ui.win.Event("cancel", { cancelable: true }));
	expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(false);
});
it("surfaces a failed send after a native non-cancelable close", async () => {
	let reject!: (error: Error) => void;
	const fetchMock = vi.fn().mockImplementation((_url, init) =>
		init?.method === "POST"
			? new Promise((_resolve, fail) => {
					reject = fail;
				})
			: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
	);
	const ui = await open({ fetch: fetchMock });
	await ui.pick(0);
	await ui.type("Pending text");
	await ui.click(".prx-review-submit");
	const dialog = ui.doc.querySelector<HTMLDialogElement>(
		".prx-review-composer",
	) as HTMLDialogElement;
	dialog.close();
	reject(new TypeError("lost reply"));
	await settle();
	expect(ui.doc.querySelector(".prx-review-status")?.textContent).toBe(
		"Comment could not be posted.",
	);
});
it("captures touch on pointerup without cancelling touchstart and blocks auxiliary link activation", async () => {
	const ui = await open({
		markup: '<p data-node-id="node" data-block-id="block"><a href="#destination">A link</a></p>',
	});
	await ui.click(".prx-review-pin");
	const link = ui.doc.querySelector("main a") as HTMLElement;
	const start = new ui.win.Event("touchstart", { bubbles: true, cancelable: true });
	link.dispatchEvent(start);
	expect(start.defaultPrevented).toBe(false);
	const auxiliary = new ui.win.MouseEvent("auxclick", { bubbles: true, cancelable: true });
	link.dispatchEvent(auxiliary);
	expect(auxiliary.defaultPrevented).toBe(true);
	const up = new ui.win.MouseEvent("pointerup", {
		bubbles: true,
		cancelable: true,
		clientX: 100,
		clientY: 110,
	});
	Object.defineProperty(up, "pointerType", { value: "touch" });
	link.dispatchEvent(up);
	expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(true);
	const compatibilityClick = new ui.win.MouseEvent("click", { bubbles: true, cancelable: true });
	link.dispatchEvent(compatibilityClick);
	expect(compatibilityClick.defaultPrevented).toBe(true);
	await ui.click(".prx-review-cancel");
	const nextClick = new ui.win.MouseEvent("click", { bubbles: true, cancelable: true });
	link.dispatchEvent(nextClick);
	expect(nextClick.defaultPrevented).toBe(false);
});
it.each([
	["en", "Earlier drafts may be unavailable. New drafts may not survive a restart.", "Drafts: 1"],
	[
		"fr",
		"Des brouillons ant\u00e9rieurs peuvent manquer. Les nouveaux brouillons peuvent ne pas survivre au red\u00e9marrage.",
		"Brouillons\u202f: 1",
	],
])(
	"shows both directions of the fallback warning while collapsed and in the %s composer",
	async (locale, warning, badge) => {
		const ui = await open({ locale, draftOriginChanged: true });
		const toggle = ui.doc.querySelector(".prx-review-toggle") as HTMLElement;
		expect(toggle.querySelector(".prx-review-draft-origin")?.textContent).toBe(warning);
		expect(toggle.getAttribute("aria-label")).toContain(warning);
		await ui.pick(0);
		const note = ui.doc.querySelector(".prx-review-composer-origin") as HTMLElement;
		expect(note.hidden).toBe(false);
		expect(note.textContent).toBe(warning);
		expect(
			ui.doc.querySelector("textarea")?.getAttribute("aria-describedby")?.split(" "),
		).toContain(note.id);
		await ui.type("One draft");
		await ui.click(".prx-review-cancel");
		expect(ui.doc.querySelector(".prx-review-draft-count")?.textContent).toBe(badge);
	},
);
it("names picker kinds and composer actions in French", async () => {
	const ui = await open({
		locale: "fr",
		markup:
			'<p data-block-type="assessment" data-block-id="question" data-node-id="question">Une question</p><p data-block-type="unknown" data-block-id="unknown" data-node-id="unknown">Un passage</p>',
	});
	await ui.click(".prx-review-choose");
	expect(ui.doc.querySelector(".prx-review-picker h2")?.textContent).toBe(
		"Choisir la cible du commentaire",
	);
	expect(Array.from(ui.doc.querySelectorAll(".prx-review-target"), (el) => el.textContent)).toEqual(
		["Toute la page", "Évaluation\u202f: Une question", "Bloc\u202f: Un passage"],
	);
	await ui.click(".prx-review-next");
	expect(ui.doc.querySelector(".prx-review-submit")?.textContent).toBe(
		"Enregistrer le commentaire",
	);
	await ui.type("À vérifier");
	await ui.click(".prx-review-submit");
	await settle();
	expect(ui.doc.querySelector(".prx-review-status")?.textContent).toBe("Commentaire enregistré.");
});
it("uses French quote and target templates with narrow no-break spaces", async () => {
	const ui = await open({ locale: "fr" });
	ui.selection();
	await ui.click(".prx-review-choose");
	expect(ui.doc.querySelector(".prx-review-target")?.textContent).toBe(
		"Texte sélectionné\u202f: «\u202fRead this passage.\u202f»",
	);
	(ui.doc.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).checked = true;
	await ui.click(".prx-review-next");
	expect(ui.doc.querySelector(".prx-review-composer h2")?.textContent).toBe(
		"Commentaire sur toute la page",
	);
});
it("uses a narrow no-break space before the French moved-target question mark", async () => {
	const ui = await open({ locale: "fr" });
	ui.selection();
	ui.click(".prx-review-selection");
	ui.type("À vérifier");
	ui.click(".prx-review-submit");
	await settle();
	const target = ui.doc.querySelector("main p") as Element;
	target.removeAttribute("data-node-id");
	target.removeAttribute("data-block-id");
	await settle();
	ui.flushFrames();
	expect(ui.doc.querySelector(".prx-review-anchor-status")?.textContent).toBe(
		"⚠ Déplacé ou modifié\u202f?",
	);
});
it("pins tab titles and their panels at equal fractions without substituting either anchor", async () => {
	const markup = renderBlockHtml({
		id: "tabs",
		type: "tabs",
		data: { items: [{ id: "one", label: "Authored tab", children: [] }] },
	});
	const ui = await open({ markup });
	const targets = [
		ui.doc.querySelector('[role="tab"]'),
		ui.doc.querySelector('[role="tabpanel"]'),
	] as Element[];
	const api = (
		ui.win as unknown as {
			PraxityReview: { fromPin(el: Element, x: number, y: number): ReviewAnchor };
		}
	).PraxityReview;
	const anchors = targets.map((el) => api.fromPin(el, 210, 120));
	expect(anchors[0].tab).toBeNull();
	expect(anchors[1].tab).toBe(targets[1].id);
	for (const [index, target] of targets.entries()) {
		await ui.click(".prx-review-pin");
		target.dispatchEvent(
			new ui.win.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				clientX: 210,
				clientY: 120,
			}),
		);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
		await ui.type(index === 0 ? "Title draft" : "Panel draft");
		await ui.click(".prx-review-cancel");
	}
	expect(ui.win.localStorage.length).toBe(2);
	for (const body of ["Title draft", "Panel draft"]) {
		const row = [...ui.doc.querySelectorAll(".prx-review-draft")].find(
			(node) => node.querySelector(".prx-review-draft-body")?.textContent === body,
		) as Element;
		(row.querySelector(".prx-review-open-draft") as HTMLButtonElement).click();
		await ui.click(".prx-review-submit");
		await settle();
	}
	expect(posts(ui).map((payload) => payload.anchor)).toEqual(anchors);
});
it("reordered real order items capture authored identity without storing their answer position", async () => {
	const ui = await open({
		markup: renderBlockHtml({
			id: "order",
			type: "assessment",
			data: {
				assessmentType: "order",
				stem: [],
				response: {
					type: "sequence",
					items: [
						{ id: "first", label: "Authored first" },
						{ id: "second", label: "Authored second" },
					],
				},
			},
		}),
	});
	const item = ui.doc.querySelector('[data-node-id="first"]') as Element;
	item.parentElement?.append(item);
	const api = (
		ui.win as unknown as {
			PraxityReview: {
				fromPin(el: Element, x: number, y: number): ReviewAnchor;
				fromBlock(el: Element): ReviewAnchor;
			};
		}
	).PraxityReview;
	await ui.click(".prx-review-choose");
	const radio = [...ui.doc.querySelectorAll<HTMLLabelElement>(".prx-review-target")]
		.find((label) => label.textContent === "Item: Authored first")
		?.querySelector("input") as HTMLInputElement;
	radio.checked = true;
	await ui.click(".prx-review-next");
	expect(ui.doc.querySelector(".prx-review-target-preview")?.textContent).toBe("Authored first");
	await ui.type("Item comment");
	await ui.click(".prx-review-submit");
	await settle();
	expect(posts(ui)[0].anchor).toMatchObject({
		nodeId: "first",
		cssPath: null,
		context: { targetLabel: "Authored first" },
	});
	const pin = api.fromPin(item.querySelector(".praxity-order-label") as Element, 210, 120);
	expect(pin.cssPath).toBeNull();
	expect(pin.pin?.path).not.toContain("li:nth-of-type");
	expect(pin.context.targetLabel).toBe("Authored first");
	const nodeless = ui.doc.createElement("p");
	nodeless.textContent = "Fallback prose";
	ui.doc.querySelector("main")?.append(nodeless);
	expect(api.fromBlock(nodeless).cssPath).toBe("p:nth-of-type(1)");
});
it.each(["pin", "quote"])(
	"resolves a hidden tab panel's %s to Not visible here and reveals its owner",
	async (kind) => {
		const markup = renderBlockHtml({
			id: "tabs",
			type: "tabs",
			data: {
				items: [
					{ id: "one", label: "First", children: [] },
					{ id: "two", label: "Second", children: [] },
				],
			},
		});
		const ui = await open({ markup });
		const panel = ui.doc.querySelector('[role="tabpanel"]') as HTMLElement;
		panel.innerHTML = "<p>Authored panel prose</p>";
		const api = (
			ui.win as unknown as {
				PraxityReview: {
					fromPin(el: Element, x: number, y: number): ReviewAnchor;
					fromSelection(range: Range): ReviewAnchor;
					resolve(anchor: ReviewAnchor): { state: string; target: Element };
				};
			}
		).PraxityReview;
		const range = ui.doc.createRange();
		range.selectNodeContents(panel.querySelector("p") as Element);
		const anchor = kind === "pin" ? api.fromPin(panel, 210, 120) : api.fromSelection(range);
		expect(api.resolve(anchor).state).toBe("placed");
		panel.hidden = true;
		expect(api.resolve(anchor)).toMatchObject({ state: "notVisible", target: panel });
		panel.hidden = false;
		expect(api.resolve(anchor).state).toBe("placed");
	},
);

it("Discard compares the displayed version and preserves an unseen replacement", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Initial text");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	await b.type("Replacement text");
	await a.click(".prx-review-discard-draft");
	expect(bodies(storage)).toEqual(["Replacement text"]);
	expect(a.doc.querySelector(".prx-review-status")?.textContent).toBe(
		"Another tab changed this draft. Reopen it before discarding.",
	);
});
it("skips old draft shapes and mismatched page/ID keys without reporting blocked storage", async () => {
	const a = await open();
	await a.pick(0);
	await a.type("Valid draft");
	await a.click(".prx-review-cancel");
	const [key, raw] = Object.entries(a.win.localStorage)[0];
	const b = await open({
		stored: [
			[key.replace(":page:", ":wrong:"), raw],
			[key, JSON.stringify({ ...JSON.parse(raw), requestId: null })],
			[key.replace(/.$/, "z"), raw],
		],
	});
	expect(b.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
	await b.pick(0);
	expect(b.doc.querySelector<HTMLElement>(".prx-review-storage-error")?.hidden).toBe(true);
});

function realReview() {
	let state: ReviewState = {
		schema: 1,
		reviewId,
		course: { namespace: null, bound: false },
		changeSeq: 0,
		threads: [],
		receipts: [],
	};
	let serial = Promise.resolve(),
		loseNext = false;
	const fetch = vi.fn().mockImplementation((_url, init) => {
		if (init?.method !== "POST")
			return Promise.resolve(reply({ ok: true, threads: state.threads, nextCursor: null }));
		const task = serial.then(async () => {
			const result = await createThread(
				state,
				{ id: "reviewer", displayName: "Reviewer", role: "reviewer", provenance: "local-preview" },
				JSON.parse(init.body),
				{ now: () => "2026-10-19T00:00:00.000Z", uuid: () => globalThis.crypto.randomUUID() },
			);
			if (!result.ok) return reply(result, refusalStatuses[result.code]);
			state = result.state;
			if (loseNext) {
				loseNext = false;
				throw new TypeError("Acknowledgement lost");
			}
			return reply({ ok: true, thread: result.thread, replayed: result.replayed });
		});
		serial = task.then(
			() => {},
			() => {},
		);
		return task;
	});
	return {
		fetch,
		state: () => state,
		idle: () => serial,
		loseNextReply() {
			loseNext = true;
		},
	};
}
it("two saves interleaved inside outbox setItem recover one established request and one C1 thread", async () => {
	const storage = sharedDraftStorage(),
		server = realReview();
	const a = await open({ prepare: storage.prepare, fetch: server.fetch });
	await a.pick(0);
	await a.type("One shared send");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare, fetch: server.fetch });
	await a.pick(0);
	await b.pick(0);
	let second!: Promise<void>;
	storage.pauseNext(
		"setItem",
		() => {
			second = b.click(".prx-review-submit");
		},
		(key) => key.startsWith("praxity-review-outbox:"),
	);
	await a.click(".prx-review-submit");
	await second;
	await settle();
	await server.idle();
	await settle();
	const requests = [...posts(a), ...posts(b)];
	expect(requests).toHaveLength(2);
	expect(new Set(requests.map((item) => item.requestId)).size).toBe(1);
	await server.idle();
	await settle();
	expect(server.state().threads).toHaveLength(1);
	expect(records(storage)).toHaveLength(0);
});
it("an edit interleaved inside Discard retains its changed text after the lock", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Original");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	let edit!: Promise<void>;
	storage.pauseNext("removeItem", () => {
		edit = b.type("New unsent text in B");
	});
	await a.click(".prx-review-discard-draft");
	await edit;
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("New unsent text in B");
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	await b.click(".prx-review-cancel");
	b.win.dispatchEvent(new b.win.Event("pagehide"));
	await settle();
	expect(bodies(storage)).toEqual(["New unsent text in B"]);
});
it("two edits interleaved inside setItem serialize and the later writer forks with both texts", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Baseline");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await a.pick(0);
	await b.pick(0);
	let edit!: Promise<void>;
	storage.pauseNext("setItem", () => {
		edit = b.type("Second writer");
	});
	await a.type("First writer");
	await edit;
	expect(bodies(storage)).toEqual(["First writer", "Second writer"]);
	expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"Another tab changed this draft. Your text was kept as a separate draft.",
	);
});
it.each([false, true])(
	"outbox quota failure retires its durable predecessor before sending (lost reply=%s)",
	async (lost) => {
		const storage = sharedDraftStorage(),
			server = realReview(),
			ui = await open({ prepare: storage.prepare, fetch: server.fetch });
		await ui.pick(0);
		await ui.type("Already persisted draft");
		const predecessor = [...storage.values.keys()][0];
		storage.failPuts(true, true);
		if (lost) server.loseNextReply();
		await ui.click(".prx-review-submit");
		await settle();
		expect(records(storage)).toHaveLength(0);
		expect(storage.removals).toContain(predecessor);
		await server.idle();
		await settle();
		expect(server.state().threads).toHaveLength(1);
		const reloaded = await open({ prepare: storage.prepare, fetch: server.fetch });
		expect(reloaded.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
		if (lost) {
			await ui.click(".prx-review-submit");
			await settle();
			expect(posts(ui)[1].requestId).toBe(posts(ui)[0].requestId);
		}
		await server.idle();
		await settle();
		expect(server.state().threads).toHaveLength(1);
	},
);
it.each(["send", "discard"])(
	"quota on another target never blocks %s removal of an older durable draft",
	async (action) => {
		const storage = sharedDraftStorage(),
			ui = await open({ prepare: storage.prepare });
		await ui.pick(0);
		await ui.type("Older durable text");
		await ui.click(".prx-review-cancel");
		storage.failPuts(true);
		await ui.pick();
		await ui.type("Quota-blocked new text");
		await ui.click(".prx-review-cancel");
		const row = [...ui.doc.querySelectorAll(".prx-review-draft")].find(
			(node) => node.querySelector(".prx-review-draft-body")?.textContent === "Older durable text",
		) as Element;
		(
			row.querySelector(
				action === "send" ? ".prx-review-open-draft" : ".prx-review-discard-draft",
			) as HTMLButtonElement
		).click();
		await settle();
		if (action === "send") {
			await ui.click(".prx-review-submit");
			await settle();
		}
		expect(records(storage)).toHaveLength(0);
		const next = await open({ prepare: storage.prepare });
		expect(next.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
	},
);
it("refuses a send when quota and removal refusal leave a durable predecessor; Retry removes it first", async () => {
	const storage = sharedDraftStorage(),
		ui = await open({ prepare: storage.prepare });
	await ui.pick(0);
	await ui.type("Do not duplicate");
	storage.failPuts(true, true);
	storage.failRemovals(true);
	await ui.click(".prx-review-submit");
	expect(posts(ui)).toHaveLength(0);
	expect(storage.values.size).toBe(1);
	expect(ui.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"The saved draft could not be safely removed. Keep this page open, allow browser storage, then retry.",
	);
	storage.failRemovals(false);
	await ui.click(".prx-review-submit");
	expect(posts(ui)).toHaveLength(1);
	expect(records(storage)).toHaveLength(0);
});
it.each(["cancel", "save", "pagehide"])(
	"a clean stale %s writes nothing after another tab changes its draft",
	async (action) => {
		const storage = sharedDraftStorage(),
			a = await open({ prepare: storage.prepare });
		await a.pick(0);
		await a.type("Original words");
		await a.click(".prx-review-cancel");
		const b = await open({ prepare: storage.prepare });
		await b.pick(0);
		await a.pick(0);
		await a.type("Original words, revised in A");
		await a.click(".prx-review-cancel");
		if (action === "pagehide") {
			b.win.dispatchEvent(new b.win.Event("pagehide"));
			await settle();
		} else {
			b.doc
				.querySelector<HTMLButtonElement>(
					action === "save" ? ".prx-review-submit" : ".prx-review-cancel",
				)
				?.focus();
			await b.click(action === "save" ? ".prx-review-submit" : ".prx-review-cancel");
		}
		expect(bodies(storage)).toEqual(["Original words, revised in A"]);
		expect(posts(b)).toHaveLength(0);
		if (action === "save") {
			expect(b.doc.activeElement).toBe(b.doc.querySelector(".prx-review-keep-new"));
			expect(b.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(
				"Another tab changed this draft. Reopen it to see the latest text.",
			);
		}
	},
);
it("every fork is announced even when the same session forks twice", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Baseline");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await a.pick(0);
	await b.pick(0);
	const messages: string[] = [],
		observer = new b.win.MutationObserver(() => {
			const text = b.doc.querySelector(".prx-review-composer-status")?.textContent;
			if (text) messages.push(text);
		});
	observer.observe(b.doc.querySelector(".prx-review-composer-status") as Node, { childList: true });
	await a.type("A revision");
	await b.type("B fork one");
	await a.click(".prx-review-cancel");
	await a.pick(0);
	await a.type("A changes B's draft");
	await b.type("B fork two");
	expect(messages).toEqual([
		"Another tab changed this draft. Your text was kept as a separate draft.",
		"Another tab changed this draft. Your text was kept as a separate draft.",
	]);
	observer.disconnect();
});
it("two definitive refusals of one outbox create only one editable draft", async () => {
	const storage = sharedDraftStorage();
	const unknown = vi
		.fn()
		.mockImplementation((_url, init) =>
			init?.method === "POST"
				? Promise.reject(new TypeError("lost"))
				: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
		);
	const a = await open({ prepare: storage.prepare, fetch: unknown });
	await a.pick(0);
	await a.type("One refusal");
	await a.click(".prx-review-submit");
	const resolvers: ((value: Response) => void)[] = [];
	const fetch = vi
		.fn()
		.mockImplementation((_url, init) =>
			init?.method === "POST"
				? new Promise<Response>((resolve) => resolvers.push(resolve))
				: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
		);
	const b = await open({ prepare: storage.prepare, fetch }),
		c = await open({ prepare: storage.prepare, fetch });
	for (const ui of [b, c]) {
		await ui.click(".prx-review-retry-outbox");
		await ui.click(".prx-review-submit");
	}
	resolvers.forEach((resolve) => resolve(reply({ ok: false, code: "limit_reached" }, 409)));
	await settle();
	expect(storage.values.size).toBe(1);
	expect([...storage.values.keys()][0]).toContain("praxity-review-draft:");
	expect(bodies(storage)).toEqual(["One refusal"]);
});
it("without Web Locks persists only in sessionStorage and explains the tab scope", async () => {
	const ui = await open({
		noLocks: true,
		prepare(dom) {
			Object.defineProperty(dom.window, "localStorage", {
				get() {
					throw new Error("No cross-tab storage access without locks");
				},
			});
		},
	});
	await ui.pick(0);
	await ui.type("Only this tab");
	await ui.click(".prx-review-cancel");
	expect(ui.win.sessionStorage.length).toBe(1);
	await ui.pick(0);
	expect(ui.doc.querySelector(".prx-review-tab-warning")?.textContent).toBe(
		"Coordination between tabs is unavailable. Drafts are kept only in this tab.",
	);
	expect(ui.doc.querySelector<HTMLElement>(".prx-review-tab-warning")?.hidden).toBe(false);
	expect(ui.doc.querySelector("textarea")?.getAttribute("aria-describedby")).toContain(
		"prx-review-tab-warning",
	);
	const next = await open({ noLocks: true, stored: Object.entries(ui.win.sessionStorage) });
	await next.pick(0);
	expect(next.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Only this tab");
});

it("reopening a composer while its write waits for a lock keeps the latest local text", async () => {
	const storage = sharedDraftStorage(),
		ui = await open({ prepare: storage.prepare });
	await ui.pick(0);
	await ui.type("Persisted predecessor");
	const release = await holdDraftLock(storage);
	try {
		await ui.type("Latest text while locked");
		await ui.click(".prx-review-cancel");
		await ui.pick(0);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			"Latest text while locked",
		);
		expect(bodies(storage)).toEqual(["Persisted predecessor"]);
	} finally {
		release();
	}
	await settle();
	expect(bodies(storage)).toEqual(["Latest text while locked"]);
});
it("reopening during a locked send stays frozen and a focused Save moves to the textarea", async () => {
	const storage = sharedDraftStorage(),
		held = heldPost(),
		ui = await open({ prepare: storage.prepare, fetch: held.fetch });
	await ui.pick(0);
	await ui.type("Frozen pending transfer");
	const release = await holdDraftLock(storage);
	try {
		ui.doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.focus();
		await ui.click(".prx-review-submit");
		expect(ui.doc.activeElement).toBe(ui.doc.querySelector("textarea"));
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
		await ui.click(".prx-review-cancel");
		await ui.pick(0);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			"Frozen pending transfer",
		);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
		await ui.click(".prx-review-submit");
		expect(posts(ui)).toHaveLength(0);
	} finally {
		release();
	}
	await settle();
	expect(posts(ui)).toHaveLength(1);
	held.ack(posts(ui)[0]);
	await settle();
	expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(false);
});
it.each(["get", "set"])(
	"a throwing tab-only store %s warns once and keeps text reachable and sendable",
	async (failure) => {
		const ui = await open({
			noLocks: true,
			prepare(dom) {
				if (failure === "get")
					Object.defineProperty(dom.window, "sessionStorage", {
						get() {
							throw new Error("Denied");
						},
					});
				else {
					const target = dom.window.sessionStorage;
					Object.defineProperty(dom.window, "sessionStorage", {
						value: {
							get length() {
								return target.length;
							},
							key: (index: number) => target.key(index),
							getItem: (key: string) => target.getItem(key),
							setItem() {
								throw new Error("Quota");
							},
							removeItem: (key: string) => target.removeItem(key),
						},
					});
				}
			},
		});
		const messages: string[] = [],
			observer = new ui.win.MutationObserver(() => {
				const text = ui.doc.querySelector(".prx-review-composer-status")?.textContent;
				if (text) messages.push(text);
			});
		observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
			childList: true,
		});
		await ui.pick(0);
		await ui.type("Still reachable");
		await ui.type("Still reachable after denial");
		await ui.click(".prx-review-cancel");
		await ui.pick(0);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			"Still reachable after denial",
		);
		await ui.click(".prx-review-submit");
		expect(posts(ui)).toHaveLength(1);
		expect(messages.filter((message) => message.startsWith("Drafts cannot be saved"))).toHaveLength(
			1,
		);
		observer.disconnect();
	},
);
it("without Web Locks the tab store contains the text before the input event returns", async () => {
	const ui = await open({ noLocks: true });
	await ui.pick(0);
	const field = ui.doc.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
	field.value = "Synchronous tab-only draft";
	field.dispatchEvent(new ui.win.Event("input", { bubbles: true }));
	expect(Object.values(ui.win.sessionStorage).map((raw) => JSON.parse(raw).body)).toEqual([
		"Synchronous tab-only draft",
	]);
});
it("immediate input and close keep unload protection until the newest locked write is durable", async () => {
	const storage = sharedDraftStorage(),
		ui = await open({ prepare: storage.prepare });
	await ui.pick(0);
	const release = await holdDraftLock(storage);
	try {
		const field = ui.doc.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
		field.value = "Immediate reload boundary";
		field.dispatchEvent(new ui.win.Event("input", { bubbles: true }));
		ui.doc.querySelector<HTMLButtonElement>(".prx-review-cancel")?.click();
		expect(unloadWarns(ui)).toBe(true);
		expect(records(storage)).toHaveLength(0);
	} finally {
		release();
	}
	await settle();
	expect(unloadWarns(ui)).toBe(false);
	expect(bodies(storage)).toEqual(["Immediate reload boundary"]);
	const next = await open({ prepare: storage.prepare });
	await next.click(".prx-review-open-draft");
	expect(next.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
		"Immediate reload boundary",
	);
});
it("beforeunload warns for queued text and unconfirmed submissions, then clears on acknowledgement", async () => {
	const storage = sharedDraftStorage(),
		held = heldPost(),
		ui = await open({ prepare: storage.prepare, fetch: held.fetch });
	const warns = () => {
		const event = new ui.win.Event("beforeunload", { cancelable: true });
		ui.win.dispatchEvent(event);
		return event.defaultPrevented;
	};
	expect(warns()).toBe(false);
	await ui.pick(0);
	const release = await holdDraftLock(storage);
	try {
		await ui.type("Waiting for browser storage");
		await ui.click(".prx-review-cancel");
		expect(warns()).toBe(true);
	} finally {
		release();
	}
	await settle();
	await ui.pick(0);
	await ui.click(".prx-review-submit");
	await ui.click(".prx-review-cancel");
	expect(warns()).toBe(true);
	held.ack(posts(ui)[0]);
	await settle();
	expect(warns()).toBe(false);
});

it.each(["picker", "row"])(
	"a reopened %s view receives the pending request's acknowledgement",
	async (route) => {
		let complete!: (response: Response) => void;
		const ui = await open({
			fetch: vi.fn().mockImplementation((_url, init) =>
				init?.method === "POST"
					? new Promise<Response>((resolve) => {
							complete = resolve;
						})
					: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
			),
		});
		await ui.pick(0);
		await ui.type("One request, reopened composer");
		await ui.click(".prx-review-submit");
		await ui.click(".prx-review-cancel");
		if (route === "picker") await ui.pick(0);
		else await ui.click(".prx-review-retry-outbox");
		expect(ui.doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.disabled).toBe(true);
		await ui.click(".prx-review-submit");
		expect(posts(ui)).toHaveLength(1);
		const payload = posts(ui)[0];
		complete(
			reply({
				ok: true,
				thread: {
					id: "reopened-saved",
					anchor: payload.anchor,
					status: "open",
					messages: [{ body: payload.body, actor: { displayName: "Reviewer" }, at: "2026-10-19" }],
				},
			}),
		);
		await settle();
		expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(false);
		expect(ui.doc.activeElement).toBe(ui.doc.querySelector(".prx-review-comment"));
		expect(ui.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
	},
);
it.each(["same", "other"])(
	"a definitive refusal updates only the %s target's reopened modal",
	async (target) => {
		let complete!: (response: Response) => void;
		const ui = await open({
			fetch: vi.fn().mockImplementation((_url, init) =>
				init?.method === "POST"
					? new Promise<Response>((resolve) => {
							complete = resolve;
						})
					: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
			),
		});
		await ui.pick(0);
		await ui.type("Correct this comment");
		await ui.click(".prx-review-submit");
		await ui.click(".prx-review-cancel");
		await ui.pick(target === "same" ? 0 : 1);
		if (target === "other") await ui.type("Other target stays editable");
		complete(reply({ ok: false, code: "invalid_input" }, 400));
		await settle();
		expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(true);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			target === "same" ? "Correct this comment" : "Other target stays editable",
		);
		expect(ui.doc.querySelector(".prx-review-error")?.textContent).toBe(
			target === "same" ? "The comment or its target is invalid." : "",
		);
		if (target === "same") {
			expect(ui.doc.querySelector("textarea")?.getAttribute("aria-describedby")).toContain(
				"prx-review-error",
			);
			expect(ui.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(
				"The comment or its target is invalid.",
			);
		}
	},
);
it.each(["500", "network"])(
	"a reopened composer can retry the same request after an unknown %s outcome",
	async (outcome) => {
		let complete!: (response: Response | Promise<Response>) => void;
		let attempts = 0;
		const ui = await open({
			fetch: vi.fn().mockImplementation((_url, init) =>
				init?.method === "POST"
					? ++attempts === 1
						? new Promise<Response>((resolve) => {
								complete = resolve;
							})
						: Promise.resolve(reply({ ok: false, code: "internal" }, 500))
					: Promise.resolve(reply({ ok: true, threads: [], nextCursor: null })),
			),
		});
		await ui.pick(0);
		await ui.type("Unknown outcome");
		await ui.click(".prx-review-submit");
		await ui.click(".prx-review-cancel");
		await ui.pick(0);
		complete(
			outcome === "500"
				? reply({ ok: false, code: "internal" }, 500)
				: Promise.reject(new TypeError("Failed to fetch")),
		);
		await settle();
		const submit = ui.doc.querySelector<HTMLButtonElement>(".prx-review-submit");
		expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(true);
		expect(submit?.disabled).toBe(false);
		expect(submit?.textContent).toBe("Retry");
		expect(ui.doc.querySelector(".prx-review-error")?.textContent).not.toBe("");
		expect(ui.doc.querySelector("textarea")?.getAttribute("aria-describedby")).toContain(
			"prx-review-error",
		);
		await ui.click(".prx-review-submit");
		await settle();
		expect(posts(ui)).toHaveLength(2);
		expect(posts(ui)[1]).toEqual(posts(ui)[0]);
	},
);
it.each([true, false])(
	"selection cancellation restores visible review focus without opening More (selection visible=%s)",
	async (visible) => {
		const ui = await open({
			markup:
				'<div class="praxity-deck"><div id="deck-more"><button id="deck-more-toggle" aria-expanded="false">More</button><div class="deck-utility-items" style="display:none"></div></div><div class="deck-workspace"><article data-deck-slide="page"><p data-node-id="node">Select this text.</p></article></div></div>',
		});
		const more = ui.doc.querySelector<HTMLButtonElement>("#deck-more-toggle") as HTMLButtonElement;
		const activate = vi.fn();
		more.addEventListener("click", activate);
		ui.selection();
		await ui.click(".prx-review-selection");
		const selection = ui.doc.querySelector<HTMLButtonElement>(
			".prx-review-selection",
		) as HTMLButtonElement;
		expect(selection.hidden).toBe(true);
		if (visible) ui.selection();
		else ui.win.getSelection()?.removeAllRanges();
		await ui.click(".prx-review-cancel");
		expect(selection.hidden).toBe(!visible);
		expect(activate).not.toHaveBeenCalled();
		expect(more.getAttribute("aria-expanded")).toBe("false");
		expect(ui.doc.activeElement).toBe(visible ? selection : more);
	},
);
it("the selected-target radio uses a 60-character preview while the composer keeps the complete quote", async () => {
	const quote = "a".repeat(80),
		ui = await open({ markup: `<p data-node-id="node">${quote}</p>` });
	ui.selection();
	await ui.click(".prx-review-choose");
	expect(ui.doc.querySelector(".prx-review-target")?.textContent).toBe(
		`Selected text: “${"a".repeat(59)}…”`,
	);
	(ui.doc.querySelector("input[type=radio]") as HTMLInputElement).checked = true;
	await ui.click(".prx-review-next");
	expect(ui.doc.querySelector(".prx-review-composer blockquote")?.textContent).toBe(quote);
});
it.each(["en", "fr"])(
	"%s draft actions describe their own row and the selection action uses a verb",
	async (locale) => {
		const ui = await open({ locale });
		ui.selection();
		expect(ui.doc.querySelector(".prx-review-selection")?.textContent).toBe(
			locale === "fr" ? "Commenter" : "Comment",
		);
		ui.win.getSelection()?.removeAllRanges();
		ui.doc.dispatchEvent(new ui.win.Event("selectionchange"));
		ui.flushFrames();
		await ui.pick(0);
		await ui.type("Page draft");
		await ui.click(".prx-review-cancel");
		await ui.pick(1);
		await ui.type("Block draft");
		await ui.click(".prx-review-cancel");
		const rows = [...ui.doc.querySelectorAll(".prx-review-draft")];
		expect(rows).toHaveLength(2);
		for (const row of rows)
			for (const control of row.querySelectorAll("button")) {
				const description = ui.doc.getElementById(control.getAttribute("aria-describedby") || "");
				expect(description?.parentElement).toBe(row);
				expect(description?.textContent).toContain(
					row.textContent?.includes("Page draft")
						? locale === "fr"
							? "Toute la page"
							: "Whole page"
						: "Read this passage.",
				);
			}
	},
);

it("an obsolete clean close cannot retire newer input queued after reopening under a held lock", async () => {
	const storage = sharedDraftStorage();
	const prepare = (dom: JSDOM) => {
		storage.prepare(dom);
		dom.window.Date.now = () => Date.UTC(2026, 9, 19);
	};
	const a = await open({ prepare });
	await a.pick(0);
	await a.type("Shared baseline");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare });
	await a.pick(0);
	await b.pick(0);
	const release = await holdDraftLock(storage);
	try {
		await a.type("Newer text from A");
		await b.click(".prx-review-cancel");
		await b.pick(0);
		await b.type("New unsent text from B");
	} finally {
		release();
	}
	await settle();
	expect(bodies(storage)).toEqual(["New unsent text from B", "Newer text from A"]);
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
		"New unsent text from B",
	);
	expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"Another tab changed this draft. Your text was kept as a separate draft.",
	);
	await b.click(".prx-review-cancel");
	await b.pick(0);
	expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
		"New unsent text from B",
	);
});
it.each(["reject", "throw"])(
	"a lock request that %ss enters memory mode, announces once and still saves",
	async (failure) => {
		const denied = vi.fn(() => {
				throw new Error("Shared storage denied");
			}),
			request = vi.fn(() => {
				if (failure === "throw") throw new Error("Lock denied");
				return Promise.reject(new Error("Lock denied"));
			});
		const ui = await open({
			prepare(dom) {
				Object.defineProperty(dom.window.navigator, "locks", {
					value: { request },
					configurable: true,
				});
				Object.defineProperty(dom.window, "localStorage", { get: denied });
			},
		});
		const messages: string[] = [],
			observer = new ui.win.MutationObserver(() => {
				const text = ui.doc.querySelector(".prx-review-composer-status")?.textContent;
				if (text) messages.push(text);
			});
		observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
			childList: true,
		});
		await ui.pick(0);
		await ui.type("a");
		const reads = denied.mock.calls.length;
		await ui.type("ab");
		await ui.type("abc");
		expect(unloadWarns(ui)).toBe(true);
		expect(ui.doc.querySelector<HTMLParagraphElement>(".prx-review-storage-error")?.hidden).toBe(
			false,
		);
		expect(ui.doc.querySelector<HTMLParagraphElement>(".prx-review-tab-warning")?.hidden).toBe(
			true,
		);
		await ui.click(".prx-review-submit");
		expect(posts(ui)).toHaveLength(1);
		expect(posts(ui)[0].body).toBe("abc");
		expect(ui.doc.querySelector<HTMLDialogElement>(".prx-review-composer")?.open).toBe(false);
		expect(ui.doc.querySelectorAll(".prx-review-comment")).toHaveLength(1);
		expect(unloadWarns(ui)).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
		expect(denied).toHaveBeenCalledTimes(reads);
		expect(messages).toEqual([
			"Drafts cannot be saved in this browser. Keep this page open until your comment is saved.",
		]);
		observer.disconnect();
	},
);
it.each(["reject", "throw"])(
	"a lock request that %ss preserves exact text through Cancel and reopening",
	async (failure) => {
		const denied = vi.fn(() => {
			throw new Error("No shared storage access");
		});
		const ui = await open({
			prepare(dom) {
				Object.defineProperty(dom.window.navigator, "locks", {
					value: {
						request() {
							if (failure === "throw") throw new Error("Lock denied");
							return Promise.reject(new Error("Lock denied"));
						},
					},
					configurable: true,
				});
				Object.defineProperty(dom.window, "localStorage", { get: denied });
			},
		});
		await ui.pick(0);
		await ui.type("  Unsent text after lock refusal\r\n  ");
		const reads = denied.mock.calls.length;
		await ui.click(".prx-review-cancel");
		expect(ui.doc.querySelectorAll(".prx-review-draft")).toHaveLength(1);
		expect(unloadWarns(ui)).toBe(true);
		await ui.pick(0);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			"  Unsent text after lock refusal\n  ",
		);
		expect(denied).toHaveBeenCalledTimes(reads);
	},
);
it("a refused outbox with failed removal keeps one blocked successor through Retry and reload", async () => {
	const storage = sharedDraftStorage(),
		held = heldPost(),
		ui = await open({ prepare: storage.prepare, fetch: held.fetch });
	await ui.pick(0);
	await ui.type("Refused body");
	await ui.click(".prx-review-submit");
	storage.failRemovals(true);
	held.respond(reply({ ok: false, code: "invalid_input" }, 422));
	await settle();
	const initialKeys = [...storage.values.keys()].sort();
	expect(initialKeys).toHaveLength(2);
	expect(initialKeys.filter((key) => key.startsWith("praxity-review-draft:"))).toHaveLength(1);
	expect(ui.doc.querySelectorAll(".prx-review-draft")).toHaveLength(1);
	expect(ui.doc.querySelectorAll(".prx-review-open-draft,.prx-review-discard-draft")).toHaveLength(
		0,
	);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
	expect(ui.doc.querySelector(".prx-review-error")?.textContent).toBe(
		"The comment or its target is invalid.",
	);
	await ui.click(".prx-review-cancel");
	await ui.click(".prx-review-retry-outbox");
	await ui.click(".prx-review-submit");
	expect(posts(ui)).toHaveLength(1);
	expect([...storage.values.keys()].sort()).toEqual(initialKeys);
	const next = await open({ prepare: storage.prepare });
	await next.click(".prx-review-retry-outbox");
	await next.click(".prx-review-submit");
	expect(posts(next)).toHaveLength(0);
	expect([...storage.values.keys()].sort()).toEqual(initialKeys);
	expect(next.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
	storage.failRemovals(false);
	const messages: string[] = [],
		observer = new ui.win.MutationObserver(() => {
			const text = ui.doc.querySelector(".prx-review-composer-status")?.textContent;
			if (text) messages.push(text);
		});
	observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
		childList: true,
	});
	await ui.click(".prx-review-submit");
	expect(posts(ui)).toHaveLength(1);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Refused body");
	expect(ui.doc.querySelector(".prx-review-error")?.textContent).toBe(
		"The comment or its target is invalid.",
	);
	expect(messages).toEqual(["The comment or its target is invalid."]);
	observer.disconnect();
	expect(storage.values.size).toBe(1);
	expect([...storage.values.keys()][0]).toContain("praxity-review-draft:");
});
it("a quota edit announces storage failure and retires its unchanged durable predecessor before sending", async () => {
	const storage = sharedDraftStorage(),
		server = realReview(),
		ui = await open({ prepare: storage.prepare, fetch: server.fetch });
	await ui.pick(0);
	await ui.type("Version one");
	await ui.click(".prx-review-cancel");
	storage.failPuts(true);
	await ui.pick(0);
	await ui.type("Version one, edited after quota");
	expect(ui.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe("");
	const description = ui.doc
		.querySelector("textarea")
		?.getAttribute("aria-describedby")
		?.split(" ")
		.map((id) => ui.doc.getElementById(id)?.textContent)
		.join(" ");
	expect(description?.match(/Drafts cannot be saved in this browser\./g)).toHaveLength(1);
	await ui.click(".prx-review-cancel");
	await ui.click(".prx-review-open-draft");
	await ui.click(".prx-review-submit");
	await server.idle();
	await settle();
	expect(server.state().threads.map((thread) => thread.messages[0].body)).toEqual([
		"Version one, edited after quota",
	]);
	expect(records(storage)).toHaveLength(0);
	const next = await open({ prepare: storage.prepare });
	expect(next.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
});
it("quota predecessor retirement preserves a different tab's changed durable text", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Durable baseline");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	storage.failPuts(true);
	await a.pick(0);
	await a.type("Edited after quota");
	storage.failPuts(false);
	await b.type("Other tab's genuine revision");
	await a.click(".prx-review-submit");
	expect(bodies(storage)).toEqual(["Other tab's genuine revision"]);
	expect(posts(a)[0].body).toBe("Edited after quota");
});
it("discarding a quota edit retires its unchanged durable predecessor too", async () => {
	const storage = sharedDraftStorage(),
		ui = await open({ prepare: storage.prepare });
	await ui.pick(0);
	await ui.type("Durable predecessor");
	storage.failPuts(true);
	await ui.type("Quota edit");
	await ui.click(".prx-review-cancel");
	await ui.click(".prx-review-discard-draft");
	expect(records(storage)).toHaveLength(0);
	expect(ui.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
	expect(unloadWarns(ui)).toBe(false);
});
it("settled durable drafts never prompt, including open, reloaded and other-slide views", async () => {
	const storage = sharedDraftStorage(),
		ui = await open({ prepare: storage.prepare });
	await ui.pick(0);
	await ui.type("Durable draft");
	expect(unloadWarns(ui)).toBe(false);
	await ui.click(".prx-review-cancel");
	expect(unloadWarns(ui)).toBe(false);
	const next = await open({ prepare: storage.prepare });
	expect(unloadWarns(next)).toBe(false);
	ui.win.dispatchEvent(
		new ui.win.CustomEvent("praxity:active-page-change", { detail: { pageId: "other" } }),
	);
	await settle();
	expect(unloadWarns(ui)).toBe(false);
});
it("an unconfirmed durable outbox prompts both its original page and a reloaded page", async () => {
	const storage = sharedDraftStorage(),
		held = heldPost(),
		ui = await open({ prepare: storage.prepare, fetch: held.fetch });
	await ui.pick(0);
	await ui.type("Awaiting acknowledgement");
	await ui.click(".prx-review-submit");
	expect(unloadWarns(ui)).toBe(true);
	const next = await open({ prepare: storage.prepare });
	expect(unloadWarns(next)).toBe(true);
	held.ack(posts(ui)[0]);
	await settle();
	expect(unloadWarns(ui)).toBe(false);
});
it("closing a gone session does not repeat the disappearance announcement in the background", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Discard elsewhere");
	await a.click(".prx-review-cancel");
	const b = await open({ prepare: storage.prepare });
	await b.pick(0);
	await a.click(".prx-review-discard-draft");
	await b.click(".prx-review-submit");
	expect(b.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(
		"This draft was sent or discarded in another tab.",
	);
	await b.click(".prx-review-cancel");
	expect(b.doc.querySelector(".prx-review-status")?.textContent).not.toBe(
		"This draft was sent or discarded in another tab.",
	);
});
function unloadWarns(ui: Awaited<ReturnType<typeof open>>) {
	const event = new ui.win.Event("beforeunload", { cancelable: true });
	ui.win.dispatchEvent(event);
	return event.defaultPrevented;
}

it("lock denial sets the storage warning even when reads work and performs no unlocked storage mutations", async () => {
	const put = vi.fn(),
		remove = vi.fn();
	const ui = await open({
		prepare(dom) {
			Object.defineProperty(dom.window.navigator, "locks", {
				value: { request: () => Promise.reject(new Error("Denied")) },
				configurable: true,
			});
			Object.defineProperty(dom.window, "localStorage", {
				value: {
					length: 0,
					key: () => null,
					getItem: () => null,
					setItem: put,
					removeItem: remove,
				},
			});
		},
	});
	await ui.pick(0);
	expect(ui.doc.querySelector<HTMLParagraphElement>(".prx-review-storage-error")?.hidden).toBe(
		true,
	);
	const messages: string[] = [],
		observer = new ui.win.MutationObserver(() => {
			const text = ui.doc.querySelector(".prx-review-composer-status")?.textContent;
			if (text) messages.push(text);
		});
	observer.observe(ui.doc.querySelector(".prx-review-composer-status") as Node, {
		childList: true,
	});
	await ui.type("Memory only");
	await ui.click(".prx-review-cancel");
	await ui.pick(0);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Memory only");
	expect(unloadWarns(ui)).toBe(true);
	await ui.click(".prx-review-submit");
	expect(posts(ui)).toHaveLength(1);
	expect(put).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
	expect(ui.doc.querySelector<HTMLParagraphElement>(".prx-review-storage-error")?.hidden).toBe(
		false,
	);
	expect(messages).toEqual([
		"Drafts cannot be saved in this browser. Keep this page open until your comment is saved.",
	]);
	observer.disconnect();
});

it("coalesces repeated selection and marker work into one frame", async () => {
	const ui = await open();
	ui.flushFrames();
	const range = ui.doc.createRange();
	range.selectNodeContents(ui.doc.querySelector("main p") as Element);
	ui.win.getSelection()?.addRange(range);
	for (let i = 0; i < 25; i++) ui.doc.dispatchEvent(new ui.win.Event("selectionchange"));
	expect(ui.frames.size).toBe(1);
	expect(ui.doc.querySelector<HTMLButtonElement>(".prx-review-selection")?.hidden).toBe(true);
	ui.flushFrames();
	expect(ui.doc.querySelector<HTMLButtonElement>(".prx-review-selection")?.hidden).toBe(false);
});
it("keeps the pin status rendered and fills its instructions on the next frame", async () => {
	const ui = await open();
	const status = ui.doc.querySelector(".prx-review-pin-hint [role='status']");
	expect(status).not.toBeNull();
	expect(status?.closest("[hidden]")).toBeNull();
	await ui.click(".prx-review-pin");
	expect(status?.textContent).toBe("");
	ui.flushFrames();
	expect(status?.textContent).toBe(
		"Click the spot you want to comment on. Press Escape to cancel.",
	);
	expect(ui.doc.querySelector(".prx-review-pin-hint [role='status']")).toBe(status);
});

it.each([false, true])(
	"Save adopts or forks an established frozen outbox (equal=%s)",
	async (same) => {
		const storage = sharedDraftStorage(),
			server = realReview(),
			a = await open({ prepare: storage.prepare, fetch: server.fetch });
		await a.pick(0);
		await a.type("Base");
		const [draftKey, raw] = records(storage)[0];
		const b = await open({ prepare: storage.prepare, fetch: server.fetch });
		await b.pick(0);
		await b.type("B text");
		const id = draftKey.slice(-36),
			outboxKey = draftKey.replace("praxity-review-draft:", "praxity-review-outbox:"),
			value = JSON.parse(raw),
			frozen = JSON.stringify({
				...value,
				body: same ? "B text" : "Frozen in A",
				draftId: id,
				requestId: id,
			});
		storage.values.set(outboxKey, frozen);
		server.loseNextReply();
		await b.click(".prx-review-submit");
		await server.idle();
		await settle();
		expect(storage.values.get(outboxKey)).toBe(frozen);
		if (same) expect(posts(b)[0].requestId).toBe(id);
		else expect(posts(b)[0].requestId).not.toBe(id);
		expect(server.state().threads.map((t) => t.messages[0].body)).toEqual(["B text"]);
	},
);
it("C1 deduplicates duplicated tab-only drafts", async () => {
	const server = realReview();
	const a = await open({ noLocks: true, fetch: server.fetch });
	await a.pick(0);
	await a.type("Same copied intent");
	const snapshot = Object.entries(a.win.sessionStorage);
	const b = await open({
		noLocks: true,
		fetch: server.fetch,
		stored: snapshot,
	});
	await b.click(".prx-review-open-draft");
	await a.click(".prx-review-submit");
	await server.idle();
	await settle();
	await b.click(".prx-review-submit");
	await server.idle();
	await settle();
	expect(server.state().threads).toHaveLength(1);
	expect(posts(a)[0].requestId).toBe(posts(b)[0].requestId);
	expect(b.doc.querySelector(".prx-review-status")?.textContent).toBe("Already posted");
});
it("an invalid_input refusal keeps the draft ID for a corrected C1 create", async () => {
	const server = realReview();
	let refuse = true;
	const fetch = vi
		.fn()
		.mockImplementation((url, init) =>
			init?.method === "POST" && refuse
				? ((refuse = false), Promise.resolve(reply({ ok: false, code: "invalid_input" }, 400)))
				: server.fetch(url, init),
		);
	const a = await open({ fetch });
	await a.pick(0);
	await a.type("Refused");
	const id = Object.keys(a.win.localStorage)[0].slice(-36);
	await a.click(".prx-review-submit");
	await settle();
	expect(a.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	await a.type("Corrected");
	await a.click(".prx-review-submit");
	await server.idle();
	await settle();
	expect(posts(a).map((p) => p.requestId)).toEqual([id, id]);
	expect(server.state().threads.map((t) => t.messages[0].body)).toEqual(["Corrected"]);
});
it("C1 unknown outcome reload and Retry replays the same draft ID", async () => {
	const storage = sharedDraftStorage(),
		server = realReview(),
		a = await open({ prepare: storage.prepare, fetch: server.fetch });
	await a.pick(0);
	await a.type("One accepted create");
	server.loseNextReply();
	await a.click(".prx-review-submit");
	await server.idle();
	await settle();
	const b = await open({ prepare: storage.prepare, fetch: server.fetch });
	await b.click(".prx-review-retry-outbox");
	await b.click(".prx-review-submit");
	await server.idle();
	await settle();
	expect(server.state().threads).toHaveLength(1);
	expect(posts(b)[0].requestId).toBe(posts(a)[0].requestId);
	expect(b.doc.querySelector(".prx-review-status")?.textContent).toBe("Already posted");
});

it.each([
	{ edit: false, locale: "en" },
	{ edit: true, locale: "en" },
	{ edit: false, locale: "fr" },
	{ edit: true, locale: "fr" },
])(
	"C1 arbitrates a live draft after another tab posts ($edit, $locale)",
	async ({ edit, locale }) => {
		const storage = sharedDraftStorage(),
			server = realReview();
		const a = await open({ prepare: storage.prepare, fetch: server.fetch, locale });
		await a.pick(0);
		await a.type("Original");
		const id = records(storage)[0][0].slice(-36);
		const b = await open({ prepare: storage.prepare, fetch: server.fetch, locale });
		await b.click(".prx-review-open-draft");
		await a.click(".prx-review-submit");
		await server.idle();
		await settle();
		if (edit) await b.type("Edited B");
		else {
			await b.click(".prx-review-submit");
			expect(posts(b)).toHaveLength(0);
			expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
			await b.click(".prx-review-keep-new");
			expect(records(storage)[0][0].slice(-36)).toBe(id);
		}
		await b.click(".prx-review-submit");
		await server.idle();
		await settle();
		expect(server.state().threads).toHaveLength(1);
		expect(posts(b)).toHaveLength(1);
		expect(posts(b)[0]).toMatchObject({ requestId: id, body: edit ? "Edited B" : "Original" });
		if (edit) {
			const response = await b.fetchMock.mock.results.at(-1)?.value;
			expect(response.status).toBe(409);
			expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
			expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Edited B");
			const notice =
				locale === "fr"
					? "Ce brouillon a été publié depuis un autre onglet. Votre texte a été conservé dans un nouveau brouillon."
					: "This draft was posted from another tab. Your text was kept as a new draft.";
			expect(b.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(notice);
			expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(notice);
			expect(b.doc.querySelector("textarea")?.getAttribute("aria-describedby")?.split(" ")).toEqual(
				["prx-review-error", "prx-review-composer-notice"],
			);
			expect(records(storage)[0][0].slice(-36)).not.toBe(id);
			await b.click(".prx-review-submit");
			await server.idle();
			await settle();
			expect(posts(b)[1].requestId).not.toBe(id);
			expect(server.state().threads.map((thread) => thread.messages[0].body)).toEqual([
				"Original",
				"Edited B",
			]);
		} else {
			expect(b.doc.querySelector(".prx-review-status")?.textContent).toBe(
				locale === "fr" ? "Déjà publié" : "Already posted",
			);
			expect(b.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
		}
	},
);

it.each([false, true])(
	"Keep as new still forks a changed draft (other removed=%s)",
	async (removed) => {
		const storage = sharedDraftStorage(),
			a = await open({ prepare: storage.prepare });
		await a.pick(0);
		await a.type("Original");
		const id = records(storage)[0][0].slice(-36);
		const b = await open({ prepare: storage.prepare });
		await b.click(".prx-review-open-draft");
		await a.type("Changed in A");
		await b.click(".prx-review-submit");
		expect(posts(b)).toHaveLength(0);
		if (removed) {
			await a.click(".prx-review-cancel");
			await a.click(".prx-review-discard-draft");
		}
		await b.click(".prx-review-keep-new");
		expect(bodies(storage)).toEqual(removed ? ["Original"] : ["Changed in A", "Original"]);
		const original = records(storage).find(([, raw]) => JSON.parse(raw).body === "Original");
		expect(original?.[0].slice(-36)).not.toBe(id);
		expect(b.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(
			"Another tab changed this draft. Your text was kept as a separate draft.",
		);
	},
);

it.each(["invalid_input", "request_id_reused"] as const)(
	"a late %s refusal cannot recreate an outbox already refused and discarded elsewhere",
	async (code) => {
		const storage = sharedDraftStorage(),
			initial = heldPost(),
			seed = await open({ prepare: storage.prepare, fetch: initial.fetch });
		await seed.pick(0);
		await seed.type("One refused intent");
		await seed.click(".prx-review-submit");
		initial.respond(reply({ ok: false, code: "temporary" }, 500));
		await settle();
		const first = heldPost(),
			second = heldPost(),
			a = await open({ prepare: storage.prepare, fetch: first.fetch }),
			b = await open({ prepare: storage.prepare, fetch: second.fetch });
		for (const tab of [a, b]) {
			await tab.click(".prx-review-retry-outbox");
			await tab.click(".prx-review-submit");
		}
		first.respond(reply({ ok: false, code }, refusalStatuses[code]));
		await settle();
		await a.click(".prx-review-cancel");
		await a.click(".prx-review-discard-draft");
		expect(records(storage)).toEqual([]);
		second.respond(reply({ ok: false, code }, refusalStatuses[code]));
		await settle();
		expect(records(storage)).toEqual([]);
		expect(b.doc.querySelectorAll(".prx-review-draft")).toHaveLength(0);
		expect(posts(b)).toHaveLength(1);
	},
);

it("an equal changed durable draft is adopted without forking its live intent", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Base");
	const [key] = records(storage)[0];
	const b = await open({ prepare: storage.prepare });
	await b.click(".prx-review-open-draft");
	await a.type("Same new text");
	await b.type("Same new text");
	expect(bodies(storage)).toEqual(["Same new text"]);
	expect(records(storage)[0][0]).toBe(key);
	expect(b.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe("");
});

it("shared draft writes leave no synchronous session journal while waiting for their lock", async () => {
	const storage = sharedDraftStorage(),
		a = await open({ prepare: storage.prepare });
	await a.pick(0);
	await a.type("Saved baseline");
	const release = await holdDraftLock(storage);
	try {
		await a.type("Unsettled edit");
		expect(Object.entries(a.win.sessionStorage)).toEqual([]);
		expect(bodies(storage)).toEqual(["Saved baseline"]);
		const b = await open({ prepare: storage.prepare });
		await b.click(".prx-review-open-draft");
		expect(b.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Saved baseline");
	} finally {
		release();
	}
	await settle();
	expect(bodies(storage)).toEqual(["Unsettled edit"]);
});

it("C1 deduplicates durable drafts loaded before both pages enter memory-only mode", async () => {
	const storage = sharedDraftStorage(),
		server = realReview();
	const seed = await open({ prepare: storage.prepare });
	await seed.pick(0);
	await seed.type("Loaded durable intent");
	const prepare = (dom: JSDOM) => {
		storage.prepare(dom);
		Object.defineProperty(dom.window.navigator, "locks", {
			configurable: true,
			value: { request: () => Promise.reject(new Error("Denied")) },
		});
	};
	const a = await open({ prepare, fetch: server.fetch }),
		b = await open({ prepare, fetch: server.fetch });
	await a.click(".prx-review-open-draft");
	await b.click(".prx-review-open-draft");
	await a.click(".prx-review-submit");
	await server.idle();
	await settle();
	await b.click(".prx-review-submit");
	await server.idle();
	await settle();
	expect(server.state().threads).toHaveLength(1);
	expect(posts(a)[0].requestId).toBe(posts(b)[0].requestId);
	expect(b.doc.querySelector(".prx-review-status")?.textContent).toBe("Already posted");
	expect(Object.entries(a.win.sessionStorage)).toEqual([]);
	expect(Object.entries(b.win.sessionStorage)).toEqual([]);
});

it.each([
	{ mode: "capacity", code: "invalid_input" },
	{ mode: "failPuts", code: "invalid_input" },
	{ mode: "capacity", code: "request_id_reused" },
	{ mode: "failPuts", code: "request_id_reused" },
] as const)(
	"a durable outbox survives a $code refusal under $mode and reload",
	async ({ mode, code }) => {
		const storage = sharedDraftStorage(),
			initial = heldPost();
		const seed = await open({ prepare: storage.prepare, fetch: initial.fetch });
		await seed.pick(0);
		await seed.type("Saved outbox text");
		await seed.click(".prx-review-submit");
		initial.respond(reply({ ok: false, code: "temporary" }, 500));
		await settle();
		const [outboxKey, outboxRaw] = records(storage)[0];
		if (mode === "capacity")
			storage.limitStorage(
				records(storage).reduce((n, [key, raw]) => n + key.length + raw.length, 5),
			);
		else storage.failPuts(true);
		const refusing = vi
			.fn()
			.mockImplementation((_url, init) =>
				Promise.resolve(
					init?.method === "POST"
						? reply({ ok: false, code }, refusalStatuses[code])
						: reply({ ok: true, threads: [], nextCursor: null }),
				),
			);
		const a = await open({ prepare: storage.prepare, fetch: refusing });
		await a.click(".prx-review-retry-outbox");
		await a.click(".prx-review-submit");
		expect(records(storage).map(([, raw]) => JSON.parse(raw).body)).toEqual(["Saved outbox text"]);
		expect(a.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Saved outbox text");
		if (mode === "failPuts") {
			expect(storage.values.get(outboxKey)).toBe(outboxRaw);
			expect(a.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
		} else {
			expect(storage.values.has(outboxKey)).toBe(false);
			expect(a.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
		}
		a.win.dispatchEvent(new a.win.Event("pagehide"));
		await settle();
		const reloaded = await open({ prepare: storage.prepare });
		await reloaded.click(".prx-review-open-draft,.prx-review-retry-outbox");
		expect(reloaded.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			"Saved outbox text",
		);
		expect(records(storage).map(([, raw]) => JSON.parse(raw).body)).toEqual(["Saved outbox text"]);
	},
);

it.each(["invalid_input", "request_id_reused"] as const)(
	"a failed replacement put restores the exact durable outbox for %s",
	async (code) => {
		const storage = sharedDraftStorage(),
			held = heldPost(),
			ui = await open({ prepare: storage.prepare, fetch: held.fetch });
		await ui.pick(0);
		await ui.type("Restore my saved text");
		await ui.click(".prx-review-submit");
		const [key, raw] = records(storage)[0];
		storage.limitStorage(key.length + raw.length + 5);
		storage.pauseNext(
			"removeItem",
			() => {
				storage.pauseNext(
					"setItem",
					() => {
						storage.limitStorage(0);
						storage.pauseNext("setItem", () => storage.limitStorage(Infinity));
					},
					(draftKey) => draftKey.startsWith("praxity-review-draft:"),
				);
			},
			(removedKey) => removedKey === key,
		);
		held.respond(reply({ ok: false, code }, refusalStatuses[code]));
		await settle();
		expect(records(storage)).toEqual([[key, raw]]);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
		const reloaded = await open({ prepare: storage.prepare });
		await reloaded.click(".prx-review-retry-outbox");
		expect(reloaded.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
			"Restore my saved text",
		);
	},
);

it("three tabs rehome one changed create to one successor and post Edited B once", async () => {
	const storage = sharedDraftStorage(),
		server = realReview();
	const a = await open({ prepare: storage.prepare, fetch: server.fetch });
	await a.pick(0);
	await a.type("Original");
	const b = await open({ prepare: storage.prepare, fetch: server.fetch });
	await b.click(".prx-review-open-draft");
	await a.click(".prx-review-submit");
	await server.idle();
	await settle();
	await b.type("Edited B");
	const c = await open({ prepare: storage.prepare, fetch: server.fetch });
	await c.click(".prx-review-open-draft");
	await b.click(".prx-review-submit");
	await server.idle();
	await settle();
	const successorKey = records(storage)[0][0];
	await c.click(".prx-review-submit");
	await c.click(".prx-review-keep-new");
	await c.click(".prx-review-submit");
	await server.idle();
	await settle();
	expect(records(storage)).toHaveLength(1);
	expect(records(storage)[0][0]).toBe(successorKey);
	expect(bodies(storage)).toEqual(["Edited B"]);
	expect(posts(b)).toHaveLength(1);
	expect(posts(c)).toHaveLength(1);
	await b.click(".prx-review-submit");
	await server.idle();
	await settle();
	await c.click(".prx-review-submit");
	await server.idle();
	await settle();
	const texts = server.state().threads.map((thread) => thread.messages[0].body);
	expect(texts).toEqual(["Original", "Edited B"]);
	expect(texts.filter((body) => body === "Edited B")).toHaveLength(1);
});

it.each([
	{
		body: "Kept text",
		revision: "revision",
		reverse: false,
		expected: "9f84309a-6972-85c8-9225-c7b56aaa0991",
	},
	{
		body: "Kept text",
		revision: "revision",
		reverse: true,
		expected: "9f84309a-6972-85c8-9225-c7b56aaa0991",
	},
	{
		body: "Other text",
		revision: "revision",
		reverse: false,
		expected: "5b4446eb-8faa-8bab-bfc0-cda7c19bff64",
	},
	{
		body: "Kept text",
		revision: "other-revision",
		reverse: false,
		expected: "8bd8fa3a-42d2-8da3-b215-1a22b0a15456",
	},
])(
	"reused create ID derives a SHA-256 UUID from the full intent ($body, $revision, $reverse)",
	async ({ body, revision, reverse, expected }) => {
		const id = "22222222-2222-4222-8222-222222222222";
		let anchor: ReviewAnchor = {
			courseId: null,
			lessonId: "lesson",
			pageId: "page",
			nodeId: null,
			blockId: null,
			revision,
			quote: null,
			pin: null,
			tab: null,
			revealPath: [],
			cssPath: null,
			context: { pageTitle: "Page title", targetLabel: null },
		};
		if (reverse)
			anchor = Object.fromEntries(Object.entries(anchor).reverse()) as unknown as ReviewAnchor;
		const ui = await open({
			stored: [
				[
					`praxity-review-outbox:${reviewId}:page:${id}`,
					JSON.stringify({
						body,
						anchor,
						requestId: id,
						draftId: id,
						savedAt: "2026-10-19T00:00:00.000Z",
					}),
				],
			],
			fetch: vi
				.fn()
				.mockImplementation((_url, init) =>
					Promise.resolve(
						init?.method === "POST"
							? reply({ ok: false, code: "request_id_reused" }, 409)
							: reply({ ok: true, threads: [], nextCursor: null }),
					),
				),
		});
		await ui.click(".prx-review-retry-outbox");
		await ui.click(".prx-review-submit");
		expect(Object.keys(ui.win.localStorage)).toEqual([
			`praxity-review-draft:${reviewId}:page:${expected}`,
		]);
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(body);
		expect(posts(ui)).toHaveLength(1);
	},
);

it("a reused ID adopts its equal deterministic successor despite anchor property order", async () => {
	const id = "22222222-2222-4222-8222-222222222222",
		successor = "9f84309a-6972-85c8-9225-c7b56aaa0991";
	const anchor: ReviewAnchor = {
		courseId: null,
		lessonId: "lesson",
		pageId: "page",
		nodeId: null,
		blockId: null,
		revision: "revision",
		quote: null,
		pin: null,
		tab: null,
		revealPath: [],
		cssPath: null,
		context: { pageTitle: "Page title", targetLabel: null },
	};
	const draftKey = `praxity-review-draft:${reviewId}:page:${successor}`;
	const draftRaw = JSON.stringify({
		body: "Kept text",
		anchor,
		savedAt: "2026-10-19T00:00:00.000Z",
	});
	const ui = await open({
		stored: [
			[draftKey, draftRaw],
			[
				`praxity-review-outbox:${reviewId}:page:${id}`,
				JSON.stringify({
					body: "Kept text",
					anchor: Object.fromEntries(Object.entries(anchor).reverse()),
					requestId: id,
					draftId: id,
					savedAt: "2026-10-20T00:00:00.000Z",
				}),
			],
		],
		fetch: vi
			.fn()
			.mockImplementation((_url, init) =>
				Promise.resolve(
					init?.method === "POST"
						? reply({ ok: false, code: "request_id_reused" }, 409)
						: reply({ ok: true, threads: [], nextCursor: null }),
				),
			),
	});
	await ui.click(".prx-review-retry-outbox");
	await ui.click(".prx-review-submit");
	expect(Object.entries(ui.win.localStorage)).toEqual([[draftKey, draftRaw]]);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Kept text");
});

async function changedReusedSuccessor(blockRemoval = false) {
	const storage = sharedDraftStorage(),
		server = realReview();
	const a = await open({ prepare: storage.prepare, fetch: server.fetch });
	await a.pick(0);
	await a.type("Original");
	const b = await open({ prepare: storage.prepare, fetch: server.fetch });
	await b.click(".prx-review-open-draft");
	await a.click(".prx-review-submit");
	await server.idle();
	await settle();
	await b.type("Edited B");
	const c = await open({
		prepare: storage.prepare,
		fetch: vi.fn((url, init) => {
			if (blockRemoval && init?.method === "POST") storage.failRemovals(true);
			return server.fetch(url, init);
		}),
	});
	await c.click(".prx-review-open-draft");
	const d = await open({ prepare: storage.prepare, fetch: server.fetch });
	await d.click(".prx-review-open-draft");
	const originalId = records(storage)[0][0].slice(-36);
	await b.click(".prx-review-submit");
	await server.idle();
	await settle();
	await b.type("Edited B2");
	return { storage, server, c, d, originalId };
}

it("a refusal and two local Retries keep one successor when the derived slot changed", async () => {
	const { storage, server, c, originalId } = await changedReusedSuccessor(true);
	await c.click(".prx-review-submit");
	await c.click(".prx-review-keep-new");
	await c.click(".prx-review-submit");
	await server.idle();
	await settle();
	const successorKey = records(storage).find(
		([, raw]) => JSON.parse(raw).body === "Edited B" && !JSON.parse(raw).requestId,
	)?.[0];
	expect(successorKey).toBeDefined();
	await c.click(".prx-review-submit");
	storage.failRemovals(false);
	await c.click(".prx-review-submit");
	expect(records(storage).filter(([, raw]) => JSON.parse(raw).body === "Edited B")).toEqual([
		[successorKey, storage.values.get(successorKey as string)],
	]);
	expect(storage.values.has(`praxity-review-outbox:${reviewId}:page:${originalId}`)).toBe(false);
	expect(c.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	expect(posts(c)).toHaveLength(1);
	expect(c.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(
		"This draft was posted from another tab. Your text was kept as a new draft.",
	);
});

it("two refusals against a changed derived slot converge on one ID and one thread", async () => {
	const { storage, server, c, d } = await changedReusedSuccessor();
	for (const ui of [c, d]) {
		await ui.click(".prx-review-submit");
		await ui.click(".prx-review-keep-new");
		await ui.click(".prx-review-submit");
		await server.idle();
		await settle();
	}
	const successor = records(storage).filter(([, raw]) => JSON.parse(raw).body === "Edited B");
	expect(successor).toHaveLength(1);
	expect(bodies(storage)).toEqual(["Edited B", "Edited B2"]);
	const id = successor[0][0].slice(-36);
	for (const ui of [c, d]) {
		await ui.click(".prx-review-submit");
		if (!ui.doc.querySelector<HTMLButtonElement>(".prx-review-keep-new")?.hidden) {
			await ui.click(".prx-review-keep-new");
			await ui.click(".prx-review-submit");
		}
		await server.idle();
		await settle();
		expect(posts(ui).at(-1)?.requestId).toBe(id);
	}
	expect(server.state().threads.map((thread) => thread.messages[0].body)).toEqual([
		"Original",
		"Edited B",
	]);
	expect(bodies(storage)).toEqual(["Edited B2"]);
});

const collisionAnchor: ReviewAnchor = {
	courseId: null,
	lessonId: "lesson",
	pageId: "page",
	nodeId: null,
	blockId: null,
	revision: "revision",
	quote: null,
	pin: null,
	tab: null,
	revealPath: [],
	cssPath: null,
	context: { pageTitle: "Page title", targetLabel: null },
};
const refusedId = "22222222-2222-4222-8222-222222222222";
// Golden SHA-256 UUID chain for [candidate, "Kept text", collisionAnchor].
const collisionIds = [
	"9f84309a-6972-85c8-9225-c7b56aaa0991",
	"4ea7b754-77eb-8d10-beba-24a823d94bba",
	"3afcf60e-59b1-8af4-ae91-77ea7400f043",
	"6d1c48d2-472b-8244-9404-f4e900e6963e",
	"211981d6-5dd9-8c3e-8549-bc05085fd7e8",
	"edd7310e-ca53-8158-b986-54a6c49dffda",
	"e39cf41b-47e4-853e-9c08-4fe186093ef2",
	"3e545ab1-76b1-89c3-8947-546c2314ca6c",
];
const outboxFixture = (id: string, body = "Kept text") =>
	JSON.stringify({
		body,
		anchor: collisionAnchor,
		requestId: id,
		draftId: id,
		savedAt: "2026-10-19T00:00:00.000Z",
	});
const draftFixture = (body: string) =>
	JSON.stringify({
		body,
		anchor: collisionAnchor,
		savedAt: "2026-10-19T00:00:00.000Z",
	});
const refusalFetch = (code = "request_id_reused") =>
	vi.fn((_url, init) =>
		Promise.resolve(
			init?.method === "POST"
				? reply({ ok: false, code }, refusalStatuses[code as keyof typeof refusalStatuses])
				: reply({ ok: true, threads: [], nextCursor: null }),
		),
	);

it.each([1, 7, 8])(
	"reused refusals walk %i occupied slots, bounded at eight with an announced random fork",
	async (occupied) => {
		const saved: [string, string][] = [
			[`praxity-review-outbox:${reviewId}:page:${refusedId}`, outboxFixture(refusedId)],
			...collisionIds
				.slice(0, occupied)
				.map((id, i): [string, string] => [
					`praxity-review-draft:${reviewId}:page:${id}`,
					draftFixture(`Other intent ${i}`),
				]),
		];
		const ui = await open({ stored: saved, fetch: refusalFetch() });
		await ui.click(".prx-review-retry-outbox");
		await ui.click(".prx-review-submit");
		const remaining = Object.entries(ui.win.localStorage);
		for (const entry of saved.slice(1)) expect(remaining).toContainEqual(entry);
		const kept = remaining.filter(([, raw]) => JSON.parse(raw).body === "Kept text");
		expect(kept).toHaveLength(1);
		expect(kept[0][0]).toMatch(/^praxity-review-draft:/);
		if (occupied < 8)
			expect(kept[0][0]).toBe(`praxity-review-draft:${reviewId}:page:${collisionIds[occupied]}`);
		else expect(collisionIds).not.toContain(kept[0][0].slice(-36));
		expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
		const notice =
			occupied < 8
				? "This draft was posted from another tab. Your text was kept as a new draft."
				: "Another tab changed this draft. Your text was kept as a separate draft.";
		expect(ui.doc.querySelector(".prx-review-composer-notice")?.textContent).toBe(notice);
		expect(ui.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(notice);
		expect(posts(ui)).toHaveLength(1);
	},
);

it("reused refusals adopt an equal outbox along the chain without touching a competing draft", async () => {
	const candidate = collisionIds[1];
	const saved: [string, string][] = [
		[`praxity-review-outbox:${reviewId}:page:${refusedId}`, outboxFixture(refusedId)],
		[
			`praxity-review-outbox:${reviewId}:page:${collisionIds[0]}`,
			outboxFixture(collisionIds[0], "Other submission"),
		],
		[`praxity-review-draft:${reviewId}:page:${candidate}`, draftFixture("Competing edit")],
		[`praxity-review-outbox:${reviewId}:page:${candidate}`, outboxFixture(candidate)],
	];
	const ui = await open({ stored: saved, fetch: refusalFetch() });
	await ui.click(".prx-review-retry-outbox");
	await ui.click(".prx-review-submit");
	expect(Object.entries(ui.win.localStorage).sort()).toEqual(saved.slice(1).sort());
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Kept text");
	await ui.click(".prx-review-submit");
	expect(posts(ui).at(-1)?.requestId).toBe(candidate);
});

it("a definitive refusal accepts and announces a written conflict fork instead of blocking", async () => {
	const ui = await open({
		stored: [
			[`praxity-review-outbox:${reviewId}:page:${refusedId}`, outboxFixture(refusedId)],
			[`praxity-review-draft:${reviewId}:page:${refusedId}`, draftFixture("Competing edit")],
		],
		fetch: refusalFetch("invalid_input"),
	});
	await ui.click(".prx-review-retry-outbox");
	await ui.click(".prx-review-submit");
	expect(
		Object.values(ui.win.localStorage)
			.map((raw) => JSON.parse(raw).body)
			.sort(),
	).toEqual(["Competing edit", "Kept text"]);
	expect(
		Object.keys(ui.win.localStorage).every((key) => key.startsWith("praxity-review-draft:")),
	).toBe(true);
	expect(ui.doc.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
	expect(ui.doc.querySelector(".prx-review-composer-status")?.textContent).toBe(
		"Another tab changed this draft. Your text was kept as a separate draft.",
	);
	expect(ui.doc.querySelector(".prx-review-error")?.textContent).toBe(
		"The comment or its target is invalid.",
	);
});

it("stacked composer notices use one form gap and an empty live region stays in the accessibility tree", async () => {
	const css = await readFile(new URL("../template/review-comments.css", import.meta.url), "utf8");
	const ui = await open({ noLocks: true });
	const style = ui.doc.createElement("style");
	style.textContent = css;
	ui.doc.head.append(style);
	await ui.pick(0);
	for (const selector of [
		".prx-review-composer-notice",
		".prx-review-tab-warning",
		".prx-review-composer-status",
	]) {
		const region = ui.doc.querySelector<HTMLElement>(selector) as HTMLElement;
		expect(ui.win.getComputedStyle(region).margin).toBe("0px");
	}
	const status = ui.doc.querySelector<HTMLElement>(".prx-review-composer-status") as HTMLElement;
	expect(ui.win.getComputedStyle(status).padding).toBe("0px");
	expect(ui.win.getComputedStyle(status).display).not.toBe("none");
	expect(status.hidden).toBe(false);
	expect(status.getAttribute("role")).toBe("status");
});
