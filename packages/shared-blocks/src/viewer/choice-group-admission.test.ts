import { afterEach, expect, it, vi } from "vitest";
import type { ChoiceDependencyView } from "../choice-learner-state";
import {
	choiceEvidenceCases,
	factsB,
	groupDigests,
	groupState,
	groupSubmission,
	groupView,
	signatureA,
	signedSubmitted,
} from "../fixtures/choice-evidence";
import { getStrings } from "../i18n/strings";
import type { LearnerStateValue } from "../learner-state";
import type { PraxityBlock } from "../types";
import { initAssessmentGroups } from "./assessment-group-runtime";

afterEach(() => {
	document.body.replaceChildren();
	delete window.__praxityBlockState;
});

function mount(
	mode: "all" | "oneOf",
	initial?: LearnerStateValue,
	suppliedView?: ChoiceDependencyView,
) {
	const states: Record<string, LearnerStateValue> = suppliedView
		? JSON.parse(
				JSON.stringify(
					Object.fromEntries(
						["a", "b", "g"]
							.filter((id) => suppliedView.readState(id) !== undefined)
							.map((id) => [id, suppliedView.readState(id)]),
					),
				),
			)
		: {
				a: JSON.parse(JSON.stringify(signedSubmitted)),
				b: JSON.parse(JSON.stringify(signedSubmitted)),
				...(initial ? { g: initial } : {}),
			};
	const rows: ChoiceDependencyView["rows"][number][] = [
		{ id: "a", correct: true, contentSignature: signatureA },
	];
	window.__praxityBlockState = {
		get: (id) => states[id],
		set: (id, value) => {
			states[id] = value;
		},
		getChoiceDependencyView: () =>
			suppliedView ??
			groupView(states, rows, undefined, {
				mode,
				memberIds: mode === "oneOf" ? ["a", "b"] : ["a"],
				requiredIds: ["a"],
			}),
	};
	const ids = [...(suppliedView?.groups?.g.memberIds ?? (mode === "oneOf" ? ["a", "b"] : ["a"]))];
	document.body.innerHTML = ids
		.map(
			(id) =>
				`<div class="praxity-block praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard" data-assessment-answered="true" data-completed="true" data-result="correct" data-score="100" data-max-score="100" data-passed="true"><p class="praxity-assessment-stem">Question ${id}</p><input type="radio" aria-label="Answer ${id}"><button data-assessment-submit="true">Submit</button></div>`,
		)
		.join("");
	const blocks: PraxityBlock[] = [
		{
			id: "g",
			type: "assessmentGroup",
			data: { mode, memberBlockIds: ids, requireAll: true, showResultsSummary: true },
		},
		...ids.map((id) => ({
			id,
			type: "assessment" as const,
			data: { gradingMode: "exact" as const },
		})),
	];
	const events: CustomEvent[] = [];
	const onComplete = (event: Event) => {
		const complete = event as CustomEvent;
		events.push(complete);
		rows.push({ id: "g", contentSignature: complete.detail.contentSignature });
	};
	document.addEventListener("praxity:assessment-group-complete", onComplete);
	const dispose = initAssessmentGroups({ blocks, root: document.body, labels: getStrings("en") });
	return {
		states,
		events,
		dispose: () => {
			dispose();
			document.removeEventListener("praxity:assessment-group-complete", onComplete);
		},
	};
}

for (const { name, id, status, view } of choiceEvidenceCases().filter(
	(entry) => entry.id === "g",
)) {
	it(`group restoration evidence matrix: ${name}`, async () => {
		const state = view.readState(id);
		const run = mount(view.groups?.g.mode ?? "all", undefined, view);
		try {
			await vi.waitFor(() =>
				expect(document.querySelector("[data-assessment-group-results]")).not.toBeNull(),
			);
			const completed =
				state && typeof state === "object" && "completed" in state && state.completed === true;
			expect(!!document.querySelector(".praxity-ag-results-score")).toBe(
				status === "current" && !!completed,
			);
			expect(run.states.g).toEqual(state);
			expect(run.events).toEqual([]);
		} finally {
			run.dispose();
		}
	});
}

