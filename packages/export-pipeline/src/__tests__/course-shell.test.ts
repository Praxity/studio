/** @vitest-environment jsdom */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { focusScormResumePage } from "../../template/src/components/scorm-resume-focus";
import { initializeCourseShell } from "../../template/src/course-shell";
import { readSessionState, writeSessionState } from "../scorm/api/session";

const listeners: Array<{
	target: Window | Document;
	type: string;
	listener: EventListenerOrEventListenerObject;
	options?: boolean | AddEventListenerOptions;
}> = [];

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	history.replaceState(null, "", "/course/page-1.html?minimal=1");
	document.documentElement.lang = "en";
	document.documentElement.dir = "ltr";
	document.documentElement.className = "";
	document.documentElement.removeAttribute("data-praxity-text-size");
	document.documentElement.removeAttribute("data-praxity-focus-mode");
	document.documentElement.removeAttribute("data-praxity-reduced-motion");
	document.documentElement.removeAttribute("data-praxity-small-preview");
	document.documentElement.removeAttribute("data-praxity-fallback");
	document.head.innerHTML = "";
	document.body.className = "praxity-layout-sidebar";
	document.body.innerHTML = "";
	delete window.__PRAXITY_STRINGS__;
	delete window.__praxityResume;
	delete window.__PRAXITY_FOCUS_SCORM_RESUME__;
	delete window.__praxityNavigatePageHref;
	Element.prototype.scrollIntoView = vi.fn();
	vi.restoreAllMocks();
	for (const target of [window, document]) {
		const add = target.addEventListener.bind(target);
		vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
			listeners.push({ target, type, listener, options });
			add(type, listener, options);
		});
	}
});

afterEach(() => {
	for (const { target, type, listener, options } of listeners) {
		target.removeEventListener(type, listener, options);
	}
	listeners.length = 0;
});

it("orients a confirmed static Pages resume without a navigation island", () => {
	window.__PRAXITY_FOCUS_SCORM_RESUME__ = focusScormResumePage;
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page"}</script>';
	document.body.innerHTML =
		'<main><h1>Saved page</h1></main><div id="praxity-live-region" role="status"></div>';
	initializeCourseShell();
	window.__praxityResume = { pageId: "saved-page" };
	window.dispatchEvent(
		new CustomEvent("praxity:runtime-ready", {
			detail: {
				currentPage: 4,
				totalPages: 5,
				pageTitle: "Saved page",
				strings: {
					scormResumeAnnouncement: "Resumed at page 4 of 5: Saved page",
					scormResumePositionPrefix: "Resumed at page 4 of 5: ",
				},
			},
		}),
	);
	expect(document.activeElement).toBe(document.querySelector("main h1"));
	expect(document.querySelector("main h1")?.textContent).toBe("Resumed at page 4 of 5: Saved page");
	expect(document.getElementById("praxity-live-region")?.textContent).toBe("");
});

function dispatchSavedPageReady(deck = false): void {
	window.dispatchEvent(
		new CustomEvent("praxity:runtime-ready", {
			detail: {
				deck,
				pageTitle: "Saved page",
				strings: {
					scormResumeAnnouncement: "Resumed at page 4 of 5: Saved page",
					scormResumePositionPrefix: "Resumed at page 4 of 5: ",
				},
			},
		}),
	);
}

it("loads one classic cue script on confirmed resume and focuses only after it loads", () => {
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","resumeFilename":"course-resume-ABCD1234.js"}</script>';
	document.body.innerHTML = "<main><h1>Saved page</h1></main>";
	initializeCourseShell();
	expect(document.querySelector("script[src]")).toBeNull();
	window.__praxityResume = { pageId: "saved-page" };
	dispatchSavedPageReady();
	dispatchSavedPageReady();
	const scripts = document.querySelectorAll('script[src="course-resume-ABCD1234.js"]');
	expect(scripts).toHaveLength(1);
	expect(scripts[0].getAttribute("type")).toBeNull();
	expect(document.activeElement).toBe(document.body);
	window.__PRAXITY_FOCUS_SCORM_RESUME__ = focusScormResumePage;
	scripts[0].dispatchEvent(new Event("load"));
	expect(document.activeElement).toBe(document.querySelector("main h1"));
	expect(document.activeElement?.textContent).toBe("Resumed at page 4 of 5: Saved page");
});

