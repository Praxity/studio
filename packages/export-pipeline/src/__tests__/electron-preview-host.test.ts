import { restoreChoiceAssessmentState } from "@praxity/shared-blocks/choice-learner-state";
import { renderLogicAnnotations } from "@praxity/shared-blocks/course-preview-frame";
import {
	COURSE_PREVIEW_PROTOCOL_VERSION,
	type CoursePreviewCommand,
	type CoursePreviewEvent,
	type CoursePreviewIdentity,
} from "@praxity/shared-blocks/course-preview-protocol";
import {
	createLearnerState,
	LEARNER_STATE_MAX_BYTES,
	parseLearnerState,
	serializeLearnerState,
} from "@praxity/shared-blocks/learner-state";
import { VariableStore } from "@praxity/shared-blocks/logic";
import { navigatePage } from "@praxity/shared-blocks/viewer/navigate-page";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeElectronPreviewHost } from "../../template/src/hosts/electron-preview";
import { attachIsland as attachHighlightIsland } from "../../template/src/islands/island-highlight";
import { gateQuestion, gateSignature } from "../../tests/fixtures/choice-gate";
import {
	exerciseHighlightPrivacy,
	highlightPrivacyPreview,
} from "../../tests/fixtures/highlight-privacy";
import type { SCORMRuntime } from "../scorm/types";

const identity: CoursePreviewIdentity = {
	channel: "c".repeat(32),
	courseId: "course-1",
	revision: "a".repeat(64),
	pageId: "page-1",
};
const parentOrigin = "https://studio.test";
const previews = new Set<JSDOM>();

type RuntimeProbe = {
	getVisitedPages(): string[];
	getBlockState(blockId: string): unknown;
	setBlockState(blockId: string, value: unknown): void;
	resetState(): void;
};

function previewDocument(inspect = false, body = ""): JSDOM {
	const params = new URLSearchParams({
		"praxity-channel": identity.channel,
		"praxity-parent-origin": parentOrigin,
	});
	if (inspect) params.set("praxity-inspect", "1");
	const dom = new JSDOM(
		`<!doctype html><html><head>
			<script id="praxity-host-config" type="application/json">${JSON.stringify({
				version: 1,
				courseId: identity.courseId,
				pageId: identity.pageId,
				pageTitle: "Page 1",
				currentPage: 1,
				totalPages: 1,
				currentSlug: "page-1",
				availableSlugs: ["page-1"],
				pageIdMap: { "page-1": "page-1" },
				completionMethod: "allPages",
				pageRole: "content",
				strings: { scormResumeAnnouncement: "Resumed" },
			})}</script>
			<script id="praxity-deployment-config" type="application/json">${JSON.stringify({
				format: "electron-preview",
				revision: identity.revision,
			})}</script>
		</head><body>${body}</body></html>`,
		{ url: `https://course.test/page-1.html?${params}` },
	);
	Object.defineProperty(dom.window.document, "readyState", {
		configurable: true,
		value: "complete",
	});
	previews.add(dom);
	return dom;
}

function installHost(dom: JSDOM): Window {
	const parent = {} as Window;
	Object.defineProperty(dom.window, "parent", { configurable: true, value: parent });
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("document", dom.window.document);
	expect(initializeElectronPreviewHost()).toBe(true);
	return parent;
}

function listen(port: MessagePort): CoursePreviewEvent[] {
	const events: CoursePreviewEvent[] = [];
	port.addEventListener("message", (event) => events.push(event.data as CoursePreviewEvent));
	port.start();
	return events;
}

async function waitForEvent<T extends CoursePreviewEvent["event"]>(
	events: CoursePreviewEvent[],
	eventName: T,
): Promise<Extract<CoursePreviewEvent, { event: T }>> {
	let match: Extract<CoursePreviewEvent, { event: T }> | undefined;
	await vi.waitFor(
		() => {
			match = events.find(
				(candidate): candidate is Extract<CoursePreviewEvent, { event: T }> =>
					candidate.event === eventName,
			);
			expect(match).toBeDefined();
		},
		{ interval: 1 },
	);
	return match as Extract<CoursePreviewEvent, { event: T }>;
}

async function waitForFreezeBarrier(
	port: MessagePort,
	events: CoursePreviewEvent[],
	pageId = identity.pageId,
): Promise<void> {
	const before = events.filter((event) => event.event === "frozen").length;
	port.postMessage({
		...identity,
		pageId,
		source: "praxity-studio",
		version: COURSE_PREVIEW_PROTOCOL_VERSION,
		action: "freeze",
	});
	await vi.waitFor(
		() => expect(events.filter((event) => event.event === "frozen")).toHaveLength(before + 1),
		{ interval: 1 },
	);
}

