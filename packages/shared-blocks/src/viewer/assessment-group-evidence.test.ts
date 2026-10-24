import { afterEach, expect, it, vi } from "vitest";
import type { ChoiceDependencyEvidence, ChoiceDependencyView } from "../choice-learner-state";
import * as choiceOwner from "../choice-learner-state";
import type { ChoiceStateQuestion } from "../choice-state-facts";
import { getStrings } from "../i18n/strings";
import type { LearnerStateValue } from "../learner-state";
import type { PraxityBlock } from "../types";
import { initAssessmentGroups } from "./assessment-group-runtime";

const disposals: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
	document.body.replaceChildren();
	delete window.__praxityBlockState;
});

function mount(
	mode: "all" | "oneOf",
	evidence = true,
	locale = "en",
	summary = true,
	listed = true,
) {
	const values = new Map<string, LearnerStateValue>();
	const rows: ChoiceDependencyView["rows"][number][] = [];
	const events: string[] = [];
	const questions: Record<string, ChoiceStateQuestion> = {};
	const signatures: Record<string, string> = {};
	const view = (): ChoiceDependencyEvidence => {
		const input: ChoiceDependencyView = {
			questions,
			signatures,
			rows,
			groups: listed ? { g: { mode, memberIds: ["a", "b"], requiredIds: ["a", "b"] } } : {},
			readState: (id) => values.get(id),
		};
		// Base replay injects only the owner API already present on that revision.
		return Object.hasOwn(choiceOwner, "bindChoiceDependencyView")
			? choiceOwner.bindChoiceDependencyView(input)
			: {
					...input,
					status: (id, candidate = input) => choiceOwner.choiceDependencyStatus(id, candidate),
					prepareGroupSubmission: choiceOwner.prepareChoiceGroupSubmission,
				};
	};
	window.__praxityBlockState = {
		get: (id) => values.get(id),
		set: (id, value) => {
			values.set(id, value);
			events.push("save");
		},
		...(evidence ? { getChoiceDependencyView: view } : {}),
	};
	const blocks = [
		{
			id: "g",
			type: "assessmentGroup",
			data: { mode, memberBlockIds: ["a", "b"], showResultsSummary: summary },
		},
		{ id: "a", type: "assessment", data: { gradingMode: "exact" } },
		{ id: "b", type: "assessment", data: { gradingMode: "none", required: true } },
	] as PraxityBlock[];
	const render = async () => {
		document.body.innerHTML = ["a", "b"]
			.map(
				(id) =>
					`<div class="praxity-block" data-block-id="${id}"><div class="praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard" data-assessment-answered="true" data-completed="true"${id === "a" ? ' data-result="correct" data-score="100" data-max-score="100" data-passed="true"' : ""}><p class="praxity-assessment-stem">Question ${id}</p><input type="radio" aria-label="Answer ${id}"><button data-assessment-submit="true">Submit</button></div></div>`,
			)
			.join("");
		disposals.push(
			initAssessmentGroups({ blocks, root: document.body, labels: getStrings(locale) }),
		);
		await vi.waitFor(() =>
			expect(document.querySelector("[data-assessment-group-submit]")).not.toBeNull(),
		);
	};
	const complete = (event: Event) => {
		events.push("interaction");
		const detail = (event as CustomEvent).detail;
		rows.push({
			id: "g",
			contentSignature: detail.contentSignature,
			correct: detail.correct,
			memberIds: detail.memberIds,
		});
	};
	document.addEventListener("praxity:assessment-group-complete", complete);
	disposals.push(() => document.removeEventListener("praxity:assessment-group-complete", complete));
	return { values, rows, events, view, render, questions, signatures, blocks };
}

it("without a view keeps the ordinary event-before-save log and unsigned envelope", async () => {
	const { values, events, render } = mount("all", false);
	values.set("g", {
		version: 1,
		kind: "assessmentGroup",
		mode: "all",
		selectedMemberId: null,
		completed: false,
		submitted: { retained: true },
	});
	await render();
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(values.get("g")).toEqual({
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: true,
		}),
	);
	expect(events).toEqual(["interaction", "save"]);
	expect(window.__praxityBlockState?.getSaveResult).toBeUndefined();
});

it("a group absent from the view keeps the ordinary event-before-save log and envelope", async () => {
	const { values, events, render } = mount("all", true, "en", true, false);
	await render();
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(values.get("g")).toEqual({
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: true,
		}),
	);
	expect(events).toEqual(["interaction", "save"]);
});

