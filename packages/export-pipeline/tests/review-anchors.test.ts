import { readFile } from "node:fs/promises";
import type { DesignVariants } from "@praxity/grammar";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import reviewEn from "../../editor-core/src/messages/en.json" with { type: "json" };
import {
	create as createThread,
	parseCommandPayload,
	REVIEW_LIMITS,
	REVIEW_TEXT_RULES,
	type ReviewAnchor,
	type ReviewState,
} from "../../review-share/src/review";
import { contrastRatio } from "../../shared-blocks/src/color-math";
import { resolveDesignTokens } from "../../shared-blocks/src/themes/resolve-design-tokens";
import { reviewPageLayout } from "./fixtures/review-page-layout";

const script = await readFile(new URL("../template/review-comments.js", import.meta.url), "utf8");
const stylesheet = await readFile(
	new URL("../template/review-comments.css", import.meta.url),
	"utf8",
);
const reviewId = "11111111-1111-4111-8111-111111111111";
const capability = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
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
type Spot = { state: string; target?: Element; range?: Range; pin?: { x: number; y: number } };
interface ReviewClient {
	fromSelection(range: Range): ReviewAnchor | null;
	fromBlock(target: Element): ReviewAnchor | null;
	fromPin(target: Element, x: number, y: number): ReviewAnchor | null;
	resolve(anchor: ReviewAnchor): Spot;
	page(): ReviewAnchor;
}
const doms: JSDOM[] = [];
afterEach(async () => {
	for (const dom of doms.splice(0)) {
		dom.window.dispatchEvent(new dom.window.Event("pagehide"));
		for (let i = 0; i < 80; i++) await Promise.resolve();
		dom.window.close();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function response(body: unknown, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers });
}
async function open(
	markup: string,
	fetchMock = vi.fn().mockResolvedValue(response({ ok: true, threads: [], nextCursor: null })),
	config: unknown = settings,
	prepare?: (dom: JSDOM) => void,
) {
	const dom = new JSDOM(
		`<!doctype html><html><head><script type="application/json" id="praxity-review-config">${JSON.stringify(config)}</script><script data-praxity-review-comments="true"></script></head><body><main><h1>Page title</h1>${markup}</main></body></html>`,
		{
			url: "http://127.0.0.1:3456/lesson.html",
			runScripts: "outside-only",
			pretendToBeVisual: true,
		},
	);
	doms.push(dom);
	reviewPageLayout(dom);
	dom.window.fetch = fetchMock;
	dom.window.HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	dom.window.HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	Object.defineProperties(dom.window.document.documentElement, {
		clientWidth: { get: () => dom.window.innerWidth, configurable: true },
		clientHeight: { get: () => dom.window.innerHeight, configurable: true },
	});
	// JSDOM has no layout hit testing; individual occlusion cases supply their own hit.
	dom.window.document.elementFromPoint = () => dom.window.document.querySelector("main");
	prepare?.(dom);
	dom.window.eval(script);
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
	await Promise.resolve();
	await Promise.resolve();
	return {
		dom,
		doc: dom.window.document,
		api: (dom.window as unknown as { PraxityReview: ReviewClient }).PraxityReview,
		fetchMock,
	};
}
function range(
	doc: Document,
	start: Node,
	startOffset: number,
	end = start,
	endOffset = start.textContent?.length || 0,
) {
	const selected = doc.createRange();
	selected.setStart(start, startOffset);
	selected.setEnd(end, endOffset);
	return selected;
}
const pageAnchor: ReviewAnchor = {
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
function resolveStored(api: ReviewClient, anchor: ReviewAnchor) {
	return api.resolve(JSON.parse(JSON.stringify(anchor)));
}
function manualFrames(dom: JSDOM) {
	const pending = new Map<number, FrameRequestCallback>();
	let next = 0;
	dom.window.requestAnimationFrame = (callback) => {
		pending.set(++next, callback);
		return next;
	};
	dom.window.cancelAnimationFrame = (id) => {
		pending.delete(id);
	};
	return {
		pending,
		flush: () => {
			const current = [...pending.values()];
			pending.clear();
			current.forEach((callback) => callback(0));
		},
	};
}
function box(left = 80, top = 100, width = 100, height = 30): DOMRect {
	return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}
function thread(anchor: ReviewAnchor, id = "thread") {
	return {
		id,
		anchor,
		status: "open",
		messages: [
			{
				body: "<b>Message</b>",
				actor: { displayName: "Reviewer" },
				at: "2026-10-19T00:00:00.000Z",
			},
		],
	};
}

function openPageComposer(doc: Document) {
	(doc.querySelector(".prx-review-choose") as HTMLButtonElement).click();
	const page = doc.querySelector('.prx-review-picker input[type="radio"]') as HTMLInputElement;
	page.checked = true;
	(doc.querySelector(".prx-review-next") as HTMLButtonElement).click();
}

it.each(
	["en", "fr"].flatMap((locale) =>
		["quote", "pin", "block", "quote-range", "pin-child"].map((kind) => ({ locale, kind })),
	),
)(
	"omits boxes, highlights and hit tests for an unrendered $kind ($locale)",
	async ({ locale, kind }) => {
		const anchor = {
			...pageAnchor,
			nodeId: "node",
			quote: kind.startsWith("quote")
				? { type: "TextQuoteSelector" as const, exact: "Target", prefix: "", suffix: "" }
				: null,
			pin: kind.startsWith("pin")
				? { path: kind === "pin-child" ? "span:nth-of-type(1)" : "", x: 0.5, y: 0.5 }
				: null,
			context: { pageTitle: "Page title", targetLabel: "Target" },
		};
		let clock!: ReturnType<typeof manualFrames>;
		const highlights = new Map();
		const hit = vi.fn();
		const { doc, dom } = await open(
			'<div data-node-id="node"><span>Target</span></div>',
			vi
				.fn()
				.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null })),
			{ ...settings, locale },
			(dom) => {
				clock = manualFrames(dom);
				dom.window.document.elementFromPoint = hit;
				Object.assign(dom.window, {
					Highlight: class {
						constructor(...ranges: unknown[]) {
							Object.assign(this, { ranges });
						}
					},
					CSS: { highlights },
				});
				const target = dom.window.document.querySelector(
					kind === "pin-child" ? "span" : "[data-node-id]",
				)!;
				target.getBoundingClientRect = () => box(0, 0, 0, 0);
				if (kind !== "quote-range") target.getClientRects = () => [] as unknown as DOMRectList;
				dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		clock.flush();
		const marker = doc.querySelector<HTMLElement>(".prx-review-marker")!;
		expect(marker.hidden).toBe(true);
		expect([marker.style.left, marker.style.top]).toEqual(["", ""]);
		expect(highlights.has("prx-review-quote")).toBe(false);
		expect(hit).not.toHaveBeenCalled();
		expect(doc.querySelector(".prx-review-anchor-status")?.textContent).toBe(
			locale === "fr" ? "⚠ Pas sur cette page" : "⚠ Not on this page",
		);
		// A layout-only reveal must recover even while identity resolution stays cached.
		const target = doc.querySelector(kind === "pin-child" ? "span" : "[data-node-id]")!;
		target.getClientRects = () => [box()] as unknown as DOMRectList;
		target.getBoundingClientRect = () => box();
		dom.window.Range.prototype.getClientRects = () => [box()] as unknown as DOMRectList;
		doc.elementFromPoint = () => doc.querySelector("main");
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		clock.flush();
		expect(marker.hidden).toBe(false);
		expect(doc.querySelector<HTMLElement>(".prx-review-anchor-status")!.hidden).toBe(true);
	},
);

it.each([true, false])(
	"places a text pin tip at cap height and keeps a graphic's stored point (text=%s)",
	async (text) => {
		const anchor = {
			...pageAnchor,
			nodeId: "node",
			blockId: "block",
			pin: { path: "", x: 0.5, y: 0.5 },
			context: { pageTitle: "Page title", targetLabel: text ? "Text line" : null },
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open(
			text
				? '<p data-node-id="node" data-block-id="block">Text line</p>'
				: '<canvas data-node-id="node" data-block-id="block"></canvas>',
			fetchMock,
			settings,
			(dom) => {
				const target = dom.window.document.querySelector('[data-node-id="node"]') as Element;
				target.getBoundingClientRect = () => box(80, 100, 100, 40);
				dom.window.Range.prototype.getClientRects = () =>
					[box(80, 100, 100, 30)] as unknown as DOMRectList;
				vi.spyOn(dom.window.HTMLCanvasElement.prototype, "getContext").mockReturnValue({
					font: "",
					measureText: () => ({ fontBoundingBoxAscent: 16, actualBoundingBoxAscent: 12 }),
				} as never);
			},
		);
		await vi.waitFor(() =>
			expect((doc.querySelector(".prx-review-marker") as HTMLElement)?.style.top).toBe(
				text ? "92px" : "108px",
			),
		);
	},
);

it.each(
	["en", "fr"].flatMap((locale) =>
		["quote", "pin"].flatMap((kind) =>
			["player", "tab", "details", "accordion"].map((reveal) => ({ locale, kind, reveal })),
		),
	),
)(
	"keeps a concealed $kind child inside its rendered owner ($locale, $reveal)",
	async ({ locale, kind, reveal }) => {
		let clock!: ReturnType<typeof manualFrames>;
		const highlights = new Map();
		const fetch = vi.fn().mockResolvedValue(response({ ok: true, threads: [], nextCursor: null }));
		const child = '<span class="target">Target</span>';
		const wrapped =
			reveal === "details"
				? `<details id="reveal" open><summary>Open</summary>${child}</details>`
				: reveal === "tab"
					? `<button role="tab" aria-controls="reveal">Tab</button><div id="reveal" role="tabpanel">${child}</div>`
					: reveal === "accordion"
						? `<button aria-expanded="true" aria-controls="reveal">Open</button><div id="reveal">${child}</div>`
						: child;
		const { doc, dom, api } = await open(
			`<div data-node-id="node">${wrapped}<p>Other visible content</p></div>`,
			fetch,
			{ ...settings, locale },
			(dom) => {
				clock = manualFrames(dom);
				dom.window.Element.prototype.getBoundingClientRect = () => box(80, 100, 100, 40);
				Object.assign(dom.window, { CSS: { highlights }, Highlight: class {} });
			},
		);
		const target = doc.querySelector<HTMLElement>(".target")!;
		const captured =
			kind === "quote"
				? api.fromSelection(range(doc, target.firstChild!, 0))
				: api.fromPin(target, 130, 120);
		expect(captured).not.toBeNull();
		fetch.mockResolvedValue(response({ ok: true, threads: [thread(captured!)], nextCursor: null }));
		dom.window.dispatchEvent(new dom.window.Event("focus"));
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		clock.flush();
		const marker = doc.querySelector<HTMLElement>(".prx-review-marker")!;
		expect(marker.hidden).toBe(false);
		const panel = doc.querySelector<HTMLElement>("#reveal") ?? target;
		// Each container closes the way its learner control would, so Show on page can reopen it.
		const accordion = doc.querySelector("[aria-expanded]");
		if (reveal === "details") (panel as HTMLDetailsElement).open = false;
		else panel.hidden = true;
		accordion?.setAttribute("aria-expanded", "false");
		await Promise.resolve();
		clock.flush();
		expect(marker.hidden).toBe(true);
		expect(highlights.has("prx-review-quote")).toBe(false);
		expect(doc.querySelector(".prx-review-anchor-status")?.textContent).toBe(
			reveal === "player"
				? locale === "fr"
					? "⚠ Pas sur cette page"
					: "⚠ Not on this page"
				: locale === "fr"
					? "⚠ Non visible ici"
					: "⚠ Not visible here",
		);
		if (reveal === "player") expect(api.resolve(captured!).target).toBe(target);
		if (reveal === "details") (panel as HTMLDetailsElement).open = true;
		else panel.hidden = false;
		accordion?.setAttribute("aria-expanded", "true");
		await Promise.resolve();
		clock.flush();
		expect(marker.hidden).toBe(false);
		expect(doc.querySelector<HTMLElement>(".prx-review-anchor-status")!.hidden).toBe(true);
		// Actual edits retain their own warning instead of being treated as concealment.
		target.textContent = "Edited";
		await Promise.resolve();
		clock.flush();
		expect(api.resolve(captured!).state).toBe(kind === "quote" ? "textChanged" : "pinMoved");
	},
);

it.each(["en", "fr"].flatMap((locale) => ["quote", "block"].map((kind) => ({ locale, kind }))))(
	"measures a display:contents owner through its $kind boxes ($locale)",
	async ({ locale, kind }) => {
		let clock!: ReturnType<typeof manualFrames>;
		const targetAnchor = {
			...pageAnchor,
			nodeId: "node",
			quote:
				kind === "quote"
					? { type: "TextQuoteSelector" as const, exact: "Target", prefix: "", suffix: "" }
					: null,
		};
		const { doc, dom } = await open(
			'<div class="praxity-matching-row" data-node-id="node" style="display:contents"><span class="praxity-matching-prompt">Target</span></div>',
			vi
				.fn()
				.mockResolvedValue(
					response({ ok: true, threads: [thread(targetAnchor)], nextCursor: null }),
				),
			{ ...settings, locale },
			(dom) => {
				clock = manualFrames(dom);
				dom.window.Range.prototype.getClientRects = () => [box()] as unknown as DOMRectList;
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		const rects = vi.spyOn(dom.window.Range.prototype, "getClientRects");
		clock.flush();
		expect(doc.querySelector<HTMLElement>(".prx-review-marker")!.hidden).toBe(false);
		expect(doc.querySelector<HTMLElement>(".prx-review-anchor-status")!.hidden).toBe(true);
		if (kind === "quote") expect(rects).toHaveBeenCalledTimes(1);
		const target = doc.querySelector<HTMLElement>("[data-node-id]")!;
		expect(target.getClientRects()).toHaveLength(0);
		const scroll = vi.fn();
		target.scrollIntoView = scroll;
		doc.querySelector<HTMLButtonElement>(".prx-review-show")!.click();
		expect(scroll).toHaveBeenCalledTimes(1);
		expect(doc.activeElement).toBe(target);
	},
);

it.each(
	["en", "fr"].flatMap((locale) =>
		["textChanged", "ambiguous"].map((state) => ({ locale, state })),
	),
)("keeps the $state warning when its owner has no boxes ($locale)", async ({ locale, state }) => {
	let clock!: ReturnType<typeof manualFrames>;
	const targetAnchor = {
		...pageAnchor,
		nodeId: "node",
		quote: { type: "TextQuoteSelector" as const, exact: "Target", prefix: "", suffix: "" },
	};
	const { doc } = await open(
		`<div data-node-id="node">${state === "textChanged" ? "Edited" : "Target Target"}</div>`,
		vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(targetAnchor)], nextCursor: null })),
		{ ...settings, locale },
		(dom) => {
			clock = manualFrames(dom);
			dom.window.document.querySelector("[data-node-id]")!.getClientRects = () =>
				[] as unknown as DOMRectList;
		},
	);
	await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
	clock.flush();
	expect(doc.querySelector<HTMLElement>(".prx-review-marker")!.hidden).toBe(true);
	expect(doc.querySelector(".prx-review-anchor-status")?.textContent).toBe(
		state === "textChanged"
			? locale === "fr"
				? "⚠ Texte modifié"
				: "⚠ Text changed"
			: locale === "fr"
				? "⚠ Ambigu"
				: "⚠ Ambiguous",
	);
});