function sendWindowMessage(
	dom: JSDOM,
	source: unknown,
	data: unknown,
	origin: string,
	ports: MessagePort[] = [],
): void {
	dom.window.dispatchEvent(
		new dom.window.MessageEvent("message", {
			data,
			origin,
			source: source as WindowProxy,
			ports,
		}),
	);
}

function connectMessage(overrides: Partial<CoursePreviewIdentity> = {}): CoursePreviewCommand {
	return {
		source: "praxity-studio",
		version: COURSE_PREVIEW_PROTOCOL_VERSION,
		action: "connect",
		...identity,
		...overrides,
	};
}

function restoreMessage(state: string, writable: boolean): CoursePreviewCommand {
	return {
		source: "praxity-studio",
		version: COURSE_PREVIEW_PROTOCOL_VERSION,
		action: "restore",
		state,
		writable,
		...identity,
	};
}

function learnerState(blockState: Record<string, { value: number }> = {}): string {
	const state = createLearnerState({
		courseId: identity.courseId,
		attemptId: "studio-preview",
		revision: identity.revision,
	});
	state.blockState = blockState;
	return serializeLearnerState(state);
}

function runtime(dom: JSDOM): RuntimeProbe {
	return (dom.window as unknown as { __praxityRuntime: RuntimeProbe }).__praxityRuntime;
}

afterEach(() => {
	for (const dom of previews) dom.window.close();
	previews.clear();
	vi.unstubAllGlobals();
});

