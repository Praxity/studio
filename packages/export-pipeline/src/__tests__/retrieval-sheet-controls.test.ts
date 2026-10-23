// @vitest-environment jsdom

import { getRetrievalSheetStrings } from "@praxity/shared-blocks/i18n/retrieval-sheet-strings";
import { strings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cancelRetrievalSheetPrint } from "../../template/src/retrieval-sheet-print";
import { enhanceRetrievalSheet } from "../patterns/retrieval-sheet/enhance";
import { renderRetrievalSheet } from "../patterns/retrieval-sheet/render";
import { renderBlockHtml } from "../render-block-html";

const content = {
	title: "Recall",
	questions: [{ id: "q", question: "Question?", answer: "Answer." }],
};
const cleanups: (() => void)[] = [];
async function flushAnnouncements() {
	await Promise.resolve();
	await Promise.resolve();
}
function mount(id = "sheet") {
	const container = document.createElement("div");
	container.dataset.blockType = "retrievalSheet";
	container.dataset.blockId = id;
	container.innerHTML = renderRetrievalSheet(content, {
		prefix: id,
		lang: "en",
		headingLevel: 2,
		strings: strings.en,
		noDate: getRetrievalSheetStrings("en").retrievalNoDate,
	});
	document.body.append(container);
	const root = container.firstElementChild as HTMLElement;
	const baseline = root.innerHTML;
	const instance = enhanceRetrievalSheet(root);
	cleanups.push(() => instance.destroy());
	const input = root.querySelector<HTMLInputElement>("input[type=date]")!;
	const print = root.querySelector<HTMLButtonElement>(".praxity-button")!;
	const status = root.querySelector<HTMLElement>("[role=status]")!;
	return { root, input, print, status, instance, baseline };
}
function choose(root: HTMLElement, value: string) {
	const radio = root.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
	radio.click();
}
function edit(input: HTMLInputElement, value: string) {
	input.focus();
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}
const dateText = (root: HTMLElement) =>
	root.querySelector("[data-retrieval-date-line]")?.textContent;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 17, 12));
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

it("dispatches the public sheet in the requested learner locale", () => {
	const container = document.createElement("div");
	container.innerHTML = renderBlockHtml(
		{ id: "sheet", type: "retrievalSheet", data: { level: 2, content } },
		{ enabledIslands: new Set(["retrievalSheet"]), sourceLocale: "fr" },
	);
	expect(container.querySelector("[data-retrieval-sheet]")?.getAttribute("lang")).toBe("fr");
	expect(container.querySelectorAll("[data-retrieval-side]")).toHaveLength(2);
	expect(container.querySelectorAll("[data-retrieval-side][hidden]")).toHaveLength(0);
});

it("initializes quietly, commits each imported preset, and keeps the selected side", async () => {
	const { root, status } = mount();
	expect(root.querySelector<HTMLInputElement>('input[value="7"]')?.checked).toBe(true);
	expect(dateText(root)).toBe("October 24, 2026");
	expect(status.textContent).toBe("");
	root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1].click();
	for (const [value, expected] of [
		["2", "October 19, 2026"],
		["7", "October 24, 2026"],
		["14", "October 31, 2026"],
		["30", "November 16, 2026"],
	]) {
		choose(root, value);
		expect(dateText(root)).toBe(expected);
		await flushAnnouncements();
		expect(status.textContent).toBe(`Test yourself on ${expected}.`);
		expect(root.querySelector("[data-retrieval-side=front]")?.hasAttribute("hidden")).toBe(true);
	}
	const message = status.textContent;
	choose(root, "custom");
	expect(status.textContent).toBe(message);
});

it.each([
	["ArrowLeft", 1],
	["ArrowRight", 1],
	["Home", 0],
	["End", 1],
])("uses %s to move focus without selecting", (key, destination) => {
	const { root, status } = mount();
	const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
	tabs[0].focus();
	tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	expect(document.activeElement).toBe(tabs[destination]);
	expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
	expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
	expect(root.querySelectorAll('[role=tabpanel][tabindex="0"]')).toHaveLength(2);
	expect(status.textContent).toBe("");
	if (key.startsWith("Arrow")) {
		tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		expect(document.activeElement).toBe(tabs[0]);
	}
});
it.each(["Enter", " "])("selects the focused tab with %s", (key) => {
	const { root, status } = mount();
	const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
	tabs[1].focus();
	tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
	expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
	expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
	expect(root.querySelector("[data-retrieval-side=front]")?.hasAttribute("hidden")).toBe(true);
	expect(document.activeElement).toBe(tabs[1]);
	expect(status.textContent).toBe("");
});
it.each(["altKey", "ctrlKey", "metaKey"])(
	"leaves %s tab combinations to the browser",
	(modifier) => {
		const { root } = mount();
		const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
		tabs[0].focus();
		for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "]) {
			const event = new KeyboardEvent("keydown", {
				key,
				[modifier]: true,
				bubbles: true,
				cancelable: true,
			});
			tabs[0].dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
			expect(document.activeElement).toBe(tabs[0]);
			expect(tabs[0].getAttribute("aria-selected")).toBe("true");
		}
	},
);