it.each(["all", "oneOf"] as const)(
	"captures %s submitted material and its literal digest at the deliberate group submission",
	async (mode) => {
		const run = mount(mode);
		try {
			await vi.waitFor(() =>
				expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull(),
			);
			document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
			await vi.waitFor(() => expect(run.events).toHaveLength(1));
			expect(run.events[0].detail.contentSignature).toBe(groupDigests[mode].signed);
			expect(run.states.g).toEqual({
				version: 1,
				kind: "assessmentGroup",
				mode,
				selectedMemberId: mode === "oneOf" ? "a" : null,
				completed: true,
				submitted: {
					payload: {
						mode,
						selectedMemberId: mode === "oneOf" ? "a" : null,
						dependencies: [["a", signatureA]],
					},
					contentSignature: groupDigests[mode].signed,
				},
			});
		} finally {
			run.dispose();
		}
	},
);

it("a oneOf radio draft retains its exact submitted aggregate payload", async () => {
	const submitted = groupSubmission("oneOf", "signed");
	const run = mount("oneOf", JSON.parse(JSON.stringify(groupState("oneOf", submitted))));
	try {
		await vi.waitFor(() => expect(document.querySelector('input[value="b"]')).not.toBeNull());
		document.querySelector<HTMLInputElement>('input[value="b"]')?.click();
		expect(run.states.g).toEqual({
			version: 1,
			kind: "assessmentGroup",
			mode: "oneOf",
			selectedMemberId: "b",
			completed: false,
			submitted,
		});
		expect(run.events).toEqual([]);
	} finally {
		run.dispose();
	}
});

it("a history member prevents aggregate capture and restores the oneOf picker", async () => {
	const submitted = groupSubmission("oneOf", "signed");
	const view = groupView(
		{ a: signedSubmitted, g: groupState("oneOf", submitted) },
		[
			{ id: "a", contentSignature: signatureA },
			{ id: "g", contentSignature: submitted.contentSignature },
		],
		{ a: factsB },
		{ mode: "oneOf", memberIds: ["a"], requiredIds: ["a"] },
	);
	const run = mount("oneOf", undefined, view);
	try {
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		const picker = document.querySelector<HTMLInputElement>(
			".praxity-assessment-group-picker input",
		);
		expect(picker?.disabled).toBe(false);
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		expect(picker?.disabled).toBe(true);
		await vi.waitFor(() => expect(picker?.disabled).toBe(false));
		expect(run.events).toEqual([]);
		expect(run.states.g).toEqual(view.readState("g"));
	} finally {
		run.dispose();
	}
});

it("a refused staged group capture keeps its action available for a successful retry", async () => {
	const run = mount("oneOf");
	const provider = window.__praxityBlockState;
	if (!provider) throw Error("Missing provider");
	provider.stageSubmission = () => false;
	try {
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		const picker = document.querySelector<HTMLInputElement>(
			".praxity-assessment-group-picker input",
		);
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		expect(picker?.disabled).toBe(true);
		await vi.waitFor(() => expect(picker?.disabled).toBe(false));
		expect(run.events).toEqual([]);
		expect(run.states.g).toBeUndefined();
		provider.stageSubmission = undefined;
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		await vi.waitFor(() => expect(run.events).toHaveLength(1));
	} finally {
		run.dispose();
	}
});

it("a staged capture checks the not-saved receipt before emitting its aggregate", async () => {
	const run = mount("oneOf");
	const provider = window.__praxityBlockState;
	if (!provider) throw Error("Missing provider");
	provider.getSaveResult = () => ({ status: "not-saved", code: "storage-unavailable" });
	provider.stageSubmission = (_id, write) => write();
	try {
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		await vi.waitFor(() =>
			expect(
				document.querySelector<HTMLInputElement>(".praxity-assessment-group-picker input")
					?.disabled,
			).toBe(false),
		);
		expect(run.events).toEqual([]);
	} finally {
		run.dispose();
	}
});

it("a refused aggregate save leaves its storage notice and retry action available", async () => {
	const run = mount("oneOf");
	const provider = window.__praxityBlockState;
	if (!provider) throw Error("Missing provider");
	provider.getSaveResult = () => ({ status: "not-saved", code: "storage-unavailable" });
	try {
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		await vi.waitFor(() => expect(run.events).toHaveLength(1));
		expect(document.querySelector("[data-assessment-group-status]")?.textContent).toBe(
			getStrings("en").assessmentStorageNotice,
		);
		expect(
			document.querySelector<HTMLInputElement>(".praxity-assessment-group-picker input")?.disabled,
		).toBe(false);
		expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	} finally {
		run.dispose();
	}
});
