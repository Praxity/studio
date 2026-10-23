import { describe, expect, it } from "vitest";
import {
	createLearnerState,
	LEARNER_STATE_MAX_BYTES,
	parseLearnerState,
	serializeLearnerState,
} from "./learner-state";

describe("learner state envelope", () => {
	it("round-trips compatible state across artifact revisions", () => {
		const state = createLearnerState({
			courseId: "course-1",
			attemptId: "preview",
			revision: "revision-a",
		});
		state.bookmark = "page-stable";
		state.variables.score = 4;

		const restored = parseLearnerState(serializeLearnerState(state), {
			courseId: "course-1",
			attemptId: "preview",
		});

		expect(restored).toMatchObject({
			schemaVersion: 1,
			revision: "revision-a",
			bookmark: "page-stable",
			variables: { score: 4 },
		});
	});

	it("rejects corrupt, cross-course, incompatible, or unbounded state", () => {
		const expected = { courseId: "course-1", attemptId: "preview" };
		const state = createLearnerState(expected);
		expect(parseLearnerState("not json", expected)).toBeNull();
		expect(
			parseLearnerState(serializeLearnerState(state), { ...expected, courseId: "course-2" }),
		).toBeNull();
		expect(parseLearnerState(JSON.stringify({ ...state, schemaVersion: 2 }), expected)).toBeNull();
		expect(parseLearnerState("x".repeat(LEARNER_STATE_MAX_BYTES + 1), expected)).toBeNull();
	});
});