it("retains the valid date through invalid input, associates once on blur, and recovers", async () => {
	const { root, input, print, status } = mount();
	choose(root, "custom");
	expect(input.value).toBe("2026-10-24");
	edit(input, "");
	expect(print.disabled).toBe(true);
	expect(dateText(root)).toBe("October 24, 2026");
	expect(input.getAttribute("aria-invalid")).toBe("true");
	expect(input.hasAttribute("aria-describedby")).toBe(false);
	await flushAnnouncements();
	expect(status.textContent).toBe(strings.en.dateError);
	const mutations = vi.fn();
	const observer = new MutationObserver(mutations);
	observer.observe(status, { childList: true });
	input.dispatchEvent(new Event("change"));
	input.blur();
	expect(input.getAttribute("aria-describedby")).toBe("sheet-front-date-error");
	expect(observer.takeRecords()).toHaveLength(0);
	observer.disconnect();
	edit(input, "2026-10-24");
	expect(print.disabled).toBe(false);
	expect(input.hasAttribute("aria-invalid")).toBe(false);
	await flushAnnouncements();
	expect(status.textContent).toBe("Test yourself on October 24, 2026.");
});

it.each(["0001-01-01", "0020-02-02", "0202-02-02"])(
	"holds partial year %s until blur",
	async (value) => {
		const { root, input, status, print } = mount();
		choose(root, "custom");
		edit(input, value);
		expect(dateText(root)).toBe("October 24, 2026");
		expect(status.textContent).toBe("");
		expect(print.disabled).toBe(true);
		input.blur();
		await flushAnnouncements();
		expect(status.textContent).toBe(strings.en.dateError);
		expect(input.getAttribute("aria-invalid")).toBe("true");
	},
);

it.each([
	["2024-02-29", "February 29, 2024"],
	["9999-12-31", "December 31, 9999"],
	["1000-01-01", "January 1, 1000"],
	["2000-01-01", "January 1, 2000"],
])("accepts valid civil date %s including past dates", (value, expected) => {
	const { root, input, print } = mount();
	choose(root, "custom");
	edit(input, value);
	input.blur();
	expect(dateText(root)).toBe(expected);
	expect(print.disabled).toBe(false);
});

it.each(["10000-01-01", ""])("rejects native date value %s with intact printed date", (value) => {
	const { root, input, print } = mount();
	choose(root, "custom");
	edit(input, value);
	expect(input.value).toBe(value);
	input.blur();
	expect(dateText(root)).toBe("October 24, 2026");
	expect(print.disabled).toBe(true);
});
it.each(["2025-02-29", "0000-01-01"])(
	"rejects unsanitized date %s at the input interface",
	(value) => {
		const { root, input, print } = mount();
		choose(root, "custom");
		input.focus();
		// jsdom erases these native date values. Expose the raw field value to the real event handler.
		vi.spyOn(input, "value", "get").mockReturnValue(value);
		expect(input.value).toBe(value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.blur();
		expect(dateText(root)).toBe("October 24, 2026");
		expect(print.disabled).toBe(true);
		expect(input.getAttribute("aria-invalid")).toBe("true");
	},
);
it.each([
	[2024, 1, 22, "February 29, 2024"],
	[1, 0, 1, "January 8, 1"],
])("uses calendar days at leap/year bounds %s-%s-%s", (year, month, day, expected) => {
	const now = new Date(0);
	now.setFullYear(year, month, day);
	now.setHours(12);
	vi.setSystemTime(now);
	expect(dateText(mount().root)).toBe(expected);
});
it.each([
	["America/Toronto", 2026, 2, 6, 23, "2026-03-13", 300, 240],
	["America/Toronto", 2026, 9, 30, 0, "2026-11-06", 240, 300],
	["Europe/Paris", 2026, 2, 27, 23, "2026-04-03", -60, -120],
	["Europe/Paris", 2026, 9, 23, 0, "2026-10-30", -120, -60],
])(
	"preserves civil days across DST in %s at %s-%s-%s",
	(zone, year, month, day, hour, expected, fromOffset, toOffset) => {
		vi.stubEnv("TZ", zone);
		const now = new Date(year, month, day, hour, 30);
		vi.setSystemTime(now);
		const { input } = mount();
		expect(input.value).toBe(expected);
		expect(now.getTimezoneOffset()).toBe(fromOffset);
		expect(new Date(`${expected}T${String(hour).padStart(2, "0")}:30:00`).getTimezoneOffset()).toBe(
			toOffset,
		);
		// A fixed 168-hour interval lands on the wrong local date at these transition boundaries.
		const fixed = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
		const fixedCivil = `${fixed.getFullYear()}-${String(fixed.getMonth() + 1).padStart(2, "0")}-${String(fixed.getDate()).padStart(2, "0")}`;
		expect(fixedCivil).not.toBe(expected);
	},
);

it("handles default overflow with blank date, visible custom error and recovery", async () => {
	const now = new Date(0);
	now.setFullYear(9999, 11, 30);
	vi.setSystemTime(now);
	const { root, input, print, status } = mount();
	expect(dateText(root)).toBe("");
	expect(print.disabled).toBe(true);
	expect(input.closest<HTMLElement>(".praxity-retrieval-sheet-custom")?.hidden).toBe(false);
	await flushAnnouncements();
	expect(status.textContent).toBe(strings.en.dateError);
	edit(input, "9999-12-31");
	expect(print.disabled).toBe(false);
});

it("exposes the custom field when a preset exceeds year 9999", () => {
	const now = new Date(0);
	now.setFullYear(9999, 11, 20);
	vi.setSystemTime(now);
	const { root, input, print } = mount();
	choose(root, "30");
	expect(root.querySelector<HTMLInputElement>('input[value="custom"]')?.checked).toBe(true);
	expect(input.closest<HTMLElement>(".praxity-retrieval-sheet-custom")?.hidden).toBe(false);
	expect(dateText(root)).toBe("December 27, 9999");
	expect(print.disabled).toBe(true);
	choose(root, "2");
	expect(dateText(root)).toBe("December 22, 9999");
	expect(print.disabled).toBe(false);
});

it("retains memory on document return without duplicate mounts", () => {
	const { root, instance } = mount();
	choose(root, "2");
	root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1].click();
	window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
	window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
	expect(enhanceRetrievalSheet(root)).toBe(instance);
	expect(dateText(root)).toBe("October 19, 2026");
	expect(root.querySelectorAll("[role=tab]")).toHaveLength(2);
	expect(
		root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1].getAttribute("aria-selected"),
	).toBe("true");
});

