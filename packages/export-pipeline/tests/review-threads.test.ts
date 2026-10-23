import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import reviewEn from "../../editor-core/src/messages/en.json" with { type: "json" };
import {
	create,
	listThreads,
	REVIEW_LIMITS,
	REVIEW_TEXT_RULES,
	type ReviewAnchor,
	type ReviewPrincipal,
	type ReviewState,
	type ReviewVisibilityPolicy,
	reopen,
	reply,
	resolve,
} from "../../review-share/src/review";
import { enhanceDisclosure } from "../template/src/disclosure";
import { reviewPageLayout } from "./fixtures/review-page-layout";

const source = await readFile(new URL("../template/review-comments.js", import.meta.url), "utf8");
const reviewId = "11111111-1111-4111-8111-111111111111";
const reviewer: ReviewPrincipal = {
	id: "local",
	role: "reviewer",
	displayName: "PERSONAL NAME",
	provenance: "local-preview",
};
const author: ReviewPrincipal = { ...reviewer, role: "author", provenance: "local-cli" };
const deps = { now: () => "2026-10-19T12:34:00.000Z", uuid: randomUUID };
const anchor: ReviewAnchor = {
	courseId: null,
	lessonId: "lesson",
	pageId: "page",
	nodeId: "node",
	blockId: null,
	revision: "revision",
	quote: null,
	pin: null,
	tab: null,
	revealPath: [],
	cssPath: null,
	context: { pageTitle: "Page one", targetLabel: "Passage" },
};
const doms: JSDOM[] = [];
afterEach(async () => {
	for (const dom of doms.splice(0)) {
		dom.window.dispatchEvent(new dom.window.Event("pagehide"));
		await settle();
		dom.window.close();
	}
});
async function settle() {
	for (let i = 0; i < 100; i++) await Promise.resolve();
}
function fakeServer(policy?: ReviewVisibilityPolicy) {
	let state: ReviewState = {
		schema: 1,
		reviewId,
		course: { namespace: null, bound: false },
		changeSeq: 0,
		threads: [],
		receipts: [],
	};
	async function seed(body: string, target = anchor, principal = reviewer) {
		const result = await create(
			state,
			principal,
			{ reviewId, requestId: randomUUID(), anchor: target, body },
			deps,
		);
		if (!result.ok) throw new Error(result.code);
		state = result.state;
		return result.thread!;
	}
	async function mutate(
		kind: "reply" | "resolve" | "reopen",
		threadId: string,
		body?: string,
		principal = author,
	) {
		const thread = state.threads.find((thread) => thread.id === threadId)!;
		const result = await { reply, resolve, reopen }[kind](
			state,
			principal,
			{
				reviewId,
				threadId,
				expectVersion: thread.version,
				requestId: randomUUID(),
				...(body ? { body } : {}),
			},
			deps,
		);
		if (!result.ok) throw new Error(result.code);
		state = result.state;
		return result.thread!;
	}
	const fetch = vi.fn(async (raw: string, options?: RequestInit) => {
		const url = new URL(raw, "http://127.0.0.1:3456");
		if (options?.method === "POST") {
			const kind = url.pathname.split("/").at(-1) as "reply" | "reopen";
			const result = await { reply, reopen }[kind](
				state,
				reviewer,
				JSON.parse(String(options.body)),
				deps,
			);
			if (result.ok) state = result.state;
			return new Response(JSON.stringify(result), { status: result.ok ? 200 : 409 });
		}
		const result = await listThreads(state, reviewer, {}, policy);
		return new Response(
			JSON.stringify({ ok: true, ...result, principal: { id: reviewer.id, role: reviewer.role } }),
		);
	});
	return { seed, mutate, fetch, state: () => state };
}
async function open(
	server: ReturnType<typeof fakeServer>,
	locale = "en",
	markup = '<p data-node-id="node">Passage</p>',
	prepare?: (dom: JSDOM) => void,
	expand = true,
) {
	const config = {
		schema: 1,
		reviewId,
		capability: "A".repeat(43),
		endpoint: `/api/reviews/${reviewId}`,
		locale,
		limits: REVIEW_LIMITS,
		blockNames: reviewEn.pedagogyAudit.blockTypes,
		textRules: {
			controls: REVIEW_TEXT_RULES.bodyControls,
			surrogates: REVIEW_TEXT_RULES.surrogates,
		},
		page: {
			lessonId: "lesson",
			pageId: "page",
			pageIds: ["page", "other"],
			pageIndex: 0,
			revision: "revision",
		},
	};
	const dom = new JSDOM(
		`<!doctype html><html><head><script type="application/json" id="praxity-review-config">${JSON.stringify(config)}</script><script data-praxity-review-comments="true"></script></head><body><main><h1>Page one</h1>${markup}</main></body></html>`,
		{
			url: "http://127.0.0.1:3456/lesson.html",
			runScripts: "outside-only",
			pretendToBeVisual: true,
		},
	);
	doms.push(dom);
	reviewPageLayout(dom);
	let responseRead = Promise.resolve();
	dom.window.fetch = ((...args: Parameters<typeof server.fetch>) => {
		let read!: () => void;
		responseRead = new Promise<void>((resolve) => {
			read = resolve;
		});
		return server.fetch(...args).then(
			(response) => {
				const json = response.json.bind(response);
				response.json = () => json().finally(read);
				return response;
			},
			(error) => {
				read();
				throw error;
			},
		);
	}) as typeof dom.window.fetch;
	dom.window.requestAnimationFrame = () => 1;
	dom.window.HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	dom.window.HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	prepare?.(dom);
	dom.window.eval(source);
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
	await settle();
	const doc = dom.window.document;
	await vi.waitFor(() =>
		expect(
			doc.querySelectorAll(".prx-review-comment").length > 0 ||
				/No comments in this review yet|Aucun commentaire dans cette révision/.test(
					doc.querySelector(".prx-review-status")?.textContent || "",
				),
		).toBe(true),
	);
	if (expand) (doc.querySelector(".prx-review-toggle") as HTMLButtonElement).click();
	return {
		dom,
		doc,
		refresh: async () => {
			dom.window.dispatchEvent(new dom.window.Event("focus"));
			// Native Response bodies need an event-loop turn, not just microtask draining.
			await responseRead;
			await settle();
		},
	};
}
function click(doc: Document, selector: string) {
	(doc.querySelector(selector) as HTMLButtonElement).click();
}

