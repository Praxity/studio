import {
	type ChoiceDependencyView,
	choiceDependencyStatus,
	prepareChoiceGroupSubmission,
	restoreChoiceAssessmentState,
} from "@praxity/shared-blocks/choice-learner-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import {
	addedDistractor,
	factsA,
	factsB,
	groupRegressionCases,
	groupState,
	groupSubmission,
	groupView,
	legacySubmitted,
	signatureA,
	signatureB,
	signedSubmitted,
	view,
} from "../../shared-blocks/src/fixtures/choice-evidence";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { CourseTracker } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

type Format = "scorm12" | "scorm2004" | "xapi";
function open(format: Format) {
	const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
	const values = new Map<string, string>(),
		writes: string[][] = [];
	const statements: { verb: { id: string } }[] = [];
	const get = (key: string) => values.get(key) ?? "";
	const set = (key: string, value: string) => {
		values.set(key, value);
		writes.push([key, value]);
		return "true";
	};
	Object.assign(dom.window, {
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
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		statements.push(JSON.parse(String(init.body)));
		return new Response(null, { status: 200 });
	});
	const createRuntime = () =>
		format === "scorm12"
			? new Scorm12Runtime()
			: format === "scorm2004"
				? new Scorm2004Runtime(dom.window as unknown as Window)
				: new XapiRuntime(
						{
							endpoint: "https://lrs.example/statements",
							auth: "Basic synthetic",
							actorMode: "manual",
							actor: { name: "Learner", mbox: "mailto:learner@example.com" },
						},
						"course",
						dom.window.localStorage,
					);
	const runtime = createRuntime();
	expect(runtime.initialize()).toBe(true);
	return {
		runtime,
		values,
		writes,
		statements,
		reopen() {
			const loaded = createRuntime();
			expect(loaded.initialize()).toBe(true);
			return loaded;
		},
		close() {
			dom.window.close();
			vi.unstubAllGlobals();
		},
	};
}
const outcomes = (writes: string[][]) =>
	writes.filter(([key]) =>
		/^(?:cmi\.(?:objectives|score|success_status|completion_status)|cmi\.core\.(?:score|lesson_status))/.test(
			key,
		),
	);

