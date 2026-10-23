// @vitest-environment jsdom
import { readLesson as readSource } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { bindDeckControls } from "../../template/src/components/deck-control-activation";
import { mountDeckNarration } from "../../template/src/islands/deck-narration";
import { initDeck } from "../../template/src/islands/island-deck";
import { renderIsland } from "../../template/src/islands/utils";
import {
	exerciseHighlightPrivacy,
	highlightPrivacyChoice,
	highlightPrivacyMarkup,
} from "../../tests/fixtures/highlight-privacy";
import { moduleDeckFixture } from "../../tests/fixtures/module-deck";
import { type DeckPage, deckPageData } from "../module-deck";
import { enhanceHighlight } from "../patterns/highlight/enhance";

vi.mock("../../template/src/islands/deck-narration", () => ({ mountDeckNarration: vi.fn() }));

let cleanup: (() => void) | undefined;
let drawerMedia: EventTarget & { matches: boolean };
let shellSize: EventTarget & { width: number };
beforeEach(() => {
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		writable: true,
		value: vi.fn(),
	});
	drawerMedia = Object.assign(new EventTarget(), { matches: false });
	shellSize = Object.assign(new EventTarget(), { width: 1024 });
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
		width: shellSize.width,
		height: 600,
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: shellSize.width,
		bottom: 600,
		toJSON: () => ({}),
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			private listeners = new Map<Element, () => void>();
			constructor(private callback: ResizeObserverCallback) {}
			observe(element: Element) {
				const listener = () =>
					this.callback(
						[
							{
								target: element,
								contentRect: element.getBoundingClientRect(),
							} as ResizeObserverEntry,
						],
						this as unknown as ResizeObserver,
					);
				this.listeners.set(element, listener);
				shellSize.addEventListener("resize", listener);
			}
			disconnect() {
				for (const listener of this.listeners.values())
					shellSize.removeEventListener("resize", listener);
				this.listeners.clear();
			}
		},
	);
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) =>
			query === "print" ? Object.assign(new EventTarget(), { matches: false }) : drawerMedia,
		),
	);
	history.replaceState(null, "", "/");
	vi.mocked(mountDeckNarration).mockReturnValue({
		selectSegment: vi.fn(() => true),
		pause: vi.fn(),
		togglePlayback: vi.fn(() => true),
		setFollow: vi.fn(),
		resumeFollow: vi.fn(),
		destroy: vi.fn(),
	});
});

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	vi.clearAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.clear();
	sessionStorage.clear();
	delete window.__praxityRuntime;
	delete window.__praxityTracker;
	delete window.__praxityResume;
	delete window.__PRAXITY_STRINGS__;
	delete window.__praxityNavigatePageHref;
	delete window.__praxityDecoratePageHref;
	document.body.replaceChildren();
});

it("keeps the readable baseline until the learner host is ready", () => {
	document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ deckPages: [{ id: "slide-1" }], sourceLocale: "en" })}</script><div class="praxity-deck"><article data-deck-slide="slide-1">Full script remains readable.</article></div>`;
	expect(initDeck()).toBeUndefined();
	expect(document.querySelector("article")?.hasAttribute("hidden")).toBe(false);
	expect(document.querySelector(".praxity-deck")?.hasAttribute("data-ready")).toBe(false);
});

it("preserves authored silence without labelling missing audio as silent", () => {
	const page = { id: "slide", title: "Slide", blocks: [], narrationEnabled: true };
	const compile = (changes: Partial<typeof page> & { data?: Record<string, unknown> }) =>
		deckPageData({ ...page, ...changes }, {}, "slide", "module", "en");
	expect(compile({}).narrationSilent).toBe(false);
	expect(compile({ narrationEnabled: false }).narrationSilent).toBe(true);
	expect(compile({ data: { narrationDisabled: true } }).narrationSilent).toBe(true);
	expect(compile({ data: { narration: "" } }).narrationSilent).toBe(true);
});

function setup(audio = true, localCount = 3) {
	const pages: DeckPage[] = [1, 2, 3].map((index) => ({
		id: `slide-${index}`,
		title: `Slide ${index}`,
		lessonTitle: undefined,
		slug: `slide-${index}`,
		moduleSlug: index === 3 ? "second-module" : "first-module",
		sequentialLessons: false,
		gates: index === 1 ? [{ id: "check", rule: "pass" as const }] : [],
		stop: false,
		narrationSilent: false,
		segments: [
			{
				id: `slide-${index}:title`,
				kind: "pageTitle",
				script: `Passage ${index}`,
				src: audio ? `audio/${index}.mp3` : undefined,
				timings: undefined,
				duration: undefined,
				blockId: undefined,
				pauseAfter: false,
			},
		],
	}));
	// These journeys exercise an author who explicitly opts into automatic advancement.
	document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ courseId: "deck-course", deckPages: pages, sourceLocale: "en", deckDesign: { autoAdvance: true } })}</script>
	<div class="praxity-deck"><nav id="deck-controls"></nav><span id="deck-advance-status"></span><div class="deck-workspace"><div id="deck-more-below" hidden></div><main id="main-content"><div id="deck-slides">${pages
		.slice(0, localCount)
		.map((page) => `<article data-deck-slide="${page.id}">${page.title}</article>`)
		.join(
			"",
		)}</div><section id="deck-completion" hidden><h1 tabindex="-1">Module complete</h1><p id="deck-completion-time"></p><p id="deck-completion-score" hidden></p><button id="deck-review">Review module</button></section></main></div>
	<aside id="deck-outline-sidebar"><button id="deck-outline-close">Close</button><h2 id="deck-outline-title" tabindex="-1">Outline</h2><nav id="deck-outline">${pages.map((page) => `<a data-deck-page="${page.id}" href="${page.moduleSlug}.html#${page.id}">${page.title}</a>`).join("")}</nav></aside>
	<aside id="deck-sidebar"><button id="deck-sidebar-close">Close</button><section id="deck-script"><h2 id="deck-script-title" tabindex="-1">Script</h2><div data-deck-enhanced hidden><button id="deck-follow" aria-pressed="true">Follow narration</button></div><div id="deck-resume-follow-row" hidden><button id="deck-resume-follow">Resume following</button></div><span id="deck-follow-status" role="status"></span><div id="deck-script-scroll" tabindex="0">${pages.map((page) => `<section data-deck-reading="${page.id}"><p data-deck-segment="${page.segments[0].id}" data-block-id="${page.segments[0].id}">${page.title}</p></section>`).join("")}</div></section></aside><button id="deck-script-toggle">Script</button><button id="deck-outline-toggle">Outline</button>
	<span id="deck-more-position"></span><div id="deck-more-playback"></div><div id="deck-narration"></div><p id="deck-status"></p><p id="deck-position"></p><span id="deck-position-label"></span><span id="deck-announcement"></span>
	<div><button id="deck-advance" role="switch" aria-checked="true">Auto-advance</button></div><button id="deck-previous">Previous</button><button id="deck-next">Next</button></div>`;
	const runtime = {
		getSuspendData: vi.fn(() => "{}"),
		getVisitedPages: vi.fn((): string[] => []),
		getInteractions: vi.fn((): Array<{ id: string; correct: boolean }> => []),
		getBookmark: vi.fn(() => ""),
		setSuspendData: vi.fn(),
		commit: vi.fn(() => true),
	};
	const tracker = { trackPageVisit: vi.fn() };
	Object.assign(window, {
		__praxityRuntime: runtime,
		__praxityTracker: tracker,
		__PRAXITY_STRINGS__: {
			deckResumeAnnouncement: "Resumed at slide {current} of {total}: {title}",
			deckResumePositionPrefix: "Resumed at slide {current} of {total}: ",
		},
	});
	return { runtime, tracker, pages };
}

it.each(["provider", "pagehide"] as const)("%s revokes an old deck layout frame", (boundary) => {
	setup(false);
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	let epoch = 0;
	Object.assign(window, {
		__praxitySelfCheckDocument: { consumers: { epoch: () => epoch, read: () => undefined } },
	});
	try {
		cleanup = initDeck();
		if (boundary === "provider") {
			epoch++;
			document.dispatchEvent(new Event("praxity:self-check-owner"));
		} else window.dispatchEvent(new Event("pagehide"));
		const root = document.querySelector<HTMLElement>(".praxity-deck");
		assert(root);
		root.style.setProperty("--deck-footer-height", "123px");
		frames.forEach((frame) => frame(0));
		expect(root.style.getPropertyValue("--deck-footer-height")).toBe("123px");
		expect(cancel).toHaveBeenCalledWith(1);
	} finally {
		Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
	}
});

it("hides completion playback and ignores Space until Review module", () => {
	const { runtime } = setup();
	Object.assign(window.__PRAXITY_STRINGS__!, { courseTimeSpent: "Time spent: {duration}" });
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	cleanup = initDeck();
	const next = document.getElementById("deck-next")!;
	for (let i = 0; i < 3; i++) next.click();
	expect(document.getElementById("deck-completion")?.hidden).toBe(false);
	expect(document.getElementById("deck-narration")?.hidden).toBe(true);
	expect(document.getElementById("deck-more-playback")?.hidden).toBe(true);
	document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
	expect(vi.mocked(mountDeckNarration).mock.results[0].value.togglePlayback).not.toHaveBeenCalled();
	document.getElementById("deck-review")?.click();
	expect(document.getElementById("deck-narration")?.hidden).toBe(false);
});

it.each([undefined, "index.html", "../overview/?a=1&b=2", "https://example.org/course/"])(
	"returns from Guided completion to %s through the host navigation seam",
	(courseHomeUrl) => {
		const { runtime } = setup(false);
		assert(window.__PRAXITY_STRINGS__);
		Object.assign(window.__PRAXITY_STRINGS__, { courseTimeSpent: "Time spent: {duration}" });
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
		document.querySelector('[data-deck-slide="slide-1"]')?.remove();
		document.querySelector('[data-deck-slide="slide-2"]')?.remove();
		history.replaceState(null, "", "/second-module.html#slide-3");
		const root = document.querySelector<HTMLElement>(".praxity-deck");
		assert(root);
		if (courseHomeUrl) root.dataset.praxityCourseHome = courseHomeUrl;
		window.__praxityDecoratePageHref = vi.fn((href) => `${href}#decorated`);
		window.__praxityNavigatePageHref = vi.fn(() => true);
		cleanup = initDeck();
		const next = document.getElementById("deck-next");
		assert(next);
		next.click();
		expect(document.getElementById("deck-completion")?.hidden).toBe(false);
		expect(next.getAttribute("aria-label")).toBe("Back to course");
		next.click();
		const expected = courseHomeUrl ?? "index.html";
		expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith(
			courseHomeUrl ?? `${expected}#decorated`,
		);
		expect(window.__praxityDecoratePageHref).toHaveBeenCalledTimes(courseHomeUrl ? 0 : 1);
	},
);