it("does not load the Pages cue for ordinary arrivals or confirmed Guided resume", () => {
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","resumeFilename":"course-resume-ABCD1234.js"}</script>';
	initializeCourseShell();
	dispatchSavedPageReady();
	window.__praxityResume = { pageId: "saved-page" };
	dispatchSavedPageReady(true);
	expect(document.querySelector("script[src]")).toBeNull();
});

it("does not insert a cue or take focus when its delayed script loads after pagehide", () => {
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","resumeFilename":"course-resume-ABCD1234.js"}</script>';
	document.body.innerHTML = "<main><h1>Saved page</h1></main>";
	initializeCourseShell();
	window.__praxityResume = { pageId: "saved-page" };
	dispatchSavedPageReady();
	window.dispatchEvent(new Event("pagehide"));
	window.__PRAXITY_FOCUS_SCORM_RESUME__ = focusScormResumePage;
	document.querySelector("script[src]")?.dispatchEvent(new Event("load"));
	expect(document.activeElement).toBe(document.body);
	expect(document.querySelector("main h1")?.textContent).toBe("Saved page");
});

it("restores readable fallback when the classic cue script fails", () => {
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","resumeFilename":"course-resume-ABCD1234.js"}</script>';
	initializeCourseShell();
	window.__praxityResume = { pageId: "saved-page" };
	dispatchSavedPageReady();
	document.querySelector("script[src]")?.dispatchEvent(new Event("error"));
	expect(document.documentElement.dataset.praxityFallback).toBe("");
});

