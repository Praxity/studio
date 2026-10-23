import { afterEach, describe, expect, it, vi } from "vitest";
import { navigatePage, navigatePageAction, navigateUtilityPage, pageHref } from "../navigate-page";

const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
	Element.prototype,
	"scrollIntoView",
);

const actionConfig = {
	currentPage: 2,
	currentSlug: "two",
	basePath: "/course",
	pages: [{ slug: "one" }, { slug: "two" }, { slug: "three" }],
	pageIdMap: { "page-one": "one", "page-two": "two", "page-three": "three" },
};

function spyOnLocationHref() {
	const hrefSpy = vi.fn<(value: string) => void>();
	Object.defineProperty(window, "location", {
		configurable: true,
		value: {
			set href(value: string) {
				hrefSpy(value);
			},
		},
	});
	return hrefSpy;
}

afterEach(() => {
	delete window.__praxityDecoratePageHref;
	delete window.__praxityNavigatePageHref;
	if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
	if (scrollIntoViewDescriptor) {
		Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
	} else {
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	}
	delete window.__praxityLogicEngine;
	delete window.__praxityPageIdMap;
	delete window.__praxityTracker;
	delete window.__praxityRuntime;
	document.body.innerHTML = "";
	sessionStorage.clear();
});

describe("pageHref", () => {
	it("stays relative without a base path so file:// and subdirectory exports resolve", () => {
		expect(pageHref("glossary")).toBe("./glossary.html");
		expect(pageHref("page-2", "")).toBe("./page-2.html");
	});

	it("lets a target host preserve its navigation context", () => {
		const hrefSpy = spyOnLocationHref();
		window.__praxityDecoratePageHref = (href) => `${href}?host=preview`;
		navigateUtilityPage("resources");
		expect(hrefSpy).toHaveBeenCalledWith("./resources.html?host=preview");
	});

	it("lets a target host acknowledge navigation before the document unloads", () => {
		const hrefSpy = spyOnLocationHref();
		const navigate = vi.fn(() => true);
		window.__praxityNavigatePageHref = navigate;
		navigateUtilityPage("resources");
		expect(navigate).toHaveBeenCalledWith("./resources.html");
		expect(hrefSpy).not.toHaveBeenCalled();
	});

	it("uses the base path when the course is hosted under one", () => {
		expect(pageHref("glossary", "/c/abc123")).toBe("/c/abc123/glossary.html");
		expect(pageHref("glossary", "/c/abc123/")).toBe("/c/abc123/glossary.html");
	});
});

describe("navigatePage", () => {
	it("resolves and tracks a forward logic jump through the shared path", () => {
		const hrefSpy = spyOnLocationHref();
		const evaluate = vi.fn();
		const getJumpTarget = vi.fn(() => "branch-page-id");
		const trackNavigation = vi.fn();
		window.__praxityLogicEngine = { evaluate, getJumpTarget };
		window.__praxityPageIdMap = { "branch-page-id": "branch-page" };
		window.__praxityTracker = {};
		window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };

		navigatePage({
			targetSlug: "next-page",
			direction: "forward",
			currentSlug: "current-page",
			basePath: "/course",
		});

		expect(evaluate).toHaveBeenCalledOnce();
		expect(getJumpTarget).toHaveBeenCalledOnce();
		expect(trackNavigation).toHaveBeenCalledWith("current-page", "branch-page-id", "logic-rule");
		expect(hrefSpy).toHaveBeenCalledWith("/course/branch-page.html");
		expect(sessionStorage.getItem("praxity:focus-page-content")).toBe("true");
	});

	it("keeps slug tracking as a compatibility fallback when no stable ID map is available", () => {
		const hrefSpy = spyOnLocationHref();
		const trackNavigation = vi.fn();
		window.__praxityTracker = {};
		window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };

		navigatePage({
			targetSlug: "next-page",
			direction: "forward",
			currentSlug: "current-page",
		});

		expect(trackNavigation).toHaveBeenCalledWith("current-page", "next-page", "linear");
		expect(hrefSpy).toHaveBeenCalledWith("./next-page.html");
	});
});

