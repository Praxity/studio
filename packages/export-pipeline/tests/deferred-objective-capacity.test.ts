import { createHash } from "node:crypto";
import {
	choiceContentSignature,
	choiceStateQuestion,
} from "@praxity/shared-blocks/assessment-choice";
import { prepareChoiceAssessmentState } from "@praxity/shared-blocks/choice-learner-state";
import { writeLearnerBlockState } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import type { AssessmentBlockData, ChoiceResponse } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { scorm12CompactSuspendDataCodec as codec } from "../src/scorm/scorm12-suspend-data";
import { createDeferredGroupObjectiveWriter } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

vi.mock("../src/scorm/types", async (original) => {
	const types = await original<typeof import("../src/scorm/types")>();
	return { ...types, assessmentAttemptMetadata: types.assessmentEvidenceMetadata };
});

const uuid = (seed: string) => {
	const hex = createHash("sha256").update(seed).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const allOriginals = Array.from({ length: 42 }, (_, index) => {
	const data: AssessmentBlockData = {
		assessmentType: "choice",
		gradingMode: "exact",
		attempts: 2,
		feedback: {},
		stem: [
			{ id: "stem", type: "text", data: { content: `Choose safe procedure ${index}, revision 1` } },
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
	};
	const signature = choiceContentSignature(data, false);
	const facts = { question: choiceStateQuestion(data, false), signature };
	const answer = [(data.response as ChoiceResponse).options[0].id];
	const full = prepareChoiceAssessmentState(
		undefined,
		{
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 1,
			answer,
			checked: true,
			correct: true,
			completed: true,
			interacted: true,
		},
		facts,
		{ writtenAt: 100 + index },
	);
	const { materialProof: _proof, ...state } = full;
	const short = `s96:${Buffer.from(signature.slice(7), "hex").subarray(0, 12).toString("base64url")}`;
	return {
		id: uuid(`question-${index}`),
		facts,
		state: { ...state, contentSignature: short },
		row: {
			id: uuid(`question-${index}`),
			response: answer[0],
			correct: true,
			score: 100,
			contentSignature: short,
			attemptsUsed: 1,
			maxAttempts: 2,
			timestamp: 1760000000000 + index,
		},
	};
});
const originals = allOriginals.slice(0, 42);

it.each([0, 1, 2])("5: 42 originals and %i UUID obligations save or refuse atomically", (count) => {
	const values = new Map<string, string>();
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
				values.set(key, value);
				return "true";
			},
		},
	});
	vi.stubGlobal("window", dom.window);
	const now = vi.spyOn(Date, "now");
	try {
		const runtime = new Scorm12Runtime(undefined, codec);
		expect(runtime.initialize()).toBe(true);
		const provider = createBlockStateRuntime(runtime);
		Object.assign(dom.window, { __praxityBlockState: provider });
		const writer = createDeferredGroupObjectiveWriter(provider, () => true, {});
		expect(writer).toBeTypeOf("function");
		for (const item of originals) {
			now.mockReturnValue(item.row.timestamp);
			expect(
				provider.stageSubmission?.(item.id, () =>
					writeLearnerBlockState(
						item.id,
						item.state as LearnerStateValue,
						() => true,
						dom.window.document,
					),
				),
			).toBe(true);
			runtime.trackInteraction(item.id, item.row.response, true, 100, {
				assessmentType: "choice",
				contentSignature: item.row.contentSignature,
				attemptsUsed: 1,
				maxAttempts: 2,
			});
		}
		expect(values.get("cmi.suspend_data")?.length).toBe(3779);
		now.mockReturnValue(1760000000042);
		const savedGroups = new Map<string, LearnerStateValue | undefined>();
		for (let index = 0; index < count; index++) {
			const id = uuid(`group-${index}`);
			const contentSignature = `sha256:${createHash("sha256").update(`group-${index}`).digest("hex")}`;
			vi.spyOn(crypto, "randomUUID").mockReturnValue(
				uuid(`obligation-${index}`) as `${string}-${string}-${string}-${string}-${string}`,
			);
			const view = withChoiceDependencyStatus({
				rows: runtime.getInteractions(),
				questions: {},
				signatures: {},
				groups: {
					[id]: {
						mode: "all",
						memberIds: [originals[index].id],
						requiredIds: [originals[index].id],
					},
				},
				readState: (key) => provider.get(key),
			});
			writer?.(runtime, { kind: "waiting" }, view, {
				id,
				score: 100,
				passed: true,
				contentSignature,
			});
			const state = {
				version: 1,
				kind: "assessmentGroup",
				mode: "all",
				selectedMemberId: null,
				completed: true,
				submitted: {
					payload: {
						mode: "all",
						selectedMemberId: null,
						dependencies: [[originals[index].id, originals[index].state.contentSignature]],
					},
					contentSignature,
				},
			};
			const before = values.get("cmi.suspend_data");
			const rows = runtime.getInteractions();
			expect(
				provider.stageSubmission?.(id, () =>
					writeLearnerBlockState(id, state, () => true, dom.window.document),
				),
			).toBe(true);
			const report = () =>
				runtime.trackInteraction(id, "100%", true, 100, {
					memberIds: [originals[index].id],
					contentSignature,
				});
			if (index === 1) {
				expect(report).toThrow("ESCORM12STORAGE");
				expect(values.get("cmi.suspend_data")).toBe(before);
				expect(runtime.getInteractions()).toEqual(rows);
				for (const [group, saved] of savedGroups) expect(provider.get(group)).toEqual(saved);
				expect(provider.getSaveResult?.(id)).toEqual({
					status: "not-saved",
					code: "runtime-write-failed",
				});
			} else {
				report();
				expect(values.get("cmi.suspend_data")?.length).toBe(4059);
				savedGroups.set(id, provider.get(id));
			}
		}
		expect(runtime.commit()).toBe(true);
		const reload = new Scorm12Runtime(undefined, codec);
		expect(reload.initialize()).toBe(true);
		const restored = createBlockStateRuntime(reload);
		expect(reload.getInteractions().slice(0, 42)).toEqual(originals.map((item) => item.row));
		for (const item of originals) expect(restored.get(item.id)).toEqual(item.state);
		for (const [group, saved] of savedGroups) expect(restored.get(group)).toEqual(saved);
		expect(reload.getSuspendData()).not.toContain("objectiveSequence");
		if (count === 0) expect(reload.getSuspendData()).not.toContain("deferredObjective");
	} finally {
		dom.window.close();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
});