it.each([null, "0"])(
	"restores heading tabindex %s and its classes on blur, departure and disposal",
	(tabindex) => {
		const { runtime } = setup(false);
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		const slide = document.querySelector('[data-deck-slide="slide-2"]');
		assert(slide);
		const heading = document.createElement("h1");
		heading.textContent = "Slide 2";
		heading.className = "authored-heading";
		if (tabindex !== null) heading.setAttribute("tabindex", tabindex);
		slide.prepend(heading);
		cleanup = initDeck();
		const next = document.getElementById("deck-next");
		assert(next);
		next.click();
		expect(document.activeElement).toBe(heading);
		expect(heading.getAttribute("tabindex")).toBe("-1");
		document.getElementById("deck-previous")?.focus();
		expect(heading.getAttribute("tabindex")).toBe(tabindex);
		expect(heading.className).toBe("authored-heading");
		document.getElementById("deck-previous")?.click();
		next.click();
		// History departure need not focus another control or deliver blur.
		history.replaceState(null, "", "#slide-1");
		window.dispatchEvent(new PopStateEvent("popstate"));
		expect(heading.getAttribute("tabindex")).toBe(tabindex);
		expect(heading.className).toBe("authored-heading");
		next.click();
		cleanup?.();
		cleanup = undefined;
		expect(heading.getAttribute("tabindex")).toBe(tabindex);
		expect(heading.className).toBe("authored-heading");
	},
);

it("preserves an authored navigation focus class after heading departure", () => {
	const { runtime } = setup(false);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const slide = document.querySelector('[data-deck-slide="slide-2"]');
	assert(slide);
	slide.insertAdjacentHTML(
		"afterbegin",
		'<h1 class="praxity-navigation-focus" tabindex="0">Slide 2</h1>',
	);
	cleanup = initDeck();
	document.getElementById("deck-next")?.click();
	document.getElementById("deck-previous")?.click();
	expect(slide.querySelector("h1")?.getAttribute("tabindex")).toBe("0");
	expect(slide.querySelector("h1")?.className).toBe("praxity-navigation-focus");
});

it.each(["seek", "play", "advance"] as const)(
	"narration %s keeps focus on its transport while updating the slide title",
	(reason) => {
		const { runtime } = setup();
		runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2", "slide-3"]);
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		cleanup = initDeck();
		const transport = document.createElement("input");
		transport.type = "range";
		document.getElementById("deck-narration")?.append(transport);
		transport.focus();
		const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
		expect(options.beforeSelect?.(1, reason)).toBe(true);
		expect(document.title).toBe("Slide 2");
		expect(document.activeElement).toBe(transport);
	},
);

it.each(["popstate", "hashchange"])(
	"%s restores the slide and title without taking transport focus",
	(event) => {
		const { runtime } = setup();
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		cleanup = initDeck();
		const transport = document.createElement("input");
		transport.type = "range";
		document.getElementById("deck-narration")?.append(transport);
		transport.focus();
		history.replaceState(null, "", "#slide-2");
		window.dispatchEvent(new Event(event));
		expect(document.title).toBe("Slide 2");
		expect(document.activeElement).toBe(transport);
	},
);

it.each([
	["en", "Visited"],
	["fr", "Consultée"],
])(
	"announces recorded outline visits in %s without changing activity labels or locks",
	(locale, visitedLabel) => {
		const { runtime } = setup(false, 2);
		const script = document.querySelector("#praxity-config");
		if (!script) throw new Error("Missing course configuration");
		const config = JSON.parse(script.textContent ?? "{}");
		config.sourceLocale = locale;
		script.textContent = JSON.stringify(config);
		runtime.getVisitedPages.mockReturnValue(["slide-1"]);
		const visited = document.querySelector('[data-deck-page="slide-1"]');
		const locked = document.querySelector('[data-deck-page="slide-2"]');
		visited?.setAttribute("aria-label", "Slide 1, Assessment");
		cleanup = initDeck();
		expect(visited?.getAttribute("aria-label")).toBe(`Slide 1, Assessment, ${visitedLabel}`);
		expect(visited?.getAttribute("data-visited")).toBe("true");
		expect(visited?.getAttribute("aria-current")).toBe("page");
		expect(locked?.getAttribute("aria-label")).toBe(
			locale === "fr" ? "Slide 2, Verrouillé" : "Slide 2, Locked",
		);
		expect(locked?.getAttribute("data-visited")).toBe("false");
		// Repeated rendering must not append the state twice.
		document.querySelector<HTMLButtonElement>("#deck-outline-toggle")?.click();
		expect(visited?.getAttribute("aria-label")).toBe(`Slide 1, Assessment, ${visitedLabel}`);
	},
);

it("removes the restored cue when Finish module leaves the resumed slide", () => {
	const { runtime } = setup(false, 2);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	runtime.getBookmark.mockReturnValue("slide-2");
	window.__praxityResume = { pageId: "slide-2" };
	const strings = window.__PRAXITY_STRINGS__;
	assert(strings);
	Object.assign(strings, { courseTimeSpent: "Time spent: {duration}" });
	cleanup = initDeck();
	expect(document.querySelectorAll(".praxity-resume-prefix,.praxity-resume-summary")).toHaveLength(
		1,
	);
	document.getElementById("deck-next")?.click();
	expect(document.getElementById("deck-completion")?.hidden).toBe(false);
	expect(document.querySelectorAll(".praxity-resume-prefix,.praxity-resume-summary")).toHaveLength(
		0,
	);
	document.getElementById("deck-review")?.click();
	expect(document.querySelectorAll(".praxity-resume-prefix,.praxity-resume-summary")).toHaveLength(
		0,
	);
});

it("orients the confirmed resumed slide once with active content focus and paused narration", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	runtime.getBookmark.mockReturnValue("slide-2");
	Object.assign(window, {
		__praxityResume: { pageId: "slide-2" },
		__PRAXITY_STRINGS__: {
			deckResumeAnnouncement: "Resumed at slide {current} of {total}: {title}",
			deckResumePositionPrefix: "Resumed at slide {current} of {total}: ",
		},
	});
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-2");
	expect(document.activeElement).toBe(
		document.querySelector('[data-deck-slide="slide-2"] > .praxity-resume-summary'),
	);
	expect(document.activeElement?.textContent).toBe("Resumed at slide 2 of 3: Slide 2");
	expect(document.getElementById("deck-announcement")?.textContent).toBe("");
	expect(vi.mocked(mountDeckNarration).mock.results[0].value.togglePlayback).not.toHaveBeenCalled();
	expect(initDeck()).toBeUndefined();
});

it("focuses visible slide content when the resumed slide's first heading is hidden", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	const slide = document.querySelector('[data-deck-slide="slide-2"]');
	assert(slide);
	slide.innerHTML = "<div hidden><h1>Hidden heading</h1></div><h2>Visible content</h2>";
	window.__praxityResume = { pageId: "slide-2" };
	cleanup = initDeck();
	expect(document.activeElement).toBe(slide.querySelector(".praxity-resume-summary"));
	expect(document.activeElement?.textContent).toBe("Resumed at slide 2 of 3: Slide 2");
	expect(slide.querySelector("h2")?.textContent).toBe("Visible content");
});

it("orients an allowed gate instead of the denied resumed destination", () => {
	setup(false);
	window.__praxityResume = { pageId: "slide-2" };
	window.__PRAXITY_STRINGS__ = {
		deckResumeAnnouncement: "Resumed at slide {current} of {total}: {title}",
		deckResumePositionPrefix: "Resumed at slide {current} of {total}: ",
	};
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-1");
	expect(document.activeElement).toBe(
		document.querySelector('[data-deck-slide="slide-1"] > .praxity-resume-summary'),
	);
	expect(document.activeElement?.textContent).toBe("Resumed at slide 1 of 3: Slide 1");
	expect(document.getElementById("deck-announcement")?.textContent).toBe("");
});

it("keeps unconfirmed bookmarks silent and starts at the module entry", () => {
	const { runtime } = setup(false);
	runtime.getBookmark.mockReturnValue("slide-2");
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-1");
	expect(document.getElementById("deck-announcement")?.textContent).toBe("");
	expect(document.activeElement).toBe(document.body);
});

it("resumes with one visible panel focus while honoring a stored replacing panel choice", () => {
	const { runtime } = setup(false);
	drawerMedia.matches = true;
	localStorage.setItem("praxity:deck-panel:deck-course", "script");
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	window.__praxityResume = { pageId: "slide-2" };
	const focuses: string[] = [];
	const controller = new AbortController();
	document.addEventListener("focusin", (event) => focuses.push((event.target as HTMLElement).id), {
		signal: controller.signal,
	});
	cleanup = initDeck();
	controller.abort();
	expect(document.getElementById("main-content")?.inert).toBe(true);
	expect(document.querySelector<HTMLElement>(".praxity-deck")?.dataset.panel).toBe("script");
	expect(document.activeElement).toBe(
		document.querySelector("#deck-script > .praxity-resume-summary"),
	);
	expect(document.activeElement?.textContent).toBe("Resumed at slide 2 of 3: Slide 2");
	expect(focuses).toEqual([""]);
	expect(document.querySelector<HTMLElement>('[data-deck-reading="slide-2"]')?.hidden).toBe(false);
	expect(localStorage.getItem("praxity:deck-panel:deck-course")).toBe("script");
});

it.each([false, true])(
	"recovers keyboard focus when leaving a resumed summary, panel %s",
	(panel) => {
		const { runtime } = setup(false);
		runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		if (panel) {
			drawerMedia.matches = true;
			localStorage.setItem("praxity:deck-panel:deck-course", "script");
		}
		window.__praxityResume = { pageId: "slide-2" };
		cleanup = initDeck();
		const summary = document.activeElement;
		expect(summary?.classList.contains("praxity-resume-summary")).toBe(true);
		summary?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(location.hash).toBe("#slide-3");
		expect(document.querySelector(".praxity-resume-summary")).toBeNull();
		expect(document.activeElement).toBe(document.getElementById("main-content"));
		expect(document.getElementById("deck-announcement")?.textContent).toBe("Slide 3 of 3: Slide 3");
	},
);

it("removes the Guided cue on module departure before browser history can restore it", () => {
	const { runtime } = setup(false, 2);
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	window.__praxityResume = { pageId: "slide-2" };
	cleanup = initDeck();
	expect(document.querySelector(".praxity-resume-summary")?.textContent).toBe(
		"Resumed at slide 2 of 2: Slide 2",
	);
	window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
	expect(document.querySelector(".praxity-resume-summary,.praxity-resume-prefix")).toBeNull();
	expect(document.querySelector('[data-deck-slide="slide-2"]')?.textContent).toBe("Slide 2");
});