describe("Electron preview course host", () => {
	it("refuses learner initialization in a small preview", () => {
		const dom = previewDocument();
		dom.reconfigure({ url: `${dom.window.location.href}&praxity-small-preview=1` });
		Object.defineProperty(dom.window, "parent", { configurable: true, value: {} });
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("document", dom.window.document);

		expect(initializeElectronPreviewHost()).toBe(false);
		expect(dom.window.document.documentElement.dataset.praxityLearnerState).toBeUndefined();
		expect(
			(dom.window as unknown as { __praxityRuntime?: RuntimeProbe }).__praxityRuntime,
		).toBeUndefined();
		expect(
			(dom.window as unknown as { __praxityBlockState?: unknown }).__praxityBlockState,
		).toBeUndefined();
	});

	it("keeps a validated alias handshake identity while reporting active module slides", async () => {
		const dom = previewDocument(
			false,
			'<article data-deck-slide="page-1"></article><article data-deck-slide="page-2"></article>',
		);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage({ pageId: "page-2" }), parentOrigin, [
			channel.port2,
		]);
		expect((await waitForEvent(events, "connected")).pageId).toBe("page-2");
		dom.window.dispatchEvent(
			new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: "page-2" } }),
		);
		channel.port1.postMessage({ ...restoreMessage(learnerState(), true), pageId: "page-2" });
		expect(await waitForEvent(events, "ready")).toMatchObject({
			pageId: "page-2",
			activePageId: "page-2",
		});
		dom.window.dispatchEvent(
			new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId: "page-1" } }),
		);
		expect(await waitForEvent(events, "active-page")).toMatchObject({
			pageId: "page-2",
			activePageId: "page-1",
		});
		channel.port1.postMessage({
			...identity,
			source: "praxity-studio",
			version: 1,
			action: "freeze",
		});
		const barrierState = learnerState({ barrier: { value: 1 } });
		channel.port1.postMessage({
			...identity,
			pageId: "page-2",
			source: "praxity-studio",
			version: 1,
			action: "resume",
			state: barrierState,
		});
		await vi.waitFor(() => expect(runtime(dom).getBlockState("barrier")).toEqual({ value: 1 }));
		expect(events.filter((event) => event.event === "frozen")).toHaveLength(0);
		await waitForFreezeBarrier(channel.port1, events, "page-2");
		expect(events.filter((event) => event.event === "frozen")).toHaveLength(1);
	});

	it("requires the exact parent origin, source, identity, and transferred port once", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);

		const reject = (
			data: CoursePreviewCommand,
			origin = parentOrigin,
			source: unknown = parent,
			ports: MessagePort[] = [],
		) => sendWindowMessage(dom, source, data, origin, ports);
		const wrongPort = new MessageChannel();
		reject(connectMessage(), parentOrigin, parent, []);
		reject(connectMessage(), "https://evil.test", parent, [wrongPort.port2]);
		wrongPort.port1.close();
		wrongPort.port2.close();
		const wrongSource = new MessageChannel();
		reject(connectMessage(), parentOrigin, {}, [wrongSource.port2]);
		wrongSource.port1.close();
		wrongSource.port2.close();
		const wrongIdentity = new MessageChannel();
		reject(connectMessage({ pageId: "other-page" }), parentOrigin, parent, [wrongIdentity.port2]);
		wrongIdentity.port1.close();
		wrongIdentity.port2.close();

		const accepted = new MessageChannel();
		const events = listen(accepted.port1);
		reject(connectMessage(), parentOrigin, parent, [accepted.port2]);
		await waitForEvent(events, "connected");

		const duplicate = new MessageChannel();
		const duplicateEvents = listen(duplicate.port1);
		reject(connectMessage(), parentOrigin, parent, [duplicate.port2]);
		accepted.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");
		expect(events.filter((event) => event.event === "connected")).toHaveLength(1);
		expect(duplicateEvents).toEqual([]);
		duplicate.port1.close();
		duplicate.port2.close();
	});

	it("restores state before runtime ready without using localStorage", async () => {
		const dom = previewDocument();
		const unusedLocalStorage = {
			getItem: vi.fn(() => {
				throw new Error("localStorage is unavailable");
			}),
		} as unknown as Storage;
		vi.stubGlobal("localStorage", unusedLocalStorage);
		const parent = installHost(dom);
		expect(dom.window.document.documentElement.dataset.praxityLearnerState).toBe("pending");
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		expect(
			(dom.window as unknown as { __praxityRuntime?: RuntimeProbe }).__praxityRuntime,
		).toBeUndefined();

		const state = learnerState({ existing: { value: 1 } });
		const ready = waitForEvent(events, "ready");
		channel.port1.postMessage(restoreMessage(state, true));
		const readyEvent = await ready;

		expect(readyEvent.mode).toBe("learner");
		expect(dom.window.document.documentElement.dataset.praxityLearnerState).toBeUndefined();
		expect(unusedLocalStorage.getItem).not.toHaveBeenCalled();
		expect(runtime(dom).getBlockState("existing")).toEqual({ value: 1 });
	});

	it.each([false, true])(
		"restores a signed choice before consumers start, inspection=%s",
		async (inspect) => {
			const dom = previewDocument(inspect);
			const script = dom.window.document.getElementById("praxity-host-config")!;
			script.textContent = JSON.stringify({
				...JSON.parse(script.textContent!),
				choiceStateQuestions: { choice: gateQuestion },
				choiceStateSignatures: { choice: gateSignature },
			});
			const saved = {
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				attemptCount: 1,
				checked: true,
				correct: true,
				completed: true,
				interacted: true,
				answer: ["a"],
				reviewedChoiceIds: ["a"],
				contentSignature: gateSignature,
			};
			const state = createLearnerState({
				courseId: identity.courseId,
				attemptId: "studio-preview",
				revision: identity.revision,
			});
			state.blockState.choice = saved;
			const restored = vi.fn();
			dom.window.addEventListener("praxity:runtime-ready", () => {
				const view = (
					dom.window as unknown as Window
				).__praxityBlockState?.getChoiceDependencyView?.();
				expect(view?.status("choice")).toBe("current");
				restored(
					restoreChoiceAssessmentState(view?.readState("choice"), {
						question: gateQuestion,
						signature: gateSignature,
					}),
				);
			});
			const parent = installHost(dom);
			const channel = new MessageChannel();
			try {
				const events = listen(channel.port1);
				sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
				await waitForEvent(events, "connected");
				channel.port1.postMessage(restoreMessage(serializeLearnerState(state), !inspect));
				await waitForEvent(events, "ready");
				expect(restored).toHaveBeenCalledExactlyOnceWith({
					status: "current",
					current: saved,
					history: [],
				});
				expect(runtime(dom).getBlockState("choice")).toEqual(saved);
			} finally {
				channel.port1.close();
				channel.port2.close();
			}
		},
	);

	it("waits for planned islands before announcing the artifact is ready", async () => {
		const dom = previewDocument();
		dom.window.document.documentElement.dataset.praxityIslands = "assessment";
		const loader = dom.window.document.createElement("script");
		loader.src = "/island-loader.js";
		dom.window.document.body.append(loader);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");

		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await vi.waitFor(() => expect(runtime(dom)).toBeDefined());
		await waitForFreezeBarrier(channel.port1, events);
		expect(events.some((event) => event.event === "ready")).toBe(false);

		dom.window.dispatchEvent(new dom.window.CustomEvent("praxity:islands-ready"));
		await waitForEvent(events, "ready");
	});

	it("rejects an artifact whose required islands fail to load", async () => {
		const dom = previewDocument();
		dom.window.document.documentElement.dataset.praxityIslands = "assessment";
		const loader = dom.window.document.createElement("script");
		loader.src = "/island-loader.js";
		dom.window.document.body.append(loader);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await vi.waitFor(() => expect(runtime(dom)).toBeDefined());

		dom.window.dispatchEvent(new dom.window.CustomEvent("praxity:islands-failed"));
		const fatal = await waitForEvent(events, "fatal");
		expect(fatal.code).toBe("runtime-start");
		expect(events.some((event) => event.event === "ready")).toBe(false);
	});

	it("requests saved-page navigation before announcing entry readiness", async () => {
		const dom = previewDocument();
		dom.window.history.replaceState(null, "", `${dom.window.location.href}&praxity-entry=1`);
		const config = JSON.parse(
			dom.window.document.getElementById("praxity-host-config")?.textContent ?? "{}",
		) as Record<string, unknown>;
		Object.assign(config, {
			totalPages: 2,
			availableSlugs: ["page-1", "page-2"],
			pageIdMap: { "page-1": "page-1", "page-2": "page-2" },
		});
		const configNode = dom.window.document.getElementById("praxity-host-config");
		expect(configNode).not.toBeNull();
		if (configNode) configNode.textContent = JSON.stringify(config);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		const state = createLearnerState({
			courseId: identity.courseId,
			attemptId: "studio-preview",
			revision: identity.revision,
		});
		state.bookmark = "index.html?praxity-page=page-2";

		channel.port1.postMessage(restoreMessage(serializeLearnerState(state), true));
		const navigation = await waitForEvent(events, "navigate");
		expect(new URL(navigation.url).pathname).toBe("/page-2.html");
		expect(events.some((event) => event.event === "ready")).toBe(false);
	});

	it.each(["0", "1"])(
		"becomes ready after a Guided selected-slide alias with marker %s",
		async (marker) => {
			const dom = previewDocument();
			dom.window.history.replaceState(
				null,
				"",
				`${dom.window.location.href}&praxity-entry=1&praxity-resume=${marker}#page-2`,
			);
			const configNode = dom.window.document.getElementById("praxity-host-config");
			const config = JSON.parse(configNode?.textContent ?? "{}");
			Object.assign(config, {
				deck: true,
				totalPages: 2,
				availableSlugs: ["page-1", "page-2"],
				pageIdMap: { "page-1": "page-1", "page-2": "page-2" },
			});
			if (configNode) configNode.textContent = JSON.stringify(config);
			const parent = installHost(dom);
			const channel = new MessageChannel();
			const events = listen(channel.port1);
			sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
			await waitForEvent(events, "connected");
			const state = createLearnerState({
				courseId: identity.courseId,
				attemptId: "studio-preview",
				revision: identity.revision,
			});
			state.bookmark = "index.html?praxity-page=page-2";
			channel.port1.postMessage(restoreMessage(serializeLearnerState(state), true));
			await waitForEvent(events, "ready");
			expect(events.filter((event) => event.event === "navigate")).toHaveLength(0);
			expect(dom.window.__praxityResume).toBeUndefined();
			expect(new URL(dom.window.location.href).searchParams.has("praxity-resume")).toBe(false);
		},
	);

	it("keeps inspection state read-only and accepts logic through the private port", async () => {
		const dom = previewDocument(
			true,
			`<script id="praxity-config" type="application/json">${JSON.stringify({
				strings: {
					logicAuthoringOverlay: "Authoring logic",
					logicCondition: "condition",
					logicConditions: "conditions",
					logicAction: "action",
					logicActions: "actions",
				},
				logic: {
					rules: [{ blockId: "logic-stable", conditions: { rules: [{}, {}] }, actions: [{}] }],
				},
			})}</script><div id="block-logic-stable"></div>`,
		);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");

		channel.port1.postMessage({
			source: "praxity-studio",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			action: "logic",
			enabled: true,
			...identity,
		});
		await vi.waitFor(() =>
			expect(dom.window.document.querySelectorAll("[data-praxity-preview-logic]")).toHaveLength(1),
		);

		channel.port1.postMessage(restoreMessage(learnerState({ existing: { value: 1 } }), false));
		await waitForEvent(events, "ready");
		const previewRuntime = runtime(dom);
		expect(previewRuntime.getVisitedPages()).toEqual([]);
		expect(previewRuntime.getBlockState("existing")).toEqual({ value: 1 });
		previewRuntime.setBlockState("new", { value: 2 });
		previewRuntime.resetState();
		expect(previewRuntime.getBlockState("new")).toBeUndefined();
		expect(previewRuntime.getBlockState("existing")).toEqual({ value: 1 });
		const button = dom.window.document.createElement("button");
		dom.window.document.body.append(button);
		channel.port1.postMessage({
			...identity,
			source: "praxity-studio",
			version: 1,
			action: "focus",
			edge: "first",
		});
		await vi.waitFor(() => expect(dom.window.document.activeElement).toBe(button));
		expect(events.filter((event) => event.event === "persist")).toHaveLength(0);
	});

	it("hands inspection navigation to Studio without committing learner state", async () => {
		const dom = previewDocument(true);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		const state = learnerState();
		channel.port1.postMessage(restoreMessage(state, false));
		await waitForEvent(events, "ready");
		const href = dom.window.__praxityDecoratePageHref?.("next.html#page-2") as string;
		expect(dom.window.__praxityNavigatePageHref?.(href)).toBe(true);
		expect(dom.window.__praxityNavigatePageHref?.(href)).toBe(true);
		expect(await waitForEvent(events, "navigate")).toMatchObject({ state, url: href });
		expect(events.filter((event) => event.event === "persist")).toHaveLength(0);
		expect(events.filter((event) => event.event === "navigate")).toHaveLength(1);
	});

	it("preserves channel, parent origin, and inspection during course navigation", () => {
		const dom = previewDocument(true);
		installHost(dom);
		const href = dom.window.__praxityDecoratePageHref?.("next.html?from=preview");
		expect(href).toBeDefined();
		const url = new URL(href ?? dom.window.location.href);
		expect(url.searchParams.get("from")).toBe("preview");
		expect(url.searchParams.get("praxity-channel")).toBe(identity.channel);
		expect(url.searchParams.get("praxity-parent-origin")).toBe(parentOrigin);
		expect(url.searchParams.get("praxity-inspect")).toBe("1");
	});

	it("sends only unhandled Escape presses through the private port", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");

		const consumeEscape = (event: Event) => event.preventDefault();
		dom.window.document.body.addEventListener("keydown", consumeEscape);
		dom.window.document.body.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		);
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");
		expect(events.some((event) => event.event === "escape")).toBe(false);

		dom.window.document.body.removeEventListener("keydown", consumeEscape);
		Object.defineProperty(dom.window.document, "fullscreenElement", {
			configurable: true,
			value: dom.window.document.body,
		});
		dom.window.document.body.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		);
		await waitForFreezeBarrier(channel.port1, events);
		expect(events.some((event) => event.event === "escape")).toBe(false);

		Object.defineProperty(dom.window.document, "fullscreenElement", {
			configurable: true,
			value: null,
		});
		dom.window.document.body.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		);
		await waitForEvent(events, "escape");
	});

	it("returns focus to Studio only at learner document boundaries", async () => {
		const dom = previewDocument(
			false,
			"<button>First</button><button>Middle</button><button>Last</button>",
		);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		const [first, middle, last] = [
			...dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
		];

		middle?.focus();
		const middleTab = new dom.window.KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
			cancelable: true,
		});
		middle?.dispatchEvent(middleTab);
		expect(middleTab.defaultPrevented).toBe(false);
		expect(events.some((event) => event.event === "focus-boundary")).toBe(false);

		last?.focus();
		const forwardTab = new dom.window.KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
			cancelable: true,
		});
		last?.dispatchEvent(forwardTab);
		expect(forwardTab.defaultPrevented).toBe(true);
		const forward = await waitForEvent(events, "focus-boundary");
		expect(forward.direction).toBe("forward");

		first?.focus();
		const backwardTab = new dom.window.KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		first?.dispatchEvent(backwardTab);
		expect(backwardTab.defaultPrevented).toBe(true);
		await vi.waitFor(() =>
			expect(
				events.some((event) => event.event === "focus-boundary" && event.direction === "backward"),
			).toBe(true),
		);
	});

	it("treats the checked radio as its group's single Tab stop", async () => {
		const dom = previewDocument(
			false,
			'<button>First</button><input type="radio" name="rating"><input type="radio" name="rating" checked><input type="radio" name="rating">',
		);
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		const checked = dom.window.document.querySelector<HTMLInputElement>("input:checked");
		checked?.focus();
		const tab = new dom.window.KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
			cancelable: true,
		});
		checked?.dispatchEvent(tab);

		expect(tab.defaultPrevented).toBe(true);
		const boundary = await waitForEvent(events, "focus-boundary");
		expect(boundary.direction).toBe("forward");
	});

	it("focuses the requested learner edge through the private port", async () => {
		const dom = previewDocument(false, "<button>First</button><button>Last</button>");
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		const [first, last] = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")];

		channel.port1.postMessage({
			source: "praxity-studio",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			action: "focus",
			edge: "last",
			...identity,
		});
		await vi.waitFor(() => expect(dom.window.document.activeElement).toBe(last));
		// Tab enters the frame again: its window takes focus before the host asks for an edge.
		dom.window.dispatchEvent(new dom.window.FocusEvent("focus"));
		channel.port1.postMessage({
			source: "praxity-studio",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			action: "focus",
			edge: "first",
			...identity,
		});
		await vi.waitFor(() => expect(dom.window.document.activeElement).toBe(first));
	});

	it("opens external HTTPS downloads through the port and leaves same-course downloads native", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");

		const external = dom.window.document.createElement("a");
		external.href = "https://example.com/file.pdf";
		external.download = "file.pdf";
		external.textContent = "External file";
		dom.window.document.body.append(external);
		const externalClick = new dom.window.MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		external.dispatchEvent(externalClick);
		const externalEvent = await waitForEvent(events, "open-external");
		expect(externalEvent.url).toBe("https://example.com/file.pdf");
		expect(externalClick.defaultPrevented).toBe(true);

		const sameCourse = dom.window.document.createElement("a");
		sameCourse.href = "https://course.test/file.pdf";
		sameCourse.download = "file.pdf";
		sameCourse.textContent = "Course file";
		let defaultPreventedAtTarget: boolean | undefined;
		sameCourse.addEventListener("click", (event) => {
			defaultPreventedAtTarget = event.defaultPrevented;
			event.preventDefault();
		});
		dom.window.document.body.append(sameCourse);
		sameCourse.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		expect(defaultPreventedAtTarget).toBe(false);
		expect(new URL(sameCourse.href).searchParams.get("praxity-channel")).toBe(identity.channel);
		expect(events.filter((event) => event.event === "open-external")).toHaveLength(1);
	});

	it("flushes learner state through the host before same-course page navigation", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");
		runtime(dom).setBlockState("answer", { value: 1 });

		const link = dom.window.document.createElement("a");
		link.href = "https://course.test/page-2.html";
		dom.window.document.body.append(link);
		const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
		link.dispatchEvent(click);

		const navigation = await waitForEvent(events, "navigate");
		expect(click.defaultPrevented).toBe(true);
		expect(new URL(navigation.url).pathname).toBe("/page-2.html");
		expect(
			parseLearnerState(navigation.state, {
				courseId: identity.courseId,
				attemptId: "studio-preview",
			})?.blockState,
		).toMatchObject({ answer: { value: 1 } });
	});

	it("flushes navigation requested by a shared island control", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");
		runtime(dom).setBlockState("answer", { value: 2 });

		const link = dom.window.document.createElement("a");
		link.href = "./page-2.html";
		link.dataset.pageSlug = "page-2";
		let preventedBeforeIsland = false;
		link.addEventListener("click", (event) => {
			preventedBeforeIsland = event.defaultPrevented;
			event.preventDefault();
			navigatePage({
				targetSlug: "page-2",
				direction: "forward",
				currentSlug: "page-1",
			});
		});
		dom.window.document.body.append(link);
		link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
		const navigation = await waitForEvent(events, "navigate");
		expect(preventedBeforeIsland).toBe(false);
		expect(new URL(navigation.url).pathname).toBe("/page-2.html");
		expect(
			parseLearnerState(navigation.state, {
				courseId: identity.courseId,
				attemptId: "studio-preview",
			})?.blockState,
		).toMatchObject({ answer: { value: 2 } });
	});

	it("leaves same-page fragment links to native in-page navigation", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");

		const target = dom.window.document.createElement("div");
		target.id = "section";
		const link = dom.window.document.createElement("a");
		link.href = "#section";
		dom.window.document.body.append(link, target);
		link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
		await waitForFreezeBarrier(channel.port1, events);
		expect(events.some((event) => event.event === "navigate")).toBe(false);
	});

	it("does not turn modified same-course clicks into current-frame navigation", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");

		const link = dom.window.document.createElement("a");
		link.href = "./page-2.html";
		dom.window.document.body.append(link);
		link.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
		);
		await waitForFreezeBarrier(channel.port1, events);
		expect(events.some((event) => event.event === "navigate")).toBe(false);
	});

	it("freezes bounded state, blocks writes, and resumes them through the port", async () => {
		const dom = previewDocument();
		const parent = installHost(dom);
		const channel = new MessageChannel();
		const events = listen(channel.port1);
		sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
		await waitForEvent(events, "connected");
		channel.port1.postMessage(restoreMessage(learnerState(), true));
		await waitForEvent(events, "ready");
		const previewRuntime = runtime(dom);

		const persistedBeforeMutation = events.filter((event) => event.event === "persist").length;
		previewRuntime.setBlockState("before-freeze", { value: 1 });
		await vi.waitFor(() =>
			expect(events.filter((event) => event.event === "persist").length).toBeGreaterThan(
				persistedBeforeMutation,
			),
		);

		const frozen = waitForEvent(events, "frozen");
		channel.port1.postMessage({
			source: "praxity-studio",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			action: "freeze",
			...identity,
		});
		const frozenEvent = await frozen;
		expect(new TextEncoder().encode(frozenEvent.state).byteLength).toBeLessThanOrEqual(
			LEARNER_STATE_MAX_BYTES,
		);
		expect(
			parseLearnerState(frozenEvent.state, {
				courseId: identity.courseId,
				attemptId: "studio-preview",
			}),
		).toMatchObject({
			blockState: { "before-freeze": { value: 1 } },
		});

		const persistedAtFreeze = events.filter((event) => event.event === "persist").length;
		previewRuntime.setBlockState("after-freeze", { value: 2 });
		await waitForFreezeBarrier(channel.port1, events);
		expect(events.filter((event) => event.event === "persist")).toHaveLength(persistedAtFreeze);
		expect(previewRuntime.getBlockState("after-freeze")).toBeUndefined();

		const resumed = learnerState({ resumed: { value: 3 } });
		channel.port1.postMessage({
			source: "praxity-studio",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			action: "resume",
			state: resumed,
			...identity,
		});
		await vi.waitFor(() => expect(previewRuntime.getBlockState("resumed")).toEqual({ value: 3 }));
		const persistedBeforeResumeMutation = events.filter(
			(event) => event.event === "persist",
		).length;
		previewRuntime.setBlockState("after-resume", { value: 4 });
		await vi.waitFor(() =>
			expect(events.filter((event) => event.event === "persist").length).toBeGreaterThan(
				persistedBeforeResumeMutation,
			),
		);
		expect(previewRuntime.getBlockState("after-resume")).toEqual({ value: 4 });
	});

	it("renders localized, idempotent logic annotations at stable block IDs", () => {
		const dom = previewDocument();
		dom.window.document.body.innerHTML = `
			<script id="praxity-config" type="application/json">${JSON.stringify({
				strings: {
					logicAuthoringOverlay: "Authoring logic",
					logicCondition: "condition",
					logicConditions: "conditions",
					logicAction: "action",
					logicActions: "actions",
				},
				logic: {
					rules: [{ blockId: "logic-stable", conditions: { rules: [{}, {}] }, actions: [{}] }],
				},
			})}</script>
			<div id="block-logic-stable"></div>`;
		vi.stubGlobal("document", dom.window.document);
		renderLogicAnnotations(true);
		renderLogicAnnotations(true);
		const notes = dom.window.document.querySelectorAll("[data-praxity-preview-logic]");
		expect(notes).toHaveLength(1);
		expect(notes[0]?.getAttribute("role")).toBe("note");
		expect(notes[0]?.textContent).toContain("2 conditions → 1 action");
		renderLogicAnnotations(false);
		expect(dom.window.document.querySelector("[data-praxity-preview-logic]")).toBeNull();
	});
});

