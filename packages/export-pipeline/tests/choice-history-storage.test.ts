import { createHash } from "node:crypto";
import {
	choiceContentSignature,
	choiceStateQuestion,
} from "@praxity/shared-blocks/assessment-choice";
import {
	choiceDependencyStatus,
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
} from "@praxity/shared-blocks/choice-learner-state";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import type { AssessmentBlockData, ChoiceResponse } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { CourseTracker } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";

const uuid = (seed: string) => {
	const hex = createHash("sha256").update(seed).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const question = (index: number, revision: number): AssessmentBlockData => ({
	assessmentType: "choice",
	gradingMode: "exact",
	attempts: 2,
	feedback: {},
	stem: [
		{
			id: "stem",
			type: "text",
			data: { content: `Choose safe procedure ${index}, revision ${revision}` },
		},
	],
	response: {
		type: "choice",
		inputMethod: "click",
		display: "list",
		shuffle: false,
		selectionMode: "single",
		options: Array.from({ length: 4 }, (_, option) => ({
			id: uuid(`option-${index}-${option}`),
			label: `Action ${option}`,
			isCorrect: option === 0,
		})),
	},
});

it.each([5, 8, 12, 16, 20])(
	"retains all referenced history or atomically refuses at the real cap for %i UUID questions",
	(count) => {
		const values = new Map<string, string>();
		const lengths: number[] = [];
		const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
		Object.assign(dom.window, {
			API: {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
				LMSGetErrorString: () => "",
				LMSGetDiagnostic: () => "",
				LMSGetValue: (key: string) => values.get(key) ?? "",
				LMSSetValue: (key: string, value: string) => {
					if (key === "cmi.suspend_data") {
						lengths.push(value.length);
						expect(value.length).toBeLessThanOrEqual(4096);
					}
					values.set(key, value);
					return "true";
				},
			},
		});
		vi.stubGlobal("window", dom.window);
		try {
			const runtime = new Scorm12Runtime();
			runtime.initialize();
			const provider = createBlockStateRuntime(runtime);
			const saved = new Map<string, unknown>();
			const facts = new Map<
				string,
				{ question: ReturnType<typeof choiceStateQuestion>; signature: string }
			>();
			let first = 0,
				revised = 0;
			for (const revision of [1, 2])
				for (let index = 0; index < count; index++) {
					const id = uuid(`question-${index}`);
					if (revision === 2 && !saved.has(id)) continue;
					const data = question(index, revision);
					const pair = {
						question: choiceStateQuestion(data, false),
						signature: choiceContentSignature(data, false),
					};
					const previous = provider.get(id);
					const selected = (data.response as ChoiceResponse).options[0].id;
					const next = prepareChoiceAssessmentState(
						previous,
						{
							version: 1,
							kind: "assessment",
							assessmentType: "choice",
							attemptCount: 1,
							answer: [selected],
							checked: true,
							correct: true,
							completed: true,
							interacted: true,
						},
						pair,
						{ writtenAt: revision * 100 + index },
					);
					const before = values.get("cmi.suspend_data");
					const staged = provider.stageSubmission?.(id, () => {
						provider.set(id, JSON.parse(JSON.stringify(next)));
						return provider.getSaveResult?.(id)?.status !== "not-saved";
					});
					if (!staged) {
						expect(values.get("cmi.suspend_data")).toBe(before);
						expect(provider.getSaveResult?.(id)?.status).toBe("not-saved");
						continue;
					}
					try {
						runtime.trackInteraction(id, selected, true, 100, {
							assessmentType: "choice",
							contentSignature: pair.signature,
							attemptsUsed: 1,
							maxAttempts: 2,
						});
					} catch (error) {
						expect(String(error)).toContain("ESCORM12STORAGE");
						expect(values.get("cmi.suspend_data")).toBe(before);
						expect(provider.getSaveResult?.(id)?.status).toBe("not-saved");
						continue;
					}
					if (revision === 1) first++;
					else {
						revised++;
						expect(next.history).toEqual([previous]);
					}
					const { materialProof: _proof, ...answer } = next;
					saved.set(
						id,
						JSON.parse(
							JSON.stringify({
								...answer,
								contentSignature: `s96:${Buffer.from(pair.signature.slice(7), "hex").subarray(0, 12).toString("base64url")}`,
							}),
						),
					);
					facts.set(id, pair);
				}
			const reload = new Scorm12Runtime();
			reload.initialize();
			const restored = createBlockStateRuntime(reload);
			const admitted = admitChoiceStateFacts({
				choiceStateQuestions: Object.fromEntries(
					[...facts].map(([id, pair]) => [id, pair.question]),
				),
				choiceStateSignatures: Object.fromEntries(
					[...facts].map(([id, pair]) => [id, pair.signature]),
				),
			});
			const view = () =>
				createChoiceDependencyView(admitted, {
					rows: reload.getInteractions(),
					readState: restored.get,
				});
			for (const [id, state] of saved) {
				expect(restored.get(id)).toEqual(state);
				expect(choiceDependencyStatus(id, view())).toBe("current");
			}
			expect(reload.getInteractions()).toHaveLength(first + revised);
			if (count === 5) {
				expect(first).toBe(5);
				expect(revised).toBe(5);
				const tracker = new CourseTracker(reload, {
					totalPages: 1,
					completionMethod: "allPages",
					requiredAssessmentIds: [...saved.keys()],
					getChoiceDependencyView: view,
				});
				tracker.trackPageVisit("page");
				reload.commit();
				expect(values.get("cmi.core.lesson_status")).toBe("completed");
			}
			console.info(
				"Retained choice storage",
				JSON.stringify({
					count,
					first,
					revised,
					maxCharacters: Math.max(...lengths),
					finalCharacters: values.get("cmi.suspend_data")?.length,
				}),
			);
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	},
);
