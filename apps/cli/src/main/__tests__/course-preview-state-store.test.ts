import {
	createLearnerState,
	LEARNER_STATE_MAX_BYTES,
	parseLearnerState,
	serializeLearnerState,
} from "@praxity/shared-blocks/learner-state";
import { describe, expect, it } from "vitest";
import {
	type CoursePreviewStateStorage,
	CoursePreviewStateStore,
} from "../course-preview-state-store";

class MemoryStorage implements CoursePreviewStateStorage {
	readonly values = new Map<string, string>();
	get(key: string) {
		return this.values.get(key);
	}
	set(key: string, value: string) {
		this.values.set(key, value);
	}
}

const identity = { courseId: "course-1", attemptId: "studio-preview" };

describe("CoursePreviewStateStore", () => {
	it("survives store recreation and revision changes while isolating courses", () => {
		const storage = new MemoryStorage();
		const first = new CoursePreviewStateStore(storage);
		const state = createLearnerState({ ...identity, revision: "revision-1", sequence: 1 });
		state.bookmark = "page-1";
		expect(first.persist(identity.courseId, serializeLearnerState(state))).toBe(true);

		const recreated = new CoursePreviewStateStore(storage);
		expect(recreated.read(identity.courseId, "revision-2")).toBe(serializeLearnerState(state));
		const other = parseLearnerState(recreated.read("course-2", "revision-2"), {
			courseId: "course-2",
			attemptId: "studio-preview",
		});
		expect(other).toMatchObject({ bookmark: null, generation: 0, revision: "revision-2" });
		expect([...storage.values.keys()]).toHaveLength(2);
		expect([...storage.values.keys()].every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
	});

	it("replaces corrupt or cross-course stored data with fresh state", () => {
		const storage = new MemoryStorage();
		const store = new CoursePreviewStateStore(storage);
		store.read(identity.courseId, "revision-1");
		const [key] = storage.values.keys();
		storage.values.set(key, "not json");
		expect(JSON.parse(store.read(identity.courseId, "revision-2"))).toMatchObject({
			courseId: identity.courseId,
			generation: 0,
			revision: "revision-2",
		});

		storage.values.set(
			key,
			serializeLearnerState(
				createLearnerState({ courseId: "course-2", attemptId: "studio-preview" }),
			),
		);
		expect(JSON.parse(store.read(identity.courseId, "revision-3"))).toMatchObject({
			courseId: identity.courseId,
			revision: "revision-3",
		});
	});

	it("accepts only monotonic bounded state and resets into a new generation", () => {
		const store = new CoursePreviewStateStore(new MemoryStorage());
		const state = createLearnerState({ ...identity, revision: "revision-1", sequence: 1 });
		expect(store.persist(identity.courseId, serializeLearnerState(state))).toBe(true);
		expect(store.persist(identity.courseId, serializeLearnerState(state))).toBe(true);
		expect(
			store.persist(identity.courseId, serializeLearnerState({ ...state, bookmark: "divergent" })),
		).toBe(false);

		const newerGeneration = { ...state, generation: 1, sequence: 0 };
		expect(store.persist(identity.courseId, serializeLearnerState(newerGeneration))).toBe(true);
		const reset = JSON.parse(store.reset(identity.courseId, "revision-2"));
		expect(reset).toMatchObject({ generation: 2, sequence: 1, revision: "revision-2" });
		expect(store.persist(identity.courseId, serializeLearnerState(state))).toBe(false);
		expect(store.persist(identity.courseId, "not json")).toBe(false);
		expect(store.persist(identity.courseId, "x".repeat(LEARNER_STATE_MAX_BYTES + 1))).toBe(false);
	});
});
