import { afterEach, describe, expect, it, vi } from "vitest";
import { compileBlockStatePolicy } from "./block-state-policy";
import { reportLearnerBlockResponse } from "./learner-block-response";
import {
	captureLearnerBlockState,
	finishLearnerCourse,
	learnerRuntime,
	learnerTracker,
	readLearnerBlockPolicy,
	readLearnerBlockSaveResult,
	withLearnerStateAuthority,
	writeLearnerBlockState,
} from "./learner-block-state";
import type { LearnerStateValue } from "./learner-state";
import { selfCheckEpochTicket } from "./self-check-consumers";

afterEach(() => {
	delete window.__praxityBlockState;
	delete window.__praxityRuntime;
	delete window.__praxityTracker;
	delete window.__praxityFinishCourse;
});

describe("learner block provider privacy interface", () => {
	it("compiles nested self-check modes and preserves legacy assessment routing", () => {
		expect(
			compileBlockStatePolicy([
				{ id: "private", type: "selfCheck", data: {} },
				{ id: "report", type: "selfCheck", data: { private: false } },
				{
					id: "group",
					type: "assessmentGroup",
					data: {
						children: [
							{ id: "journal", type: "assessment", data: { private: true } },
							{ id: "nested", type: "selfCheck", data: {} },
						],
					},
				},
				{ id: "ordinary", type: "assessment", data: {} },
			]),
		).toEqual({ private: "device", report: "lms", nested: "device" });
	});
	it("does not create a private response event and exposes the provider save result", () => {
		const seen = vi.fn();
		document.addEventListener("praxity:assessment-response", seen);
		window.__praxityBlockState = {
			get: () => undefined,
			set: vi.fn(),
			getPolicy: () => "device",
			getSaveResult: () => ({ status: "not-saved", code: "storage-unavailable" }),
		};
		writeLearnerBlockState("check", { answer: "private" }, selfCheckEpochTicket());
		reportLearnerBlockResponse({ blockId: "check", responseText: "private", submitted: true });
		expect(seen).not.toHaveBeenCalled();
		expect(readLearnerBlockPolicy("check")).toBe("device");
		expect(readLearnerBlockSaveResult("check")).toEqual({
			status: "not-saved",
			code: "storage-unavailable",
		});
		document.removeEventListener("praxity:assessment-response", seen);
	});
	it("emits the literal neutral response unchanged for a reported block", () => {
		const seen = vi.fn();
		document.addEventListener("praxity:assessment-response", seen);
		window.__praxityBlockState = { get: () => undefined, set: vi.fn(), getPolicy: () => "lms" };
		reportLearnerBlockResponse({
			blockId: "check",
			assessmentType: "textResponse",
			responseText: "Tuesday",
			result: "neutral",
			submitted: true,
		});
		expect(seen.mock.calls[0][0].detail).toEqual({
			blockId: "check",
			assessmentType: "textResponse",
			responseText: "Tuesday",
			result: "neutral",
			submitted: true,
		});
		document.removeEventListener("praxity:assessment-response", seen);
	});
});

it("refuses a revoked provider write without relying on the caller to check", () => {
	const set = vi.fn();
	window.__praxityBlockState = { get: () => undefined, set };
	const current = selfCheckEpochTicket();
	const successor = vi.fn();
	window.__praxityBlockState = { get: () => undefined, set: successor };
	expect(writeLearnerBlockState("check", { answer: "obsolete" }, current)).toBe(false);
	expect(set).not.toHaveBeenCalled();
	expect(successor).not.toHaveBeenCalled();
	expect(writeLearnerBlockState("check", { answer: "fresh" }, selfCheckEpochTicket())).toBe(true);
	expect(successor).toHaveBeenCalledExactlyOnceWith("check", { answer: "fresh" });
});

it.each(["document", "captured"] as const)(
	"rechecks %s write authority after the group save handoff",
	(owner) => {
		let current = true;
		const set = vi.fn();
		const provider = {
			get: () => undefined,
			set,
			prepareGroupState(_id: string, value: LearnerStateValue) {
				current = false;
				return value;
			},
		};
		window.__praxityBlockState = provider;
		if (owner === "document") expect(writeLearnerBlockState("g", {}, () => current)).toBe(false);
		else
			expect(
				captureLearnerBlockState(provider, () => current).write(
					"g",
					{},
					{ current: () => current },
				),
			).toBeUndefined();
		expect(set).not.toHaveBeenCalled();
	},
);

