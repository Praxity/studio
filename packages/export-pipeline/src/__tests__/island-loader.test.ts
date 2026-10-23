/** @vitest-environment jsdom */

import { strings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import { beforeEach, expect, it, vi } from "vitest";
import { enhanceRetrievalSheet } from "../patterns/retrieval-sheet/enhance";
import { renderRetrievalSheet } from "../patterns/retrieval-sheet/render";

vi.mock("@praxity/shared-blocks/motion", () => ({ installEntranceMotionGlobal: vi.fn() }));

beforeEach(() => {
	vi.resetModules();
	history.replaceState(null, "", "/course/page-1.html");
	document.documentElement.dataset.praxityIslands = "missing";
	document.documentElement.dataset.praxityLearnerState = "pending";
	document.documentElement.removeAttribute("data-praxity-islands-ready");
	document.head.innerHTML = '<script src="https://course.test/island-loader.js"></script>';
	document.body.innerHTML = '<div data-island="missing"></div>';
});

it("reports a required Electron island failure instead of announcing readiness", async () => {
	const failed = vi.fn();
	const ready = vi.fn();
	window.addEventListener("praxity:islands-failed", failed, { once: true });
	window.addEventListener("praxity:islands-ready", ready, { once: true });
	await import("../../template/src/island-bootstrap");

	window.dispatchEvent(new CustomEvent("praxity:runtime-ready"));

	await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
	expect(ready).not.toHaveBeenCalled();
	expect(document.documentElement.dataset.praxityIslandsReady).toBeUndefined();
});

it("loads decoration and read-only group presentation islands for small previews", async () => {
	history.replaceState(null, "", "/course/page-1.html?praxity-small-preview=1");
	document.documentElement.dataset.praxityIslands = "nav,media,code,assessment";
	document.body.innerHTML = "";

	const { islandNamesForPreview } = await import("../../template/src/island-loader");

	expect(
		islandNamesForPreview(["nav", "media", "code", "table", "assessmentGroup", "assessment"], true),
	).toEqual(["code", "table", "assessmentGroup"]);
	expect(islandNamesForPreview(["nav", "code", "nav"], false)).toEqual(["nav", "code"]);
});

it("a failed retrieval chunk only marks unenhanced sheets unavailable", async () => {
	document.documentElement.dataset.praxityIslands = "retrievalSheet";
	document.body.innerHTML = ["working", "baseline"]
		.map(
			(id) =>
				`<div id="${id}" data-island="retrievalSheet">${renderRetrievalSheet({ title: "Recall", questions: [{ id: "q", question: "Q", answer: "A" }] }, { prefix: id, lang: "en", headingLevel: 2, strings: strings.en, noDate: "No date selected" })}</div>`,
		)
		.join("");
	const working = document.querySelector<HTMLElement>("#working [data-retrieval-sheet]");
	if (!working) throw new Error("Missing working sheet fixture");
	const instance = enhanceRetrievalSheet(working);
	const before = working.innerHTML;
	try {
		await import("../../template/src/island-bootstrap");
		window.dispatchEvent(new CustomEvent("praxity:runtime-ready"));
		const baselineStatus = document.querySelector<HTMLElement>("#baseline [data-retrieval-status]");
		if (!baselineStatus) throw new Error("Missing baseline status fixture");
		await vi.waitFor(() =>
			expect(baselineStatus.textContent).toBe(
				"Date and side controls are unavailable. Both sides remain readable and printable.",
			),
		);
		expect(baselineStatus.className).toBe("praxity-retrieval-sheet-secondary");
		expect(working.hasAttribute("data-retrieval-enhanced")).toBe(true);
		expect(working.innerHTML).toBe(before);
		expect(working.querySelector("[data-retrieval-status]")?.textContent).toBe("");
	} finally {
		instance.destroy();
	}
});