it.each(["en", "fr"])(
	"Show on page keeps its visible label beside a decorative magnifier (%s)",
	async (locale) => {
		const server = fakeServer();
		await server.seed("Initial");
		const { doc } = await open(server, locale);
		const show = doc.querySelector(".prx-review-show") as HTMLButtonElement;
		const label = locale === "fr" ? "Afficher sur la page" : "Show on page";
		expect(show.textContent).toBe(label);
		expect(show.getAttribute("aria-label")).toContain(label);
		expect(show.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
		expect(show.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
	},
);

it.each(["MacIntel", "Linux x86_64"])(
	"keyboard reply uses validation, in-flight guards and frozen retry (%s)",
	async (platform) => {
		const server = fakeServer();
		await server.seed("Initial");
		const { doc, dom } = await open(server, "en", undefined, (dom) => {
			Object.defineProperty(dom.window.navigator, "platform", { value: platform });
		});
		click(doc, ".prx-review-reply-toggle");
		const field = doc.querySelector<HTMLTextAreaElement>(".prx-review-reply textarea")!;
		const mac = platform === "MacIntel";
		expect(doc.querySelector(".prx-review-reply-send")?.getAttribute("aria-keyshortcuts")).toBe(
			mac ? "Meta+Enter" : "Control+Enter",
		);
		const press = (modifiers = { metaKey: mac, ctrlKey: !mac }) => {
			const event = new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				...modifiers,
			});
			field.dispatchEvent(event);
			return event;
		};
		const posts = () => server.fetch.mock.calls.filter(([, options]) => options?.method === "POST");
		for (const text of ["", " ", "x".repeat(REVIEW_LIMITS.body + 1)]) {
			field.value = text;
			press();
			await settle();
			expect(posts()).toHaveLength(0);
			expect(field.getAttribute("aria-invalid")).toBe("true");
		}
		field.value = "Reply\nwith newline";
		expect(press({ metaKey: false, ctrlKey: false }).defaultPrevented).toBe(false);
		press({ metaKey: !mac, ctrlKey: mac });
		await settle();
		expect(posts()).toHaveLength(0);
		let release!: () => void;
		server.fetch.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			throw new Error("offline");
		});
		press();
		press();
		await settle();
		expect(posts()).toHaveLength(1);
		release();
		await settle();
		expect(field.readOnly).toBe(true);
		field.value = "Changed behind the frozen field";
		press();
		await settle();
		expect(posts()).toHaveLength(2);
		expect(posts()[1][1]?.body).toBe(posts()[0][1]?.body);
		await vi.waitFor(() =>
			expect(server.state().threads[0].messages.at(-1)?.body).toBe("Reply\nwith newline"),
		);
	},
);

function pollClock(dom: JSDOM) {
	const native = dom.window.setTimeout.bind(dom.window);
	let tick: (() => Promise<void>) | undefined;
	const delays: number[] = [];
	vi.spyOn(dom.window, "setTimeout").mockImplementation((callback, delay, ...args) => {
		if (delay && delay >= 5000) {
			delays.push(delay);
			tick = callback as () => Promise<void>;
			return 987654;
		}
		return native(callback, delay, ...args);
	});
	return {
		delays,
		tick: async () => {
			await tick!();
			await settle();
		},
	};
}

it.each(
	["en", "fr"].flatMap((locale) =>
		["list-first", "activation-first", "already-active", "pagehide"].map((order) => ({
			locale,
			order,
		})),
	),
)(
	"focuses a cross-lesson anchor after Deck activation ($locale, $order)",
	async ({ locale, order }) => {
		const server = fakeServer();
		const thread = await server.seed("Destination thread");
		const fetch = server.fetch.getMockImplementation()!;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		server.fetch.mockImplementation(async (...args) => {
			await gate;
			return fetch(...args);
		});
		let destination!: JSDOM;
		function activate() {
			const { window } = destination;
			window.document.querySelector<HTMLElement>(".praxity-deck")!.dataset.ready = "true";
			window.document.querySelector<HTMLElement>(".deck-workspace")!.style.display = "";
			window.dispatchEvent(
				new window.CustomEvent("praxity:active-page-change", { detail: { pageId: "page" } }),
			);
			// Deck's owner finishes orientation after dispatching its activation signal.
			window.document.querySelector<HTMLElement>("[data-deck-slide] h2")!.focus();
		}
		const opening = open(
			server,
			locale,
			'<div class="praxity-deck"><div class="deck-utility-items"></div><div class="deck-workspace" style="display:none"><section data-deck-slide="page"><h2 tabindex="-1">Destination</h2><p data-node-id="node">Passage</p></section></div></div>',
			(dom) => {
				destination = dom;
				dom.window.history.replaceState(null, "", `?keep=yes&review-thread=${thread.id}#page`);
				if (order === "already-active") activate();
			},
			false,
		);
		await settle();
		if (order === "activation-first") activate();
		release();
		const { doc, dom } = await opening;
		if (order === "pagehide") {
			dom.window.dispatchEvent(new dom.window.Event("pagehide"));
			activate();
			await settle();
			expect(doc.activeElement).toBe(doc.querySelector("[data-deck-slide] h2"));
			return;
		}
		if (order === "list-first") {
			expect(new URL(dom.window.location.href).searchParams.get("review-thread")).toBe(thread.id);
			expect(doc.activeElement).not.toBe(doc.querySelector('[data-node-id="node"]'));
			const reviewControl = doc.querySelector<HTMLButtonElement>(".prx-review-toggle")!;
			reviewControl.focus();
			for (const input of ["pointerdown", "keydown"])
				reviewControl.dispatchEvent(new dom.window.Event(input, { bubbles: true }));
			activate();
			await settle();
		}
		expect(doc.activeElement).toBe(doc.querySelector('[data-node-id="node"]'));
		expect(dom.window.location.search).toBe("?keep=yes");
		expect(dom.window.location.hash).toBe("#page");
	},
);

const jumpDeckMarkup =
	'<div class="praxity-deck" data-ready="true"><div class="deck-utility-items"></div><div class="deck-workspace">' +
	'<section data-deck-slide="page"><h2 tabindex="-1">Slide one</h2><p data-node-id="node">Passage</p></section>' +
	'<section data-deck-slide="other" hidden inert><h2 tabindex="-1">Slide two</h2><p data-node-id="node2">Elsewhere</p></section></div></div>';
const otherSlideAnchor: ReviewAnchor = { ...anchor, pageId: "other", nodeId: "node2" };
function activateDeck(dom: JSDOM, id: string) {
	const doc = dom.window.document;
	doc.querySelector<HTMLElement>(".praxity-deck")!.dataset.ready = "true";
	for (const slide of doc.querySelectorAll<HTMLElement>("[data-deck-slide]")) {
		slide.hidden = slide.dataset.deckSlide !== id;
		slide.inert = slide.hidden;
		slide.toggleAttribute("inert", slide.hidden);
	}
	dom.window.dispatchEvent(
		new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: id } }),
	);
	const heading = doc.querySelector<HTMLElement>(`[data-deck-slide="${id}"] h2`)!;
	heading.focus();
	return heading;
}