it("keeps ordinary stored-panel focus for a deep link that differs from the resume bookmark", () => {
	const { runtime } = setup(false);
	drawerMedia.matches = true;
	localStorage.setItem("praxity:deck-panel:deck-course", "script");
	runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	window.__praxityResume = { pageId: "slide-3" };
	history.replaceState(null, "", "/#slide-2");
	cleanup = initDeck();
	expect(document.activeElement).toBe(document.getElementById("deck-script-title"));
	expect(location.hash).toBe("#slide-2");
	expect(document.getElementById("deck-announcement")?.textContent).toBe("");
});

it("keeps an unrelated cross-module gate redirect outside resume orientation", () => {
	setup(false);
	document.querySelector('[data-deck-slide="slide-1"]')?.remove();
	document.querySelector('[data-deck-slide="slide-2"]')?.remove();
	history.replaceState(null, "", "/second-module.html#slide-3");
	window.__praxityResume = { pageId: "slide-2" };
	window.__praxityNavigatePageHref = vi.fn(() => true);
	cleanup = initDeck();
	expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith(
		"first-module.html?praxity-deck-redirect=gate#slide-1",
	);
});

it.each([2, 3])("recovers navigation focus at both boundaries of a %i-slide deck", (count) => {
	const { pages } = setup(false);
	const config = document.getElementById("praxity-config");
	assert(config);
	config.textContent = JSON.stringify({ deckPages: pages.slice(0, count), sourceLocale: "en" });
	cleanup = initDeck();
	const previous = document.getElementById("deck-previous") as HTMLButtonElement;
	const next = document.getElementById("deck-next") as HTMLButtonElement;
	next.focus();
	next.click();
	expect(location.hash).toBe("#slide-1");
	expect(document.activeElement).toBe(next);
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", {
			detail: { blockId: "check", correct: true },
		}),
	);
	expect(document.activeElement).toBe(next);
	for (let index = 1; index < count; index++) {
		next.click();
		expect(document.activeElement).toBe(document.getElementById("main-content"));
	}
	expect(next.disabled).toBe(false);
	expect(previous.disabled).toBe(false);
	expect(location.hash).toBe(`#slide-${count}`);
	expect(document.getElementById("deck-announcement")?.textContent).toBe(
		`Slide ${count} of ${count}: Slide ${count}`,
	);
	previous.focus();
	for (let index = count - 2; index >= 0; index--) {
		previous.click();
		expect(document.activeElement).toBe(document.getElementById("main-content"));
	}
	expect(previous.disabled).toBe(true);
	expect(next.disabled).toBe(false);
	expect(location.hash).toBe("#slide-1");
});

it.each(["previous", "next"])("keeps %s focus on an enabled one-slide action", (control) => {
	const { pages } = setup(false);
	pages[0].gates = [];
	const config = document.getElementById("praxity-config");
	assert(config);
	config.textContent = JSON.stringify({ deckPages: pages.slice(0, 1), sourceLocale: "en" });
	document.getElementById(`deck-${control}`)?.focus();
	cleanup = initDeck();
	const slide = document.querySelector('[data-deck-slide="slide-1"]');
	expect(document.activeElement).toBe(document.getElementById("deck-next"));
	expect(slide?.hasAttribute("hidden")).toBe(false);
	expect(slide?.hasAttribute("inert")).toBe(false);
	expect((document.getElementById("deck-previous") as HTMLButtonElement).disabled).toBe(true);
	expect((document.getElementById("deck-next") as HTMLButtonElement).disabled).toBe(false);
	expect(document.getElementById("deck-announcement")?.textContent).toBe("");
});

it("uses the visible panel for one-slide boundary recovery in replacing layout", () => {
	const { pages } = setup(false);
	drawerMedia.matches = true;
	pages[0].gates = [];
	const config = document.getElementById("praxity-config");
	assert(config);
	config.textContent = JSON.stringify({
		courseId: "deck-course",
		deckPages: pages.slice(0, 1),
		sourceLocale: "en",
		deckDesign: { initialPanel: "transcript" },
	});
	localStorage.setItem("praxity:deck-panel:deck-course", "script");
	document.getElementById("deck-next")?.focus();
	cleanup = initDeck();
	expect(document.activeElement).toBe(document.getElementById("deck-script-title"));
	expect(document.getElementById("deck-sidebar")?.hidden).toBe(false);
	expect(document.getElementById("main-content")?.inert).toBe(true);
});

it("keeps automatic transport focus and orients manual outline navigation", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2", "slide-3"]);
	cleanup = initDeck();
	const transport = document.createElement("button");
	document.getElementById("deck-narration")?.append(transport);
	transport.focus();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	expect(options.beforeSelect?.(2, "advance")).toBe(true);
	expect(document.activeElement).toBe(transport);
	expect(document.getElementById("deck-announcement")?.textContent).toBe("Slide 3 of 3: Slide 3");
	document.getElementById("deck-outline-toggle")?.click();
	const first = document.querySelector<HTMLAnchorElement>('[data-deck-page="slide-1"]');
	assert(first);
	first.focus();
	first.click();
	expect(location.hash).toBe("#slide-1");
	expect(document.activeElement).toBe(document.getElementById("main-content"));
});

it.each(["en", "fr"])("explains a gated deep-link redirect in %s", (locale) => {
	setup(false);
	const config = document.getElementById("praxity-config");
	assert(config?.textContent);
	config.textContent = JSON.stringify({ ...JSON.parse(config.textContent), sourceLocale: locale });
	history.replaceState(null, "", "/first-module.html#slide-3");
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-1");
	expect(document.getElementById("deck-status")?.textContent).toBe(
		locale === "fr"
			? "Terminez l’activité requise pour continuer."
			: "Complete the required activity to continue.",
	);
	expect(document.getElementById("deck-status")?.dataset.kind).toBe("gate");
});

it("explains a sequential redirect and opens completed or ungated destinations", () => {
	const { runtime, pages } = setup(false);
	for (const page of pages) page.sequentialLessons = true;
	pages[0].gates = [];
	const config = document.getElementById("praxity-config");
	assert(config);
	config.textContent = JSON.stringify({
		deckPages: pages,
		sourceLocale: "en",
		deckDesign: { sequentialLessons: true },
	});
	history.replaceState(null, "", "/first-module.html#slide-3");
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-1");
	expect(document.getElementById("deck-status")?.textContent).toBe(
		"Continue through the earlier slides to reach this one.",
	);
	expect(document.querySelector<HTMLButtonElement>(".deck-gate-notice")?.hidden).toBe(true);
	cleanup?.();
	runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
	history.replaceState(null, "", "/first-module.html#slide-3");
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-3");
	expect(document.getElementById("deck-status")?.textContent).toBe("");
});

it.each([undefined, false, true])(
	"applies ordering %s to a fresh outline and deep link without weakening gates",
	(sequentialLessons) => {
		const { pages } = setup(false);
		for (const page of pages) page.sequentialLessons = sequentialLessons === true;
		pages[0].gates = [];
		const config = document.getElementById("praxity-config");
		assert(config);
		config.textContent = JSON.stringify({
			deckPages: pages,
			sourceLocale: "en",
			deckDesign: sequentialLessons === undefined ? undefined : { sequentialLessons },
		});
		history.replaceState(null, "", "/first-module.html#slide-3");
		cleanup = initDeck();
		expect(location.hash).toBe(sequentialLessons ? "#slide-1" : "#slide-3");
		expect(document.getElementById("deck-status")?.textContent).toBe(
			sequentialLessons ? "Continue through the earlier slides to reach this one." : "",
		);
		expect(
			document.querySelector('[data-deck-page="slide-3"]')?.getAttribute("aria-disabled"),
		).toBe(String(sequentialLessons === true));
		cleanup?.();
		pages[0].gates = [{ id: "check", rule: "pass" }];
		config.textContent = JSON.stringify({
			...JSON.parse(config.textContent ?? "{}"),
			deckPages: pages,
		});
		history.replaceState(null, "", "/first-module.html#slide-3");
		cleanup = initDeck();
		expect(location.hash).toBe("#slide-1");
		expect(document.getElementById("deck-status")?.textContent).toBe(
			"Complete the required activity to continue.",
		);
		expect(
			document.querySelector('[data-deck-page="slide-3"]')?.getAttribute("aria-disabled"),
		).toBe("true");
	},
);

it("opens an already visited destination after its gate was completed", () => {
	const { runtime } = setup(false);
	runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2", "slide-3"]);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	history.replaceState(null, "", "/second-module.html#slide-3");
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-3");
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-3"]')?.hidden).toBe(false);
	expect(document.getElementById("deck-status")?.textContent).toBe("");
});

it("keeps a pass gate locked during retries, then releases and restores it after a final wrong answer", () => {
	const course = moduleDeckFixture();
	const question = course.content
		.flatMap((page) => page.blocks)
		.find((block) => block.id === "pass-gate");
	assert(question);
	question.data.gradingMode = "exact";
	const certification = course.content.find((page) => page.id === "slide-3");
	assert(certification);
	const gates = deckPageData(
		certification,
		{ gates: { "practice-gate": "attempt" } },
		"intro",
		"module",
		"en",
	).gates;
	expect(gates).toEqual([{ id: "pass-gate", rule: "pass" }]);
	const { runtime } = setup(false);
	const config = document.getElementById("praxity-config");
	assert(config?.textContent);
	const data = JSON.parse(config.textContent);
	data.deckPages[0].gates = gates;
	config.textContent = JSON.stringify(data);
	const slide = document.querySelector<HTMLElement>('[data-deck-slide="slide-1"]');
	assert(slide);
	slide.innerHTML = '<div data-block-id="pass-gate"><h2>Required question</h2></div>';
	cleanup = initDeck();
	const next = document.querySelector('[data-deck-page="slide-2"]');
	const notice = document.querySelector<HTMLButtonElement>(".deck-gate-notice");
	assert(next && notice);
	const submit = (attemptsUsed: number, correct: boolean) =>
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-response", {
				detail: { blockId: "pass-gate", correct, submitted: true, attemptsUsed, maxAttempts: 2 },
			}),
		);
	submit(1, false);
	expect(next.getAttribute("aria-disabled")).toBe("true");
	(document.getElementById("deck-next") as HTMLButtonElement).click();
	expect(document.getElementById("deck-status")?.dataset.kind).toBe("gate");
	expect(notice.hidden).toBe(false);
	expect(notice.textContent).toBe("Go to required activity: Required question");
	submit(2, false);
	expect(next.getAttribute("aria-disabled")).toBe("false");
	expect(document.getElementById("deck-status")?.textContent).toBe("");
	expect(notice.hidden).toBe(true);
	(document.getElementById("deck-next") as HTMLButtonElement).click();
	expect(location.hash).toBe("#slide-2");
	const saved = vi.mocked(runtime.setSuspendData).mock.lastCall?.[0];
	expect(saved).toBe(JSON.stringify({ deck: { released: ["pass-gate"] } }));
	cleanup?.();
	runtime.getSuspendData.mockReturnValue(saved ?? "{}");
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	runtime.getBookmark.mockReturnValue("slide-2");
	history.replaceState(null, "", "/first-module.html");
	window.__praxityResume = { pageId: "slide-2" };
	cleanup = initDeck();
	expect(location.hash).toBe("#slide-2");
	expect(document.querySelector('[data-deck-page="slide-2"]')?.getAttribute("aria-disabled")).toBe(
		"false",
	);
});