it("fences later tracker writes after an injected write revokes its lifetime", () => {
	let active = true;
	const calls: string[] = [];
	const provider = withLearnerStateAuthority(
		{
			trackPageVisit() {
				calls.push("visit");
				active = false;
			},
			setBookmark() {
				calls.push("bookmark");
			},
			setSuspendData() {
				calls.push("state");
			},
			commit() {
				calls.push("commit");
			},
			getVisitedPages() {
				return ["practice"];
			},
		},
		() => active,
	);
	provider.trackPageVisit();
	provider.setBookmark();
	provider.setSuspendData();
	provider.commit();
	expect(calls).toEqual(["visit"]);
	expect(provider.getVisitedPages()).toEqual(["practice"]);
});

it("runtime and tracker accessors refuse stale writes and preserve reads", () => {
	const calls: string[] = [];
	const runtime = {
		setCompletion: () => calls.push("completion"),
		setSuspendData: () => calls.push("state"),
		trackNavigation: () => calls.push("navigation"),
		commit: () => calls.push("commit"),
		getVisitedPages: () => ["slide-2"],
	};
	Object.assign(window, {
		__praxityRuntime: runtime,
		__praxityTracker: { trackPageVisit: () => calls.push("visit") },
	});
	const stale = learnerRuntime(() => false),
		tracker = learnerTracker(() => false);
	expect(stale?.setCompletion?.("completed")).toBe(false);
	expect(stale?.setSuspendData?.("{}")).toBe(false);
	expect(stale?.trackNavigation?.("a", "b", "linear")).toBe(false);
	expect(stale?.commit?.()).toBe(false);
	expect(tracker?.trackPageVisit?.("slide-2")).toBe(false);
	expect(stale?.getVisitedPages?.()).toEqual(["slide-2"]);
	expect(calls).toEqual([]);
});

it("a fresh action reads the successor globals and End clears accessor results", () => {
	const oldVisit = vi.fn(),
		freshVisit = vi.fn();
	Object.assign(window, { __praxityTracker: { trackPageVisit: oldVisit } });
	let active = true;
	const old = learnerTracker(() => active);
	active = false;
	Object.assign(window, { __praxityTracker: { trackPageVisit: freshVisit } });
	old?.trackPageVisit?.("slide-2");
	learnerTracker(() => true)?.trackPageVisit?.("slide-2");
	expect(oldVisit).not.toHaveBeenCalled();
	expect(freshVisit).toHaveBeenCalledExactlyOnceWith("slide-2");
	const end = vi.fn(() => {
		delete window.__praxityRuntime;
		delete window.__praxityTracker;
		return true;
	});
	window.__praxityFinishCourse = end;
	expect(finishLearnerCourse(() => false)).toBe(false);
	expect(end).not.toHaveBeenCalled();
	expect(finishLearnerCourse(() => true)).toBe(true);
	expect(learnerRuntime(() => true)).toBeUndefined();
	expect(learnerTracker(() => true)).toBeUndefined();
});

it.each(["initialize", "terminate", "checkCompletion", "reset", "calculateScorecard"])(
	"refuses %s through a stale learner accessor",
	(method) => {
		const calls: string[] = [];
		Object.assign(window, {
			__praxityRuntime: { [method]: () => calls.push(method) },
			__praxityTracker: { [method]: () => calls.push(method) },
		});
		const stale = () => false;
		for (const accessor of [learnerRuntime, learnerTracker]) {
			const provider = accessor(stale) as Record<string, () => unknown>;
			expect(provider[method]()).toBe(false);
		}
		expect(calls).toEqual([]);
		const fresh = () => true;
		(learnerRuntime(fresh) as Record<string, () => unknown>)[method]();
		expect(calls).toEqual([method]);
	},
);

it("hides object-valued fields through learner accessors while preserving reads", () => {
	Object.assign(window, {
		__praxityRuntime: { api: { SetValue: vi.fn() }, getValue: () => "Tuesday" },
		__praxityTracker: { runtime: { setCompletion: vi.fn() }, getScore: () => 42 },
	});
	const stale = () => false;
	const runtime = learnerRuntime(stale) as unknown as {
		api?: unknown;
		getValue(): string;
	};
	const tracker = learnerTracker(stale) as unknown as {
		runtime?: unknown;
		getScore(): number;
	};
	expect.soft(tracker.runtime).toBeUndefined();
	expect.soft(runtime.api).toBeUndefined();
	expect(runtime.getValue()).toBe("Tuesday");
	expect(tracker.getScore()).toBe(42);
});

it("passes through the read allowlist even with a stale ticket", () => {
	Object.assign(window, {
		__praxityRuntime: {
			getValue: () => "Tuesday",
			hasResponse: () => true,
			calculateScore: () => 42,
		},
	});
	const stale = () => false;
	const runtime = learnerRuntime(stale) as unknown as {
		getValue(): string;
		hasResponse(): boolean;
		calculateScore(): number;
	};
	expect(runtime.getValue()).toBe("Tuesday");
	expect(runtime.hasResponse()).toBe(true);
	expect(runtime.calculateScore()).toBe(42);
});