it.each(["en", "fr"])("ends a refused arrival before the list responds (%s)", async (locale) => {
	const server = fakeServer();
	const thread = await server.seed("Locked slide", otherSlideAnchor);
	const fetch = server.fetch.getMockImplementation()!;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	server.fetch.mockImplementation(async (...args) => {
		await gate;
		return fetch(...args);
	});
	let destination!: JSDOM;
	const opening = open(
		server,
		locale,
		jumpDeckMarkup,
		(dom) => {
			destination = dom;
			dom.window.document.querySelector(".praxity-deck")!.removeAttribute("data-ready");
			dom.window.history.replaceState(null, "", `?keep=yes&review-thread=${thread.id}#other`);
		},
		false,
	);
	await settle();
	const heading = activateDeck(destination, "page");
	const searchBeforeList = destination.window.location.search;
	release();
	const { doc } = await opening;
	expect(searchBeforeList).toBe("?keep=yes");
	expect(doc.activeElement).toBe(heading);
	const laterHeading = activateDeck(destination, "other");
	await settle();
	expect(doc.activeElement).toBe(laterHeading);
	expect(doc.querySelector(".prx-review-toggle")?.getAttribute("aria-expanded")).toBe("false");
});

it.each(["en", "fr"])(
	"discards a malformed arrival fragment without disrupting the list (%s)",
	async (locale) => {
		const server = fakeServer();
		const thread = await server.seed("Arrival");
		const { doc, dom } = await open(
			server,
			locale,
			jumpDeckMarkup,
			(dom) => {
				dom.window.history.replaceState(null, "", `?keep=yes&review-thread=${thread.id}#%E0%A4%A`);
			},
			false,
		);
		const heading = activateDeck(dom, "page");
		await settle();
		expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1);
		expect(dom.window.location.search).toBe("?keep=yes");
		expect(doc.activeElement).toBe(heading);
		expect(doc.querySelector(".prx-review-toggle")?.getAttribute("aria-expanded")).toBe("false");
	},
);

it.each(["en", "fr"].flatMap((locale) => [false, true].map((ready) => ({ locale, ready }))))(
	"discards a refused Deck arrival without stealing focus on a later visit ($locale, ready=$ready)",
	async ({ locale, ready }) => {
		const server = fakeServer();
		const thread = await server.seed("Locked slide", otherSlideAnchor);
		const { dom, doc, refresh } = await open(
			server,
			locale,
			jumpDeckMarkup,
			(dom) => {
				dom.window.history.replaceState(null, "", `?keep=yes&review-thread=${thread.id}#other`);
				if (!ready)
					dom.window.document.querySelector(".praxity-deck")!.removeAttribute("data-ready");
			},
			false,
		);
		const heading = activateDeck(dom, "page");
		await settle();
		expect(dom.window.location.search).toBe("?keep=yes");
		expect(doc.activeElement).toBe(heading);
		expect(doc.querySelector(".prx-review-toggle")?.getAttribute("aria-expanded")).toBe("false");
		const laterHeading = activateDeck(dom, "other");
		await refresh();
		expect(doc.activeElement).toBe(laterHeading);
		expect(doc.querySelector(".prx-review-toggle")?.getAttribute("aria-expanded")).toBe("false");
	},
);

it.each(
	["en", "fr"].flatMap((locale) => [false, true].map((supersede) => ({ locale, supersede }))),
)(
	"does not replay a refused in-document jump on a later Deck visit ($locale, supersede=$supersede)",
	async ({ locale, supersede }) => {
		const server = fakeServer();
		const locked = await server.seed("Locked slide", otherSlideAnchor);
		const current = await server.seed("Current slide");
		const { dom, doc } = await open(server, locale, jumpDeckMarkup);
		click(doc, `[data-thread-id="${locked.id}"] .prx-review-show`);
		if (supersede) {
			click(doc, `[data-thread-id="${current.id}"] .prx-review-show`);
			expect(doc.activeElement).toBe(doc.querySelector('[data-node-id="node"]'));
		} else {
			const heading = activateDeck(dom, "page");
			await settle();
			expect(doc.activeElement).toBe(heading);
		}
		click(doc, ".prx-review-toggle");
		const heading = activateDeck(dom, "other");
		await settle();
		expect(doc.activeElement).toBe(heading);
		expect(doc.querySelector(".prx-review-toggle")?.getAttribute("aria-expanded")).toBe("false");
	},
);

it.each(
	["en", "fr"].flatMap((locale) =>
		["pointerdown", "keydown", "focusin"].map((input) => ({ locale, input })),
	),
)(
	"does not complete a recovered arrival after outside $input ($locale)",
	async ({ locale, input }) => {
		const server = fakeServer();
		const thread = await server.seed("Arrival");
		const fetch = server.fetch.getMockImplementation()!;
		server.fetch.mockRejectedValue(new Error("offline"));
		let destination!: JSDOM;
		const opening = open(
			server,
			locale,
			jumpDeckMarkup,
			(dom) => {
				destination = dom;
				dom.window.document.querySelector(".praxity-deck")!.removeAttribute("data-ready");
				dom.window.history.replaceState(null, "", `?keep=yes&review-thread=${thread.id}#page`);
			},
			false,
		);
		await settle();
		const doc = destination.window.document;
		expect(doc.querySelector<HTMLElement>(".prx-review-stale")!.hidden).toBe(false);
		const heading = activateDeck(destination, "page");
		await settle();
		if (input === "focusin") {
			heading.blur();
			heading.focus();
		} else heading.dispatchEvent(new destination.window.Event(input, { bubbles: true }));
		const searchBeforeRecovery = destination.window.location.search;
		server.fetch.mockImplementation(fetch);
		destination.window.dispatchEvent(new destination.window.Event("focus"));
		await opening;
		await settle();
		expect(searchBeforeRecovery).toBe("?keep=yes");
		expect(doc.activeElement).toBe(heading);
		expect(doc.querySelector(".prx-review-toggle")?.getAttribute("aria-expanded")).toBe("false");
	},
);

