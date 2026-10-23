import { afterEach, expect, it, vi } from "vitest";
import { navigatePage } from "./navigate-page";

const required = vi.hoisted(() => vi.fn(() => true));
vi.mock("./required-blocks", () => ({
	clearRequiredValidation: vi.fn(),
	showRequiredValidation: required,
}));

afterEach(() => {
	delete window.__praxityNavigatePageHref;
	delete window.__praxityLogicEngine;
	vi.clearAllMocks();
});

it("allows direct module visits while Next still checks required blocks", () => {
	const navigate = vi.fn(() => true);
	const evaluate = vi.fn();
	window.__praxityNavigatePageHref = navigate;
	window.__praxityLogicEngine = { evaluate, getJumpTarget: () => "elsewhere" };
	expect(navigatePage({ targetSlug: "module-two", direction: "forward", trigger: "module" })).toBe(
		true,
	);
	expect(navigate).toHaveBeenCalledWith("./module-two.html");
	expect(required).not.toHaveBeenCalled();
	expect(evaluate).toHaveBeenCalledOnce();
	expect(navigatePage({ targetSlug: "module-two", direction: "forward" })).toBe(false);
	expect(required).toHaveBeenCalledOnce();
});
