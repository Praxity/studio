import {
	choiceDependencyStatus,
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
} from "@praxity/shared-blocks/choice-learner-state";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { writeCourseOutcome } from "@praxity/shared-blocks/learner-block-state";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { factsA } from "../../shared-blocks/src/fixtures/choice-evidence";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

it.each([1, 2])(
	"%i waiting xAPI exits do not suppress a later current launch's ordinary result",
	(exits) => {
		const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
		const statements: { verb: { id: string } }[] = [];
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			statements.push(JSON.parse(String(init.body)));
			return new Response(null, { status: 200 });
		});
		try {
			const runtime = new XapiRuntime(
				{
					endpoint: "https://lrs.example/statements",
					auth: "Basic synthetic",
					actorMode: "manual",
					actor: { name: "Learner", mbox: "mailto:learner@example.com" },
				},
				"course",
				dom.window.localStorage,
			);
			runtime.initialize();
			statements.length = 0;
			writeCourseOutcome(runtime, { kind: "waiting", finish: "terminate" });
			if (exits === 2)
				expect(writeCourseOutcome(runtime, { kind: "waiting", finish: "terminate" })).toBe(false);
			expect(statements).toEqual([]);
			runtime.initialize();
			statements.length = 0;
			writeCourseOutcome(runtime, {
				kind: "decided",
				completion: "completed",
				finish: "terminate",
			});
			expect(statements.map((statement) => statement.verb.id)).toEqual([
				"http://adlnet.gov/expapi/verbs/completed",
				"http://adlnet.gov/expapi/verbs/completed",
			]);
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	},
);

it("xAPI reload retains the first incorrect selection and verdict after a same-content retry", () => {
	const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
	const make = () =>
		new XapiRuntime(
			{
				endpoint: "https://lrs.example/statements",
				auth: "Basic synthetic",
				actorMode: "manual",
				actor: { name: "Learner", mbox: "mailto:learner@example.com" },
			},
			"course",
			dom.window.localStorage,
		);
	try {
		const runtime = make();
		runtime.initialize();
		const provider = createBlockStateRuntime(runtime);
		const first = prepareChoiceAssessmentState(
			undefined,
			{
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				answer: ["b"],
				checked: true,
				correct: false,
				completed: false,
				interacted: true,
				attemptCount: 1,
			},
			factsA,
			{ writtenAt: 1 },
		);
		provider.set("a", JSON.parse(JSON.stringify(first)));
		runtime.trackInteraction("a", "b", false, 0, {
			contentSignature: first.contentSignature,
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		const draft = prepareChoiceAssessmentState(
			first,
			{ ...first, answer: [], checked: false, interacted: false },
			factsA,
			{ writtenAt: 2 },
		);
		provider.set("a", JSON.parse(JSON.stringify(draft)));
		const final = prepareChoiceAssessmentState(
			draft,
			{ ...first, answer: ["a"], correct: true, completed: true, attemptCount: 2 },
			factsA,
			{ writtenAt: 3 },
		);
		provider.set("a", JSON.parse(JSON.stringify(final)));
		runtime.trackInteraction("a", "a", true, 100, {
			contentSignature: final.contentSignature,
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		const reload = make();
		reload.initialize();
		const restored = createBlockStateRuntime(reload);
		expect(restored.get("a")).toMatchObject({
			answer: ["a"],
			correct: true,
			attemptCount: 2,
			history: [first],
		});
		expect(first).toMatchObject({
			answer: ["b"],
			correct: false,
			completed: false,
			attemptCount: 1,
		});
		expect(
			choiceDependencyStatus(
				"a",
				createChoiceDependencyView(
					admitChoiceStateFacts({
						choiceStateQuestions: { a: factsA.question },
						choiceStateSignatures: { a: factsA.signature },
					}),
					{ rows: reload.getInteractions(), readState: restored.get },
				),
			),
		).toBe("current");
	} finally {
		dom.window.close();
		vi.unstubAllGlobals();
	}
});
