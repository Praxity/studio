import { expect, it } from "vitest";
import { createChoiceDependencyView } from "./choice-learner-state";
import { admitChoiceStateFacts } from "./choice-state-facts";

it("the dormant view prepares and verifies a candidate through its existing owners", () => {
	const facts = admitChoiceStateFacts({
		choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
	});
	const view = createChoiceDependencyView(facts, {
		rows: [{ id: "g", contentSignature: `sha256:${"b".repeat(64)}` }],
		readState: () => ({
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: true,
		}),
	});
	expect(typeof view.prepareGroupSubmission).toBe("function");
	const submitted = view.prepareGroupSubmission?.("g", view);
	expect(submitted).toEqual({
		payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
		contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
	});
	const candidate = {
		...view,
		rows: [{ id: "g", contentSignature: submitted?.contentSignature }],
		readState: () => ({
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: true,
			submitted,
		}),
	};
	expect(view.status("g")).toBe("history");
	expect(view.status("g", candidate)).toBe("current");
});

it("the dormant capability retains the captured payload and skips an identical saved state", () => {
	const view = createChoiceDependencyView(admitChoiceStateFacts({}), {
		rows: [],
		readState: () => undefined,
	});
	const submitted = {
		payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["b", null]] },
		contentSignature: "sha256:8164bb73b03e3cb4d0470f8abb770779e2670d38eefc5c0aecfb04cc76bb4f05",
	};
	const previous = {
		version: 1,
		kind: "assessmentGroup",
		mode: "oneOf",
		selectedMemberId: "b",
		completed: true,
		submitted,
	};
	const draft = {
		version: 1,
		kind: "assessmentGroup",
		mode: "oneOf",
		selectedMemberId: "a",
		completed: false,
	};
	expect(typeof view.prepareGroupState).toBe("function");
	expect(view.prepareGroupState?.(previous, draft)).toEqual({ ...draft, submitted });
	expect(view.prepareGroupState?.(previous, previous)).toBeNull();
});

it("the dormant capability verifies a speculative aggregate and rejects a different digest", () => {
	const state = {
		version: 1,
		kind: "assessmentGroup",
		mode: "all",
		selectedMemberId: null,
		completed: true,
	};
	const view = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
		}),
		{
			rows: [{ id: "g", contentSignature: `sha256:${"b".repeat(64)}` }],
			readState: () => state,
		},
	);
	expect(typeof view.verifyGroupSubmission).toBe("function");
	const verified = view.verifyGroupSubmission?.(
		"g",
		{
			...state,
			contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
		},
		{ correct: true, memberIds: ["a"] },
	);
	expect(verified?.status("g")).toBe("current");
	expect(verified?.rows).toEqual([
		{ id: "g", contentSignature: `sha256:${"b".repeat(64)}` },
		{
			id: "g",
			correct: true,
			memberIds: ["a"],
			contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
		},
	]);
	expect(view.status("g")).toBe("history");
	expect(
		view.verifyGroupSubmission?.(
			"g",
			{ ...state, contentSignature: `sha256:${"f".repeat(64)}` },
			{},
		),
	).toBeNull();
	expect(view.verifyGroupSubmission?.("removed", state, {})).toBeNull();
});
