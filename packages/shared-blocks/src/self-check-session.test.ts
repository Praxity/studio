import { describe, expect, it, vi } from "vitest";
import { createSelfCheckDraft } from "./self-check-draft";
import {
	createSelfCheckSession,
	type SelfCheckOperations,
	type SelfCheckSnapshot,
} from "./self-check-session";
import {
	editSelfCheckDraft,
	resetSelfCheckState,
	restoreSelfCheckState,
	submitSelfCheck,
} from "./self-check-state";

const content = {
	task: "Explain.",
	model: "A reason.",
	parts: [{ id: "reason", label: "Reason", missed: "Add a reason.", evidence: null }],
};
const operations: SelfCheckOperations = {
	restore: (value) => restoreSelfCheckState(content, value),
	edit: (value, draft) => editSelfCheckDraft(content, value, draft),
	submit: (value) => submitSelfCheck(content, value, { blockId: "a", language: "en" }),
	reset: resetSelfCheckState,
};
const submitted = () => operations.submit(createSelfCheckDraft("Saved answer")).state;
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture(values: unknown[] = [submitted(), submitted(), submitted()]) {
	const requests = Array.from({ length: 3 }, () => deferred<SelfCheckOperations>());
	const write = vi.fn();
	const project = vi.fn();
	const session = createSelfCheckSession(
		["a", "b", "c"].map((blockId) => ({ blockId, path: "asset", contentRevision: "revision" })),
		{
			read: (id) => values["abc".indexOf(id)] as never,
			write,
			project,
			admit: (ref) => requests["abc".indexOf(ref.blockId)].promise,
		},
	);
	const snapshots: SelfCheckSnapshot[] = [];
	session.subscribe((value) => snapshots.push(value));
	return { session, requests, write, project, snapshots };
}
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("self-check session", () => {
	it("an identical admitted input is deduplicated until feedback is shown", async () => {
		const { session, requests, write } = fixture([
			createSelfCheckDraft("Saved draft"),
			undefined,
			undefined,
		]);
		requests[0].resolve(operations);
		await session.ready;
		await session.dispatch({ type: "edit", blockId: "a", answer: "" });
		await session.dispatch({ type: "edit", blockId: "a", answer: "" });
		expect(write.mock.calls).toEqual([
			[
				"a",
				{
					version: 1,
					kind: "self-check",
					draft: { answer: "", ticked: [], shown: false },
					submitted: null,
				},
			],
		]);
		await session.dispatch({ type: "edit", blockId: "a", answer: "Current answer" });
		write.mockClear();
		let successor: ReturnType<typeof session.dispatch> | undefined;
		let interrupt = true;
		write.mockImplementation(() => {
			if (interrupt) {
				interrupt = false;
				successor = session.dispatch({ type: "edit", blockId: "a", answer: "Current answer" });
			}
		});
		const shown = await session.dispatch({ type: "show-feedback", blockId: "a" });
		expect(write).toHaveBeenCalledTimes(2);
		expect(shown).toBeUndefined();
		expect((await successor)?.response).toBeNull();
		expect(write.mock.lastCall?.[1].draft).toEqual({
			answer: "Current answer",
			ticked: [],
			shown: false,
		});
		expect(write.mock.lastCall?.[1].submitted.answer).toBe("Current answer");
	});
	for (const operation of ["restore", "edit", "submit", "reset"] as const) {
		it(`disposal inside ${operation} prevents its result from being committed`, async () => {
			let armed = operation === "restore";
			const write = vi.fn();
			const injected = {
				...operations,
				[operation]: (...args: never[]) => {
					const result = (
						operations[operation] as (
							...args: never[]
						) => ReturnType<SelfCheckOperations["restore"]>
					)(...args);
					if (armed) session.dispose();
					return result;
				},
			};
			const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
				read: () => submitted() as never,
				write,
				admit: async () => injected,
			});
			await session.ready;
			armed = true;
			if (operation !== "restore")
				await session.dispatch(
					operation === "edit"
						? { type: "edit", blockId: "a", answer: "New answer" }
						: { type: operation === "reset" ? "start-over" : "show-feedback", blockId: "a" },
				);
			expect(session.read("a")).toMatchObject({ outcome: "cancelled", completed: false });
			expect(write).not.toHaveBeenCalled();
		});
	}
	it("a thrown write retains the draft and publishes a content-free failure", async () => {
		const project = vi.fn();
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => undefined,
			write: () => {
				throw new Error("private answer bytes");
			},
			project,
			admit: async () => operations,
		});
		await session.dispatch({ type: "edit", blockId: "a", answer: "Keep this draft" });
		expect(session.read("a")).toMatchObject({
			outcome: "unavailable",
			code: "comparison-unavailable",
			completed: false,
		});
		expect(project.mock.lastCall?.[1].state.draft.answer).toBe("Keep this draft");
		expect(JSON.stringify(session.read("a"))).not.toContain("private answer bytes");
	});
	it("stops a snapshot before a later subscriber after a reentrant reset", async () => {
		const { session, requests } = fixture([submitted(), submitted(), undefined]);
		let reset = false;
		const delivered: boolean[][] = [];
		session.subscribe((snapshot) => {
			if (!reset && snapshot.activities[0].completed) {
				reset = true;
				void session.dispatch({ type: "start-over", blockId: "a" });
			}
		});
		session.subscribe((snapshot) => delivered.push(snapshot.activities.map((a) => a.completed)));
		requests[0].resolve(operations);
		requests[1].resolve(operations);
		await session.ready;
		expect(delivered).toEqual([
			[false, false, false],
			[false, false, false],
			[false, true, false],
		]);
	});
	it("commits admission before a write that disposes it and never resurrects cancellation", async () => {
		const request = deferred<SelfCheckOperations>();
		let writes = 0;
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => submitted() as never,
			write: () => {
				if (++writes === 2) session.dispose();
			},
			admit: () => request.promise,
		});
		await session.dispatch({ type: "edit", blockId: "a", answer: "Edited while admission waits" });
		request.resolve(operations);
		await session.ready;
		expect(writes).toBe(2);
		expect(session.read("a")).toMatchObject({ outcome: "cancelled", completed: false });
	});
	it("a failed private projection is coded without rejecting the batch or settling siblings early", async () => {
		const requests = [
			deferred<SelfCheckOperations>(),
			deferred<SelfCheckOperations>(),
			deferred<SelfCheckOperations>(),
		];
		const session = createSelfCheckSession(
			["a", "b", "c"].map((blockId) => ({ blockId, path: "", contentRevision: "" })),
			{
				read: () => submitted() as never,
				write: vi.fn(),
				admit: (reference) => requests["abc".indexOf(reference.blockId)].promise,
				project: (blockId) => {
					if (blockId === "b") throw new Error("private response bytes");
				},
			},
		);
		requests[1].resolve(operations);
		await flush();
		expect(session.read("b")).toMatchObject({ ready: false, completed: false, available: false });
		requests[0].resolve(operations);
		requests[2].resolve(operations);
		const snapshot = await session.ready;
		expect(snapshot.activities.map((activity) => activity.completed)).toEqual([true, false, true]);
		expect(snapshot.failures).toEqual([{ blockId: "b", code: "comparison-unavailable" }]);
		expect(JSON.stringify(snapshot)).not.toContain("private response bytes");
	});
	it("fresh drafts stay lazy and an emptied edit is still explicit", async () => {
		const admit = vi.fn();
		const write = vi.fn();
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => undefined,
			write,
			admit,
		});
		await session.ready;
		await session.dispatch({ type: "edit", blockId: "a", answer: "Draft" });
		expect(session.read("a")).toMatchObject({
			outcome: "draft",
			completed: false,
			available: true,
		});
		await session.dispatch({ type: "edit", blockId: "a", answer: "" });
		expect(write.mock.lastCall?.[1]).toEqual({
			version: 1,
			kind: "self-check",
			draft: { answer: "", ticked: [], shown: false },
			submitted: null,
		});
		expect(admit).not.toHaveBeenCalled();
	});
	it("replacement providers dispose the old session before admitting their own snapshot", async () => {
		const old = fixture();
		old.session.dispose();
		const replacement = fixture([createSelfCheckDraft("New provider"), undefined, undefined]);
		for (const request of old.requests) request.resolve(operations);
		replacement.requests[0].resolve(operations);
		await replacement.session.ready;
		expect(old.session.read("a")).toMatchObject({ outcome: "cancelled", completed: false });
		expect(old.write).not.toHaveBeenCalled();
		expect(old.project).not.toHaveBeenCalled();
		expect(replacement.project.mock.lastCall?.[1].state.draft.answer).toBe("New provider");
	});
	it("explicit edits replace invalid state and deliberate feedback can replace a stale comparison", async () => {
		const stale = submitted();
		if (stale?.submitted) stale.submitted.contentRevision = `sha256:${"0".repeat(64)}`;
		const { session, requests } = fixture([stale, { fabricated: true }, undefined]);
		requests[0].resolve(operations);
		requests[1].resolve(operations);
		await session.ready;
		await session.dispatch({ type: "edit", blockId: "b", answer: "New draft" });
		expect(session.read("b")).toMatchObject({
			outcome: "draft",
			available: true,
			completed: false,
		});
		await session.dispatch({ type: "edit", blockId: "a", answer: "Current answer" });
		expect(session.read("a")).toMatchObject({
			outcome: "refused",
			available: false,
			completed: false,
		});
		const result = await session.dispatch({ type: "show-feedback", blockId: "a" });
		expect(result?.state?.submitted?.answer).toBe("Current answer");
		expect(session.read("a")).toMatchObject({
			outcome: "submitted",
			completed: true,
			available: true,
		});
	});
	for (const order of [
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0],
	]) {
		it(`commits every member together in settlement order ${order}`, async () => {
			const { session, requests, write, snapshots, project } = fixture();
			for (const index of order.slice(0, 2)) {
				requests[index].resolve(operations);
				await flush();
				expect(session.read("a")?.ready).toBe(false);
				expect(project).not.toHaveBeenCalled();
				expect(snapshots.every((s) => s.activities.every((a) => !a.completed))).toBe(true);
			}
			requests[order[2]].resolve(operations);
			expect((await session.ready).activities.map((a) => a.completed)).toEqual([true, true, true]);
			expect(snapshots.filter((s) => s.ready)).toHaveLength(1);
			expect(write).not.toHaveBeenCalled();
		});
	}
	it("one failed member never settles held siblings and failures contain no content", async () => {
		const { session, requests, snapshots } = fixture();
		requests[1].reject(new Error("private answer"));
		await flush();
		expect(session.read("b")).toMatchObject({
			outcome: "unavailable",
			available: false,
			completed: false,
			ready: false,
		});
		requests[0].resolve(operations);
		await flush();
		expect(snapshots.some((s) => s.ready)).toBe(false);
		requests[2].resolve(operations);
		const result = await session.ready;
		expect(result.activities.map((a) => a.completed)).toEqual([true, false, true]);
		expect(result.failures).toEqual([{ blockId: "b", code: "comparison-unavailable" }]);
		expect(JSON.stringify(result)).not.toContain("private answer");
	});
	it("distinguishes empty, draft, current, stale and invalid outcomes", async () => {
		const stale = submitted();
		if (stale?.submitted) stale.submitted.contentRevision = `sha256:${"0".repeat(64)}`;
		for (const [value, outcome, available, code] of [
			[undefined, "empty", true, undefined],
			[createSelfCheckDraft("Draft"), "draft", true, undefined],
			[submitted(), "submitted", true, undefined],
			[stale, "refused", false, "activity-changed"],
			[{ ...submitted(), fabricated: true }, "refused", false, "saved-state-invalid"],
		] as const) {
			const { session, requests, write } = fixture([value, undefined, undefined]);
			requests[0].resolve(operations);
			await session.ready;
			expect(session.read("a")).toMatchObject({ outcome, available, code });
			expect(write).not.toHaveBeenCalled();
		}
	});
	it("settles a failed shared support loader for each member", async () => {
		const shared = deferred<SelfCheckOperations>();
		const session = createSelfCheckSession(
			["a", "b", "c"].map((blockId) => ({ blockId, path: "", contentRevision: "" })),
			{
				read: () => submitted() as never,
				write: vi.fn(),
				admit: () => shared.promise,
			},
		);
		shared.reject(new Error("private authored feedback"));
		expect((await session.ready).activities.map((a) => a.outcome)).toEqual([
			"unavailable",
			"unavailable",
			"unavailable",
		]);
	});
	it("keeps explicit empty edits and the old submitted ticks before admission", async () => {
		const saved = submitted();
		if (saved) {
			saved.draft.ticked = ["reason"];
			if (saved.submitted) saved.submitted.ticked = ["reason"];
		}
		const { session, requests, project } = fixture([saved, undefined, undefined]);
		await session.dispatch({ type: "edit", blockId: "a", answer: "" });
		requests[0].resolve(operations);
		await session.ready;
		expect(project.mock.lastCall?.[1].state).toEqual({
			version: 1,
			kind: "self-check",
			draft: { answer: "", ticked: ["reason"], shown: false },
			submitted: saved?.submitted,
		});
		expect(project.mock.lastCall?.[1].response).toBe(null);
		expect(session.read("a")?.completed).toBe(true);
	});
	it("keeps edits between admission and mounting through the same owner", async () => {
		const { session, requests, project } = fixture([submitted(), undefined, undefined]);
		requests[0].resolve(operations);
		await session.ready;
		await session.dispatch({ type: "edit", blockId: "a", answer: "" });
		expect(project.mock.lastCall?.[1].state.draft.answer).toBe("");
		expect(project.mock.lastCall?.[1].state.submitted.answer).toBe("Saved answer");
	});
	it("reset cancels its request while another member still holds the batch", async () => {
		const { session, requests, project } = fixture();
		await session.dispatch({ type: "start-over", blockId: "a" });
		expect(session.read("a")).toMatchObject({ outcome: "empty", ready: false, completed: false });
		requests[0].resolve(operations);
		await flush();
		expect(project).not.toHaveBeenCalled();
		requests[1].resolve(operations);
		requests[2].resolve(operations);
		expect((await session.ready).activities.map((a) => a.completed)).toEqual([false, true, true]);
	});
	it("retry fences the obsolete success and waits for the replacement", async () => {
		const first = deferred<SelfCheckOperations>(),
			second = deferred<SelfCheckOperations>();
		const project = vi.fn(),
			admit = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => submitted() as never,
			write: vi.fn(),
			project,
			admit,
		});
		const retry = session.dispatch({ type: "retry", blockId: "a" });
		first.resolve(operations);
		await flush();
		expect(project).not.toHaveBeenCalled();
		expect(session.read("a")?.ready).toBe(false);
		second.resolve(operations);
		await retry;
		expect(session.read("a")?.completed).toBe(true);
		expect(admit.mock.calls[1][1]).toBe(true);
	});
	it("dispose settles cancellation and ignores obsolete I/O and commands", async () => {
		const { session, requests, write, project } = fixture();
		session.dispose();
		expect((await session.ready).activities.map((a) => a.outcome)).toEqual([
			"cancelled",
			"cancelled",
			"cancelled",
		]);
		for (const request of requests) request.resolve(operations);
		await flush();
		await session.dispatch({ type: "start-over", blockId: "a" });
		expect(project).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});
	it("an immediate subscriber sees current content-free state; only Show feedback has a response", async () => {
		const { session, requests, project } = fixture([
			createSelfCheckDraft("Draft"),
			undefined,
			undefined,
		]);
		requests[0].resolve(operations);
		await session.ready;
		const listener = vi.fn();
		const unsubscribe = session.subscribe(listener);
		expect(listener.mock.calls[0][0].ready).toBe(true);
		expect(JSON.stringify(listener.mock.calls[0][0])).not.toContain("Draft");
		const result = await session.dispatch({ type: "show-feedback", blockId: "a" });
		expect(result?.response?.responseText).toBe("Draft");
		expect(project.mock.calls[0][1].response).toBe(null);
		unsubscribe();
	});
});
