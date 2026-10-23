// @vitest-environment jsdom

import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { createLearnerState, serializeLearnerState } from "@praxity/shared-blocks/learner-state";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChoiceDependencyView } from "../../shared-blocks/src/choice-learner-state";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../src/scorm/types";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
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

it("reads the saved revision without replacing it with the current build or changing learner bytes", () => {
	const bytes = save();
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	const write = vi.spyOn(Storage.prototype, "setItem");
	expect(typeof runtime.getSavedBuildRevision).toBe("function");
	expect(runtime.getSavedBuildRevision()).toBe("saved-build");
	expect(runtime.getBlockState("a")).toEqual({ answer: ["a"], checked: true });
	expect(localStorage.getItem("praxity:course:attempt:state")).toBe(bytes);
	expect(write).not.toHaveBeenCalled();
});

it("does not migrate legacy keys while reading build evidence", () => {
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	localStorage.setItem("praxity:course:attempt:completion", "passed");
	const write = vi.spyOn(Storage.prototype, "setItem");
	const remove = vi.spyOn(Storage.prototype, "removeItem");
	expect(typeof runtime.getSavedBuildRevision).toBe("function");
	expect(runtime.getSavedBuildRevision()).toBeNull();
	expect(localStorage.getItem("praxity:course:attempt:state")).toBeNull();
	expect(localStorage.getItem("praxity:course:attempt:completion")).toBe("passed");
	expect(write).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
});

it.each(["broken", "", "{}"])("preserves unreadable saved bytes %j", (bytes) => {
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	localStorage.setItem("praxity:course:attempt:state", bytes);
	const write = vi.spyOn(Storage.prototype, "setItem");
	expect(typeof runtime.getSavedBuildRevision).toBe("function");
	expect(runtime.getSavedBuildRevision()).toBeNull();
	expect(localStorage.getItem("praxity:course:attempt:state")).toBe(bytes);
	expect(write).not.toHaveBeenCalled();
});

it.each([
	["other", "attempt"],
	["course", "other-attempt"],
])("refuses mismatched identity %s/%s without rewriting its envelope", (courseId, attemptId) => {
	const bytes = serializeLearnerState(
		createLearnerState({ courseId, attemptId, revision: "saved-build" }),
	);
	localStorage.setItem("praxity:course:attempt:state", bytes);
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	const write = vi.spyOn(Storage.prototype, "setItem");
	expect(typeof runtime.getSavedBuildRevision).toBe("function");
	expect(runtime.getSavedBuildRevision()).toBeNull();
	expect(localStorage.getItem("praxity:course:attempt:state")).toBe(bytes);
	expect(write).not.toHaveBeenCalled();
});

it("validates the complete saved envelope before returning its revision", () => {
	const bytes = save().replace('"schemaVersion":1', '"schemaVersion":99');
	localStorage.setItem("praxity:course:attempt:state", bytes);
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	expect(runtime.getSavedBuildRevision()).toBeNull();
	expect(localStorage.getItem("praxity:course:attempt:state")).toBe(bytes);
});

it("does not invent saved evidence for an unscoped or unavailable store", () => {
	const legacy = new LocalStorageRuntime(localStorage);
	const read = vi.spyOn(Storage.prototype, "getItem");
	expect(typeof legacy.getSavedBuildRevision).toBe("function");
	expect(legacy.getSavedBuildRevision()).toBeNull();
	expect(read).not.toHaveBeenCalled();
	read.mockRestore();
	vi.stubGlobal("localStorage", undefined);
	const ephemeral = new LocalStorageRuntime(undefined, "course", "attempt", "current-build");
	ephemeral.setBlockState("a", { answer: ["a"] });
	expect(ephemeral.getSavedBuildRevision()).toBeNull();
});

it("propagates a failed evidence read without writes or source replacement", () => {
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	const write = vi.spyOn(Storage.prototype, "setItem");
	const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
		throw new DOMException("Denied", "SecurityError");
	});
	expect(typeof runtime.getSavedBuildRevision).toBe("function");
	expect(() => runtime.getSavedBuildRevision()).toThrow("Denied");
	expect(write).not.toHaveBeenCalled();
	read.mockRestore();
	save();
	expect(runtime.getSavedBuildRevision()).toBe("saved-build");
});

it("observes later saved revisions without adding a write to the existing visit path", () => {
	save();
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	expect(typeof runtime.getSavedBuildRevision).toBe("function");
	expect(runtime.getSavedBuildRevision()).toBe("saved-build");
	runtime.trackPageVisit("page");
	const bytes = localStorage.getItem("praxity:course:attempt:state");
	const write = vi.spyOn(Storage.prototype, "setItem");
	expect(runtime.getSavedBuildRevision()).toBe("current-build");
	expect(localStorage.getItem("praxity:course:attempt:state")).toBe(bytes);
	expect(runtime.getBlockState("a")).toEqual({ answer: ["a"], checked: true });
	expect(write).not.toHaveBeenCalled();
});

it("constructs one preview view from private and LMS state with their own saved revisions", () => {
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
	expect(typeof provider.getSavedBuildRevision).toBe("function");
	const input = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateGroups: { g: { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] } },
		}),
		{
			rows: [{ id: "a", correct: true }],
			readState: (id) => provider.get(id),
			preview: {
				currentRevision: "current-build",
				readSavedRevision: (id) => provider.getSavedBuildRevision?.(id) ?? null,
			},
		},
	);
	expect(input.readState("a")).toEqual({ answer: ["a"], checked: true });
	expect(input.readState("b")).toEqual({ answer: ["private"], checked: true });
	expect(input.buildProof?.("a")).toEqual({
		savedRevision: "reporting-old",
		currentRevision: "current-build",
	});
	expect(input.buildProof?.("b")).toEqual({
		savedRevision: "private-old",
		currentRevision: "current-build",
	});
	expect(input.groups).toEqual({
		g: { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
	});
	expect(write).not.toHaveBeenCalled();
});

it("exposes read-only evidence through the ordinary provider and refuses unsupported sources", () => {
	save();
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "current-build");
	const ordinary = createBlockStateRuntime(runtime);
	expect(typeof ordinary.getSavedBuildRevision).toBe("function");
	expect(ordinary.getSavedBuildRevision?.("a")).toBe("saved-build");
	const unsupported = {
		getSuspendData: () => null,
		destinations: { state: "device" },
	} as unknown as SCORMRuntime;
	expect(createBlockStateRuntime(unsupported).getSavedBuildRevision?.("a")).toBeNull();
	expect(
		createPrivateBlockStateRuntime(
			unsupported,
			{} as CourseHostConfig,
			window,
		).getSavedBuildRevision?.("a"),
	).toBeNull();
	const privateProvider = createPrivateBlockStateRuntime(
		runtime,
		{ blockStatePolicy: { b: "device" } } as unknown as CourseHostConfig,
		window,
		unsupported,
	);
	expect(privateProvider.getSavedBuildRevision?.("b")).toBeNull();
});