describe("visible-first matching and the concealed label", () => {
	const chips = {
		notOnPage: { en: "⚠ Not on this page", fr: "⚠ Pas sur cette page" },
		notVisible: { en: "⚠ Not visible here", fr: "⚠ Non visible ici" },
		textChanged: { en: "⚠ Text changed", fr: "⚠ Texte modifié" },
		pinMoved: { en: "⚠ Pin moved to block", fr: "⚠ Repère déplacé vers le bloc" },
	};
	type Locale = "en" | "fr";
	/** Captures on the real DOM, then renders the stored thread with frames firing. */
	async function captured(
		markup: string,
		locale: Locale,
		capture: (doc: Document, api: ReviewClient) => ReviewAnchor | null,
	) {
		let clock!: ReturnType<typeof manualFrames>;
		const highlights = new Map<string, { ranges: unknown[] }>();
		const fetch = vi.fn().mockResolvedValue(response({ ok: true, threads: [], nextCursor: null }));
		const page = await open(markup, fetch, { ...settings, locale }, (dom) => {
			clock = manualFrames(dom);
			dom.window.Element.prototype.getBoundingClientRect = () => box(80, 100, 100, 40);
			Object.assign(dom.window, {
				CSS: { highlights },
				Highlight: class {
					ranges: unknown[];
					constructor(...ranges: unknown[]) {
						this.ranges = ranges;
					}
				},
			});
		});
		const anchor = capture(page.doc, page.api);
		expect(anchor).not.toBeNull();
		fetch.mockResolvedValue(response({ ok: true, threads: [thread(anchor!)], nextCursor: null }));
		page.dom.window.dispatchEvent(new page.dom.window.Event("focus"));
		await vi.waitFor(() =>
			expect(page.doc.querySelectorAll(".prx-review-comment")).toHaveLength(1),
		);
		clock.flush();
		const chip = page.doc.querySelector<HTMLElement>(".prx-review-anchor-status")!;
		return {
			...page,
			anchor: anchor!,
			markerShown: () => !page.doc.querySelector<HTMLElement>(".prx-review-marker")!.hidden,
			highlighted: () => highlights.get("prx-review-quote")?.ranges.length ?? 0,
			chip: () => (chip.hidden ? "" : chip.textContent),
			async render() {
				await Promise.resolve();
				clock.flush();
			},
			/** Activates Show on page and returns what it announced, or "" for no announcement. */
			show() {
				const status = page.doc.querySelector(".prx-review-status")!;
				const before = status.textContent;
				page.doc.querySelector<HTMLButtonElement>(".prx-review-show")!.click();
				return status.textContent === before ? "" : status.textContent;
			},
		};
	}
	function selectContents(doc: Document, start: Element, end = start) {
		const selected = doc.createRange();
		selected.setStartBefore(start.firstChild!);
		selected.setEndAfter(end.lastChild!);
		return selected;
	}
	const byId = (doc: Document, id: string) => doc.getElementById(id)!;
	const locales: Locale[] = ["en", "fr"];

	it.each(locales)("places a visible quote that spans hidden text (%s)", async (locale) => {
		const page = await captured(
			'<div data-node-id="node"><p><span id="a">Alpha </span><span hidden>secret </span><span id="b">Beta</span></p></div>',
			locale,
			(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "a"), byId(doc, "b"))),
		);
		expect(page.anchor.quote?.exact).toBe("Alpha Beta");
		expect(page.markerShown()).toBe(true);
		expect(page.highlighted()).toBe(1);
		expect(page.chip()).toBe("");
	});

	it.each(locales)(
		"keeps a visible quote on its copy beside a hidden duplicate (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><p><span id="a">Alpha </span><span hidden>secret </span><span id="b">Beta</span><span hidden>Alpha Beta</span></p></div>',
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "a"), byId(doc, "b"))),
			);
			expect(page.markerShown()).toBe(true);
			expect(page.highlighted()).toBe(1);
			expect(page.chip()).toBe("");
			expect(page.show()).toBe("");
			expect(page.api.resolve(page.anchor).range?.startContainer).toBe(
				byId(page.doc, "a").firstChild,
			);
			expect(page.doc.activeElement).toBe(page.doc.querySelector("[data-node-id]"));
		},
	);

	it.each(locales)(
		"keeps a visible quote when hidden context scores higher (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><p>Intro</p><section hidden><p>Choose one</p><p>Alpha</p></section><section><p id="choice">Choose one</p><p>Beta</p></section></div>',
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "choice"))),
			);
			expect(page.anchor.quote?.prefix).toBe("Intro ");
			expect(page.markerShown()).toBe(true);
			expect(page.highlighted()).toBe(1);
			expect(page.chip()).toBe("");
			expect(page.show()).toBe("");
			expect(page.api.resolve(page.anchor).range?.startContainer).toBe(
				byId(page.doc, "choice").firstChild,
			);
			expect(page.doc.activeElement).toBe(page.doc.querySelector("[data-node-id]"));
		},
	);

	it.each(locales)("follows a numbered code quote through its player step (%s)", async (locale) => {
		const line = (n: number, code: string) =>
			`<span class="praxity-code-line" style="display:flex"><span class="praxity-code-line-number" aria-hidden="true">${n}</span><span data-code-line>${code}</span></span>`;
		const page = await captured(
			// The step sits inside the node, so the quote passes decide, not the hidden-node check.
			`<div data-node-id="node"><section class="praxity-player-step" id="step"><pre><code id="code">${line(1, "const a = 1;")}\n${line(2, "const b = 2;")}</code></pre></section><p>Other visible content</p></div>`,
			locale,
			(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "code"))),
		);
		expect(page.anchor.quote?.exact).toBe("const a = 1; const b = 2;");
		expect(page.markerShown()).toBe(true);
		expect(page.highlighted()).toBe(1);
		expect(page.chip()).toBe("");
		byId(page.doc, "step").hidden = true;
		await page.render();
		expect(page.markerShown()).toBe(false);
		expect(page.highlighted()).toBe(0);
		expect(page.chip()).toBe(chips.notOnPage[locale]);
		byId(page.doc, "step").hidden = false;
		await page.render();
		expect(page.markerShown()).toBe(true);
		expect(page.highlighted()).toBe(1);
		expect(page.chip()).toBe("");
	});

	it.each(
		locales.flatMap((locale) =>
			["visibility", "aria-hidden"].map((conceal) => ({ locale, conceal })),
		),
	)(
		"labels a quote whose every segment is concealed by $conceal ($locale)",
		async ({ locale, conceal }) => {
			const page = await captured(
				'<div data-node-id="node"><span id="a">Alpha </span><span id="b">Beta</span><p>Other visible content</p></div>',
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "a"), byId(doc, "b"))),
			);
			expect(page.markerShown()).toBe(true);
			const spans = [byId(page.doc, "a"), byId(page.doc, "b")];
			for (const span of spans)
				if (conceal === "visibility") span.style.visibility = "hidden";
				else span.setAttribute("aria-hidden", "true");
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.highlighted()).toBe(0);
			// Still rendered, but no learner control opens it.
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			for (const span of spans) span.removeAttribute(conceal === "visibility" ? "style" : conceal);
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.highlighted()).toBe(1);
			expect(page.chip()).toBe("");
		},
	);

	it.each(
		locales.flatMap((locale) =>
			[
				["aria-hidden number", '<span aria-hidden="true">1</span> Wash hands'],
				["hidden paragraph", "Wash hands<p hidden>Extra</p>"],
			].map(([variant, item]) => ({ locale, variant, item })),
		),
	)(
		"labels a pin with hidden text inside its hidden step ($variant, $locale)",
		async ({ locale, item }) => {
			const page = await captured(
				`<div data-node-id="node"><section class="praxity-player-step" id="step"><ol><li id="pinned">${item}</li></ol></section><p>Other visible content</p></div>`,
				locale,
				(doc, api) => api.fromPin(byId(doc, "pinned"), 130, 120),
			);
			expect(page.anchor.context.targetLabel).toBe("Wash hands");
			expect(page.markerShown()).toBe(true);
			byId(page.doc, "step").hidden = true;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			expect(page.api.resolve(page.anchor)).toMatchObject({
				state: "notOnPage",
				target: byId(page.doc, "pinned"),
			});
			byId(page.doc, "step").hidden = false;
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.chip()).toBe("");
		},
	);

	it.each(locales.flatMap((locale) => ["quote", "pin"].map((kind) => ({ locale, kind }))))(
		"still warns about a real $kind edit with no hidden copy ($locale)",
		async ({ locale, kind }) => {
			const page = await captured(
				'<div data-node-id="node"><p id="t">Alpha Beta</p><p>Other visible content</p></div>',
				locale,
				(doc, api) =>
					kind === "quote"
						? api.fromSelection(selectContents(doc, byId(doc, "t")))
						: api.fromPin(byId(doc, "t"), 130, 120),
			);
			byId(page.doc, "t").textContent = "Gamma Delta";
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.highlighted()).toBe(0);
			expect(page.chip()).toBe(chips[kind === "quote" ? "textChanged" : "pinMoved"][locale]);
			expect(page.api.resolve(page.anchor).target).toBe(page.doc.querySelector("[data-node-id]"));
		},
	);

	it.each(
		locales.flatMap((locale) =>
			["tab", "details", "accordion"].map((reveal) => ({ locale, reveal })),
		),
	)(
		"reveals and focuses a quote in a closed $reveal from Show on page ($locale)",
		async ({ locale, reveal }) => {
			const target = '<p id="target">Target text</p>';
			const page = await captured(
				`<div data-node-id="node"><p>Intro</p>${
					reveal === "tab"
						? `<button role="tab" id="tab" aria-controls="reveal" aria-selected="true">Tab</button><div id="reveal" role="tabpanel" aria-labelledby="tab">${target}</div>`
						: reveal === "details"
							? `<details id="reveal" open><summary>Open</summary>${target}</details>`
							: `<button id="tab" aria-expanded="true" aria-controls="reveal">Open</button><div id="reveal">${target}</div>`
				}</div>`,
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "target"))),
			);
			const panel = byId(page.doc, "reveal");
			const close = (closed: boolean) => {
				if (reveal === "details") (panel as HTMLDetailsElement).open = !closed;
				else panel.hidden = closed;
				if (reveal === "accordion")
					byId(page.doc, "tab").setAttribute("aria-expanded", String(!closed));
			};
			page.doc.getElementById("tab")?.addEventListener("click", () => close(false));
			close(true);
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.highlighted()).toBe(0);
			expect(page.chip()).toBe(chips.notVisible[locale]);
			expect(page.show()).toBe("");
			expect(page.doc.activeElement).toBe(page.doc.querySelector("[data-node-id]"));
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.chip()).toBe("");
		},
	);

	it.each(locales)(
		"labels a placed quote with a reveal path that loses its boxes (%s)",
		async (locale) => {
			const page = await captured(
				'<details id="reveal" open><summary>Open</summary><div data-node-id="node"><p id="t">Target text</p></div></details>',
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "t"))),
			);
			expect(page.anchor.revealPath).toEqual(["reveal"]);
			expect(page.markerShown()).toBe(true);
			// Box loss the client cannot observe as a mutation.
			const none = () => [] as unknown as DOMRectList;
			page.dom.window.Range.prototype.getClientRects = none;
			page.dom.window.Element.prototype.getClientRects = none;
			page.dom.window.dispatchEvent(new page.dom.window.Event("scroll"));
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.highlighted()).toBe(0);
			// The open reveal path conceals nothing, so it can't make the label "Not visible here".
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			expect(page.show()).toBe(chips.notOnPage[locale].slice(2));
		},
	);

	it.each(locales)(
		"labels a partly concealed quote without a marker, its documented limit (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><p id="a">Alpha</p><section class="praxity-player-step" id="step"><p id="b">Beta</p></section></div>',
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "a"), byId(doc, "b"))),
			);
			expect(page.anchor.quote?.exact).toBe("Alpha Beta");
			byId(page.doc, "step").hidden = true;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.highlighted()).toBe(0);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
		},
	);

	it.each(locales.flatMap((locale) => ["quote", "block"].map((kind) => ({ locale, kind }))))(
		"keeps a captured $kind marker on a display:contents matching row ($locale)",
		async ({ locale, kind }) => {
			const page = await captured(
				'<div class="praxity-matching-row" data-node-id="node" style="display:contents"><span class="praxity-matching-prompt" id="prompt">Target</span></div>',
				locale,
				(doc, api) =>
					kind === "quote"
						? api.fromSelection(selectContents(doc, byId(doc, "prompt")))
						: api.fromBlock(doc.querySelector("[data-node-id]")!),
			);
			expect(page.markerShown()).toBe(true);
			expect(page.highlighted()).toBe(kind === "quote" ? 1 : 0);
			expect(page.chip()).toBe("");
		},
	);

	it.each(locales)("keeps a pin behind two concealing elements markerless (%s)", async (locale) => {
		const page = await captured(
			'<div data-node-id="node"><section id="step"><div id="inner"><span id="target">Target</span></div></section><p>Other visible content</p></div>',
			locale,
			(doc, api) => api.fromPin(byId(doc, "target"), 130, 120),
		);
		expect(page.anchor.context.targetLabel).toBe("Target");
		byId(page.doc, "step").hidden = true;
		await page.render();
		expect(page.markerShown()).toBe(false);
		byId(page.doc, "inner").hidden = true;
		await page.render();
		expect(page.markerShown()).toBe(false);
		expect(page.chip()).toBe(chips.notOnPage[locale]);
		expect(page.api.resolve(page.anchor)).toMatchObject({
			state: "notOnPage",
			target: byId(page.doc, "target"),
		});
		expect(page.show()).toBe(chips.notOnPage[locale].slice(2));
		byId(page.doc, "step").hidden = false;
		byId(page.doc, "inner").hidden = false;
		await page.render();
		expect(page.markerShown()).toBe(true);
		expect(page.chip()).toBe("");
		expect(page.api.resolve(page.anchor)).toMatchObject({
			state: "placed",
			target: byId(page.doc, "target"),
		});
	});

	it.each(locales)(
		"opens a pinned explanation in a details closed inside a hidden step (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><section id="step"><p>Main text</p><details open><summary>Details</summary><p id="explain">Explanation</p></details></section><p>Other visible content</p></div>',
				locale,
				(doc, api) => api.fromPin(byId(doc, "explain"), 130, 120),
			);
			const details = page.doc.querySelector("details")!;
			byId(page.doc, "step").hidden = true;
			details.open = false;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			expect(page.api.resolve(page.anchor).state).toBe("notOnPage");
			byId(page.doc, "step").hidden = false;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notVisible[locale]);
			expect(page.show()).toBe("");
			expect(details.open).toBe(true);
			expect(page.doc.activeElement).toBe(byId(page.doc, "explain"));
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.chip()).toBe("");
		},
	);

	it.each(locales)(
		"keeps a pinned hidden section with a newly closed details markerless (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><section id="step"><p>Main text</p><details open><summary>Details</summary><p>Explanation</p></details></section><p>Other visible content</p></div>',
				locale,
				(doc, api) => api.fromPin(byId(doc, "step"), 130, 120),
			);
			byId(page.doc, "step").hidden = true;
			page.doc.querySelector("details")!.open = false;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
		},
	);

	it.each(
		locales.flatMap((locale) =>
			["quote", "pin"].flatMap((kind) =>
				["width", "height"].map((axis) => ({ locale, kind, axis })),
			),
		),
	)("labels a $kind whose box has zero $axis ($locale)", async ({ locale, kind, axis }) => {
		const page = await captured(
			'<div data-node-id="node"><span id="target">Target</span><p>Other visible content</p></div>',
			locale,
			(doc, api) =>
				kind === "quote"
					? api.fromSelection(selectContents(doc, byId(doc, "target")))
					: api.fromPin(byId(doc, "target"), 130, 120),
		);
		expect(page.markerShown()).toBe(true);
		const zero = axis === "width" ? box(80, 100, 0, 40) : box(80, 100, 200, 0);
		const target = byId(page.doc, "target");
		target.getBoundingClientRect = () => zero;
		target.getClientRects = () => [zero] as unknown as DOMRectList;
		page.dom.window.Range.prototype.getClientRects = () => [zero] as unknown as DOMRectList;
		page.dom.window.dispatchEvent(new page.dom.window.Event("scroll"));
		await page.render();
		expect(page.markerShown()).toBe(false);
		expect(page.highlighted()).toBe(0);
		expect(page.chip()).toBe(chips.notOnPage[locale]);
		expect(page.show()).toBe(chips.notOnPage[locale].slice(2));
	});

	it("reads a no-box quote's geometry once per frame", async () => {
		const page = await captured(
			'<div data-node-id="node"><span id="target">Target</span></div>',
			"en",
			(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "target"))),
		);
		let reads = 0;
		page.dom.window.Range.prototype.getClientRects = () => {
			reads++;
			return [] as unknown as DOMRectList;
		};
		for (const frame of [1, 2]) {
			page.dom.window.dispatchEvent(new page.dom.window.Event("scroll"));
			await page.render();
			expect(reads).toBe(frame);
		}
		expect(page.chip()).toBe(chips.notOnPage.en);
	});

	it.each(
		locales.flatMap((locale) =>
			[
				[
					"selected tab panel",
					'<section id="step"><div data-node-id="node"><button role="tab" id="tab" aria-controls="panel" aria-selected="true">Tab</button><div id="panel" role="tabpanel" aria-labelledby="tab"><p id="t">Target text</p></div></div></section><p>Other visible content</p>',
				],
				[
					"open recorded details",
					'<div data-node-id="node"><section id="step"><details id="d" open><summary>Open</summary><p id="t">Target text</p></details></section><p>Other visible content</p></div>',
				],
			].map(([container, markup]) => ({ locale, container, markup })),
		),
	)(
		"labels a quote in a $container inside a hidden step ($locale)",
		async ({ locale, container, markup }) => {
			const page = await captured(markup, locale, (doc, api) =>
				api.fromSelection(selectContents(doc, byId(doc, "t"))),
			);
			expect(page.anchor.tab ?? page.anchor.revealPath[0]).toBe(
				container === "selected tab panel" ? "panel" : "d",
			);
			byId(page.doc, "step").hidden = true;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			expect(page.show()).toBe(chips.notOnPage[locale].slice(2));
		},
	);

	it.each(locales)("opens a details closed after capture that has no id (%s)", async (locale) => {
		const page = await captured(
			'<div data-node-id="node"><details open><summary>Open</summary><p id="t">Target text</p></details><p>Other visible content</p></div>',
			locale,
			(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "t"))),
		);
		const details = page.doc.querySelector("details")!;
		expect(page.anchor.revealPath).toEqual([]);
		details.open = false;
		await page.render();
		expect(page.markerShown()).toBe(false);
		expect(page.chip()).toBe(chips.notVisible[locale]);
		expect(page.api.resolve(page.anchor).target).toBe(details);
		expect(page.show()).toBe("");
		expect(details.open).toBe(true);
		expect(page.doc.activeElement).toBe(page.doc.querySelector("[data-node-id]"));
		await page.render();
		expect(page.markerShown()).toBe(true);
		expect(page.highlighted()).toBe(1);
	});

	it.each(locales)(
		"finds a quote behind two new concealers, then opens it once one remains (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><section id="step"><details open><summary>Open</summary><p id="t">Target text</p></details></section><p>Other visible content</p></div>',
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "t"))),
			);
			const details = page.doc.querySelector("details")!;
			details.open = false;
			byId(page.doc, "step").hidden = true;
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			expect(page.api.resolve(page.anchor)).toMatchObject({ state: "notOnPage", target: details });
			byId(page.doc, "step").hidden = false;
			await page.render();
			expect(page.chip()).toBe(chips.notVisible[locale]);
			expect(page.show()).toBe("");
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.highlighted()).toBe(1);
			expect(page.chip()).toBe("");
		},
	);

	it.each(locales)(
		"falls back to the owner for decorated code under two new concealers (%s)",
		async (locale) => {
			const line = (n: number, code: string) =>
				`<span class="praxity-code-line" style="display:flex"><span class="praxity-code-line-number" aria-hidden="true">${n}</span><span data-code-line>${code}</span></span>`;
			const page = await captured(
				`<div data-node-id="node"><section id="step"><details open><summary>Open</summary><pre><code id="code">${line(1, "const a = 1;")}\n${line(2, "const b = 2;")}</code></pre></details></section><p>Other visible content</p></div>`,
				locale,
				(doc, api) => api.fromSelection(selectContents(doc, byId(doc, "code"))),
			);
			page.doc.querySelector("details")!.open = false;
			byId(page.doc, "step").hidden = true;
			await page.render();
			// The documented limit: a marker on the visible owner block, never on hidden text.
			expect(page.chip()).toBe(chips.textChanged[locale]);
			expect(page.markerShown()).toBe(true);
			expect(page.api.resolve(page.anchor).target).toBe(page.doc.querySelector("[data-node-id]"));
		},
	);

	it.each(locales)(
		"labels an edited hidden pin as concealed, then as moved once shown (%s)",
		async (locale) => {
			const page = await captured(
				'<div data-node-id="node"><section id="step"><ol><li id="pinned">Wash hands</li></ol></section><p>Other visible content</p></div>',
				locale,
				(doc, api) => api.fromPin(byId(doc, "pinned"), 130, 120),
			);
			byId(page.doc, "step").hidden = true;
			byId(page.doc, "pinned").textContent = "Dry hands";
			await page.render();
			expect(page.markerShown()).toBe(false);
			expect(page.chip()).toBe(chips.notOnPage[locale]);
			byId(page.doc, "step").hidden = false;
			await page.render();
			expect(page.markerShown()).toBe(true);
			expect(page.chip()).toBe(chips.pinMoved[locale]);
		},
	);

	it("measures no geometry for filtered or resolved threads", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const quote = (exact: string) => ({
			...pageAnchor,
			nodeId: exact === "Open text" ? "open" : "done",
			quote: { type: "TextQuoteSelector" as const, exact, prefix: "", suffix: "" },
		});
		const { doc, dom } = await open(
			'<p data-node-id="open">Open text</p><p data-node-id="done">Done text</p>',
			vi.fn().mockResolvedValue(
				response({
					ok: true,
					threads: [
						thread(quote("Open text"), "open"),
						{ ...thread(quote("Done text"), "done"), status: "resolved" },
					],
					nextCursor: null,
				}),
			),
			settings,
			(dom) => {
				clock = manualFrames(dom);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(2));
		clock.flush();
		let reads = 0;
		dom.window.Range.prototype.getClientRects = () => {
			reads++;
			return [box()] as unknown as DOMRectList;
		};
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		clock.flush();
		// Only the open, listed thread is measured.
		expect(reads).toBe(1);
		doc.querySelector<HTMLInputElement>('[data-review-filter="resolved"]')!.click();
		reads = 0;
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		clock.flush();
		expect(reads).toBe(0);
	});
});

