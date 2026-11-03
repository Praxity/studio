import { MantineProvider } from "@mantine/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bufferPrivateBlockState } from "../../../export-pipeline/template/src/hosts/privacy-bootstrap";
import { installChoiceCourseHost } from "../../../export-pipeline/tests/fixtures/choice-course-host";
import { LocaleContext } from "../i18n/locale-context";
import type { AssessmentBlockData } from "../types";
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
		return commit();
	};
	const initialize = () => {
		calls.push("initialize");
		return "true";
	};
	const lastError = () => {
		calls.push("last-error");
		return error;
	};
	const diagnostic = () => {
		calls.push("diagnostic");
		return "";
	};
	Object.assign(
		window,
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

afterEach(() => {
	cleanup();
	delete (window as Window & { API?: unknown }).API;
	delete (window as Window & { API_1484_11?: unknown }).API_1484_11;
	vi.useRealTimers();
	delete window.__praxityPrivacyBootstrap;
});

const cases = (["scorm12", "scorm2004"] as const).flatMap((format) =>
	[choice, open].flatMap((data) =>
		(["en", "fr"] as const).flatMap((locale) =>
			(["false", "throws"] as const).map((failure) => ({
				format,
				data,
				locale,
				failure,
				buffered: false,
			})),
		),
	),
);
cases.push(
	...(["scorm12", "scorm2004"] as const).map((format) => ({
		format,
		data: choice,
		locale: "en" as const,
		failure: "false" as const,
		buffered: true,
	})),
);
it.each(cases)(
	"$format $locale $data.assessmentType first $failure ends submissions and API calls, buffered $buffered",
	({ format, data, locale, failure, buffered }) => {
		vi.useFakeTimers();
		localStorage.clear();
		if (buffered)
			window.__praxityPrivacyBootstrap = (...args) =>
				bufferPrivateBlockState(args, new Promise(() => {}));
		const lms = moodle(format);
		const { runtime, provider } = installChoiceCourseHost("q", choice, format, {
			...(data === open ? { choiceStateQuestions: {}, choiceStateSignatures: {} } : {}),
			totalPages: 1,
			passMark: 80,
			scoredAssessmentIds: ["q"],
			requiredAssessmentIds: ["q"],
			blockStatePolicy: { other: "device" },
		});
		provider.set("earlier", { answer: "Earlier saved answer" });
		expect(runtime.commit()).toBe(true);
		const before = { ...lms.server };
		const mount = (both = true) =>
			render(
				<MantineProvider>
					<LocaleContext.Provider value={locale}>
						<PreviewAssessmentBlock blockId="q" data={data} />
						{both && <PreviewAssessmentBlock blockId="other" data={{ ...open, private: true }} />}
					</LocaleContext.Provider>
				</MantineProvider>,
			);
		const view = mount();
		// The display notification cannot end a launch or write learner state itself.
		const beforeNotification = { ...lms.values };
		const transfers = () =>
			lms.calls.filter((call) => call === "commit" || call === "finish" || call.startsWith("set:"));
		const transfersBefore = transfers();
		fireEvent(window, new Event("praxity:scorm-session-ended"));
		expect(lms.values).toEqual(beforeNotification);
		expect(transfers()).toEqual(transfersBefore);
		expect(screen.queryByRole("status")).toBeNull();
		if (data === choice) fireEvent.click(screen.getByRole("radio", { name: /Stop/ }));
		else fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Wet floor" } });
		provider.set("uncommitted", { answer: "Keep this other draft" });
		lms.fail(failure);
		const submit = screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" });
		fireEvent.click(submit);
		const atRefusal = lms.calls.lastIndexOf("commit") + 1;
		expect(lms.values).toEqual(lms.submitted);
		expect(provider.getSaveResult?.("q")).toEqual({ status: "not-saved", code: "commit-refused" });
		expect(provider.getSaveResult?.("other")).toEqual({
			status: "not-saved",
			code: "commit-refused",
		});
		expect(screen.getAllByRole("status")).toHaveLength(2);
		for (const status of screen.getAllByRole("status"))
			expect(status).toHaveTextContent(notices[locale]);
		expect(submit).toBeDisabled();
		expect(document.querySelector('[data-completed="true"]')).toBeNull();
		if (data === choice) expect(screen.getByRole("radio", { name: /Stop/ })).toBeChecked();
		else expect(screen.getAllByRole("textbox")[0]).toHaveValue("Wet floor");
		// Re-auth or a recovered 5xx cannot reopen this page's communication.
		lms.fail("none");
		fireEvent.click(submit);
		if (data === choice) {
			fireEvent.click(screen.getByRole("radio", { name: /Go/ }));
			fireEvent.click(submit);
			expect(screen.getByRole("radio", { name: /Go/ })).toBeChecked();
		}
		fireEvent.change(screen.getAllByRole("textbox").at(-1) as HTMLElement, {
			target: { value: "Another answer" },
		});
		for (const button of screen.getAllByRole("button", {
			name: locale === "en" ? "Submit" : "Soumettre",
		}))
			expect(button).toBeDisabled();
		act(() => {
			window.dispatchEvent(new Event("beforeunload"));
			window.dispatchEvent(new Event("pagehide"));
			window.__praxityFinishCourse?.();
			runtime.terminate();
			runtime.commit();
			runtime.trackPageVisit("later-page");
			runtime.trackInteraction("later", "answer");
			provider.set("later", { answer: "Not sent" });
			vi.advanceTimersByTime(60_000);
		});
		expect(lms.calls.slice(atRefusal)).toEqual([]);
		expect(lms.values).toEqual(lms.submitted);
		expect(lms.server).toEqual(before);
		expect(provider.getSaveResult?.("q")?.status).toBe("not-saved");
		// Reopen a fresh API from server bytes, never from the refused in-page model.
		view.unmount();
		moodle(format, lms.server);
		const reopened = installChoiceCourseHost(
			"q",
			choice,
			format,
			data === open ? { choiceStateQuestions: {}, choiceStateSignatures: {} } : {},
		);
		const reopenedView = mount(false);
		expect(reopened.provider.get("earlier")).toEqual({ answer: "Earlier saved answer" });
		expect(reopened.provider.get("uncommitted")).toBeUndefined();
		expect(screen.queryByRole("status")).toBeNull();
		if (data === choice) expect(screen.getByRole("radio", { name: /Stop/ })).not.toBeChecked();
		else expect(screen.getByRole("textbox")).toHaveValue("");
		reopenedView.unmount();
		vi.clearAllTimers();
		vi.useRealTimers();
	},
);

it("does not roll later writes back after a failed SCORM 1.2 stage", () => {
	vi.useFakeTimers();
	const lms = moodle("scorm12");
	const { runtime, provider } = installChoiceCourseHost("q", choice, "scorm12");
	for (const failure of ["false", "throws", "abort"] as const) {
		if (failure === "throws")
			expect(() =>
				provider.stageSubmission?.("q", () => {
					throw new Error("stage refused");
				}),
			).toThrow("stage refused");
		else {
			provider.stageSubmission?.("q", () => failure === "abort");
			if (failure === "abort") runtime.abortSubmission?.("q");
		}
	}
	runtime.trackPageVisit("later-page");
	const before = lms.values["cmi.suspend_data"];
	lms.fail("false");
	expect(runtime.commit()).toBe(false);
	expect(lms.values["cmi.suspend_data"]).toBe(before);
});

it("keeps device receipts independent of unreadable LMS state before a commit refusal", () => {
	vi.useFakeTimers();
	const lms = moodle("scorm12", { "cmi.suspend_data": "unreadable saved data" });
	const { runtime, provider } = installChoiceCourseHost("q", choice, "scorm12", {
		blockStatePolicy: { q: "device" },
	});
	expect(runtime.getBlockSaveResult?.("q")).toBeUndefined();
	provider.set("q", { answer: "Device draft" });
	expect(provider.getSaveResult?.("q")).toEqual({ status: "saved", destination: "device" });
	expect(lms.values["cmi.suspend_data"]).toBe("unreadable saved data");
});

it.each(
	(["scorm12", "scorm2004"] as const).flatMap((format) =>
		(["false", "throws"] as const).map((failure) => ({ format, failure })),
	),
)("$format skips termination when the Finish action's commit $failure", ({ format, failure }) => {
	vi.useFakeTimers();
	const lms = moodle(format);
	const { runtime, provider } = installChoiceCourseHost("q", choice, format);
	render(
		<MantineProvider>
			<PreviewAssessmentBlock blockId="q" data={choice} />
		</MantineProvider>,
	);
	lms.fail(failure);
	act(() => {
		expect(window.__praxityFinishCourse?.()).toBe(false);
	});
	expect(lms.calls).not.toContain("finish");
	expect(screen.getByRole("status")).toHaveTextContent(notices.en);
	const calls = [...lms.calls];
	act(() => {
		window.__praxityFinishCourse?.();
		runtime.terminate();
		window.dispatchEvent(new Event("pagehide"));
		vi.advanceTimersByTime(60_000);
	});
	expect(provider.getSaveResult?.("never-submitted")).toEqual({
		status: "not-saved",
		code: "commit-refused",
	});
	expect(lms.calls).toEqual(calls);
});
