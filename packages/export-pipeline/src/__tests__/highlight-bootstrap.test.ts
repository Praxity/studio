/** @vitest-environment jsdom */
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import { beforeEach, expect, it, vi } from "vitest";
import { renderHighlight } from "../patterns/highlight/render";

const { loadBrowserModule, enhanceHighlight } = vi.hoisted(() => ({
	loadBrowserModule: vi.fn(),
	enhanceHighlight: vi.fn(),
}));
vi.mock("../patterns/highlight/enhance", () => ({ enhanceHighlight }));
vi.mock("../../template/src/island-loader", () => ({
	loadBrowserModule,
	islandNamesForPreview: (names: Iterable<string>) => [...names],
}));
vi.mock("@praxity/shared-blocks/motion", () => ({ installEntranceMotionGlobal: vi.fn() }));

beforeEach(() => {
	vi.resetModules();
	loadBrowserModule.mockReset();
	enhanceHighlight.mockReset();
	delete window.__praxitySelfCheckDocument;
	document.documentElement.dataset.praxityIslands = "highlight";
	delete document.documentElement.dataset.praxityLearnerState;
	delete document.documentElement.dataset.praxityIslandsReady;
	document.head.innerHTML = '<script src="https://course.test/island-loader.js"></script>';
	document.body.innerHTML = `<button id="outside">Outside</button><div data-island="highlight">${renderHighlight({ mode: "key", title: "Pause", paragraphs: [[{ id: "one", text: "Target", key: true }]] }, { prefix: "hl", lang: "fr", headingLevel: 2 })}</div>`;
});
const root = () => document.querySelector<HTMLElement>("[data-highlight]")!;
const status = () => root().querySelector<HTMLElement>("[data-highlight-status]")!;

it("rejected imports restore the baseline and fill its one existing status exactly once", async () => {
	loadBrowserModule.mockRejectedValue(new Error("denied"));
	const updates: string[] = [];
	const observer = new MutationObserver(() => updates.push(status().textContent ?? ""));
	observer.observe(status(), { childList: true });
	document.querySelector<HTMLButtonElement>("#outside")!.focus();
	await import("../../template/src/island-bootstrap");
	await vi.waitFor(() =>
		expect(status().textContent).toBe(getHighlightStrings("fr").highlightUnavailable),
	);
	expect(status().classList.contains("praxity-sr-only")).toBe(false);
	expect(status().classList.contains("praxity-assessment-choice-hint")).toBe(true);
	expect(root().querySelector<HTMLDetailsElement>("details")!.hidden).toBe(false);
	expect(document.activeElement?.id).toBe("outside");
	expect(updates).toEqual([getHighlightStrings("fr").highlightUnavailable]);
	expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
	observer.disconnect();
});