it.each(["en", "fr"].flatMap((locale) => [false, true].map((deck) => ({ locale, deck }))))(
	"offers one close control and keeps focus on it ($locale, deck=$deck)",
	async ({ locale, deck }) => {
		const { doc } = await open(fakeServer(), locale, undefined, (dom) => {
			if (!deck) return;
			const shell = dom.window.document.createElement("div");
			shell.className = "praxity-deck";
			shell.innerHTML = '<div class="deck-utility-items"></div><div class="deck-workspace"></div>';
			shell.lastElementChild!.append(dom.window.document.querySelector("main")!);
			dom.window.document.body.append(shell);
		});
		const label = locale === "fr" ? "Fermer les commentaires" : "Close comments";
		const controls = Array.from(doc.querySelectorAll("button")).filter(
			(button) => (button.getAttribute("aria-label") || button.textContent) === label,
		);
		expect(controls).toHaveLength(1);
		const toggle = controls[0];
		const header = doc.querySelector(".prx-review-header")!;
		expect([...header.children].map((node) => node.className)).toEqual([
			"prx-review-title",
			"prx-review-toggle" + (deck ? " prx-review-toggle--deck" : ""),
			"prx-review-choose prx-review-action",
			"prx-review-pin prx-review-action",
		]);
		expect(toggle.textContent).toBe(label);
		expect(toggle.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
		toggle.focus();
		toggle.click();
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(doc.activeElement).toBe(toggle);
		expect(doc.querySelector(".prx-review-footer")?.textContent).toBe(
			locale === "fr" ? "Révision locale" : "Local review",
		);
	},
);

it.each(["en", "fr"])(
	"exposes one uniquely named visible deck review toggle through Tools (%s)",
	async (locale) => {
		let disclosure: ReturnType<typeof enhanceDisclosure> | undefined;
		try {
			const { doc } = await open(
				fakeServer(),
				locale,
				undefined,
				(dom) => {
					const doc = dom.window.document;
					const shell = doc.createElement("div");
					shell.className = "praxity-deck";
					shell.innerHTML =
						'<div id="deck-more"><button id="deck-more-toggle" aria-expanded="false" aria-controls="deck-more-panel"></button><div id="deck-more-panel" class="deck-utility-items"></div></div><div class="deck-workspace"></div>';
					shell.lastElementChild!.append(doc.querySelector("main")!);
					doc.body.append(shell);
					const tools = doc.querySelector<HTMLButtonElement>("#deck-more-toggle")!;
					tools.textContent = locale === "fr" ? "Outils" : "Tools";
					vi.stubGlobal("document", doc);
					vi.stubGlobal("window", dom.window);
					vi.stubGlobal("location", dom.window.location);
					disclosure = enhanceDisclosure(
						tools,
						doc.querySelector<HTMLElement>("#deck-more-panel")!,
					);
				},
				false,
			);
			const tools = doc.querySelector<HTMLButtonElement>("#deck-more-toggle")!;
			const toggle = doc.querySelector<HTMLButtonElement>(".prx-review-toggle")!;
			const visibleButtons = () =>
				Array.from(doc.querySelectorAll("button")).filter((button) => {
					for (let node: HTMLElement | null = button; node; node = node.parentElement) {
						if (node.hidden || doc.defaultView!.getComputedStyle(node).display === "none")
							return false;
					}
					return true;
				});
			function expectSingleVisibleToggle(name: string) {
				expect(doc.querySelectorAll(".prx-review-toggle")).toHaveLength(1);
				expect(
					visibleButtons().filter((button) => button.classList.contains("prx-review-toggle")),
				).toEqual([toggle]);
				expect(
					visibleButtons().filter(
						(button) => (button.getAttribute("aria-label") || button.textContent) === name,
					),
				).toEqual([toggle]);
			}
			expect(visibleButtons()).toContain(tools);
			expect(visibleButtons()).not.toContain(toggle);
			tools.click();
			expectSingleVisibleToggle(
				locale === "fr" ? "Développer les commentaires" : "Expand comments",
			);
			toggle.focus();
			toggle.click();
			expectSingleVisibleToggle(locale === "fr" ? "Fermer les commentaires" : "Close comments");
			expect(tools.getAttribute("aria-expanded")).toBe("false");
			expect(doc.activeElement).toBe(toggle);
			toggle.click();
			expectSingleVisibleToggle(
				locale === "fr" ? "Développer les commentaires" : "Expand comments",
			);
			expect(tools.getAttribute("aria-expanded")).toBe("true");
			expect(doc.activeElement).toBe(toggle);
		} finally {
			disclosure?.destroy();
			vi.unstubAllGlobals();
		}
	},
);

it.each(["en", "fr"].flatMap((locale) => ["review", "filter"].map((empty) => ({ locale, empty }))))(
	"announces recovery once for an unchanged empty $empty ($locale)",
	async ({ locale, empty }) => {
		const server = fakeServer();
		if (empty === "filter") await server.seed("Open thread");
		const { doc, dom, refresh } = await open(server, locale);
		if (empty === "filter") click(doc, '[data-review-filter="resolved"]');
		await settle();
		const expected =
			empty === "review"
				? locale === "fr"
					? "Aucun commentaire dans cette révision."
					: "No comments in this review yet."
				: locale === "fr"
					? "0 commentaires, filtre : Résolu."
					: "0 comments, filter: Resolved.";
		const real = server.fetch.getMockImplementation()!;
		server.fetch.mockRejectedValue(new Error("offline"));
		await refresh();
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
			locale === "fr" ? "Impossible de charger les commentaires." : "Comments could not be loaded.",
		);
		const seen: string[] = [];
		const observer = new dom.window.MutationObserver(() => {
			seen.push(doc.querySelector(".prx-review-status")!.textContent!);
		});
		observer.observe(doc.querySelector(".prx-review-status")!, { childList: true });
		server.fetch.mockImplementation(real);
		await refresh();
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe(expected);
		expect((doc.querySelector(".prx-review-stale") as HTMLElement).hidden).toBe(true);
		await refresh();
		expect(seen.filter((text) => text === expected)).toHaveLength(1);
		observer.disconnect();
	},
);

it("a superseded never-settling list cannot block polls after a successful focus refresh", async () => {
	const server = fakeServer();
	await server.seed("Initial");
	let clock!: ReturnType<typeof pollClock>;
	const { dom, refresh } = await open(server, "en", undefined, (dom) => {
		clock = pollClock(dom);
	});
	server.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
	void clock.tick();
	await settle();
	await refresh();
	const before = server.fetch.mock.calls.length;
	await clock.tick();
	await clock.tick();
	expect(server.fetch.mock.calls.length).toBe(before + 2);
});

it.each(["reply", "reopen"])(
	"does not claim Retry is needed while %s is still in flight",
	async (kind) => {
		const server = fakeServer();
		const thread = await server.seed("Initial");
		await server.mutate("resolve", thread.id, "Done");
		const { doc } = await open(server);
		click(doc, ".prx-review-reply-toggle");
		(doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement).value = "Reply";
		const real = server.fetch.getMockImplementation()!;
		let release!: () => void;
		server.fetch.mockImplementationOnce(async (url, options) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return real(url, options);
		});
		const before = doc.querySelector(".prx-review-status")?.textContent;
		click(doc, kind === "reply" ? ".prx-review-reply-send" : ".prx-review-reopen");
		await settle();
		click(doc, kind === "reply" ? ".prx-review-reopen" : ".prx-review-reply-send");
		await settle();
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe(before);
		expect((doc.querySelector(".prx-review-comment .prx-review-error") as HTMLElement).hidden).toBe(
			true,
		);
		expect(
			server.fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
		).toHaveLength(1);
		release();
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-reply-send")?.hasAttribute("aria-disabled")).toBe(
				false,
			),
		);
	},
);

