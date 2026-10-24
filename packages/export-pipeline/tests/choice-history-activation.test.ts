// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import {
	choiceContentSignature,
	choiceStateQuestion,
	DONT_KNOW,
} from "@praxity/shared-blocks/assessment-choice";
import { prepareChoiceAssessmentState } from "@praxity/shared-blocks/choice-learner-state";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import type { AssessmentBlockData, ChoiceResponse } from "@praxity/shared-blocks/types";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { PreviewAssessmentBlock } from "../../shared-blocks/src/blocks/AssessmentBlock";
import { LocaleContext } from "../../shared-blocks/src/i18n/locale-context";
import type { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { initializeScorm12Host } from "../template/src/hosts/scorm12";
import { initializeScorm2004Host } from "../template/src/hosts/scorm2004";
import { initializeStandaloneHost } from "../template/src/hosts/standalone";
import { initializeXapiHost } from "../template/src/hosts/xapi";

const formats = ["scorm12", "scorm2004", "xapi", "standalone"] as const;
type Format = (typeof formats)[number];
const data: AssessmentBlockData = {
	assessmentType: "choice",
	gradingMode: "exact",
	points: 10,
	attempts: 2,
	feedback: {},
	stem: [{ id: "stem", type: "text", data: { content: "Choose an action" } }],
	response: {
		type: "choice",
		selectionMode: "single",
		shuffle: false,
		inputMethod: "click",
		display: "list",
		options: [
			{ id: "a", label: "Stop", isCorrect: true },
			{ id: "b", label: "Continue" },
		],
	},
};
const facts = (value = data) => ({
	question: choiceStateQuestion(value, value._dontKnow === true),
	signature: choiceContentSignature(value, value._dontKnow === true),
});
const submitted = (value = data, answer = ["a"], correct = true) =>
	prepareChoiceAssessmentState(
		undefined,
		{
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 1,
			checked: true,
			correct,
			completed: correct,
			interacted: true,
			answer,
			reviewedChoiceIds: answer,
		},
		facts(value),
		{ writtenAt: 1 },
	);
let root: Root | undefined;
const nativeAdd = document.addEventListener.bind(document);
const nativeRemove = document.removeEventListener.bind(document);
let listeners: Array<Parameters<Document["addEventListener"]>> = [];

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("__praxityPrivateState", true);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("", { status: 200 })),
	);
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.spyOn(document, "addEventListener").mockImplementation((...args) => {
		listeners.push(args);
		nativeAdd(...args);
	});
	Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value() {},
	});
});
afterEach(async () => {
	if (root) await act(() => root?.unmount());
	root = undefined;
	for (const [name, listener, options] of listeners) nativeRemove(name, listener, options);
	listeners = [];
	for (const key of [
		"__praxityHostStarted",
		"__praxityBlockState",
		"__praxityRuntime",
		"__praxityTracker",
		"__praxityFinishCourse",
		"API",
		"API_1484_11",
	] as const)
		delete (window as unknown as Record<string, unknown>)[key];
	localStorage.clear();
	sessionStorage.clear();
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function launch(
	format: Format,
	value = data,
	values = new Map<string, string>(),
	privateChoice = false,
	scoredAssessmentIds = ["q"],
	extraConfig: Record<string, unknown> = {},
) {
	for (const [name, listener, options] of listeners) nativeRemove(name, listener, options);
	listeners = [];
	delete (window as unknown as Record<string, unknown>).__praxityHostStarted;
	const pair = facts(value);
	const config = {
		version: 1,
		courseId: "activation",
		pageId: "page",
		pageTitle: "Practice",
		currentPage: 1,
		totalPages: 2,
		currentSlug: "practice",
		availableSlugs: ["practice"],
		pageIdMap: { page: "practice" },
		completionMethod: "allPages",
		pageRole: "content",
		strings: {},
		passMark: 70,
		scoredAssessmentIds,
		choiceStateQuestions: { q: pair.question },
		choiceStateSignatures: { q: pair.signature },
		...(privateChoice ? { blockStatePolicy: { q: "device" } } : {}),
		...extraConfig,
	};
	document.body.innerHTML = `<script id="praxity-host-config" type="application/json">${JSON.stringify(config)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format, ...(format === "xapi" ? { xapiConfig: { endpoint: "https://lrs.example/xapi/", auth: "test", actorMode: "manual", actor: { name: "Learner", mbox: "mailto:learner@example.com" } } } : {}) })}</script><main id="mount"></main>`;
	const writes: string[][] = [];
	let refuseSaves = false;
	const get = (key: string) => values.get(key) ?? "";
	const set = (key: string, text: string) => {
		writes.push([key, text]);
		if (refuseSaves && key === "cmi.suspend_data") return "false";
		values.set(key, text);
		return "true";
	};
	const api = {
		LMSInitialize: () => "true",
		LMSFinish: () => "true",
		LMSCommit: () => "true",
		LMSGetValue: get,
		LMSSetValue: set,
		LMSGetLastError: () => "0",
		LMSGetErrorString: () => "",
		LMSGetDiagnostic: () => "",
	};
	Object.assign(window, {
		API: api,
		API_1484_11: {
			Initialize: api.LMSInitialize,
			Terminate: api.LMSFinish,
			Commit: api.LMSCommit,
			GetValue: get,
			SetValue: set,
			GetLastError: api.LMSGetLastError,
			GetErrorString: api.LMSGetErrorString,
			GetDiagnostic: api.LMSGetDiagnostic,
		},
	});
	expect(
		{
			scorm12: initializeScorm12Host,
			scorm2004: initializeScorm2004Host,
			xapi: initializeXapiHost,
			standalone: initializeStandaloneHost,
		}[format](),
	).toBe(true);
	const provider = window.__praxityBlockState as LearnerBlockStateRuntime;
	const runtime = window.__praxityRuntime as SCORMRuntime;
	return {
		provider,
		runtime,
		values,
		writes,
		pair,
		refuseSaves: () => {
			refuseSaves = true;
		},
	};
}
function seed(host: ReturnType<typeof launch>, value = data, answer = ["a"], correct = true) {
	const state = prepareChoiceAssessmentState(
		host.provider.get("q"),
		submitted(value, answer, correct),
		facts(value),
		{ writtenAt: 1 },
	);
	expect(
		host.provider.stageSubmission?.("q", () => {
			host.provider.set("q", state as unknown as LearnerStateValue);
			return true;
		}) ?? host.provider.set("q", state as unknown as LearnerStateValue),
	).not.toBe(false);
	host.runtime.trackInteraction("q", answer.join(","), correct, correct ? 100 : 0, {
		assessmentType: "choice",
		contentSignature: facts(value).signature,
		attemptsUsed: 1,
		maxAttempts: 2,
	});
	return state;
}
async function mount(value: AssessmentBlockData, locale = "en") {
	root = createRoot(document.getElementById("mount")!);
	await act(() =>
		root?.render(
			createElement(
				MantineProvider,
				{},
				createElement(
					LocaleContext.Provider,
					{ value: locale },
					createElement(PreviewAssessmentBlock, {
						blockId: "q",
						data: value,
						compiledChoiceFacts: facts(value),
					}),
				),
			),
		),
	);
}
const button = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(node) => node.textContent === text,
	)!;
async function click(node: HTMLElement) {
	expect(node).toBeTruthy();
	await act(() => node.click());
}

it.each(formats)(
	"%s binds live evidence and reloads an unchanged answer, verdict, attempt and signed row",
	(format) => {
		const first = launch(format);
		const state = seed(first);
		const rows = first.runtime.getInteractions();
		expect(first.provider.getChoiceDependencyView?.()?.status("q")).toBe("current");
		const second = launch(format, data, first.values);
		expect(second.provider).not.toBe(first.provider);
		expect(second.provider.get("q")).toEqual(state);
		expect(second.runtime.getInteractions()).toEqual(rows);
		expect(rows[0]).toMatchObject({
			contentSignature: facts().signature,
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		expect(second.provider.getChoiceDependencyView?.()?.status("q")).toBe("current");
	},
);

const edits: Array<[string, (copy: AssessmentBlockData) => void]> = [
	[
		"stem",
		(copy) => {
			copy.stem = [{ id: "stem", type: "text", data: { content: "Revised action" } }];
		},
	],
	[
		"correct set",
		(copy) => {
			(copy.response as ChoiceResponse).options[0].isCorrect = false;
			(copy.response as ChoiceResponse).options[1].isCorrect = true;
		},
	],
	[
		"points",
		(copy) => {
			copy.points = 20;
		},
	],
	[
		"attempts",
		(copy) => {
			copy.attempts = 3;
		},
	],
	[
		"option UUID",
		(copy) => {
			(copy.response as ChoiceResponse).options[0].id = "replacement";
		},
	],
	[
		"image",
		(copy) => {
			(copy.response as ChoiceResponse).options[0].label =
				'Stop <img src="changed.png" alt="Signal">';
		},
	],
	[
		"icon",
		(copy) => {
			(copy.response as ChoiceResponse).options[0].label = ":icon[check] Stop";
		},
	],
	[
		"distractor",
		(copy) => {
			(copy.response as ChoiceResponse).options.push({ id: "c", label: "Wait" });
		},
	],
];
it.each(formats.flatMap((format) => edits.map(([name, edit]) => ({ format, name, edit }))))(
	"$format $name edit retains history and gives usable recovery",
	async ({ format, edit }) => {
		const first = launch(format);
		const state = seed(first);
		const changed = structuredClone(data);
		edit(changed);
		const next = launch(format, changed, first.values);
		expect(next.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
		await mount(changed);
		expect(button("New attempt")).toBeTruthy();
		expect(
			[...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(
				(node) => node.disabled,
			),
		).toBe(true);
		expect(next.provider.get("q")).toEqual(state);
		await click(button("New attempt"));
		expect(document.activeElement).toBe(document.querySelector('input[type="radio"]'));
		expect(next.provider.get("q")).toEqual(state);
	},
);

it.each(formats)(
	"%s unsigned submissions require recovery while history preserves 33.33/fail through commits and Finish",
	async (format) => {
		const first = launch(format);
		const unsigned = submitted();
		delete unsigned.contentSignature;
		first.provider.set("q", unsigned as unknown as LearnerStateValue);
		first.runtime.trackInteraction("q", "old", false, 0);
		first.runtime.trackInteraction("wrong", "wrong", false, 0);
		first.runtime.trackInteraction("right", "right", true, 100);
		const next = launch(format, data, first.values, false, ["q", "wrong", "right"]);
		expect(next.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
		await mount(data);
		expect(button("New attempt")).toBeTruthy();
		const tracker = window.__praxityTracker as CourseTracker;
		const before = tracker.outcome();
		if (format !== "standalone") {
			expect(before?.result?.score).toBeCloseTo(33.33);
			expect(before?.result?.passed).toBe(false);
		}
		expect(next.runtime.getInteractions().map((row) => row.score)).toEqual([0, 0, 100]);
		tracker.trackInteraction("optional", "yes", true, 100);
		next.runtime.setSuspendData(next.runtime.getSuspendData() ?? "{}");
		next.runtime.commit();
		await click(button("New attempt"));
		await click(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]);
		expect(tracker.outcome()).toEqual(before);
		if (format !== "standalone") expect(next.runtime.getScore()?.raw).toBeCloseTo(33.33);
		expect(next.runtime.terminate(true)).toBe(true);
	},
);

it.each(
	(["en", "fr"] as const).flatMap((locale) =>
		["single", "multiple", "dontKnow"].map((variant) => ({ locale, variant })),
	),
)(
	"production $locale $variant recovery drafts reload and resubmission can lower a pass",
	async ({ locale, variant }) => {
		const original = structuredClone(data);
		original._dontKnow = variant === "dontKnow";
		if (variant === "multiple") (original.response as ChoiceResponse).selectionMode = "multiple";
		const first = launch("scorm12", original);
		const state = seed(first, original);
		const changed = { ...original, points: 20 };
		let next = launch("scorm12", changed, first.values);
		await mount(changed, locale);
		const bytes = first.values.get("cmi.suspend_data");
		// Native disabled controls and absent Submit cover the pending-review triggers.
		await click(document.querySelectorAll<HTMLInputElement>("input")[0]);
		expect(button(locale === "en" ? "Submit" : "Soumettre")).toBeUndefined();
		expect(first.values.get("cmi.suspend_data")).toBe(bytes);
		await click(button(locale === "en" ? "New attempt" : "Nouvelle tentative"));
		const target = variant === "dontKnow" ? DONT_KNOW : "b";
		await click(
			[...document.querySelectorAll<HTMLInputElement>("input")].find(
				(node) => node.value === target,
			)!,
		);
		const draft = next.provider.get("q");
		expect(draft).toMatchObject({ checked: false, answer: [target], history: [state] });
		expect(next.runtime.getInteractions()[0].score).toBe(100);
		await act(() => root?.unmount());
		root = undefined;
		next = launch("scorm12", changed, first.values);
		await mount(changed, locale);
		expect(next.provider.get("q")).toEqual(draft);
		expect(
			[...document.querySelectorAll<HTMLInputElement>("input")]
				.filter((node) => node.checked)
				.map((node) => node.value),
		).toEqual([target]);
		await click(button(locale === "en" ? "Submit" : "Soumettre"));
		expect(next.provider.get("q")).toMatchObject({
			attemptCount: 1,
			checked: true,
			correct: false,
			history: [state],
		});
		expect(next.runtime.getInteractions().at(-1)).toMatchObject({
			score: 0,
			contentSignature: facts(changed).signature,
		});
		expect(next.runtime.getScore()?.raw).toBe(0);
	},
);

it.each(formats)(
	"%s private choice history uses device evidence and never reports its answer",
	(format) => {
		const first = launch(format, data, new Map(), true);
		first.provider.set("q", submitted() as unknown as LearnerStateValue);
		expect(first.provider.getChoiceDependencyView?.()?.status("q")).toBe("current");
		const next = launch(format, { ...data, points: 20 }, first.values, true);
		expect(next.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
		expect(next.runtime.getInteractions()).toEqual([]);
	},
);

it("xAPI retains a rejected latest signed row across persistence without reviving the earlier pass", () => {
	const first = launch("xapi");
	seed(first);
	const key = Object.keys(localStorage).find((key) => key.startsWith("praxity-xapi:"))!;
	const stored = JSON.parse(localStorage.getItem(key)!);
	stored.interactions.push({ id: "q", response: null, contentSignature: "broken" });
	localStorage.setItem(key, JSON.stringify(stored));
	const next = launch("xapi");
	expect(next.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
	next.runtime.commit();
	const reload = launch("xapi");
	expect(reload.runtime.getInteractionEvidence?.()?.at(-1)).toMatchObject({
		id: "q",
		response: null,
		choiceEvidenceInvalid: true,
	});
	expect(reload.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
});

it("unidentifiable signed evidence refuses the complete view through the real xAPI host", () => {
	const first = launch("xapi");
	seed(first);
	const key = Object.keys(localStorage).find((key) => key.startsWith("praxity-xapi:"))!;
	const stored = JSON.parse(localStorage.getItem(key)!);
	stored.interactions.push({ response: "a", contentSignature: facts().signature });
	localStorage.setItem(key, JSON.stringify(stored));
	const next = launch("xapi");
	expect(next.runtime.getInteractionEvidence?.()).toBeNull();
	expect(next.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
});

it.each([false, true].flatMap((history) => [false, true].map((frozen) => ({ history, frozen }))))(
	"actual host codec retains originals and refuses atomically, history $history frozen $frozen",
	({ history, frozen }) => {
		if (frozen) {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
		}
		const uuid = (seed: string) => {
			const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		};
		const questions = Array.from({ length: 100 }, (_, index) => {
			const value = structuredClone(data);
			value.stem = [{ id: "stem", type: "text", data: { content: `material-${index}` } }];
			(value.response as ChoiceResponse).options.forEach((option, i) => {
				option.id = uuid(`option-${index}-${i}`);
			});
			return { id: uuid(`question-${index}`), value, pair: facts(value), index };
		});
		const config = {
			deferVisits: true,
			choiceStateQuestions: Object.fromEntries(
				questions.map(({ id, pair }) => [id, pair.question]),
			),
			choiceStateSignatures: Object.fromEntries(
				questions.map(({ id, pair }) => [id, pair.signature]),
			),
		};
		let host = launch("scorm12", data, new Map(), false, [], config);
		const saved = new Map<string, unknown>();
		let at42 = 0,
			refusedLength = 0;
		try {
			for (const { id, value, pair, index } of questions) {
				const selected = (value.response as ChoiceResponse).options[0].id;
				const state = { ...submitted(value, [selected]), writtenAt: index + 1 };
				const next = {
					...state,
					...(history
						? {
								history: [
									{ ...state, contentSignature: facts({ ...value, points: 20 }).signature },
								],
							}
						: {}),
				};
				const bytes = host.values.get("cmi.suspend_data");
				host.writes.length = 0;
				expect(
					host.provider.stageSubmission?.(id, () => {
						host.provider.set(id, next as unknown as LearnerStateValue);
						return true;
					}),
				).toBe(true);
				try {
					host.runtime.trackInteraction(id, "action-0", true, 100, {
						assessmentType: "choice",
						contentSignature: pair.signature,
						attemptsUsed: 1,
						maxAttempts: 2,
					});
				} catch (error) {
					expect(String(error)).toContain("ESCORM12STORAGE");
					refusedLength = Number(String(error).match(/limit: (\d+)/)?.[1]);
					expect(host.values.get("cmi.suspend_data")).toBe(bytes);
					expect(host.writes).toEqual([]);
					expect(host.provider.get(id)).toBeUndefined();
					expect(host.provider.getSaveResult?.(id)?.status).toBe("not-saved");
					break;
				}
				saved.set(id, next);
				if (saved.size === 42) {
					at42 = host.values.get("cmi.suspend_data")!.length;
					host = launch("scorm12", data, host.values, false, [], config);
					for (const [key, expected] of saved) {
						expect(host.provider.get(key)).toEqual(expected);
						expect(host.provider.getChoiceDependencyView?.()?.status(key)).toBe("current");
					}
				}
			}
			expect(refusedLength).toBeGreaterThan(4096);
			if (!history) expect(saved.size).toBeGreaterThanOrEqual(42);
			const wire = host.values.get("cmi.suspend_data")!;
			expect(wire.length).toBeLessThanOrEqual(4096);
			expect(wire[0]).toBe("[");
			host = launch("scorm12", data, host.values, false, [], config);
			for (const [id, expected] of saved) {
				expect(host.provider.get(id)).toEqual(expected);
				expect(host.provider.getChoiceDependencyView?.()?.status(id)).toBe("current");
			}
			expect(host.runtime.getInteractions()).toHaveLength(saved.size);
			if (process.env.PRAXITY_CAPACITY_REPORT)
				appendFileSync(
					process.env.PRAXITY_CAPACITY_REPORT,
					`${JSON.stringify({ history, frozen, accepted: saved.size, firstRefused: saved.size + 1, lastWire: wire.length, at42, spareAt42: at42 ? 4096 - at42 : null, refusedLength })}\n`,
				);
		} finally {
			vi.useRealTimers();
		}
	},
);

it.each(["all", "oneOf"] as const)(
	"production %s group capture keeps history until deliberate resubmission and rejects forgery",
	(mode) => {
		let host = launch("scorm12", data, new Map(), false, ["g"], {
			blockStatePolicy: { r: "device" },
			choiceStateGroups: { g: { mode, memberIds: ["q", "r"], requiredIds: ["q", "r"] } },
		});
		seed(host);
		host.provider.set("r", {
			version: 1,
			kind: "assessment",
			assessmentType: "textResponse",
			checked: true,
			completed: true,
			correct: false,
			interacted: true,
			answer: "private",
			attemptCount: 1,
		});
		const capture = (selectedMemberId: string | null, forge = false, refused = false) => {
			const state = {
				version: 1,
				kind: "assessmentGroup",
				mode,
				selectedMemberId,
				completed: true,
			};
			const view = host.provider.getChoiceDependencyView?.();
			assert(view);
			const candidate = view.prepareGroupSubmission?.("g", {
				...view,
				readState: (id) => (id === "g" ? state : view.readState(id)),
			});
			assert(candidate);
			expect(
				host.provider.stageSubmission?.("g", () => {
					host.provider.set("g", {
						...state,
						submitted: candidate,
					} as unknown as LearnerStateValue);
					return true;
				}),
			).toBe(true);
			if (refused) host.refuseSaves();
			const accepted = document.dispatchEvent(
				new CustomEvent("praxity:assessment-group-complete", {
					bubbles: true,
					cancelable: true,
					detail: {
						groupId: "g",
						completed: true,
						correct: true,
						passed: true,
						score: 100,
						selectedMemberId,
						memberIds: mode === "oneOf" ? [selectedMemberId] : ["q"],
						contentSignature: forge ? "s96:AAAAAAAAAAAAAAAA" : candidate.contentSignature,
					},
				}),
			);
			expect(accepted).toBe(!forge && !refused);
			return candidate;
		};
		const first = capture(mode === "oneOf" ? "q" : null);
		expect(first.payload.dependencies.map(([id]) => id)).toEqual(
			mode === "all" ? ["q", "r"] : ["q"],
		);
		expect(host.provider.getChoiceDependencyView?.()?.status("g")).toBe("current");
		const old = host.provider.get("g");
		const rows = host.runtime.getInteractions();
		capture(mode === "oneOf" ? "q" : null, true);
		expect(host.runtime.getInteractions()).toEqual(rows);
		// Reopen with changed material, then repair only the member.
		const changed = { ...data, points: 20 };
		host = launch("scorm12", changed, host.values, false, ["g"], {
			blockStatePolicy: { r: "device" },
			choiceStateGroups: { g: { mode, memberIds: ["q", "r"], requiredIds: ["q", "r"] } },
		});
		expect(host.provider.getChoiceDependencyView?.()?.status("g")).toBe("history");
		seed(host, changed);
		expect(host.provider.get("g")).toEqual(old);
		expect(host.provider.getChoiceDependencyView?.()?.status("g")).toBe("history");
		expect(
			host.runtime
				.getInteractions()
				.reverse()
				.find((row) => row.id === "g")?.score,
		).toBe(100);
		capture(mode === "oneOf" ? "q" : null);
		expect(host.provider.getChoiceDependencyView?.()?.status("g")).toBe("current");
		if (mode === "oneOf") {
			capture("r");
			capture("q");
			expect(host.provider.getChoiceDependencyView?.()?.status("g")).toBe("current");
		}
		const bytes = host.values.get("cmi.suspend_data");
		const previous = host.provider.get("g");
		const previousRows = host.runtime.getInteractions();
		capture(mode === "oneOf" ? "q" : null, false, true);
		expect(host.values.get("cmi.suspend_data")).toBe(bytes);
		expect(host.provider.get("g")).toEqual(previous);
		expect(host.runtime.getInteractions()).toEqual(previousRows);
	},
);

it.each(["scorm12", "scorm2004"] as const)(
	"%s actual host retains the rejected latest row as history",
	(format) => {
		const first = launch(format);
		seed(first);
		const payload = JSON.parse(first.values.get("cmi.suspend_data")!);
		payload.interactions.push({ ...payload.interactions[0], response: null });
		first.values.set("cmi.suspend_data", JSON.stringify(payload));
		const next = launch(format, data, first.values);
		expect(next.provider.getChoiceDependencyView?.()?.rows.at(-1)?.choiceEvidenceInvalid).toBe(
			true,
		);
		expect(next.provider.getChoiceDependencyView?.()?.status("q")).toBe("history");
	},
);
