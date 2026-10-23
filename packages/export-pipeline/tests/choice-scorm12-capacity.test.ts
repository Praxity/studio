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
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import type { AssessmentBlockData, ChoiceResponse } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import {
	parseScorm12SuspendData,
	serializeScorm12SuspendData,
} from "../src/scorm/scorm12-suspend-data";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { Scorm12Runtime as MainScorm12Runtime } from "./fixtures/main-scorm12.fixture";
import { parseScorm12SuspendData as mainParse } from "./fixtures/main-scorm12-suspend-data.fixture";

const uuid = (seed: string) => {
	const hex = createHash("sha256").update(seed).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const questions = Array.from({ length: 60 }, (_, index) => {
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
	// Expected wire policy is independent of the production projection.
	const short = `s96:${Buffer.from(signature.slice(7), "hex").subarray(0, 12).toString("base64url")}`;
	return {
		id: uuid(`question-${index}`),
		facts,
		full,
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

it.each([1, 45])(
	"main's pinned parser and real adapter hold the versioned save at %i answers",
	(count) => {
		const selected = questions.slice(0, count);
		const raw = serializeScorm12SuspendData({
			visitedPages: [],
			interactions: selected.map((pair) => pair.row),
			custom: JSON.stringify({
				blockState: Object.fromEntries(selected.map((pair) => [pair.id, pair.state])),
			}),
		});
		expect(raw.length).toBeLessThanOrEqual(4096);
		expect(mainParse(raw)).toBeNull();
		expect(parseScorm12SuspendData(raw)).not.toBeNull();
		const values = new Map([
			["cmi.suspend_data", raw],
			["cmi.core.lesson_status", "passed"],
		]);
		const writes: string[][] = [];
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
					writes.push([key, value]);
					return "true";
				},
			},
		});
		vi.stubGlobal("window", dom.window);
		try {
			const runtime = new MainScorm12Runtime("course");
			expect(runtime.initialize()).toBe(true);
			const provider = createBlockStateRuntime(runtime);
			expect(runtime.getInteractions()).toEqual([]);
			expect(provider.get(selected[0].id)).toBeUndefined();
			provider.set(selected[0].id, selected[0].full as unknown as LearnerStateValue);
			expect(provider.getSaveResult?.(selected[0].id)).toEqual({
				status: "not-saved",
				code: "unreadable-state",
			});
			runtime.setCompletion("completed");
			runtime.setScore(100, 0, 100);
			runtime.trackObjective("g", 100, true);
			runtime.commit();
			expect(values.get("cmi.suspend_data")).toBe(raw);
			expect(
				writes.filter(([key]) =>
					/^(?:cmi\.suspend_data|cmi\.objectives\.|cmi\.core\.(?:score\.|lesson_status))/.test(key),
				),
			).toEqual([]);
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	},
);

it("saves at least 42 UUID originals with exact state and row equality after every reload", () => {
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
	vi.spyOn(Date, "now");
	try {
		const runtime = new Scorm12Runtime();
		expect(runtime.initialize()).toBe(true);
		const provider = createBlockStateRuntime(runtime);
		const facts = admitChoiceStateFacts({
			choiceStateQuestions: Object.fromEntries(
				questions.map((item) => [item.id, item.facts.question]),
			),
			choiceStateSignatures: Object.fromEntries(
				questions.map((item) => [item.id, item.facts.signature]),
			),
		});
		let accepted = 0;
		for (const pair of questions) {
			vi.mocked(Date.now).mockReturnValue(pair.row.timestamp);
			const before = values.get("cmi.suspend_data");
			const staged = provider.stageSubmission?.(pair.id, () => {
				provider.set(pair.id, pair.full as unknown as LearnerStateValue);
				return provider.getSaveResult?.(pair.id)?.status !== "not-saved";
			});
			let refused = !staged;
			if (staged) {
				try {
					runtime.trackInteraction(pair.id, pair.row.response, true, 100, {
						assessmentType: "choice",
						contentSignature: pair.facts.signature,
						attemptsUsed: 1,
						maxAttempts: 2,
					});
				} catch (error) {
					expect(String(error)).toContain("ESCORM12STORAGE");
					refused = true;
				}
			}
			if (refused) {
				expect(values.get("cmi.suspend_data")).toBe(before);
				expect(provider.getSaveResult?.(pair.id)?.status).toBe("not-saved");
				break;
			}
			accepted++;
			const reload = new Scorm12Runtime();
			expect(reload.initialize()).toBe(true);
			const restored = createBlockStateRuntime(reload);
			const rows = reload.getInteractions();
			expect(rows).toEqual(questions.slice(0, accepted).map((item) => item.row));
			const loaded = new Map(
				questions.slice(0, accepted).map((item) => [item.id, restored.get(item.id)]),
			);
			const view = createChoiceDependencyView(facts, { rows, readState: (id) => loaded.get(id) });
			for (const item of questions.slice(0, accepted)) {
				expect(loaded.get(item.id)).toEqual(item.state);
				expect(choiceDependencyStatus(item.id, view)).toBe("current");
			}
			expect(values.get("cmi.suspend_data")?.length).toBeLessThanOrEqual(4096);
			expect(JSON.parse(values.get("cmi.suspend_data") ?? "null")[0]).toBe("praxity-evidence-1");
		}
		console.info(
			"SCORM 1.2 UUID capacity",
			JSON.stringify({ accepted, characters: values.get("cmi.suspend_data")?.length }),
		);
		expect(accepted).toBeGreaterThanOrEqual(42);
		expect(accepted).toBeLessThan(questions.length);
	} finally {
		dom.window.close();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
});
