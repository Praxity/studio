// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeCourseHost } from "../../template/src/hosts/course-host";
import { selfCheckDocument } from "../../template/src/self-check-document";
import { renderBlockHtml } from "../render-block-html";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";

const hostMarkup = `<script id="praxity-host-config" type="application/json">${JSON.stringify({
	version: 1,
	courseId: "journal-course",
	pageId: "page",
	pageTitle: "Reflection",
	currentPage: 1,
	totalPages: 1,
	currentSlug: "index",
	availableSlugs: ["index"],
	pageIdMap: { page: "index" },
	completionMethod: "allPages",
	pageRole: "content",
	strings: {},
})}</script><script id="praxity-deployment-config" type="application/json">{"format":"standalone"}</script>`;

let detach: (() => void) | undefined;
let onReady: (() => void) | undefined;
let removeListeners: () => void;

beforeEach(() => {
	const documentEvents = vi.spyOn(document, "addEventListener");
	const windowEvents = vi.spyOn(window, "addEventListener");
	removeListeners = () => {
		for (const args of documentEvents.mock.calls) document.removeEventListener(...args);
		for (const args of windowEvents.mock.calls) window.removeEventListener(...args);
		documentEvents.mockRestore();
		windowEvents.mockRestore();
	};
});

afterEach(() => {
	detach?.();
	detach = undefined;
	if (onReady) window.removeEventListener("praxity:runtime-ready", onReady);
	onReady = undefined;
	window.__praxitySelfCheckDocument?.dispose();
	removeListeners();
	delete window.__praxityBlockState;
	Reflect.deleteProperty(window, "__praxityHostStarted");
	delete window.__praxityRuntime;
	delete window.__praxityTracker;
	document.body.replaceChildren();
	localStorage.clear();
	Reflect.deleteProperty(document, "fonts");
	vi.unstubAllGlobals();
});

it.each([undefined, "corrupt", "2026-02-30T14:05:00.000Z", "2026-10-08T14:05:00.000Z"])(
	"admits and restores an accessor-backed journal with timestamp %s",
	async (savedAt) => {
		vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "journal-owner-test");
		vi.stubGlobal("__praxityPrivateState", false);
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		vi.stubGlobal("matchMedia", (media: string) => ({
			media,
			matches: false,
			addEventListener() {},
			removeEventListener() {},
		}));
		const block: PraxityBlock = {
			id: "journal",
			type: "assessment",
			data: {
				assessmentType: "textResponse",
				gradingMode: "none",
				private: true,
				stem: [{ id: "question", type: "text", data: { content: "Reflect" } }],
				response: { type: "textResponse", inputType: "long" },
			},
		};
		document.body.innerHTML =
			renderBlockHtml(block, { enabledIslands: new Set(["assessment"]) }) + hostMarkup;
		// The injected storage adapter keeps its provider when the host assigns one.
		Object.defineProperty(window, "__praxityBlockState", {
			configurable: true,
			get: () => ({
				get: (id: string) =>
					id === "journal"
						? {
								version: 1,
								kind: "assessment",
								assessmentType: "textResponse",
								attemptCount: 1,
								checked: true,
								correct: false,
								completed: true,
								interacted: true,
								answer: "Older reflection",
								savedAt,
							}
						: undefined,
				set() {},
			}),
			set() {},
		});
		const owner = selfCheckDocument(document, true);
		const { attachIsland } = await import("../../template/src/islands/island-assessment");
		onReady = () => {
			detach = attachIsland();
		};
		window.addEventListener("praxity:runtime-ready", onReady);
		initializeCourseHost({
			format: "standalone",
			createRuntime: () => new LocalStorageRuntime(localStorage, "journal-course"),
		});
		expect(owner.isAdmitted()).toBe(true);
		expect(
			document.querySelector('[data-island="assessment"]')?.getAttribute("data-hydrated"),
		).toBe("");
		await vi.waitFor(() =>
			expect(document.querySelector("textarea")?.value).toBe("Older reflection"),
		);
		if (savedAt !== "2026-10-08T14:05:00.000Z")
			expect(document.querySelector("[data-journal-saved-date]")).toBeNull();
	},
);

it.each(["missing", "hide", "provider"])(
	"does not admit a host installation interrupted by %s",
	(boundary) => {
		vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "journal-owner-test");
		vi.stubGlobal("__praxityPrivateState", false);
		let provider: Window["__praxityBlockState"];
		let interrupted = false;
		Object.defineProperty(window, "__praxityBlockState", {
			configurable: true,
			get: () => provider,
			set() {
				if (boundary === "hide") window.dispatchEvent(new Event("pagehide"));
				if (boundary === "provider" && !interrupted) {
					interrupted = true;
					provider = { get: () => undefined, set() {} };
					window.__praxityBlockState = provider;
				}
			},
		});
		const owner = selfCheckDocument(document, true);
		document.body.innerHTML = hostMarkup;
		const ready = vi.fn();
		onReady = ready;
		window.addEventListener("praxity:runtime-ready", onReady);
		initializeCourseHost({
			format: "standalone",
			createRuntime: () => new LocalStorageRuntime(localStorage, "journal-course"),
		});
		expect(owner.isAdmitted()).toBe(false);
		expect(ready).not.toHaveBeenCalled();
	},
);