it("reports the second oneOf member and its captured digest", async () => {
	const { render } = mount("oneOf");
	const details: unknown[] = [];
	const observe = (event: Event) => details.push((event as CustomEvent).detail);
	document.addEventListener("praxity:assessment-group-complete", observe);
	disposals.push(() => document.removeEventListener("praxity:assessment-group-complete", observe));
	await render();
	document.querySelector<HTMLInputElement>('.praxity-ag-radio[value="b"]')?.click();
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(details).toEqual([
			expect.objectContaining({
				selectedMemberId: "b",
				contentSignature: "s96:gWS7c7A-PLTQRw-K",
			}),
		]),
	);
});

it("captures the full dependency set, including the unscored required member", async () => {
	const { values, events, render } = mount("all");
	await render();
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(values.get("g")).toEqual({
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: true,
			submitted: {
				payload: {
					mode: "all",
					selectedMemberId: null,
					dependencies: [
						["a", null],
						["b", null],
					],
				},
				contentSignature: "s96:sErDt8ncF-9UJSw5",
			},
		}),
	);
	expect(events).toEqual(["interaction", "save"]);
});

it("retains the latest capture through A/B/A picker changes and retry remounts", async () => {
	const { values, rows, view, render } = mount("oneOf");
	const captureA = {
		payload: { mode: "oneOf", selectedMemberId: "a", dependencies: [["a", null]] },
		contentSignature: "s96:D37qXOi4dR63CRQN",
	};
	const captureB = {
		payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["b", null]] },
		contentSignature: "s96:gWS7c7A-PLTQRw-K",
	};
	rows.push(
		{ id: "g", contentSignature: captureA.contentSignature },
		{ id: "g", contentSignature: captureB.contentSignature },
	);
	values.set("g", {
		version: 1,
		kind: "assessmentGroup",
		mode: "oneOf",
		selectedMemberId: "b",
		completed: false,
		submitted: captureB,
	} as LearnerStateValue);
	await render();
	document.querySelector<HTMLInputElement>('.praxity-ag-radio[value="a"]')?.click();
	expect(values.get("g")).toEqual({
		version: 1,
		kind: "assessmentGroup",
		mode: "oneOf",
		selectedMemberId: "a",
		completed: false,
		submitted: captureB,
	});
	expect(view().status("g")).toBe("history");
	disposals.pop()?.();
	await render();
	expect(document.querySelector(".praxity-ag-results-score")).toBeNull();
	expect(values.get("g")).toHaveProperty("submitted", captureB);
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(values.get("g")).toHaveProperty("submitted", captureA));
	expect(view().status("g")).toBe("current");
});