describe("review anchor capture and immutable resolution", () => {
	it("exposes only a frozen read-only DOM interface", async () => {
		const { api } = await open("");
		expect(Object.isFrozen(api)).toBe(true);
		expect(Object.keys(api).sort()).toEqual([
			"fromBlock",
			"fromPin",
			"fromSelection",
			"page",
			"resolve",
		]);
	});
	it("captures an inline selection as literal contract JSON", async () => {
		const { doc, api } = await open(
			'<p data-node-id="node" data-block-id="block">Before <em>selected</em> after</p>',
		);
		const text = doc.querySelector("em")?.firstChild as Text;
		const anchor = api.fromSelection(range(doc, text, 0));
		expect(anchor).toEqual({
			...pageAnchor,
			nodeId: "node",
			blockId: "block",
			quote: { type: "TextQuoteSelector", exact: "selected", prefix: "Before ", suffix: " after" },
			cssPath: null,
			context: { pageTitle: "Page title", targetLabel: "selected" },
		});
	});
	it("captures a selection across blocks in the page stream without clipping", async () => {
		const { doc, api } = await open(
			'<p data-node-id="one" data-block-id="b1">First </p><p data-node-id="two" data-block-id="b2">second</p>',
		);
		const paragraphs = doc.querySelectorAll("main p");
		expect(
			api.fromSelection(
				range(doc, paragraphs[0].firstChild as Text, 0, paragraphs[1].firstChild as Text, 6),
			),
		).toEqual({
			...pageAnchor,
			quote: {
				type: "TextQuoteSelector",
				exact: "First second",
				prefix: "Page title ",
				suffix: "",
			},
			context: { pageTitle: "Page title", targetLabel: "First second" },
		});
	});
	it("places an unchanged node-less cross-block quote with visible block separators", async () => {
		const { doc, api } = await open(
			'<p data-block-id="one">First</p><p data-block-id="two">second</p>',
		);
		const paragraphs = doc.querySelectorAll("main p");
		const anchor = JSON.parse(
			JSON.stringify(
				api.fromSelection(
					range(doc, paragraphs[0].firstChild as Text, 0, paragraphs[1].firstChild as Text, 6),
				),
			),
		) as ReviewAnchor;
		expect(anchor.quote).toEqual({
			type: "TextQuoteSelector",
			exact: "First second",
			prefix: "Page title ",
			suffix: "",
		});
		expect(resolveStored(api, anchor).state).toBe("placed");
	});
	it("marks a node-less phrase as moved when its stored context no longer agrees", async () => {
		const { doc, api } = await open('<p data-node-id="body">Read this first.</p>');
		const heading = doc.querySelector("h1") as Element;
		heading.textContent = "Safety basics";
		const selected = doc.createRange();
		selected.selectNodeContents(heading);
		const anchor = JSON.parse(JSON.stringify(api.fromSelection(selected))) as ReviewAnchor;
		expect(anchor.quote).toEqual({
			type: "TextQuoteSelector",
			exact: "Safety basics",
			prefix: "",
			suffix: " Read this first.",
		});
		expect(resolveStored(api, anchor).state).toBe("placed");
		heading.textContent = "Safety fundamentals";
		(doc.querySelector("main p") as Element).textContent =
			"Before you start, revisit Safety basics from module one.";
		expect(resolveStored(api, anchor).state).toBe("moved");
	});
	it.each(["node", "block", "tab", "reveal"])(
		"refuses invalid %s identities before C1 receives a capture",
		async (kind) => {
			for (const invalid of [" x", "x".repeat(201), "x\u0001", "\ud800"]) {
				const { doc, api } = await open(
					'<details id="reveal" open><div role="tabpanel" id="tab"><p data-node-id="node" data-block-id="block">Text</p></div></details>',
				);
				const target = doc.querySelector("main p") as Element;
				const anchor = JSON.parse(JSON.stringify(api.fromBlock(target))) as ReviewAnchor;
				expect(
					parseCommandPayload("create", {
						reviewId,
						requestId: "22222222-2222-4222-8222-222222222222",
						anchor,
						body: "Comment",
					}).ok,
				).toBe(true);
				if (kind === "node" || kind === "block") target.setAttribute(`data-${kind}-id`, invalid);
				else
					(doc.querySelector(kind === "tab" ? "[role=tabpanel]" : "details") as Element).id =
						invalid;
				expect(api.fromBlock(target)).toBeNull();
			}
		},
	);
	it("captures multi-ID disclosure controls and keeps cut block/pin targets unavailable", async () => {
		const { doc, api } = await open(
			'<button aria-expanded="true" aria-controls="other reveal">Reveal</button><div id="reveal"><div role="tabpanel" id="panel"><p data-node-id="node">Text</p></div></div>',
		);
		const target = doc.querySelector("main p") as Element;
		const anchor = JSON.parse(JSON.stringify(api.fromBlock(target))) as ReviewAnchor;
		expect(anchor.revealPath).toEqual(["reveal"]);
		target.remove();
		(doc.querySelector("#panel") as HTMLElement).hidden = true;
		// No learner control opens the recorded panel, so the label is "Not on this page".
		expect(resolveStored(api, anchor).state).toBe("notOnPage");
		expect(resolveStored(api, { ...anchor, pin: { path: "", x: 0.5, y: 0.5 } }).state).toBe(
			"notOnPage",
		);
	});
	it("refuses css evidence outside the bounded child-step grammar", async () => {
		const { api } = await open("<section>Fallback</section>");
		const anchor = {
			...pageAnchor,
			cssPath: "x, section",
			context: { pageTitle: "Page title", targetLabel: "Fallback" },
		};
		expect(resolveStored(api, JSON.parse(JSON.stringify(anchor))).state).toBe("deleted");
	});
	it("matches duplicate quotes by context and refuses ties across two projections", async () => {
		const { doc, api } = await open('<p data-node-id="node">one same two same three</p>');
		const text = doc.querySelector("main p")?.firstChild as Text;
		const anchor = api.fromSelection(range(doc, text, 13, text, 17)) as ReviewAnchor;
		expect(resolveStored(api, anchor).range?.startOffset).toBe(13);
		const clone = doc.querySelector("main p")?.cloneNode(true) as Element;
		doc.querySelector("main")?.append(clone);
		expect(resolveStored(api, anchor).state).toBe("ambiguous");
		clone.setAttribute("hidden", "");
		expect(resolveStored(api, anchor).range?.startOffset).toBe(13);
	});
	it("prefers visible identity and captures tab and outermost disclosure context", async () => {
		const { doc, api } = await open(
			'<p data-node-id="node" hidden>old projection</p><details id="outer" open><details id="inner" open><div role="tabpanel" id="tab"><p data-node-id="node" data-block-id="block">Visible</p></div></details></details>',
		);
		const target = doc.querySelector("#tab p") as Element;
		const anchor = api.fromBlock(target) as ReviewAnchor;
		expect(anchor.tab).toBe("tab");
		expect(anchor.revealPath).toEqual(["outer", "inner"]);
		expect(resolveStored(api, anchor).target).toBe(target);
		doc.querySelector("#tab")?.setAttribute("hidden", "");
		expect(resolveStored(api, anchor).state).toBe("notOnPage");
	});
	it("keeps changed, moved and deleted anchors immutable", async () => {
		const { doc, api } = await open('<p data-node-id="node">Original wording</p>');
		const p = doc.querySelector("main p") as Element;
		const anchor = api.fromSelection(range(doc, p.firstChild as Text, 0)) as ReviewAnchor;
		const original = JSON.stringify(anchor);
		p.textContent = "Edited wording";
		expect(resolveStored(api, anchor).state).toBe("textChanged");
		p.remove();
		const moved = doc.createElement("p");
		moved.textContent = "Original wording";
		doc.querySelector("main")?.append(moved);
		expect(resolveStored(api, anchor).state).toBe("moved");
		const duplicate = moved.cloneNode(true);
		moved.after(duplicate);
		expect(resolveStored(api, anchor).state).toBe("ambiguous");
		moved.remove();
		duplicate.parentNode?.removeChild(duplicate);
		expect(resolveStored(api, anchor).state).toBe("deleted");
		expect(JSON.stringify(anchor)).toBe(original);
	});
	it("uses changed revisions only to disable CSS evidence", async () => {
		const { doc, api } = await open(
			'<p data-node-id="node">Unchanged</p><section>Fallback</section>',
		);
		const target = doc.querySelector("main p") as Element;
		const anchor = { ...api.fromBlock(target), revision: "older" } as ReviewAnchor;
		expect(resolveStored(api, anchor).state).toBe("placed");
		const fallback = {
			...pageAnchor,
			cssPath: "section:nth-of-type(1)",
			context: { pageTitle: "Page title", targetLabel: "Fallback" },
		};
		expect(resolveStored(api, fallback).target).toBe(doc.querySelector("section"));
		expect(resolveStored(api, { ...fallback, revision: "older" }).state).toBe("deleted");
	});
	it("keeps a concealed quote or pin unavailable instead of claiming its text changed", async () => {
		const { doc, api } = await open(
			'<div data-node-id="node"><div id="panel" role="tabpanel"><p>Tabbed text</p></div></div>',
		);
		const p = doc.querySelector("main p") as HTMLElement;
		const anchor = api.fromSelection(range(doc, p.firstChild as Text, 0)) as ReviewAnchor;
		p.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
		const pin = api.fromPin(p, 50, 50) as ReviewAnchor;
		doc.querySelector("#panel")?.setAttribute("hidden", "");
		expect(resolveStored(api, anchor)).toMatchObject({
			state: "notOnPage",
			target: doc.querySelector("#panel"),
		});
		expect(resolveStored(api, pin).state).toBe("notOnPage");
	});
	it.each(["tab", "disclosure"])(
		"keeps a cross-block quote in its recorded closed %s until a visible copy appears",
		async (kind) => {
			const content = '<p data-node-id="a">First</p><p data-node-id="b">second</p>';
			const { doc, api } = await open(
				kind === "tab"
					? `<div id="panel" role="tabpanel">${content}</div>`
					: `<details id="disclosure" open><summary>Open</summary>${content}</details>`,
			);
			const paragraphs = doc.querySelectorAll("main p");
			const anchor = JSON.parse(
				JSON.stringify(
					api.fromSelection(
						range(doc, paragraphs[0].firstChild as Text, 0, paragraphs[1].firstChild as Text, 6),
					),
				),
			) as ReviewAnchor;
			expect(anchor.nodeId).toBeNull();
			expect(anchor.quote?.exact).toBe("First second");
			const container = doc.querySelector(kind === "tab" ? "#panel" : "#disclosure") as HTMLElement;
			if (kind === "tab") container.hidden = true;
			else (container as HTMLDetailsElement).open = false;
			// Only the disclosure has a learner control that Show on page can open.
			expect(resolveStored(api, anchor)).toMatchObject({
				state: kind === "tab" ? "notOnPage" : "notVisible",
				target: container,
			});
			const copy = doc.createElement("p");
			copy.textContent = "First second";
			doc.querySelector("main")?.append(copy);
			// The visible copy keeps its full stored context, so it places.
			expect(resolveStored(api, anchor)).toMatchObject({ state: "placed", target: copy });
		},
	);
	it("places a node-less quote when only one repeated match has complete stored context", async () => {
		const { doc, api } = await open("<p>Repeat Page title elsewhere.</p>");
		const title = doc.querySelector("h1") as Element;
		const anchor = JSON.parse(
			JSON.stringify(api.fromSelection(range(doc, title.firstChild as Text, 0))),
		) as ReviewAnchor;
		expect(anchor.nodeId).toBeNull();
		const spot = resolveStored(api, anchor);
		expect(spot.state).toBe("placed");
		expect(spot.range?.startContainer).toBe(title.firstChild);
	});
	it.each([1, 2])(
		"matches %i visible quote duplicates before a recorded closed tab",
		async (copies) => {
			const { doc, api } = await open(
				'<div id="panel" role="tabpanel"><p data-node-id="node">Same text</p></div>',
			);
			const p = doc.querySelector("main p") as Element;
			const anchor = JSON.parse(
				JSON.stringify(api.fromSelection(range(doc, p.firstChild as Text, 0))),
			);
			p.remove();
			const panel = doc.querySelector("#panel") as HTMLElement;
			panel.hidden = true;
			for (let i = 0; i < copies; i++) {
				const duplicate = doc.createElement("p");
				duplicate.textContent = "Same text";
				doc.querySelector("main")?.append(duplicate);
			}
			expect(resolveStored(api, anchor).state).toBe(copies === 1 ? "moved" : "ambiguous");
		},
	);
	it("never transfers an identified block after a positional sibling insert", async () => {
		const { doc, api } = await open('<p data-node-id="node">Target</p>');
		const target = doc.querySelector("main p") as Element;
		const anchor = api.fromBlock(target) as ReviewAnchor;
		target.before(doc.createElement("p"));
		expect(resolveStored(api, anchor).target).toBe(target);
		target.remove();
		expect(resolveStored(api, anchor).state).toBe("deleted");
	});
	it("captures fractional pins and falls back to identity on broken or shifted child paths", async () => {
		const { doc, api } = await open(
			'<div data-node-id="node" data-block-id="block"><p>Pin target</p></div>',
		);
		const p = doc.querySelector("main p") as HTMLElement;
		p.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;
		const anchor = api.fromPin(p, 76.6666, 45) as ReviewAnchor;
		expect(anchor.pin).toEqual({ path: "p:nth-of-type(1)", x: 0.3333, y: 0.25 });
		expect(
			resolveStored(api, JSON.parse(JSON.stringify({ ...anchor, revision: "older" }))),
		).toMatchObject({ state: "pinMoved", target: p.parentElement });
		p.before(doc.createElement("p"));
		expect(resolveStored(api, anchor)).toMatchObject({
			state: "pinMoved",
			target: p.parentElement,
		});
		p.remove();
		expect(
			resolveStored(api, {
				...anchor,
				pin: { ...anchor.pin, path: "span:nth-of-type(1)" },
			} as ReviewAnchor).state,
		).toBe("pinMoved");
	});
	it("places unchanged repeated-label and unlabelled pin targets at the stored path", async () => {
		const { doc, api } = await open(
			'<figure data-node-id="images"><img><img></figure><table data-node-id="cells"><tbody><tr><td>Yes</td><td>Yes</td></tr></tbody></table>',
		);
		for (const target of doc.querySelectorAll("img,td")) {
			target.getBoundingClientRect = () => box();
			const anchor = JSON.parse(JSON.stringify(api.fromPin(target as HTMLElement, 100, 110)));
			expect(resolveStored(api, anchor)).toMatchObject({ state: "placed", target });
		}
	});
	it("never transfers a re-exported pin or CSS target to an equal-label sibling", async () => {
		const { doc, api } = await open(
			'<figure data-node-id="image"><img alt="original"></figure><p data-node-id="links"><a>Open</a></p><section>Fallback</section>',
		);
		for (const selector of ["img", "a"]) {
			const target = doc.querySelector(selector) as HTMLElement;
			target.getBoundingClientRect = () =>
				({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
			const anchor = JSON.parse(JSON.stringify(api.fromPin(target, 50, 50))) as ReviewAnchor;
			anchor.revision = "older";
			target.before(target.cloneNode(true));
			expect(resolveStored(api, anchor)).toMatchObject({
				state: "pinMoved",
				target: target.parentElement,
			});
		}
		const section = doc.querySelector("section") as Element;
		const fallback = JSON.parse(JSON.stringify(api.fromBlock(section))) as ReviewAnchor;
		fallback.revision = "older";
		section.before(section.cloneNode(true));
		expect(resolveStored(api, fallback).state).toBe("deleted");
	});
	it("excludes learner values, form controls and every hidden representation from capture", async () => {
		const { doc, api } = await open(
			'<p data-node-id="node">before <input value="secret"><textarea>secret</textarea><select><option>secret</option></select><button>secret</button><span contenteditable="false">secret</span><span hidden>secret</span><span inert>secret</span><span aria-hidden="true">secret</span><span style="display:none">secret</span><span style="visibility:hidden">secret</span><script>secret</script><style>secret</style><noscript>secret</noscript><template>secret</template><em>safe</em> after</p>',
		);
		const text = doc.querySelector("em")?.firstChild as Text;
		expect(api.fromSelection(range(doc, text, 0))?.quote).toEqual({
			type: "TextQuoteSelector",
			exact: "safe",
			prefix: "before ",
			suffix: " after",
		});
		const all = doc.createRange();
		all.selectNodeContents(doc.querySelector("main p") as Element);
		expect(api.fromSelection(all)?.quote?.exact).toBe("before safe after");
	});
	it("normalizes whitespace across inline nodes and never splits surrogate pairs at context boundaries", async () => {
		const { doc, api } = await open(
			`<p data-node-id="node">😀${"a".repeat(30)}<b> chosen </b>${"z".repeat(30)}😀</p>`,
		);
		const text = doc.querySelector("b")?.firstChild as Text;
		expect(api.fromSelection(range(doc, text, 1, text, 7))?.quote).toEqual({
			type: "TextQuoteSelector",
			exact: "chosen",
			prefix: `${"a".repeat(30)} `,
			suffix: ` ${"z".repeat(30)}`,
		});
		const p = doc.querySelector("main p") as Element;
		p.innerHTML = "one \n <b> \t two</b>";
		const selected = doc.createRange();
		selected.selectNodeContents(p);
		expect(api.fromSelection(selected)?.quote?.exact).toBe("one two");
	});
	it("refuses oversized selections instead of clipping them", async () => {
		const { doc, api } = await open(`<p data-node-id="node">${"x".repeat(2001)}</p>`);
		expect(
			api.fromSelection(range(doc, doc.querySelector("main p")?.firstChild as Text, 0)),
		).toBeNull();
	});
	it("never captures rendered learner answers in quote or context fields", async () => {
		const { doc, dom, api } = await open(
			'<div data-node-id="node" data-island="rating" data-block-id="rating"><fieldset class="praxity-rating"><legend>Rating </legend><label><input type="radio" name="rating" value="3"><span class="praxity-sr-only">3 of 5</span></label><input type="range"><output></output></fieldset><span data-rating-feedback>private rating feedback</span><div data-self-check-comparison><p>private written answer</p></div><div class="praxity-fill-blank-response">private blank</div><div data-assessment-feedback>private result</div><span data-mention="learnerInfo:name">private name</span><span data-retrieval-date-line>private date</span><p id="explain">Explain</p></div>',
		);
		vi.stubGlobal("document", doc);
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("Event", dom.window.Event);
		vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
		const { initRatingEnhancements } = await import("../template/src/islands/island-rating");
		const detach = initRatingEnhancements(doc);
		try {
			const option = doc.querySelector('input[type="radio"]') as HTMLInputElement;
			option.checked = true;
			option.dispatchEvent(new dom.window.Event("change"));
			expect(doc.querySelector("output")?.textContent).toBe("3 of 5");
			const p = doc.querySelector("#explain") as Element;
			const anchor = JSON.parse(
				JSON.stringify(api.fromSelection(range(doc, p.firstChild as Text, 0))),
			) as ReviewAnchor;
			expect(anchor.quote).toEqual({
				type: "TextQuoteSelector",
				exact: "Explain",
				prefix: "Rating ",
				suffix: "",
			});
			expect(anchor.context).toEqual({ pageTitle: "Page title", targetLabel: "Explain" });
			expect(
				api.fromBlock(doc.querySelector('[data-node-id="node"]') as Element)?.context.targetLabel,
			).toBe("Rating Explain");
			doc.querySelector("main h1")?.append(doc.querySelector("[data-mention]") as Element);
			expect(api.page().context.pageTitle).toBe("Page title");
		} finally {
			detach();
		}
	});
	it("excludes live status, hidden announcements, clipped text and hotspot results by stream rules", async () => {
		const { doc, api } = await open(
			'<section data-node-id="node"><p>Order steps </p><span class="mantine-VisuallyHidden-root">Rinse moved to position 1 of 3</span><span aria-live="polite">Private live answer</span><span role="status">Score 4 of 5</span><span role="alert">Private alert</span><span role="log">Private log</span><span role="timer">Private timer</span><span style="position:absolute;width:1px;height:1px;clip:rect(0px,0px,0px,0px)">Clipped answer</span><span style="position:absolute;width:1px;height:1px;clip-path:inset(50%)">Clipped state</span><span aria-live="off">Authored </span><em>Explain</em><span class="praxity-hotspot-caption">2 of 4 selected</span><small> after</small></section>',
		);
		const selected = range(doc, doc.querySelector("em")?.firstChild as Text, 0);
		const anchor = JSON.parse(JSON.stringify(api.fromSelection(selected))) as ReviewAnchor;
		expect(anchor.quote).toEqual({
			type: "TextQuoteSelector",
			exact: "Explain",
			prefix: "Order steps Authored ",
			suffix: " after",
		});
		expect(anchor.context).toEqual({ pageTitle: "Page title", targetLabel: "Explain" });
		expect(api.fromBlock(doc.querySelector("section") as Element)?.context.targetLabel).toBe(
			"Order steps Authored Explain after",
		);
		selected.selectNodeContents(doc.querySelector("section") as Element);
		expect(api.fromSelection(selected)?.quote?.exact).toBe("Order steps Authored Explain after");
	});
});

describe("marker placement and learner controls", () => {
	it.each(["deck", "centered"])(
		"keeps %s gutter markers clear on page-root ancestors",
		async (layout) => {
			let clock!: ReturnType<typeof manualFrames>;
			const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
			const fetchMock = vi
				.fn()
				.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
			const { doc } = await open(
				layout === "deck"
					? '<section data-deck-slide="page"><p data-node-id="node">Target</p></section>'
					: '<p data-node-id="node">Target</p>',
				fetchMock,
				settings,
				(dom) => {
					clock = manualFrames(dom);
				},
			);
			await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
			(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () =>
				box(layout === "deck" ? 24 : 132);
			doc.elementFromPoint =
				layout === "deck"
					? () => doc.querySelector("main")
					: (x) => (x < 100 ? doc.body : doc.querySelector("main"));
			clock.flush();
			expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(false);
		},
	);
	it("keeps RTL gutter hit points inside the client viewport, including scrollbar edges", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open(
			'<p data-node-id="node" style="direction:rtl;line-height:28px">Target</p>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
				Object.defineProperties(dom.window, {
					innerWidth: { value: 820 },
					innerHeight: { value: 710 },
				});
				Object.defineProperties(dom.window.document.documentElement, {
					clientWidth: { value: 800 },
					clientHeight: { value: 700 },
				});
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		const target = doc.querySelector('[data-node-id="node"]') as Element;
		target.getBoundingClientRect = () => box(100, 100, 668);
		const hits: [number, number][] = [];
		doc.elementFromPoint = (x, y) => {
			hits.push([x, y]);
			return x <= 799 && y <= 699 ? doc.querySelector("main") : null;
		};
		clock.flush();
		const marker = doc.querySelector(".prx-review-marker") as HTMLElement;
		expect(marker.style.left).toBe("784px");
		expect(marker.hidden).toBe(false);
		expect(Math.max(...hits.map(([x]) => x))).toBe(799);
	});
	it.each([699, 700])(
		"uses client viewport bounds for a pin at bottom coordinate %i",
		async (bottom) => {
			let clock!: ReturnType<typeof manualFrames>;
			const anchor = JSON.parse(
				JSON.stringify({ ...pageAnchor, nodeId: "node", pin: { path: "", x: 0, y: 0 } }),
			);
			const fetchMock = vi
				.fn()
				.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
			const { doc } = await open(
				'<p data-node-id="node">Target</p>',
				fetchMock,
				settings,
				(dom) => {
					clock = manualFrames(dom);
					Object.defineProperties(dom.window, {
						innerWidth: { value: 820 },
						innerHeight: { value: 710 },
					});
					Object.defineProperties(dom.window.document.documentElement, {
						clientWidth: { value: 800 },
						clientHeight: { value: 700 },
					});
				},
			);
			await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
			(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () =>
				box(760, bottom + 12);
			const hits: [number, number][] = [];
			doc.elementFromPoint = (x, y) => {
				hits.push([x, y]);
				return x <= 799 && y <= 699 ? doc.querySelector("main") : null;
			};
			clock.flush();
			expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(bottom > 699);
			expect(Math.max(...hits.map(([, y]) => y))).toBe(699);
		},
	);
	it("publishes an explicit 48px marker hit area around the 24px body", () => {
		const dom = new JSDOM(`<style>${stylesheet}</style>`);
		doms.push(dom);
		const rules = Array.from(dom.window.document.styleSheets[0].cssRules) as CSSStyleRule[];
		const hit = rules.find(
			(rule) => rule.selectorText === ".prx-review-marker::before",
		) as CSSStyleRule;
		expect(hit.style.width).toBe("48px");
		expect(hit.style.height).toBe("48px");
		expect(hit.style.left).toBe("-14px");
		expect(hit.style.top).toBe("-14px");
	});
	it("uses the measured theme foreground for highlighted links and colored text", () => {
		const dom = new JSDOM(`<style>${stylesheet}</style>`);
		doms.push(dom);
		const rules = Array.from(dom.window.document.styleSheets[0].cssRules) as CSSStyleRule[];
		const highlight = rules.find(
			(rule) => rule.selectorText === "::highlight(prx-review-quote)",
		) as CSSStyleRule;
		expect(highlight.style.color).toBe("var(--praxity-color-text, #212529)");
	});
	it("gives course dark mode precedence over OS preference for highlight strength", () => {
		const dom = new JSDOM(
			`<html data-praxity-mode="dark"><head><style>${stylesheet}</style></head></html>`,
		);
		doms.push(dom);
		expect(
			dom.window
				.getComputedStyle(dom.window.document.documentElement)
				.getPropertyValue("--prx-review-quote-strength"),
		).toBe("35%");
		const rules = Array.from(dom.window.document.styleSheets[0].cssRules);
		const media = rules.find(
			(rule) => (rule as CSSMediaRule).conditionText === "(prefers-color-scheme: dark)",
		) as CSSMediaRule;
		expect((media.cssRules[0] as CSSStyleRule).selectorText).toBe("html:not([data-praxity-mode])");
	});
	it("publishes stronger light/dark quote fills with readable text on every palette", () => {
		const light = Number(stylesheet.match(/var\(--prx-review-quote-strength,\s*(\d+)%\)/)?.[1]);
		const dark = Number(stylesheet.match(/--prx-review-quote-strength:\s*(\d+)%/)?.[1]);
		expect({ light, dark }).toEqual({ light: 28, dark: 35 });
		for (const palette of ["ink", "forest", "plum", "clay", "clear"] as const)
			for (const mode of ["light", "dark"] as const) {
				const tokens = resolveDesignTokens({ palette } as DesignVariants, mode);
				const alpha = (mode === "light" ? light : dark) / 100;
				// CSS color-mix(in srgb, …, transparent) composites encoded sRGB channels;
				// the theme's compositeOver helper deliberately mixes linear RGB instead.
				const fill =
					"#" +
					[1, 3, 5]
						.map((i) =>
							Math.round(
								parseInt(tokens["--praxity-color-accent"].slice(i, i + 2), 16) * alpha +
									parseInt(tokens["--praxity-color-background"].slice(i, i + 2), 16) * (1 - alpha),
							)
								.toString(16)
								.padStart(2, "0"),
						)
						.join("");
				expect(
					contrastRatio(tokens["--praxity-color-text"], fill),
					`${palette}/${mode}`,
				).toBeGreaterThanOrEqual(4.5);
			}
	});
	it.each(["deck-controls", "deck-more-panel", "deck-header", "deck-more-below"])(
		"keeps markers out of the real %s deck zone",
		async (zone) => {
			let clock!: ReturnType<typeof manualFrames>;
			const anchor = { ...pageAnchor, nodeId: "node" };
			const fetchMock = vi
				.fn()
				.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
			const { doc, dom } = await open(
				`<div class="praxity-deck"><div class="deck-utility-items"></div><div class="deck-workspace"><article data-deck-slide="page"><p data-node-id="node">Target</p></article></div><nav id="${zone}" class="${zone}"></nav></div>`,
				fetchMock,
				settings,
				(dom) => {
					clock = manualFrames(dom);
				},
			);
			await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
			(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () => box();
			const zoneNode = doc.getElementById(zone) as HTMLElement;
			doc.elementFromPoint = () => zoneNode;
			clock.flush();
			expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(true);
			doc.elementFromPoint = () => doc.querySelector('[data-node-id="node"]');
			dom.window.dispatchEvent(new dom.window.Event("scroll"));
			clock.flush();
			expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(false);
		},
	);
	it.each([
		'<nav id="praxity-page-nav" style="position:sticky;bottom:0"><a>Next page</a></nav>',
		'<aside class="praxity-native-outline"><a>Lesson link</a></aside>',
		'<dialog open class="praxity-dialog-sheet"><p>Dialog content</p></dialog>',
	])("hides a marker occluded by page chrome: %s", async (chrome) => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc, dom } = await open(
			`<p data-node-id="node">Target</p>${chrome}`,
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
				const main = dom.window.document.querySelector("main") as Element;
				main.after(main.lastElementChild as Element);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		const target = doc.querySelector('[data-node-id="node"]') as Element;
		target.getBoundingClientRect = () => box();
		const hit = doc.querySelector("main + *")?.firstElementChild as Element;
		const hitTest = vi.fn(() => hit);
		doc.elementFromPoint = hitTest;
		clock.flush();
		const marker = doc.querySelector(".prx-review-marker") as HTMLElement;
		expect(hitTest).toHaveBeenCalledTimes(5);
		expect(marker.hidden).toBe(true);
		// Already-visible markers must not occlude themselves on the next frame.
		doc.elementFromPoint = () => marker;
		doc.elementsFromPoint = () => [marker, target, doc.querySelector("main") as Element];
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		clock.flush();
		expect(marker.hidden).toBe(false);
	});
	it.each([
		"<footer>Attribution</footer>",
		'<nav class="praxity-ag-review-links"><a>Review answers</a></nav>',
	])("keeps markers beside authored in-root content: %s", async (authored) => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open(
			`<section data-node-id="node"><p>Target</p>${authored}</section>`,
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		(doc.querySelector("section") as Element).getBoundingClientRect = () => box();
		doc.elementFromPoint = () => doc.querySelector("section > :last-child");
		clock.flush();
		expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(false);
	});
	it.each([
		"<dialog open>Modal</dialog>",
		'<aside aria-modal="true">Modal</aside>',
		'<aside class="praxity-dialog-sheet">Modal</aside>',
	])("hides markers under an in-root modal surface: %s", async (modal) => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open(
			`<section data-node-id="node"><p>Target</p>${modal}</section>`,
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		(doc.querySelector("section") as Element).getBoundingClientRect = () => box();
		doc.elementFromPoint = () => doc.querySelector("section > :last-child");
		clock.flush();
		expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(true);
	});
	it("hides a marker when navigation touches the edge of its full hit box", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(
			JSON.stringify({ ...pageAnchor, nodeId: "node", pin: { path: "", x: 0.5, y: 0 } }),
		);
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open('<p data-node-id="node">Target</p>', fetchMock, settings, (dom) => {
			clock = manualFrames(dom);
		});
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () => box();
		const nav = doc.createElement("nav");
		doc.body.append(nav);
		doc.elementFromPoint = (_x, y) => (y >= 95 ? nav : doc.querySelector("main"));
		clock.flush();
		expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(true);
	});
	it.each([
		["block", 80, "64px", "126px"],
		["block", 20, "24px", "96px"],
		["textChanged", 80, "64px", "126px"],
		["pinMoved", 80, "64px", "126px"],
		["pin", 80, "142px", "88px"],
	])(
		"places %s markers using the readable line/gutter geometry at left %s",
		async (kind, left, expectedX, expectedY) => {
			let clock!: ReturnType<typeof manualFrames>;
			const anchor: ReviewAnchor = JSON.parse(
				JSON.stringify({
					...pageAnchor,
					nodeId: "node",
					...(kind === "textChanged"
						? { quote: { type: "TextQuoteSelector", exact: "Old", prefix: "", suffix: "" } }
						: {}),
					...(kind === "pin" || kind === "pinMoved"
						? { pin: { path: kind === "pin" ? "" : "span:nth-of-type(1)", x: 0.5, y: 0.5 } }
						: {}),
				}),
			);
			const fetchMock = vi
				.fn()
				.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
			const { doc } = await open(
				'<p data-node-id="node" style="font-size:18px;line-height:28px">Target</p>',
				fetchMock,
				settings,
				(dom) => {
					clock = manualFrames(dom);
				},
			);
			await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
			(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () =>
				box(left as number);
			clock.flush();
			const marker = doc.querySelector(".prx-review-marker") as HTMLElement;
			expect(marker.style.left).toBe(expectedX);
			expect(marker.style.top).toBe(expectedY);
			expect(marker.classList.contains("prx-review-marker--block")).toBe(kind !== "pin");
		},
	);
	it("throttles frames, caches resolution, measures before writing and ignores its own mutations", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const a = {
			...pageAnchor,
			nodeId: "a",
			quote: { type: "TextQuoteSelector" as const, exact: "Original", prefix: "", suffix: "" },
		};
		const b = { ...pageAnchor, nodeId: "b" };
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				response({ ok: true, threads: [thread(a, "a"), thread(b, "b")], nextCursor: null }),
			);
		const { doc, dom } = await open(
			'<p data-node-id="a">Original</p><p data-node-id="b">Second</p><nav class="deck-controls"></nav>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
				dom.window.Range.prototype.getClientRects = () => [box()] as unknown as DOMRectList;
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(2));
		const events: string[] = [];
		for (const target of doc.querySelectorAll("[data-node-id]"))
			target.getBoundingClientRect = () => {
				events.push("read");
				return box();
			};
		const hitTest = vi.fn(() => {
			events.push("read");
			return doc.querySelector("main");
		});
		doc.elementFromPoint = hitTest;
		const hiddenSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "hidden")
			?.set as (this: HTMLElement, value: boolean) => void;
		vi.spyOn(dom.window.HTMLElement.prototype, "hidden", "set").mockImplementation(function (
			this: HTMLElement,
			value,
		) {
			events.push("write");
			hiddenSetter.call(this, value);
		});
		clock.flush();
		expect(events.lastIndexOf("read")).toBeLessThan(events.indexOf("write"));
		expect(hitTest).toHaveBeenCalledTimes(10);
		await Promise.resolve();
		await Promise.resolve();
		expect(clock.pending.size).toBe(0);
		const readStyle = vi.spyOn(dom.window, "getComputedStyle");
		const chip = doc.querySelector(".prx-review-anchor-status") as Element;
		const contentSetter = Object.getOwnPropertyDescriptor(dom.window.Node.prototype, "textContent")
			?.set as (this: Node, value: string | null) => void;
		const chipsWritten: Element[] = [];
		vi.spyOn(dom.window.Node.prototype, "textContent", "set").mockImplementation(function (
			this: Node,
			value,
		) {
			if (this === chip) chipsWritten.push(chip);
			contentSetter.call(this, value);
		});
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		expect(clock.pending.size).toBe(1);
		clock.flush();
		expect(readStyle.mock.calls.filter(([el]) => (el as Element).tagName === "MAIN")).toHaveLength(
			0,
		);
		expect(chipsWritten).toHaveLength(0);
		(doc.querySelector('[data-node-id="a"]') as Element).textContent = "Edited";
		await Promise.resolve();
		expect(clock.pending.size).toBe(1);
		clock.flush();
		expect(chip.textContent).toBe("⚠ Text changed");
		await Promise.resolve();
		expect(clock.pending.size).toBe(0);
	});
	it("ignores mutations outside the active page and observes its HTML ancestor", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open(
			'<article data-deck-slide="page"><p data-node-id="node">Target</p></article><div id="chrome" role="progressbar"></div>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		clock.flush();
		await Promise.resolve();
		doc.querySelector("#chrome")?.setAttribute("aria-valuenow", "50");
		await Promise.resolve();
		expect(clock.pending.size).toBe(0);
		doc.documentElement.setAttribute("class", "dark-theme");
		await Promise.resolve();
		expect(clock.pending.size).toBe(1);
	});
	it.each(["resize", "stylesheet edit", "stylesheet load"])(
		"invalidates cached visibility on %s while retaining one pending frame",
		async (change) => {
			let clock!: ReturnType<typeof manualFrames>;
			let concealed = true;
			const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
			const fetchMock = vi
				.fn()
				.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
			const { doc, dom } = await open(
				'<p class="responsive" data-node-id="node">Target</p>',
				fetchMock,
				settings,
				(dom) => {
					clock = manualFrames(dom);
					const readStyle = dom.window.getComputedStyle.bind(dom.window);
					(dom.window.document.querySelector(".responsive") as Element).getClientRects = () =>
						(concealed ? [] : [box()]) as unknown as DOMRectList;
					vi.spyOn(dom.window, "getComputedStyle").mockImplementation((el) => {
						const style = readStyle(el);
						// The platform changes computed visibility without a body mutation.
						return new Proxy(style, {
							get: (value, key) =>
								key === "display" && el.classList.contains("responsive")
									? concealed
										? "none"
										: "block"
									: Reflect.get(value, key),
						});
					});
					const style = dom.window.document.createElement("style");
					style.id = "visibility-style";
					style.textContent = ".responsive {display:none}";
					dom.window.document.head.append(style);
					const link = dom.window.document.createElement("link");
					link.rel = "stylesheet";
					link.href = "/theme.css";
					dom.window.document.head.append(link);
				},
			);
			await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
			(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () => box();
			clock.flush();
			const chip = doc.querySelector(".prx-review-anchor-status") as HTMLElement;
			expect(chip.textContent).toBe("⚠ Not on this page");
			concealed = false;
			if (change === "resize") {
				Object.defineProperty(dom.window, "innerWidth", { value: 800, configurable: true });
				dom.window.dispatchEvent(new dom.window.Event("resize"));
			}
			if (change === "stylesheet edit")
				(doc.querySelector("#visibility-style") as Element).textContent =
					".responsive {display:block}";
			if (change === "stylesheet load")
				doc.querySelector("link")?.dispatchEvent(new dom.window.Event("load"));
			await Promise.resolve();
			expect(clock.pending.size).toBe(1);
			clock.flush();
			expect(chip.hidden).toBe(true);
			expect((doc.querySelector(".prx-review-marker") as HTMLElement).hidden).toBe(false);
		},
	);
	it("retains resolution on height-only resize and invalidates on a stylesheet media transition", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		let concealed = false;
		let mediaChange!: () => void;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc, dom } = await open(
			'<p class="responsive" data-node-id="node">Target</p>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
				const style = dom.window.document.createElement("style");
				style.textContent = "@media (max-height: 500px) {.responsive{display:none}}";
				dom.window.document.head.append(style);
				dom.window.matchMedia = vi.fn(
					(query) =>
						({
							media: query,
							matches: false,
							addEventListener: (_type: string, listener: () => void) => {
								if (query === "(max-height: 500px)") mediaChange = listener;
							},
							removeEventListener: vi.fn(),
						}) as unknown as MediaQueryList,
				);
				const native = dom.window.getComputedStyle.bind(dom.window);
				(dom.window.document.querySelector(".responsive") as Element).getClientRects = () =>
					(concealed ? [] : [box()]) as unknown as DOMRectList;
				vi.spyOn(dom.window, "getComputedStyle").mockImplementation(
					(el) =>
						new Proxy(native(el), {
							get: (style, key) =>
								key === "display" && el.classList.contains("responsive")
									? concealed
										? "none"
										: "block"
									: Reflect.get(style, key),
						}),
				);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () => box();
		clock.flush();
		const readStyle = vi.mocked(dom.window.getComputedStyle);
		readStyle.mockClear();
		Object.defineProperty(dom.window, "innerHeight", { value: 700, configurable: true });
		dom.window.dispatchEvent(new dom.window.Event("resize"));
		clock.flush();
		expect(readStyle.mock.calls.filter(([el]) => el.tagName === "MAIN")).toHaveLength(0);
		expect(mediaChange).toBeTypeOf("function");
		concealed = true;
		mediaChange();
		clock.flush();
		expect(doc.querySelector(".prx-review-anchor-status")?.textContent).toBe("⚠ Not on this page");
	});
	it("follows page-root layout shifts without invalidating cached resolution", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		let resize!: () => void;
		const observe = vi.fn();
		const disconnect = vi.fn();
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc, dom } = await open(
			'<p data-node-id="node" style="line-height:28px">Target</p>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
				Object.assign(dom.window, {
					ResizeObserver: class {
						constructor(callback: () => void) {
							resize = callback;
						}
						observe = observe;
						disconnect = disconnect;
					},
				});
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		const target = doc.querySelector('[data-node-id="node"]') as Element;
		target.getBoundingClientRect = () => box();
		clock.flush();
		expect(observe).toHaveBeenCalledWith(doc.querySelector("main"));
		const readStyle = vi.spyOn(dom.window, "getComputedStyle");
		target.getBoundingClientRect = () => box(120, 200);
		resize();
		expect(clock.pending.size).toBe(1);
		clock.flush();
		const marker = doc.querySelector(".prx-review-marker") as HTMLElement;
		expect(marker.style.left).toBe("104px");
		expect(marker.style.top).toBe("226px");
		expect(readStyle.mock.calls.filter(([el]) => el.tagName === "MAIN")).toHaveLength(0);
	});
	it("invalidates cached visibility when the page-root inline size changes", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		let resize!: (entries: { target: Element; borderBoxSize: { inlineSize: number }[] }[]) => void;
		let concealed = false;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open(
			'<p class="responsive" data-node-id="node">Target</p>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
				Object.assign(dom.window, {
					ResizeObserver: class {
						constructor(callback: typeof resize) {
							resize = callback;
						}
						observe() {}
						disconnect() {}
					},
				});
				const native = dom.window.getComputedStyle.bind(dom.window);
				(dom.window.document.querySelector(".responsive") as Element).getClientRects = () =>
					(concealed ? [] : [box()]) as unknown as DOMRectList;
				vi.spyOn(dom.window, "getComputedStyle").mockImplementation(
					(el) =>
						new Proxy(native(el), {
							get: (style, key) =>
								key === "display" && el.classList.contains("responsive")
									? concealed
										? "none"
										: "block"
									: Reflect.get(style, key),
						}),
				);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		clock.flush();
		const root = doc.querySelector("main") as Element;
		resize([{ target: root, borderBoxSize: [{ inlineSize: 700 }] }]);
		clock.flush();
		concealed = true;
		resize([{ target: root, borderBoxSize: [{ inlineSize: 500 }] }]);
		clock.flush();
		expect(doc.querySelector(".prx-review-anchor-status")?.textContent).toBe("⚠ Not on this page");
	});
	it("moves focus to its thread before hiding a focused occluded marker", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc, dom } = await open(
			'<p data-node-id="node">Target</p>',
			fetchMock,
			settings,
			(dom) => {
				clock = manualFrames(dom);
			},
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		(doc.querySelector('[data-node-id="node"]') as Element).getBoundingClientRect = () => box();
		clock.flush();
		const marker = doc.querySelector(".prx-review-marker") as HTMLElement;
		marker.focus();
		const nav = doc.createElement("nav");
		doc.body.append(nav);
		doc.elementFromPoint = () => nav;
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		clock.flush();
		expect(marker.hidden).toBe(true);
		expect(doc.activeElement).toBe(doc.querySelector(".prx-review-comment"));
		expect((doc.querySelector(".prx-review-sidebar") as HTMLElement).hidden).toBe(false);
		expect(
			doc.querySelector(".prx-review-sidebar")?.classList.contains("prx-review-sidebar--collapsed"),
		).toBe(false);
	});
	it("keeps Show on page focused and announces when its target disappears", async () => {
		let clock!: ReturnType<typeof manualFrames>;
		const anchor = JSON.parse(JSON.stringify({ ...pageAnchor, nodeId: "node" }));
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc } = await open('<p data-node-id="node">Target</p>', fetchMock, settings, (dom) => {
			clock = manualFrames(dom);
		});
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		(doc.querySelector(".prx-review-toggle") as HTMLButtonElement).click();
		const show = doc.querySelector(".prx-review-show") as HTMLButtonElement;
		show.focus();
		doc.querySelector('[data-node-id="node"]')?.remove();
		await Promise.resolve();
		clock.flush();
		expect(show.disabled).toBe(false);
		expect(doc.activeElement).toBe(show);
		show.click();
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe("Target deleted");
		expect(doc.activeElement).toBe(show);
	});
	it("shows a target through learner-owned tab/disclosure controls and restores temporary focus", async () => {
		const anchor = { ...pageAnchor, nodeId: "node", tab: "panel", revealPath: ["disclosure"] };
		const fetchMock = vi
			.fn()
			.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
		const { doc, dom } = await open(
			'<button role="tab" aria-controls="other panel">Tab</button><details id="disclosure"><summary>Open</summary><div id="panel" role="tabpanel" hidden><p data-node-id="node">Target</p></div></details><a aria-controls="panel" href="#unsafe">Unsafe</a>',
			fetchMock,
		);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		const target = doc.querySelector('[data-node-id="node"]') as HTMLElement;
		const tab = doc.querySelector('[role="tab"]') as HTMLButtonElement;
		tab.getBoundingClientRect = () => box();
		const activate = vi.fn(() => {
			(doc.querySelector("#panel") as HTMLElement).hidden = false;
		});
		tab.addEventListener("click", activate);
		const unsafe = vi.fn();
		doc.querySelector("a")?.addEventListener("click", unsafe);
		const scroll = vi.fn();
		target.scrollIntoView = scroll;
		dom.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
		(doc.querySelector(".prx-review-show") as HTMLButtonElement).click();
		await vi.waitFor(() => expect(doc.activeElement).toBe(target));
		expect((doc.querySelector("details") as HTMLDetailsElement).open).toBe(true);
		expect(activate).toHaveBeenCalledTimes(1);
		expect(unsafe).not.toHaveBeenCalled();
		expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
		expect(target.getAttribute("tabindex")).toBe("-1");
		tab.focus();
		expect(target.hasAttribute("tabindex")).toBe(false);
	});
	it.each(["en", "fr"])(
		"names %s markers and visibly matches their thread numbers",
		async (locale) => {
			const a = {
				...pageAnchor,
				nodeId: "a",
				context: { pageTitle: "Page title", targetLabel: "Target" },
			};
			const b = { ...pageAnchor, nodeId: "b" };
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					response({ ok: true, threads: [thread(a, "a"), thread(b, "b")], nextCursor: null }),
				);
			const { doc } = await open(
				'<p data-node-id="a">Target</p><p data-node-id="b">Other</p>',
				fetchMock,
				{ ...settings, locale },
			);
			await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-marker")).toHaveLength(2));
			expect(
				[...doc.querySelectorAll(".prx-review-marker")].map((el) => el.getAttribute("aria-label")),
			).toEqual(
				locale === "fr"
					? ["Commentaire 1\u202f: Target", "Commentaire 2"]
					: ["Comment 1: Target", "Comment 2"],
			);
			expect(
				[...doc.querySelectorAll(".prx-review-thread-number")].map((el) => el.textContent),
			).toEqual(["1", "2"]);
		},
	);
});

