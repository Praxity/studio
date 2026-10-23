import { afterEach, expect, it, vi } from "vitest";
import {
	type ChoiceDependencyEvidence,
	type ChoiceDependencyView,
	choiceDependencyStatus,
} from "../choice-learner-state";
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

function mount(mode: "all" | "oneOf", evidence = true, locale = "en") {
	const values = new Map<string, LearnerStateValue>();
	const rows: ChoiceDependencyView["rows"][number][] = [];
	const events: string[] = [];
	const view = (): ChoiceDependencyEvidence => {
		const input: ChoiceDependencyView = {
			questions: {},
			signatures: {},
			rows,
			groups: { g: { mode, memberIds: ["a", "b"], requiredIds: ["a", "b"] } },
			readState: (id) => values.get(id),
		};
		return { ...input, status: (id) => choiceDependencyStatus(id, input) };
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
			data: { mode, memberBlockIds: ["a", "b"], showResultsSummary: true },
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
	return { values, rows, events, view, render };
}

it("without a view keeps the ordinary event-before-save log and unsigned envelope", async () => {
	const { values, events, render } = mount("all", false);
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
				contentSignature: "sha256:b04ac3b7c9dc17ef54252c39a0db600379e03f714f75d627ca1ee4805f25c74b",
			},
		}),
	);
	expect(events).toEqual(["interaction", "save"]);
});

it("retains the latest capture through A/B/A picker changes and retry remounts", async () => {
	const { values, rows, view, render } = mount("oneOf");
	const captureA = {
		payload: { mode: "oneOf", selectedMemberId: "a", dependencies: [["a", null]] },
		contentSignature: "sha256:0f7eea5ce8b8751eb709140d6e6f323b4f320870e2be78ba811e1ff2c16b11a8",
	};
	const captureB = {
		payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["b", null]] },
		contentSignature: "sha256:8164bb73b03e3cb4d0470f8abb770779e2670d38eefc5c0aecfb04cc76bb4f05",
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

it("keeps an old aggregate in history after member repair until deliberate submission", async () => {
	const { values, rows, view, render } = mount("all");
	const old = {
		payload: {
			mode: "all",
			selectedMemberId: null,
			dependencies: [
				["a", `sha256:${"b".repeat(64)}`],
				["b", null],
			],
		},
		contentSignature: "sha256:20f16510fde514a91cae700e38f4ed7e83ef073d14b7a77ac02fb410498fad8a",
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
	expect(document.querySelector(".praxity-ag-results-score")).toBeNull();
	expect(values.get("g")).toHaveProperty("submitted", old);
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(view().status("g")).toBe("current"));
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

for (const refusal of ["member-history", "stage-refused", "report-refused"] as const) {
	for (const locale of ["en", "fr"]) {
		it(`${locale} ${refusal} keeps the picker and submit action available`, async () => {
			const { render, view, events } = mount("oneOf", true, locale);
			const provider = window.__praxityBlockState;
			Object.assign(provider as object, {
				getChoiceDependencyView:
					refusal === "member-history" ? () => ({ ...view(), invalidIds: ["a"] }) : view,
				stageSubmission:
					refusal === "stage-refused"
						? () => false
						: (_id: string, write: () => boolean) => write(),
				getSaveResult: () =>
					events.includes("interaction")
						? { status: "not-saved", code: "runtime-write-failed" }
						: { status: "pending" },
			});
			await render();
			document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(document.querySelector<HTMLInputElement>(".praxity-ag-radio")).not.toBeDisabled();
			expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
			expect(document.querySelector(".praxity-ag-results-score")).toBeNull();
			if (refusal === "report-refused") {
				expect(events).toEqual(["save", "interaction"]);
				expect(document.querySelector("[data-assessment-group-status]")?.textContent).toBe(
					locale === "fr"
						? "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée."
						: "This answer could not be saved. Your previously saved progress is kept.",
				);
			} else expect(events).toEqual([]);
		});
	}
}
