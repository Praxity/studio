import { describe, expect, it } from "vitest";
import { createChoiceDependencyView } from "./choice-learner-state";
import { admitChoiceStateFacts } from "./choice-state-facts";
import type { LearnerStateValue } from "./learner-state";
import * as schema from "./learner-state";

const signature = `sha256:${"a".repeat(64)}`;
const objective = { id: "f029fc9d-1759-47f2-8e31-4f2f570d223e", score: 100, passed: true };
const successor = { id: "322b920b-bb8f-4f44-9694-558af41fbba3", score: 0, passed: false };
const group = (deferredObjective?: unknown) => ({
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
	submitted: {
		payload: { mode: "all", selectedMemberId: null, dependencies: [["q", null]] },
		contentSignature: signature,
		...(deferredObjective === undefined ? {} : { deferredObjective }),
	},
});
const value = (input: unknown) => input as LearnerStateValue;
function owner() {
	// A base revision fails these assertions, never module loading or a missing call.
	expect(schema.prepareGroupObjectiveSave).toBeTypeOf("function");
	expect(schema.readSubmittedAssessmentGroup).toBeTypeOf("function");
	return schema;
}

describe("deferred group objective syntax", () => {
	it("reads and saves only the three objective fields without changing the raw record", () => {
		const api = owner();
		const saved = group({ ...objective, extra: "ignored" });
		const before = JSON.stringify(saved);
		expect(api.readDeferredGroupObjective(saved)).toEqual(objective);
		expect(api.readSubmittedAssessmentGroup(saved)?.objective).toEqual(objective);
		expect(api.prepareGroupObjectiveSave(undefined, value(saved))).toEqual(group(objective));
		expect(JSON.stringify(saved)).toBe(before);
	});

	it.each([null, "broken", 0, false, { field: "deferredObjective", value: "x" }])(
		"retains a malformed rejection container verbatim, case %#",
		(raw) => {
			const api = owner();
			const corrupt = { ...group(objective), rejectedObjectives: raw };
			const before = JSON.stringify(corrupt);
			const expected = {
				...group(objective),
				rejectedObjectives: [{ field: "rejectedObjectives", value: raw }],
			};
			for (const [previous, next] of [
				[corrupt, group()],
				[undefined, corrupt],
			]) {
				const saved = api.prepareGroupObjectiveSave(previous, value(next));
				expect(saved).toEqual(expected);
				expect(api.prepareGroupObjectiveSave(saved, value(saved))).toEqual(expected);
			}
			expect(JSON.stringify(corrupt)).toBe(before);
		},
	);

	it("rejects array-shaped records even when they carry every named field", () => {
		const api = owner();
		expect(api.isGroupObjectiveId([objective.id])).toBe(false);
		expect(
			api.readDeferredGroupObjective(Object.assign([], { submitted: group(objective).submitted })),
		).toBeUndefined();
		expect(
			api.readDeferredGroupObjective({
				submitted: Object.assign([], { deferredObjective: objective }),
			}),
		).toBeUndefined();
		expect(api.readDeferredGroupObjective(group(Object.assign([], objective)))).toBeNull();
		expect(api.readSavedAssessmentGroupState(Object.assign([], group()))).toBeNull();
		expect(
			api.readSubmittedAssessmentGroup({
				...group(),
				submitted: Object.assign([], group().submitted),
			}),
		).toBeUndefined();
	});

	it("3: a matching malformed reference still refuses", () => {
		const next = { ...group(), submitted: { ...group().submitted, contentSignature: "broken" } };
		expect(
			owner().prepareGroupObjectiveSave(group(objective), value(next), {
				...successor,
				contentSignature: "broken",
			}),
		).toBeNull();
	});
	it.each([null, "garbage", 100])("3: a malformed incoming record %s refuses", (pending) => {
		expect(
			owner().prepareGroupObjectiveSave(group(objective), value(group()), pending as never),
		).toBeNull();
	});
	it.each([0, 99.5, 100])("4: admits the literal percentage %s without rounding", (score) => {
		const record = { ...objective, score };
		expect(owner().readSubmittedAssessmentGroup(group(record))?.objective).toEqual(record);
	});

	it.each([NaN, Infinity, -Infinity, "100", -1, 101, null])(
		"3: an incoming score %s refuses without replacing the preceding bytes",
		(score) => {
			const previous = group(objective);
			const before = JSON.stringify(previous);
			expect(
				owner().prepareGroupObjectiveSave(
					previous,
					value(group()),
					value({
						...successor,
						score,
						contentSignature: signature,
					}) as never,
				),
			).toBeNull();
			expect(JSON.stringify(previous)).toBe(before);
		},
	);

	it.each(["false", 0, 1, null, undefined])("3: an incoming pass flag %s refuses", (passed) => {
		const previous = group(objective);
		const before = JSON.stringify(previous);
		expect(
			owner().prepareGroupObjectiveSave(previous, value(group()), {
				...successor,
				passed,
				contentSignature: signature,
			} as never),
		).toBeNull();
		expect(JSON.stringify(previous)).toBe(before);
	});

	it.each([
		"pending",
		"",
		"f029fc9d-1759-17f2-8e31-4f2f570d223e",
		"f029fc9d-1759-47f2-7e31-4f2f570d223e",
		`${objective.id}x`,
		`x${objective.id}`,
		null,
	])("3: an incoming identity %s refuses", (id) => {
		expect(
			owner().prepareGroupObjectiveSave(group(objective), value(group()), {
				...successor,
				id,
				contentSignature: signature,
			} as never),
		).toBeNull();
	});

	it.each([undefined, "broken", `sha256:${"b".repeat(64)}`])(
		"3: an incoming reference %s cannot attach to a different capture",
		(contentSignature) => {
			expect(
				owner().prepareGroupObjectiveSave(group(objective), value(group()), {
					...successor,
					contentSignature,
				} as never),
			).toBeNull();
		},
	);

	it.each([null, {}, { ...group(), submitted: null }, { ...group(), version: 2 }])(
		"3: an incoming record requires a group capture, case %#",
		(next) => {
			expect(
				owner().prepareGroupObjectiveSave(group(objective), value(next), {
					...successor,
					contentSignature: signature,
				}),
			).toBeNull();
		},
	);

	it.each([
		null,
		"garbage",
		[],
		{},
		{ ...objective, id: null },
		{ ...objective, passed: "false" },
		...[-1, 101, 1e21, null].map((score) => ({ ...objective, score })),
	])("4: saved invalid metadata is raw rejection, never credit, case %#", (raw) => {
		const previous = group(raw);
		const before = JSON.stringify(previous);
		const api = owner();
		expect(api.readDeferredGroupObjective(previous)).toBeNull();
		expect(api.readSubmittedAssessmentGroup(previous)?.objective).toBeUndefined();
		const next = api.prepareGroupObjectiveSave(previous, value(previous));
		expect(next).toEqual({
			...group(),
			rejectedObjectives: [{ field: "deferredObjective", value: raw }],
		});
		expect(api.readSubmittedAssessmentGroup(next)?.objective).toBeUndefined();
		const replacement = api.prepareGroupObjectiveSave(next, value(group()), {
			...successor,
			contentSignature: signature,
		});
		expect(replacement).toEqual({
			...group(successor),
			rejectedObjectives: [{ field: "deferredObjective", value: raw }],
		});
		expect(JSON.stringify(previous)).toBe(before);
	});

	it.each([-1, 1.5, "sequence", Number.MAX_SAFE_INTEGER])(
		"14: raw sequence %s survives picker, retry, replacement and clear as rejection only",
		(objectiveSequence) => {
			const api = owner();
			const previous = { ...group(objective), objectiveSequence };
			const rejectedObjectives = [{ field: "objectiveSequence", value: objectiveSequence }];
			for (const completed of [false, true]) {
				const draft = { ...group(), completed };
				const saved = api.prepareGroupObjectiveSave(previous, value(draft));
				expect(saved).toEqual({
					...draft,
					submitted: group(objective).submitted,
					rejectedObjectives,
				});
				const replaced = api.prepareGroupObjectiveSave(saved, value(group()), {
					...successor,
					contentSignature: signature,
				});
				expect(replaced).toEqual({ ...group(successor), rejectedObjectives });
				expect(
					api.prepareGroupObjectiveSave(replaced, value(replaced), undefined, successor.id),
				).toEqual({ ...group(), rejectedObjectives });
			}
		},
	);

	it("17: a replacement carries only named rejection fields, never an old capture field", () => {
		const api = owner();
		const previous = {
			...group(null),
			objectiveSequence: "old",
			submitted: {
				...group(null).submitted,
				unknown: "old capture only",
			},
		};
		const next = api.prepareGroupObjectiveSave(previous, value(group()), {
			...successor,
			contentSignature: signature,
		});
		expect(next).toEqual({
			...group(successor),
			rejectedObjectives: [
				{ field: "objectiveSequence", value: "old" },
				{ field: "deferredObjective", value: null },
			],
		});
		expect(JSON.stringify(next)).not.toContain("unknown");
	});

	it("retains every distinct raw rejection and deduplicates repeat saves", () => {
		const api = owner();
		const first = api.prepareGroupObjectiveSave(group(null), value(group("broken")));
		const second = api.prepareGroupObjectiveSave(
			first,
			value({ ...group(), objectiveSequence: -1 }),
		);
		const expected = {
			...group(),
			rejectedObjectives: [
				{ field: "deferredObjective", value: null },
				{ field: "deferredObjective", value: "broken" },
				{ field: "objectiveSequence", value: -1 },
			],
		};
		expect(second).toEqual(expected);
		expect(api.prepareGroupObjectiveSave(second, value(second))).toEqual(expected);
	});

	it("retains only a matching record, and clear removes only its own identity", () => {
		const api = owner();
		expect(
			api.prepareGroupObjectiveSave(group(objective), value(group()), undefined, successor.id),
		).toEqual(group(objective));
		expect(
			api.prepareGroupObjectiveSave(group(objective), value(group()), undefined, objective.id),
		).toEqual(group());
		const changed = {
			...group(),
			submitted: { ...group().submitted, contentSignature: `sha256:${"b".repeat(64)}` },
		};
		expect(api.prepareGroupObjectiveSave(group(objective), value(changed))).toEqual(changed);
		expect(
			api.prepareGroupObjectiveSave(
				group(objective),
				value(group(successor)),
				undefined,
				objective.id,
			),
		).toEqual(group(successor));
	});

	it.each([undefined, null, [], {}, { submitted: null }, { submitted: {} }])(
		"absence is distinct from corruption, case %#",
		(state) => {
			expect(owner().readDeferredGroupObjective(state)).toBeUndefined();
		},
	);

	it.each([
		null,
		[],
		{},
		{ ...group(), version: 2 },
		{ ...group(), kind: "assessment" },
		{ ...group(), mode: "other" },
		{ ...group(), mode: "other", selectedMemberId: "q" },
		{ ...group(), completed: 1 },
		{ ...group(), selectedMemberId: "q" },
		{ ...group(), mode: "oneOf", selectedMemberId: null },
		{ ...group(), submitted: null },
		{ ...group(), submitted: { contentSignature: "broken" } },
	])("refuses invalid group capture syntax, case %#", (state) => {
		expect(owner().readSubmittedAssessmentGroup(state)).toBeUndefined();
	});

	it("keeps ordinary states unchanged and accepts oneOf syntax without granting material credit", () => {
		const api = owner();
		const ordinary = {
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: false,
		};
		expect(api.prepareGroupObjectiveSave(undefined, ordinary)).toEqual(ordinary);
		expect(api.prepareGroupObjectiveSave(undefined, "not a group")).toBe("not a group");
		expect(api.prepareGroupObjectiveSave(group(objective), "not a group")).toBeNull();
		expect(api.readSavedAssessmentGroupState(ordinary)).toEqual(ordinary);
		const oneOf = { ...group(objective), mode: "oneOf", selectedMemberId: "q" };
		expect(api.readSubmittedAssessmentGroup(oneOf)?.objective).toEqual(objective);
		expect(api.readSubmittedAssessmentGroup({ ...group(), submitted: {} })).toBeUndefined();
	});
});

it("characterization: the existing view keeps the raw capture through picker and retry drafts", () => {
	const view = createChoiceDependencyView(admitChoiceStateFacts({}), {
		rows: [],
		readState: () => undefined,
	});
	const previous = group(objective);
	for (const selectedMemberId of [null, "q"]) {
		const draft = { ...group(), completed: false, selectedMemberId };
		delete (draft as { submitted?: unknown }).submitted;
		expect(
			view.prepareGroupState?.(value(previous), value(draft) as Record<string, LearnerStateValue>),
		).toEqual({ ...draft, submitted: previous.submitted });
	}
});
