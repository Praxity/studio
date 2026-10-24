// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { CourseHostConfig } from "../../template/src/hosts/course-host";
import { createPrivateBlockStateRuntime } from "../../template/src/hosts/private-block-state";
import { disposeSelfCheckDocument, selfCheckRuntime } from "../../template/src/self-check-runtime";
import { Scorm12Runtime } from "../scorm/api/scorm12";

afterEach(() => {
	disposeSelfCheckDocument(document);
	delete window.__praxityBlockState;
	delete (window as Window & { API?: unknown }).API;
	delete window.__praxitySelfCheckSession;
	Reflect.deleteProperty(window, "__praxitySelfCheckCore");
	document.body.replaceChildren();
	document.documentElement.removeAttribute("data-self-check-dependencies");
	sessionStorage.clear();
	vi.unstubAllGlobals();
});
it.each(["en", "fr"])(
	"shows the self-check unavailable notice over unreadable SCORM data in %s",
	async (locale) => {
		vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "held-state-test");
		const original = '{"visitedPages":[],"interactions":[],"custom":{}}';
		const values: Record<string, string> = { "cmi.suspend_data": original };
		Object.assign(window, {
			API: {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
				LMSGetValue: (key: string) => values[key] ?? "",
				LMSSetValue: (key: string, value: string) => {
					values[key] = value;
					return "true";
				},
			},
		});
		const runtime = new Scorm12Runtime();
		runtime.initialize();
		window.__praxityBlockState = createPrivateBlockStateRuntime(
			runtime,
			{ courseId: "course", strings: {} } as CourseHostConfig,
			{} as Window,
		);
		document.documentElement.lang = locale;
		document.documentElement.dataset.selfCheckDependencies = "check";
		document.body.innerHTML =
			'<div data-self-check data-self-check-id="check" data-self-check-revision="revision" data-self-check-src="check.json"><textarea></textarea></div><nav id="praxity-page-nav"><a data-page-number="2" href="next.html">Next</a></nav><script id="praxity-config" type="application/json">{"currentPage":1}</script>';
		const active = selfCheckRuntime(document);
		await vi.waitFor(() =>
			expect(active.session.read("check")).toMatchObject({
				outcome: "unavailable",
				completed: false,
				available: false,
				code: "comparison-unavailable",
			}),
		);
		const notice = document.querySelector("[data-completion-reason]");
		expect(notice?.textContent).toContain(
			locale === "en"
				? "Comparison is unavailable. You can still write and copy your answer."
				: "La comparaison n'est pas disponible.",
		);
		expect(document.querySelector('[data-completed="true"]')).toBeNull();
		expect(values["cmi.suspend_data"]).toBe(original);
	},
);

it.each(["en", "fr"])(
	"restores an unsubmitted held self-check draft after same-tab reload in %s",
	async (locale) => {
		vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "held-draft-test");
		const implementation = vi.fn(async () => {
			throw new Error("Unexpected comparison admission");
		});
		Object.assign(window, { __praxitySelfCheckCore: { implementation } });
		const original = '{"visitedPages":[],"interactions":[],"custom":{}}';
		const values: Record<string, string> = {
			"cmi.suspend_data": original,
			"cmi.core.student_id": "learner",
		};
		const launch = (courseId = "course") => {
			disposeSelfCheckDocument(document);
			delete window.__praxityBlockState;
			Object.assign(window, {
				API: {
					LMSInitialize: () => "true",
					LMSFinish: () => "true",
					LMSCommit: () => "true",
					LMSGetLastError: () => "0",
					LMSGetValue: (key: string) => values[key] ?? "",
					LMSSetValue: (key: string, value: string) => {
						values[key] = value;
						return "true";
					},
				},
			});
			const runtime = new Scorm12Runtime(courseId);
			runtime.initialize();
			window.__praxityBlockState = createPrivateBlockStateRuntime(
				runtime,
				{ courseId: "course", strings: {} } as CourseHostConfig,
				{} as Window,
			);
			document.documentElement.lang = locale;
			document.documentElement.dataset.selfCheckDependencies = "check";
			document.body.innerHTML =
				'<div data-self-check data-self-check-id="check" data-self-check-revision="revision" data-self-check-src="check.json"><textarea></textarea></div><nav id="praxity-page-nav"><a data-page-number="2" href="next.html">Next</a></nav><script id="praxity-config" type="application/json">{"currentPage":1}</script>';
			const active = selfCheckRuntime(document);
			// Storage refusal must survive the implementation becoming ready.
			active.session.startup("ready");
			return active;
		};
		const unavailable = async (active: ReturnType<typeof selfCheckRuntime>) => {
			await vi.waitFor(() =>
				expect(active.session.read("check")).toMatchObject({
					outcome: "unavailable",
					completed: false,
					available: false,
					code: "comparison-unavailable",
				}),
			);
			expect(document.querySelector("[data-completion-reason]")?.textContent).toContain(
				locale === "en"
					? "Comparison is unavailable. You can still write and copy your answer."
					: "La comparaison n'est pas disponible.",
			);
			await expect(
				active.session.dispatch({ type: "show-feedback", blockId: "check" }),
			).rejects.toThrow("ESELFCHECKNOTREADY");
			expect(implementation).not.toHaveBeenCalled();
		};
		const first = launch();
		await unavailable(first);
		await first.session.dispatch({ type: "edit", blockId: "check", answer: "My long reflection" });
		expect(first.session.draftAnswer("check")).toBe("My long reflection");
		const reload = launch();
		await unavailable(reload);
		expect(reload.session.draftAnswer("check")).toBe("My long reflection");
		expect(document.querySelector("textarea")?.value).toBe("My long reflection");
		expect(document.querySelector("textarea")?.disabled).toBe(false);
		expect(document.querySelector("textarea")?.readOnly).toBe(false);
		expect(window.__praxityBlockState?.get("check")).toMatchObject({
			draft: { answer: "My long reflection", shown: false },
			submitted: null,
		});
		expect(document.querySelector('[data-completed="true"]')).toBeNull();
		expect(values["cmi.suspend_data"]).toBe(original);
		expect(values["cmi.interactions.0.id"]).toBeUndefined();
		expect(launch("other-course").session.draftAnswer("check")).not.toBe("My long reflection");
		values["cmi.core.student_id"] = "other-learner";
		expect(launch().session.draftAnswer("check")).not.toBe("My long reflection");
		values["cmi.core.student_id"] = "learner";
		values["cmi.suspend_data"] = `${original} `;
		expect(launch().session.draftAnswer("check")).not.toBe("My long reflection");
		values["cmi.suspend_data"] = "";
		expect(launch().session.draftAnswer("check")).not.toBe("My long reflection");
		values["cmi.suspend_data"] = original;
		expect(launch().session.draftAnswer("check")).toBe("My long reflection");
	},
);
