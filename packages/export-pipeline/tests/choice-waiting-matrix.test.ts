// @vitest-environment jsdom

import {
	type ChoiceDependencyView,
	choiceDependencyStatus,
} from "@praxity/shared-blocks/choice-learner-state";
import { createLearnerState, serializeLearnerState } from "@praxity/shared-blocks/learner-state";
import { afterEach, expect, it, vi } from "vitest";
import { choiceEvidenceCases } from "../../shared-blocks/src/fixtures/choice-evidence";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { serializeScorm12SuspendData } from "../src/scorm/scorm12-suspend-data";
import { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

const cases = choiceEvidenceCases();
afterEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	Reflect.deleteProperty(window, "API");
	Reflect.deleteProperty(window, "API_1484_11");
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

for (const format of ["scorm12", "scorm2004", "xapi", "standalone"] as const) {
	for (const intent of ["End", "Finish"] as const)
		for (const { name, id, status, view: fixture } of cases)
			it(`${format} ${intent} evidence matrix: ${name}`, () => {
				// Reuse Vitest's DOM; thousands of closed windows retain their queued events.
				const values = new Map<string, string>();
				const writes: string[][] = [];
				const statements: unknown[] = [];
				const set = (key: string, value: string) => {
					writes.push([key, value]);
					values.set(key, value);
					return "true";
				};
				const get = (key: string) => values.get(key) ?? "";
				Object.assign(window, {
					API: {
						LMSInitialize: () => "true",
						LMSFinish: () => "true",
						LMSCommit: () => "true",
						LMSGetValue: get,
						LMSSetValue: set,
						LMSGetLastError: () => "0",
						LMSGetErrorString: () => "",
						LMSGetDiagnostic: () => "",
					},
					API_1484_11: {
						Initialize: () => "true",
						Terminate: () => "true",
						Commit: () => "true",
						GetValue: get,
						SetValue: set,
						GetLastError: () => "0",
						GetErrorString: () => "",
						GetDiagnostic: () => "",
					},
				});
				vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
					statements.push(JSON.parse(String(init.body)));
					return new Response(null, { status: 200 });
				});
				const initialRows = fixture.rows.map((row, index) => ({
					...row,
					response: "a",
					score: row.correct === false ? 0 : 100,
					timestamp: index + 1,
					memberIds: row.memberIds ? [...row.memberIds] : undefined,
				}));
				const keys = new Set([
					...Object.keys(fixture.questions),
					...Object.keys(fixture.groups ?? {}),
					...fixture.rows.map((row) => row.id),
				]);
				const blockState = JSON.parse(
					JSON.stringify(
						Object.fromEntries(
							[...keys]
								.filter((key) => fixture.readState(key) !== undefined)
								.map((key) => [key, fixture.readState(key)]),
						),
					),
				);
				if (format === "scorm12")
					values.set(
						"cmi.suspend_data",
						serializeScorm12SuspendData({
							visitedPages: [],
							interactions: initialRows,
							custom: JSON.stringify({ blockState }),
						}),
					);
				if (format === "scorm2004")
					values.set(
						"cmi.suspend_data",
						JSON.stringify({ visitedPages: [], interactions: initialRows, blockState }),
					);
				if (format === "standalone") {
					const saved = createLearnerState({ courseId: "course", attemptId: "attempt" });
					saved.interactions = initialRows;
					saved.blockState = blockState;
					localStorage.setItem("praxity:course:attempt:state", serializeLearnerState(saved));
				}
				if (format === "xapi")
					localStorage.setItem(
						"praxity-xapi:course:mailto%3Alearner%40example.com",
						JSON.stringify({
							interactions: initialRows,
							suspendData: JSON.stringify({ blockState }),
						}),
					);
				const runtime: SCORMRuntime =
					format === "scorm12"
						? new Scorm12Runtime()
						: format === "scorm2004"
							? new Scorm2004Runtime(window)
							: format === "standalone"
								? new LocalStorageRuntime(localStorage, "course", "attempt")
								: new XapiRuntime(
										{
											endpoint: "https://lrs.example/statements",
											auth: "Basic synthetic",
											actorMode: "manual",
											actor: { name: "Learner", mbox: "mailto:learner@example.com" },
										},
										"course",
										localStorage,
									);
				runtime.initialize();
				const provider = createBlockStateRuntime(runtime);
				const evidence = (): ChoiceDependencyView => ({
					...fixture,
					rows: runtime.getInteractions(),
					readState: (key) => provider.get(key),
				});
				expect(choiceDependencyStatus(id, evidence())).toBe(status);
				const tracker = new CourseTracker(runtime, {
					totalPages: 1,
					completionMethod: "allPages",
					passMark: 80,
					scoredAssessmentIds: [id],
					requiredAssessmentIds: [id],
					getAssessmentState: (key) => provider.get(key),
					getChoiceDependencyView: evidence,
					deferRetryableFailure: format === "scorm12" || format === "scorm2004",
				});
				expect(tracker.outcome().kind).toBe(status === "history" ? "waiting" : "decided");
				const completion = vi.spyOn(runtime, "setCompletion");
				const score = vi.spyOn(runtime, "setScore");
				const success = runtime.setSuccess && vi.spyOn(runtime, "setSuccess");
				const objective = runtime.trackObjective && vi.spyOn(runtime, "trackObjective");
				const terminate = vi.spyOn(runtime, "terminate");
				writes.length = 0;
				statements.length = 0;
				tracker.checkCompletion();
				tracker.trackGroupObjective(id, 100, true);
				if (status === "history") {
					expect(completion).not.toHaveBeenCalled();
					expect(score).not.toHaveBeenCalled();
					if (success) expect(success).not.toHaveBeenCalled();
					if (objective) expect(objective).not.toHaveBeenCalled();
					expect(writes).toEqual([]);
					expect(statements).toEqual([]);
					expect(tracker.isAssessmentFinal(id)).toBe(false);
					expect(tracker.getOutcome()).toBeUndefined();
					tracker.finish(intent === "Finish");
					expect(terminate).toHaveBeenLastCalledWith(false);
					expect(
						writes.filter(([key]) =>
							/^(?:cmi\.(?:objectives|score|success_status|completion_status)|cmi\.core\.(?:score|lesson_status))/.test(
								key,
							),
						),
					).toEqual([]);
					expect(
						statements.filter((statement) =>
							/\/(?:completed|passed|failed)"/.test(JSON.stringify(statement)),
						),
					).toEqual([]);
				} else {
					const plain = new CourseTracker(runtime, {
						totalPages: 1,
						completionMethod: "allPages",
						passMark: 80,
						scoredAssessmentIds: [id],
						requiredAssessmentIds: [id],
						getAssessmentState: (key) => provider.get(key),
						deferRetryableFailure: format === "scorm12" || format === "scorm2004",
					});
					for (const intent of [
						"check",
						"score",
						"display",
						"end",
						"finish",
						{ id, score: 100, passed: true },
					] as const)
						expect(tracker.outcome(intent)).toEqual(plain.outcome(intent));
					if (objective) expect(objective).toHaveBeenCalledExactlyOnceWith(id, 100, true);
					expect(tracker.outcome("end").kind).toBe("decided");
					expect(tracker.outcome("finish").kind).toBe("decided");
				}
			});
}
