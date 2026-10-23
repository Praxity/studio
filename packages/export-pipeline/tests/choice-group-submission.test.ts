// @vitest-environment jsdom

import {
	choiceDependencyStatus,
	createChoiceDependencyView,
} from "@praxity/shared-blocks/choice-learner-state";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { groupSubmission, signatureB } from "../../shared-blocks/src/fixtures/choice-evidence";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { initializeCourseHost } from "../template/src/hosts/course-host";

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

for (const format of ["scorm12", "scorm2004"] as const) {
	for (const save of ["refused", "accepted", "forged"] as const) {
		it(`${format} ${save} aggregate keeps main's objectives and requires saved evidence after reload`, () => {
			const dom = new JSDOM("", { url: "https://course.example/practice.html" });
			documents.push(dom);
			vi.stubGlobal("window", dom.window);
			vi.stubGlobal("document", dom.window.document);
			vi.stubGlobal("localStorage", dom.window.localStorage);
			const values = new Map<string, string>();
			const writes: string[][] = [];
			let refuse = false;
			const set = (key: string, value: string) => {
				writes.push([key, value]);
				if (refuse && key === "cmi.suspend_data") return "false";
				values.set(key, value);
				return "true";
			};
			const common = {
				GetValue: (key: string) => values.get(key) ?? "",
				SetValue: set,
				GetLastError: () => "0",
				GetErrorString: () => "",
				GetDiagnostic: () => "",
			};
			const api =
				format === "scorm12"
					? {
							LMSInitialize: () => "true",
							LMSFinish: () => "true",
							LMSCommit: () => "true",
							LMSGetValue: common.GetValue,
							LMSSetValue: set,
							LMSGetLastError: common.GetLastError,
							LMSGetErrorString: common.GetErrorString,
							LMSGetDiagnostic: common.GetDiagnostic,
						}
					: { ...common, Initialize: () => "true", Terminate: () => "true", Commit: () => "true" };
			Object.defineProperty(window, format === "scorm12" ? "API" : "API_1484_11", {
				configurable: true,
				value: api,
			});
			const facts = admitChoiceStateFacts({
				choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
			});
			document.body.innerHTML = `<main></main><script id="praxity-host-config" type="application/json">${JSON.stringify(
				{
					version: 1,
					courseId: "course",
					pageId: "page",
					pageTitle: "Practice",
					currentPage: 1,
					totalPages: 1,
					currentSlug: "practice",
					availableSlugs: ["practice"],
					pageIdMap: { page: "practice" },
					completionMethod: "allPages",
					pageRole: "content",
					strings: {},
					passMark: 80,
					scoredAssessmentIds: ["g"],
					requiredAssessmentIds: ["g"],
					choiceStateGroups: facts.choiceStateGroups,
				},
			)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
			Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
			const makeRuntime = (): SCORMRuntime =>
				format === "scorm12" ? new Scorm12Runtime("course") : new Scorm2004Runtime(window);
			const runtime = makeRuntime();
			runtime.initialize();
			const seed = createBlockStateRuntime(runtime);
			seed.set("g", {
				version: 1,
				kind: "assessmentGroup",
				mode: "all",
				selectedMemberId: null,
				completed: true,
				submitted: {
					payload: { mode: "all", selectedMemberId: null, dependencies: [["a", signatureB]] },
					contentSignature: groupSubmission("all", "changed").contentSignature,
				},
			});
			runtime.trackInteraction("g", "100%", true, 100, {
				contentSignature: groupSubmission("all", "changed").contentSignature,
				memberIds: ["a"],
			});
			expect(initializeCourseHost({ format, createRuntime: () => runtime })).toBe(true);
			const provider = window.__praxityBlockState;
			if (!provider) throw Error("Expected admitted block-state provider");
			const submitted = {
				payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
				contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
			};
			const state = {
				version: 1,
				kind: "assessmentGroup",
				mode: "all",
				selectedMemberId: null,
				completed: true,
				submitted,
			};
			if (provider.stageSubmission && save !== "forged")
				expect(
					provider.stageSubmission("g", () => {
						provider.set("g", state);
						return true;
					}),
				).toBe(true);
			refuse = save === "refused";
			writes.length = 0;
			document.dispatchEvent(
				new CustomEvent("praxity:assessment-group-complete", {
					detail: {
						groupId: "g",
						score: 100,
						passed: true,
						correct: true,
						completed: true,
						memberIds: ["a"],
						selectedMemberId: null,
						contentSignature: save === "forged" ? signatureB : submitted.contentSignature,
					},
				}),
			);
			if (save === "forged") {
				expect(writes).toEqual([]);
				return;
			}
			if (!provider.stageSubmission) provider.set("g", state);
			const status = format === "scorm12" ? "status" : "success_status";
			expect(writes.filter(([key]) => key.startsWith("cmi.objectives."))).toEqual([
				["cmi.objectives.0.id", "g"],
				["cmi.objectives.0.score.raw", "100"],
				[`cmi.objectives.0.${status}`, "passed"],
			]);
			expect(writes.slice(0, 3).every(([key]) => key.startsWith("cmi.objectives."))).toBe(true);
			if (save === "refused")
				expect(provider.getSaveResult?.("g")).toEqual({
					status: "not-saved",
					code: "runtime-write-failed",
				});
			const reload = makeRuntime();
			reload.initialize();
			const stored = createBlockStateRuntime(reload);
			const view = () =>
				createChoiceDependencyView(facts, {
					rows: reload.getInteractions(),
					readState: (id) => stored.get(id),
				});
			expect(choiceDependencyStatus("g", view())).toBe(save === "refused" ? "history" : "current");
			if (save === "refused") {
				const tracker = new CourseTracker(reload, {
					totalPages: 1,
					completionMethod: "allPages",
					passMark: 80,
					scoredAssessmentIds: ["g"],
					requiredAssessmentIds: ["g"],
					getChoiceDependencyView: view,
				});
				expect(tracker.outcome()).toEqual({ kind: "waiting" });
				const terminate = vi.spyOn(reload, "terminate");
				writes.length = 0;
				tracker.checkCompletion();
				tracker.trackGroupObjective("g", 100, true);
				tracker.finish(true);
				expect(terminate).toHaveBeenCalledExactlyOnceWith(false);
				expect(
					writes.filter(([key]) =>
						/^(?:cmi\.(?:objectives|score|success_status|completion_status)|cmi\.core\.(?:score|lesson_status))/.test(
							key,
						),
					),
				).toEqual([]);
			}
		});
	}
}