it.each(["en", "fr"].flatMap((locale) => [false, true].map((deck) => ({ locale, deck }))))(
	"never resolves off-page quotes or blocks against the active page ($locale, deck=$deck)",
	async ({ locale, deck }) => {
		const server = fakeServer();
		await server.seed("Off-page quote", {
			...anchor,
			pageId: "other",
			nodeId: "off-page-text",
			quote: { type: "TextQuoteSelector", exact: "Passage", prefix: "", suffix: "" },
		});
		await server.seed("Off-page block", { ...anchor, pageId: "other", nodeId: "absent" });
		const frames: FrameRequestCallback[] = [];
		const highlights = new Map();
		const { doc, dom } = await open(
			server,
			locale,
			deck
				? '<section data-deck-slide="page"><p data-node-id="node">Passage</p></section><section data-deck-slide="other" hidden><p data-node-id="off-page-text">Passage</p><p data-node-id="absent">Block on other slide</p></section>'
				: '<p data-node-id="node">Passage</p>',
			(dom) => {
				dom.window.requestAnimationFrame = (callback) => frames.push(callback);
				Object.defineProperty(dom.window.document.documentElement, "clientWidth", { value: 1280 });
				Object.defineProperty(dom.window.document.documentElement, "clientHeight", { value: 900 });
				dom.window.Element.prototype.getBoundingClientRect = () => ({
					x: 200,
					y: 200,
					left: 200,
					right: 500,
					top: 200,
					bottom: 240,
					width: 300,
					height: 40,
					toJSON() {},
				});
				dom.window.document.elementFromPoint = () => dom.window.document.querySelector("main");
				Object.defineProperty(dom.window, "CSS", { value: { highlights } });
				Object.defineProperty(dom.window, "Highlight", {
					value: class extends Set {
						constructor(...ranges: Range[]) {
							super(ranges);
						}
					},
				});
			},
		);
		for (const frame of frames.splice(0)) frame(0);
		await settle();
		expect(
			[...doc.querySelectorAll<HTMLButtonElement>(".prx-review-marker")].every(
				(marker) => marker.hidden,
			),
		).toBe(true);
		expect(highlights.size).toBe(0);
		expect(
			[...doc.querySelectorAll(".prx-review-anchor-status")].map((chip) => chip.textContent),
		).toEqual(Array(2).fill(locale === "fr" ? "Sur une autre page" : "On another page"));
		expect(doc.querySelector(".prx-review-list")?.textContent).not.toMatch(
			/Target deleted|Target moved|Cible supprimée|Cible déplacée/,
		);
		expect(dom.window.location.hash).toBe("");
	},
);

it.each(["en", "fr"])(
	"shows a localized visible stale notice while hidden pages skip polling (%s)",
	async (locale) => {
		const server = fakeServer();
		await server.seed("Initial");
		let clock!: ReturnType<typeof pollClock>;
		const { doc, dom } = await open(server, locale, undefined, (dom) => {
			clock = pollClock(dom);
		});
		Object.defineProperty(doc, "hidden", { configurable: true, value: true });
		const before = server.fetch.mock.calls.length;
		await clock.tick();
		expect(server.fetch.mock.calls.length).toBe(before);
		Object.defineProperty(doc, "hidden", { configurable: true, value: false });
		server.fetch.mockRejectedValue(new Error("offline"));
		await clock.tick();
		const stale = doc.querySelector(".prx-review-stale") as HTMLElement;
		expect(stale.hidden).toBe(false);
		expect(stale.textContent).toBe(
			locale === "fr"
				? "Commentaires hors ligne ou périmés. Nouvelle tentative automatique."
				: "Comments are offline or out of date. Retrying automatically.",
		);
		expect(stale.classList.contains("praxity-a11y-sr-only")).toBe(false);
	},
);

it.each(["en", "fr"])(
	"keeps a lost reopen retry reachable after refresh and explains a blocked reply (%s)",
	async (locale) => {
		const server = fakeServer();
		const thread = await server.seed("Initial");
		await server.mutate("resolve", thread.id, "Done");
		const { doc, refresh } = await open(server, locale);
		const real = server.fetch.getMockImplementation()!;
		let lost = true;
		server.fetch.mockImplementation(async (url, options) => {
			const response = await real(url, options);
			if (options?.method === "POST" && lost) {
				lost = false;
				throw new Error("lost reopen response");
			}
			return response;
		});
		click(doc, ".prx-review-reopen");
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-reopen")?.textContent).toBe(
				locale === "fr" ? "Réessayer" : "Retry",
			),
		);
		await refresh();
		expect((doc.querySelector(".prx-review-reopen") as HTMLButtonElement).hidden).toBe(false);
		click(doc, ".prx-review-reply-toggle");
		(doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement).value = "New reply";
		click(doc, ".prx-review-reply-send");
		await settle();
		const explanation =
			locale === "fr"
				? "Réessayez l’action précédente avant d’en commencer une autre."
				: "Retry the earlier action before starting another.";
		expect(doc.querySelector(".prx-review-comment .prx-review-error")?.textContent).toBe(
			explanation,
		);
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe(explanation);
		click(doc, ".prx-review-reopen");
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-reopen")?.textContent).not.toBe(
				locale === "fr" ? "Réessayer" : "Retry",
			),
		);
		click(doc, ".prx-review-reply-send");
		await vi.waitFor(() =>
			expect(server.state().threads[0].messages.at(-1)?.body).toBe("New reply"),
		);
		const posts = server.fetch.mock.calls.filter(([, options]) => options?.method === "POST");
		expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
		expect(server.state().threads[0].version).toBe(4);
	},
);

it("freezes a failed reply's text and explains a blocked Reopen without losing Retry", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	await server.mutate("resolve", thread.id, "Done");
	const { doc } = await open(server);
	click(doc, ".prx-review-reply-toggle");
	const field = doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement;
	field.value = "Frozen reply";
	server.fetch.mockRejectedValue(new Error("offline"));
	click(doc, ".prx-review-reply-send");
	await settle();
	expect(field.readOnly).toBe(true);
	click(doc, ".prx-review-reopen");
	await settle();
	expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
		"Retry the earlier action before starting another.",
	);
	expect(doc.querySelector(".prx-review-comment .prx-review-error")?.textContent).toBe(
		"Retry the earlier action before starting another.",
	);
	expect(doc.querySelector(".prx-review-reply-send")?.textContent).toBe("Retry");
	expect(field.value).toBe("Frozen reply");
});