it("uses no storage, provider, cookies, history, hash or network across independent mounts", async () => {
	const reads = [
		vi.spyOn(window, "localStorage", "get"),
		vi.spyOn(window, "sessionStorage", "get"),
	];
	const providerReads = [vi.fn(), vi.fn()];
	for (const [index, property] of ["__praxityBlockState", "__praxitySelfCheckDocument"].entries()) {
		Object.defineProperty(window, property, { configurable: true, get: providerReads[index] });
		cleanups.push(() => {
			Reflect.deleteProperty(window, property);
		});
	}
	const cookieRead = vi.spyOn(document, "cookie", "get");
	const cookieWrite = vi.spyOn(document, "cookie", "set");
	const push = vi.spyOn(history, "pushState");
	const replace = vi.spyOn(history, "replaceState");
	const hashChanged = vi.fn();
	window.addEventListener("hashchange", hashChanged);
	cleanups.push(() => window.removeEventListener("hashchange", hashChanged));
	const originalHash = location.hash;
	const fetch = vi.spyOn(globalThis, "fetch");
	const request = vi.spyOn(XMLHttpRequest.prototype, "open");
	vi.spyOn(window, "print").mockImplementation(() => {});
	const a = mount("a"),
		b = mount("b");
	choose(a.root, "2");
	a.root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1].click();
	choose(a.root, "custom");
	edit(a.input, "2024-02-29");
	a.print.click();
	window.dispatchEvent(new Event("afterprint"));
	expect(dateText(a.root)).toBe("February 29, 2024");
	expect(dateText(b.root)).toBe("October 24, 2026");
	expect(b.root.querySelector("[role=tab]")?.getAttribute("aria-selected")).toBe("true");
	expect(enhanceRetrievalSheet(a.root)).toBe(a.instance);
	const oldInput = a.input;
	a.instance.destroy();
	expect(a.root.innerHTML).toBe(a.baseline);
	const rebound = enhanceRetrievalSheet(a.root);
	cleanups.push(() => rebound.destroy());
	oldInput.value = "2030-01-01";
	oldInput.dispatchEvent(new Event("change"));
	expect(dateText(a.root)).toBe("October 24, 2026");
	expect(a.root.querySelectorAll("[role=status]")).toHaveLength(1);
	vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
		throw new Error("Formatter unavailable");
	});
	const failed = mount("failure-without-state");

	await vi.runAllTimersAsync();
	expect(failed.status.textContent).toBe(getRetrievalSheetStrings("en").retrievalUnavailable);

	for (const spy of [
		...reads,
		...providerReads,
		cookieRead,
		cookieWrite,
		push,
		replace,
		hashChanged,
		fetch,
		request,
	])
		expect(spy).not.toHaveBeenCalled();
	expect(location.hash).toBe(originalHash);
});