it.each([
	["correct", "pass", true, 1, 2],
	["unlimited wrong", "pass", false, 3, Number.POSITIVE_INFINITY],
	["attempt", "attempt", false, 1, 2],
] as const)(
	"handles a %s assessment response",
	(_name, rule, correct, attemptsUsed, maxAttempts) => {
		setup(false);
		const config = document.getElementById("praxity-config");
		assert(config?.textContent);
		const data = JSON.parse(config.textContent);
		data.deckPages[0].gates = [{ id: "check", rule }];
		config.textContent = JSON.stringify(data);
		cleanup = initDeck();
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-response", {
				detail: { blockId: "check", correct, submitted: true, attemptsUsed, maxAttempts },
			}),
		);
		expect(
			document.querySelector('[data-deck-page="slide-2"]')?.getAttribute("aria-disabled"),
		).toBe(rule === "attempt" || correct ? "false" : "true");
	},
);

it("carries a denied deep-link explanation across a module redirect", () => {
	setup(false);
	document.querySelector('[data-deck-slide="slide-1"]')?.remove();
	document.querySelector('[data-deck-slide="slide-2"]')?.remove();
	history.replaceState(null, "", "/second-module.html#slide-3");
	window.__praxityNavigatePageHref = vi.fn(() => true);
	cleanup = initDeck();
	expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith(
		"first-module.html?praxity-deck-redirect=gate#slide-1",
	);
	cleanup?.();
	setup(false, 2);
	history.replaceState(null, "", "/first-module.html?praxity-deck-redirect=gate#slide-1");
	cleanup = initDeck();
	expect(location.search).toBe("");
	expect(document.getElementById("deck-status")?.textContent).toBe(
		"Complete the required activity to continue.",
	);
});

it("routes every player destination through gates and reports logical page changes", () => {
	const { tracker } = setup();
	const changed = vi.fn();
	window.addEventListener("praxity:active-page-change", changed);
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	expect(options.items).toHaveLength(3);
	expect(options.items[1].blockId).toBe("slide-2:title");
	expect(options.beforeSelect?.(1, "seek")).toBe(false);
	expect(tracker.trackPageVisit).toHaveBeenCalledTimes(1);
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", { detail: { blockId: "check", correct: true } }),
	);
	expect(options.beforeSelect?.(1, "seek")).toBe(true);
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(false);
	expect(changed).toHaveBeenLastCalledWith(
		expect.objectContaining({ detail: { pageId: "slide-2" } }),
	);
	const advance = document.getElementById("deck-advance") as HTMLButtonElement;
	advance.click();
	expect(options.beforeSelect?.(2, "advance")).toBe(false);
	expect(options.beforeSelect?.(2, "play")).toBe(true);
	window.removeEventListener("praxity:active-page-change", changed);
});

it("prioritizes the visible image when opening a later slide by fragment", () => {
	const { runtime } = setup(false, 2);
	runtime.getVisitedPages.mockReturnValue(["slide-1"]);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const first = document.querySelector<HTMLElement>('[data-deck-slide="slide-1"]');
	const second = document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]');
	assert(first && second);
	first.innerHTML = '<img src="assets/first.png" loading="eager" fetchpriority="high">';
	second.innerHTML = '<img src="assets/second.png" loading="lazy">';
	history.replaceState(null, "", "/#slide-2");
	cleanup = initDeck();
	expect(first.hidden).toBe(true);
	expect(second.hidden).toBe(false);
	expect(second.querySelector("img")?.getAttribute("loading")).toBe("eager");
	expect(second.querySelector("img")?.getAttribute("fetchpriority")).toBe("high");
});

it("resets cards before slide introductions while preserving resume, focus, and Follow off", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const slide = document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]');
	assert(slide);
	slide.innerHTML = "<div data-card-root><button>Flip</button></div>";
	const card = slide.querySelector<HTMLElement>("[data-card-root]");
	assert(card);
	const reveal = vi.fn();
	card.addEventListener("praxity:narration-reveal", reveal);
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	expect(options.beforeSelect?.(1, "advance", 0)).toBe(true);
	expect(reveal).toHaveBeenCalledOnce();
	expect(reveal.mock.calls[0][0].detail).toEqual({ resetCards: true });
	expect(card.dataset.narrationPendingReset).toBe("true");
	expect(options.beforeSelect?.(1, "play", 2)).toBe(true);
	expect(reveal).toHaveBeenCalledOnce();
	expect(options.beforeSelect?.(1, "seek", 0)).toBe(true);
	expect(reveal).toHaveBeenCalledTimes(2);
	card.querySelector("button")?.focus();
	expect(options.beforeSelect?.(1, "play", 0)).toBe(true);
	expect(reveal).toHaveBeenCalledTimes(2);
	expect(document.activeElement).toBe(card.querySelector("button"));
	(document.activeElement as HTMLElement).blur();
	options.onFollowChange?.(false);
	expect(card.dataset.narrationPendingReset).toBeUndefined();
	expect(options.beforeSelect?.(0, "select", 0)).toBe(true);
	expect(options.beforeSelect?.(1, "advance", 0)).toBe(true);
	expect(reveal).toHaveBeenCalledTimes(2);
});

it.each(["assessment", "assessmentGroup"])(
	"places completion guidance by the unresolved %s without stealing focus",
	(type) => {
		const { pages } = setup();
		pages[0].gates.push({ id: "second-check", rule: "pass" });
		const config = document.getElementById("praxity-config") as HTMLScriptElement;
		config.textContent = JSON.stringify({ deckPages: pages, sourceLocale: "en" });
		const slide = document.querySelector('[data-deck-slide="slide-1"]');
		assert(slide);
		slide.innerHTML = `<div data-block-id="check"><h3>First question</h3></div><div data-block-id="second-check"><h3>Second question</h3></div>`;
		cleanup = initDeck();
		const next = document.getElementById("deck-next") as HTMLButtonElement;
		next.focus();
		next.click();
		const notice = document.querySelector<HTMLButtonElement>(".deck-gate-notice");
		assert(notice);
		expect(notice.nextElementSibling).toBe(document.getElementById("deck-status"));
		expect(notice.textContent).toBe("Go to required activity: First question");
		expect(document.activeElement).toBe(next);
		expect(document.getElementById("deck-status")?.textContent).toBe(
			"Complete the required activity to continue.",
		);
		expect(notice.hasAttribute("aria-live")).toBe(false);
		const firstHeading = slide.querySelector("h3");
		assert(firstHeading);
		firstHeading.scrollIntoView = vi.fn();
		notice.click();
		expect(document.activeElement).toBe(firstHeading);
		expect(firstHeading.scrollIntoView).toHaveBeenCalled();
		const eventName =
			type === "assessment" ? "praxity:assessment-response" : "praxity:assessment-group-complete";
		const complete = (id: string) =>
			document.dispatchEvent(
				new CustomEvent(eventName, {
					detail:
						type === "assessment" ? { blockId: id, correct: true } : { groupId: id, passed: true },
				}),
			);
		complete("check");
		expect(notice.textContent).toBe("Go to required activity: Second question");
		complete("second-check");
		expect(notice.hidden).toBe(true);
		expect(document.getElementById("deck-status")?.textContent).toBe("");
	},
);

it("uses the assessment question for the gate action without its required marker", () => {
	setup();
	const slide = document.querySelector('[data-deck-slide="slide-1"]');
	assert(slide);
	slide.innerHTML = `<div data-block-id="check"><p class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">First <strong>question</strong>?</span><span class="praxity-required-indicator"><span class="praxity-sr-only">Required</span></span></p></div>`;
	cleanup = initDeck();
	(document.getElementById("deck-next") as HTMLButtonElement).click();
	expect(document.querySelector(".deck-gate-notice")?.textContent).toBe(
		"Go to required activity: First question?",
	);
});

it("keeps generic guidance visible when a locked outline target has no current activity", () => {
	const { pages } = setup();
	pages[0].gates = [];
	pages[1].gates = [{ id: "future-check", rule: "pass" }];
	const config = document.getElementById("praxity-config") as HTMLScriptElement;
	config.textContent = JSON.stringify({ deckPages: pages, sourceLocale: "en" });
	cleanup = initDeck();
	(document.querySelector('[data-deck-page="slide-3"]') as HTMLAnchorElement).click();
	expect(document.querySelector<HTMLButtonElement>(".deck-gate-notice")?.hidden).toBe(true);
	expect(document.getElementById("deck-status")?.classList.contains("praxity-a11y-sr-only")).toBe(
		false,
	);
	expect(document.getElementById("deck-status")?.textContent).toContain(
		"Complete the required activity",
	);
});

it.each(["en", "fr"])("preserves outline children and labels as gates unlock in %s", (locale) => {
	setup();
	const config = document.getElementById("praxity-config");
	assert(config);
	config.textContent = JSON.stringify({
		...JSON.parse(config.textContent ?? "{}"),
		sourceLocale: locale,
	});
	const link = document.querySelector<HTMLAnchorElement>('[data-deck-page="slide-2"]');
	assert(link);
	link.setAttribute("aria-label", "Slide 2, Assessment");
	link.innerHTML =
		'<svg aria-hidden="true"><path d="M1 1"/></svg><span>Slide 2</span><span data-deck-lock hidden aria-hidden="true"><svg/></span>';
	const icon = link.querySelector("svg");
	const lock = link.querySelector<HTMLElement>("[data-deck-lock]");
	cleanup = initDeck();
	expect(link.getAttribute("aria-disabled")).toBe("true");
	expect(link.getAttribute("aria-label")).toBe(
		`Slide 2, Assessment, ${locale === "fr" ? "Verrouillé" : "Locked"}`,
	);
	expect(link.textContent).toBe("Slide 2");
	expect(lock?.hidden).toBe(false);
	expect(document.querySelector('[data-deck-page="slide-1"]')?.getAttribute("aria-current")).toBe(
		"page",
	);
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", { detail: { blockId: "check", correct: true } }),
	);
	expect(lock?.hidden).toBe(true);
	expect(link.getAttribute("aria-disabled")).toBe("false");
	expect(link.getAttribute("aria-label")).toBe("Slide 2, Assessment");
	expect(link.querySelector("svg")).toBe(icon);
	link.click();
	expect(link.getAttribute("aria-current")).toBe("page");
	expect(document.querySelector('[data-deck-page="slide-1"]')?.hasAttribute("aria-current")).toBe(
		false,
	);
});