it("backs off failed polls, announces once per streak, resets on success/focus and resumes from bfcache", async () => {
	const server = fakeServer();
	await server.seed("Initial");
	let clock!: ReturnType<typeof pollClock>;
	const { doc, dom, refresh } = await open(server, "en", undefined, (dom) => {
		clock = pollClock(dom);
	});
	const real = server.fetch.getMockImplementation()!;
	server.fetch.mockRejectedValue(new Error("offline"));
	const seen: string[] = [];
	const observer = new dom.window.MutationObserver(() => {
		seen.push(doc.querySelector(".prx-review-status")!.textContent!);
	});
	observer.observe(doc.querySelector(".prx-review-status")!, { childList: true });
	for (let i = 0; i < 5; i++) await clock.tick();
	expect(clock.delays.slice(-6)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
	expect(seen.filter((text) => text === "Comments could not be loaded.")).toHaveLength(1);
	expect((doc.querySelector(".prx-review-stale") as HTMLElement).hidden).toBe(false);
	await refresh();
	expect(clock.delays.at(-1)).toBe(10000);
	expect(seen.filter((text) => text === "Comments could not be loaded.")).toHaveLength(1);
	server.fetch.mockImplementation(real);
	await clock.tick();
	expect(clock.delays.at(-1)).toBe(5000);
	expect((doc.querySelector(".prx-review-stale") as HTMLElement).hidden).toBe(true);
	server.fetch.mockRejectedValue(new Error("offline"));
	await clock.tick();
	expect(seen.filter((text) => text === "Comments could not be loaded.")).toHaveLength(2);
	server.fetch.mockImplementation(real);
	dom.window.dispatchEvent(new dom.window.Event("pagehide"));
	const before = server.fetch.mock.calls.length;
	dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pageshow", { persisted: true }));
	await vi.waitFor(() => expect(server.fetch.mock.calls.length).toBeGreaterThan(before));
	await settle();
	expect(clock.delays.at(-1)).toBe(5000);
	observer.disconnect();
});

it("skips a poll while a list request is already in flight", async () => {
	const server = fakeServer();
	await server.seed("Initial");
	let clock!: ReturnType<typeof pollClock>;
	const { dom } = await open(server, "en", undefined, (dom) => {
		clock = pollClock(dom);
	});
	const real = server.fetch.getMockImplementation()!;
	let release!: () => void;
	server.fetch.mockImplementationOnce(async (url, options) => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return real(url, options);
	});
	dom.window.dispatchEvent(new dom.window.Event("focus"));
	await settle();
	const before = server.fetch.mock.calls.length;
	await clock.tick();
	expect(server.fetch.mock.calls.length).toBe(before);
	release();
	await settle();
});

it.each(["en", "fr"])(
	"guards another lesson's Show on page with a native dialog and restores focus (%s)",
	async (locale) => {
		const server = fakeServer();
		await server.seed("Current");
		await server.seed("Other", { ...anchor, pageId: "other" });
		const { doc, dom } = await open(server, locale, undefined, (dom) => {
			const config = dom.window.document.querySelector("#praxity-review-config")!;
			config.textContent = JSON.stringify({
				...JSON.parse(config.textContent!),
				pages: [{ id: "other", href: "/canvas/preview/course/other.html" }],
			});
		});
		click(doc, ".prx-review-reply-toggle");
		const field = doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement;
		field.value = "Keep me";
		const show = doc.querySelectorAll<HTMLButtonElement>(".prx-review-show")[1];
		show.focus();
		show.click();
		const dialog = doc.querySelector<HTMLDialogElement>(".prx-review-leave-dialog")!;
		expect(dialog?.open).toBe(true);
		expect(dialog.querySelector("h2")?.textContent).toBe(
			locale === "fr"
				? "Vous avez des modifications de révision non envoyées. Quitter quand même ?"
				: "You have unsent review changes. Leave anyway?",
		);
		expect(dialog.contains(doc.activeElement)).toBe(true);
		expect(dom.window.location.pathname).toBe("/lesson.html");
		dialog.dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
		expect(dialog.open).toBe(false);
		expect(doc.activeElement).toBe(show);
		expect(field.value).toBe("Keep me");
		// A frozen request still needs protection after the reply box is closed and empty.
		server.fetch.mockRejectedValue(new Error("offline"));
		click(doc, ".prx-review-reply-send");
		await settle();
		field.value = "";
		click(doc, ".prx-review-reply-cancel");
		show.click();
		expect(dialog.open).toBe(true);
		(dialog.querySelector("button") as HTMLButtonElement).click();
		expect(dialog.open).toBe(false);
	},
);

it("consumes only review-thread and leaves unchanged refreshes and unchanged heading text alone", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial", {
		...anchor,
		quote: { type: "TextQuoteSelector", exact: "Passage", prefix: "", suffix: "" },
	});
	const second = await server.seed("Second");
	const { doc, dom, refresh } = await open(server, "en", undefined, (dom) => {
		dom.window.history.replaceState(null, "", `?keep=yes&review-thread=${thread.id}#existing`);
		dom.window.HTMLElement.prototype.scrollIntoView = () => {};
	});
	expect(dom.window.location.search).toBe("?keep=yes");
	expect(dom.window.location.hash).toBe("#existing");
	expect(doc.activeElement).toBe(doc.querySelector('[data-node-id="node"]'));
	const writes: MutationRecord[] = [];
	const quote = doc.querySelector(".prx-review-quote")!;
	const selection = dom.window.getSelection()!;
	const range = doc.createRange();
	range.selectNodeContents(quote);
	selection.removeAllRanges();
	selection.addRange(range);
	const selectedNode = selection.anchorNode;
	const observer = new dom.window.MutationObserver((records) => writes.push(...records));
	observer.observe(doc.querySelector(".prx-review-list")!, {
		childList: true,
		subtree: true,
		attributes: true,
	});
	await refresh();
	expect(writes).toHaveLength(0);
	expect(selection.anchorNode).toBe(selectedNode);
	expect(selection.toString()).toBe("Passage");
	observer.disconnect();
	observer.observe(doc.querySelector(".prx-review-thread-heading")!, {
		childList: true,
		subtree: true,
	});
	observer.observe(quote, { childList: true, subtree: true });
	await server.mutate("reply", second.id, "New message");
	await refresh();
	expect(writes).toHaveLength(0);
	expect(selection.anchorNode).toBe(selectedNode);
	expect(selection.toString()).toBe("Passage");
	observer.disconnect();
});