for (const format of ["scorm12", "scorm2004", "xapi"] as const) {
	for (const change of ["distractor", "option"] as const) {
		it(`${format} ${change} edit follows the destination policy after reload`, () => {
			const host = open(format);
			try {
				const provider = createBlockStateRuntime(host.runtime);
				provider.set("a", signedSubmitted as unknown as LearnerStateValue);
				host.runtime.trackInteraction("a", "a", true, 100, {
					assessmentType: "choice",
					contentSignature: signatureA,
				});
				const loaded = host.reopen();
				const state = createBlockStateRuntime(loaded).get("a");
				expect(state).toEqual(
					format === "scorm12"
						? {
								...legacySubmitted,
								contentSignature: "s96:5N83Sur-iuRJwDIe",
								writtenAt: 10,
								legacyBuildRevision: "original-build",
							}
						: signedSubmitted,
				);
				const changed = change === "distractor" ? addedDistractor : factsB;
				const evidence = () => view({ a: state }, loaded.getInteractions(), { a: changed });
				const status = format !== "scorm12" && change === "distractor" ? "current" : "history";
				expect(choiceDependencyStatus("a", evidence())).toBe(status);
				expect(restoreChoiceAssessmentState(state, changed).status).toBe(
					status === "current" ? "current" : "review",
				);
				const tracker = new CourseTracker(host.runtime, {
					totalPages: 1,
					completionMethod: "allPages",
					requiredAssessmentIds: ["a"],
					getChoiceDependencyView: evidence,
				});
				expect(tracker.outcome().kind).toBe(status === "current" ? "decided" : "waiting");
			} finally {
				host.close();
			}
		});
	}
	for (const variant of ["A/B/A", "reselection", "removed"] as const)
		for (const intent of ["check", "score", "display", "end", "finish", "objective"] as const)
			it(`${format} legacy quiz ${variant} ${intent} includes only compiled scored groups`, () => {
				const host = open(format);
				try {
					const fixture = groupRegressionCases().find((item) =>
						item.name.startsWith("A passes,"),
					)?.view;
					expect(fixture).toBeDefined();
					if (!fixture) throw new Error("Missing A/B/A literal");
					const submitted = groupSubmission("oneOf", "signed");
					const evidence =
						variant === "reselection"
							? groupView(
									{
										a: signedSubmitted,
										b: signedSubmitted,
										g: groupState("oneOf", submitted, "b", false),
									},
									[
										{ id: "a", contentSignature: signatureA, correct: true },
										{ id: "b", contentSignature: signatureA, correct: true },
										{
											id: "g",
											contentSignature: submitted.contentSignature,
											memberIds: ["a"],
											correct: true,
										},
									],
									{ a: factsA, b: factsA },
									{ mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
								)
							: fixture;
					for (const row of evidence.rows)
						host.runtime.trackInteraction(
							row.id,
							"a",
							row.correct,
							row.correct === false ? 0 : 100,
							{
								contentSignature: row.contentSignature,
								memberIds: row.memberIds ? [...row.memberIds] : undefined,
							},
						);
					const current = (): ChoiceDependencyView => ({
						...evidence,
						...(variant === "removed" ? { groups: {} } : {}),
						rows: host.runtime.getInteractions(),
					});
					const tracker = new CourseTracker(host.runtime, {
						totalPages: 1,
						completionMethod: "quiz",
						getChoiceDependencyView: current,
					});
					const action = intent === "objective" ? { id: "g", score: 100, passed: true } : intent;
					expect(tracker.outcome(action).kind).toBe(variant === "removed" ? "decided" : "waiting");
					host.writes.length = 0;
					host.statements.length = 0;
					if (variant !== "removed") {
						if (intent === "objective") tracker.trackGroupObjective("g", 100, true);
						else if (intent === "end" || intent === "finish") tracker.finish(intent === "finish");
						else if (intent === "score") tracker.trackInteraction("unrelated", "a", true, 100);
						else if (intent === "display") tracker.getOutcome();
						else tracker.checkCompletion();
						expect(outcomes(host.writes)).toEqual([]);
						expect(
							host.statements.filter((item) => /\/(?:completed|passed|failed)$/.test(item.verb.id)),
						).toEqual([]);
					}
				} finally {
					host.close();
				}
			});
}

for (const format of ["scorm12", "scorm2004"] as const) {
	for (const disposition of ["history", "removed", "replacement"] as const)
		it(`${format} deferred objective ${disposition} never replays stale values`, () => {
			const host = open(format);
			try {
				const submitted = groupSubmission("all", "signed");
				const states: Record<string, unknown> = {
					a: signedSubmitted,
					q: { ...signedSubmitted, contentSignature: signatureB },
					g: groupState("all", submitted, "a", true),
				};
				host.runtime.trackInteraction("a", "a", true, 100, { contentSignature: signatureA });
				host.runtime.trackInteraction("q", "a", true, 100, { contentSignature: signatureB });
				host.runtime.trackInteraction("g", "100%", true, 100, {
					contentSignature: submitted.contentSignature,
					memberIds: ["a"],
				});
				let removed = false;
				const evidence = () => ({
					...groupView(states, host.runtime.getInteractions(), { a: factsA, q: factsA }),
					...(removed ? { groups: {} } : {}),
				});
				const tracker = new CourseTracker(host.runtime, {
					totalPages: 1,
					completionMethod: "allPages",
					requiredAssessmentIds: ["q"],
					getChoiceDependencyView: evidence,
				});
				tracker.trackGroupObjective("g", 100, true);
				states.q = signedSubmitted;
				host.runtime.trackInteraction("q", "a", true, 100, { contentSignature: signatureA });
				if (disposition === "history")
					states.g = { ...groupState("all", submitted), mode: "oneOf" };
				if (disposition === "removed") removed = true;
				host.writes.length = 0;
				if (disposition === "replacement") tracker.trackGroupObjective("g", 0, false);
				else tracker.checkCompletion();
				expect(
					host.writes.filter(([key]) => /^cmi\.objectives\.\d+\.score\.raw$/.test(key)),
				).toEqual(disposition === "replacement" ? [["cmi.objectives.0.score.raw", "0"]] : []);
			} finally {
				host.close();
			}
		});
	it(`${format} replays a group objective once when another dependency is repaired`, () => {
		const host = open(format);
		try {
			const submitted = groupSubmission("all", "signed");
			const states: Record<string, unknown> = {
				a: signedSubmitted,
				q: { ...signedSubmitted, contentSignature: signatureB },
				g: groupState("all", submitted, "a", true),
			};
			host.runtime.trackInteraction("a", "a", true, 100, { contentSignature: signatureA });
			host.runtime.trackInteraction("q", "a", true, 100, { contentSignature: signatureB });
			const evidence = () =>
				groupView(states, host.runtime.getInteractions(), { a: factsA, q: factsA });
			const tracker = new CourseTracker(host.runtime, {
				totalPages: 1,
				completionMethod: "allPages",
				requiredAssessmentIds: ["q", "g"],
				getChoiceDependencyView: evidence,
			});
			host.writes.length = 0;
			tracker.trackGroupObjective("g", 100, true);
			tracker.trackInteraction("g", "100%", true, 100, {
				contentSignature: submitted.contentSignature,
				memberIds: ["a"],
			});
			expect(outcomes(host.writes)).toEqual([]);
			states.q = signedSubmitted;
			tracker.trackInteraction("q", "a", true, 100, { contentSignature: signatureA });
			tracker.checkCompletion();
			tracker.checkCompletion();
			expect(host.writes.filter(([key]) => key === "cmi.objectives.0.id")).toEqual([
				["cmi.objectives.0.id", "g"],
			]);
			expect(host.values.get("cmi.objectives.0.score.raw")).toBe("100");
			expect(host.writes.filter(([key]) => /^cmi\.objectives\.\d+\.score\.raw$/.test(key))).toEqual(
				[["cmi.objectives.0.score.raw", "100"]],
			);
			expect(
				host.values.get(
					format === "scorm12" ? "cmi.objectives.0.status" : "cmi.objectives.0.success_status",
				),
			).toBe("passed");
		} finally {
			host.close();
		}
	});
}

it("the SCORM 2004 pass-mark policy suspends a failed saved result before any outcome write", () => {
	const host = open("scorm2004");
	try {
		host.values.set("cmi.completion_status", "completed");
		host.values.set("cmi.success_status", "failed");
		new CourseTracker(host.runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			passMark: 80,
			scoredAssessmentIds: ["a"],
		});
		host.writes.length = 0;
		host.runtime.commit();
		expect(host.values.get("cmi.exit")).toBe("suspend");
		expect(outcomes(host.writes)).toEqual([]);
	} finally {
		host.close();
	}
});

it("a full-signed aggregate remains current after its members' compact destination write", () => {
	const short = { ...legacySubmitted, contentSignature: "s96:5N83Sur-iuRJwDIe" };
	const submitted = groupSubmission("oneOf", "signed");
	const evidence = groupView(
		{ a: short, g: groupState("oneOf", submitted, "a", true) },
		[
			{ id: "a", correct: true, contentSignature: signatureA },
			{ id: "g", contentSignature: submitted.contentSignature, memberIds: ["a"] },
		],
		{ a: factsA },
		{ mode: "oneOf", memberIds: ["a"], requiredIds: ["a"] },
	);
	expect(choiceDependencyStatus("g", evidence)).toBe("current");
	expect(prepareChoiceGroupSubmission("g", evidence)?.payload.dependencies).toEqual([
		["a", "s96:5N83Sur-iuRJwDIe"],
	]);
	const changed = { ...evidence, signatures: { a: signatureB }, questions: { a: factsB.question } };
	expect(choiceDependencyStatus("g", changed)).toBe("history");
});