it("keeps the Follow narration toggle synchronized with the player", () => {
	setup();
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	const player = vi.mocked(mountDeckNarration).mock.results[0].value;
	const follow = document.getElementById("deck-follow") as HTMLButtonElement;
	follow.click();
	expect(player.setFollow).toHaveBeenLastCalledWith(false);
	expect(follow.getAttribute("aria-pressed")).toBe("false");
	follow.click();
	expect(player.setFollow).toHaveBeenLastCalledWith(true);
	options.onFollowChange?.(false);
	expect(follow.getAttribute("aria-pressed")).toBe("false");
});

it("keeps mobile tools in one disclosure and restores its trigger after closing a panel", () => {
	setup();
	const root = document.querySelector(".praxity-deck");
	assert(root);
	const more = document.createElement("div");
	more.id = "deck-more";
	const summary = document.createElement("button");
	summary.id = "deck-more-toggle";
	summary.setAttribute("aria-expanded", "true");
	summary.setAttribute("aria-controls", "deck-more-panel");
	summary.textContent = "More course options";
	const items = document.createElement("div");
	items.id = "deck-more-panel";
	const outline = document.getElementById("deck-outline-toggle") as HTMLButtonElement;
	const script = document.getElementById("deck-script-toggle");
	assert(outline && script);
	items.append(outline, script);
	more.append(summary, items);
	root.append(more);
	shellSize.width = 390;
	cleanup = initDeck();
	expect(summary.getAttribute("aria-expanded")).toBe("false");
	summary.click();
	outline.click();
	expect(summary.getAttribute("aria-expanded")).toBe("false");
	expect(document.activeElement).toBe(document.getElementById("deck-outline-title"));
	(document.getElementById("deck-outline-close") as HTMLButtonElement).click();
	expect(summary.getAttribute("aria-expanded")).toBe("true");
	expect(document.activeElement).toBe(outline);
	shellSize.width = 1024;
	shellSize.dispatchEvent(new Event("resize"));
	expect(summary.getAttribute("aria-expanded")).toBe("true");
	shellSize.width = 390;
	shellSize.dispatchEvent(new Event("resize"));
	expect(summary.getAttribute("aria-expanded")).toBe("true");
	expect(document.activeElement).toBe(outline);
});

it("closes mobile More on outside pointer, Escape or focus leaving without a click listener", () => {
	setup();
	const root = document.querySelector(".praxity-deck");
	assert(root);
	const more = document.createElement("div");
	more.id = "deck-more";
	const summary = document.createElement("button");
	summary.id = "deck-more-toggle";
	summary.setAttribute("aria-expanded", "true");
	const items = document.createElement("div");
	items.id = "deck-more-panel";
	const outline = document.getElementById("deck-outline-toggle") as HTMLButtonElement;
	items.append(outline);
	more.append(summary, items);
	root.append(more);
	shellSize.width = 390;
	const listen = vi.spyOn(document, "addEventListener");
	cleanup = initDeck();
	expect(listen.mock.calls.map(([type]) => type)).not.toContain("click");
	listen.mockRestore();
	const pointer = (target: Element) =>
		target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	const open = () => {
		summary.click();
		expect(summary.getAttribute("aria-expanded")).toBe("true");
	};
	open();
	pointer(summary);
	pointer(outline);
	expect(summary.getAttribute("aria-expanded")).toBe("true");
	summary.click();
	expect(summary.getAttribute("aria-expanded")).toBe("false");
	open();
	outline.focus();
	pointer(document.getElementById("deck-next") as HTMLElement);
	expect(summary.getAttribute("aria-expanded")).toBe("false");
	expect(document.activeElement).toBe(summary);
	open();
	outline.focus();
	outline.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	expect(summary.getAttribute("aria-expanded")).toBe("false");
	expect(document.activeElement).toBe(summary);
	open();
	outline.focus();
	summary.focus();
	expect(summary.getAttribute("aria-expanded")).toBe("true");
	// WebKit focuses the enclosing controls landmark when a More button is pressed.
	const controls = document.createElement("nav");
	controls.tabIndex = -1;
	root.append(controls);
	controls.append(more);
	summary.focus();
	controls.focus();
	expect(summary.getAttribute("aria-expanded")).toBe("true");
	summary.focus();
	const next = document.getElementById("deck-next") as HTMLButtonElement;
	next.focus();
	expect(summary.getAttribute("aria-expanded")).toBe("false");
	expect(document.activeElement).toBe(next);
});

it("offers contextual resume and returns focus to the stable Follow toggle", () => {
	setup();
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	const player = vi.mocked(mountDeckNarration).mock.results[0].value;
	const follow = document.getElementById("deck-follow") as HTMLButtonElement;
	const resume = document.getElementById("deck-resume-follow") as HTMLButtonElement;
	const row = document.getElementById("deck-resume-follow-row") as HTMLElement;
	const status = document.getElementById("deck-follow-status") as HTMLElement;
	expect(row.getAttribute("aria-hidden")).toBe("true");
	expect(row.inert).toBe(true);
	options.onFollowSuspendedChange?.(true);
	expect(row.getAttribute("aria-hidden")).toBe("false");
	expect(row.inert).toBe(false);
	expect(follow.getAttribute("aria-pressed")).toBe("true");
	expect(follow.getAttribute("aria-describedby")).toBe(status.id);
	expect(status.textContent).toBe("Automatic scrolling is paused while you browse.");
	resume.focus();
	resume.click();
	expect(player.resumeFollow).toHaveBeenCalledOnce();
	options.onFollowSuspendedChange?.(false);
	expect(row.getAttribute("aria-hidden")).toBe("true");
	expect(row.inert).toBe(true);
	expect(document.activeElement).toBe(follow);
	expect(status.textContent).toBe("");
	expect(follow.hasAttribute("aria-describedby")).toBe(false);
});

it("inspects a locked requested slide without tracking, saving, or releasing gates", () => {
	const { runtime, tracker } = setup();
	history.replaceState(null, "", "/?praxity-inspect=1#slide-3");
	cleanup = initDeck();
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-3"]')?.hidden).toBe(false);
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", { detail: { blockId: "check", correct: true } }),
	);
	(document.getElementById("deck-previous") as HTMLButtonElement).click();
	expect(tracker.trackPageVisit).not.toHaveBeenCalled();
	expect(runtime.setSuspendData).not.toHaveBeenCalled();
	expect(runtime.commit).not.toHaveBeenCalled();
});

it("uses the host handoff for an allowed cross-module outline link", () => {
	const { runtime } = setup(true, 2);
	runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	window.__praxityDecoratePageHref = vi.fn((href) => `${href}&host=1`);
	window.__praxityNavigatePageHref = vi.fn(() => true);
	cleanup = initDeck();
	(document.querySelector('[data-deck-page="slide-3"]') as HTMLAnchorElement).click();
	expect(window.__praxityDecoratePageHref).toHaveBeenCalledWith("second-module.html#slide-3");
	expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith(
		"second-module.html#slide-3&host=1",
	);
});

it("keeps a module outline link visible while enforcing its gate", () => {
	setup(true, 2);
	window.__praxityNavigatePageHref = vi.fn(() => true);
	cleanup = initDeck();
	const link = document.querySelector<HTMLAnchorElement>('[data-deck-page="slide-3"]');
	assert(link);
	expect(link.hidden).toBe(false);
	expect(link.getAttribute("aria-disabled")).toBe("true");
	link.click();
	expect(window.__praxityNavigatePageHref).not.toHaveBeenCalled();
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", { detail: { blockId: "check", correct: true } }),
	);
	expect(link.hidden).toBe(false);
	(document.getElementById("deck-next") as HTMLButtonElement).click();
	expect(link.getAttribute("aria-disabled")).toBe("false");
	link.click();
	expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith("second-module.html#slide-3");
});

it.each(["first-module.html#slide-2", "slide-1.html#slide-2"])(
	"preserves a cross-module fragment in authored %s links and uses the host handoff",
	(href) => {
		const { runtime } = setup();
		document.querySelector('[data-deck-slide="slide-1"]')?.remove();
		document.querySelector('[data-deck-slide="slide-2"]')?.remove();
		history.replaceState(null, "", "/second-module.html?praxity-inspect=1#slide-3");
		window.__praxityDecoratePageHref = vi.fn((value) => value);
		window.__praxityNavigatePageHref = vi.fn(() => true);
		// Authored links are server-rendered before the deck starts.
		const link = document.createElement("a");
		link.href = href;
		document.querySelector(".praxity-deck")?.append(link);
		cleanup = initDeck();
		link.click();
		expect(window.__praxityDecoratePageHref).toHaveBeenCalledWith(
			"first-module.html?praxity-inspect=1#slide-2",
		);
		expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith(
			"first-module.html?praxity-inspect=1#slide-2",
		);
		expect(runtime.setSuspendData).not.toHaveBeenCalled();
	},
);

it("keeps authored fragment navigation behind gates and ignores unrelated paths and anchors", () => {
	setup(true, 2);
	history.replaceState(null, "", "/first-module.html");
	window.__praxityNavigatePageHref = vi.fn(() => true);
	const link = document.createElement("a");
	link.href = "second-module.html#slide-3";
	document.querySelector(".praxity-deck")?.append(link);
	cleanup = initDeck();
	const blocked = new MouseEvent("click", { bubbles: true, cancelable: true });
	link.dispatchEvent(blocked);
	expect(blocked.defaultPrevented).toBe(true);
	expect(window.__praxityNavigatePageHref).not.toHaveBeenCalled();
	expect(location.hash).toBe("#slide-1");
	for (const href of [
		"#section-heading",
		"second-module.html#section-heading",
		"second-module.html#slide-2",
		"/other/second-module.html#slide-3",
		"https://example.org/second-module.html#slide-3",
	]) {
		link.href = href;
		const click = new MouseEvent("click", { bubbles: true, cancelable: true });
		// Observe the runtime's decision, then suppress jsdom's native navigation.
		const observe = vi.fn((event: Event) => {
			expect(event.defaultPrevented).toBe(false);
			event.preventDefault();
		});
		document.addEventListener("click", observe, { once: true });
		link.dispatchEvent(click);
		expect(observe).toHaveBeenCalledOnce();
	}
	expect(window.__praxityNavigatePageHref).not.toHaveBeenCalled();
});