it.each(["en", "fr"])("lists visible pages with refreshed filter counts (%s)", async (locale) => {
	const server = fakeServer({
		visibleTo: (_principal, thread) => thread.messages[0].body !== "Hidden by policy",
	});
	await server.seed("Other page", {
		...anchor,
		pageId: "other",
		context: { pageTitle: "Page two", targetLabel: null },
	});
	await server.seed("This page");
	await server.seed("Hidden by policy");
	const resolved = await server.seed("Completed");
	await server.mutate("resolve", resolved.id, "Fixed by agent");
	const { doc, refresh } = await open(server, locale);
	const labels = () =>
		[...doc.querySelectorAll(".prx-review-filter-label")].map((node) => node.textContent);
	expect(labels()).toEqual(
		locale === "fr"
			? ["Ouvert (2)", "Résolu (1)", "Tous (3)"]
			: ["Open (2)", "Resolved (1)", "All (3)"],
	);
	expect(
		[...doc.querySelectorAll(".prx-review-comment-text")].map((node) => node.textContent),
	).toEqual(["This page", "Completed", "Fixed by agent", "Other page"]);
	expect(doc.querySelector(".prx-review-page-heading")?.textContent).toBe(
		locale === "fr" ? "Page one · Page actuelle" : "Page one · Current page",
	);
	expect(doc.querySelector(".prx-review-list")?.textContent).not.toContain("Hidden by policy");
	expect(server.fetch.mock.calls[0][0]).toBe(`/api/reviews/${reviewId}/comments`);
	click(doc, '[data-review-filter="resolved"]');
	await settle();
	expect(doc.querySelectorAll(".prx-review-comment:not([hidden])")).toHaveLength(1);
	expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
		locale === "fr" ? "1 commentaire, filtre : Résolu." : "1 comment, filter: Resolved.",
	);
	click(doc, '[data-review-filter="open"]');
	expect(doc.querySelectorAll(".prx-review-comment:not([hidden])")).toHaveLength(2);
	click(doc, '[data-review-filter="all"]');
	expect(doc.querySelectorAll(".prx-review-comment:not([hidden])")).toHaveLength(3);
	const radio = doc.querySelector('[data-review-filter="all"]') as HTMLInputElement;
	radio.focus();
	await server.seed("New from CLI");
	await refresh();
	expect(labels()).toEqual(
		locale === "fr"
			? ["Ouvert (3)", "Résolu (1)", "Tous (4)"]
			: ["Open (3)", "Resolved (1)", "All (4)"],
	);
	expect(doc.activeElement).toBe(radio);
	for (const node of doc.querySelectorAll(
		".prx-review-show,.prx-review-reply-toggle,.prx-review-reopen,.prx-review-choose,.prx-review-pin",
	))
		expect(node.classList.contains("prx-review-action")).toBe(true);
});

it.each(["en", "fr"].flatMap((locale) => [false, true].map((deck) => ({ locale, deck }))))(
	"keeps the editor link name and URL in the review header ($locale, deck=$deck)",
	async ({ locale, deck }) => {
		const server = fakeServer();
		const label = locale === "fr" ? "Modifier le texte" : "Edit text";
		const { doc } = await open(server, locale, deck ? jumpDeckMarkup : undefined, (dom) => {
			const tools = dom.window.document.createElement("div");
			tools.className = "praxity-studio-read-tools";
			const link = dom.window.document.createElement("a");
			link.className = "praxity-studio-edit-link";
			link.href = "http://127.0.0.1:9000/launch?canvas=lesson%2Fone";
			link.textContent = label;
			tools.append(link);
			dom.window.document.body.prepend(tools);
		});
		const link = doc.querySelector(".prx-review-header a");
		expect(link?.textContent).toBe(label);
		expect(link?.getAttribute("href")).toBe("http://127.0.0.1:9000/launch?canvas=lesson%2Fone");
		expect(doc.querySelectorAll(".praxity-studio-edit-link")).toHaveLength(1);
		expect(doc.querySelector(".praxity-studio-read-tools")).toBeNull();
	},
);

it.each(["en", "fr"])(
	"renders generic %s actor labels, every message and the resolver",
	async (locale) => {
		const server = fakeServer();
		const thread = await server.seed("Reviewer message");
		await server.mutate("reply", thread.id, "CLI reply");
		await server.mutate("reply", thread.id, "Distinct agent", { ...author, id: "agent" });
		await server.mutate("reply", thread.id, "Another reviewer", { ...reviewer, id: "other" });
		await server.mutate("resolve", thread.id, "Done");
		const { doc } = await open(server, locale);
		expect(
			[...doc.querySelectorAll(".prx-review-message-author")].map((node) => node.textContent),
		).toEqual(
			locale === "fr"
				? ["Vous", "Agent", "Agent", "Utilisateur local", "Agent"]
				: ["You", "Agent", "Agent", "Local user", "Agent"],
		);
		expect(doc.querySelector(".prx-review-thread-status")?.textContent).toBe(
			locale === "fr" ? "Résolu par Agent" : "Resolved by Agent",
		);
		expect(doc.querySelector(".prx-review-list")?.textContent).not.toContain("PERSONAL NAME");
		expect(doc.querySelector(".prx-review-resolve")).toBeNull();
		expect(doc.querySelector("time")?.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
	},
);

it("polls visible pages and keeps an open new-comment composer and its exact text", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	let clock!: ReturnType<typeof pollClock>;
	const { dom, doc } = await open(server, "en", undefined, (dom) => {
		clock = pollClock(dom);
	});
	click(doc, ".prx-review-choose");
	click(doc, ".prx-review-next");
	const field = doc.querySelector(".prx-review-composer textarea") as HTMLTextAreaElement;
	field.value = "  Unsent new comment  ";
	field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	field.focus();
	await server.mutate("reply", thread.id, "CLI update while composing");
	await clock.tick();
	await vi.waitFor(() =>
		expect(doc.querySelector(".prx-review-list")?.textContent).toContain(
			"CLI update while composing",
		),
	);
	expect((doc.querySelector(".prx-review-composer") as HTMLDialogElement).open).toBe(true);
	expect(field.value).toBe("  Unsent new comment  ");
	expect(doc.activeElement).toBe(field);
});

it("a lower thread version in a later list cannot replace messages or the mutation's expected version", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	const { doc, refresh } = await open(server);
	await server.mutate("reply", thread.id, "Newer CLI reply");
	await refresh();
	const real = server.fetch.getMockImplementation()!;
	server.fetch.mockImplementationOnce(
		async () => new Response(JSON.stringify({ ok: true, threads: [thread], nextCursor: null })),
	);
	await refresh();
	expect(doc.querySelector(".prx-review-list")?.textContent).toContain("Newer CLI reply");
	server.fetch.mockImplementation(real);
	click(doc, ".prx-review-reply-toggle");
	(doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement).value = "Reviewer reply";
	click(doc, ".prx-review-reply-send");
	await vi.waitFor(() => expect(server.state().threads[0].version).toBe(3));
	expect(
		JSON.parse(
			String(
				[...server.fetch.mock.calls]
					.reverse()
					.find(([, options]) => options?.method === "POST")?.[1]?.body,
			),
		).expectVersion,
	).toBe(2);
});