it("applies first-paint preferences and document behavior from inert config", () => {
	localStorage.setItem("praxity-a11y", JSON.stringify({ textSize: "x-large", focusMode: true }));
	localStorage.setItem("praxity-sidebar-Test Course", "collapsed");
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn((query: string) => ({
			matches: query.includes("color-scheme"),
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
	document.head.innerHTML = `
		<script id="praxity-config" type="application/json">{"strings":{"next":"Continue"}}</script>
		<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","colorMode":"auto","pageFocusDefault":false,"enableJsNav":true,"entrance":"none","stagger":"none","keyboardArrows":true,"currentPage":1,"slugs":["page-1"],"sidebarPreferenceKey":"praxity-sidebar-Test Course"}</script>
	`;
	document.body.innerHTML = `
		<main data-praxity-root></main>
		<button data-page-direction="next">Next</button>
	`;
	const next = document.querySelector<HTMLButtonElement>('[data-page-direction="next"]');
	const clicked = vi.fn();
	next?.addEventListener("click", clicked);

	initializeCourseShell();
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

	expect(document.documentElement.dataset.praxityTextSize).toBe("large");
	expect(document.documentElement.dataset.praxityFocusMode).toBe("true");
	expect(document.documentElement.dataset.praxityReducedMotion).toBeUndefined();
	expect(document.documentElement.dataset.praxityMode).toBe("dark");
	expect(document.documentElement.classList.contains("praxity-theme-dark")).toBe(true);
	expect(document.documentElement.classList.contains("praxity-shell-ready")).toBe(true);
	expect(document.documentElement.classList.contains("praxity-js")).toBe(true);
	expect(document.body.classList.contains("praxity-minimal")).toBe(true);
	expect(document.body.classList.contains("praxity-sidebar-collapsed")).toBe(true);
	expect(window.__PRAXITY_STRINGS__).toEqual({ next: "Continue" });
	expect(clicked).toHaveBeenCalledOnce();
});

it("honors an explicit guide-off choice over the page default before and after toolbar setup", () => {
	localStorage.setItem("praxity-a11y", JSON.stringify({ focusChoice: false }));
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","pageFocusDefault":true}</script>';
	document.body.innerHTML =
		'<main data-praxity-root>Content</main><div data-a11y-toolbar role="toolbar"><button data-a11y-action="focus">Reading guide</button></div>';

	initializeCourseShell();
	expect(document.documentElement.dataset.praxityFocusMode).toBeUndefined();
	expect(
		document.querySelector<HTMLElement>("[data-praxity-root]")?.dataset.praxityFocusMode,
	).toBeUndefined();
	document.dispatchEvent(new Event("DOMContentLoaded"));
	expect(
		document
			.querySelector<HTMLButtonElement>('[data-a11y-action="focus"]')
			?.getAttribute("aria-pressed"),
	).toBe("false");
	expect(document.documentElement.dataset.praxityFocusMode).toBeUndefined();
});

it("restores semantic navigation when the deferred runtime never starts", () => {
	document.head.innerHTML = `
		<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","colorMode":"light","pageFocusDefault":false,"enableJsNav":true,"entrance":"none","stagger":"none","keyboardArrows":false,"currentPage":1,"slugs":["page-1"]}</script>
	`;
	document.body.innerHTML = '<nav data-island="nav" inert>Fallback navigation</nav>';

	initializeCourseShell();
	expect(document.documentElement.classList.contains("praxity-js")).toBe(true);
	document.dispatchEvent(new Event("DOMContentLoaded"));

	expect(document.documentElement.classList.contains("praxity-js")).toBe(false);
	expect(document.querySelector("nav")?.hasAttribute("inert")).toBe(false);
});

it.each(["praxity:islands-failed"])(
	"restores pending presentation after %s without waiting for a timer",
	(event) => {
		document.head.innerHTML = `<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page"}</script>`;
		initializeCourseShell();
		expect(document.documentElement.dataset.praxityFallback).toBeUndefined();
		window.dispatchEvent(new Event(event));
		expect(document.documentElement.dataset.praxityFallback).toBe("");
	},
);

it("restores pending presentation when an external script cannot load", () => {
	document.head.innerHTML = `<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page"}</script><script src="host.js"></script>`;
	initializeCourseShell();
	document.querySelector("script[src]")?.dispatchEvent(new Event("error"));
	expect(document.documentElement.dataset.praxityFallback).toBe("");
});

it("reports reading preferences through pressed state without overwriting navigation speech", () => {
	document.head.innerHTML = `
		<script id="praxity-config" type="application/json">{"strings":{"a11yLargerTextEnabled":"Text enlarged","a11yFocusReadingEnabled":"Guide enabled"}}</script>
		<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","colorMode":"light","pageFocusDefault":false,"enableJsNav":false,"entrance":"none","stagger":"none","keyboardArrows":false,"currentPage":1,"slugs":["page-1"]}</script>
	`;
	document.body.innerHTML = `
		<div id="praxity-live-region">Page 2 of 3: Lesson</div>
		<div data-a11y-toolbar role="toolbar">
			<button data-a11y-action="text">Text</button>
			<button data-a11y-action="focus">Focus</button>
		</div>
		<main id="main-content">Content</main>`;
	const focusChange = vi.fn();
	document.addEventListener("praxity:focus-mode-change", focusChange);

	initializeCourseShell();
	expect(document.documentElement.classList.contains("praxity-shell-ready")).toBe(true);
	document.dispatchEvent(new Event("DOMContentLoaded"));
	const text = document.querySelector<HTMLButtonElement>('[data-a11y-action="text"]');
	const focus = document.querySelector<HTMLButtonElement>('[data-a11y-action="focus"]');
	text?.click();
	focus?.click();
	text?.focus();
	text?.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
	);

	expect(text?.getAttribute("aria-pressed")).toBe("true");
	expect(focus?.getAttribute("aria-pressed")).toBe("true");
	expect(document.activeElement).toBe(focus);
	expect(document.documentElement.dataset.praxityTextSize).toBe("large");
	expect(focusChange).toHaveBeenLastCalledWith(
		expect.objectContaining({ detail: { enabled: true } }),
	);
	expect(document.getElementById("praxity-live-region")?.textContent).toBe("Page 2 of 3: Lesson");
	text?.click();
	focus?.click();
	expect(text?.getAttribute("aria-pressed")).toBe("false");
	expect(focus?.getAttribute("aria-pressed")).toBe("false");
	expect(text?.textContent).toBe("Text");
	expect(focus?.textContent).toBe("Focus");
	expect(document.getElementById("praxity-live-region")?.textContent).toBe("Page 2 of 3: Lesson");
});

it("hands keyboard fallback navigation to an acknowledging host", () => {
	document.head.innerHTML = `
		<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","colorMode":"light","pageFocusDefault":false,"enableJsNav":false,"entrance":"none","stagger":"none","keyboardArrows":true,"nextHref":"./page-2.html","currentPage":1,"slugs":["page-1","page-2"]}</script>
	`;
	const navigate = vi.fn(() => true);
	window.__praxityNavigatePageHref = navigate;

	initializeCourseShell();
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

	expect(navigate).toHaveBeenCalledWith("./page-2.html");
});

it("focuses and centers a block deep link in server-rendered content", () => {
	vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
	history.replaceState(null, "", "/course/page-1.html#block-target");
	document.head.innerHTML = `
		<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","colorMode":"light","pageFocusDefault":false,"enableJsNav":false,"entrance":"none","stagger":"none","keyboardArrows":false,"currentPage":1,"slugs":["page-1"]}</script>
	`;

	initializeCourseShell();
	document.body.innerHTML = '<main><div id="block-target">Target</div></main>';
	document.dispatchEvent(new Event("DOMContentLoaded"));

	const target = document.getElementById("block-target");
	expect(document.activeElement).toBe(target);
	expect(target?.tabIndex).toBe(-1);
	expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
});

it("keeps small preview pages content-only and media-inert", () => {
	history.replaceState(null, "", "/course/page-1.html?minimal=1&praxity-small-preview=1");
	document.head.innerHTML = `
		<script id="praxity-config" type="application/json">{"strings":{"next":"Continue"}}</script>
		<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","colorMode":"light","pageFocusDefault":true,"enableJsNav":true,"entrance":"fade","stagger":"sequential","keyboardArrows":true,"nextHref":"./page-2.html","currentPage":1,"slugs":["page-1","page-2"],"sidebarPreferenceKey":"praxity-sidebar-course"}</script>
	`;
	document.body.innerHTML = `
		<nav id="praxity-page-nav"><a href="./page-2.html">Next</a></nav>
		<nav id="praxity-embed-nav"><a href="./page-2.html">Next</a></nav>
		<main id="main-content">
			<a id="content-link" href="https://example.com">Link</a>
			<button id="content-button" type="button">Button</button>
			<audio id="audio" autoplay></audio>
		</main>
	`;
	const audio = document.getElementById("audio") as HTMLAudioElement;
	const pause = vi.fn();
	Object.defineProperty(audio, "pause", { configurable: true, value: pause });
	const link = document.getElementById("content-link");
	const click = new MouseEvent("click", { bubbles: true, cancelable: true });

	initializeCourseShell();

	expect(document.documentElement.dataset.praxitySmallPreview).toBe("true");
	expect(document.documentElement.classList.contains("praxity-shell-ready")).toBe(true);
	expect(document.documentElement.classList.contains("praxity-js")).toBe(false);
	expect(document.documentElement.dataset.praxityMotionEntrance).toBeUndefined();
	expect(document.body.classList.contains("praxity-minimal")).toBe(true);
	expect(document.body.classList.contains("praxity-small-preview")).toBe(true);
	expect(document.body.classList.contains("praxity-sidebar-collapsed")).toBe(false);
	expect(audio.autoplay).toBe(false);
	expect(audio.hasAttribute("autoplay")).toBe(false);
	expect(audio.preload).toBe("none");
	expect(pause).toHaveBeenCalledOnce();

	link?.dispatchEvent(click);
	expect(click.defaultPrevented).toBe(true);

	const button = document.getElementById("content-button");
	const buttonClick = vi.fn();
	button?.addEventListener("click", buttonClick);
	button?.click();
	expect(buttonClick).not.toHaveBeenCalled();

	document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
	expect(window.__praxityNavigatePageHref).toBeUndefined();
});

it("projects only the requested module slide without transcript or transport", () => {
	history.replaceState(null, "", "/course/module.html?praxity-small-preview=1#slide-2");
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page"}</script>';
	document.body.innerHTML =
		'<main><article data-deck-slide="slide-1">One</article><article data-deck-slide="slide-2">Two</article><div class="deck-panels"><details id="deck-outline">Outline</details><details id="deck-script" open>Script</details></div><nav data-deck-enhanced>Transport</nav><div class="deck-utilities">Tools</div><div class="deck-module-links">Modules</div></main>';
	const writes = vi.spyOn(Storage.prototype, "setItem");
	initializeCourseShell();
	document.dispatchEvent(new Event("DOMContentLoaded"));
	expect(
		[...document.querySelectorAll<HTMLElement>("[data-deck-slide]")].map((slide) => slide.hidden),
	).toEqual([true, false]);
	for (const node of document.querySelectorAll<HTMLElement>(
		"#deck-script,.deck-panels,[data-deck-enhanced],.deck-utilities,.deck-module-links",
	))
		expect(node.hidden).toBe(true);
	expect(writes).not.toHaveBeenCalled();
});

it.each(["API", "API_1484_11"])(
	"preserves %s communication through an explicit index page target",
	(property) => {
		const api = {};
		writeSessionState(api, true);
		document.head.innerHTML =
			'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"redirect","target":"intro.html","pageIdMap":{"stable":"summary"}}</script>';
		const replace = vi.fn();
		try {
			vi.stubGlobal("window", { opener: { [property]: api } });
			vi.stubGlobal("location", {
				href: "https://course.example/index.html?praxity-page=stable",
				search: "?praxity-page=stable&token=launch",
				hash: "#slide",
				replace,
			});
			initializeCourseShell();
			expect(readSessionState(api)).toBe(true);
			expect(replace).toHaveBeenCalledExactlyOnceWith(
				"https://course.example/summary.html?token=launch&praxity-resume=0#slide",
			);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

it.each(["API", "API_1484_11"])(
	"clears %s's launch marker before redirecting with URL state intact",
	(property) => {
		const api = {};
		writeSessionState(api, true);
		document.head.innerHTML =
			'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"redirect","target":"intro.html","pageIdMap":{"stable":"summary"}}</script>';
		const replace = vi.fn(() => expect(readSessionState(api)).toBe(false));
		try {
			vi.stubGlobal("window", { opener: { [property]: api } });
			vi.stubGlobal("location", {
				href: "https://course.example/index.html",
				search: "?token=launch",
				hash: "#slide",
				replace,
			});
			initializeCourseShell();
			expect(replace).toHaveBeenCalledExactlyOnceWith(
				"https://course.example/intro.html?token=launch#slide",
			);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

it("preserves the session marker on page and slide alias redirects", () => {
	const api = {};
	writeSessionState(api, true);
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"redirect","target":"module.html#slide"}</script>';
	const replace = vi.fn();
	try {
		vi.stubGlobal("window", { parent: { API: api } });
		vi.stubGlobal("location", {
			href: "https://course.example/page-2.html",
			search: "?token=launch",
			hash: "",
			replace,
		});
		initializeCourseShell();
		expect(readSessionState(api)).toBe(true);
		expect(replace).toHaveBeenCalledExactlyOnceWith(
			"https://course.example/module.html?token=launch#slide",
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

it.each(["missing", "discovery throws", "marker write throws"])(
	"still redirects when the LMS is %s",
	(failure) => {
		const win = failure === "marker write throws" ? { API: Object.freeze({}) } : {};
		if (failure === "discovery throws") {
			Object.defineProperty(win, "parent", {
				get: () => {
					throw new Error("Blocked");
				},
			});
		}
		document.head.innerHTML =
			'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"redirect","target":"intro.html","pageIdMap":{}}</script>';
		const replace = vi.fn();
		try {
			vi.stubGlobal("window", win);
			vi.stubGlobal("location", {
				href: "https://course.example/index.html",
				search: "",
				hash: "",
				replace,
			});
			initializeCourseShell();
			expect(replace).toHaveBeenCalledExactlyOnceWith("https://course.example/intro.html");
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

it("blocks keyboard fallback through the shared authored gate and allows backward navigation", () => {
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","keyboardArrows":true,"nextHref":"./page-3.html","previousHref":"./page-1.html","currentPage":2,"slugs":["page-1","page-2","page-3"]}</script>';
	const navigate = vi.fn(() => true);
	window.__praxityNavigatePageHref = navigate;
	window.__praxityLogicEngine = {
		evaluate: vi.fn(),
		getJumpTarget: () => null,
		isCompletionBlocked: () => true,
	};
	initializeCourseShell();
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
	expect(navigate).not.toHaveBeenCalled();
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
	expect(navigate).toHaveBeenCalledWith("./page-1.html");
	delete window.__praxityLogicEngine;
});

it("restores a configured fallback destination and host decoration after the gate releases", () => {
	document.head.innerHTML =
		'<script id="praxity-shell-config" type="application/json">{"version":1,"kind":"page","keyboardArrows":true,"nextHref":"../next.html?mode=embed","currentPage":1,"slugs":["page-1","next"]}</script>';
	const navigate = vi.fn(() => true);
	window.__praxityNavigatePageHref = navigate;
	window.__praxityDecoratePageHref = (href) => `${href}&host=1`;
	let blocked = true;
	window.__praxityLogicEngine = {
		evaluate: vi.fn(),
		getJumpTarget: () => null,
		isCompletionBlocked: () => blocked,
	};
	try {
		initializeCourseShell();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(navigate).not.toHaveBeenCalled();
		blocked = false;
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(navigate).toHaveBeenCalledExactlyOnceWith("../next.html?mode=embed&host=1");
	} finally {
		delete window.__praxityLogicEngine;
		delete window.__praxityDecoratePageHref;
	}
});