it.each(["en", "fr"] as const)(
	"keeps compiled %s highlight bytes out of the real preview port through reset, freeze, resume and reload",
	async (locale) => {
		const html = await highlightPrivacyPreview(identity.courseId, identity.pageId, locale);
		let saved = learnerState();
		for (const reload of [false, true]) {
			const dom = previewDocument(false, html);
			const parent = installHost(dom);
			const channel = new MessageChannel();
			const events = listen(channel.port1);
			const instances: (() => void)[] = [];
			try {
				sendWindowMessage(dom, parent, connectMessage(), parentOrigin, [channel.port2]);
				await waitForEvent(events, "connected");
				channel.port1.postMessage(restoreMessage(saved, true));
				await waitForEvent(events, "ready");
				const active = runtime(dom) as RuntimeProbe & SCORMRuntime;
				if (reload)
					expect(active.getInteractions()).toContainEqual(
						expect.objectContaining({ id: "check", response: "ordinary-answer" }),
					);
				const calls: unknown[] = [];
				const provider = dom.window.__praxityBlockState!;
				for (const name of ["get", "set"] as const) {
					const original = provider[name];
					vi.spyOn(provider, name).mockImplementation((...args: unknown[]) => {
						calls.push([name, ...args]);
						return Reflect.apply(original, provider, args);
					});
				}
				for (const name of [
					"getBlockState",
					"setBlockState",
					"trackInteraction",
					"setSuspendData",
					"setCompletion",
					"commit",
				] as const) {
					const original = active[name];
					if (original)
						vi.spyOn(active, name).mockImplementation((...args: unknown[]) => {
							calls.push([name, ...args]);
							return Reflect.apply(original, active, args);
						});
				}
				dom.window.document.addEventListener("praxity:assessment-response", (event) =>
					calls.push(["response", (event as CustomEvent).detail]),
				);
				const check = () => {
					expect(calls).toEqual([]);
					expect(
						dom.window.document.querySelectorAll(
							"[data-highlight][data-completed], [data-highlight][data-attempted], [data-highlight] [data-completed], [data-highlight] [data-attempted]",
						),
					).toHaveLength(0);
				};
				const localAttempt = () => {
					for (const root of dom.window.document.querySelectorAll<HTMLElement>(
						"[data-highlight]",
					)) {
						root.querySelector<HTMLElement>("[data-highlight-chunk]")!.click();
						root.querySelector<HTMLButtonElement>("[data-highlight-check]")!.click();
						check();
						root.querySelector<HTMLButtonElement>("[data-highlight-restart]")!.click();
						check();
					}
				};
				const mount = () => {
					instances.push(attachHighlightIsland());
					expect(
						dom.window.document.querySelectorAll(
							'[data-island="highlight"] [data-highlight-enhanced]',
						),
					).toHaveLength(2);
				};
				mount();
				check();
				exerciseHighlightPrivacy(dom.window.document, check, mount);
				const screen = [...dom.window.document.querySelectorAll("[data-highlight]")].map(
					(root) => root.outerHTML,
				);
				// Preview has no reset protocol command. Exercise its actual mutable runtime reset.
				active.resetState();
				expect(JSON.stringify(calls)).not.toMatch(
					/HL-PRIVATE|HL-one|HL-two|HL-wrong|data-highlight|marked|shown/,
				);
				calls.length = 0;
				expect(
					[...dom.window.document.querySelectorAll("[data-highlight]")].map(
						(root) => root.outerHTML,
					),
				).toEqual(screen);
				instances.splice(0).forEach((destroy) => destroy());
				mount();
				check();
				expect(
					dom.window.document.querySelectorAll('[data-highlight-chunk][aria-pressed="true"]'),
				).toHaveLength(0);
				localAttempt();
				provider.set("check", { answer: ["ordinary-answer"], checked: true });
				dom.window.document.dispatchEvent(
					new dom.window.CustomEvent("praxity:assessment-response", {
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
				new VariableStore(
					[{ name: "publicFlag", dataType: "boolean", defaultValue: false }],
					active,
				).set("publicFlag", true);
				await waitForFreezeBarrier(channel.port1, events);
				const frozen = events.filter((event) => event.event === "frozen").at(-1)!;
				saved = frozen.state;
				expect(saved).toContain("ordinary-answer");
				expect(
					parseLearnerState(saved, { courseId: identity.courseId, attemptId: "studio-preview" })
						?.custom,
				).toContain('"publicFlag":true');
				expect(
					events
						.filter((event) => event.event === "persist")
						.some((event) => event.state.includes("ordinary-answer")),
				).toBe(true);
				expect(JSON.stringify(calls)).not.toMatch(
					/HL-PRIVATE|HL-one|HL-two|HL-wrong|data-highlight|marked|shown/,
				);
				calls.length = 0;
				localAttempt();
				const resumed = parseLearnerState(saved, {
					courseId: identity.courseId,
					attemptId: "studio-preview",
				})!;
				resumed.custom = JSON.stringify({ publicFlag: true, resumeControl: true });
				saved = serializeLearnerState(resumed);
				channel.port1.postMessage({
					...identity,
					source: "praxity-studio",
					version: COURSE_PREVIEW_PROTOCOL_VERSION,
					action: "resume",
					state: saved,
				});
				await vi.waitFor(() => expect(active.getSuspendData()).toContain('"resumeControl":true'));
				calls.length = 0;
				localAttempt();
				dom.window.dispatchEvent(new dom.window.Event("pagehide"));
				await vi.waitFor(() =>
					expect(events.filter((event) => event.event === "persist").at(-1)?.state).toBe(saved),
				);
				expect(JSON.stringify({ events, calls })).not.toMatch(
					/HL-PRIVATE|HL-one|HL-two|HL-wrong|data-highlight|marked|shown/,
				);
			} finally {
				instances.forEach((destroy) => destroy());
				channel.port1.close();
				channel.port2.close();
				dom.window.close();
				vi.restoreAllMocks();
			}
		}
	},
);
