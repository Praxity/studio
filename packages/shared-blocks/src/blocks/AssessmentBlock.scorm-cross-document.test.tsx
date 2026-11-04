import { MantineProvider } from "@mantine/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import type { SCORMRuntime } from "../../../export-pipeline/src/scorm/types";
import { initializeCourseShell } from "../../../export-pipeline/template/src/course-shell";
import { initializeScorm12Host } from "../../../export-pipeline/template/src/hosts/scorm12";
import { initializeScorm2004Host } from "../../../export-pipeline/template/src/hosts/scorm2004";
import { initPublishedAssessmentGroups } from "../../../export-pipeline/template/src/islands/island-assessment-group";
import { choiceContentSignature, choiceStateQuestion } from "../assessment-choice";
import { LocaleContext } from "../i18n/locale-context";
import { getStrings } from "../i18n/strings";
import type { AssessmentBlockData, PraxityBlock } from "../types";
import { initAssessmentGroups } from "../viewer/assessment-group-runtime";
import { navigatePageAction } from "../viewer/navigate-page";
import { PreviewAssessmentBlock } from "./AssessmentBlock";

const choice: AssessmentBlockData = {
	assessmentType: "choice",
	gradingMode: "exact",
	points: 100,
	attempts: 1,
	feedback: {},
	stem: [{ id: "stem", type: "text", data: { content: "Choose safely" } }],
	response: {
		type: "choice",
		selectionMode: "single",
		inputMethod: "click",
		display: "list",
		shuffle: false,
		options: [
			{ id: "stop", label: "Stop", isCorrect: true },
			{ id: "go", label: "Go" },
		],
	},
};
const open: AssessmentBlockData = {
	assessmentType: "textResponse",
	gradingMode: "exact",
	attempts: 1,
	feedback: {},
	stem: [{ id: "open-stem", type: "text", data: { content: "Describe the hazard" } }],
	response: { type: "textResponse", inputType: "short" },
};
const notices = {
	en: "This answer could not be saved. Your previously saved progress is kept. To continue, close this course and open it again.",
	fr: "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée. Pour continuer, fermez ce cours et ouvrez-le de nouveau.",
};

// Moodle 1.2 CollectData advances defaults before transport; 2004 keeps them.
// Both versions cancel autocommit on Commit and arm it on successful SetValue.
function moodle(format: "scorm12" | "scorm2004", stored: Record<string, string> = {}) {
	const values = { ...stored },
		server = { ...stored },
		defaults = { ...stored };
	const calls: string[] = [];
	let submitted: Record<string, string> = {};
	let failure: "none" | "false" | "throws" = "none";
	let error = "0";
	let active = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const commit = () => {
		calls.push("commit");
		submitted = { ...values };
		clearTimeout(timer);
		const sent: Record<string, string> = {};
		for (const [key, value] of Object.entries(values)) {
			if (defaults[key] !== value) {
				sent[key] = value;
				if (format === "scorm12") defaults[key] = value;
			}
		}
		error = failure === "none" ? "0" : "101";
		if (failure === "throws") throw new Error("503 Service Unavailable");
		if (failure === "false") return "false";
		Object.assign(server, sent);
		return "true";
	};
	const get = (key: string) => {
		calls.push(`get:${key}`);
		error = "0";
		if (key === "cmi.interactions._count")
			return String(Object.keys(values).filter((k) => /^cmi.interactions.\d+.id$/.test(k)).length);
		return values[key] ?? "";
	};
	const set = (key: string, value: string) => {
		calls.push(`set:${key}`);
		error = "0";
		values[key] = value;
		clearTimeout(timer);
		timer = setTimeout(commit, 60_000);
		return "true";
	};
	const finish = () => {
		calls.push("finish");
		const result = commit();
		if (result === "true") active = false;
		return result;
	};
	const initialize = () => {
		calls.push("initialize");
		// Moodle rebuilds CMI before rejecting a second Initialize.
		for (const key of Object.keys(values)) delete values[key];
		Object.assign(values, defaults);
		error = active ? (format === "scorm12" ? "101" : "103") : "0";
		active = true;
		return String(error === "0");
	};
	const lastError = () => {
		calls.push("last-error");
		return error;
	};
	const diagnostic = () => {
		calls.push("diagnostic");
		return "";
	};
	const player = Object.assign(
		{},
		format === "scorm12"
			? {
					API: {
						LMSInitialize: initialize,
						LMSFinish: finish,
						LMSCommit: commit,
						LMSGetValue: get,
						LMSSetValue: set,
						LMSGetLastError: lastError,
						LMSGetErrorString: diagnostic,
						LMSGetDiagnostic: diagnostic,
					},
				}
			: {
					API_1484_11: {
						Initialize: initialize,
						Terminate: finish,
						Commit: commit,
						GetValue: get,
						SetValue: set,
						GetLastError: lastError,
						GetErrorString: diagnostic,
						GetDiagnostic: diagnostic,
					},
				},
	);
	return {
		player,
		values,
		server,
		calls,
		get submitted() {
			return submitted;
		},
		fail: (mode: typeof failure) => {
			failure = mode;
		},
	};
}