it("does not activate a concealed reveal control", async () => {
	const anchor = { ...pageAnchor, nodeId: "node", tab: "panel" };
	const fetchMock = vi
		.fn()
		.mockResolvedValue(response({ ok: true, threads: [thread(anchor)], nextCursor: null }));
	const { doc } = await open(
		'<button role="tab" aria-controls="panel" style="visibility:hidden">Tab</button><div id="panel" role="tabpanel" hidden><p data-node-id="node">Target</p></div>',
		fetchMock,
	);
	await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
	const tab = doc.querySelector('[role="tab"]') as HTMLElement;
	tab.getBoundingClientRect = () => box();
	const activate = vi.fn(() => {
		(doc.querySelector("#panel") as HTMLElement).hidden = false;
	});
	tab.addEventListener("click", activate);
	(doc.querySelector(".prx-review-show") as HTMLButtonElement).click();
	expect(activate).not.toHaveBeenCalled();
	expect((doc.querySelector("#panel") as HTMLElement).hidden).toBe(true);
});

describe("local transport at the fetch seam", () => {
	it("refuses unmapped page context instead of inventing a null page ID", async () => {
		const { doc, fetchMock } = await open("", undefined, {
			...settings,
			page: { lessonId: null, pageId: null, pageIds: null, pageIndex: null, revision: null },
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
			"Comments could not be loaded.",
		);
		expect((doc.querySelector(".prx-review-submit") as HTMLButtonElement).disabled).toBe(true);
	});
	it.each([false, true])(
		"retries the original lost-ack snapshot after heading change (navigate=%s)",
		async (navigate) => {
			let state: ReviewState = {
				schema: 1,
				reviewId,
				course: { namespace: null, bound: false },
				changeSeq: 0,
				threads: [],
				receipts: [],
			};
			let posts = 0;
			const fetchMock = vi.fn().mockImplementation(async (url, options) => {
				if (options?.method !== "POST")
					return response({
						ok: true,
						threads: state.threads,
						nextCursor: null,
					});
				const result = await createThread(
					state,
					{
						id: "reviewer",
						displayName: "Reviewer",
						role: "reviewer",
						provenance: "local-preview",
					},
					JSON.parse(options.body),
					{ now: () => "2026-10-19T00:00:00.000Z", uuid: () => crypto.randomUUID() },
				);
				if (!result.ok) throw new Error(result.code);
				state = result.state;
				if (++posts === 1) throw new TypeError("Acknowledgement lost");
				return response({ ok: true, thread: result.thread });
			});
			const { doc, dom } = await open("", fetchMock);
			openPageComposer(doc);
			await vi.waitFor(() =>
				expect((doc.querySelector(".prx-review-submit") as HTMLButtonElement).disabled).toBe(false),
			);
			(doc.querySelector(".prx-review-composer textarea") as HTMLTextAreaElement).value =
				"Same draft";
			const form = doc.querySelector(".prx-review-composer form") as HTMLFormElement;
			form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
			await vi.waitFor(() =>
				expect(doc.querySelector(".prx-review-error")?.textContent).toBe(
					"Comment could not be posted.",
				),
			);
			(doc.querySelector("h1") as Element).textContent = "Changed title";
			if (navigate) {
				dom.window.dispatchEvent(
					new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: "other" } }),
				);
				await vi.waitFor(() =>
					expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`${settings.endpoint}/comments`),
				);
				dom.window.dispatchEvent(
					new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: "page" } }),
				);
				await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
			}
			if (navigate) (doc.querySelector(".prx-review-retry-outbox") as HTMLButtonElement).click();
			form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
			await vi.waitFor(() =>
				expect(doc.querySelector(".prx-review-status")?.textContent).toBe("Comment saved."),
			);
			expect(state.threads).toHaveLength(1);
			expect(state.threads[0].anchor).toEqual(pageAnchor);
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1);
			const requests = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
			expect(requests[1][1].body).toBe(requests[0][1].body);
		},
	);
	it("keeps newer drafts and ignores saved-thread responses after page navigation", async () => {
		let acknowledge!: (value: Response) => void;
		const fetchMock = vi.fn().mockImplementation((_url, options) =>
			options?.method === "POST"
				? new Promise<Response>((resolve) => {
						acknowledge = resolve;
					})
				: Promise.resolve(response({ ok: true, threads: [], nextCursor: null })),
		);
		const { doc, dom } = await open("", fetchMock);
		openPageComposer(doc);
		const input = doc.querySelector(".prx-review-composer textarea") as HTMLTextAreaElement;
		await vi.waitFor(() =>
			expect((doc.querySelector(".prx-review-submit") as HTMLButtonElement).disabled).toBe(false),
		);
		input.value = "Submitted draft";
		doc
			.querySelector(".prx-review-composer form")
			?.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
		expect(input.readOnly).toBe(true);
		dom.window.dispatchEvent(
			new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: "other" } }),
		);
		openPageComposer(doc);
		input.value = "Newer draft";
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
		acknowledge(response({ ok: true, thread: thread(pageAnchor) }));
		await vi.waitFor(() =>
			expect((doc.querySelector(".prx-review-submit") as HTMLButtonElement).disabled).toBe(false),
		);
		expect(input.value).toBe("Newer draft");
		expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(0);
		expect(
			fetchMock.mock.calls.filter(([, options]) => options?.method !== "POST").map(([url]) => url),
		).toEqual([`${settings.endpoint}/comments`, `${settings.endpoint}/comments`]);
	});
	it("reads only the inert JSON script even when an earlier element uses its ID", async () => {
		const { doc, dom } = await open("", undefined, settings, (dom) => {
			const impostor = dom.window.document.createElement("div");
			impostor.id = "praxity-review-config";
			impostor.textContent = '{"schema":999}';
			dom.window.document.head.prepend(impostor);
		});
		expect((dom.window as unknown as { PraxityReview: ReviewClient }).PraxityReview.page()).toEqual(
			pageAnchor,
		);
		expect(doc.querySelector('script[type="application/json"]#praxity-review-config')).toBeNull();
		expect(doc.querySelector("div#praxity-review-config")?.textContent).toBe('{"schema":999}');
	});
	it.each([
		[
			401,
			"unauthorized",
			"Review access expired. Reopen the review in Studio.",
			"Accès à la révision expiré. Rouvrez la révision dans Studio.",
		],
		[403, "forbidden", "This action is not permitted.", "Cette action n’est pas autorisée."],
		[404, "not_found", "Review or comment not found.", "Révision ou commentaire introuvable."],
		[
			422,
			"invalid_input",
			"The comment or its target is invalid.",
			"Le commentaire ou sa cible n’est pas valide.",
		],
		[
			409,
			"limit_reached",
			"This review has reached its comment limit.",
			"La limite de commentaires de cette révision est atteinte.",
		],
	] as const)("maps %i %s in English and French", async (status, code, en, fr) => {
		for (const [locale, expected] of [
			["en", en],
			["fr", fr],
		]) {
			const fetchMock = vi
				.fn()
				.mockImplementation(() => Promise.resolve(response({ ok: false, code }, status)));
			const { doc } = await open("", fetchMock, { ...settings, locale });
			await vi.waitFor(() =>
				expect(doc.querySelector(".prx-review-status")?.textContent).toBe(expected),
			);
		}
	});
	it("paginates and discards old snapshot pages before a bounded restart", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response({ ok: true, threads: [thread(pageAnchor, "old")], nextCursor: "cursor" }),
			)
			.mockResolvedValueOnce(response({ ok: false, code: "snapshot_changed" }, 409))
			.mockResolvedValueOnce(
				response({ ok: true, threads: [thread(pageAnchor, "new")], nextCursor: "next" }),
			)
			.mockResolvedValueOnce(
				response({ ok: true, threads: [thread(pageAnchor, "last")], nextCursor: null }),
			);
		const { doc, dom } = await open("", fetchMock);
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(2));
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			`${settings.endpoint}/comments`,
			`${settings.endpoint}/comments?cursor=cursor`,
			`${settings.endpoint}/comments`,
			`${settings.endpoint}/comments?cursor=next`,
		]);
		for (const [url, options] of fetchMock.mock.calls) {
			expect(url).not.toContain(capability);
			expect(options).toMatchObject({
				cache: "no-store",
				redirect: "error",
				headers: { "X-Praxity-Review": capability },
			});
		}
		expect(dom.window.localStorage.length + dom.window.sessionStorage.length).toBe(0);
		expect(doc.body.textContent).not.toContain(capability);
	});
	it("reuses a request ID after a lost create response and renders only server-owned principal data", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ ok: true, threads: [], nextCursor: null }))
			.mockRejectedValueOnce(new TypeError("lost response"))
			.mockResolvedValueOnce(response({ ok: true, thread: thread(pageAnchor) }));
		const { doc, dom } = await open("", fetchMock);
		openPageComposer(doc);
		const input = doc.querySelector(".prx-review-composer textarea") as HTMLTextAreaElement;
		const form = doc.querySelector(".prx-review-composer form") as HTMLFormElement;
		await vi.waitFor(() =>
			expect((doc.querySelector(".prx-review-submit") as HTMLButtonElement).disabled).toBe(false),
		);
		input.value = "Comment body";
		form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-error")?.textContent).toBe(
				"Comment could not be posted.",
			),
		);
		form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(1));
		const first = JSON.parse(fetchMock.mock.calls[1][1].body);
		expect(first).toEqual({
			reviewId,
			requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
			anchor: pageAnchor,
			body: "Comment body",
		});
		expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
		expect(fetchMock.mock.calls[1][1].headers).toEqual({
			"X-Praxity-Review": capability,
			"Content-Type": "application/json",
		});
		expect(doc.querySelector("#prx-review-name")).toBeNull();
		expect(doc.querySelector(".prx-review-comment")?.textContent).toContain("Local user");
		expect(doc.querySelector(".prx-review-comment b")).toBeNull();
	});
	it("retries busy once after Retry-After and reports the second refusal", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(response({ ok: false, code: "busy" }, 503, { "Retry-After": "0" })),
			);
		const { doc } = await open("", fetchMock);
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
				"The review is busy. Try again.",
			),
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
	it.each([2, "1"])(
		"refuses unsupported schema %s without sending a capability",
		async (schema) => {
			const { doc, fetchMock } = await open("", undefined, { ...settings, schema });
			expect(fetchMock).not.toHaveBeenCalled();
			expect(doc.querySelector("#praxity-review-config")).toBeNull();
			expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
				"Comments could not be loaded.",
			);
		},
	);
	it("stops repeated snapshot restarts", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(response({ ok: false, code: "snapshot_changed" }, 409)),
			);
		const { doc } = await open("", fetchMock);
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-status")?.textContent).toBe(
				"The review changed. Reload the comments.",
			),
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
