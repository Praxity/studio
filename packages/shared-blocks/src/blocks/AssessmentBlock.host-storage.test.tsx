import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../../../export-pipeline/src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../../../export-pipeline/src/scorm/api/scorm2004";
import { XapiRuntime } from "../../../export-pipeline/src/scorm/api/xapi";
import { LocalStorageRuntime } from "../../../export-pipeline/src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../../../export-pipeline/src/scorm/types";
import type { CourseHostConfig } from "../../../export-pipeline/template/src/hosts/course-host";
import type {} from "../../../export-pipeline/template/src/hosts/privacy-bootstrap";
import { createPrivateBlockStateRuntime } from "../../../export-pipeline/template/src/hosts/private-block-state";
import type {} from "../../../export-pipeline/template/src/islands/self-check-implementation";
import type {} from "../../../export-pipeline/template/src/self-check-document";
import { LocaleContext } from "../i18n/locale-context";
import type { AssessmentBlockData } from "../types";
import { PreviewAssessmentBlock } from "./AssessmentBlock";

const data: AssessmentBlockData = {
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

function runtimeFor(kind: string) {
	if (kind === "scorm2004") {
		const values: Record<string, string> = { "cmi.completion_status": "incomplete" };
		const api = {
			Initialize: () => "true",
			Terminate: () => "true",
			GetValue: (k: string) => values[k] ?? "",
			// LMS refuses suspend_data (e.g. over its own limit); every other element is accepted.
			SetValue: (k: string, v: string) => {
				if (k === "cmi.suspend_data") return "false";
				values[k] = v;
				return "true";
			},
			Commit: () => "true",
			GetLastError: () => "0",
			GetErrorString: () => "",
			GetDiagnostic: () => "",
		};
		const win = { API_1484_11: api } as unknown as Window;
		Object.assign(win, { parent: win });
		const rt = new Scorm2004Runtime(win);
		rt.initialize();
		return { rt, values };
	}
	// Standalone with full storage: every setItem throws QuotaExceededError.
	const store = new Map<string, string>();
	const storage = {
		getItem: (k: string) => store.get(k) ?? null,
		removeItem: (k: string) => void store.delete(k),
		setItem: () => {
			throw new DOMException("full", "QuotaExceededError");
		},
	} as unknown as Storage;
	const rt =
		kind === "xapi"
			? new XapiRuntime(
					{
						endpoint: "https://lrs.example/xapi/statements",
						auth: "Basic example",
						actorMode: "manual",
						actor: { name: "Learner", mbox: "mailto:learner@example.com" },
					},
					"course",
					storage,
				)
			: new LocalStorageRuntime(storage, "course", "default");
	rt.initialize();
	return { rt, values: {} as Record<string, string> };
}

it.each(
	["scorm2004", "xapi", "standalone"].flatMap((kind) =>
		[false, true].map((privateCourse) => ({ kind, privateCourse })),
	),
)(
	"$kind (private course: $privateCourse): still reports after a failed state write",
	({ kind, privateCourse }) => {
		const requests = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", requests);
		const { rt, values } = runtimeFor(kind);
		window.__praxityBlockState = privateCourse
			? createPrivateBlockStateRuntime(
					rt as SCORMRuntime,
					{
						version: 1,
						courseId: "course",
						pageId: "page-a",
						pageTitle: "Practice",
						currentPage: 1,
						totalPages: 1,
						currentSlug: "practice",
						availableSlugs: ["practice"],
						pageIdMap: { "page-a": "practice" },
						completionMethod: "allPages",
						pageRole: "content",
						strings: {},
						blockStatePolicy: { q: "lms" },
					} satisfies CourseHostConfig,
					window,
				)
			: createPrivateBlockStateRuntime(
					rt as SCORMRuntime,
					{ courseId: "course", strings: {} } as CourseHostConfig,
					window,
				);
		const reported: unknown[] = [];
		const report = (event: Event) => {
			const d = (event as CustomEvent).detail;
			reported.push(d.blockId);
			rt.trackInteraction(d.blockId, d.responseText, d.correct, d.score, d);
		};
		document.addEventListener("praxity:assessment-response", report);
		try {
			render(
				<MantineProvider>
					<LocaleContext.Provider value="en">
						<PreviewAssessmentBlock blockId="q" data={data} />
					</LocaleContext.Provider>
				</MantineProvider>,
			);
			fireEvent.click(screen.getByRole("radio", { name: /Stop/ }));
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));
			expect(reported).toEqual(["q"]);
			expect(screen.getByRole("radio", { name: /Stop/ })).toBeDisabled();
			expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
			expect(
				screen.queryByText(
					"This answer could not be saved. Your previously saved progress is kept.",
				),
			).toBeNull();
			if (kind === "scorm2004") expect(values["cmi.interactions.0.id"]).toBe("q");
			if (kind === "xapi")
				expect(
					requests.mock.calls.some(([, options]) =>
						JSON.parse(options.body).verb.id.endsWith("/answered"),
					),
				).toBe(true);
		} finally {
			cleanup();
			document.removeEventListener("praxity:assessment-response", report);
			delete window.__praxityBlockState;
			vi.unstubAllGlobals();
		}
	},
);