it("resolves controls bound at their render point and leaves unbound content to the browser", () => {
	const { runtime } = setup(false);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	cleanup = initDeck();
	const slide = document.querySelector('[data-deck-slide="slide-1"]');
	assert(slide);
	// No deck, main or document listener delegates clicks any more.
	const stray = document.createElement("a");
	stray.href = "#slide-2";
	slide.append(stray);
	const click = new MouseEvent("click", { bubbles: true, cancelable: true });
	const observe = vi.fn((event: Event) => {
		expect(event.defaultPrevented).toBe(false);
		event.preventDefault();
	});
	document.addEventListener("click", observe, { once: true });
	stray.dispatchEvent(click);
	expect(observe).toHaveBeenCalledOnce();
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(true);
	// An island that clones authored feedback binds its links; nested text resolves to the link.
	const feedback = document.createElement("span");
	feedback.innerHTML = '<a href="#slide-2"><strong>Practice</strong> slide</a>';
	slide.append(feedback);
	bindDeckControls(feedback);
	bindDeckControls(feedback);
	const pushState = vi.spyOn(history, "pushState");
	feedback
		.querySelector("strong")
		?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(false);
	expect(location.hash).toBe("#slide-2");
	expect(pushState).toHaveBeenCalledOnce();
	pushState.mockRestore();
});

it("resolves links React renders after the deck starts, once per activation", () => {
	const { runtime } = setup(false);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const slide = document.querySelector('[data-deck-slide="slide-1"]');
	assert(slide);
	const mount = document.createElement("div");
	slide.append(mount);
	let submit = () => {};
	function Question() {
		const [submitted, setSubmitted] = useState(false);
		submit = () => setSubmitted(true);
		return submitted
			? createElement(
					"a",
					{ href: "#slide-2" },
					createElement("svg", { "aria-hidden": "true" }),
					createElement("span", null, "Review practice"),
				)
			: createElement("p", null, "Question");
	}
	renderIsland(mount, createElement(Question));
	cleanup = initDeck();
	// Feedback appears after submission, so the deck never saw this link.
	flushSync(() => submit());
	const link = mount.querySelector("a");
	assert(link);
	// A control may also carry its own binding; the activation still runs once.
	bindDeckControls(mount);
	const pushState = vi.spyOn(history, "pushState");
	const click = new MouseEvent("click", { bubbles: true, cancelable: true });
	link.querySelector("svg")?.dispatchEvent(click);
	expect(click.defaultPrevented).toBe(true);
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(false);
	expect(pushState).toHaveBeenCalledOnce();
	pushState.mockRestore();
});

it.each([
	{ enabled: false, recorded: true },
	{ enabled: true, recorded: false },
	{ enabled: true, recorded: true },
])(
	"uses only footer playback for local narration (enabled=$enabled, recorded=$recorded)",
	({ enabled, recorded }) => {
		const { pages } = setup(true, 2);
		for (const index of [0, 1]) {
			pages[index] = deckPageData(
				{
					id: pages[index].id,
					title: pages[index].title,
					blocks: [],
					narrationEnabled: enabled,
					data: { narrationAudio: recorded ? "audio/retained.mp3" : undefined },
				},
				{},
				pages[index].slug,
				pages[index].moduleSlug,
				"en",
			);
		}
		// Another module retains audio in the full-course config.
		expect(pages[2].segments[0].src).toBeTruthy();
		const config = document.getElementById("praxity-config");
		assert(config);
		config.textContent = JSON.stringify({ deckPages: pages, sourceLocale: "en" });
		cleanup = initDeck();
		if (enabled && recorded) {
			expect(vi.mocked(mountDeckNarration).mock.calls[0][0].openingControl).toBeUndefined();
		} else {
			expect(mountDeckNarration).not.toHaveBeenCalled();
			expect(document.querySelector(".deck-opening-narration-row")).toBeNull();
		}
		expect(document.querySelector(".deck-opening-narration-row")).toBeNull();
		expect(document.getElementById("deck-script-toggle")?.hidden).toBe(false);
	},
);

it("keeps a reading-only deck navigable and hides audio-only settings", () => {
	const { runtime } = setup(false);
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	cleanup = initDeck();
	expect(mountDeckNarration).not.toHaveBeenCalled();
	expect(document.getElementById("deck-follow")?.parentElement?.hidden).toBe(true);
	expect(document.getElementById("deck-advance")?.hidden).toBe(true);
	(document.querySelector('[data-deck-page="slide-2"]') as HTMLAnchorElement).click();
	expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(false);
	expect(document.querySelector('[data-deck-page="slide-2"]')?.getAttribute("aria-current")).toBe(
		"page",
	);
});

it("focuses an opened panel heading and returns focus on toggle, Escape or close", () => {
	setup();
	cleanup = initDeck();
	for (const name of ["script", "outline"]) {
		const toggle = document.getElementById(`deck-${name}-toggle`) as HTMLButtonElement;
		toggle.click();
		expect(document.activeElement?.id).toBe(`deck-${name}-title`);
		const panel = document.getElementById(
			name === "script" ? "deck-sidebar" : "deck-outline-sidebar",
		);
		panel?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.activeElement).toBe(toggle);
		expect(panel?.hidden).toBe(true);
		toggle.click();
		(
			document.getElementById(
				name === "script" ? "deck-sidebar-close" : "deck-outline-close",
			) as HTMLButtonElement
		).click();
		expect(document.activeElement).toBe(toggle);
		toggle.click();
		expect(document.activeElement?.id).toBe(`deck-${name}-title`);
		toggle.click();
		expect(document.activeElement).toBe(toggle);
	}
});

it("continues across visual sections with automatic slide advance off, but holds the next slide", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const raw = document.getElementById("praxity-config") as HTMLScriptElement;
	const config = JSON.parse(raw.textContent ?? "{}");
	const parsed = readSource("# First slide\n\nFirst paragraph.\n\n---\n\nSecond paragraph.\n");
	const authored = splitBlocksIntoPages(parsed.blocks, "Section example");
	expect(authored).toHaveLength(1);
	const sectioned = deckPageData(
		{ ...authored[0], id: "slide-1" },
		{},
		"slide-1",
		"first-module",
		"en",
	);
	config.deckPages[0].segments = sectioned.segments.map((segment) => ({
		...segment,
		src: "audio/section.mp3",
	}));
	raw.textContent = JSON.stringify(config);
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	const boundary = sectioned.segments.length;
	expect(boundary).toBeGreaterThan(1);
	expect(options.items.slice(0, boundary).every((item) => !item.pauseAfter)).toBe(true);
	(document.getElementById("deck-advance") as HTMLButtonElement).click();
	expect(options.beforeSelect?.(1, "advance")).toBe(true);
	expect(options.beforeSelect?.(boundary, "advance")).toBe(false);
	(document.getElementById("deck-advance") as HTMLButtonElement).click();
	const focused = document.createElement("button");
	document.querySelector('[data-deck-slide="slide-1"]')?.append(focused);
	focused.focus();
	expect(options.beforeSelect?.(boundary, "advance")).toBe(false);
	focused.blur();
	expect(options.beforeSelect?.(boundary, "advance")).toBe(true);
});

it("respects authored keyboard opt-out and leaves widget or handled arrow keys alone", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const raw = document.getElementById("praxity-config") as HTMLScriptElement;
	const config = JSON.parse(raw.textContent ?? "{}");
	config.navKeyboardArrows = false;
	raw.textContent = JSON.stringify(config);
	cleanup = initDeck();
	const arrow = () =>
		new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
	document.body.dispatchEvent(arrow());
	expect(location.hash).toBe("#slide-1");
	cleanup?.();
	config.navKeyboardArrows = true;
	raw.textContent = JSON.stringify(config);
	cleanup = initDeck();
	for (const role of [
		"tablist",
		"tree",
		"grid",
		"menu",
		"slider",
		"spinbutton",
		"listbox",
		"toolbar",
	]) {
		const widget = document.createElement("div");
		widget.setAttribute("role", role);
		const child = document.createElement("span");
		widget.append(child);
		document.querySelector('[data-deck-slide="slide-1"]')?.append(widget);
		const key = arrow();
		child.dispatchEvent(key);
		expect(key.defaultPrevented).toBe(false);
		expect(location.hash).toBe("#slide-1");
	}
	const handled = arrow();
	handled.preventDefault();
	document.body.dispatchEvent(handled);
	expect(location.hash).toBe("#slide-1");
	document.body.dispatchEvent(arrow());
	expect(location.hash).toBe("#slide-2");
});

it("resets slide and transcript scroll on a logical move, preserving same-slide seeks", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	cleanup = initDeck();
	const main = document.getElementById("main-content") as HTMLElement;
	const workspace = document.querySelector(".deck-workspace") as HTMLElement;
	const transcript = document.getElementById("deck-script-scroll") as HTMLElement;
	main.scrollTop = 400;
	workspace.scrollTop = 500;
	transcript.scrollTop = 600;
	workspace.style.overflowY = "auto";
	(document.querySelector('[data-deck-page="slide-1"]') as HTMLAnchorElement).click();
	expect(main.scrollTop).toBe(400);
	expect(workspace.scrollTop).toBe(500);
	expect(transcript.scrollTop).toBe(600);
	(document.getElementById("deck-next") as HTMLButtonElement).click();
	expect(main.scrollTop).toBe(0);
	expect(workspace.scrollTop).toBe(0);
	expect(transcript.scrollTop).toBe(0);
});

it.each(["en", "fr"])("uses gated boundary controls and localized labels in %s", (locale) => {
	const { pages } = setup(true, 2);
	pages[1].gates = pages[0].gates;
	pages[0].gates = [];
	const config = document.getElementById("praxity-config") as HTMLScriptElement;
	config.textContent = JSON.stringify({ deckPages: pages, sourceLocale: locale });
	window.__praxityNavigatePageHref = vi.fn(() => true);
	cleanup = initDeck();
	const previous = document.getElementById("deck-previous") as HTMLButtonElement;
	const next = document.getElementById("deck-next") as HTMLButtonElement;
	expect(previous.disabled).toBe(true);
	expect(next.getAttribute("aria-label")).toBe(
		locale === "fr" ? "Diapositive suivante" : "Next slide",
	);
	next.click();
	expect(next.disabled).toBe(false);
	expect(next.getAttribute("aria-label")).toBe(
		locale === "fr" ? "Terminer le module" : "Finish module",
	);
	expect(next.title).toBe(next.getAttribute("aria-label"));
	next.click();
	expect(window.__praxityNavigatePageHref).not.toHaveBeenCalled();
	expect(document.getElementById("deck-status")?.dataset.kind).toBe("gate");
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", {
			detail: { blockId: "check", correct: true },
		}),
	);
	next.click();
	expect(document.getElementById("deck-completion")?.hidden).toBe(false);
	expect(next.getAttribute("aria-label")).toBe(
		locale === "fr" ? "Module suivant : Slide 3" : "Next module: Slide 3",
	);
	next.click();
	expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith("second-module.html#slide-3");
	expect(vi.mocked(mountDeckNarration).mock.results[0].value.pause).toHaveBeenCalled();
});

