// @vitest-environment jsdom

import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { createLearnerState, serializeLearnerState } from "@praxity/shared-blocks/learner-state";
import { beforeEach, expect, it, vi } from "vitest";
import {
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
	restoreChoiceAssessmentState,
} from "../../shared-blocks/src/choice-learner-state";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import type { TrackingConfig } from "../src/scorm/tracking";
import { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";

const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const oldSignature = "sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702";
const facts = admitChoiceStateFacts({
	choiceStateQuestions: {
		a: {
			selectionMode: "single",
			dontKnow: false,
			canAutoScore: true,
			graded: true,
			maxAttempts: 2,
			correctAnswerSignature:
				"sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
			materialSignature: `sha256:${"a".repeat(64)}`,
			options: [
				{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
				{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
			],
		},
	},
	choiceStateSignatures: { a: signature },
});

beforeEach(() => localStorage.clear());

function launch(contentSignature = oldSignature, override: Partial<TrackingConfig> = {}) {
	const local = new LocalStorageRuntime(localStorage, "course", "attempt");
	const runtime: SCORMRuntime = local;
	runtime.initialize();
	local.setBlockState("a", {
		version: 1,
		kind: "assessment",
		assessmentType: "choice",
		answer: ["a"],
		checked: true,
		completed: true,
		correct: true,
		interacted: true,
		attemptCount: 1,
		contentSignature,
	});
	runtime.trackInteraction("a", "a", true, 100, { contentSignature });
	runtime.trackPageVisit("page");
	const writes: unknown[][] = [];
	runtime.trackObjective = (id, score, passed) => {
		writes.push(["objective", id, score, passed]);
	};
	vi.spyOn(runtime, "setCompletion").mockImplementation((status) => {
		writes.push(["completion", status]);
	});
	vi.spyOn(runtime, "setScore").mockImplementation((...score) => {
		writes.push(["score", ...score]);
	});
	vi.spyOn(runtime, "terminate").mockImplementation((explicit) => {
		writes.push(["terminate", explicit]);
		return true;
	});
	const config = {
		totalPages: 1,
		completionMethod: "allPages" as const,
		passMark: 80,
		scoredAssessmentIds: ["a"],
		requiredAssessmentIds: ["a"],
		getAssessmentState: (id: string) => local.getBlockState(id),
		getChoiceDependencyView: () =>
			createChoiceDependencyView(facts, {
				rows: runtime.getInteractions(),
				readState: (id) => local.getBlockState(id),
			}),
		...override,
	};
	return { tracker: new CourseTracker(runtime, config), writes, runtime, config };
}

it.each<[string, Partial<TrackingConfig>, "decided" | "waiting"]>([
	[
		"completion-only ignores optional history",
		{ requiredAssessmentIds: [], scoredAssessmentIds: [], passMark: undefined },
		"decided",
	],
	["pass mark includes scored history", { requiredAssessmentIds: [] }, "waiting"],
	["pass mark includes required history", { scoredAssessmentIds: ["non-choice"] }, "waiting"],
	[
		"quiz includes submitted graded compiled history",
		{ completionMethod: "quiz", requiredAssessmentIds: [], scoredAssessmentIds: [] },
		"waiting",
	],
	[
		"quiz ignores removed row IDs",
		{
			completionMethod: "quiz",
			requiredAssessmentIds: [],
			scoredAssessmentIds: [],
			getChoiceDependencyView: () =>
				createChoiceDependencyView(admitChoiceStateFacts({}), {
					rows: [{ id: "removed", contentSignature: oldSignature }],
					readState: () => undefined,
				}),
		},
		"decided",
	],
])("course dependency set: %s", (_name, config, expected) => {
	expect(launch(oldSignature, config).tracker.outcome().kind).toBe(expected);
});

it("quiz ignores optional ungraded history but still locks its own gate", () => {
	const { runtime, config } = launch();
	const ungraded = {
		...facts,
		choiceStateQuestions: { a: { ...facts.choiceStateQuestions.a, graded: false } },
	};
	const view = () =>
		createChoiceDependencyView(ungraded, {
			rows: runtime.getInteractions(),
			readState: config.getAssessmentState,
		});
	const tracker = new CourseTracker(runtime, {
		...config,
		completionMethod: "quiz",
		scoredAssessmentIds: [],
		requiredAssessmentIds: [],
		getChoiceDependencyView: view,
	});
	expect(tracker.outcome().kind).toBe("decided");
});

it("invalid compiled IDs cannot fall back to the stale LMS score for display", () => {
	new LocalStorageRuntime(localStorage, "course", "attempt").setScore(100, 0, 100);
	const { tracker } = launch(oldSignature, {
		getChoiceDependencyView: () => ({
			invalidIds: ["a"],
			questions: {},
			signatures: {},
			rows: [],
			readState: () => undefined,
		}),
	});
	expect(tracker.getCurrentScore()).toBeNull();
});

it("displays a current recorded grade while excluding a historical choice row", () => {
	const { runtime, tracker } = launch();
	runtime.trackInteraction("recorded-grade", "Recorded response", true, 75);
	expect(tracker.getCurrentScore()).toEqual({ raw: 75, min: 0, max: 100 });
});

for (const [mode, config] of [
	["pass mark", {}],
	["completion only", { passMark: undefined, scoredAssessmentIds: [] }],
	[
		"percentage",
		{
			completionMethod: "percentage",
			completionThreshold: 50,
			passMark: undefined,
			scoredAssessmentIds: [],
		},
	],
	[
		"legacy quiz",
		{
			completionMethod: "quiz",
			requiredAssessmentIds: [],
			scoredAssessmentIds: [],
			passMark: undefined,
		},
	],
] satisfies [string, Partial<TrackingConfig>][])
	it.each(["check", "visit", "score", "objective", "End", "Finish"] as const)(
		`${mode}: history waits above %s without any outcome write`,
		(intent) => {
			const { tracker, writes } = launch(oldSignature, config);
			if (intent === "check") tracker.checkCompletion();
			if (intent === "visit") tracker.trackPageVisit("page");
			if (intent === "score") tracker.trackInteraction("practice", "answer", true, 100);
			if (intent === "objective") tracker.trackGroupObjective("group", 100, true);
			if (intent === "End") tracker.finish(false);
			if (intent === "Finish") tracker.finish(true);
			expect(writes).toEqual(intent === "End" || intent === "Finish" ? [["terminate", false]] : []);
		},
	);

it.each(["unsigned", "repaired"] as const)(
	"two required choices complete after the %s first answer and current second answer",
	(path) => {
		const runtime = new LocalStorageRuntime(localStorage, "two", "attempt");
		runtime.initialize();
		const original = {
			version: 1 as const,
			kind: "assessment" as const,
			assessmentType: "choice",
			answer: ["a"],
			checked: true,
			completed: true,
			correct: true,
			interacted: true,
			attemptCount: 1,
		};
		const previous =
			path === "unsigned" ? original : { ...original, contentSignature: oldSignature };
		runtime.setBlockState("a", previous);
		runtime.trackInteraction(
			"a",
			"a",
			true,
			100,
			path === "unsigned" ? undefined : { contentSignature: oldSignature },
		);
		const pair = { question: facts.choiceStateQuestions.a, signature };
		const allFacts = admitChoiceStateFacts({
			choiceStateQuestions: { a: pair.question, b: pair.question },
			choiceStateSignatures: { a: signature, b: signature },
		});
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			requiredAssessmentIds: ["a", "b"],
			getAssessmentState: (id) => runtime.getBlockState(id),
			getChoiceDependencyView: () =>
				createChoiceDependencyView(allFacts, {
					rows: runtime.getInteractions(),
					readState: (id) => runtime.getBlockState(id),
				}),
		});
		tracker.trackPageVisit("page");
		if (path === "repaired") {
			expect(tracker.outcome().kind).toBe("waiting");
			const current = prepareChoiceAssessmentState(previous, original, pair, { writtenAt: 2 });
			runtime.setBlockState("a", JSON.parse(JSON.stringify(current)));
			runtime.trackInteraction("a", "a", true, 100, { contentSignature: signature });
		} else expect(runtime.getBlockState("a")).toEqual(original);
		expect(runtime.getCompletion()).toBe("incomplete");
		runtime.setBlockState("b", { ...original, contentSignature: signature });
		tracker.trackInteraction("b", "a", true, 100, { contentSignature: signature });
		expect(runtime.getCompletion()).toBe("completed");
	},
);

it("in-course score and finality omit history while the LMS stays untouched", () => {
	const { tracker, writes } = launch();
	expect(tracker.calculateScore()).toBe(0);
	expect(tracker.getOutcome()).toBeUndefined();
	expect(tracker.isAssessmentFinal("a")).toBe(false);
	expect(writes).toEqual([]);
});

it("a current answer keeps the ordinary completion and score", () => {
	const { tracker, writes } = launch(signature);
	tracker.trackPageVisit("page");
	expect(writes).toEqual([["completion", "passed"]]);
	expect(tracker.calculateScore()).toBe(100);
	expect(tracker.getOutcome()).toEqual({ score: 100, passed: true });
});

it("an unrelated preview write retains a legacy answer's original build", () => {
	const state = createLearnerState({
		courseId: "course",
		attemptId: "attempt",
		revision: "old-build",
	});
	state.blockState.a = {
		version: 1,
		kind: "assessment",
		assessmentType: "choice",
		answer: ["a"],
		checked: true,
		completed: true,
		correct: true,
		interacted: true,
		attemptCount: 1,
	};
	localStorage.setItem("praxity:course:attempt:state", serializeLearnerState(state));
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "new-build");
	runtime.trackPageVisit("page");
	expect(runtime.getSavedBuildRevision()).toBe("new-build");
	expect(runtime.getBlockState("a")).toEqual({
		...state.blockState.a,
		legacyBuildRevision: "old-build",
	});
	expect(
		restoreChoiceAssessmentState(
			runtime.getBlockState("a"),
			{
				question: facts.choiceStateQuestions.a,
				signature,
			},
			{ savedRevision: runtime.getSavedBuildRevision(), currentRevision: "new-build" },
		).status,
	).toBe("review");
});

it("an unrelated published write leaves unsigned legacy learner bytes untouched", () => {
	const state = createLearnerState({
		courseId: "course",
		attemptId: "attempt",
		revision: "old-build",
	});
	state.blockState.a = {
		version: 1,
		kind: "assessment",
		assessmentType: "choice",
		answer: ["a"],
		checked: true,
		completed: true,
		correct: true,
		interacted: true,
		attemptCount: 1,
	};
	localStorage.setItem("praxity:course:attempt:state", serializeLearnerState(state));
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt");
	runtime.trackPageVisit("page");
	expect(runtime.getBlockState("a")).toEqual(state.blockState.a);
	expect(runtime.getSavedBuildRevision()).toBeNull();
});
