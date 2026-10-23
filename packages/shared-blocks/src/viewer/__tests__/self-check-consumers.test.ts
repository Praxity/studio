import { afterEach, expect, it, vi } from "vitest";
import { navigateFallbackPageHref, navigatePage, navigatePageAction } from "../navigate-page";
import { checkRequiredBlocks } from "../required-blocks";

afterEach(() => {
	document.documentElement.removeAttribute("data-self-check-dependencies");
	delete window.__praxityNavigatePageHref;
	delete window.__praxityLogicEngine;
	delete window.__praxityRuntime;
	document.body.replaceChildren();
});

it("blocks every forward action before the session owner arrives, with no logic or completion effects", () => {
	document.documentElement.setAttribute("data-self-check-dependencies", "A");
	const navigate = vi.fn(() => true),
		evaluate = vi.fn(),
		completion = vi.fn();
	window.__praxityNavigatePageHref = navigate;
	window.__praxityLogicEngine = { evaluate, getJumpTarget: () => "__end_lesson__" };
	window.__praxityRuntime = { setCompletion: completion };
	expect(navigateFallbackPageHref("next.html", "forward")).toBe(false);
	for (const trigger of ["linear", "button", "module"] as const)
		expect(navigatePage({ targetSlug: "next", direction: "forward", trigger })).toBe(false);
	expect(
		navigatePageAction("__end_lesson__", {
			currentPage: 1,
			currentSlug: "first",
			pages: [{ slug: "first" }],
			pageIdMap: {},
		}),
	).toBe(false);
	expect(evaluate).not.toHaveBeenCalled();
	expect(completion).not.toHaveBeenCalled();
	expect(navigate).not.toHaveBeenCalled();
	expect(navigateFallbackPageHref("previous.html", "backward")).toBe(true);
});

it("refuses a raw restored completion flag before admission", () => {
	document.documentElement.setAttribute("data-self-check-dependencies", "A");
	document.body.innerHTML =
		'<div data-block-id="A" data-required="true" data-block-type="selfCheck" data-completed="true"><div data-self-check data-self-check-id="A"><textarea></textarea></div></div>';
	expect(checkRequiredBlocks().valid).toBe(false);
});