describe("navigatePageAction", () => {
	it("resolves explicit forward and backward page IDs as button navigation", () => {
		const hrefSpy = spyOnLocationHref();
		const evaluate = vi.fn();
		const trackNavigation = vi.fn();
		window.__praxityLogicEngine = { evaluate, getJumpTarget: vi.fn(() => "page-one") };
		window.__praxityTracker = {};
		window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };

		expect(navigatePageAction("page-three", actionConfig)).toBe(true);
		expect(hrefSpy).toHaveBeenLastCalledWith("/course/three.html");
		expect(trackNavigation).toHaveBeenLastCalledWith("page-two", "page-three", "button");
		expect(evaluate).toHaveBeenCalledOnce();

		expect(navigatePageAction("page-one", actionConfig)).toBe(true);
		expect(hrefSpy).toHaveBeenLastCalledWith("/course/one.html");
		expect(trackNavigation).toHaveBeenLastCalledWith("page-two", "page-one", "button");
	});

	it("resolves the next-page token and leaves unresolved or current targets alone", () => {
		const hrefSpy = spyOnLocationHref();
		const trackNavigation = vi.fn();
		window.__praxityTracker = {};
		window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };

		expect(navigatePageAction("__next_page__", actionConfig)).toBe(true);
		expect(hrefSpy).toHaveBeenCalledWith("/course/three.html");
		sessionStorage.clear();

		expect(navigatePageAction("page-two", actionConfig)).toBe(false);
		expect(navigatePageAction("missing", actionConfig)).toBe(false);
		expect(
			navigatePageAction("__next_page__", {
				...actionConfig,
				currentPage: 3,
				currentSlug: "three",
			}),
		).toBe(false);
		expect(hrefSpy).toHaveBeenCalledTimes(1);
		expect(trackNavigation).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem("praxity:focus-page-content")).toBeNull();
	});

	it("gates forward actions on required blocks but allows backward actions", () => {
		const hrefSpy = spyOnLocationHref();
		Object.defineProperty(Element.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		document.body.innerHTML =
			'<button type="button" data-required="true" data-block-type="assessment">Question</button>';
		const setCompletion = vi.fn();
		window.__praxityRuntime = { setCompletion };

		expect(navigatePageAction("page-three", actionConfig)).toBe(false);
		expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(false);
		expect(hrefSpy).not.toHaveBeenCalled();
		expect(setCompletion).not.toHaveBeenCalled();
		expect(document.activeElement?.textContent).toBe("Question");

		expect(navigatePageAction("page-one", actionConfig)).toBe(true);
		expect(hrefSpy).toHaveBeenCalledWith("/course/one.html");
	});

	it("completes and commits the course for the end token", () => {
		const hrefSpy = spyOnLocationHref();
		const setCompletion = vi.fn();
		const commit = vi.fn();
		window.__praxityRuntime = { setCompletion, commit };

		expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(true);
		expect(setCompletion).toHaveBeenCalledWith("completed");
		expect(commit).toHaveBeenCalledOnce();
		expect(hrefSpy).not.toHaveBeenCalled();
		expect(sessionStorage.getItem("praxity:focus-page-content")).toBeNull();
	});
});

describe("authored forward gate", () => {
	it.each(["linear", "button", "module"] as const)(
		"blocks %s navigation before jumps, tracking or completion",
		(trigger) => {
			const hrefSpy = spyOnLocationHref();
			const getJumpTarget = vi.fn(() => "__end_lesson__");
			const evaluate = vi.fn();
			const setCompletion = vi.fn();
			const commit = vi.fn();
			const trackNavigation = vi.fn();
			window.__praxityLogicEngine = { evaluate, getJumpTarget, isCompletionBlocked: () => true };
			window.__praxityRuntime = { setCompletion, commit };
			window.__praxityTracker = {};
			window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };
			expect(
				navigatePage({ targetSlug: "three", direction: "forward", currentSlug: "two", trigger }),
			).toBe(false);
			expect(evaluate).toHaveBeenCalledOnce();
			expect(getJumpTarget).not.toHaveBeenCalled();
			expect(hrefSpy).not.toHaveBeenCalled();
			expect(setCompletion).not.toHaveBeenCalled();
			expect(commit).not.toHaveBeenCalled();
			expect(trackNavigation).not.toHaveBeenCalled();
			expect(sessionStorage.getItem("praxity:focus-page-content")).toBeNull();
		},
	);

	it("blocks authored next, page jumps and end actions, allows backward recovery and releases on re-evaluation", () => {
		const hrefSpy = spyOnLocationHref();
		let blocked = true;
		window.__praxityLogicEngine = {
			evaluate: vi.fn(),
			getJumpTarget: () => null,
			isCompletionBlocked: () => blocked,
		};
		const setCompletion = vi.fn();
		window.__praxityRuntime = { setCompletion };
		for (const target of ["__next_page__", "page-three", "__end_lesson__"])
			expect(navigatePageAction(target, actionConfig)).toBe(false);
		expect(hrefSpy).not.toHaveBeenCalled();
		expect(setCompletion).not.toHaveBeenCalled();
		expect(navigatePageAction("page-one", actionConfig)).toBe(true);
		blocked = false;
		expect(navigatePageAction("__next_page__", actionConfig)).toBe(true);
		expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(true);
		expect(setCompletion).toHaveBeenCalledWith("completed");
	});
});