it.each(["en", "fr"])(
	"returns to the previous module through the toolbar and keyboard in %s",
	(locale) => {
		const { runtime } = setup();
		document.querySelector('[data-deck-slide="slide-1"]')?.remove();
		document.querySelector('[data-deck-slide="slide-2"]')?.remove();
		const config = document.getElementById("praxity-config") as HTMLScriptElement;
		config.textContent = JSON.stringify({
			...JSON.parse(config.textContent ?? "{}"),
			sourceLocale: locale,
		});
		runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		window.__praxityNavigatePageHref = vi.fn(() => true);
		cleanup = initDeck();
		const previous = document.getElementById("deck-previous") as HTMLButtonElement;
		expect(previous.disabled).toBe(false);
		expect(previous.getAttribute("aria-label")).toBe(
			locale === "fr" ? "Module précédent" : "Previous module",
		);
		expect(previous.title).toBe(previous.getAttribute("aria-label"));
		expect((document.getElementById("deck-next") as HTMLButtonElement).disabled).toBe(false);
		previous.click();
		expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith("first-module.html#slide-2");
		vi.mocked(window.__praxityNavigatePageHref).mockClear();
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		expect(window.__praxityNavigatePageHref).toHaveBeenCalledWith("first-module.html#slide-2");
	},
);

it("opens the authored panel without taking focus and initializes player preferences", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	const raw = document.getElementById("praxity-config") as HTMLScriptElement;
	const config = JSON.parse(raw.textContent ?? "{}");
	config.deckDesign = {
		initialPanel: "transcript",
		outline: false,
		slideCounter: false,
		followNarration: false,
		autoAdvance: false,
	};
	raw.textContent = JSON.stringify(config);
	const focused = document.activeElement;
	cleanup = initDeck();
	expect(document.activeElement).toBe(focused);
	expect(document.getElementById("deck-sidebar")?.hidden).toBe(false);
	expect(document.getElementById("deck-outline-sidebar")?.hidden).toBe(true);
	expect(document.getElementById("deck-outline-toggle")?.hidden).toBe(true);
	expect(document.getElementById("deck-position")?.hidden).toBe(true);
	expect(document.getElementById("deck-position-label")?.textContent).toContain("1");
	const player = vi.mocked(mountDeckNarration).mock.results[0].value;
	expect(player.setFollow).toHaveBeenCalledWith(false);
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	expect(options.beforeSelect?.(1, "advance")).toBe(false);
	expect(options.beforeSelect?.(1, "play")).toBe(true);
});

it("remembers explicit panel choices across modules without replacing the authored default", () => {
	const openModule = (courseId: string, second = false) => {
		const { runtime } = setup(false);
		if (second) {
			runtime.getVisitedPages.mockReturnValue(["slide-1", "slide-2"]);
			runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
			document.querySelector('[data-deck-slide="slide-1"]')?.remove();
			document.querySelector('[data-deck-slide="slide-2"]')?.remove();
		}
		const raw = document.getElementById("praxity-config") as HTMLScriptElement;
		const config = JSON.parse(raw.textContent ?? "{}");
		config.courseId = courseId;
		config.deckDesign = { initialPanel: "transcript" };
		config.deckPages[2].narrationSilent = true;
		raw.textContent = JSON.stringify(config);
		cleanup = initDeck();
		return document.getElementById("deck-sidebar") as HTMLElement;
	};
	const nextModule = (courseId: string) => {
		cleanup?.();
		cleanup = undefined;
		document.body.replaceChildren();
		return openModule(courseId, true);
	};

	expect(openModule("course-a").hidden).toBe(false);
	expect(localStorage.getItem("praxity:deck-panel:course-a")).toBeNull();
	(document.getElementById("deck-sidebar-close") as HTMLButtonElement).click();
	expect(nextModule("course-a").hidden).toBe(true);
	expect(
		(document.getElementById("deck-script-toggle") as HTMLButtonElement).getAttribute(
			"aria-expanded",
		),
	).toBe("false");
	(document.getElementById("deck-script-toggle") as HTMLButtonElement).click();
	expect(nextModule("course-a").hidden).toBe(false);
	expect(nextModule("course-b").hidden).toBe(false);
});

it.each(["transcript", "outline"])(
	"keeps a fresh replacing-panel arrival lesson-first despite the authored %s default",
	(initialPanel) => {
		setup(false);
		drawerMedia.matches = true;
		const raw = document.getElementById("praxity-config") as HTMLScriptElement;
		const config = JSON.parse(raw.textContent ?? "{}");
		config.courseId = "narrow-course";
		config.deckDesign = { initialPanel };
		raw.textContent = JSON.stringify(config);
		const focused = document.activeElement;
		cleanup = initDeck();
		expect(document.getElementById("main-content")?.inert).toBe(false);
		expect(document.getElementById("deck-sidebar")?.hidden).toBe(true);
		expect(document.getElementById("deck-outline-sidebar")?.hidden).toBe(true);
		expect(document.activeElement).toBe(focused);
		expect(localStorage.getItem("praxity:deck-panel:narrow-course")).toBeNull();
	},
);

it.each(["script", "outline", "closed"])(
	"honors a stored %s choice on replacing-panel arrival with meaningful focus",
	(preference) => {
		setup(false);
		drawerMedia.matches = true;
		const raw = document.getElementById("praxity-config") as HTMLScriptElement;
		const config = JSON.parse(raw.textContent ?? "{}");
		config.courseId = "narrow-course";
		config.deckDesign = { initialPanel: "transcript" };
		raw.textContent = JSON.stringify(config);
		localStorage.setItem("praxity:deck-panel:narrow-course", preference);
		const focused = document.activeElement;
		cleanup = initDeck();
		expect(document.getElementById("main-content")?.inert).toBe(preference !== "closed");
		expect(document.getElementById("deck-sidebar")?.hidden).toBe(preference !== "script");
		expect(document.getElementById("deck-outline-sidebar")?.hidden).toBe(preference !== "outline");
		if (preference === "closed") expect(document.activeElement).toBe(focused);
		else {
			expect(document.activeElement?.id).toBe(`deck-${preference}-title`);
			document
				.getElementById(preference === "script" ? "deck-sidebar-close" : "deck-outline-close")
				?.click();
			expect(document.activeElement?.id).toBe(`deck-${preference}-toggle`);
			expect(document.getElementById("main-content")?.inert).toBe(false);
		}
	},
);

it("ignores invalid panel storage and works when local storage denies access", () => {
	localStorage.setItem("praxity:deck-panel:deck-course", "something else");
	setup(false);
	const raw = document.getElementById("praxity-config") as HTMLScriptElement;
	const config = JSON.parse(raw.textContent ?? "{}");
	config.deckDesign = { initialPanel: "transcript" };
	raw.textContent = JSON.stringify(config);
	cleanup = initDeck();
	expect(document.getElementById("deck-sidebar")?.hidden).toBe(false);
	cleanup?.();
	cleanup = undefined;
	document.body.replaceChildren();

	const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
		throw new DOMException("Storage denied", "SecurityError");
	});
	const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new DOMException("Storage denied", "SecurityError");
	});
	try {
		setup(false);
		const raw = document.getElementById("praxity-config") as HTMLScriptElement;
		const config = JSON.parse(raw.textContent ?? "{}");
		config.deckDesign = { initialPanel: "transcript" };
		raw.textContent = JSON.stringify(config);
		cleanup = initDeck();
		expect(document.getElementById("deck-sidebar")?.hidden).toBe(false);
		(document.getElementById("deck-sidebar-close") as HTMLButtonElement).click();
		expect(document.getElementById("deck-sidebar")?.hidden).toBe(true);
	} finally {
		get.mockRestore();
		set.mockRestore();
	}
});

it.each(["attempt", "pass"] as const)(
	"releases a group %s gate only from its aggregate event",
	(rule) => {
		const { runtime } = setup(false);
		const config = document.getElementById("praxity-config");
		assert(config?.textContent);
		const data = JSON.parse(config.textContent);
		data.deckPages[0].gates = [{ id: "group", rule }];
		config.textContent = JSON.stringify(data);
		cleanup = initDeck();
		const next = document.querySelector('[data-deck-page="slide-2"]');
		assert(next);
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-response", {
				detail: { blockId: "member", correct: true },
			}),
		);
		expect(next.getAttribute("aria-disabled")).toBe("true");
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-group-complete", {
				detail: { groupId: "group", passed: false },
			}),
		);
		expect(next.getAttribute("aria-disabled")).toBe(rule === "attempt" ? "false" : "true");
		if (rule === "pass") {
			document.dispatchEvent(
				new CustomEvent("praxity:assessment-group-complete", {
					detail: { groupId: "group", passed: false, completed: true },
				}),
			);
			expect(next.getAttribute("aria-disabled")).toBe("false");
		}
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-group-complete", {
				detail: { groupId: "group", passed: true },
			}),
		);
		expect(next.getAttribute("aria-disabled")).toBe("false");
		expect(runtime.setSuspendData).toHaveBeenLastCalledWith(
			JSON.stringify({ deck: { released: ["group"] } }),
		);
	},
);

it("replaces the slide with a mobile reading dialog while keeping footer controls usable", () => {
	setup();
	drawerMedia.matches = true;
	cleanup = initDeck();
	const main = document.getElementById("main-content");
	const panel = document.getElementById("deck-sidebar");
	const toggle = document.getElementById("deck-script-toggle");
	assert(main && panel && toggle);
	toggle.click();
	expect(main.inert).toBe(true);
	expect(panel.getAttribute("role")).toBe("dialog");
	expect(panel.hasAttribute("aria-modal")).toBe(false);
	expect(document.getElementById("deck-next")?.closest("[inert]")).toBeNull();
	drawerMedia.matches = false;
	drawerMedia.dispatchEvent(new Event("change"));
	expect(main.inert).toBe(false);
	expect(panel.getAttribute("role")).toBe("complementary");
	document.getElementById("deck-sidebar-close")?.click();
	expect(document.activeElement).toBe(toggle);
});

