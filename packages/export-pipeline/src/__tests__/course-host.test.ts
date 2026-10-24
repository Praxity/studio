import {
	type ChoiceStateQuestion,
	choiceQuestionSignature,
} from "@praxity/shared-blocks/choice-state-facts";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
	type CourseHostAdapter,
	type CourseHostEnvironment,
	composeScormResumeUrl,
	initializeCourseHost,
	prepareScormResume,
	prepareStandaloneResume,
	readCourseDeploymentConfig,
	readCourseHostConfig,
	type ScormCourseHostAdapter,
} from "../../template/src/hosts/course-host";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";
import { LMS_DESTINATIONS } from "../scorm/types";

const pageConfig = {
	version: 1,
	courseId: "course-1",
	pageId: "page-stable",
	pageTitle: "Welcome",
	currentPage: 1,
	totalPages: 2,
	currentSlug: "welcome",
	availableSlugs: ["welcome", "summary"],
	pageIdMap: { "page-stable": "welcome", "page-summary": "summary" },
	completionMethod: "allPages",
	pageRole: "content",
	strings: { scormResumeAnnouncement: "Page {current} of {total}: {title}" },
} as const;

function withScormResume(adapter: ScormCourseHostAdapter): CourseHostAdapter {
	return { ...adapter, prepareResume: (environment) => prepareScormResume(adapter, environment) };
}

function createEnvironment(
	deployment: unknown = { format: "scorm12" },
	page: unknown = pageConfig,
): { dom: JSDOM; environment: CourseHostEnvironment; replace: ReturnType<typeof vi.fn> } {
	const dom = new JSDOM(
		`<!doctype html><body><main><h1>Welcome</h1></main><div id="praxity-live-region"></div><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify(deployment)}</script></body>`,
		{ url: "https://course.example/welcome.html?source=test#content" },
	);
	Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
	const replace = vi.fn();
	return {
		dom,
		replace,
		environment: {
			win: dom.window as unknown as Window,
			doc: dom.window.document,
			location: {
				href: dom.window.location.href,
				search: dom.window.location.search,
				replace,
			},
			history: dom.window.history,
		},
	};
}

