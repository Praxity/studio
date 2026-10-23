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