it("external resolution keeps a focused reply visible by selecting All; an explicit filter still works", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	const { doc, refresh } = await open(server);
	click(doc, '[data-review-filter="open"]');
	click(doc, ".prx-review-reply-toggle");
	const field = doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement;
	field.value = "Still editing";
	field.focus();
	await server.mutate("resolve", thread.id, "Fixed externally");
	await refresh();
	expect(doc.activeElement).toBe(field);
	expect(field.value).toBe("Still editing");
	expect((doc.querySelector('[data-review-filter="all"]') as HTMLInputElement).checked).toBe(true);
	expect((doc.querySelector(".prx-review-comment") as HTMLElement).hidden).toBe(false);
	click(doc, '[data-review-filter="open"]');
	expect((doc.querySelector(".prx-review-comment") as HTMLElement).hidden).toBe(true);
});

it("a reopen failure remains visible outside the closed reply form", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	await server.mutate("resolve", thread.id, "Fixed");
	const { doc } = await open(server);
	server.fetch.mockRejectedValue(new Error("offline"));
	click(doc, ".prx-review-reopen");
	await settle();
	const error = doc.querySelector(".prx-review-comment .prx-review-error") as HTMLElement;
	expect(error.textContent).toBe("Comment could not be posted.");
	expect(error.closest("[hidden]")).toBeNull();
});

it("reply and reopen round-trip and retain exact text on a lost acknowledgement", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	await server.mutate("resolve", thread.id, "Done");
	const { doc, refresh } = await open(server);
	click(doc, ".prx-review-reopen");
	await vi.waitFor(() => expect(server.state().threads[0].status).toBe("open"));
	await settle();
	expect(server.state().threads[0]).toMatchObject({ status: "open", version: 3 });
	await server.mutate("resolve", thread.id, "Done again");
	await refresh();
	click(doc, ".prx-review-reply-toggle");
	const field = doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement;
	field.value = "  Exact reply\nwith whitespace  ";
	const real = server.fetch.getMockImplementation()!;
	let lost = true;
	server.fetch.mockImplementation(async (url, options) => {
		const response = await real(url, options);
		if (options?.method === "POST" && lost) {
			lost = false;
			throw new Error("lost response");
		}
		return response;
	});
	click(doc, ".prx-review-reply-send");
	await vi.waitFor(() =>
		expect(doc.querySelector(".prx-review-reply-send")?.textContent).toBe("Retry"),
	);
	expect(field.value).toBe("  Exact reply\nwith whitespace  ");
	click(doc, ".prx-review-reply-send");
	await vi.waitFor(() =>
		expect(doc.activeElement).toBe(doc.querySelector(".prx-review-reply-toggle")),
	);
	expect(server.state().threads[0].messages.map((message) => message.body)).toEqual([
		"Initial",
		"Done",
		"Done again",
		"  Exact reply\nwith whitespace  ",
	]);
	expect(server.state().threads[0]).toMatchObject({ status: "open", version: 5 });
	expect(doc.activeElement).toBe(doc.querySelector(".prx-review-reply-toggle"));
	const posts = server.fetch.mock.calls.filter(([, options]) => options?.method === "POST");
	expect(posts.at(-1)?.[1]?.body).toBe(posts.at(-2)?.[1]?.body);
});

it("keyed refresh retains focus, reply text, selection and scroll; an older response cannot replace a newer thread", async () => {
	const server = fakeServer();
	const thread = await server.seed("Initial");
	const { doc, dom, refresh } = await open(server);
	click(doc, ".prx-review-reply-toggle");
	const field = doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement;
	field.value = "Unsent reply";
	field.focus();
	field.setSelectionRange(3, 6);
	const content = doc.querySelector(".prx-review-content")!;
	content.scrollTop = 135;
	const real = server.fetch.getMockImplementation()!;
	let release!: (response: Response) => void;
	server.fetch.mockImplementationOnce(async (url, options) => {
		const response = await real(url, options);
		return new Promise<Response>((resolve) => {
			release = resolve;
		}).then(() => response);
	});
	dom.window.dispatchEvent(new dom.window.Event("focus"));
	await settle();
	await server.mutate("reply", thread.id, "Agent update");
	await refresh();
	release(new Response());
	await settle();
	expect(doc.querySelector(".prx-review-reply textarea")).toBe(field);
	expect(doc.activeElement).toBe(field);
	expect([field.value, field.selectionStart, field.selectionEnd, content.scrollTop]).toEqual([
		"Unsent reply",
		3,
		6,
		135,
	]);
	expect(doc.querySelector(".prx-review-list")?.textContent).toContain("Agent update");
});

it.each(["en", "fr"])(
	"keeps missing targets readable and focuses the owning deck slide (%s)",
	async (locale) => {
		const server = fakeServer();
		await server.seed("Deleted target", { ...anchor, nodeId: "deleted" });
		await server.seed("Other slide", { ...anchor, pageId: "other" });
		const { doc, dom } = await open(
			server,
			locale,
			'<section data-deck-slide="page"><p data-node-id="node">One</p></section><section data-deck-slide="other" hidden><p data-node-id="node">Two</p></section>',
		);
		const items = doc.querySelectorAll(".prx-review-comment");
		click(items[0].ownerDocument, ".prx-review-show");
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
			locale === "fr" ? "Cible supprimée" : "Target deleted",
		);
		(items[1].querySelector(".prx-review-show") as HTMLButtonElement).click();
		expect(dom.window.location.hash).toBe("#other");
		expect(doc.activeElement).not.toBe(
			doc.querySelector('[data-deck-slide="page"] [data-node-id]'),
		);
		(doc.querySelector('[data-deck-slide="page"]') as HTMLElement).hidden = true;
		(doc.querySelector('[data-deck-slide="other"]') as HTMLElement).hidden = false;
		dom.window.dispatchEvent(
			new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: "other" } }),
		);
		await settle();
		expect(doc.activeElement).toBe(doc.querySelector('[data-deck-slide="other"] [data-node-id]'));
		expect(doc.querySelector(".prx-review-list")?.textContent).toContain("Deleted target");
	},
);

it.each(["en", "fr"])(
	"repeated reply errors announce again in %s without discarding text",
	async (locale) => {
		const server = fakeServer();
		await server.seed("Initial");
		const { doc } = await open(server, locale);
		click(doc, ".prx-review-reply-toggle");
		const field = doc.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement;
		field.value = "Kept";
		server.fetch.mockRejectedValue(new Error("offline"));
		const seen: string[] = [];
		const observer = new doc.defaultView!.MutationObserver(() => {
			seen.push(doc.querySelector(".prx-review-status")!.textContent!);
		});
		observer.observe(doc.querySelector(".prx-review-status")!, { childList: true });
		for (let i = 0; i < 2; i++) {
			click(doc, ".prx-review-reply-send");
			await settle();
		}
		observer.disconnect();
		expect(
			seen.filter(
				(text) =>
					text ===
					(locale === "fr"
						? "Impossible de publier le commentaire."
						: "Comment could not be posted."),
			),
		).toHaveLength(2);
		expect(field.value).toBe("Kept");
	},
);