const documents: JSDOM[] = [];
const disposals: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
	cleanup();
	vi.clearAllTimers();
	vi.useRealTimers();
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
});

function page(
	player: object,
	format: "scorm12" | "scorm2004",
	index = false,
	facts: object = {},
	name = "practice",
) {
	cleanup();
	const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
		url: `https://course.example/${index ? "index" : name}.html`,
		pretendToBeVisual: true,
	});
	documents.push(dom);
	const win = dom.window;
	Object.defineProperty(win, "parent", { value: "opener" in player ? win : player });
	if ("opener" in player) Object.defineProperty(win, "opener", { value: player.opener });
	Object.defineProperty(win.document, "readyState", { value: "complete" });
	win.matchMedia = window.matchMedia;
	win.scrollTo = vi.fn();
	for (const name of [
		"window",
		"document",
		"HTMLElement",
		"HTMLInputElement",
		"HTMLButtonElement",
		"CustomEvent",
		"Event",
		"MutationObserver",
	] as const)
		vi.stubGlobal(name, win[name]);
	vi.stubGlobal("location", { href: win.location.href, search: "", hash: "", replace: vi.fn() });
	const script = (id: string, config: object) => {
		const node = win.document.createElement("script");
		node.id = id;
		node.type = "application/json";
		node.textContent = JSON.stringify(config);
		win.document.head.append(node);
	};
	if (index) {
		script("praxity-shell-config", {
			version: 1,
			kind: "redirect",
			target: "practice.html",
			pageIdMap: { page: "practice" },
		});
		initializeCourseShell();
		return;
	}
	script("praxity-host-config", {
		version: 1,
		courseId: "cross-document",
		pageId: name === "practice" ? "page" : name,
		pageTitle: "Practice",
		currentPage: name === "practice" ? 1 : 2,
		totalPages: 2,
		currentSlug: name,
		availableSlugs: ["practice", "next"],
		pageIdMap: { page: "practice", next: "next" },
		completionMethod: "allPages",
		pageRole: "content",
		strings: {},
		...facts,
	});
	script("praxity-deployment-config", { format });
	const ready = vi.fn();
	win.addEventListener("praxity:runtime-ready", ready);
	expect((format === "scorm12" ? initializeScorm12Host : initializeScorm2004Host)()).toBe(true);
	expect(ready).toHaveBeenCalledOnce();
}
function mount(locale: "en" | "fr" = "en") {
	return render(
		<MantineProvider>
			<LocaleContext.Provider value={locale}>
				<PreviewAssessmentBlock blockId="q" data={choice} />
				<PreviewAssessmentBlock blockId="text" data={{ ...open, required: false }} />
			</LocaleContext.Provider>
		</MantineProvider>,
	);
}
function expectRefused(locale: "en" | "fr" = "en") {
	const view = mount(locale);
	fireEvent.click(view.getByRole("radio", { name: /Stop/ }));
	fireEvent.change(view.getByRole("textbox"), { target: { value: "Retained draft" } });
	for (const status of view.getAllByRole("status"))
		expect(status).toHaveTextContent(notices[locale]);
	expect(view.getAllByRole("status")).toHaveLength(2);
	for (const button of view.getAllByRole("button", {
		name: locale === "en" ? "Submit" : "Soumettre",
	}))
		expect(button).toBeDisabled();
	return view;
}
function runtime() {
	return window.__praxityRuntime as SCORMRuntime;
}
function refused(format: "scorm12" | "scorm2004", frozen = false, pagehide = false) {
	vi.useFakeTimers();
	const lms = moodle(format);
	if (frozen) Object.freeze(Object.values(lms.player)[0]);
	page(lms.player, format);
	window.__praxityBlockState?.set("earlier", { answer: "Saved before refusal" });
	expect(runtime().commit()).toBe(true);
	lms.fail("false");
	if (pagehide) window.dispatchEvent(new Event("pagehide"));
	else expect(runtime().commit()).toBe(false);
	expect(window.__praxityBlockState?.getSaveResult?.("q")).toEqual({
		status: "not-saved",
		code: "commit-refused",
	});
	lms.fail("none");
	return { ...lms, atRefusal: [...lms.calls] };
}
for (const format of ["scorm12", "scorm2004"] as const) {
	it(`${format} 1 index retains refusal and the next document makes zero calls`, () => {
		const lms = refused(format);
		page(lms.player, format, true);
		page(lms.player, format);
		expectRefused();
		expect(lms.calls).toEqual(lms.atRefusal);
	});
	it(`${format} 2 glossary opener WeakMap retains refusal through index`, () => {
		const lms = refused(format, true);
		const glossary = { opener: lms.player };
		page(glossary, format, true);
		page(glossary, format);
		expectRefused();
		expect(lms.calls).toEqual(lms.atRefusal);
	});
	for (const locale of ["en", "fr"] as const)
		it(`${format} 3 ${locale} pagehide refusal publishes a ready next document`, () => {
			const lms = refused(format, false, true);
			page(lms.player, format, false, {}, "next");
			expectRefused(locale);
			expect(lms.calls).toEqual(lms.atRefusal);
		});
	it(`${format} 4 fresh navigation never reads entry after refusal`, () => {
		const lms = refused(format);
		page(lms.player, format);
		expect(lms.calls).toEqual(lms.atRefusal);
	});
	it(`${format} 5 new-document exits and optional edits cannot submit`, () => {
		const lms = refused(format, false, true);
		page(lms.player, format, false, {}, "next");
		const view = expectRefused();
		fireEvent.change(view.getByRole("textbox"), { target: { value: "Unsaved optional answer" } });
		for (const button of view.getAllByRole("button", { name: "Submit" })) fireEvent.click(button);
		act(() => {
			window.dispatchEvent(new Event("pagehide"));
			window.dispatchEvent(new Event("beforeunload"));
			navigatePageAction("__end_lesson__", {
				currentPage: 1,
				currentSlug: "practice",
				pages: [{ slug: "practice" }],
				pageIdMap: { page: "practice" },
			});
			window.__praxityFinishCourse?.();
		});
		expect(document.querySelector('[data-completed="true"]')).toBeNull();
		expect(lms.calls).toEqual(lms.atRefusal);
	});
	it(`${format} 6 no later SetValue arms Moodle autocommit`, () => {
		const lms = refused(format, false, true);
		page(lms.player, format, false, {}, "next");
		expectRefused();
		act(() => vi.advanceTimersByTime(60_000));
		expect(lms.calls).toEqual(lms.atRefusal);
	});
	it(`${format} 7 a genuinely new API restores only saved progress`, () => {
		const old = refused(format);
		const fresh = moodle(format, old.server);
		page(fresh.player, format, true);
		page(fresh.player, format);
		expect(fresh.calls.filter((call) => call === "initialize")).toHaveLength(1);
		expect(window.__praxityBlockState?.get("earlier")).toEqual({ answer: "Saved before refusal" });
		expect(mount().queryByRole("status")).toBeNull();
	});
	it(`${format} 8 successful Finish still permits index and initialization`, () => {
		vi.useFakeTimers();
		const lms = moodle(format);
		page(lms.player, format);
		expect(runtime().terminate(true)).toBe(true);
		page(lms.player, format, true);
		page(lms.player, format);
		expect(lms.calls.filter((call) => call === "initialize")).toHaveLength(2);
		expect(mount().queryByRole("status")).toBeNull();
	});
	for (const mode of ["all", "oneOf"] as const)
		for (const locale of ["en", "fr"] as const)
			it(`${format} ${mode} ${locale} group mounted in a refused new document disables Submit`, () => {
				const lms = refused(format);
				page(lms.player, format);
				const view = expectRefused(locale);
				const blocks: PraxityBlock[] = [
					{ id: "group", type: "assessmentGroup", data: { mode, memberBlockIds: ["q", "text"] } },
					{ id: "q", type: "assessment", data: choice as unknown as Record<string, unknown> },
					{ id: "text", type: "assessment", data: open as unknown as Record<string, unknown> },
				];
				document.documentElement.lang = locale;
				view.container.id = "main-content";
				const config = document.createElement("script");
				config.id = "praxity-config";
				config.type = "application/json";
				config.textContent = JSON.stringify({ blocks });
				document.head.append(config);
				window.__PRAXITY_STRINGS__ = { ...getStrings(locale) };
				Reflect.deleteProperty(window.__PRAXITY_STRINGS__, "assessmentSessionEndedNotice");
				disposals.push(initPublishedAssessmentGroups());
				act(() => vi.advanceTimersByTime(20));
				expect(view.container.querySelector(".praxity-ag-submit-btn")).toBeDisabled();
				expect(view.container.querySelector("[data-assessment-group-status]")).toHaveTextContent(
					notices[locale],
				);
				expect(lms.calls).toEqual(lms.atRefusal);
			});
	for (const dependency of [false, true])
		for (const scenario of ["event", "delayed", "summary"])
			for (const locale of ["en", "fr"] as const)
				it(`${format} ${dependency ? 10 : 9} ${locale} group refuses without Responses saved (${scenario})`, () => {
					vi.useFakeTimers();
					const lms = moodle(format);
					page(
						lms.player,
						format,
						false,
						dependency
							? {
									choiceStateQuestions: {
										a: choiceStateQuestion(choice, false),
										b: choiceStateQuestion(choice, false),
									},
									choiceStateSignatures: {
										a: choiceContentSignature(choice, false),
										b: choiceContentSignature(choice, false),
									},
									choiceStateGroups: {
										group: { mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
									},
								}
							: {},
					);
					if (dependency)
						expect(
							window.__praxityBlockState?.getChoiceDependencyView?.()?.groups?.group,
						).toBeDefined();
					const view = render(
						<MantineProvider>
							<LocaleContext.Provider value={locale}>
								<PreviewAssessmentBlock
									blockId="a"
									data={dependency ? choice : { ...open, gradingMode: "none" }}
								/>
								<PreviewAssessmentBlock
									blockId="b"
									data={dependency ? choice : { ...open, gradingMode: "none" }}
								/>
							</LocaleContext.Provider>
						</MantineProvider>,
					);
					if (dependency) fireEvent.click(view.getAllByRole("radio", { name: /Stop/ })[0]);
					else
						fireEvent.change(view.getAllByRole("textbox")[0], {
							target: { value: "Saved member A" },
						});
					fireEvent.click(
						view.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
					);
					expect(view.container.querySelector('[data-block-id="a"]')).toHaveAttribute(
						"data-completed",
						"true",
					);
					expect(runtime().commit()).toBe(true);
					const blocks: PraxityBlock[] = [
						{
							id: "group",
							type: "assessmentGroup",
							data: {
								mode: dependency ? "oneOf" : "all",
								memberBlockIds: ["a", "b"],
								requireAll: false,
								showResultsSummary: true,
							},
						},
						...["a", "b"].map((id) => ({
							id,
							type: "assessment" as const,
							data: dependency
								? (choice as unknown as Record<string, unknown>)
								: { ...open, gradingMode: "none" },
						})),
					];
					disposals.push(
						initAssessmentGroups({ blocks, root: view.container, labels: getStrings(locale) }),
					);
					act(() => vi.advanceTimersByTime(20));
					const submit = view.container.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn");
					expect(submit).not.toBeNull();
					expect(submit).toBeEnabled();
					const status = view.container.querySelector("[data-assessment-group-status]");
					let atRefusal: string[];
					if (scenario === "event") {
						lms.fail("false");
						act(() => {
							expect(runtime().commit()).toBe(false);
						});
						atRefusal = [...lms.calls];
						lms.fail("none");
						expect(submit).toBeDisabled();
						expect(status).toHaveTextContent(notices[locale]);
						if (!dependency)
							fireEvent.change(view.container.querySelectorAll("input[type=text]")[1], {
								target: { value: "Unsaved answer" },
							});
						submit?.click();
					} else {
						if (scenario === "delayed" && !dependency)
							fireEvent.change(view.container.querySelectorAll("input[type=text]")[1], {
								target: { value: "Submitted member B" },
							});
						// Summary leaves B unanswered; the group's own delayed Commit is first to fail.
						act(() => submit?.click());
						expect(status).not.toHaveTextContent(notices[locale]);
						lms.fail("false");
						if (scenario === "delayed") {
							act(() => {
								expect(runtime().commit()).toBe(false);
							});
						} else {
							const commits = lms.calls.filter((call) => call === "commit").length;
							act(() => vi.advanceTimersByTime(100));
							expect(lms.calls.filter((call) => call === "commit")).toHaveLength(commits + 1);
						}
						atRefusal = [...lms.calls];
						lms.fail("none");
					}
					act(() => vi.advanceTimersByTime(100));
					expect(submit).toBeDisabled();
					expect(view.container.querySelector("[data-assessment-group-status]")).toHaveTextContent(
						notices[locale],
					);
					expect(
						view.container.querySelector("[data-assessment-group-results]"),
					).not.toHaveTextContent(getStrings(locale).assessmentGroupSaved);
					expect(
						view.container.querySelector("[data-assessment-group-results]"),
					).toBeEmptyDOMElement();
					if (dependency && scenario === "delayed") {
						const choices = view.container.querySelectorAll(".praxity-ag-radio");
						expect(choices).toHaveLength(2);
						for (const option of choices) expect(option).toBeDisabled();
					}
					expect(window.__praxityBlockState?.getSaveResult?.("group")).toEqual({
						status: "not-saved",
						code: "commit-refused",
					});
					act(() => {
						submit?.click();
						vi.advanceTimersByTime(60_000);
					});
					expect(lms.calls).toEqual(atRefusal);
				});
}