it.each([false, true])(
	"announces each repeated print request, including failure=%s",
	async (fails) => {
		const a = mount();
		const observed: string[] = [];
		vi.spyOn(window, "print").mockImplementation(() => {
			if (fails) throw new Error("Print refused");
		});
		const observer = new MutationObserver(() => {
			if (a.status.textContent) observed.push(a.status.textContent);
		});
		observer.observe(a.status, { childList: true });
		const expected = fails
			? getRetrievalSheetStrings("en").retrievalPrintUnavailable
			: strings.en.printing;
		for (let i = 0; i < 2; i++) {
			a.print.click();
			expect(a.status.textContent).toBe("");
			await flushAnnouncements();
			expect(a.status.textContent).toBe(expected);
			window.dispatchEvent(new Event("afterprint"));
		}
		expect(observed).toEqual([expected, expected]);
		observer.disconnect();
	},
);

it("prints only the selected instance without changing side/date and clears scope on afterprint", async () => {
	const a = mount("a");
	const b = mount("b");
	choose(a.root, "2");
	a.root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1].click();
	const print = vi.spyOn(window, "print").mockImplementation(() => {
		expect(a.root.hasAttribute("data-praxity-print-selected")).toBe(true);
		expect(b.root.hasAttribute("data-praxity-print-selected")).toBe(false);
		expect(a.root.querySelector("[data-retrieval-side=front]")?.hasAttribute("hidden")).toBe(true);
	});
	a.print.click();
	expect(print).toHaveBeenCalledTimes(1);
	await flushAnnouncements();
	expect(a.status.textContent).toBe(strings.en.printing);
	window.dispatchEvent(new Event("afterprint"));
	expect(document.documentElement.hasAttribute("data-praxity-retrieval-print")).toBe(false);
	expect(dateText(a.root)).toBe("October 19, 2026");
	expect(
		a.root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1].getAttribute("aria-selected"),
	).toBe("true");
	cancelRetrievalSheetPrint(b.root);
});

it("cleans print throw and teardown and reports localized print failure", async () => {
	const a = mount();
	vi.spyOn(window, "print").mockImplementation(() => {
		throw new Error("Print refused");
	});
	a.print.click();
	await flushAnnouncements();
	expect(a.status.textContent).toBe(getRetrievalSheetStrings("en").retrievalPrintUnavailable);
	expect(
		document.querySelector("[data-praxity-print-selected], [data-praxity-print-path]"),
	).toBeNull();
	vi.mocked(window.print).mockImplementation(() => {});
	a.print.click();
	a.instance.destroy();
	expect(document.documentElement.hasAttribute("data-praxity-retrieval-print")).toBe(false);
});

it("restores the complete baseline on a running enhancer failure", async () => {
	const container = document.createElement("div");
	container.innerHTML = renderRetrievalSheet(content, {
		prefix: "failure",
		lang: "en",
		headingLevel: 2,
		strings: strings.en,
		noDate: getRetrievalSheetStrings("en").retrievalNoDate,
	});
	document.body.append(container);
	const root = container.firstElementChild as HTMLElement;
	const baseline = root.innerHTML;
	vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
		throw new Error("Formatter unavailable");
	});
	const instance = enhanceRetrievalSheet(root);
	cleanups.push(() => instance.destroy());
	expect(root.querySelectorAll("[data-retrieval-side][hidden]")).toHaveLength(0);
	expect(root.querySelector("[data-retrieval-controls]")?.innerHTML).toBe("");
	expect(root.querySelector("[role=status]")?.textContent).toBe("");
	await flushAnnouncements();
	expect(root.querySelector("[role=status]")?.textContent).toBe("");
	vi.advanceTimersToNextFrame();
	expect(root.querySelector("[role=status]")?.textContent).toBe(
		getRetrievalSheetStrings("en").retrievalUnavailable,
	);
	instance.destroy();
	expect(root.innerHTML).toBe(baseline);
});

it.each(["print", "failure"])(
	"drops queued %s speech when the mount is destroyed",
	async (mode) => {
		if (mode === "failure")
			vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
				throw new Error("Formatter unavailable");
			});
		const a = mount();
		if (mode === "print") {
			vi.spyOn(window, "print").mockImplementation(() => {});
			a.print.click();
		}
		const status = a.status;
		a.instance.destroy();
		await vi.runAllTimersAsync();
		await flushAnnouncements();
		expect(a.root.innerHTML).toBe(a.baseline);
		expect(status.textContent).toBe("");
		expect(status.isConnected).toBe(true);
		expect(a.root.querySelectorAll("[role=status]")).toHaveLength(1);
	},
);