it("uses one outline landmark on desktop and a named dialog in the mobile drawer", () => {
	setup();
	cleanup = initDeck();
	const panel = document.getElementById("deck-outline-sidebar");
	document.getElementById("deck-outline-toggle")?.click();
	expect(panel?.hasAttribute("role")).toBe(false);
	drawerMedia.matches = true;
	drawerMedia.dispatchEvent(new Event("change"));
	expect(panel?.getAttribute("role")).toBe("dialog");
	expect(panel?.getAttribute("aria-labelledby")).toBe("deck-outline-title");
	drawerMedia.matches = false;
	drawerMedia.dispatchEvent(new Event("change"));
	expect(panel?.hasAttribute("role")).toBe(false);
	expect(panel?.hasAttribute("aria-labelledby")).toBe(false);
});

it("distinguishes quiet playback stops from visible gate and error messages", () => {
	const { runtime } = setup();
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	const status = document.getElementById("deck-status");
	assert(status);
	options.onStop?.();
	expect(status.dataset.kind).toBe("paused");
	expect(status.textContent).not.toBe("");
	expect(options.beforeSelect?.(1, "advance")).toBe(false);
	expect(status.dataset.kind).toBe("gate");
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", { detail: { blockId: "check", correct: true } }),
	);
	expect(options.beforeSelect?.(1, "select")).toBe(true);
	expect(status.dataset.kind).toBeUndefined();
	expect(status.textContent).toBe("");
	options.onPlaybackError?.();
	expect(status.dataset.kind).toBe("error");
	options.onEnded?.();
	expect(status.dataset.kind).toBe("paused");
	runtime.commit.mockReturnValue(false);
	(document.getElementById("deck-next") as HTMLButtonElement).click();
	expect(status.dataset.kind).toBe("error");
	expect(status.textContent).not.toBe("");
});

it("keeps a gate notice through playback stops and failed responses until every gate is released", () => {
	setup();
	const raw = document.getElementById("praxity-config");
	assert(raw?.textContent);
	const config = JSON.parse(raw.textContent);
	config.deckPages[0].gates.push({ id: "second-check", rule: "pass" });
	raw.textContent = JSON.stringify(config);
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	const status = document.getElementById("deck-status");
	assert(status);
	expect(options.beforeSelect?.(1, "advance")).toBe(false);
	const message = status.textContent;
	options.onStop?.();
	options.onEnded?.();
	expect(status.dataset.kind).toBe("gate");
	expect(status.textContent).toBe(message);
	for (const [blockId, correct] of [
		["check", false],
		["check", true],
		["second-check", false],
	] as const) {
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-response", { detail: { blockId, correct } }),
		);
		expect(status.dataset.kind).toBe("gate");
		expect(status.textContent).toBe(message);
	}
	document.dispatchEvent(
		new CustomEvent("praxity:assessment-response", {
			detail: { blockId: "second-check", correct: true },
		}),
	);
	expect(status.dataset.kind).toBeUndefined();
	expect(status.textContent).toBe("");
	expect(location.hash).toBe("#slide-1");
});

it("toggles narration with Space on prose while preserving native control keys", () => {
	setup();
	cleanup = initDeck();
	const player = vi.mocked(mountDeckNarration).mock.results[0].value;
	const space = (target: Element, init: KeyboardEventInit = {}) => {
		const event = new KeyboardEvent("keydown", {
			key: " ",
			bubbles: true,
			cancelable: true,
			...init,
		});
		target.dispatchEvent(event);
		return event;
	};
	for (const target of [
		document.body,
		document.getElementById("main-content"),
		document.querySelector("[data-deck-segment]"),
	]) {
		assert(target);
		expect(space(target).defaultPrevented).toBe(true);
	}
	expect(player.togglePlayback).toHaveBeenCalledTimes(3);
	for (const html of [
		"<input>",
		"<textarea></textarea>",
		"<button>Play</button>",
		'<a href="#">Link</a>',
		"<video></video>",
		'<div contenteditable="true">Edit</div>',
		'<div role="slider"></div>',
	]) {
		const wrapper = document.createElement("div");
		wrapper.innerHTML = html;
		document.body.append(wrapper);
		assert(wrapper.firstElementChild);
		expect(space(wrapper.firstElementChild).defaultPrevented).toBe(false);
	}
	for (const init of [
		{ repeat: true },
		{ ctrlKey: true },
		{ altKey: true },
		{ metaKey: true },
		{ shiftKey: true },
	])
		expect(space(document.body, init).defaultPrevented).toBe(false);
	const handled = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
	handled.preventDefault();
	document.body.dispatchEvent(handled);
	expect(player.togglePlayback).toHaveBeenCalledTimes(3);
	player.togglePlayback.mockReturnValue(false);
	expect(space(document.body).defaultPrevented).toBe(false);
});

it.each(["initial", "hash", "bookmark"])(
	"shows only the current transcript on %s entry",
	(entry) => {
		const { runtime } = setup(false);
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		runtime.getVisitedPages.mockReturnValue(["slide-1"]);
		if (entry === "hash") history.replaceState(null, "", "/#slide-2");
		if (entry === "bookmark") window.__praxityResume = { pageId: "slide-2" };
		cleanup = initDeck();
		const active = entry === "initial" ? "slide-1" : "slide-2";
		for (const reading of document.querySelectorAll<HTMLElement>("[data-deck-reading]")) {
			expect(reading.hidden).toBe(reading.dataset.deckReading !== active);
			expect(reading.inert).toBe(reading.hidden);
		}
	},
);

it("keeps unlocked inactive scripts hidden and updates on automatic advance without stranding focus", () => {
	const { runtime } = setup();
	runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
	cleanup = initDeck();
	const options = vi.mocked(mountDeckNarration).mock.calls[0][0];
	const first = document.querySelector<HTMLElement>('[data-deck-reading="slide-1"]');
	const second = document.querySelector<HTMLElement>('[data-deck-reading="slide-2"]');
	assert(first && second);
	expect(first.hidden).toBe(false);
	expect(second.hidden).toBe(true);
	const seek = document.createElement("button");
	first.append(seek);
	seek.focus();
	expect(options.beforeSelect?.(1, "advance")).toBe(true);
	expect(first.hidden).toBe(true);
	expect(first.inert).toBe(true);
	expect(second.hidden).toBe(false);
	expect(document.activeElement).toBe(document.getElementById("deck-script-scroll"));
	cleanup?.();
	cleanup = undefined;
	assert(first && second);
	expect(first.hidden).toBe(false);
	expect(first.inert).toBe(false);
});

it.each(["en", "fr"])(
	"orients heading navigation with named position regions and no live writes in %s",
	(locale) => {
		const { runtime } = setup(false);
		runtime.getInteractions.mockReturnValue([{ id: "check", correct: true }]);
		const config = document.getElementById("praxity-config");
		assert(config?.textContent);
		config.textContent = JSON.stringify({
			...JSON.parse(config.textContent),
			sourceLocale: locale,
		});
		for (const [index, slide] of [...document.querySelectorAll("[data-deck-slide]")].entries()) {
			slide.insertAdjacentHTML("afterbegin", `<h1>Slide ${index + 1}</h1>`);
		}
		cleanup = initDeck();
		const announcement = document.getElementById("deck-announcement");
		assert(announcement);
		announcement.textContent = "Earlier narration announcement";
		document.getElementById("deck-next")?.click();
		expect(document.activeElement?.textContent).toBe("Slide 2");
		expect(document.querySelector('[data-deck-slide="slide-2"]')?.getAttribute("aria-label")).toBe(
			locale === "fr" ? "Diapositive 2 sur 3" : "Slide 2 of 3",
		);
		expect(announcement.textContent).toBe("Earlier narration announcement");
		document.getElementById("deck-previous")?.click();
		expect(document.activeElement?.textContent).toBe("Slide 1");
		expect(document.querySelector('[data-deck-slide="slide-1"]')?.getAttribute("aria-label")).toBe(
			locale === "fr" ? "Diapositive 1 sur 3" : "Slide 1 of 3",
		);
		expect(announcement.textContent).toBe("Earlier narration announcement");
	},
);

it("highlight practice releases no deck gate, visit or completion while the ordinary choice does", () => {
	const { runtime, tracker } = setup(false);
	const slide = document.querySelector<HTMLElement>('[data-deck-slide="slide-1"]')!;
	slide.innerHTML = highlightPrivacyMarkup() + highlightPrivacyChoice();
	const instances = [...slide.querySelectorAll<HTMLElement>("[data-highlight]")].map(
		enhanceHighlight,
	);
	const responses: unknown[] = [];
	const response = (event: Event) => responses.push((event as CustomEvent).detail);
	document.addEventListener("praxity:assessment-response", response);
	try {
		cleanup = initDeck();
		const next = document.getElementById("deck-next") as HTMLButtonElement;
		const snapshot = () =>
			JSON.stringify({
				suspend: runtime.setSuspendData.mock.calls,
				commits: runtime.commit.mock.calls,
				visits: tracker.trackPageVisit.mock.calls,
				responses,
			});
		const baseline = snapshot();
		const check = () => {
			next.click();
			expect(slide.hidden).toBe(false);
			expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(true);
			expect(document.getElementById("deck-completion")?.hidden).toBe(true);
			expect(snapshot()).toBe(baseline);
			expect(
				slide.querySelectorAll(
					"[data-highlight][data-completed], [data-highlight][data-attempted], [data-highlight] [data-completed], [data-highlight] [data-attempted]",
				),
			).toHaveLength(0);
		};
		exerciseHighlightPrivacy(document, check);
		document.dispatchEvent(
			new CustomEvent("praxity:assessment-response", {
				detail: {
					blockId: "check",
					responseText: "ordinary-answer",
					assessmentType: "choice",
					correct: true,
					completed: true,
					submitted: true,
				},
			}),
		);
		next.click();
		expect(slide.hidden).toBe(true);
		expect(document.querySelector<HTMLElement>('[data-deck-slide="slide-2"]')?.hidden).toBe(false);
		expect(tracker.trackPageVisit).toHaveBeenCalledWith(
			"slide-2",
			"index.html?praxity-page=slide-2",
		);
		expect(runtime.setSuspendData).toHaveBeenCalled();
		expect(snapshot()).not.toMatch(/HL-PRIVATE|HL-one|HL-two|HL-wrong|data-highlight|marked|shown/);
	} finally {
		instances.forEach((instance) => instance.destroy());
		document.removeEventListener("praxity:assessment-response", response);
	}
});
