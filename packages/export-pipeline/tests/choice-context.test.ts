// @vitest-environment jsdom

import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { createLearnerState, serializeLearnerState } from "@praxity/shared-blocks/learner-state";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChoiceDependencyView } from "../../shared-blocks/src/choice-learner-state";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import type { CourseHostConfig } from "../template/src/hosts/course-host";
import { createPrivateBlockStateRuntime } from "../template/src/hosts/private-block-state";

beforeEach(() => localStorage.clear());
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function save(courseId = "course", revision = "saved-build", blockId = "a", answer = "a") {
	const state = createLearnerState({ courseId, attemptId: "attempt", revision });
	state.blockState[blockId] = { answer: [answer], checked: true };
	const bytes = serializeLearnerState(state);
	localStorage.setItem(`praxity:${courseId}:attempt:state`, bytes);
	return bytes;
}

it("constructs one evidence view from private and LMS state", () => {
	save("reporting", "reporting-old");
	save("private", "private-old", "b", "private");
	const runtime = new LocalStorageRuntime(localStorage, "reporting", "attempt", "reporting-new");
	const device = new LocalStorageRuntime(localStorage, "private", "attempt", "private-new");
	const provider = createPrivateBlockStateRuntime(
		runtime,
		{ blockStatePolicy: { b: "device" } } as unknown as CourseHostConfig,
		window,
		device,
	);
	const write = vi.spyOn(Storage.prototype, "setItem");
	const input = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateGroups: { g: { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] } },
		}),
		{
			rows: [{ id: "a", correct: true }],
			readState: (id) => provider.get(id),
		},
	);
	expect(input.readState("a")).toEqual({ answer: ["a"], checked: true });
	expect(input.readState("b")).toEqual({ answer: ["private"], checked: true });
	expect(input.groups).toEqual({
		g: { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
	});
	expect(write).not.toHaveBeenCalled();
});
