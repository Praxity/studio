import {
	choiceContentSignature,
	choiceStateQuestion,
} from "@praxity/shared-blocks/assessment-choice";
import {
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
} from "@praxity/shared-blocks/choice-learner-state";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import type { AssessmentBlockData } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { renderCourseCompletionResult } from "../template/src/components/course-completion-result";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

const ids = ["a", "b", "c"];
function question(stem: string): AssessmentBlockData {
	return {
		assessmentType: "choice",
		stem: [{ id: "stem", type: "text", data: { content: stem } }],
		gradingMode: "exact",
		points: 100,
		attempts: 1,
		feedback: {},
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
}

for (const format of ["scorm12", "scorm2004", "xapi"] as const) {
	it.each(["practice", "partial correct", "quiz partial wrong", "quiz history upgrade"] as const)(
		`${format} waits without changing reported fields while history still affects the result: %s`,
		(trigger) => {
			const dom = new JSDOM("", { url: "https://course.example" });
			vi.stubGlobal("window", dom.window);
			const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
			vi.stubGlobal("fetch", fetch);
			const values: Record<string, string> = {};
			const writes: string[][] = [];
			const get = (key: string) => values[key] ?? "";
			const set = (key: string, value: string) => {
				writes.push([key, value]);
				if (key === "cmi.suspend_data" && format === "scorm12")
					expect(value.length).toBeLessThanOrEqual(4096);
				values[key] = value;
				return "true";
			};
			const api = {
				Initialize: () => "true",
				Terminate: () => "true",
				Commit: () => "true",
				GetValue: get,
				SetValue: set,
				GetLastError: () => "0",
				GetErrorString: () => "",
				GetDiagnostic: () => "",
			};
			Object.assign(dom.window, {
				API_1484_11: api,
				API: {
					LMSInitialize: api.Initialize,
					LMSFinish: api.Terminate,
					LMSCommit: api.Commit,
					LMSGetValue: get,
					LMSSetValue: set,
					LMSGetLastError: api.GetLastError,
				},
			});
			const quiz = trigger.startsWith("quiz");
			const upgrade = trigger === "quiz history upgrade";
			function open(content: AssessmentBlockData[]) {
				const runtime: SCORMRuntime =
					format === "scorm12"
						? new Scorm12Runtime()
						: format === "scorm2004"
							? new Scorm2004Runtime(dom.window as unknown as Window)
							: new XapiRuntime(
									{
										endpoint: "https://lrs.example/xapi",
										auth: "Basic test",
										actorMode: "manual",
										actor: { name: "Learner", mbox: "mailto:learner@example.test" },
									},
									"course",
									dom.window.localStorage,
								);
				expect(runtime.initialize()).toBe(true);
				const provider = createBlockStateRuntime(runtime);
				const signatures = Object.fromEntries(
					ids.map((id, n) => [id, choiceContentSignature(content[n], false)]),
				);
				const questions = Object.fromEntries(
					ids.map((id, n) => [id, choiceStateQuestion(content[n], false)]),
				);
				const evidence = () =>
					createChoiceDependencyView(
						admitChoiceStateFacts({
							choiceStateQuestions: questions,
							choiceStateSignatures: signatures,
						}),
						{ rows: runtime.getInteractions(), readState: provider.get },
					);
				const tracker = new CourseTracker(runtime, {
					totalPages: 1,
					completionMethod: quiz ? "quiz" : "allPages",
					passMark: quiz ? 60 : 80,
					...(quiz ? {} : { scoredAssessmentIds: ids }),
					deferRetryableFailure: true,
					getChoiceDependencyView: evidence,
					getAssessmentState: provider.get,
				});
				function submit(n: number, correct: boolean) {
					const saved = prepareChoiceAssessmentState(
						provider.get(ids[n]),
						{
							version: 1,
							kind: "assessment",
							assessmentType: "choice",
							attemptCount: 1,
							checked: true,
							correct,
							completed: true,
							interacted: true,
							answer: [correct ? "stop" : "go"],
						},
						{ question: questions[ids[n]], signature: signatures[ids[n]] },
						{ writtenAt: Date.now() },
					);
					provider.set(ids[n], JSON.parse(JSON.stringify(saved)));
					tracker.trackInteraction(ids[n], correct ? "stop" : "go", correct, correct ? 100 : 0, {
						assessmentType: "choice",
						contentSignature: saved.contentSignature,
						attemptsUsed: 1,
						maxAttempts: 1,
					});
					runtime.commit();
				}
				return { runtime, tracker, submit };
			}
			const scoreKey = format === "scorm12" ? "cmi.core.score.raw" : "cmi.score.raw";
			const successKey = format === "scorm12" ? "cmi.core.lesson_status" : "cmi.success_status";
			const success = (runtime: SCORMRuntime) =>
				format === "xapi" ? runtime.getSuccess?.() : values[successKey];
			const score = (runtime: SCORMRuntime) =>
				format === "xapi" ? runtime.getScore()?.raw : Number(values[scoreKey]);
			try {
				const original = ids.map((id) => question(`Choose safely ${id}`));
				const first = open(original);
				first.tracker.trackPageVisit("p");
				ids.forEach((_, n) => first.submit(n, !upgrade || n === 0));
				expect(score(first.runtime)).toBeCloseTo(upgrade ? 33.33 : 100, 1);
				expect(success(first.runtime)).toBe(upgrade ? "failed" : "passed");
				const changed = [
					original[0],
					question("A different prompt b"),
					question("A different prompt c"),
				];
				const reload = open(changed);
				const earlier = fetch.mock.calls.length;
				writes.length = 0;
				reload.tracker.trackPageVisit("p");
				if (upgrade) reload.tracker.trackInteraction("new-scored", "Answer", true, 100);
				else if (trigger === "practice")
					reload.tracker.trackInteraction("practice", "Reflection", undefined, undefined, {
						assessmentType: "textResponse",
					});
				else reload.submit(1, !quiz);
				reload.runtime.commit();
				expect(score(reload.runtime)).toBeCloseTo(upgrade ? 33.33 : 100, 1);
				expect(success(reload.runtime)).toBe(upgrade ? "failed" : "passed");
				expect(
					writes.filter(([key]) =>
						/^(?:cmi\.(?:objectives|score|success_status|completion_status)|cmi\.core\.(?:score|lesson_status))/.test(
							key,
						),
					),
				).toEqual([]);
				if (format === "scorm2004") expect(values["cmi.completion_status"]).toBe("completed");
				expect(
					fetch.mock.calls
						.slice(earlier)
						.map(([, init]) => JSON.parse(init.body))
						.filter((statement) => /\/(?:completed|passed|failed)$/.test(statement.verb.id)),
				).toEqual([]);
				if (upgrade) {
					expect(reload.tracker.outcome().kind).toBe("waiting");
					return;
				}
				if (quiz) {
					expect(reload.tracker.calculateScore()).toBe(50);
					expect(reload.tracker.outcome().kind).toBe("waiting");
					dom.window.document.body.innerHTML =
						"<p data-course-score></p><p data-course-outcome><span data-course-outcome-label></span></p>";
					renderCourseCompletionResult(
						dom.window.document,
						{ ...getStrings("en") },
						reload.tracker.getOutcome(),
						reload.tracker.getCurrentScore(),
					);
					expect(dom.window.document.querySelector("[data-course-score]")?.textContent).toBe(
						"Score: 50 / 100",
					);
					expect(score(reload.runtime)).toBe(100);
					reload.submit(2, true);
					expect(score(reload.runtime)).toBeCloseTo(66.67, 1);
					expect(success(reload.runtime)).toBe("passed");
					reload.submit(0, false);
					expect(score(reload.runtime)).toBeCloseTo(33.33, 1);
					expect(success(reload.runtime)).toBe("failed");
				} else expect(reload.tracker.outcome().kind).toBe("waiting");
			} finally {
				dom.window.close();
				vi.unstubAllGlobals();
			}
		},
	);
}