it.each(["en", "fr"])(
	"shows rejected saved data without granting current credit or overwriting it in %s",
	(locale) => {
		const original =
			'{"visitedPages":["page-a"],"interactions":[{"id":"q","response":"Stop","correct":true,"score":100,"timestamp":1800000000000}],"custom":{}}';
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
		runtime.trackPageVisit("page-a");
		window.__praxityBlockState = createPrivateBlockStateRuntime(
			runtime,
			{ courseId: "course", strings: {} } as CourseHostConfig,
			window,
		);
		try {
			render(
				<MantineProvider>
					<LocaleContext.Provider value={locale}>
						<PreviewAssessmentBlock blockId="q" data={data} />
					</LocaleContext.Provider>
				</MantineProvider>,
			);
			expect(screen.getByRole("status")).toHaveTextContent(
				locale === "en"
					? "This answer could not be saved. Your previously saved progress is kept."
					: "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée.",
			);
			expect(runtime.getInteractions()).toEqual([]);
			expect(runtime.getVisitedPages()).toEqual([]);
			expect(document.querySelector('[data-completed="true"]')).toBeNull();
			fireEvent.click(screen.getByRole("radio", { name: /Stop/ }));
			fireEvent.click(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			);
			expect(screen.getByRole("radio", { name: /Stop/ })).toBeEnabled();
			expect(document.querySelector('[data-completed="true"]')).toBeNull();
			expect(values["cmi.suspend_data"]).toBe(original);
			expect(values["cmi.interactions.0.id"]).toBeUndefined();
		} finally {
			cleanup();
			delete window.__praxityBlockState;
			delete (window as Window & { API?: unknown }).API;
		}
	},
);

it.each(
	["en", "fr"].flatMap((locale) =>
		[false, true].map((privateCourse) => ({ locale, privateCourse })),
	),
)(
	"keeps an unreadable-store open answer editable and restores its unsaved draft after reload in $locale, private course $privateCourse",
	({ locale, privateCourse }) => {
		const original =
			'{"visitedPages":["page-a"],"interactions":[{"id":"q","response":"Stop","correct":true,"score":100,"timestamp":1800000000000}],"custom":{}}';
		const values: Record<string, string> = {
			"cmi.suspend_data": original,
			"cmi.core.student_id": "learner",
		};
		window.sessionStorage.clear();
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
		const open: AssessmentBlockData = {
			assessmentType: "textResponse",
			gradingMode: "exact",
			attempts: 1,
			feedback: {},
			stem: [{ id: "stem", type: "text", data: { content: "Describe the hazard" } }],
			response: { type: "textResponse", inputType: "short" },
		};
		const mount = () =>
			render(
				<MantineProvider>
					<LocaleContext.Provider value={locale}>
						<PreviewAssessmentBlock blockId="open" data={open} />
					</LocaleContext.Provider>
				</MantineProvider>,
			);
		const runtime = new Scorm12Runtime("course");
		runtime.initialize();
		const provider = (rt: Scorm12Runtime) =>
			privateCourse
				? createPrivateBlockStateRuntime(
						rt,
						{
							version: 1,
							courseId: "course",
							pageId: "page-a",
							pageTitle: "Practice",
							currentPage: 1,
							totalPages: 1,
							currentSlug: "practice",
							availableSlugs: ["practice"],
							pageIdMap: { "page-a": "practice" },
							completionMethod: "allPages",
							pageRole: "content",
							strings: {},
							blockStatePolicy: { open: "lms" },
						},
						window,
					)
				: createPrivateBlockStateRuntime(
						rt,
						{ courseId: "course", strings: {} } as CourseHostConfig,
						window,
					);
		window.__praxityBlockState = provider(runtime);
		const reported = vi.fn();
		document.addEventListener("praxity:assessment-response", reported);
		try {
			let view = mount();
			expect(screen.getByRole("status")).toBeVisible();
			fireEvent.change(screen.getByRole("textbox"), { target: { value: "Wet floor by the door" } });
			fireEvent.click(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			);
			expect(screen.getByRole("textbox")).toBeEnabled();
			expect(screen.getByRole("textbox")).toHaveValue("Wet floor by the door");
			expect(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			).toBeEnabled();
			expect(screen.getByRole("status")).toBeVisible();
			expect(document.querySelector('[data-completed="true"]')).toBeNull();
			expect(reported).not.toHaveBeenCalled();
			expect(runtime.getInteractions()).toEqual([]);
			expect(values["cmi.suspend_data"]).toBe(original);
			view.unmount();
			const reload = new Scorm12Runtime("course");
			reload.initialize();
			window.__praxityBlockState = provider(reload);
			view = mount();
			expect(screen.getByRole("textbox")).toHaveValue("Wet floor by the door");
			expect(screen.getByRole("textbox")).toBeEnabled();
			expect(screen.getByRole("status")).toBeVisible();
			expect(document.querySelector('[data-completed="true"]')).toBeNull();
			expect(values["cmi.suspend_data"]).toBe(original);
			view.unmount();
		} finally {
			cleanup();
			document.removeEventListener("praxity:assessment-response", reported);
			delete window.__praxityBlockState;
			delete (window as Window & { API?: unknown }).API;
			window.sessionStorage.clear();
		}
	},
);