describe("course host", () => {
	it("keeps the base LMS write log with one invalid fact and another valid question", () => {
		const question: ChoiceStateQuestion = {
			selectionMode: "single",
			dontKnow: false,
			canAutoScore: true,
			graded: true,
			maxAttempts: 1,
			correctIds: ["a"],
			gradingMode: "exact" as const,
			points: 100,
			required: true,
			content: { text: "b", images: [], icons: [] },
			options: [{ id: "a", content: { text: "c", images: [], icons: [] }, image: null }],
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const run = (facts: boolean) => {
			const page = {
				...pageConfig,
				...(facts
					? {
							choiceStateQuestions: { broken: { ...question, maxAttempts: 2.5 }, good: question },
							choiceStateSignatures: {
								broken: choiceQuestionSignature(question),
								good: choiceQuestionSignature(question),
							},
						}
					: {}),
			};
			const { dom, environment } = createEnvironment({ format: "scorm12" }, page);
			try {
				const runtime = recordingRuntime();
				expect(
					initializeCourseHost({ format: "scorm12", createRuntime: () => runtime }, environment),
				).toBe(true);
				dom.window.document.dispatchEvent(
					new dom.window.CustomEvent("praxity:assessment-response", {
						detail: { blockId: "good", responseText: "A", correct: true, score: 1, maxScore: 1 },
					}),
				);
				expect(runtime.trackPageVisit).toHaveBeenCalledExactlyOnceWith("page-stable");
				expect(runtime.trackInteraction).toHaveBeenCalled();
				return Object.fromEntries(
					[
						"trackPageVisit",
						"trackInteraction",
						"setCompletion",
						"setScore",
						"setBookmark",
						"trackObjective",
						"commit",
					].map((key) => [
						key,
						(runtime[key as keyof typeof runtime] as ReturnType<typeof vi.fn>).mock.calls,
					]),
				);
			} finally {
				dom.window.close();
			}
		};
		try {
			expect(run(true)).toEqual(run(false));
		} finally {
			warn.mockRestore();
		}
	});
	it.each(["provider", "pagehide"] as const)(
		"%s revokes a held privacy-ready continuation",
		async (boundary) => {
			const { dom, environment } = createEnvironment();
			try {
				let release!: () => void;
				const ready = vi.fn();
				const win = dom.window as unknown as Window;
				win.__praxityPrivacyReady = new Promise<void>((resolve) => {
					release = resolve;
				});
				dom.window.addEventListener("praxity:runtime-ready", ready);
				initializeCourseHost(
					{ format: "scorm12", createRuntime: () => recordingRuntime() },
					environment,
				);
				if (boundary === "provider") win.__praxityBlockState = { get: () => undefined, set() {} };
				else dom.window.dispatchEvent(new dom.window.Event("pagehide"));
				release();
				await win.__praxityPrivacyReady;
				expect(ready).not.toHaveBeenCalled();
			} finally {
				dom.window.close();
				vi.unstubAllGlobals();
			}
		},
	);
	it("publishes provider-ready before deferring visits and completion to current learner finalization", () => {
		const { dom, environment } = createEnvironment();
		dom.window.document.documentElement.setAttribute("data-self-check-dependencies", "A");
		const configElement = dom.window.document.getElementById("praxity-host-config");
		if (configElement)
			configElement.textContent = JSON.stringify({
				...JSON.parse(configElement.textContent ?? "{}"),
				deferVisits: true,
			});
		const runtime = recordingRuntime();
		const ready = vi.fn();
		dom.window.addEventListener("praxity:runtime-ready", ready);
		initializeCourseHost({ format: "scorm12", createRuntime: () => runtime }, environment);
		expect(ready).toHaveBeenCalledOnce();
		expect((dom.window as unknown as Window).__praxityBlockState).toBeDefined();
		expect(runtime.trackPageVisit).not.toHaveBeenCalled();
		expect(runtime.setCompletion).not.toHaveBeenCalled();
		const finalize = (dom.window as unknown as Window).__praxityBlockState?.finalizeLearner;
		finalize?.({ revision: 2, current: () => true });
		expect(runtime.trackPageVisit).toHaveBeenCalledExactlyOnceWith("page-stable");
		dom.window.close();
	});
	it.each(["scorm12", "scorm2004"] as const)(
		"restores a private journal's savedAt with its response through %s suspend data",
		(format) => {
			let suspendData: string | null = null;
			const runtime = {
				...recordingRuntime(),
				getSuspendData: () => suspendData,
				setSuspendData: vi.fn((value: string) => {
					suspendData = value;
				}),
			};
			const first = createEnvironment({ format });
			initializeCourseHost({ format, createRuntime: () => runtime }, first.environment);
			(first.dom.window as unknown as Window).__praxityBlockState?.set("journal", {
				version: 1,
				assessmentType: "textResponse",
				checked: true,
				answer: "Private reflection",
				savedAt: "2026-10-08T14:05:00.000Z",
			});
			expect(JSON.parse(suspendData ?? "{}")).toMatchObject({
				blockState: {
					journal: { answer: "Private reflection", savedAt: "2026-10-08T14:05:00.000Z" },
				},
			});
			const second = createEnvironment({ format });
			initializeCourseHost({ format, createRuntime: () => runtime }, second.environment);
			expect((second.dom.window as unknown as Window).__praxityBlockState?.get("journal")).toEqual({
				version: 1,
				assessmentType: "textResponse",
				checked: true,
				answer: "Private reflection",
				savedAt: "2026-10-08T14:05:00.000Z",
			});
			expect(first.dom.window.localStorage.length).toBe(0);
			expect(runtime.trackInteraction).not.toHaveBeenCalled();
			first.dom.window.close();
			second.dom.window.close();
		},
	);
	it.each(["timing", "legacy", "persisted"])(
		"standalone refuses resume and URL replacement on a %s history arrival",
		(source) => {
			const { dom, environment, replace } = createEnvironment({ format: "standalone" });
			dom.window.history.replaceState(null, "", "/welcome.html?praxity-resume=1");
			environment.location.href = dom.window.location.href;
			environment.location.search = dom.window.location.search;
			Object.defineProperty(dom.window.performance, "getEntriesByType", {
				value: () => (source === "timing" ? [{ type: "back_forward" }] : []),
			});
			Object.defineProperty(dom.window.performance, "navigation", {
				value: { type: source === "legacy" ? 2 : 0 },
			});
			const resume = prepareStandaloneResume(environment);
			if (source === "persisted")
				dom.window.dispatchEvent(
					new dom.window.PageTransitionEvent("pageshow", { persisted: true }),
				);
			const replaceState = vi.spyOn(dom.window.history, "replaceState");
			expect(
				resume(recordingRuntime({ bookmark: "page-summary" }), {
					...pageConfig,
					availableSlugs: [...pageConfig.availableSlugs],
				}),
			).toBeNull();
			expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
			expect(replace).not.toHaveBeenCalled();
			expect(replaceState).not.toHaveBeenCalled();
			dom.window.close();
		},
	);
	it.each([false, true])(
		"standalone pageshow persisted=%s clears only a cached resume",
		(persisted) => {
			const { dom, environment } = createEnvironment({ format: "standalone" });
			prepareStandaloneResume(environment);
			const win = dom.window as unknown as Window;
			win.__praxityResume = { pageId: "page-stable" };
			dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pageshow", { persisted }));
			expect(win.__praxityResume).toEqual(persisted ? undefined : { pageId: "page-stable" });
			dom.window.close();
		},
	);
	for (const format of ["standalone", "scorm12", "scorm2004"] as const) {
		for (const timing of ["modern", "legacy"] as const) {
			it.each(["reload", "back_forward"] as const)(
				`${format} ${timing} %s keeps browser history with a later saved bookmark`,
				(type) => {
					const { dom, environment, replace } = createEnvironment({ format });
					Object.defineProperty(dom.window.performance, "getEntriesByType", {
						value: () => (timing === "modern" ? [{ type }] : []),
					});
					Object.defineProperty(dom.window.performance, "navigation", {
						value: { type: type === "reload" ? 1 : 2 },
					});
					const runtime = recordingRuntime({ bookmark: "page-summary" });
					const adapter: CourseHostAdapter =
						format === "standalone"
							? { format, createRuntime: () => runtime, prepareResume: prepareStandaloneResume }
							: withScormResume({
									format,
									createRuntime: () => runtime,
									readEntry: () => "resume",
								});
					initializeCourseHost(adapter, environment);
					expect(replace).not.toHaveBeenCalled();
					expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
					dom.window.close();
				},
			);
		}
	}
	it("resumes a valid legacy slug that shares an Object prototype name", () => {
		const { dom, environment, replace } = createEnvironment(
			{ format: "standalone" },
			{
				...pageConfig,
				availableSlugs: ["welcome", "constructor"],
				pageIdMap: { ...pageConfig.pageIdMap, "page-summary": "constructor" },
			},
		);
		initializeCourseHost(
			{
				format: "standalone",
				createRuntime: () => recordingRuntime({ bookmark: "constructor" }),
				prepareResume: prepareStandaloneResume,
			},
			environment,
		);
		expect(replace).toHaveBeenCalledWith(
			"https://course.example/constructor.html?source=test&praxity-resume=1#content",
		);
		dom.window.close();
	});
	it("refuses resume on reload before navigation timing entries are available", () => {
		const { dom, environment, replace } = createEnvironment(
			{ format: "standalone" },
			{
				...pageConfig,
				currentPage: 2,
				currentSlug: "summary",
				pageId: "page-summary",
			},
		);
		Object.defineProperty(dom.window.performance, "getEntriesByType", { value: () => [] });
		Object.defineProperty(dom.window.performance, "navigation", { value: { type: 1 } });
		initializeCourseHost(
			{
				format: "standalone",
				createRuntime: () => recordingRuntime({ bookmark: "page-summary" }),
				prepareResume: prepareStandaloneResume,
			},
			environment,
		);
		expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
		expect(replace).not.toHaveBeenCalled();
		dom.window.close();
	});
	it.each(["page-summary", "summary", "index.html?praxity-page=page-summary"])(
		"standalone uses the shared destination policy for bookmark %s before recording arrival",
		(bookmark) => {
			const { dom, environment, replace } = createEnvironment({ format: "standalone" });
			const runtime = recordingRuntime({ bookmark });
			initializeCourseHost(
				{
					format: "standalone",
					createRuntime: () => runtime,
					prepareResume: prepareStandaloneResume,
				},
				environment,
			);
			expect(replace).toHaveBeenCalledWith(
				"https://course.example/summary.html?source=test&praxity-resume=1#content",
			);
			expect(runtime.trackPageVisit).not.toHaveBeenCalled();
			dom.window.close();
		},
	);
	it.each([false, true])(
		"standalone reload keeps the saved destination outside resume with deck=%s",
		(deck) => {
			const { dom, environment, replace } = createEnvironment(
				{ format: "standalone" },
				{
					...pageConfig,
					deck,
					currentPage: 2,
					currentSlug: "summary",
					pageId: "page-summary",
				},
			);
			dom.window.history.replaceState(null, "", `/summary.html${deck ? "#page-summary" : ""}`);
			environment.location.href = dom.window.location.href;
			environment.location.search = "";
			Object.defineProperty(dom.window.performance, "getEntriesByType", {
				value: () => [{ type: "reload" }],
			});
			const runtime = recordingRuntime({ bookmark: "page-summary" });
			let arrival: unknown;
			dom.window.addEventListener("praxity:runtime-ready", () => {
				arrival = (dom.window as unknown as Window).__praxityResume;
			});
			initializeCourseHost(
				{
					format: "standalone",
					createRuntime: () => runtime,
					prepareResume: prepareStandaloneResume,
				},
				environment,
			);
			expect(arrival).toBeUndefined();
			expect(replace).not.toHaveBeenCalled();
			dom.window.close();
		},
	);
	it.each([
		"explicit",
		"fragment",
		"ordinary-page",
		"utility",
		"missing",
		"removed",
		"prototype",
		"storage-error",
	])("standalone keeps %s outside resume orientation", (arrival) => {
		const { dom, environment, replace } = createEnvironment(
			{ format: "standalone" },
			{
				...pageConfig,
				...(arrival === "ordinary-page" ? { currentPage: 2 } : {}),
				...(arrival === "utility" ? { pageRole: "resources" } : {}),
				...(arrival === "fragment" ? { deck: true } : {}),
			},
		);
		if (arrival === "explicit") environment.location.search = "?praxity-resume=0";
		if (arrival === "fragment") {
			Object.defineProperty(dom.window.performance, "getEntriesByType", {
				value: () => [{ type: "reload" }],
			});
			environment.location.href = "https://course.example/welcome.html#other-slide";
		}
		const runtime = recordingRuntime({
			bookmark:
				arrival === "removed"
					? "removed-page"
					: arrival === "prototype"
						? "__proto__"
						: "page-summary",
		});
		if (arrival === "missing") runtime.getBookmark = () => null;
		if (arrival === "storage-error")
			runtime.getBookmark = () => {
				throw new Error("Storage denied");
			};
		initializeCourseHost(
			{
				format: "standalone",
				createRuntime: () => runtime,
				prepareResume: prepareStandaloneResume,
			},
			environment,
		);
		expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
		expect(replace).not.toHaveBeenCalled();
		dom.window.close();
	});
	it.each(["scorm12", "scorm2004", "standalone"] as const)(
		"forwards resolved retry metadata without finalizing retryable failure for %s",
		(format) => {
			const { dom, environment } = createEnvironment(
				{ format },
				{
					...pageConfig,
					passMark: 80,
					scoredAssessmentIds: ["question"],
				},
			);
			const runtime = recordingRuntime();
			initializeCourseHost({ format, createRuntime: () => runtime }, environment);
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", {
					detail: {
						blockId: "question",
						responseText: "wrong",
						score: 0,
						maxScore: 100,
						correct: false,
						attemptsUsed: 1,
						maxAttempts: Number.POSITIVE_INFINITY,
					},
				}),
			);
			expect(runtime.trackInteraction).toHaveBeenLastCalledWith("question", "wrong", false, 0, {
				assessmentType: undefined,
				description: "Welcome",
				attemptsUsed: 1,
				maxAttempts: 0,
			});
			expect(runtime.setCompletion).not.toHaveBeenCalled();
			dom.window.close();
		},
	);

	it("passes active group membership to the tracker", () => {
		const { dom, environment } = createEnvironment();
		const runtime = recordingRuntime();
		initializeCourseHost({ format: "scorm12", createRuntime: () => runtime }, environment);
		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-group-complete", {
				detail: {
					groupId: "group",
					groupName: "Optics questions",
					score: 40,
					passed: false,
					memberIds: ["selected"],
				},
			}),
		);
		expect(runtime.trackInteraction).toHaveBeenLastCalledWith("group", "40%", false, 40, {
			memberIds: ["selected"],
			description: "Optics questions",
		});
		dom.window.close();
	});
	it.each([false, true])(
		"keeps an explicitly selected entry outside resume with deck=%s",
		(deck) => {
			const { dom, environment, replace } = createEnvironment(undefined, { ...pageConfig, deck });
			dom.window.history.replaceState(null, "", "/welcome.html?praxity-resume=0");
			environment.location.href = dom.window.location.href;
			environment.location.search = dom.window.location.search;
			initializeCourseHost(
				withScormResume({
					format: "scorm12",
					createRuntime: () => recordingRuntime({ bookmark: "page-stable" }),
					readEntry: () => "resume",
				}),
				environment,
			);
			expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
			expect(replace).not.toHaveBeenCalled();
			expect(dom.window.location.search).toBe("");
			dom.window.close();
		},
	);
	it("keeps an explicit module-entry link outside resume when its bookmark names another slide", () => {
		const { dom, environment, replace } = createEnvironment(undefined, {
			...pageConfig,
			deck: true,
			currentPage: 2,
			currentSlug: "summary",
		});
		dom.window.history.replaceState(null, "", "/summary.html?praxity-resume=1");
		environment.location.href = dom.window.location.href;
		environment.location.search = dom.window.location.search;
		initializeCourseHost(
			withScormResume({
				format: "scorm12",
				createRuntime: () => recordingRuntime({ bookmark: "page-stable" }),
				readEntry: () => "resume",
			}),
			environment,
		);
		expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
		expect(replace).not.toHaveBeenCalled();
		dom.window.close();
	});
	it("publishes the confirmed destination and tracker before runtime-ready", () => {
		const { dom, environment } = createEnvironment();
		const runtime = recordingRuntime({ bookmark: "page-stable" });
		const arrivals: unknown[] = [];
		dom.window.addEventListener("praxity:runtime-ready", () => {
			const host = dom.window as unknown as {
				__praxityResume?: { pageId: string };
				__praxityTracker?: unknown;
			};
			arrivals.push({ resume: host.__praxityResume, trackerReady: !!host.__praxityTracker });
		});
		initializeCourseHost(
			withScormResume({
				format: "scorm12",
				createRuntime: () => runtime,
				readEntry: () => "resume",
			}),
			environment,
		);
		expect(arrivals).toEqual([{ resume: { pageId: "page-stable" }, trackerReady: true }]);
		dom.window.close();
	});

	it.each(["ab-initio", "fallback", "continuing", "unknown-bookmark", "deep-link"])(
		"keeps %s arrivals outside resume orientation",
		(arrival) => {
			const { dom, environment, replace } = createEnvironment(undefined, {
				...pageConfig,
				...(arrival === "deep-link" ? { deck: true } : {}),
			});
			if (arrival === "deep-link") {
				dom.window.history.replaceState(null, "", "/welcome.html#other-slide");
				environment.location.href = dom.window.location.href;
			}
			if (arrival === "continuing")
				Object.assign(dom.window, {
					API: {
						__praxityScormSession: {
							initialized: true,
							closed: false,
							terminationSucceeded: false,
						},
					},
				});
			const runtime = recordingRuntime({
				bookmark: arrival === "unknown-bookmark" ? "removed-page" : "page-summary",
			});
			initializeCourseHost(
				withScormResume({
					format: "scorm12",
					createRuntime: () => runtime,
					readEntry: () => (arrival === "ab-initio" ? "ab-initio" : "resume"),
					isFallback: () => arrival === "fallback",
				}),
				environment,
			);
			expect(replace).not.toHaveBeenCalled();
			expect((dom.window as unknown as Window).__praxityResume).toBeUndefined();
			expect(dom.window.document.getElementById("praxity-live-region")?.textContent).toBe("");
			dom.window.close();
		},
	);

	it.each(["scorm12", "scorm2004"] as const)(
		"confirms the %s redirected destination after an active-session marker",
		(format) => {
			const { dom, environment, replace } = createEnvironment(
				{ format },
				{
					...pageConfig,
					currentPage: 2,
					currentSlug: "summary",
					pageId: "page-summary",
				},
			);
			dom.window.history.replaceState(null, "", "/summary.html?praxity-resume=1");
			environment.location.href = dom.window.location.href;
			environment.location.search = dom.window.location.search;
			Object.assign(dom.window, {
				[format === "scorm12" ? "API" : "API_1484_11"]: {
					__praxityScormSession: { initialized: true, closed: false, terminationSucceeded: false },
				},
			});
			initializeCourseHost(
				withScormResume({
					format,
					createRuntime: () => recordingRuntime({ bookmark: "page-summary" }),
					readEntry: () => "resume",
				}),
				environment,
			);
			expect(replace).not.toHaveBeenCalled();
			expect((dom.window as unknown as Window).__praxityResume).toEqual({ pageId: "page-summary" });
			expect(dom.window.location.search).toBe("");
			dom.window.close();
		},
	);

	it.each(["page-summary", "summary", "index.html?praxity-page=page-summary"])(
		"resolves the logical slide from bookmark %s after the existing alias redirect",
		(bookmark) => {
			const { dom, environment, replace } = createEnvironment(undefined, {
				...pageConfig,
				deck: true,
			});
			dom.window.history.replaceState(null, "", "/welcome.html?praxity-resume=1#page-summary");
			environment.location.href = dom.window.location.href;
			environment.location.search = dom.window.location.search;
			const config = dom.window.document.createElement("script");
			config.id = "praxity-config";
			config.textContent = JSON.stringify({
				deckPages: [
					{ id: "page-stable", slug: "welcome", moduleSlug: "welcome" },
					{ id: "page-summary", slug: "summary", moduleSlug: "welcome" },
				],
			});
			dom.window.document.body.append(config);
			initializeCourseHost(
				withScormResume({
					format: "scorm12",
					createRuntime: () => recordingRuntime({ bookmark }),
					readEntry: () => "resume",
				}),
				environment,
			);
			expect(replace).not.toHaveBeenCalled();
			expect((dom.window as unknown as Window).__praxityResume).toEqual({ pageId: "page-summary" });
			dom.window.close();
		},
	);

	it("reports a runtime initialization failure for presentation fallback", () => {
		const { dom, environment } = createEnvironment({ format: "standalone" });
		const runtime = new LocalStorageRuntime(dom.window.localStorage, "course-1", "test");
		vi.spyOn(runtime, "initialize").mockReturnValue(false);
		expect(() =>
			initializeCourseHost({ format: "standalone", createRuntime: () => runtime }, environment),
		).toThrow(Error);
		dom.window.close();
	});

	it("does not initialize learner state for small previews", () => {
		const { dom, environment } = createEnvironment({ format: "standalone" });
		environment.location.search = "?minimal=1&praxity-small-preview=1";
		const createRuntime = vi.fn();

		expect(initializeCourseHost({ format: "standalone", createRuntime }, environment)).toBe(false);
		expect(createRuntime).not.toHaveBeenCalled();
		expect(
			(dom.window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime,
		).toBeUndefined();
		dom.window.close();
	});

	it("parses the inert page config and rejects malformed stable identity", () => {
		const { dom } = createEnvironment();
		expect(readCourseHostConfig(dom.window.document)).toMatchObject(pageConfig);
		const malformed = createEnvironment(undefined, { ...pageConfig, pageId: "" });
		expect(readCourseHostConfig(malformed.dom.window.document)).toBeNull();
		const unsupported = createEnvironment(undefined, { ...pageConfig, version: 2 });
		expect(readCourseHostConfig(unsupported.dom.window.document)).toBeNull();
		dom.window.close();
		malformed.dom.window.close();
		unsupported.dom.window.close();
	});

	it("validates optional required assessment IDs", () => {
		for (const requiredAssessmentIds of [[], ["question", "group"]]) {
			const { dom } = createEnvironment(undefined, { ...pageConfig, requiredAssessmentIds });
			expect(readCourseHostConfig(dom.window.document)?.requiredAssessmentIds).toEqual(
				requiredAssessmentIds,
			);
			dom.window.close();
		}
		for (const requiredAssessmentIds of ["question", [12], [""], null]) {
			const { dom } = createEnvironment(undefined, { ...pageConfig, requiredAssessmentIds });
			expect(readCourseHostConfig(dom.window.document)).toBeNull();
			dom.window.close();
		}
	});

	it("validates the optional course pass mark", () => {
		const valid = createEnvironment(undefined, {
			...pageConfig,
			passMark: 50,
			scoredAssessmentIds: ["question"],
		});
		expect(readCourseHostConfig(valid.dom.window.document)).toMatchObject({
			passMark: 50,
			scoredAssessmentIds: ["question"],
		});
		valid.dom.window.close();
		for (const passMark of [0, 101, "50"]) {
			const { dom } = createEnvironment(undefined, {
				...pageConfig,
				passMark,
				scoredAssessmentIds: ["question"],
			});
			expect(readCourseHostConfig(dom.window.document)).toBeNull();
			dom.window.close();
		}
	});

	it("does nothing when the explicit deployment format does not match", () => {
		const { dom, environment } = createEnvironment({
			format: "xapi",
			xapiConfig: {
				endpoint: "https://lrs.example/xapi",
				auth: "Bearer test",
				actorMode: "manual",
				actor: { name: "Learner", mbox: "learner@example.com" },
			},
		});
		const createRuntime = vi.fn();
		expect(initializeCourseHost({ format: "scorm12", createRuntime }, environment)).toBe(false);
		expect(createRuntime).not.toHaveBeenCalled();
		dom.window.close();
	});

	it("preserves the existing local fallback when xAPI is not configured", () => {
		const { dom } = createEnvironment({ format: "xapi" });
		expect(readCourseDeploymentConfig(dom.window.document)).toEqual({ format: "xapi" });
		dom.window.close();
	});

	it("passes validated xAPI deployment configuration through the host adapter", () => {
		const deployment = {
			format: "xapi",
			xapiConfig: {
				endpoint: "https://lrs.example/xapi",
				auth: "Bearer test",
				actorMode: "manual",
				actor: { name: "Learner", mbox: "learner@example.com" },
			},
		};
		const { dom, environment } = createEnvironment(deployment);
		const createRuntime = vi.fn(() => recordingRuntime());
		expect(
			initializeCourseHost(
				{ format: "xapi", readDeploymentConfig: readCourseDeploymentConfig, createRuntime },
				environment,
			),
		).toBe(true);
		expect(createRuntime).toHaveBeenCalledWith(
			expect.objectContaining({ courseId: "course-1" }),
			deployment,
			environment.win,
		);
		dom.window.close();
	});

	it("rejects malformed xAPI configuration before the adapter creates a runtime", () => {
		const { dom, environment } = createEnvironment({ format: "xapi", xapiConfig: { endpoint: 1 } });
		const createRuntime = vi.fn(() => recordingRuntime());
		expect(
			initializeCourseHost(
				{ format: "xapi", readDeploymentConfig: readCourseDeploymentConfig, createRuntime },
				environment,
			),
		).toBe(false);
		expect(createRuntime).not.toHaveBeenCalled();
		dom.window.close();
	});

	it("reads a declared xAPI activity and ignores malformed older deployment values", () => {
		const declared = createEnvironment({
			format: "xapi",
			courseActivityId: "https://praxity.io/courses/course-1",
		});
		expect(readCourseDeploymentConfig(declared.dom.window.document)).toEqual({
			format: "xapi",
			courseActivityId: "https://praxity.io/courses/course-1",
		});
		declared.dom.window.close();
		const malformed = createEnvironment({ format: "xapi", courseActivityId: "/relative" });
		expect(readCourseDeploymentConfig(malformed.dom.window.document)).toEqual({ format: "xapi" });
		malformed.dom.window.close();
	});

	it("accepts standalone deployment configuration", () => {
		const { dom } = createEnvironment({ format: "standalone" });
		expect(readCourseDeploymentConfig(dom.window.document)).toEqual({ format: "standalone" });
		dom.window.close();
	});

	it("requires a core revision for Electron preview configuration", () => {
		const { dom } = createEnvironment({
			format: "electron-preview",
			revision: "a".repeat(64),
		});
		expect(readCourseDeploymentConfig(dom.window.document)).toEqual({
			format: "electron-preview",
			revision: "a".repeat(64),
		});
		const config = dom.window.document.getElementById("praxity-deployment-config");
		expect(config).not.toBeNull();
		if (config) {
			config.textContent = JSON.stringify({
				format: "electron-preview",
				revision: "short",
			});
		}
		expect(readCourseDeploymentConfig(dom.window.document)).toBeNull();
		dom.window.close();
	});

	it("runs the standalone learner-state host for visits, completion, assessments, and blocks", () => {
		const { dom, environment } = createEnvironment(
			{ format: "standalone" },
			{ ...pageConfig, totalPages: 1 },
		);
		const adapter: CourseHostAdapter = {
			format: "standalone",
			createRuntime: (page) =>
				new LocalStorageRuntime(dom.window.localStorage, page.courseId, "default"),
		};
		expect(initializeCourseHost(adapter, environment)).toBe(true);
		expect(initializeCourseHost(adapter, environment)).toBe(false);

		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-response", {
				detail: {
					blockId: "assessment-stable",
					responseText: "A",
					correct: true,
					score: 1,
					maxScore: 1,
				},
			}),
		);
		const blockState = (
			dom.window as unknown as {
				__praxityBlockState?: { get(id: string): unknown; set(id: string, value: unknown): void };
			}
		).__praxityBlockState;
		blockState?.set("checklist-stable", { checked: ["item-1"] });
		expect(blockState?.get("checklist-stable")).toEqual({ checked: ["item-1"] });

		const state = JSON.parse(
			dom.window.localStorage.getItem("praxity:course-1:default:state") ?? "{}",
		);
		expect(state.visitedPageIds).toEqual(["page-stable"]);
		expect(state.bookmark).toBe("page-stable");
		expect(state.completion).toBe("completed");
		expect(state.interactions).toMatchObject([
			{ id: "assessment-stable", response: "A", correct: true, score: 100 },
		]);
		expect(state.blockState).toEqual({
			"checklist-stable": { checked: ["item-1"] },
		});
		dom.window.close();
	});

	it.each(["rating-stable", "__proto__", "constructor"])(
		"shares %s block state through the published runtime suspend-data seam",
		(blockId) => {
			const { dom, environment } = createEnvironment();
			let suspendData = JSON.stringify({
				v: { score: 1 },
				blockState: { "checklist-stable": { checked: ["item-1"] } },
			});
			const runtime = {
				...recordingRuntime(),
				getSuspendData: () => suspendData,
				setSuspendData: vi.fn((value: string) => {
					suspendData = value;
				}),
			};
			initializeCourseHost({ format: "scorm12", createRuntime: () => runtime }, environment);
			const blockState = (
				dom.window as unknown as {
					__praxityBlockState?: { get(id: string): unknown; set(id: string, value: unknown): void };
				}
			).__praxityBlockState;

			blockState?.set(blockId, { value: 4 });

			expect(JSON.parse(suspendData)).toEqual({
				v: { score: 1 },
				blockState: { "checklist-stable": { checked: ["item-1"] }, [blockId]: { value: 4 } },
			});
			expect(blockState?.get(blockId)).toEqual({ value: 4 });
			dom.window.close();
		},
	);

	it("rehydrates block state and rejects a writer made stale by reset", () => {
		const dom = new JSDOM("", { url: "https://course.example/" });
		const first = new LocalStorageRuntime(
			dom.window.localStorage,
			"course-1",
			"studio-preview",
			"a".repeat(64),
		);
		first.setBlockState("checklist-stable", { checked: ["item-1"] });
		const current = new LocalStorageRuntime(
			dom.window.localStorage,
			"course-1",
			"studio-preview",
			"b".repeat(64),
		);
		expect(current.getBlockState("checklist-stable")).toEqual({ checked: ["item-1"] });
		current.resetState();
		first.setBlockState("checklist-stable", { checked: ["stale"] });
		expect(current.getBlockState("checklist-stable")).toBeUndefined();
		dom.window.close();
	});

	it("tracks assessment groups as objectives and scored interactions, then commits", () => {
		const { dom, environment } = createEnvironment();
		const runtime = recordingRuntime();
		const adapter: CourseHostAdapter = {
			format: "scorm12",
			createRuntime: () => runtime,
		};
		initializeCourseHost(adapter, environment);
		expect(runtime.setBookmark).toHaveBeenCalledWith("index.html?praxity-page=page-stable");
		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-group-complete", {
				detail: { groupId: "group-stable", score: 75, passed: true },
			}),
		);

		expect(runtime.trackObjective).toHaveBeenCalledWith("group-stable", 75, true);
		expect(runtime.trackInteraction).toHaveBeenCalledWith("group-stable", "75%", true, 75, {
			description: "Welcome",
		});
		expect(runtime.commit).toHaveBeenCalledOnce();
		dom.window.close();
	});

	it.each([undefined, "75", Number.NaN, Number.POSITIVE_INFINITY])(
		"keeps missing or invalid group score %s unscored",
		(score) => {
			const { dom, environment } = createEnvironment();
			const runtime = recordingRuntime();
			initializeCourseHost({ format: "scorm12", createRuntime: () => runtime }, environment);
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-group-complete", {
					detail: { groupId: "survey", passed: true, score },
				}),
			);
			expect(runtime.trackObjective).not.toHaveBeenCalled();
			expect(runtime.trackInteraction).toHaveBeenCalledWith("survey", "", undefined, undefined, {
				description: "Welcome",
			});
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-group-complete", {
					detail: { groupId: "knowledge-check", passed: true, correct: true },
				}),
			);
			expect(runtime.trackInteraction).toHaveBeenCalledWith(
				"knowledge-check",
				"",
				true,
				undefined,
				{ description: "Welcome" },
			);
			dom.window.close();
		},
	);

	it("waits for the bounded popup retry before using local state", () => {
		const { dom, environment } = createEnvironment();
		Object.defineProperty(environment.win, "opener", { value: {}, configurable: true });
		let tick: (() => void) | undefined;
		const clearInterval = vi.fn();
		Object.defineProperty(environment.win, "setInterval", {
			configurable: true,
			value: (handler: TimerHandler) => {
				if (typeof handler === "function") tick = () => handler();
				return 17;
			},
		});
		Object.defineProperty(environment.win, "clearInterval", {
			configurable: true,
			value: clearInterval,
		});
		const fallback = new LocalStorageRuntime(dom.window.localStorage, pageConfig.courseId);
		const discovered = recordingRuntime();
		let lmsAvailable = false;
		const createRuntime = () => (lmsAvailable ? discovered : fallback);

		initializeCourseHost(
			{
				format: "scorm12",
				createRuntime,
				isFallback: (runtime) => runtime instanceof LocalStorageRuntime,
			},
			environment,
		);
		expect(dom.window.localStorage.length).toBe(0);
		tick?.();
		expect(dom.window.localStorage.length).toBe(0);
		expect(discovered.trackPageVisit).not.toHaveBeenCalled();
		lmsAvailable = true;
		tick?.();
		expect(discovered.trackPageVisit).toHaveBeenCalledWith("page-stable");
		expect(discovered.setBookmark).toHaveBeenCalledWith("index.html?praxity-page=page-stable");
		expect(clearInterval).toHaveBeenCalledWith(17);
		expect(dom.window.localStorage.length).toBe(0);
		dom.window.close();
	});

	it.each(["page-summary", "index.html?praxity-page=page-summary"])(
		"composes resume navigation from bookmark %s without losing URL state",
		(bookmark) => {
			expect(
				composeScormResumeUrl(
					"https://course.example/welcome.html?source=test#content",
					"résumé page",
				),
			).toBe(
				"https://course.example/r%C3%A9sum%C3%A9%20page.html?source=test&praxity-resume=1#content",
			);

			const { dom, environment, replace } = createEnvironment();
			const runtime = recordingRuntime({ bookmark });
			initializeCourseHost(
				withScormResume({
					format: "scorm12",
					createRuntime: () => runtime,
					readEntry: () => "resume",
				}),
				environment,
			);
			expect(replace).toHaveBeenCalledWith(
				"https://course.example/summary.html?source=test&praxity-resume=1#content",
			);
			expect(runtime.trackPageVisit).not.toHaveBeenCalled();
			dom.window.close();
		},
	);
});

function recordingRuntime(options: { bookmark?: string } = {}) {
	const interactions: Array<{
		id: string;
		response: string;
		correct?: boolean;
		score?: number;
		timestamp: number;
	}> = [];
	return {
		destinations: LMS_DESTINATIONS,
		initialize: () => true,
		terminate: () => true,
		trackPageVisit: vi.fn(),
		getVisitedPages: () => [],
		trackInteraction: vi.fn((id, response, correct, score, options) => {
			interactions.push({ id, response, correct, score, ...options, timestamp: Date.now() });
		}),
		getInteractions: () => interactions,
		setCompletion: vi.fn(),
		getCompletion: () => "incomplete",
		setScore: vi.fn(),
		getScore: () => null,
		setBookmark: vi.fn(),
		getBookmark: () => options.bookmark ?? null,
		setSuspendData: vi.fn(),
		getSuspendData: () => null,
		commit: vi.fn(() => true),
		trackObjective: vi.fn(),
	};
}
