import { choiceDependencyStatus } from "@praxity/shared-blocks/choice-learner-state";
import { finishLearnerCourse } from "@praxity/shared-blocks/learner-block-state";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import {
	factsA,
	signatureA,
	signatureB,
	signedSubmitted,
} from "../../shared-blocks/src/fixtures/choice-evidence";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import type { SCORMRuntime } from "../src/scorm/types";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";

for (const evidence of ["saved history", "held draft"] as const)
	for (const endPath of ["installed callback", "runtime-only"] as const)
		it.each(
			evidence === "held draft" ? (["scorm12"] as const) : (["scorm12", "scorm2004"] as const),
		)(`${evidence}: ${endPath} %s refuses held proof or stale completion`, (format) => {
			const signature = signatureA;
			const oldSignature = signatureB;
			const page = {
				version: 1,
				courseId: "course",
				pageId: "summary",
				pageTitle: "Summary",
				currentPage: 2,
				totalPages: 2,
				currentSlug: "summary",
				availableSlugs: ["intro", "summary"],
				pageIdMap: { intro: "intro", summary: "summary" },
				completionMethod: "allPages",
				requiredAssessmentIds: ["question"],
				pageRole: "content",
				choiceStateSignatures: { question: signature },
				choiceStateQuestions: { question: factsA.question },
				strings: {},
			};
			const dom = new JSDOM(
				`<body><main><h1>Summary</h1></main><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script></body>`,
				{ url: "https://course.example/summary.html" },
			);
			Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
			const oldRow = {
				id: "question",
				response: "stop",
				correct: true,
				score: 100,
				timestamp: 1,
				contentSignature: oldSignature,
			};
			const blockState = { question: { ...signedSubmitted, contentSignature: oldSignature } };
			const payload = {
				visitedPages: ["intro"],
				interactions: [oldRow],
				...(format === "scorm12" ? { custom: JSON.stringify({ blockState }) } : { blockState }),
			};
			const status = format === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status";
			const values: Record<string, string> = {
				[status]: "incomplete",
				"cmi.success_status": "unknown",
				"cmi.suspend_data": JSON.stringify(
					evidence === "held draft" ? { ...payload, custom: {} } : payload,
				),
			};
			const writes: string[] = [];
			const get = (key: string) => values[key] ?? "";
			const set = (key: string, value: string) => {
				values[key] = value;
				if (key === status) writes.push(value);
				return "true";
			};
			const api =
				format === "scorm12"
					? {
							LMSInitialize: () => "true",
							LMSFinish: () => "true",
							LMSGetValue: get,
							LMSSetValue: set,
							LMSCommit: () => "true",
							LMSGetLastError: () => "0",
							LMSGetErrorString: () => "",
							LMSGetDiagnostic: () => "",
						}
					: {
							Initialize: () => "true",
							Terminate: () => "true",
							GetValue: get,
							SetValue: set,
							Commit: () => "true",
							GetLastError: () => "0",
							GetErrorString: () => "",
							GetDiagnostic: () => "",
						};
			Object.assign(dom.window, { [format === "scorm12" ? "API" : "API_1484_11"]: api });
			vi.stubGlobal("window", dom.window);
			vi.stubGlobal("document", dom.window.document);
			try {
				const runtime: SCORMRuntime =
					format === "scorm12"
						? new Scorm12Runtime()
						: new Scorm2004Runtime(dom.window as unknown as Window);
				expect(
					initializeScormCourseHost(
						{ format, readEntry: () => null, createRuntime: () => runtime },
						{
							win: dom.window as unknown as Window,
							doc: dom.window.document,
							location: { href: dom.window.location.href, search: "", replace() {} },
							history: dom.window.history,
						},
					),
				).toBe(true);
				if (evidence === "held draft") {
					const provider = (dom.window as unknown as Window).__praxityBlockState;
					const draft = {
						...signedSubmitted,
						materialProof: { optionIds: ["a", "b"] },
						checked: false,
						attemptCount: 0,
					};
					provider?.set("question", draft);
					expect(provider?.get("question")).toEqual(draft);
					expect(provider?.getSaveResult?.("question")).toEqual({
						status: "not-saved",
						code: "unreadable-state",
					});
					expect(provider?.getSavedBuildRevision?.("question")).toBeNull();
					const view = provider?.getChoiceDependencyView?.();
					expect(view).toBeDefined();
					expect(view?.readState("question")).toBeUndefined();
					expect(view?.buildProof).toBeUndefined();
					expect(view && choiceDependencyStatus("question", view)).not.toBe("current");
					expect(values["cmi.suspend_data"]).toBe(JSON.stringify({ ...payload, custom: {} }));
					return;
				}
				expect((dom.window as unknown as Window).__praxityTracker?.getCurrentScore?.()).toBeNull();
				const terminate = vi.spyOn(runtime, "terminate");
				if (endPath === "runtime-only") {
					delete (dom.window as unknown as Window).__praxityFinishCourse;
					delete (dom.window as unknown as Window).__praxityTracker;
				}
				expect(finishLearnerCourse(() => true, dom.window.document)).toBe(true);
				expect(terminate).toHaveBeenCalledExactlyOnceWith(false);
				expect(values[status]).toBe("incomplete");
				expect(writes).not.toContain("completed");
				expect(JSON.parse(values["cmi.suspend_data"]).interactions).toEqual([oldRow]);
			} finally {
				dom.window.close();
				vi.unstubAllGlobals();
			}
		});
