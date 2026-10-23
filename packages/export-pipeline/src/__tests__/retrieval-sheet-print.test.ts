// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	cancelRetrievalSheetPrint,
	printRetrievalSheet,
} from "../../template/src/retrieval-sheet-print";

let media: MediaQueryList;
let change: EventTarget;
const roots: HTMLElement[] = [];
function printMedia(matches: boolean) {
	Object.assign(media, { matches });
	change.dispatchEvent(Object.assign(new Event("change"), { matches }));
}
function sheet(parent: HTMLElement = document.body, id = "sheet") {
	const wrapper = document.createElement("div");
	wrapper.dataset.blockType = "retrievalSheet";
	wrapper.dataset.blockId = id;
	wrapper.innerHTML = "<div data-retrieval-sheet><button>Print</button></div>";
	parent.append(wrapper);
	const root = wrapper.firstElementChild as HTMLElement;
	roots.push(root);
	return root;
}
function clean() {
	// jsdom queues zero-delay focus bookkeeping independently of the print owner.
	vi.advanceTimersByTime(0);
	expect(
		document.querySelector(
			"[data-praxity-retrieval-print], [data-praxity-print-selected], [data-praxity-print-path]",
		),
	).toBeNull();
	expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
	vi.useFakeTimers();
	change = new EventTarget();
	media = Object.assign(change, {
		matches: false,
		media: "print",
		onchange: null,
	}) as MediaQueryList;
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => media),
	);
	vi.spyOn(window, "print").mockImplementation(() => {});
});
afterEach(() => {
	for (const root of roots.splice(0)) cancelRetrievalSheetPrint(root);
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("marks only the selected nested instance and its ancestor path, retaining scope after print returns", () => {
	const outer = sheet(document.body, "outer"),
		inner = sheet(outer, "inner"),
		other = sheet(document.body, "other");
	printRetrievalSheet(inner);
	expect(window.print).toHaveBeenCalledTimes(1);
	expect(document.documentElement.dataset.praxityRetrievalPrint).toBe("inner");
	expect(inner.hasAttribute("data-praxity-print-selected")).toBe(true);
	expect(outer.hasAttribute("data-praxity-print-path")).toBe(true);
	expect(other.hasAttribute("data-praxity-print-path")).toBe(false);
	expect(document.querySelectorAll("[data-praxity-print-selected]")).toHaveLength(1);
	expect(() => printRetrievalSheet(other)).toThrow();
	cancelRetrievalSheetPrint(outer);
	expect(inner.hasAttribute("data-praxity-print-selected")).toBe(true);
	window.dispatchEvent(new Event("afterprint"));
	clean();
	printRetrievalSheet(outer);
	expect(document.documentElement.dataset.praxityRetrievalPrint).toBe("outer");
});

it.each(["afterprint", "media", "timeout", "pagehide", "destroy", "throw"])(
	"cleans every resource on %s and permits the next request",
	(ending) => {
		const root = sheet();
		const add = vi.spyOn(window, "addEventListener"),
			remove = vi.spyOn(window, "removeEventListener");
		const docAdd = vi.spyOn(document, "addEventListener"),
			docRemove = vi.spyOn(document, "removeEventListener");
		const mediaAdd = vi.spyOn(media, "addEventListener"),
			mediaRemove = vi.spyOn(media, "removeEventListener");
		if (ending === "throw")
			vi.mocked(window.print).mockImplementationOnce(() => {
				throw new Error("refused");
			});
		if (ending === "throw") expect(() => printRetrievalSheet(root)).toThrow("refused");
		else {
			printRetrievalSheet(root);
			if (ending === "media") {
				printMedia(true);
				expect(root.hasAttribute("data-praxity-print-selected")).toBe(true);
				printMedia(false);
			} else if (ending === "timeout") vi.runAllTimers();
			else if (ending === "destroy") cancelRetrievalSheetPrint(root);
			else window.dispatchEvent(new Event(ending));
		}
		clean();
		for (const [installed, removed] of [
			[add, remove],
			[docAdd, docRemove],
			[mediaAdd, mediaRemove],
		]) {
			for (const args of installed.mock.calls) expect(removed.mock.calls).toContainEqual(args);
		}
		printRetrievalSheet(root);
		window.dispatchEvent(new Event("afterprint"));
		clean();
	},
);

it.each(["unchanged", "body", "other", "other-then-body", "removed", "destroy", "pagehide"])(
	"restores focus only when print displaced it: %s",
	(mode) => {
		const root = sheet();
		const button = root.querySelector("button")!;
		const other = document.createElement("button");
		document.body.append(other);
		button.focus();
		const focus = vi.spyOn(button, "focus");
		printRetrievalSheet(root);
		if (mode === "body" || mode === "destroy" || mode === "pagehide") button.blur();
		if (mode.startsWith("other")) other.focus();
		if (mode === "other-then-body") other.blur();
		if (mode === "removed") root.remove();
		if (mode === "destroy") cancelRetrievalSheetPrint(root);
		else window.dispatchEvent(new Event(mode === "pagehide" ? "pagehide" : "afterprint"));
		expect(focus).toHaveBeenCalledTimes(mode === "body" ? 1 : 0);
		if (mode === "body" || mode === "unchanged") expect(document.activeElement).toBe(button);
		if (mode === "other") expect(document.activeElement).toBe(other);
		clean();
	},
);

it("clears on print-media exit even when the browser omitted its entry event", () => {
	const root = sheet();
	printRetrievalSheet(root);
	printMedia(false);
	clean();
	printRetrievalSheet(root);
	printMedia(false);
	clean();
});

it("uses queued media transition values even after the live query has returned to screen", () => {
	const root = sheet();
	printRetrievalSheet(root);
	expect(media.matches).toBe(false);
	change.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
	change.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
	clean();
});

it.each(["pointerdown", "keydown"])(
	"clears an ignored print on later %s and admits another request without restoring focus",
	(type) => {
		const root = sheet();
		const button = root.querySelector("button")!;
		button.focus();
		printRetrievalSheet(root);
		document.body.dispatchEvent(new Event(type, { bubbles: true }));
		clean();
		button.blur();
		window.dispatchEvent(new Event("afterprint"));
		expect(document.activeElement).toBe(document.body);
		printRetrievalSheet(root);
		expect(window.print).toHaveBeenCalledTimes(2);
		window.dispatchEvent(new Event("afterprint"));
		clean();
	},
);

it("times out without moving displaced focus minutes after printing returned", () => {
	const root = sheet();
	const button = root.querySelector("button")!;
	button.focus();
	printRetrievalSheet(root);
	button.blur();
	vi.advanceTimersByTime(5 * 60 * 1000);
	expect(document.activeElement).toBe(document.body);
	clean();
});

it("works without matchMedia and refuses disconnected/non-sheet roots before installing resources", () => {
	vi.stubGlobal("matchMedia", undefined);
	const root = sheet();
	printRetrievalSheet(root);
	window.dispatchEvent(new Event("afterprint"));
	root.remove();
	expect(() => printRetrievalSheet(root)).toThrow();
	expect(() => printRetrievalSheet(document.body)).toThrow();
	clean();
});