it("rolls back a partial attach before announcing and moves removed control focus to Answer", async () => {
	const states: boolean[] = [];
	const observer = new MutationObserver(() =>
		states.push(
			root().querySelector<HTMLElement>("[data-highlight-flow]")!.hidden &&
				!root().querySelector<HTMLDetailsElement>("details")!.hidden,
		),
	);
	observer.observe(status(), { childList: true });
	enhanceHighlight.mockImplementation(() => {
		const flow = root().querySelector<HTMLElement>("[data-highlight-flow]")!;
		flow.hidden = false;
		const button = document.createElement("button");
		button.dataset.praxityJsControl = "";
		button.textContent = "Injected";
		flow.append(button);
		button.focus();
		const chunk = root().querySelector<HTMLElement>("[data-highlight-chunk]")!;
		chunk.setAttribute("data-highlight-outcome", "wrong");
		const feedback = root().querySelector<HTMLElement>("[data-highlight-feedback]")!;
		feedback.setAttribute("data-highlight-outcome", "wrong");
		feedback.textContent = "Stale";
		feedback.hidden = false;
		root().querySelector<HTMLDetailsElement>("details")!.hidden = true;
		throw new Error("attach");
	});
	loadBrowserModule.mockResolvedValue(await import("../../template/src/islands/island-highlight"));
	await import("../../template/src/island-bootstrap");
	await vi.waitFor(() =>
		expect(status().textContent).toBe(getHighlightStrings("fr").highlightUnavailable),
	);
	expect(root().querySelector<HTMLElement>("[data-highlight-flow]")!.hidden).toBe(true);
	expect(root().querySelector<HTMLDetailsElement>("details")!.hidden).toBe(false);
	expect(root().querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
	expect(document.activeElement).toBe(root().querySelector("summary"));
	expect(root().textContent).not.toContain("Injected");
	expect(states).toEqual([true]);
	expect(root().querySelectorAll("[data-highlight-outcome]")).toHaveLength(0);
	expect(root().querySelector("[data-highlight-feedback]")?.textContent).toBe("");
	observer.disconnect();
});

it("does not overwrite an existing notice or a successfully enhanced root", async () => {
	loadBrowserModule.mockRejectedValue(new Error("denied"));
	status().textContent = "Existing";
	await import("../../template/src/island-bootstrap");
	await vi.waitFor(() => expect(loadBrowserModule).toHaveBeenCalledOnce());
	await new Promise((done) => setTimeout(done, 0));
	expect(status().textContent).toBe("Existing");
	vi.resetModules();
	root().dataset.highlightEnhanced = "";
	status().textContent = "";
	await import("../../template/src/island-bootstrap");
	await new Promise((done) => setTimeout(done, 0));
	expect(status().textContent).toBe("");
	expect(root().hasAttribute("data-highlight-enhanced")).toBe(true);
});

it.each([false, true])(
	"settles a loaded rejection only for its current lifetime: %s",
	async (currentAtFailure) => {
		let current = true;
		const lifetime = { current: () => current };
		window.__praxitySelfCheckDocument = {
			loadTicket: () => () => current,
			lifetime: () => lifetime,
			isAdmitted: () => true,
			consumers: { finalize: vi.fn() },
		} as unknown as NonNullable<typeof window.__praxitySelfCheckDocument>;
		let reject!: (error: Error) => void;
		loadBrowserModule.mockReturnValue(
			new Promise((_, no) => {
				reject = no;
			}),
		);
		await import("../../template/src/island-bootstrap");
		expect(loadBrowserModule).toHaveBeenCalledOnce();
		current = currentAtFailure;
		reject(new Error("late denial"));
		await new Promise((done) => setTimeout(done, 0));
		expect(status().textContent).toBe(
			currentAtFailure ? getHighlightStrings("fr").highlightUnavailable : "",
		);
	},
);

it.each(["denied", "attach", "missing adapter"])(
	"keeps %s failure local in pending preview with an admitted owner",
	async (failure) => {
		document.documentElement.dataset.praxityLearnerState = "pending";
		const lifetime = { current: () => true };
		const finalize = vi.fn(),
			ready = vi.fn(),
			failed = vi.fn();
		window.__praxitySelfCheckDocument = {
			loadTicket: () => () => true,
			lifetime: () => lifetime,
			isAdmitted: () => true,
			consumers: { finalize },
		} as unknown as NonNullable<typeof window.__praxitySelfCheckDocument>;
		window.addEventListener("praxity:islands-ready", ready);
		window.addEventListener("praxity:islands-failed", failed);
		try {
			if (failure === "denied") loadBrowserModule.mockRejectedValue(new Error("denied"));
			else if (failure === "missing adapter") loadBrowserModule.mockResolvedValue({});
			else {
				enhanceHighlight.mockImplementation(() => {
					throw new Error("attach");
				});
				loadBrowserModule.mockResolvedValue(
					await import("../../template/src/islands/island-highlight"),
				);
			}
			await import("../../template/src/island-bootstrap");
			await vi.waitFor(() =>
				expect(status().textContent).toBe(getHighlightStrings("fr").highlightUnavailable),
			);
			expect(loadBrowserModule).toHaveBeenCalledOnce();
			expect(ready).toHaveBeenCalledOnce();
			expect(failed).not.toHaveBeenCalled();
			expect(finalize).toHaveBeenCalledOnce();
			expect(document.documentElement.dataset.praxityIslandsReady).toBe("true");
			expect(document.documentElement.hasAttribute("data-praxity-fallback")).toBe(false);
		} finally {
			window.removeEventListener("praxity:islands-ready", ready);
			window.removeEventListener("praxity:islands-failed", failed);
		}
	},
);

it("adapter rolls back earlier instances and captures focus before destroy removes it", async () => {
	const first = root();
	const second = first.cloneNode(true) as HTMLElement;
	first.after(second);
	const enhanced = first.cloneNode(true) as HTMLElement;
	enhanced.dataset.highlightEnhanced = "";
	enhanced.querySelector<HTMLElement>("[data-highlight-flow]")!.hidden = false;
	enhanced.querySelector<HTMLDetailsElement>("details")!.hidden = true;
	second.after(enhanced);
	const button = document.createElement("button");
	button.dataset.praxityJsControl = "";
	const destroy = vi.fn(() => button.remove());
	enhanceHighlight.mockImplementation((node: HTMLElement) => {
		node.querySelector<HTMLElement>("[data-highlight-flow]")!.hidden = false;
		node.querySelector<HTMLDetailsElement>("details")!.hidden = true;
		if (node === second) throw new Error("second attach");
		node.querySelector("[data-highlight-flow]")!.append(button);
		button.focus();
		return { destroy };
	});
	const { attachIsland } = await import("../../template/src/islands/island-highlight");
	expect(() => attachIsland()).toThrow("second attach");
	expect(enhanceHighlight).toHaveBeenCalledTimes(2);
	expect(destroy).toHaveBeenCalledOnce();
	for (const node of [first, second]) {
		expect(node.querySelector<HTMLElement>("[data-highlight-flow]")!.hidden).toBe(true);
		expect(node.querySelector<HTMLDetailsElement>("details")!.hidden).toBe(false);
		expect(
			node.querySelector(
				"[data-praxity-js-control]:not([data-highlight-check]):not([data-highlight-restart])",
			),
		).toBeNull();
	}
	expect(document.activeElement).toBe(first.querySelector("summary"));
	expect(enhanced.querySelector<HTMLElement>("[data-highlight-flow]")!.hidden).toBe(false);
	expect(enhanced.querySelector<HTMLDetailsElement>("details")!.hidden).toBe(true);
});

it("uses textContent for failure copy and preserves the untouched denied-import baseline", async () => {
	const copy = "<b>Unavailable & readable</b>";
	status().dataset.highlightUnavailable = copy;
	const states: boolean[] = [];
	const observer = new MutationObserver(() =>
		states.push(
			root().querySelector<HTMLElement>("[data-highlight-flow]")!.hidden &&
				!root().querySelector<HTMLDetailsElement>("details")!.hidden,
		),
	);
	observer.observe(status(), { childList: true });
	loadBrowserModule.mockRejectedValue(new Error("denied"));
	await import("../../template/src/island-bootstrap");
	await vi.waitFor(() => expect(status().textContent).toBe(copy));
	expect(status().children).toHaveLength(0);
	expect(states).toEqual([true]);
	observer.disconnect();
});

it("successful attachment clears an old failure silently and reveals controls", async () => {
	const { enhanceHighlight } = await vi.importActual<
		typeof import("../patterns/highlight/enhance")
	>("../patterns/highlight/enhance");
	status().textContent = "Previous failure";
	status().className = "praxity-assessment-choice-hint";
	const instance = enhanceHighlight(root());
	expect(status().textContent).toBe("");
	expect(status().className).toBe("praxity-sr-only");
	expect(root().querySelector<HTMLElement>("[data-highlight-flow]")!.hidden).toBe(false);
	expect(root().querySelector<HTMLDetailsElement>("details")!.hidden).toBe(true);
	instance.destroy();
	expect(root().querySelector<HTMLDetailsElement>("details")!.hidden).toBe(true);
});

it("keeps retrieval notices local to unenhanced roots through the shared status rule", async () => {
	document.documentElement.dataset.praxityIslands = "retrievalSheet";
	document.body.innerHTML = `<div data-island="retrievalSheet">
 <div data-retrieval-sheet><div role="status" class="praxity-sr-only" data-retrieval-status data-retrieval-unavailable="Unavailable &amp; readable"></div></div>
 <div data-retrieval-sheet data-retrieval-enhanced><div role="status" class="praxity-sr-only" data-retrieval-status data-retrieval-unavailable="Ignore"></div></div></div>`;
	loadBrowserModule.mockRejectedValue(new Error("denied"));
	await import("../../template/src/island-bootstrap");
	const statuses = document.querySelectorAll<HTMLElement>("[data-retrieval-status]");
	await vi.waitFor(() => expect(statuses[0].textContent).toBe("Unavailable & readable"));
	expect(loadBrowserModule).toHaveBeenCalledOnce();
	expect(statuses[0].className).toBe("praxity-retrieval-sheet-secondary");
	expect(statuses[1].textContent).toBe("");
});