it("keeps saved aggregate completion and capture when repaired members leave it in history", async () => {
	const { values, rows, view, render, questions, signatures } = mount("all");
	questions.a = {
		selectionMode: "single",
		dontKnow: false,
		canAutoScore: true,
		graded: true,
		maxAttempts: 2,
		correctAnswerSignature:
			"sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
		materialSignature: `sha256:${"d".repeat(64)}`,
		options: [
			{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
			{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
		],
	};
	signatures.a = "sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702";
	values.set("a", {
		version: 1,
		kind: "assessment",
		assessmentType: "choice",
		checked: true,
		correct: true,
		completed: true,
		interacted: true,
		attemptCount: 1,
		answer: ["a"],
		contentSignature: "s96:sbdPqYwmkJdFli-m",
	});
	rows.push({ id: "a", correct: true, contentSignature: "s96:sbdPqYwmkJdFli-m" });
	const old = {
		payload: {
			mode: "all",
			selectedMemberId: null,
			dependencies: [
				["a", "s96:u7u7u7u7u7u7u7u7"],
				["b", null],
			],
		},
		contentSignature: "s96:b1vAwr1Bcn89DosW",
	};
	values.set("g", {
		version: 1,
		kind: "assessmentGroup",
		mode: "all",
		selectedMemberId: null,
		completed: true,
		submitted: old,
	} as LearnerStateValue);
	rows.push({ id: "g", contentSignature: old.contentSignature });
	expect(view().status("a")).toBe("current");
	expect(view().status("g")).toBe("history");
	await render();
	expect(document.querySelector(".praxity-ag-results-score")?.textContent).toBe(
		"1 of 1 correct \u00b7 Score: 100% - Passed",
	);
	expect(values.get("g")).toMatchObject({ completed: true, submitted: old });
	expect(view().status("g")).toBe("history");
	expect(document.querySelector(".praxity-ag-submit-btn")).toBeNull();
});

it("stages its captured answer before reporting and avoids a duplicate save", async () => {
	const { events, render } = mount("oneOf");
	const stage = vi.fn((_id: string, write: () => boolean) => write());
	Object.assign(window.__praxityBlockState as object, { stageSubmission: stage });
	await render();
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce());
	expect(events).toEqual(["save", "interaction"]);
});

for (const refusal of [
	"member-history",
	"stage-refused",
	"report-refused",
	"report-pending",
	"report-rejected",
	"unstaged-report-rejected",
	"preparation-unavailable",
] as const) {
	for (const locale of ["en", "fr"]) {
		it(`${locale} ${refusal} keeps the picker and submit action available`, async () => {
			const { render, view, events } = mount("oneOf", true, locale);
			const provider = window.__praxityBlockState;
			Object.assign(provider as object, {
				getChoiceDependencyView:
					refusal === "member-history"
						? () => ({ ...view(), invalidIds: ["a"] })
						: refusal === "preparation-unavailable"
							? () => ({ ...view(), prepareGroupSubmission: undefined })
							: view,
				stageSubmission:
					refusal === "stage-refused"
						? () => false
						: refusal === "unstaged-report-rejected"
							? undefined
							: (_id: string, write: () => boolean) => write(),
				getSaveResult: () =>
					events.includes("interaction") && refusal !== "report-pending"
						? { status: "not-saved", code: "runtime-write-failed" }
						: { status: "pending" },
			});
			if (refusal === "report-rejected" || refusal === "unstaged-report-rejected") {
				const reject = (event: Event) => event.preventDefault();
				document.addEventListener("praxity:assessment-group-complete", reject);
				disposals.push(() =>
					document.removeEventListener("praxity:assessment-group-complete", reject),
				);
				Object.assign(provider as object, { getSaveResult: () => undefined });
			}
			await render();
			document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(document.querySelector<HTMLInputElement>(".praxity-ag-radio")).not.toBeDisabled();
			expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
			expect(document.querySelector(".praxity-ag-results-score")).toBeNull();
			if (
				[
					"report-refused",
					"report-pending",
					"report-rejected",
					"unstaged-report-rejected",
					"stage-refused",
				].includes(refusal)
			) {
				expect(events).toEqual(
					refusal === "stage-refused"
						? []
						: refusal === "unstaged-report-rejected"
							? ["interaction"]
							: ["save", "interaction"],
				);
				expect(document.querySelector("[data-assessment-group-status]")?.textContent).toBe(
					locale === "fr"
						? "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée."
						: "This answer could not be saved. Your previously saved progress is kept.",
				);
				expect(document.querySelector("[data-assessment-group-status]")).not.toHaveClass(
					"praxity-sr-only",
				);
			} else expect(events).toEqual([]);
		});
	}
}

for (const locale of ["en", "fr"]) {
	it(`${locale} an ungraded all-group refusal cannot become a partial-save success`, async () => {
		const { blocks, events, render } = mount("all", true, locale);
		blocks[1].data.gradingMode = "none";
		Object.assign(window.__praxityBlockState as object, {
			stageSubmission: (_id: string, write: () => boolean) => write(),
		});
		const reject = (event: Event) => event.preventDefault();
		document.addEventListener("praxity:assessment-group-complete", reject);
		disposals.push(() => document.removeEventListener("praxity:assessment-group-complete", reject));
		await render();
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		await vi.waitFor(() =>
			expect(document.querySelector("[data-assessment-group-status]")?.textContent).toBe(
				locale === "fr"
					? "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée."
					: "This answer could not be saved. Your previously saved progress is kept.",
			),
		);
		expect(events).toEqual(["save", "interaction"]);
		expect(document.querySelector("[data-assessment-group-results]")?.textContent).toBe("");
		expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	});
}

it("clears the visible oneOf refusal when the learner retries successfully", async () => {
	const { render } = mount("oneOf");
	let rejected = true;
	const reject = (event: Event) => {
		if (rejected) event.preventDefault();
	};
	document.addEventListener("praxity:assessment-group-complete", reject);
	disposals.push(() => document.removeEventListener("praxity:assessment-group-complete", reject));
	await render();
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(document.querySelector("[data-assessment-group-status]")?.textContent).toBe(
			"This answer could not be saved. Your previously saved progress is kept.",
		),
	);
	rejected = false;
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(document.querySelector(".praxity-ag-results-score")).not.toBeNull(),
	);
	expect(document.querySelector("[data-assessment-group-status]")?.textContent).toBe("");
});

for (const evidence of [false, true]) {
	it(`${evidence ? "with" : "without"} a view preserves its submit-removal event order`, async () => {
		const { render } = mount("all", evidence, "en", false);
		const observed: boolean[] = [];
		const observe = () => observed.push(document.querySelector(".praxity-ag-submit-btn") !== null);
		document.addEventListener("praxity:assessment-group-complete", observe);
		disposals.push(() =>
			document.removeEventListener("praxity:assessment-group-complete", observe),
		);
		await render();
		const download = document.createElement("button");
		download.setAttribute("data-assessment-group-download", "true");
		document.querySelector("[data-assessment-group-submit]")?.append(download);
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		await vi.waitFor(() => expect(observed).toEqual([evidence]));
		expect(document.querySelector(".praxity-ag-submit-btn")).toBeNull();
	});
}
